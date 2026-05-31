"""
Project Aegis — Embedding Pipeline

Encapsulates the SentenceTransformer encoding stage.
Used by both the HTTP inference endpoint and the Kafka consumer.

Separation of concerns:
  - EmbeddingPipeline: text → float[384] vector
  - IncidentClassifier: float[384] → incident class + confidence
  - VectorMemory: float[384] → similar incident retrieval
"""

from __future__ import annotations

import logging
import os
from typing import Sequence

import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("aegis.embedding_pipeline")


class EmbeddingPipeline:
    """
    Stateful SentenceTransformer encoder.

    Thread-safe: SentenceTransformer.encode() is GIL-safe for CPU workloads
    since torch operations release the GIL during computation.

    Usage:
        pipeline = EmbeddingPipeline("/app/models/sentence_transformer")
        vector = pipeline.encode("FATAL: OOM_KILL at heap limit")
    """

    def __init__(self, model_path: str) -> None:
        self._model_path = model_path
        self._model: SentenceTransformer | None = None

    def load(self) -> None:
        """Load the SentenceTransformer from the local filesystem."""
        if not os.path.exists(self._model_path):
            raise FileNotFoundError(
                f"SentenceTransformer not found at: {self._model_path}. "
                "Run training/train_classifier.py to initialize local models."
            )
        logger.info("Loading SentenceTransformer from %s...", self._model_path)
        self._model = SentenceTransformer(self._model_path)
        logger.info("SentenceTransformer loaded. Embedding dim: 384.")

    def is_loaded(self) -> bool:
        return self._model is not None

    def encode(self, text: str) -> list[float]:
        """
        Encode raw log text into a 384-dimensional float vector.

        The text is truncated to 512 tokens (the model's context limit).
        Leading/trailing whitespace is stripped before encoding.

        Returns:
            list[float] of length 384 (all-MiniLM-L6-v2 embedding dim).

        Raises:
            RuntimeError: if the model is not loaded.
        """
        if self._model is None:
            raise RuntimeError(
                "EmbeddingPipeline.encode() called before load(). "
                "Ensure load() is called during application startup."
            )

        normalized = text.strip()
        if not normalized:
            # Return a zero vector for empty input — caller should handle this case
            logger.warning("encode() called with empty text; returning zero vector.")
            return [0.0] * 384

        embedding: np.ndarray = self._model.encode(
            normalized,
            show_progress_bar=False,
            batch_size=1,
            normalize_embeddings=False,
        )

        return embedding.tolist()

    def encode_batch(self, texts: Sequence[str], batch_size: int = 32) -> list[list[float]]:
        """
        Batch encode multiple log strings.
        Used by the training pipeline, not the inference path.
        """
        if self._model is None:
            raise RuntimeError("EmbeddingPipeline not loaded.")

        embeddings: np.ndarray = self._model.encode(
            list(texts),
            show_progress_bar=True,
            batch_size=batch_size,
            normalize_embeddings=False,
        )
        return embeddings.tolist()
