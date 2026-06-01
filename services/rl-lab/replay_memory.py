"""
Project Aegis — Replay Memory Buffer

Provides utilities for sampling episodes from the MongoDB replay buffer
for offline RL training analysis and batch loading.

This module is used by train_agent.py and evaluation.py for structured
access to the episode store. It does not modify any stored data.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

import numpy as np
from pymongo import MongoClient
from pymongo.errors import PyMongoError

logger = logging.getLogger("aegis.replay_memory")


@dataclass(frozen=True)
class Episode:
    """Immutable representation of a single training episode."""
    state_vector: list[float]
    action_taken: int
    reward: float
    next_state_vector: list[float]
    container_name: str
    image_name: str
    event_type: str
    exit_code: int


class ReplayMemory:
    """
    In-memory replay buffer loaded from MongoDB.

    The buffer is loaded once and held in memory for the duration
    of the training session. MongoDB is not queried again after init.

    Usage:
        buffer = ReplayMemory(mongo_uri, limit=2000)
        buffer.load()
        batch = buffer.sample(batch_size=64)
    """

    def __init__(
        self,
        mongo_uri: Optional[str] = None,
        collection_name: str = "episodes",
        limit: int = 5000,
        state_dim: int = 386,
    ) -> None:
        self._mongo_uri = mongo_uri or os.getenv(
            "MONGO_URI", "mongodb://aegis-mongo:27018/aegis"
        )
        self._collection_name = collection_name
        self._limit = limit
        self._state_dim = state_dim
        self._episodes: list[Episode] = []
        self._rng = np.random.default_rng()

    def load(self) -> None:
        """
        Load episodes from MongoDB. Closes the connection after loading.
        """
        client = None
        try:
            logger.info(
                "Connecting to MongoDB replay buffer at %s...", self._mongo_uri
            )
            client = MongoClient(self._mongo_uri, serverSelectionTimeoutMS=10_000)
            db = client.get_default_database()
            collection = db[self._collection_name]

            cursor = (
                collection.find()
                .sort("timestamp", -1)
                .limit(self._limit)
            )
            raw: list[dict] = list(cursor)

        except PyMongoError as exc:
            raise RuntimeError(
                f"ReplayMemory: MongoDB connection failed ({self._mongo_uri}): {exc}"
            ) from exc
        finally:
            if client:
                client.close()

        loaded: list[Episode] = []
        skipped = 0
        for ep in raw:
            sv = ep.get("state_vector", [])
            nsv = ep.get("next_state_vector", sv)
            if len(sv) != self._state_dim:
                skipped += 1
                continue
            loaded.append(
                Episode(
                    state_vector=sv,
                    action_taken=int(ep.get("action_taken", 0)),
                    reward=float(ep.get("reward", 0.0)),
                    next_state_vector=nsv if len(nsv) == self._state_dim else sv,
                    container_name=ep.get("containerName", "unknown"),
                    image_name=ep.get("imageName", "unknown"),
                    event_type=ep.get("eventType", "die"),
                    exit_code=int(ep.get("exitCode", 0)),
                )
            )

        self._episodes = loaded
        logger.info(
            "ReplayMemory loaded: %d valid episodes (skipped %d with bad dims).",
            len(loaded),
            skipped,
        )

    def __len__(self) -> int:
        return len(self._episodes)

    def sample(self, batch_size: int) -> list[Episode]:
        """Return a random batch of episodes without replacement."""
        if not self._episodes:
            raise RuntimeError("ReplayMemory is empty. Call load() first.")
        n = min(batch_size, len(self._episodes))
        indices = self._rng.choice(len(self._episodes), size=n, replace=False)
        return [self._episodes[i] for i in indices]

    def all(self) -> list[Episode]:
        """Return all loaded episodes."""
        return list(self._episodes)

    def action_distribution(self) -> dict[int, int]:
        """Count how often each action was taken historically."""
        counts: dict[int, int] = {}
        for ep in self._episodes:
            counts[ep.action_taken] = counts.get(ep.action_taken, 0) + 1
        return counts

    def reward_statistics(self) -> dict[str, float]:
        """Summary statistics for the reward distribution."""
        if not self._episodes:
            return {"count": 0, "mean": 0.0, "min": 0.0, "max": 0.0, "std": 0.0}
        rewards = np.array([ep.reward for ep in self._episodes])
        return {
            "count": float(len(rewards)),
            "mean": float(rewards.mean()),
            "min": float(rewards.min()),
            "max": float(rewards.max()),
            "std": float(rewards.std()),
        }
