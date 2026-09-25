"""
Transformation Pipeline API Router for InsightAI Vectorized Engine.
Exposes POST /api/transform/preview and POST /api/transform/commit endpoints
for compiling and executing CTE-chained DuckDB Power Query transformations.
"""

import logging
from pathlib import Path
import time
from typing import Optional, Tuple
import uuid
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import settings
from app.core.deps import get_optional_current_user
from app.models.transform import (
    CommitRequest,
    CommitResponse,
    PipelineRequest,
    PreviewResponse,
)
from app.models.user import User
from app.services.duckdb_engine import DuckDBEngine
from app.services.transformation_compiler import DuckDBCompiler

logger = logging.getLogger("insightai.transform_router")

router = APIRouter(tags=["Vectorized Data Transformation Engine"])


def resolve_parquet_path(
    parquet_path: Optional[str] = None,
    dataset_id: Optional[str] = None,
) -> Tuple[Path, str]:
    """
    Resolve and validate the primary Parquet dataset file path.
    """

    if parquet_path:
        path = Path(parquet_path)
        if path.exists():
            return path, dataset_id or path.stem
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parquet file not found at path: {parquet_path}",
        )

    if dataset_id:
        path = settings.PARQUET_DIR / f"{dataset_id}.parquet"
        if path.exists():
            return path, dataset_id
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset '{dataset_id}' not found in Parquet storage.",
        )

    # Fallback to the latest modified Parquet dataset in storage directory
    parquet_files = list(settings.PARQUET_DIR.glob("*.parquet"))
    if parquet_files:
        parquet_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        latest = parquet_files[0]
        return latest, latest.stem

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No dataset available. Please upload a dataset or provide parquet_path or dataset_id.",
    )


@router.post(

    "/api/transform/preview",
    response_model=PreviewResponse,
    status_code=status.HTTP_200_OK,
)
@router.post(
    "/transform/preview",
    response_model=PreviewResponse,
    status_code=status.HTTP_200_OK,
)
async def preview_transformation(
    request: PipelineRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Preview a chained transformation pipeline on a dataset.
    Compiles the JSON steps into DuckDB CTEs, executes statelessly with a row limit,
    and returns preview rows and column metadata.
    """
    start_time = time.perf_counter()

    resolved_path, dataset_id = resolve_parquet_path(
        parquet_path=request.parquet_path,
        dataset_id=request.dataset_id,
    )

    # Clone request with resolved parquet path for deterministic compilation
    compiled_request = PipelineRequest(
        parquet_path=str(resolved_path),
        dataset_id=dataset_id,
        source_table=request.source_table,
        steps=request.steps,
        limit=request.limit or 100,
    )

    try:
        # 1. Compile JSON pipeline steps into CTE SQL
        compiled_sql = DuckDBCompiler.compile_pipeline(
            pipeline=compiled_request,
            limit=request.limit or 100,
        )

        # 2. Execute compiled SQL statelessly in DuckDB
        query_result = await DuckDBEngine.execute_query(
            sql_query=compiled_sql,
            parquet_path=resolved_path,
            table_name=request.source_table or "dataset",
            limit=request.limit or 100,
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        return PreviewResponse(
            columns=query_result.columns,
            column_types=query_result.column_types,
            rows=query_result.rows,
            row_count=query_result.row_count,
            total_steps=len(request.steps),
            compiled_sql=compiled_sql,
            execution_time_ms=round(elapsed_ms, 2),
        )
    except ValueError as ve:
        logger.warning(f"Compilation or validation error: {ve}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transformation Error: {str(ve)}",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error executing transformation preview: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute transformation preview: {str(exc)}",
        )


@router.post(
    "/api/transform/commit",
    response_model=CommitResponse,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/transform/commit",
    response_model=CommitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def commit_transformation(
    request: CommitRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Persist and materialize a transformation pipeline into a new optimized Parquet dataset.
    Compiles unlimited chained CTE SQL and writes directly to disk without Pandas overhead.
    """
    start_time = time.perf_counter()

    resolved_path, original_dataset_id = resolve_parquet_path(
        parquet_path=request.parquet_path,
        dataset_id=request.dataset_id,
    )

    new_dataset_id = request.target_dataset_id or str(uuid.uuid4())
    target_parquet_path = settings.PARQUET_DIR / f"{new_dataset_id}.parquet"
    dataset_name = request.target_dataset_name or f"Transformed Dataset ({new_dataset_id[:8]})"

    # Clone request for compilation without row limit
    pipeline_request = PipelineRequest(
        parquet_path=str(resolved_path),
        dataset_id=original_dataset_id,
        source_table=request.source_table,
        steps=request.steps,
        limit=None,
    )

    try:
        # 1. Compile full un-limited CTE SQL query
        compiled_sql = DuckDBCompiler.compile_pipeline(
            pipeline=pipeline_request,
            limit=None,
        )

        # 2. Materialize transformed dataset directly to new Parquet file
        materialized_info = await DuckDBEngine.materialize_query_to_parquet(
            sql_query=compiled_sql,
            output_parquet_path=target_parquet_path,
            parquet_path=resolved_path,
            table_name=request.source_table or "dataset",
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        return CommitResponse(
            dataset_id=new_dataset_id,
            dataset_name=dataset_name,
            parquet_path=str(target_parquet_path),
            total_rows=materialized_info["total_rows"],
            total_columns=materialized_info["total_columns"],
            columns=materialized_info["columns"],
            compiled_sql=compiled_sql,
            execution_time_ms=round(elapsed_ms, 2),
        )
    except ValueError as ve:
        logger.warning(f"Transformation commit validation error: {ve}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transformation Error: {str(ve)}",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error committing transformation pipeline: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to commit transformation: {str(exc)}",
        )


@router.post(
    "/api/transform/compile",
    status_code=status.HTTP_200_OK,
)
@router.post(
    "/transform/compile",
    status_code=status.HTTP_200_OK,
)
async def compile_transformation_sql(
    request: PipelineRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Compiles a transformation pipeline to SQL without executing it.
    Useful for inspecting the generated CTE query plan in the UI.
    """
    try:
        compiled_sql = DuckDBCompiler.compile_pipeline(
            pipeline=request,
            limit=request.limit,
        )
        return {
            "compiled_sql": compiled_sql,
            "total_steps": len(request.steps),
        }
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
