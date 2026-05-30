import os
import joblib
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import classification_report, accuracy_score
from sentence_transformers import SentenceTransformer

# Target paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
DATA_PATH = os.path.join(BASE_DIR, "training", "synthetic_logs.csv")

def main():
    print("🚀 Initiating Project Aegis Custom AI training pipeline...")
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    # 1. Load Dataset
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"❌ Synthetic dataset not found at {DATA_PATH}. Run generate_synthetic_data.py first.")
        
    df = pd.read_csv(DATA_PATH)
    print(f"📋 Loaded {len(df)} training examples from dataset.")
    
    # 2. Initialize SentenceTransformer
    transformer_name = "all-MiniLM-L6-v2"
    print(f"📥 Loading base embedding model: {transformer_name}...")
    transformer = SentenceTransformer(transformer_name)
    
    # 3. Vectorize Training Text
    print("⚡ Generating dense text embeddings (this might take a moment)...")
    X_text = df["log_text"].tolist()
    y = df["label"].values
    
    embeddings = transformer.encode(X_text, show_progress_bar=True, batch_size=32)
    X = np.array(embeddings)
    print(f"📊 Vector matrix dimensions: {X.shape}")
    
    # 4. Train-Test Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # 5. Train MLP Classification Head
    print("🧠 Training lightweight custom Neural Net classification head...")
    classifier = MLPClassifier(
        hidden_layer_sizes=(128, 64),
        activation="relu",
        solver="adam",
        max_iter=300,
        random_state=42,
        early_stopping=True,
        validation_fraction=0.1
    )
    
    classifier.fit(X_train, y_train)
    
    # 6. Evaluate Classifier
    y_pred = classifier.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"\n🎯 Model Accuracy: {accuracy * 100:.2f}%")
    print("\n📝 Detailed Classification Report:")
    target_names = ["OOM_KILL", "DB_TIMEOUT", "PORT_COLLISION", "CRASH_LOOP", "MEMORY_LEAK", "PERMISSION_DENIED"]
    print(classification_report(y_test, y_pred, target_names=target_names))
    
    # 7. Serialize Models for 100% Offline Air-Gapped Runs
    local_transformer_path = os.path.join(MODELS_DIR, "sentence_transformer")
    local_classifier_path = os.path.join(MODELS_DIR, "classifier_head.joblib")
    
    print(f"💾 Saving SentenceTransformer to {local_transformer_path}...")
    transformer.save(local_transformer_path)
    
    print(f"💾 Saving MLP Classifier Head to {local_classifier_path}...")
    joblib.dump(classifier, local_classifier_path)
    
    print("✅ All models serialized and saved successfully! The AI Engine is now 100% self-sufficient.")

if __name__ == "__main__":
    main()
