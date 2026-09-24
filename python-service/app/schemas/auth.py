"""
Pydantic Schemas for Authentication and User Data.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    """Base schema for user identity attributes."""

    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    """Schema for user registration requests."""

    password: str = Field(..., min_length=6, description="User password (min 6 characters)")


class UserLogin(BaseModel):
    """Schema for user login authentication requests."""

    email: EmailStr
    password: str


class UserResponse(UserBase):
    """Public user response schema."""

    id: str
    is_active: bool = True
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    """JWT Token response schema."""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenPayload(BaseModel):
    """JWT Token internal payload representation."""

    sub: Optional[str] = None
    exp: Optional[int] = None
