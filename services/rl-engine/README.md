# Project Aegis — RL Engine (Offline Research Only)

## Scope

This module is an **offline reinforcement learning research layer**. It reads historical incident episodes from MongoDB, trains PPO policies, evaluates them, and generates research metrics.

## What It Does

- Load historical episodes from MongoDB replay buffer
- Train PPO agents using Stable Baselines3
- Evaluate trained policies against the replay buffer
- Generate performance metrics and reports
- Export candidate policy model artifacts

## What It Must NOT Do

- Restart containers
- Stop containers
- Access the Docker socket
- Bypass the NestJS safety policy engine
- Execute any live infrastructure actions

The RL engine is strictly offline. All live remediation is handled by the NestJS orchestrator through the deterministic safety policy.

## Usage

```bash
# Install dependencies
pip install -r requirements.txt

# Train a PPO agent
python train_agent.py --steps 50000

# Evaluate a trained policy
python evaluation.py --model ./models/ppo_aegis_v20260601.zip
```

## Architecture

```
MongoDB historical incidents
        ↓
Replay dataset generation
        ↓
Offline RL training and evaluation
        ↓
Research metrics and candidate policies
```
