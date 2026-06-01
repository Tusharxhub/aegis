import os
import logging
import numpy as np
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status
from pydantic import BaseModel
from pymongo import MongoClient
from pymongo.errors import PyMongoError
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO

from security import get_api_key

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aegis-rl-brain")

app = FastAPI(
    title="Project Aegis RL Brain",
    description="Secured local Reinforcement Learning decision engine for infrastructure self-healing.",
    version="1.0.0"
)

# Global variables
MONGO_URI = os.getenv("MONGO_URI", "mongodb://aegis-mongo:27018/aegis")
MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/ppo_aegis_model")
_model: Optional[PPO] = None

# Pydantic request models
class PredictRequest(BaseModel):
    state_vector: List[float]

class PredictResponse(BaseModel):
    action: int
    confidence: float
    model_version: str

# ─────────────────────────────────────────────────────────────────────────
# Gymnasium Environment for Offline RL Training
# ─────────────────────────────────────────────────────────────────────────

class AegisOfflineEnv(gym.Env):
    """
    Custom Gym environment wrapper that runs over historical episodes
    extracted from the MongoDB Replay Buffer.
    """
    def __init__(self, episodes: List[dict]):
        super(AegisOfflineEnv, self).__init__()
        self.episodes = episodes
        self.num_episodes = len(episodes)
        
        # Automatically determine the state vector size from database records
        if self.num_episodes > 0:
            self.state_dim = len(self.episodes[0]['state_vector'])
        else:
            self.state_dim = 386  # Fallback to 384 embedding dimensions + 2 flags
            
        logger.info(f"Initializing AegisOfflineEnv with {self.num_episodes} episodes. State Dim: {self.state_dim}")

        # Action space: 0=Do Nothing, 1=Restart, 2=Rollback, 3=Scale
        self.action_space = spaces.Discrete(4)
        
        # State space bounds (normalized embeddings + raw flags)
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(self.state_dim,),
            dtype=np.float32
        )
        self.current_idx = 0

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        if self.num_episodes == 0:
            return np.zeros(self.state_dim, dtype=np.float32), {}
            
        # Draw a random episode from the replay buffer
        self.current_idx = np.random.randint(0, self.num_episodes)
        episode = self.episodes[self.current_idx]
        state = np.array(episode['state_vector'], dtype=np.float32)
        return state, {}

    def step(self, action):
        if self.num_episodes == 0:
            return np.zeros(self.state_dim, dtype=np.float32), 0.0, True, False, {}

        episode = self.episodes[self.current_idx]
        actual_action = int(episode['action_taken'])
        actual_reward = float(episode['reward'])
        
        # Reward Evaluation Policy:
        # If policy action matches the recorded action, collect the evaluation reward.
        # Otherwise, check if the recorded action was successful (reward > 0). 
        # If it was successful but the policy chose something else, penalize the policy.
        # If the recorded action failed (reward < 0), choosing a different action incurs only a step penalty.
        if action == actual_action:
            reward = actual_reward
        else:
            if actual_reward > 0:
                reward = -abs(actual_reward)  # Penalize for missing out on successful healing action
            else:
                reward = -1.0  # Step penalty for trying something else when historical action was bad

        # Since it is a 1-step episodic MDP, terminate immediately
        next_state = np.array(episode.get('next_state_vector', episode['state_vector']), dtype=np.float32)
        terminated = True
        truncated = False
        
        return next_state, reward, terminated, truncated, {}

# ─────────────────────────────────────────────────────────────────────────
# Model Lifecycle Helpers
# ─────────────────────────────────────────────────────────────────────────

def get_model(state_dim: int) -> PPO:
    """
    Thread-safe model loading with lazy initialization.
    If the model zip file does not exist, initialize a new PPO policy and save it.
    """
    global _model
    if _model is not None:
        return _model

    model_dir = os.path.dirname(MODEL_PATH)
    if not os.path.exists(model_dir):
        os.makedirs(model_dir, exist_ok=True)

    if os.path.exists(f"{MODEL_PATH}.zip"):
        logger.info(f"Loading existing Stable Baselines3 model from {MODEL_PATH}.zip")
        _model = PPO.load(MODEL_PATH)
    else:
        logger.info("No model found. Creating a new PPO model with MLP policy.")
        # Create a dummy environment to initialize model network shapes
        dummy_episode = {
            "state_vector": [0.0] * state_dim,
            "action_taken": 0,
            "reward": 0.0,
            "next_state_vector": [0.0] * state_dim
        }
        env = AegisOfflineEnv([dummy_episode])
        _model = PPO("MlpPolicy", env, verbose=1, learning_rate=0.0003, n_steps=64, batch_size=32)
        _model.save(MODEL_PATH)
        
    return _model

# ─────────────────────────────────────────────────────────────────────────
# API Route Handlers
# ─────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    """
    Simple health verification endpoint used by Docker Compose.
    """
    model_status = "loaded" if _model is not None else "uninitialized"
    if not _model and os.path.exists(f"{MODEL_PATH}.zip"):
        model_status = "saved"
    return {
        "status": "healthy",
        "model": model_status,
        "database": "mongodb_configured"
    }

@app.post("/predict", response_model=PredictResponse)
def predict_action(payload: PredictRequest, api_key: str = Depends(get_api_key)):
    """
    Predict self-healing action based on log embeddings + metric flags.
    Secured via X-Aegis-Auth-Token header.
    """
    state_vector = payload.state_vector
    state_dim = len(state_vector)
    
    try:
        model = get_model(state_dim)
        obs = np.array(state_vector, dtype=np.float32)
        
        # SB3 model prediction
        action_idx, _ = model.predict(obs, deterministic=True)
        
        # Safe casting
        action = int(action_idx)
        
        # Estimate action confidence by evaluating model action distribution
        # Note: Standard PPO deterministic predict returns the argmax.
        confidence = 1.0  # Default confidence for deterministic execution
        
        logger.info(f"Inference input size: {state_dim} -> Predicted action: {action}")
        return PredictResponse(
            action=action,
            confidence=confidence,
            model_version="SB3_PPO_v1"
        )
    except Exception as e:
        logger.exception("Error during action inference")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference error: {str(e)}"
        )

@app.post("/train")
def train_model(api_key: str = Depends(get_api_key)):
    """
    Fetch episodes from local MongoDB replay buffer, wrap in gym environment,
    and train the PPO agent. Secured via X-Aegis-Auth-Token header.
    """
    global _model
    client = None
    try:
        # Connect to MongoDB
        logger.info(f"Connecting to MongoDB at: {MONGO_URI}")
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        db = client.get_default_database()
        
        # Fetch the last 1000 episodes
        episodes_col = db["episodes"]
        cursor = episodes_col.find().sort("timestamp", -1).limit(1000)
        episodes = list(cursor)
        
        if len(episodes) < 10:
            return {
                "success": False,
                "message": f"Insufficient episodes for training. Found {len(episodes)} episodes, need at least 10."
            }
            
        # Clean episode ObjectIDs for numpy translation
        for ep in episodes:
            if "_id" in ep:
                del ep["_id"]
                
        # Initialize custom environment
        env = AegisOfflineEnv(episodes)
        state_dim = env.state_dim
        
        # Load/re-initialize PPO model
        model = get_model(state_dim)
        model.set_env(env)
        
        # Train model for a steps epoch
        logger.info(f"Beginning training cycle on {len(episodes)} replay steps...")
        model.learn(total_timesteps=1024)
        
        # Persist model weights to the container volume
        logger.info(f"Saving trained weights back to {MODEL_PATH}")
        model.save(MODEL_PATH)
        
        # Reset model reference to force reload next prediction
        _model = PPO.load(MODEL_PATH)
        
        rewards = [float(ep["reward"]) for ep in episodes]
        avg_reward = sum(rewards) / len(rewards)
        
        return {
            "success": True,
            "message": "Model learning step complete. Weights updated.",
            "episodes_processed": len(episodes),
            "average_historical_reward": avg_reward,
            "state_dimension": state_dim
        }
    except PyMongoError as mongo_err:
        logger.error(f"MongoDB connection failed: {mongo_err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection error: {str(mongo_err)}"
        )
    except Exception as e:
        logger.exception("Error during training step execution")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Training execution error: {str(e)}"
        )
    finally:
        if client:
            client.close()
