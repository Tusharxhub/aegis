"""
Project Aegis — AI Engine Entry Point

Stateless local inference microservice powered by:
  - SentenceTransformers (all-MiniLM-L6-v2)
  - sklearn MLP classifier
  - FAISS vector store
  - Kafka consumer/producer (kafka_client.py)

The engine serves two interfaces simultaneously:
  1. HTTP POST /diagnose — synchronous inference for the NestJS control plane
  2. Kafka consumer — autonomous inference on aegis.logs.extracted events

Both interfaces use the same embedding pipeline, classifier, and vector store,
ensuring consistent classification regardless of the invocation path.

Offline-only: no external APIs, no cloud inference, no LLMs.
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, Request, status
from pydantic import BaseModel, Field

from classifier import IncidentClassifier
from embedding_pipeline import EmbeddingPipeline
from kafka_client import AegisKafkaClient
from vectorstore.memory import VectorMemory

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("aegis.ai-engine")

# ─────────────────────────────────────────────────────────────────────────────
# Path constants
# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
TRANSFORMER_PATH = os.path.join(MODELS_DIR, "sentence_transformer")
CLASSIFIER_PATH = os.path.join(MODELS_DIR, "classifier_head.joblib")
VECTOR_STORE_DIR = os.path.join(BASE_DIR, "vectorstore", "storage")

# ─────────────────────────────────────────────────────────────────────────────
# Singletons — initialized during lifespan startup
# ─────────────────────────────────────────────────────────────────────────────
embedding_pipeline: EmbeddingPipeline | None = None
classifier: IncidentClassifier | None = None
vector_memory: VectorMemory | None = None
kafka_client: AegisKafkaClient | None = None

# Thread-safe lock to prevent concurrent training
import threading
_training_lock = threading.Lock()

# API key for protected endpoints (loaded from env)
_TRAIN_API_KEY: str | None = os.environ.get("AEGIS_TRAIN_API_KEY")


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────────────────────────────────────

class DiagnoseRequest(BaseModel):
    log_text: str = Field(..., min_length=1, description="Raw log lines from container output")


class TrainRequest(BaseModel):
    samples_per_class: int = Field(default=120, ge=10, le=1000, description="Training samples per incident class")


class SimilarIncident(BaseModel):
    incident_id: str
    log_text: str
    label: str
    score: float


class DiagnoseResponse(BaseModel):
    incidentType: str
    analysis: str
    confidenceScore: float
    riskLevel: str   # "LOW" | "HIGH"
    suggestedAction: str  # "RESTART_CONTAINER" | "STOP_CONTAINER" | "IGNORE"
    reasoning: str
    embedding: list[float] = []
    similarIncidents: list[SimilarIncident] = []


# ─────────────────────────────────────────────────────────────────────────────
# Model bootstrap — auto-trains if local weights are absent
# ─────────────────────────────────────────────────────────────────────────────

def _bootstrap_models_if_needed() -> None:
    """
    Checks if local model weights exist. If not, generates synthetic training
    data and trains the MLP classifier so the engine starts successfully even
    on a fresh container with no pre-trained weights.
    """
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(VECTOR_STORE_DIR, exist_ok=True)

    if os.path.exists(TRANSFORMER_PATH) and os.path.exists(CLASSIFIER_PATH):
        logger.info("Local models found. Skipping bootstrap training.")
        return

    logger.warning(
        "Local ML models not found at %s. "
        "Bootstrapping synthetic dataset and training classifier...",
        MODELS_DIR,
    )

    from training.generate_synthetic_data import build_dataset
    import csv
    import joblib
    from sentence_transformers import SentenceTransformer
    from sklearn.neural_network import MLPClassifier

    # 1. Generate synthetic training data
    data_csv_path = os.path.join(BASE_DIR, "training", "synthetic_logs.csv")
    os.makedirs(os.path.dirname(data_csv_path), exist_ok=True)
    data = build_dataset(samples_per_class=120)

    with open(data_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["log_text", "label", "class_name"])
        for row in data:
            writer.writerow([row["log_text"], row["label"], row["class_name"]])

    logger.info("Generated %d synthetic training samples.", len(data))

    # 2. Train MLP with SentenceTransformer embeddings
    logger.info("Training MLP on all-MiniLM-L6-v2 embeddings...")
    base_transformer = SentenceTransformer("all-MiniLM-L6-v2")
    texts = [row["log_text"] for row in data]
    labels = [row["label"] for row in data]

    embeddings = base_transformer.encode(texts, show_progress_bar=False, batch_size=32)
    X = np.array(embeddings)
    y = np.array(labels)

    mlp = MLPClassifier(
        hidden_layer_sizes=(128, 64),
        activation="relu",
        solver="adam",
        max_iter=300,
        random_state=42,
        early_stopping=True,
        validation_fraction=0.1,
    )
    mlp.fit(X, y)

    # 3. Persist weights
    base_transformer.save(TRANSFORMER_PATH)
    joblib.dump(mlp, CLASSIFIER_PATH)
    logger.info("Bootstrap training complete. Models serialized to %s.", MODELS_DIR)


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI lifespan — handles startup and graceful shutdown
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Startup:
      1. Bootstrap models if absent
      2. Load EmbeddingPipeline
      3. Load IncidentClassifier
      4. Initialize VectorMemory (FAISS)
      5. Start Kafka consumer thread

    Shutdown:
      - Stop Kafka consumer thread cleanly
    """
    global embedding_pipeline, classifier, vector_memory, kafka_client

    try:
        _bootstrap_models_if_needed()

        # Load embedding pipeline
        embedding_pipeline = EmbeddingPipeline(TRANSFORMER_PATH)
        embedding_pipeline.load()

        # Load MLP classifier
        classifier = IncidentClassifier(CLASSIFIER_PATH)
        classifier.load()

        # Initialize FAISS vector store
        vector_memory = VectorMemory(dimension=384)
        vector_memory.load(VECTOR_STORE_DIR)
        logger.info("FAISS vector store loaded. Indexed incidents: %d.", vector_memory.index.ntotal)

        # Start Kafka consumer
        kafka_client = AegisKafkaClient(run_inference=_run_inference)
        kafka_client.start()

        logger.info(
            "Project Aegis AI Engine online. "
            "HTTP inference: enabled. Kafka consumer: enabled."
        )

    except Exception as exc:
        logger.critical("AI Engine startup failed: %s", exc, exc_info=True)
        raise

    yield  # Application runs here

    # ── Shutdown ──────────────────────────────────────────────────────────────
    if kafka_client:
        logger.info("Stopping Kafka consumer thread...")
        kafka_client.stop()

    logger.info("AI Engine shutdown complete.")


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI application
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Project Aegis — AI Inference Engine",
    description=(
        "Offline-only infrastructure intelligence engine. "
        "Local SentenceTransformer + MLP + FAISS. No external APIs."
    ),
    version="2.0.0",
    lifespan=lifespan,
)


# ─────────────────────────────────────────────────────────────────────────────
# Core inference function — shared by HTTP and Kafka paths
# ─────────────────────────────────────────────────────────────────────────────

def _run_inference(log_text: str) -> dict[str, Any]:
    """
    Run the full inference pipeline on raw log text.

    Returns a dict matching the DiagnoseResponse schema.
    Raises RuntimeError if models are not loaded.
    """
    if embedding_pipeline is None or classifier is None or vector_memory is None:
        raise RuntimeError("AI Engine models are not initialized.")

    # 1. Generate embedding
    embedding = embedding_pipeline.encode(log_text.strip())

    # 2. Classify incident
    result = classifier.classify(embedding)

    # 3. FAISS similarity search
    similar_matches = vector_memory.search_similar(embedding, top_k=3)
    similar_incidents = [
        {
            "incident_id": m["incident_id"],
            "log_text": m["log_text"],
            "label": m["label"],
            "score": m["score"],
        }
        for m in similar_matches
    ]

    # 4. Index this incident in FAISS for future similarity lookups
    incident_id = f"inc-{uuid.uuid4().hex[:8]}"
    vector_memory.add_incident(incident_id, embedding, log_text.strip()[:500], result.incident_type)
    vector_memory.save(VECTOR_STORE_DIR)

    return {
        "incidentType": result.incident_type,
        "analysis": result.analysis,
        "confidenceScore": result.confidence_score,
        "riskLevel": result.risk_level,
        "suggestedAction": result.action,
        "reasoning": result.reasoning,
        "embedding": result.embedding,
        "similarIncidents": similar_incidents,
    }


# ─────────────────────────────────────────────────────────────────────────────
# HTTP endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check() -> dict[str, Any]:
    return {
        "status": "healthy",
        "models": {
            "embedding_pipeline": embedding_pipeline is not None and embedding_pipeline.is_loaded(),
            "classifier": classifier is not None and classifier.is_loaded(),
            "vector_store": vector_memory is not None,
        },
        "kafka": {
            "consumer_running": kafka_client is not None and kafka_client.is_running(),
        },
    }


@app.post("/diagnose", response_model=DiagnoseResponse)
def diagnose_logs(request: DiagnoseRequest) -> DiagnoseResponse:
    """
    Synchronous inference endpoint for the NestJS control plane.

    The Kafka consumer also invokes _run_inference() directly, so both
    paths share identical classification logic and output schemas.
    """
    if embedding_pipeline is None or classifier is None or vector_memory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI Engine models are not yet initialized.",
        )

    try:
        result = _run_inference(request.log_text)
        return DiagnoseResponse(**result)
    except Exception as exc:
        logger.exception("Inference failed for HTTP request")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference pipeline failure: {exc}",
        )


@app.post("/train")
def train_model(request: TrainRequest, raw_request: Request) -> dict[str, Any]:
    """
    Retrain the MLP classifier on freshly generated synthetic data.
    Used for offline research and model improvement.

    Protected by X-Aegis-Token header when AEGIS_TRAIN_API_KEY is set.
    Concurrent training is prevented by a lock.
    """
    # Auth check
    if _TRAIN_API_KEY:
        token = raw_request.headers.get("x-aegis-token", "")
        if token != _TRAIN_API_KEY:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid or missing x-aegis-token header.",
            )

    # Prevent concurrent training
    if not _training_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Training is already in progress. Please wait.",
        )

    global embedding_pipeline, classifier, vector_memory

    try:
        from training.generate_synthetic_data import build_dataset
        import csv
        import joblib
        from sentence_transformers import SentenceTransformer
        from sklearn.neural_network import MLPClassifier

        os.makedirs(MODELS_DIR, exist_ok=True)
        os.makedirs(VECTOR_STORE_DIR, exist_ok=True)

        data = build_dataset(samples_per_class=request.samples_per_class)
        data_csv_path = os.path.join(BASE_DIR, "training", "synthetic_logs.csv")
        os.makedirs(os.path.dirname(data_csv_path), exist_ok=True)

        with open(data_csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["log_text", "label", "class_name"])
            for row in data:
                writer.writerow([row["log_text"], row["label"], row["class_name"]])

        base_transformer = SentenceTransformer("all-MiniLM-L6-v2")
        texts = [row["log_text"] for row in data]
        labels = [row["label"] for row in data]

        embeddings = base_transformer.encode(texts, show_progress_bar=False, batch_size=32)
        X = np.array(embeddings)
        y = np.array(labels)

        mlp = MLPClassifier(
            hidden_layer_sizes=(128, 64),
            activation="relu",
            solver="adam",
            max_iter=300,
            random_state=42,
            early_stopping=True,
            validation_fraction=0.1,
        )
        mlp.fit(X, y)

        base_transformer.save(TRANSFORMER_PATH)
        joblib.dump(mlp, CLASSIFIER_PATH)

        # Reload models
        embedding_pipeline = EmbeddingPipeline(TRANSFORMER_PATH)
        embedding_pipeline.load()
        classifier = IncidentClassifier(CLASSIFIER_PATH)
        classifier.load()

        logger.info("Model retrained on %d samples. Weights saved to %s.", len(data), MODELS_DIR)

        return {
            "status": "trained",
            "samples": len(data),
            "classes": len(set(labels)),
            "models_dir": MODELS_DIR,
        }
    except Exception as exc:
        logger.exception("Training failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Training pipeline failure: {exc}",
        )
    finally:
        _training_lock.release()
