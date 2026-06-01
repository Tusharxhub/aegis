"""
Project Aegis — RL Agent Evaluation

Evaluates a trained PPO policy against the historical episode replay buffer
and generates a structured performance report.

This script never controls live infrastructure. It is read-only.

Usage:
    python evaluation.py --model ./models/ppo_aegis_v20260601.zip
    python evaluation.py --model ./models/ppo_aegis_v20260601.zip --episodes 200
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("aegis.evaluation")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate a trained Aegis PPO policy against the replay buffer."
    )
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Path to the trained SB3 PPO model zip file.",
    )
    parser.add_argument(
        "--mongo-uri",
        type=str,
        default=os.getenv("MONGO_URI", "mongodb://aegis-mongo:27018/aegis"),
        help="MongoDB connection URI",
    )
    parser.add_argument(
        "--episodes",
        type=int,
        default=500,
        help="Number of evaluation episodes to sample (default: 500)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Optional JSON path to write the evaluation report",
    )
    return parser.parse_args()


def evaluate(args: argparse.Namespace) -> dict:
    try:
        from stable_baselines3 import PPO
    except ImportError:
        logger.critical("stable-baselines3 is not installed.")
        sys.exit(1)

    try:
        from rl_env import AegisOfflineEnv, ACTION_NAMES
        from replay_memory import ReplayMemory
    except ImportError as exc:
        logger.critical("Import error: %s", exc)
        sys.exit(1)

    # ── Load model ────────────────────────────────────────────────────────────
    model_path = args.model
    if not model_path.endswith(".zip"):
        model_path = f"{model_path}.zip"

    if not Path(model_path).exists():
        logger.error("Model not found: %s", model_path)
        sys.exit(1)

    logger.info("Loading PPO model from %s...", model_path)
    model = PPO.load(model_path.replace(".zip", ""))

    # ── Load replay buffer ────────────────────────────────────────────────────
    logger.info("Loading %d evaluation episodes from MongoDB...", args.episodes)
    buffer = ReplayMemory(mongo_uri=args.mongo_uri, limit=args.episodes)
    buffer.load()

    if len(buffer) == 0:
        logger.error("No episodes available for evaluation.")
        sys.exit(1)

    # ── Evaluate ──────────────────────────────────────────────────────────────
    episodes = buffer.all()
    n = min(args.episodes, len(episodes))
    rng = np.random.default_rng(seed=42)
    selected = rng.choice(len(episodes), size=n, replace=False)

    total_reward = 0.0
    correct_actions = 0
    action_agreement: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    per_action_rewards: dict[int, list[float]] = defaultdict(list)

    for idx in selected:
        ep = episodes[idx]
        obs = np.array(ep.state_vector, dtype=np.float32)
        policy_action, _ = model.predict(obs, deterministic=True)
        policy_action = int(policy_action)
        actual_action = ep.action_taken
        actual_reward = ep.reward

        # Compute reward using the same logic as AegisOfflineEnv.step()
        if policy_action == actual_action:
            reward = actual_reward
            correct_actions += 1
        else:
            reward = -abs(actual_reward) if actual_reward > 0 else -1.0

        total_reward += reward
        action_agreement[actual_action]["total"] += 1
        if policy_action == actual_action:
            action_agreement[actual_action]["agreed"] += 1

        per_action_rewards[policy_action].append(reward)

    avg_reward = total_reward / n
    accuracy = correct_actions / n

    # ── Build report ──────────────────────────────────────────────────────────
    action_breakdown = {}
    for action_idx, counts in sorted(action_agreement.items()):
        action_name = ACTION_NAMES.get(action_idx, str(action_idx))
        total = counts["total"]
        agreed = counts.get("agreed", 0)
        action_breakdown[action_name] = {
            "historical_occurrences": total,
            "policy_agreement": agreed,
            "agreement_rate": round(agreed / total, 4) if total > 0 else 0.0,
        }

    policy_rewards_summary = {}
    for action_idx, rewards in sorted(per_action_rewards.items()):
        action_name = ACTION_NAMES.get(action_idx, str(action_idx))
        arr = np.array(rewards)
        policy_rewards_summary[action_name] = {
            "count": len(rewards),
            "mean_reward": round(float(arr.mean()), 4),
            "min_reward": round(float(arr.min()), 4),
            "max_reward": round(float(arr.max()), 4),
        }

    report = {
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "model_path": str(Path(model_path).resolve()),
        "episodes_evaluated": n,
        "average_reward": round(avg_reward, 4),
        "action_accuracy": round(accuracy, 4),
        "action_breakdown": action_breakdown,
        "policy_action_reward_summary": policy_rewards_summary,
        "replay_buffer_statistics": buffer.reward_statistics(),
    }

    return report


def main() -> int:
    args = parse_args()
    report = evaluate(args)

    print("\n" + "=" * 60)
    print("  Project Aegis — RL Policy Evaluation Report")
    print("=" * 60)
    print(f"  Episodes evaluated : {report['episodes_evaluated']}")
    print(f"  Average reward     : {report['average_reward']:.4f}")
    print(f"  Action accuracy    : {report['action_accuracy'] * 100:.1f}%")
    print("-" * 60)
    print("  Action agreement breakdown:")
    for action, stats in report["action_breakdown"].items():
        print(
            f"    {action:<25} "
            f"occurrences={stats['historical_occurrences']:>4} "
            f"agreement={stats['agreement_rate'] * 100:.1f}%"
        )
    print("=" * 60 + "\n")

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        logger.info("Evaluation report written to %s", out_path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
