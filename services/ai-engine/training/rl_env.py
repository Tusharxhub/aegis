import os
import gymnasium as gym
from gymnasium.spaces import Box, Discrete
import numpy as np
from pymongo import MongoClient

class AegisOfflineEnv(gym.Env):
    """
    Offline Reinforcement Learning Environment for Aegis.
    Learns from historical incident executions stored in MongoDB.
    """
    def __init__(self):
        super(AegisOfflineEnv, self).__init__()
        
        # Connect to MongoDB
        mongo_uri = os.environ.get("MONGO_URI", "mongodb://aegis-mongo:27017/aegis")
        self.client = MongoClient(mongo_uri)
        
        # Fallback to local if aegis-mongo fails to resolve in local test, but code expects aegis-mongo
        
        self.db = self.client.get_default_database(default="aegis")
        self.collection = self.db['episodes']
        
        # Fetch last 1000 episodes
        try:
            episodes = list(self.collection.find().sort('_id', -1).limit(1000))
            self.episodes = episodes[::-1] # Chronological order
        except Exception as e:
            print(f"Warning: Failed to fetch from MongoDB ({e}). Falling back to empty episodes.")
            self.episodes = []
            
        # Observation space: 384-dim FAISS embedding + OOM flag + Exit Code = 386
        self.observation_space = Box(low=-np.inf, high=np.inf, shape=(386,), dtype=np.float32)
        
        # Action Space: Discrete(4)
        # 0: DO_NOTHING, 1: RESTART, 2: ROLLBACK, 3: SCALE
        self.action_space = Discrete(4)
        
        self.current_step_idx = 0
        
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step_idx = 0
        return self._get_observation(), {}
        
    def _get_observation(self):
        if len(self.episodes) == 0:
            # Synthetic dummy data
            return np.zeros(386, dtype=np.float32)
            
        if self.current_step_idx >= len(self.episodes):
            idx = len(self.episodes) - 1
        else:
            idx = self.current_step_idx
            
        episode = self.episodes[idx]
        state = episode.get('state')
        
        if state is None or len(state) != 386:
            state = np.zeros(386, dtype=np.float32)
            
        return np.array(state, dtype=np.float32)
        
    def step(self, action):
        if len(self.episodes) == 0:
            # Dummy step
            return np.zeros(386, dtype=np.float32), 0.0, True, False, {}
            
        episode = self.episodes[self.current_step_idx]
        historical_action = episode.get('action', 0)
        stored_reward = episode.get('reward', 0.0)
        
        # Predict the action taken in the historical record
        if action == historical_action:
            reward = float(stored_reward)
        else:
            reward = -1.0
            
        self.current_step_idx += 1
        
        terminated = self.current_step_idx >= len(self.episodes)
        truncated = False
        
        next_state = self._get_observation() if not terminated else np.zeros(386, dtype=np.float32)
        
        return next_state, reward, terminated, truncated, {}
