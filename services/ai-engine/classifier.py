"""
Project Aegis — Incident Classifier

MLP classification head that maps SentenceTransformer embeddings to
infrastructure incident classes with deterministic action mappings.

All classification logic is isolated here so:
  - main.py handles HTTP and lifecycle
  - kafka_client.py handles event streaming
  - classifier.py handles the inference decision

This module is the single source of truth for incident → action → risk mapping.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Final

import joblib
import numpy as np

logger = logging.getLogger("aegis.classifier")

# ─────────────────────────────────────────────────────────────────────────────
# Incident classes — must match training labels in generate_synthetic_data.py
# ─────────────────────────────────────────────────────────────────────────────
INCIDENT_CLASSES: Final[tuple[str, ...]] = (
    "OOM_KILL",
    "DB_TIMEOUT",
    "PORT_COLLISION",
    "CRASH_LOOP",
    "MEMORY_LEAK",
    "PERMISSION_DENIED",
)

# ─────────────────────────────────────────────────────────────────────────────
# Deterministic action mapping
# Source of truth for all remediation decisions.
# RemediationAction enum values must match NestJS kafka.types.ts
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class IncidentProfile:
    action: str          # RESTART_CONTAINER | STOP_CONTAINER | IGNORE
    risk_level: str      # LOW | HIGH
    analysis: str
    reasoning: str


INCIDENT_PROFILES: Final[dict[str, IncidentProfile]] = {
    "OOM_KILL": IncidentProfile(
        action="RESTART_CONTAINER",
        risk_level="LOW",
        analysis="Process terminated by kernel OOM killer due to memory pressure.",
        reasoning=(
            "The container exceeded its configured memory limit. "
            "Restarting clears the heap and restores service. "
            "Operator should review memory limits if this recurs."
        ),
    ),
    "MEMORY_LEAK": IncidentProfile(
        action="RESTART_CONTAINER",
        risk_level="LOW",
        analysis="Application memory consumption grew continuously without garbage collection.",
        reasoning=(
            "Heap growth pattern indicates a leak. Restarting transiently resolves the leak state. "
            "Permanent fix requires code-level GC investigation."
        ),
    ),
    "DB_TIMEOUT": IncidentProfile(
        action="RESTART_CONTAINER",
        risk_level="LOW",
        analysis="Database connection pool exhausted — all queries timed out.",
        reasoning=(
            "Network socket timeout exhausted the connection pool. "
            "Restarting the container resets connection state and pool."
        ),
    ),
    "PORT_COLLISION": IncidentProfile(
        action="STOP_CONTAINER",
        risk_level="HIGH",
        analysis="Container failed to bind — TCP port is already occupied.",
        reasoning=(
            "Multiple containers cannot bind the same host port. "
            "Restarting would loop. Stopping the container prevents infinite crash cycles. "
            "Operator must resolve the port conflict before restarting."
        ),
    ),
    "CRASH_LOOP": IncidentProfile(
        action="STOP_CONTAINER",
        risk_level="HIGH",
        analysis="Application crashed immediately on startup — likely a configuration error.",
        reasoning=(
            "Startup crash loop detected. Restarting would repeat the failure indefinitely. "
            "Stopping the container prevents resource exhaustion. "
            "Operator must inspect configuration and logs."
        ),
    ),
    "PERMISSION_DENIED": IncidentProfile(
        action="IGNORE",
        risk_level="HIGH",
        analysis="File system access denied — container lacks required permissions.",
        reasoning=(
            "Restarting or stopping will not resolve a permission error. "
            "Operator intervention required to update container security context or volume mounts."
        ),
    ),
}


@dataclass
class ClassificationResult:
    incident_type: str
    action: str
    risk_level: str
    analysis: str
    reasoning: str
    confidence_score: float
    embedding: list[float] = field(default_factory=list)


class IncidentClassifier:
    """
    sklearn MLP classifier wrapper.

    Deterministic: given the same embedding, always produces the same output.
    No randomness, no sampling, no temperature parameters.
    """

    def __init__(self, model_path: str) -> None:
        self._model_path = model_path
        self._model = None

    def load(self) -> None:
        """Load the serialized MLP classifier from disk."""
        if not os.path.exists(self._model_path):
            raise FileNotFoundError(
                f"MLP classifier not found at: {self._model_path}. "
                "Run training/train_classifier.py to train and serialize the model."
            )
        logger.info("Loading MLP classifier from %s...", self._model_path)
        self._model = joblib.load(self._model_path)
        logger.info("MLP classifier loaded. Classes: %s", INCIDENT_CLASSES)

    def is_loaded(self) -> bool:
        return self._model is not None

    def classify(self, embedding: list[float]) -> ClassificationResult:
        """
        Classify a log embedding vector into an incident class.

        Args:
            embedding: 384-dimensional float vector from EmbeddingPipeline.

        Returns:
            ClassificationResult with deterministic action and risk level.

        Raises:
            RuntimeError: if the model is not loaded.
            ValueError: if the embedding dimension is incorrect.
        """
        if self._model is None:
            raise RuntimeError(
                "IncidentClassifier.classify() called before load(). "
                "Ensure load() is called during application startup."
            )

        if len(embedding) == 0:
            raise ValueError("Cannot classify an empty embedding vector.")

        x_input = np.array(embedding, dtype=np.float32).reshape(1, -1)

        # Deterministic argmax prediction
        predicted_idx = int(self._model.predict(x_input)[0])
        probabilities: np.ndarray = self._model.predict_proba(x_input)[0]
        confidence_score = float(probabilities[predicted_idx])

        if predicted_idx >= len(INCIDENT_CLASSES):
            logger.error(
                "Predicted class index %d is out of range (max %d). Defaulting to PERMISSION_DENIED.",
                predicted_idx,
                len(INCIDENT_CLASSES) - 1,
            )
            predicted_idx = len(INCIDENT_CLASSES) - 1

        incident_type = INCIDENT_CLASSES[predicted_idx]
        profile = INCIDENT_PROFILES.get(incident_type)

        if profile is None:
            # Defensive fallback — should never happen if INCIDENT_CLASSES matches INCIDENT_PROFILES
            logger.error(
                "No profile found for incident type '%s'. Defaulting to IGNORE.",
                incident_type,
            )
            profile = IncidentProfile(
                action="IGNORE",
                risk_level="HIGH",
                analysis="Unknown incident type.",
                reasoning="No remediation profile available. Operator intervention required.",
            )

        return ClassificationResult(
            incident_type=incident_type,
            action=profile.action,
            risk_level=profile.risk_level,
            analysis=profile.analysis,
            reasoning=profile.reasoning,
            confidence_score=confidence_score,
            embedding=embedding,
        )
