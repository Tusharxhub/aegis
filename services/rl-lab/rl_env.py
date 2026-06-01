"""
Project Aegis — Offline RL Environment (services/rl-lab)

AegisOfflineEnv: A Gymnasium environment backed by the MongoDB episode replay
buffer. This environment is OFFLINE-ONLY — it never touches live infrastructure.

Design decisions:
  - Loads all episodes into memory at init time (bounded by buffer size)
  - Closes the MongoDB connection after loading — no live DB coupling during training
  - Deterministic step(): given the same episode index and action, always returns
    the same reward (no sampling from stochastic distributions)
  - Single-step episodic MDP: each reset draws a random episode, step terminates

Usage:
    env = AegisOfflineEnv(mongo_uri="mongodb://localhost:27018/aegis")
    obs, _ = env.reset()
    obs, reward, terminated, truncated, info = env.step(action)

The environment must never be used to control live infrastructure.
It exists only for offline PPO training against historical incident data.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from pymongo import MongoClient
from pymongo.errors import PyMongoError

logger = logging.getLogger("aegis.rl_env")

# State vector dimension:
# 384 (SentenceTransformer embedding) + 1 (OOM flag) + 1 (normalized exit code)
STATE_DIM = 386

# Action space definition — must match NestJS RemediationAction enum
# 0 = IGNORE, 1 = RESTART_CONTAINER, 2 = STOP_CONTAINER
ACTION_DIM = 3
ACTION_NAMES = {0: "IGNORE", 1: "RESTART_CONTAINER", 2: "STOP_CONTAINER"}


class AegisOfflineEnv(gym.Env):
    """
    Gymnasium environment backed by the MongoDB episode replay buffer.

    The environment loads historical incident episodes from MongoDB,
    closes the connection, and then operates entirely in-memory.

    Reward contract:
      - action matches recorded action + recorded reward > 0: +reward
      - action matches recorded action + recorded reward <= 0: recorded reward (negative)
      - action differs + recorded reward > 0: -abs(recorded_reward)  (missed opportunity)
      - action differs + recorded reward <= 0: -1.0 (step penalty)

    This reward shaping encourages the agent to learn which actions were
    historically successful without penalizing exploration against failed actions.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        mongo_uri: Optional[str] = None,
        collection_name: str = "episodes",
        limit: int = 5000,
    ) -> None:
        super().__init__()

        uri = mongo_uri or os.getenv("MONGO_URI", "mongodb://aegis-mongo:27018/aegis")

        self.episodes: list[dict] = []
        self.state_dim = STATE_DIM
        self._load_episodes(uri, collection_name, limit)

        self.action_space = spaces.Discrete(ACTION_DIM)
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(self.state_dim,),
            dtype=np.float32,
        )

        self._current_idx: int = 0

    def _load_episodes(
        self,
        mongo_uri: str,
        collection_name: str,
        limit: int,
    ) -> None:
        """
        Load episodes from MongoDB and immediately close the connection.
        This is the only point where the environment touches a database.
        """
        client = None
        try:
            logger.info("Loading episodes from MongoDB: %s...", mongo_uri)
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10_000)
            db = client.get_default_database()
            collection = db[collection_name]

            cursor = (
                collection.find(
                    {},
                    {
                        "_id": 0,
                        "state_vector": 1,
                        "action_taken": 1,
                        "reward": 1,
                        "next_state_vector": 1,
                    },
                )
                .sort("timestamp", -1)
                .limit(limit)
            )

            raw_episodes: list[dict] = list(cursor)

        except PyMongoError as exc:
            raise RuntimeError(
                f"Failed to load episodes from MongoDB ({mongo_uri}): {exc}"
            ) from exc
        finally:
            if client:
                client.close()
                logger.info("MongoDB connection closed after episode loading.")

        if not raw_episodes:
            raise RuntimeError(
                "No training episodes found in the MongoDB replay buffer. "
                "Ensure the control plane has processed at least one incident."
            )

        # Validate and filter episodes with correct state dimensions
        valid: list[dict] = []
        for ep in raw_episodes:
            sv = ep.get("state_vector", [])
            if len(sv) == self.state_dim:
                valid.append(ep)
            else:
                logger.debug(
                    "Skipping episode with incorrect state_vector dim: %d (expected %d)",
                    len(sv),
                    self.state_dim,
                )

        if not valid:
            raise RuntimeError(
                f"No valid episodes found with state_vector dim={self.state_dim}. "
                "Check that the RlCoordinator is generating state vectors correctly."
            )

        self.episodes = valid
        logger.info(
            "Loaded %d valid training episodes (of %d raw) for offline RL training.",
            len(self.episodes),
            len(raw_episodes),
        )

    def reset(
        self,
        seed: Optional[int] = None,
        options: Optional[dict] = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        self._current_idx = self.np_random.integers(0, len(self.episodes))
        episode = self.episodes[self._current_idx]
        obs = np.array(episode["state_vector"], dtype=np.float32)
        return obs, {"episode_idx": self._current_idx}

    def step(
        self,
        action: int,
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        episode = self.episodes[self._current_idx]

        actual_action = int(episode.get("action_taken", 0))
        actual_reward = float(episode.get("reward", 0.0))

        if action == actual_action:
            reward = actual_reward
        else:
            if actual_reward > 0:
                # Penalize for missing the historically successful action
                reward = -abs(actual_reward)
            else:
                # Step penalty for diverging from a historically bad action
                reward = -1.0

        next_sv = episode.get("next_state_vector", episode["state_vector"])
        next_obs = np.array(next_sv, dtype=np.float32)

        return next_obs, reward, True, False, {
            "actual_action": actual_action,
            "actual_action_name": ACTION_NAMES.get(actual_action, "UNKNOWN"),
            "policy_action": action,
            "policy_action_name": ACTION_NAMES.get(action, "UNKNOWN"),
        }

    def render(self) -> None:
        """No rendering — this is a headless offline environment."""

    def close(self) -> None:
        """No persistent resources to close (DB connection was closed after loading)."""
