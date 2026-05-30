# Project Aegis 🛡️ — Machine Learning Pipeline Specification

This document details the machine learning models, vector similarity indices, and training parameters of the Aegis Custom AI microservice.

---

## 🔍 Pipeline Process Diagram

When a container crash log is processed, it moves through this localized pipeline on the `aegis-ai-engine` container:

```
[Raw Error Log] 
       │
       ▼ (Clean timestamp & PID tags)
[Preprocessed Text]
       │
       ▼ (Pass to all-MiniLM-L6-v2 Transformer)
[384-Dim Embedding Vector]
       │
       ├──────────────────────────────────────────┐
       │                                          │
       ▼ (FAISS Vector Index)                     ▼ (MLP Neural Net)
[Locate top-3 Euclidean matches]          [Calculate probability scores]
       │                                          │
       └───────────────────┬──────────────────────┘
                           │
                           ▼
                  [Diagnose Response]
```

---

## 📥 Ebedding Generator (SentenceTransformer)

- **Model**: `all-MiniLM-L6-v2` (a lightweight, highly efficient DistilBERT-based model).
- **Dimension**: Maps raw log text segments to **384-dimensional dense floating-point vector arrays**.
- **Local Isolation**: The base model files are serialized and stored inside the container at `/app/models/sentence_transformer`. No external HuggingFace connections are made during runtime inference.

---

## 🔎 Similarity Engine (FAISS Store)

- **Library**: `faiss-cpu` (Facebook AI Similarity Search).
- **Index Type**: `faiss.IndexFlatL2` (Exact L2 Euclidean distance matching).
- **L2 Math**:
  $$d(u, v) = \sqrt{\sum_{i=1}^{n} (u_i - v_i)^2}$$
- **Usage**: FAISS searches its local vector memory index to locate historical incidents with matching semantics. This helps operators identify if the exact same exception has occurred previously in the cluster.
- **Persistence**: Persisted to `/app/vectorstore/storage` as:
  - `faiss_index.bin`: Binary weights of vector indices.
  - `metadata.pkl`: Pickled metadata (incident ID, logs, class names) mapping to index locations.

---

## 🧠 Classification Head (MLP Neural Network)

A custom Multilayer Perceptron (MLP) acts as the classification model. It is trained on top of the SentenceTransformer embeddings using Scikit-Learn.

### 1. Neural Net Topology
- **Input Layer**: 384 neurons (matching embedding size).
- **Hidden Layer 1**: 128 neurons (ReLU activation, dropout regularization).
- **Hidden Layer 2**: 64 neurons (ReLU activation).
- **Output Layer**: 6 neurons (representing the 6 crash categories).

### 2. Output Incident Mapping
1. `OOM_KILL` (Class `0`) -> Memory exhaustion.
2. `DB_TIMEOUT` (Class `1`) -> Database connection failure.
3. `PORT_COLLISION` (Class `2`) -> Address already in use.
4. `CRASH_LOOP` (Class `3`) -> Script or runtime ReferenceErrors.
5. `MEMORY_LEAK` (Class `4`) -> RSS grows linearly without collection.
6. `PERMISSION_DENIED` (Class `5`) -> File EACCES permissions.

---

## ⚙️ Model Compilation & Auto-Bootstrapping

To provide a zero-configuration developer experience, the AI Engine contains an auto-bootstrapper in `main.py`:
1. On container bootup, the app checks if `/app/models/classifier_head.joblib` exists.
2. If missing, it automatically invokes the data generation script to build a synthetic dataset of 900 logs.
3. It fits the SentenceTransformer model to the dataset, encodes features, and trains the MLP classifier head.
4. It serializes both models locally, allowing the service to pass its Docker healthcheck.
