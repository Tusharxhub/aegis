import os
import faiss
import pickle
import numpy as np
from typing import List, Dict, Any

class VectorMemory:
    """
    FAISS-backed local vector store to index and retrieve incident error logs.
    Saves vectors to a flat L2 index and mirrors metadata to a pickle file.
    """
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata: List[Dict[str, Any]] = []

    def add_incident(self, incident_id: str, embedding: List[float], log_text: str, label: str) -> None:
        """
        Add a vectorized incident log to the FAISS index.
        """
        vector = np.array(embedding, dtype=np.float32).reshape(1, -1)
        self.index.add(vector)
        self.metadata.append({
            "incident_id": incident_id,
            "log_text": log_text,
            "label": label
        })

    def search_similar(self, embedding: List[float], top_k: int = 3) -> List[Dict[str, Any]]:
        """
        Search for the top K closest vectors and return their metadata with scores.
        """
        if self.index.ntotal == 0:
            return []

        vector = np.array(embedding, dtype=np.float32).reshape(1, -1)
        
        # Clip top_k to actual database size
        actual_k = min(top_k, self.index.ntotal)
        distances, indices = self.index.search(vector, actual_k)
        
        results = []
        for i, idx in enumerate(indices[0]):
            if idx == -1 or idx >= len(self.metadata):
                continue
            meta = self.metadata[idx]
            # Convert float distance to standard float
            results.append({
                "score": float(distances[0][i]),
                "incident_id": meta["incident_id"],
                "log_text": meta["log_text"],
                "label": meta["label"]
            })
        return results

    def save(self, directory: str) -> None:
        """
        Persist index and metadata files to local filesystem.
        """
        os.makedirs(directory, exist_ok=True)
        index_file = os.path.join(directory, "faiss_index.bin")
        metadata_file = os.path.join(directory, "metadata.pkl")
        
        faiss.write_index(self.index, index_file)
        with open(metadata_file, "wb") as f:
            pickle.dump(self.metadata, f)

    def load(self, directory: str) -> None:
        """
        Load index and metadata files from local filesystem.
        """
        index_file = os.path.join(directory, "faiss_index.bin")
        metadata_file = os.path.join(directory, "metadata.pkl")
        
        if os.path.exists(index_file) and os.path.exists(metadata_file):
            self.index = faiss.read_index(index_file)
            with open(metadata_file, "rb") as f:
                self.metadata = pickle.load(f)
