"""
Base Configuration Module for InsightAI Backend.
Uses Pydantic BaseSettings for type-safe environment variable management.
"""

import os
from pathlib import Path
from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application Settings managed by environment variables."""

    # Project Information
    PROJECT_NAME: str = "InsightAI Analytics Engine"
    API_V1_STR: str = "/api/v1"
    VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Security & JWT Configuration
    SECRET_KEY: str = "insightai_super_secret_jwt_key_change_in_production_2026_key!"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # CORS Settings
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5000",
    ]

    # File Storage & Ingestion Settings
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    STORAGE_DIR: Path = BASE_DIR / "storage"
    UPLOAD_DIR: Path = STORAGE_DIR / "uploads"
    PARQUET_DIR: Path = STORAGE_DIR / "parquet"
    MAX_UPLOAD_SIZE_MB: int = 500

    # Metadata Database (Stateless User & Auth metadata)
    DATABASE_URL: str = f"sqlite:///{BASE_DIR}/insight_ai_metadata.db"

    # DuckDB Concurrency & Execution Limits
    DUCKDB_MEMORY_LIMIT: str = "4GB"
    DUCKDB_THREADS: int = 4

    # Groq API Configuration
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    def init_directories(self) -> None:
        """Create necessary data directories if they do not exist."""
        self.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        self.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        self.PARQUET_DIR.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.init_directories()
