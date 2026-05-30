FROM python:3.10-slim

WORKDIR /app

# Install system dependencies for sentence-transformers and FAISS
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy python dependency list
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Create directories for classification model and FAISS vector index storage
RUN mkdir -p /app/models /app/vectorstore/storage

# Copy service codebase
COPY . .

# Expose ports
EXPOSE 8000

# Start command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
