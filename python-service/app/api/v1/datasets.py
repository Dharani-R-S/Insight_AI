"""
Dataset Ingestion and Vectorized DuckDB Query API Router.
Provides stateless file ingestion, Parquet materialization, direct DuckDB SQL execution, and schema inspection.
"""

import os
from pathlib import Path
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.dataset import DatasetSchema, IngestResponse, QueryRequest, QueryResult
from app.services.duckdb_engine import DuckDBEngine

router = APIRouter(prefix="/datasets", tags=["Datasets & DuckDB Engine"])


@router.post("/ingest", response_model=IngestResponse, status_code=status.HTTP_201_CREATED)
async def ingest_dataset(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Stateless file ingestion. Converts CSV, TSV, JSON, or Parquet uploads directly into DuckDB Parquet storage."""
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in [".csv", ".tsv", ".txt", ".json", ".parquet", ".xlsx", ".xls", ".xlsm", ".xlsb"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{file_ext}'. Supported formats: CSV, TSV, Excel (.xlsx, .xls), JSON, Parquet.",
        )

    dataset_id = str(uuid.uuid4())
    temp_upload_path = settings.UPLOAD_DIR / f"{dataset_id}_{file.filename}"
    output_parquet_path = settings.PARQUET_DIR / f"{dataset_id}.parquet"

    try:
        # Stream incoming upload to local temporary file
        with open(temp_upload_path, "wb") as buffer:
            content = await file.read()
            if len(content) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File size exceeds maximum allowed limit of {settings.MAX_UPLOAD_SIZE_MB}MB.",
                )
            buffer.write(content)

        # Execute vectorized DuckDB ingestion statelessly in thread pool
        ingest_metadata = await DuckDBEngine.ingest_file_to_parquet(
            file_path=temp_upload_path,
            output_parquet_path=output_parquet_path,
        )

        return IngestResponse(
            dataset_id=dataset_id,
            original_filename=file.filename,
            parquet_path=str(output_parquet_path),
            total_rows=ingest_metadata["total_rows"],
            total_columns=ingest_metadata["total_columns"],
            columns=ingest_metadata["columns"],
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to ingest dataset: {str(exc)}",
        )
    finally:
        # Clean up temporary upload file statelessly
        if temp_upload_path.exists():
            try:
                os.remove(temp_upload_path)
            except OSError:
                pass


@router.post("/query", response_model=QueryResult)
async def query_dataset(
    request: QueryRequest,
    current_user: User = Depends(get_current_user),
):
    """Execute a vectorized DuckDB SELECT query safely without locking the main thread."""
    parquet_path = Path(request.parquet_path) if request.parquet_path else None

    if parquet_path and not parquet_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target parquet file not found at path: {request.parquet_path}",
        )

    try:
        result = await DuckDBEngine.execute_query(
            sql_query=request.sql,
            parquet_path=parquet_path,
            table_name="dataset",
            limit=request.limit,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"DuckDB Execution Error: {str(exc)}",
        )


@router.get("/{dataset_id}/schema", response_model=DatasetSchema)
async def get_dataset_schema(
    dataset_id: str,
    parquet_path: str = Query(..., description="Absolute path to the Parquet dataset file"),
    current_user: User = Depends(get_current_user),
):
    """Inspect schema breakdown and sample rows for an ingested Parquet dataset."""
    path = Path(parquet_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parquet file for dataset '{dataset_id}' was not found.",
        )

    try:
        schema = await DuckDBEngine.get_schema(dataset_id=dataset_id, parquet_path=path)
        return schema
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to inspect schema: {str(exc)}",
        )
