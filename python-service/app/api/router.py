"""
API Version 1 Router Aggregator.
Wires together Auth and Dataset sub-routers under /api/v1 prefix.
"""

from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.datasets import router as datasets_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(datasets_router)
