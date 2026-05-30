import os
import uuid
import joblib
import logging
import numpy as np
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from sklearn.neural_network import MLPClassifier

from vectorstore.memory import VectorMemory

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aegis-ai-engine")

app = FastAPI(
    title="Project Aegis Custom AI Engine",
    description="Stateless localized failure intelligence microservice powered by SentenceTransformers & FAISS.",
    version="1.0.0"
)

# ─────────────────────────────────────────────────────────────────────────────
# Path Constants & Global Variables
# ─────────────────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
TRANSFORMER_PATH = os.path.join(MODELS_DIR, "sentence_transformer")
CLASSIFIER_PATH = os.path.join(MODELS_DIR, "classifier_head.joblib")
VECTOR_STORE_DIR = os.path.join(BASE_DIR, "vectorstore", "storage")

# Global ML models
transformer_model: SentenceTransformer = None
classifier_model: MLPClassifier = None
vector_memory: VectorMemory = None

INCIDENT_CLASSES = [
    "OOM_KILL",
    "DB_TIMEOUT",
    "PORT_COLLISION",
    "CRASH_LOOP",
    "MEMORY_LEAK",
    "PERMISSION_DENIED"
]

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic Schemas
# ─────────────────────────────────────────────────────────────────────────────

class DiagnoseRequest(BaseModel):
    log_text: str = Field(..., description="Raw log log lines from container output")

class SimilarIncident(BaseModel):
    incident_id: str
    log_text: str
    label: str
    score: float

class DiagnoseResponse(BaseModel):
    incidentType: str
    analysis: str
    confidenceScore: float
    riskLevel: str  # "LOW" | "HIGH"
    suggestedAction: str  # "RESTART_CONTAINER" | "STOP_CONTAINER" | "IGNORE"
    reasoning: str
    similarIncidents: List[SimilarIncident] = []

# ─────────────────────────────────────────────────────────────────────────────
# Model Auto-Training Startup Lifespan
# ─────────────────────────────────────────────────────────────────────────────

def auto_train_if_needed():
    """
    Checks if models exist. If not, runs synthetic data generation
    and trains the MLP classifier head programmatically to prevent container crash.
    """
    global transformer_model, classifier_model
    
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(VECTOR_STORE_DIR, exist_ok=True)
    
    if not os.path.exists(TRANSFORMER_PATH) or not os.path.exists(CLASSIFIER_PATH):
        logger.warning("⚠️ Local ML models not found. Bootstrapping synthetic dataset and training classifier head...")
        
        # 1. Generate Synthetic Data
        from training.generate_synthetic_data import build_dataset, CLASSES
        data_csv_path = os.path.join(BASE_DIR, "training", "synthetic_logs.csv")
        os.makedirs(os.path.dirname(data_csv_path), exist_ok=True)
        
        data = build_dataset(samples_per_class=120)
        import csv
        with open(data_csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["log_text", "label", "class_name"])
            for row in data:
                writer.writerow([row["log_text"], row["label"], row["class_name"]])
        logger.info(f"✅ Generated {len(data)} synthetic logs at {data_csv_path}")
        
        # 2. Encode and Train Classifier
        logger.info("⚡ Compiling sentence embeddings using all-MiniLM-L6-v2...")
        base_transformer = SentenceTransformer("all-MiniLM-L6-v2")
        
        texts = [row["log_text"] for row in data]
        labels = [row["label"] for row in data]
        
        embeddings = base_transformer.encode(texts, show_progress_bar=False, batch_size=32)
        X = np.array(embeddings)
        y = np.array(labels)
        
        logger.info("🧠 Training Multi-Layer Perceptron classification head...")
        mlp = MLPClassifier(hidden_layer_sizes=(128, 64), random_state=42, max_iter=250)
        mlp.fit(X, y)
        
        # 3. Save Model Weights locally
        base_transformer.save(TRANSFORMER_PATH)
        joblib.dump(mlp, CLASSIFIER_PATH)
        logger.info("💾 Models serialized locally for air-gapped run.")

@app.on_event("startup")
def load_models_on_startup():
    global transformer_model, classifier_model, vector_memory
    
    try:
        # Run compiler check
        auto_train_if_needed()
        
        # Load local SentenceTransformer
        logger.info(f"💾 Loading local SentenceTransformer from {TRANSFORMER_PATH}...")
        transformer_model = SentenceTransformer(TRANSFORMER_PATH)
        
        # Load local MLP Classifier
        logger.info(f"💾 Loading local Classifier Head from {CLASSIFIER_PATH}...")
        classifier_model = joblib.load(CLASSIFIER_PATH)
        
        # Initialize FAISS Memory store
        logger.info(f"💾 Initializing FAISS Vector memory store...")
        vector_memory = VectorMemory(dimension=384)
        vector_memory.load(VECTOR_STORE_DIR)
        
        logger.info("✅ Project Aegis Custom AI Engine loaded and healthy.")
    except Exception as e:
        logger.error(f"❌ Failed to load AI engine: {str(e)}")
        raise RuntimeError(f"AI Engine loading error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# Endpoint Route Handlers
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "loaded_models": {
            "sentence_transformer": transformer_model is not None,
            "classifier_head": classifier_model is not None,
            "vector_store": vector_memory is not None
        }
    }

@app.post("/diagnose", response_model=DiagnoseResponse)
def diagnose_logs(request: DiagnoseRequest):
    """
    Diagnose a container crash log using the local transformer and classifier models.
    """
    if transformer_model is None or classifier_model is None or vector_memory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI models are not yet loaded and initialized."
        )
        
    try:
        # 1. Clean & Preprocess
        log_text = request.log_text.strip()
        if not log_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Log text cannot be empty."
            )
            
        # 2. Vectorize log text via Transformer
        embedding_vec = transformer_model.encode(log_text).tolist()
        x_input = np.array(embedding_vec, dtype=np.float32).reshape(1, -1)
        
        # 3. Predict incident class using MLP classifier
        predicted_idx = int(classifier_model.predict(x_input)[0])
        probabilities = classifier_model.predict_proba(x_input)[0]
        confidence_score = float(probabilities[predicted_idx])
        
        predicted_class = INCIDENT_CLASSES[predicted_idx]
        
        # 4. Search FAISS index for similar incidents
        similar_matches = vector_memory.search_similar(embedding_vec, top_k=3)
        similar_incidents = [
            SimilarIncident(
                incident_id=m["incident_id"],
                log_text=m["log_text"],
                label=m["label"],
                score=m["score"]
            )
            for m in similar_matches
        ]
        
        # 5. Add this incident to FAISS Memory so the system learns / retains matches
        incident_id = f"inc-{uuid.uuid4().hex[:8]}"
        vector_memory.add_incident(incident_id, embedding_vec, log_text, predicted_class)
        vector_memory.save(VECTOR_STORE_DIR)
        
        # 6. Map failure to safety actions
        # Action map: RESTART_CONTAINER | STOP_CONTAINER | IGNORE
        if predicted_class in ["OOM_KILL", "MEMORY_LEAK", "DB_TIMEOUT"]:
            suggested_action = "RESTART_CONTAINER"
            risk_level = "LOW"
            if predicted_class == "OOM_KILL":
                analysis = "Process terminated due to memory pressure (OOM-killed by kernel)."
                reasoning = "The container exceeded its hardware memory threshold. Restarting can temporarily restore service."
            elif predicted_class == "MEMORY_LEAK":
                analysis = "Application memory consumption grew continuously without garbage collection."
                reasoning = "System logs indicate active handles leaks. Restarting resolves the leak state transiently."
            else:
                analysis = "Database queries timed out, disrupting backend connections."
                reasoning = "Network socket timeout. Restarting container resets network sockets."
                
        elif predicted_class in ["PORT_COLLISION", "CRASH_LOOP"]:
            suggested_action = "STOP_CONTAINER"
            risk_level = "HIGH"
            if predicted_class == "PORT_COLLISION":
                analysis = "Binding address failed; TCP port is already occupied."
                reasoning = "Multiple containers cannot share the same host port. Stopped container to prevent loop crash."
            else:
                analysis = "Application crashed immediately upon boot, indicating configuration errors."
                reasoning = "Startup crash loop detected. Stopping container prevents infinite system load."
                
        else: # PERMISSION_DENIED
            suggested_action = "IGNORE"
            risk_level = "HIGH"
            analysis = "File Access Permission Denied."
            reasoning = "The container is running with inadequate permissions. Operator intervention is required."

        return DiagnoseResponse(
            incidentType=predicted_class,
            analysis=analysis,
            confidenceScore=confidence_score,
            riskLevel=risk_level,
            suggestedAction=suggested_action,
            reasoning=reasoning,
            similarIncidents=similar_incidents
        )
    except Exception as e:
        logger.exception("Diagnosis execution failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference process failure: {str(e)}"
        )
