#!/usr/bin/env fish
# ─── Insight AI — Start All Services ───────────────────────────────────────
# Run from the repo root: fish start.fish

set REPO (dirname (realpath (status filename)))

# Use model/.venv if it exists, otherwise fall back to the sql-finetune venv
if test -f "$REPO/model/.venv/bin/uvicorn"
    set VENV "$REPO/model/.venv"
else if test -f "$HOME/Downloads/Project/Insight AI/sql-finetune/.venv/bin/uvicorn"
    set VENV "$HOME/Downloads/Project/Insight AI/sql-finetune/.venv"
else
    echo "❌  No Python venv found."
    echo "    Create one with:"
    echo "    cd model && python -m venv .venv && source .venv/bin/activate.fish"
    echo "    pip install torch transformers peft bitsandbytes accelerate pandas plotly kaleido scikit-learn uvicorn fastapi python-dotenv"
    exit 1
end

echo ""
echo "🚀  Starting Insight AI..."
echo "    Using venv: $VENV"
echo ""

# ── 1. Python analytics service (port 8000) ─────────────────────────────────
echo "▶  Python service   → http://localhost:8000"
fish -c "
    cd '$REPO/python-service'
    '$VENV/bin/uvicorn' main:app --host 0.0.0.0 --port 8000
" &

sleep 1

# ── 2. Node gateway + frontend (port 5000) ───────────────────────────────────
echo "▶  Node server      → http://localhost:5000"
fish -c "
    cd '$REPO/server'
    node index.js
" &

echo ""
echo "✅  Both services running."
echo "    Open → http://localhost:5000"
echo ""
echo "    Press Ctrl+C to stop everything."
echo ""

wait
