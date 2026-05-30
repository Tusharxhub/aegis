import os
from fastapi import Security, HTTPException, status
from fastapi.security.api_key import APIKeyHeader

API_KEY_NAME = "X-Aegis-Auth-Token"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=True)

def get_api_key(api_key: str = Security(api_key_header)):
    # Retrieve the internal key configured in the environment
    expected_key = os.getenv("AEGIS_INTERNAL_KEY", "your_secure_dev_key")
    
    if api_key != expected_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid or missing Aegis security token"
        )
    return api_key
