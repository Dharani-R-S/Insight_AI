"""
SQLAlchemy User Model Definition.
"""

from datetime import datetime
import uuid
from sqlalchemy import Boolean, Column, DateTime, String
from app.db.session import Base


class User(Base):
    """User entity for authentication and system permissions."""

    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
