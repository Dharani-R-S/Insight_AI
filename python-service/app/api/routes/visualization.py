"""
Auto-Visualization & Semantic Layer API Router for InsightAI.
Exposes POST /api/visualize/auto endpoint to generate structured JSON Recharts specifications.
"""

import logging
from pathlib import Path
import time
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import settings
from app.core.deps import get_optional_current_user
from app.models.user import User
from app.models.visualization import (
    AutoVisualizeRequest,
    AutoVisualizeResponse,
    ChartSpec,
    MetricStore,
    SemanticMetric,
)
from app.services.duckdb_engine import DuckDBEngine
from app.services.visualization_engine import VisualizationEngine

logger = logging.getLogger("insightai.visualization_router")

router = APIRouter(tags=["Semantic Layer & Auto-Visualization Recommender"])


def resolve_parquet_dataset(
    parquet_path: Optional[str] = None,
    dataset_id: Optional[str] = None,
) -> Optional[Path]:
    """Resolve and validate dataset parquet path."""
    if parquet_path:
        p = Path(parquet_path)
        if p.exists():
            return p
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parquet dataset not found at path: {parquet_path}",
        )

    if dataset_id:
        p = settings.PARQUET_DIR / f"{dataset_id}.parquet"
        if p.exists():
            return p
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset with ID '{dataset_id}' not found in storage.",
        )

    # Fallback to the latest modified Parquet dataset in storage directory
    parquet_files = list(settings.PARQUET_DIR.glob("*.parquet"))
    if parquet_files:
        parquet_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        return parquet_files[0]

    return None


@router.post(
    "/api/visualize/auto",
    response_model=AutoVisualizeResponse,
    status_code=status.HTTP_200_OK,
)
@router.post(
    "/visualize/auto",
    response_model=AutoVisualizeResponse,
    status_code=status.HTTP_200_OK,
)
async def auto_visualize_dataset(
    request: AutoVisualizeRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    POST /api/visualize/auto
    
    Inspects tabular query results or Parquet datasets, infers semantic metrics,
    applies heuristic rule evaluation, and returns the top recommended Recharts JSON specifications.
    Zero images or HTML are generated; strictly structural JSON with dark-mode neon theme styling.
    """
    start_time = time.perf_counter()

    rows: List[dict] = []
    columns: List[str] = []
    total_rows = 0
    resolved_dataset_id = request.dataset_id

    # 1. Fetch data from direct payload or Parquet / SQL execution
    if request.data:
        rows = request.data
        columns = request.columns or (list(rows[0].keys()) if rows else [])
        total_rows = len(rows)
    else:
        resolved_path = resolve_parquet_dataset(
            parquet_path=request.parquet_path,
            dataset_id=request.dataset_id,
        )

        if not resolved_path:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No dataset available. Provide data directly, or provide a valid dataset_id / parquet_path.",
            )

        resolved_dataset_id = resolved_dataset_id or resolved_path.stem

        if request.sql_query:
            # Execute custom query against Parquet dataset
            query_res = await DuckDBEngine.execute_query(
                sql_query=request.sql_query,
                parquet_path=resolved_path,
                table_name="dataset",
                limit=1000,
            )
            rows = query_res.rows
            columns = query_res.columns
            total_rows = query_res.row_count
        else:
            # Query sample dataset directly
            query_res = await DuckDBEngine.execute_query(
                sql_query="SELECT * FROM dataset LIMIT 1000",
                parquet_path=resolved_path,
                table_name="dataset",
                limit=1000,
            )
            rows = query_res.rows
            columns = query_res.columns
            total_rows = query_res.row_count

    if not rows:
        return AutoVisualizeResponse(
            dataset_id=resolved_dataset_id,
            total_rows=0,
            total_columns=len(columns),
            recommendations=[],
            detected_metrics=[],
            execution_time_ms=0.0,
        )

    # 2. Run Heuristic Rule Engine & Semantic Metric Store
    recommendations: List[ChartSpec] = VisualizationEngine.recommend_visualizations(
        rows=rows,
        columns=columns,
        metric_overrides=request.metric_overrides,
        max_recommendations=request.max_recommendations or 3,
    )

    # 3. Detect and collect semantic metrics
    profiles = VisualizationEngine.profile_columns(rows, columns=columns)
    detected_metrics: List[SemanticMetric] = [
        MetricStore.infer_semantic_metric(p.name, p.sample_values)
        for p in profiles.values()
        if p.is_numeric
    ]

    elapsed_ms = (time.perf_counter() - start_time) * 1000.0

    return AutoVisualizeResponse(
        dataset_id=resolved_dataset_id,
        total_rows=total_rows,
        total_columns=len(columns),
        recommendations=recommendations,
        detected_metrics=detected_metrics,
        execution_time_ms=round(elapsed_ms, 2),
    )
