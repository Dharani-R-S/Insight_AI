"""
API Version 1 Router Aggregator.
Wires together Auth and Dataset sub-routers under /api/v1 prefix.
"""

from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.datasets import router as datasets_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.transform import router as transform_router
from app.api.routes.visualization import router as visualization_router
from app.api.routes.intelligence import router as intelligence_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(datasets_router)
api_router.include_router(analytics_router)
api_router.include_router(transform_router)
api_router.include_router(visualization_router)
api_router.include_router(intelligence_router)


