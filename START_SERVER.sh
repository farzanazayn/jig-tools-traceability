#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "================================================"
echo " Jig & Tools Maintenance Traceability System"
echo " Starting backend server..."
echo "================================================"
echo

if [ ! -d "venv" ]; then
  echo "No venv found — creating one..."
  python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r backend/requirements.txt

if [ ! -f ".env" ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill in DATABASE_URL first."
  exit 1
fi

python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8101 --reload
