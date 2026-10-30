"""
Script to bundle python-service into a standalone executable using PyInstaller.
Uses --onedir for instant startup time and seamless Electron bundling.
"""
import os
import sys
import shutil
from pathlib import Path
import PyInstaller.__main__

CURRENT_DIR = Path(__file__).parent.resolve()
DIST_DIR = CURRENT_DIR / "dist" / "python-service"
BUILD_DIR = CURRENT_DIR / "build"

print(f"Building Python Service standalone executable in: {CURRENT_DIR}")

# Clean previous builds
if DIST_DIR.exists():
    shutil.rmtree(DIST_DIR, ignore_errors=True)
if BUILD_DIR.exists():
    shutil.rmtree(BUILD_DIR, ignore_errors=True)

# PyInstaller arguments
args = [
    str(CURRENT_DIR / "main.py"),
    "--name=python-service",
    "--onedir",
    "--noconfirm",
    "--clean",
    f"--distpath={CURRENT_DIR / 'dist'}",
    f"--workpath={CURRENT_DIR / 'build'}",
    f"--add-data={CURRENT_DIR / 'services'}{os.pathsep}services",
    f"--add-data={CURRENT_DIR / 'app'}{os.pathsep}app",
    # Hidden imports
    "--hidden-import=uvicorn",
    "--hidden-import=uvicorn.logging",
    "--hidden-import=uvicorn.loops",
    "--hidden-import=uvicorn.loops.auto",
    "--hidden-import=uvicorn.protocols",
    "--hidden-import=uvicorn.protocols.http",
    "--hidden-import=uvicorn.protocols.http.auto",
    "--hidden-import=uvicorn.protocols.websockets",
    "--hidden-import=uvicorn.protocols.websockets.auto",
    "--hidden-import=uvicorn.lifespan",
    "--hidden-import=uvicorn.lifespan.on",
    "--hidden-import=fastapi",
    "--hidden-import=pydantic",
    "--hidden-import=pandas",
    "--hidden-import=sklearn",
    "--hidden-import=plotly",
    "--hidden-import=groq",
    "--hidden-import=app",
    "--hidden-import=app.main",
    "--hidden-import=app.core",
    "--hidden-import=app.core.config",
    "--hidden-import=app.db",
    "--hidden-import=app.db.session",
    "--hidden-import=app.api",
    "--hidden-import=app.api.router",
    "--hidden-import=app.api.routes",
    "--hidden-import=app.api.routes.analytics",
    "--hidden-import=app.api.routes.transform",
    "--hidden-import=app.api.routes.visualization",
    "--hidden-import=app.api.routes.intelligence",
    "--hidden-import=app.api.legacy",
    "--hidden-import=app.services.duckdb_engine",
    "--hidden-import=app.services.sql_validator",
    "--hidden-import=app.services.transformation_compiler",
    "--hidden-import=app.services.visualization_engine",
    "--hidden-import=app.services.diagnostic_engine",
    "--hidden-import=app.services.recommendation_engine",
    "--hidden-import=app.services.llm_service",
    "--hidden-import=pydantic_settings",
    "--hidden-import=duckdb",
    "--hidden-import=sqlglot",
    "--hidden-import=sqlglot.dialects",
    "--hidden-import=pyarrow",
    "--hidden-import=sqlalchemy",
    "--hidden-import=passlib",
    "--hidden-import=passlib.handlers.bcrypt",
    "--hidden-import=bcrypt",
    "--hidden-import=jwt",
]

# Do not bundle .env into the executable; load configuration from the environment/userData at runtime.
print("Running PyInstaller with arguments:", " ".join(args))
PyInstaller.__main__.run(args)

exe_path = CURRENT_DIR / "dist" / "python-service" / "python-service.exe"
if exe_path.exists():
    print(f"\nSUCCESS! Python service compiled successfully at:\n{exe_path}\n")
else:
    print(f"\nWARNING: Could not locate expected binary at {exe_path}")
