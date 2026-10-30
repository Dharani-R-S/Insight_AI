"""
InsightAI Microservice Root Launcher.
Exposes the Phase 1-5 enterprise FastAPI application.
"""

import os
import sys
from app.main import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PYTHON_PORT") or os.environ.get("PORT") or 8000)
    is_frozen = getattr(sys, "frozen", False)
    
    if is_frozen:
        uvicorn.run(app, host="0.0.0.0", port=port)
    else:
        # Avoid reload=True when spawned by parent processes (Electron/Express) to prevent orphan child processes
        should_reload = os.environ.get("UVICORN_RELOAD", "false").lower() in ("true", "1")
        if should_reload:
            uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
        else:
            uvicorn.run(app, host="0.0.0.0", port=port)

