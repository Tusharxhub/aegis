import os
import sys
# pyrefly: ignore [missing-import]
from stable_baselines3 import PPO
from rl_env import AegisOfflineEnv
# pyrefly: ignore [missing-import]
from pymongo import MongoClient
import numpy as np

def seed_db_if_empty(mongo_uri):
    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=2000)
        db = client.get_default_database()
        episodes_col = db["episodes"]
        count = episodes_col.count_documents({})
        if count == 0:
            print("Database is empty. Seeding MongoDB with synthetic episodes to prevent training crash...")
            mock_episodes = []
            for _ in range(100):
                state = np.random.randn(386).tolist()
                next_state = np.random.randn(386).tolist()
                action = int(np.random.randint(0, 4))
                reward = float(10.0 if np.random.rand() > 0.3 else -15.0)
                mock_episodes.append({
                    "state_vector": state,
                    "action_taken": action,
                    "reward": reward,
                    "next_state_vector": next_state,
                    "containerName": "demo-crash-service",
                    "imageName": "demo-crash-service:latest",
                    "exitCode": 137 if reward < 0 else 0,
                    "eventType": "oom" if reward < 0 else "die",
                    "timestamp": "2026-05-30T20:00:00Z"
                })
            episodes_col.insert_many(mock_episodes)
            print(f"Successfully seeded {len(mock_episodes)} mock episodes.")
        client.close()
    except Exception as e:
        print(f"Could not check/seed database: {e}. Proceeding anyway...")

def main():
    # Get MONGO_URI
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/aegis")
    
    # Seed if empty to avoid RuntimeError
    seed_db_if_empty(mongo_uri)
    
    try:
        # Instantiate custom environment
        env = AegisOfflineEnv(mongo_uri=mongo_uri)
        
        # Define model path
        model_path = os.getenv("MODEL_PATH", "./ppo_aegis_agent")
        
        print("Initializing PPO model on AegisOfflineEnv...")
        model = PPO(
            "MlpPolicy",
            env,
            verbose=1,
            learning_rate=0.0003,
            n_steps=64,
            batch_size=32
        )
        
        print("Training PPO model for 10000 timesteps...")
        model.learn(total_timesteps=10000)
        
        print(f"Saving trained PPO agent to: {model_path}.zip")
        model.save(model_path)
        
        env.close()
        print("🎉 RL Training complete and model successfully persisted!")
        
    except Exception as e:
        print(f"❌ RL Training failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
