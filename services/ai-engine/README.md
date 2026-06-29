# Aegis AI Engine

Local Python FastAPI service for incident classification, diagnosis, and offline RL training.

## Requirements

- **Python 3.12** (recommended)
- Python 3.14 is NOT supported — ML dependencies (faiss-cpu, numpy, scikit-learn) do not have compatible wheels yet.

## Setup

```bash
cd services/ai-engine

python3.12 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt
```

## Running

```bash
python main.py
```

The server starts on `http://localhost:8000`.

## Testing

```bash
python -m pip install pytest
python -m pytest
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/diagnose` | Classify incident from logs |
| POST | `/train` | Retrain classifier |
