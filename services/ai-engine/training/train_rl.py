import os
from stable_baselines3 import PPO
from rl_env import AegisOfflineEnv

def main():
    print("Initializing Aegis Offline Environment...")
    env = AegisOfflineEnv()
    
    print("Initializing Stable Baselines3 PPO Model...")
    model = PPO("MlpPolicy", env, verbose=1)
    
    print("Starting training loop...")
    model.learn(total_timesteps=10000)
    
    model_path = "ppo_aegis_agent.zip"
    model.save(model_path)
    print(f"Training complete. Model saved to {model_path}")

if __name__ == "__main__":
    main()
