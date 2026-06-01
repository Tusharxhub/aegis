"""
Project Aegis — Offline PPO Training Script

Trains a PPO agent against the MongoDB episode replay buffer using the
AegisOfflineEnv Gymnasium environment and Stable Baselines3.

SAFETY CONSTRAINT: This script never touches live infrastructure.
It reads historical episodes from MongoDB and trains a policy offline.
The trained policy is saved as a model artifact for evaluation only.

Usage:
    # Train with default settings
    python train_agent.py

    # Train with custom parameters
    python train_agent.py --steps 50000 --output /app/models/ppo_aegis

Environment variables:
    MONGO_URI     — MongoDB connection string (default: mongodb://aegis-mongo:27018/aegis)
    MODEL_OUTPUT  — Path to save trained model (default: ./models/ppo_aegis_v{timestamp})

Dependencies:
    stable-baselines3[extra]
    gymnasium
    pymongo
    torch
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("aegis.train_agent")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train Aegis PPO agent on historical incident episodes."
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=10_000,
        help="Total PPO training timesteps (default: 10000)",
    )
    parser.add_argument(
        "--mongo-uri",
        type=str,
        default=os.getenv("MONGO_URI", "mongodb://aegis-mongo:27018/aegis"),
        help="MongoDB connection URI",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output model path (default: ./models/ppo_aegis_v<timestamp>)",
    )
    parser.add_argument(
        "--episode-limit",
        type=int,
        default=5000,
        help="Maximum episodes to load from replay buffer (default: 5000)",
    )
    parser.add_argument(
        "--min-episodes",
        type=int,
        default=50,
        help="Minimum episodes required to start training (default: 50)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.env_checker import check_env
    except ImportError as exc:
        logger.critical(
            "stable-baselines3 is not installed. "
            "Run: pip install stable-baselines3[extra]"
        )
        return 1

    try:
        from rl_env import AegisOfflineEnv
        from replay_memory import ReplayMemory
    except ImportError as exc:
        logger.critical("Failed to import rl_env or replay_memory: %s", exc)
        return 1

    # ── Load replay buffer ────────────────────────────────────────────────────
    logger.info("Loading episode replay buffer from MongoDB...")

    try:
        buffer = ReplayMemory(
            mongo_uri=args.mongo_uri,
            limit=args.episode_limit,
        )
        buffer.load()
    except RuntimeError as exc:
        logger.error("Failed to load replay buffer: %s", exc)
        return 1

    if len(buffer) < args.min_episodes:
        logger.error(
            "Insufficient episodes for training: %d loaded, %d required. "
            "The control plane must process more incidents before training.",
            len(buffer),
            args.min_episodes,
        )
        return 1

    # ── Report buffer statistics ──────────────────────────────────────────────
    action_dist = buffer.action_distribution()
    reward_stats = buffer.reward_statistics()

    logger.info("Replay buffer statistics:")
    logger.info("  Episodes: %d", len(buffer))
    logger.info(
        "  Action distribution: %s",
        {str(k): v for k, v in sorted(action_dist.items())},
    )
    logger.info("  Reward — mean=%.2f min=%.2f max=%.2f std=%.2f",
        reward_stats["mean"],
        reward_stats["min"],
        reward_stats["max"],
        reward_stats["std"],
    )

    # ── Initialize environment ────────────────────────────────────────────────
    logger.info("Initializing AegisOfflineEnv...")

    try:
        env = AegisOfflineEnv(mongo_uri=args.mongo_uri, limit=args.episode_limit)
    except RuntimeError as exc:
        logger.error("Failed to initialize environment: %s", exc)
        return 1

    # Validate the environment against Gymnasium spec
    try:
        check_env(env, warn=True)
    except Exception as exc:
        logger.warning("Environment check raised warnings: %s", exc)

    # ── Configure model output path ───────────────────────────────────────────
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    model_dir = os.path.join(os.path.dirname(__file__), "models")
    os.makedirs(model_dir, exist_ok=True)
    model_output = args.output or os.path.join(model_dir, f"ppo_aegis_v{timestamp}")

    # ── Train PPO agent ───────────────────────────────────────────────────────
    logger.info(
        "Starting PPO training: %d timesteps on %d episodes → %s",
        args.steps,
        len(buffer),
        model_output,
    )

    train_start = time.monotonic()

    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        learning_rate=3e-4,
        n_steps=min(64, len(buffer)),
        batch_size=min(32, len(buffer) // 2),
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01,
        seed=42,
    )

    model.learn(total_timesteps=args.steps)

    train_elapsed = time.monotonic() - train_start

    # ── Save model ────────────────────────────────────────────────────────────
    model.save(model_output)
    logger.info(
        "Training complete in %.1fs. Model saved to %s.zip",
        train_elapsed,
        model_output,
    )

    env.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
