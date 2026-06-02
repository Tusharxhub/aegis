import os
import numpy as np
import gymnasium as gym
from gymnasium import spaces
from pymongo import MongoClient

class AegisOfflineEnv(gym.Env):
    """
    Custom Gymnasium environment wrapper that connects directly to the local MongoDB
    instance to load historical episodes for offline Reinforcement Learning.
    """
    def __init__(self, mongo_uri=None):
        super(AegisOfflineEnv, self).__init__()
        
        # Read MONGO_URI from env or use fallback
        if mongo_uri is None:
            mongo_uri = os.getenv("MONGO_URI", "mongodb://aegis-mongo:27017/aegis")
        
        print(f"Connecting to MongoDB at: {mongo_uri}")
        self.client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        
        try:
            self.db = self.client.get_default_database()
            self.episodes_col = self.db["episodes"]
            
            # Fetch all episodes
            self.episodes = list(self.episodes_col.find().sort("timestamp", -1))
            self.num_episodes = len(self.episodes)
        except Exception as e:
            self.client.close()
            raise RuntimeError(f"Database connection error: {str(e)}")
        
        # CRITICAL CONSTRAINT: Handle empty collection
        if self.num_episodes == 0:
            self.client.close()
            raise RuntimeError("No training episodes found in MongoDB buffer")
        
        print(f"Loaded {self.num_episodes} training episodes from MongoDB.")
        
        # Action space: 0=DO_NOTHING, 1=RESTART, 2=ROLLBACK, 3=SCALE
        self.action_space = spaces.Discrete(4)
        
        # Observation Space: 386 dimensions
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(386,),
            dtype=np.float32
        )
        
        self.current_idx = 0

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        # Draw a random episode from the replay buffer
        self.current_idx = np.random.randint(0, self.num_episodes)
        episode = self.episodes[self.current_idx]
        
        # Extract state vector (must be 386 elements)
        state = np.array(episode['state_vector'], dtype=np.float32)
        return state, {}

    def step(self, action):
        episode = self.episodes[self.current_idx]
        actual_action = int(episode['action_taken'])
        actual_reward = float(episode['reward'])
        
        # Compare policy action against actual action taken
        if action == actual_action:
            reward = actual_reward
        else:
            if actual_reward > 0:
                reward = -abs(actual_reward)  # Penalize for missing out on successful healing action
            else:
                reward = -1.0  # Step penalty for trying something else when historical action failed
        
        next_state = np.array(episode.get('next_state_vector', episode['state_vector']), dtype=np.float32)
        terminated = True
        truncated = False
        
        return next_state, reward, terminated, truncated, {}

    def close(self):
        if hasattr(self, 'client') and self.client:
            self.client.close()
