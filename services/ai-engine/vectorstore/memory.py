import os
import faiss
import json
import numpy as np
from typing import List, Dict, Any

# Maximum number of vectors in the FAISS index before eviction
MAX_INDEX_SIZE = 10_000


class VectorMemory:
    """
    FAISS-backed local vector store to index and retrieve incident error logs.
    Saves vectors to a flat L2 index and mirrors metadata to a JSON file.

    Security:
      - Uses JSON instead of pickle for metadata serialization to prevent
        arbitrary code execution from tampered files.
      - Caps index size at MAX_INDEX_SIZE to prevent unbounded memory growth.
    """
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata: List[Dict[str, Any]] = []

    def add_incident(self, incident_id: str, embedding: List[float], log_text: str, label: str) -> None:
        """
        Add a vectorized incident log to the FAISS index.
        Evicts oldest entries if the index exceeds MAX_INDEX_SIZE.
        """
        vector = np.array(embedding, dtype=np.float32).reshape(1, -1)
        self.index.add(vector)
        self.metadata.append({
            "incident_id": incident_id,
            "log_text": log_text[:500],  # Truncate to prevent unbounded storage
            "label": label
        })

        # Evict oldest entries if index grows beyond limit
        if self.index.ntotal > MAX_INDEX_SIZE:
            self._evict_oldest(self.index.ntotal - MAX_INDEX_SIZE)

    def _evict_oldest(self, count: int) -> None:
        """Remove the oldest `count` entries from both FAISS index and metadata."""
        if count <= 0 or count >= self.index.ntotal:
            return

        # Rebuild the FAISS index without the oldest entries
        remaining = self.index.ntotal - count
        all_vectors = faiss.rev_swig_ptr(
            self.index.get_xb(), self.index.ntotal * self.dimension
        ).reshape(self.index.ntotal, self.dimension).copy()

        new_vectors = all_vectors[count:]
        self.metadata = self.metadata[count:]

        self.index.reset()
        self.index.add(new_vectors)

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
        Uses JSON for metadata to prevent pickle deserialization attacks.
        """
        os.makedirs(directory, exist_ok=True)
        index_file = os.path.join(directory, "faiss_index.bin")
        metadata_file = os.path.join(directory, "metadata.json")

        faiss.write_index(self.index, index_file)
        with open(metadata_file, "w", encoding="utf-8") as f:
            json.dump(self.metadata, f, ensure_ascii=False)

    def load(self, directory: str) -> None:
        """
        Load index and metadata files from local filesystem.
        Supports both new JSON format and legacy pickle format for migration.
        """
        index_file = os.path.join(directory, "faiss_index.bin")
        metadata_json = os.path.join(directory, "metadata.json")
        metadata_pkl = os.path.join(directory, "metadata.pkl")

        if os.path.exists(index_file):
            self.index = faiss.read_index(index_file)

            # Prefer JSON metadata (secure)
            if os.path.exists(metadata_json):
                with open(metadata_json, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                    # Validate structure
                    if isinstance(raw, list):
                        self.metadata = [
                            {
                                "incident_id": str(entry.get("incident_id", "")),
                                "log_text": str(entry.get("log_text", "")),
                                "label": str(entry.get("label", "")),
                            }
                            for entry in raw
                            if isinstance(entry, dict)
                        ]
                    else:
                        self.metadata = []

            elif os.path.exists(metadata_pkl):
                # Legacy migration: read pickle ONCE, then save as JSON
                import pickle
                import logging
                logger = logging.getLogger("aegis.vector_memory")
                logger.warning(
                    "Loading legacy pickle metadata. "
                    "Will migrate to JSON format on next save."
                )
                with open(metadata_pkl, "rb") as f:
                    self.metadata = pickle.load(f)
                # Immediately save as JSON and remove pickle
                self.save(directory)
                try:
                    os.remove(metadata_pkl)
                    logger.info("Removed legacy pickle metadata file.")
                except OSError:
                    pass
