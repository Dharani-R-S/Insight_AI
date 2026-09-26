"""
InsightAI Backend — Enterprise FastAPI Main Entrypoint.
Wires together CORS, Auth dependencies, DuckDB OLAP Router, Database Session lifecycle, and global error handlers.
"""

from contextlib import asynccontextmanager
import logging
import time
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.transform import router as transform_router
from app.api.routes.visualization import router as visualization_router
from app.api.routes.intelligence import router as intelligence_router
from app.api.legacy import router as legacy_router
from app.core.config import settings
from app.db.session import Base, engine


# Configure Structured Logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("insightai.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application Lifespan Event Handler. Runs database migrations/initialization on startup."""
    logger.info("Initializing InsightAI Metadata Database tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("InsightAI Backend Service Startup Complete.")
    yield
    logger.info("InsightAI Backend Service Shutdown.")


# Initialize FastAPI Application
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Enterprise-grade Business Intelligence & Stateless DuckDB Analytics Engine",
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Middleware to measure HTTP request execution time."""
    start_time = time.perf_counter()
    response = await call_next(request)
    process_time_ms = (time.perf_counter() - start_time) * 1000.0
    response.headers["X-Process-Time-MS"] = f"{process_time_ms:.2f}"
    return response


# Global Exception Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Fallback handler for unhandled application exceptions."""
    logger.error(f"Unhandled error processing {request.method} {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal server error occurred.", "error": str(exc)},
    )


# Register Routers
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(analytics_router)
app.include_router(transform_router)
app.include_router(visualization_router)
app.include_router(intelligence_router)
app.include_router(legacy_router)




@app.get("/health", tags=["Health"])
def health_check():
    """Service health probe endpoint."""
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "engine": "DuckDB OLAP Vectorized Engine",
    }


@app.get("/", tags=["Health"])
def root():
    """Service root endpoint."""
    return {
        "message": f"Welcome to {settings.PROJECT_NAME}",
        "docs": f"{settings.API_V1_STR}/docs",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
