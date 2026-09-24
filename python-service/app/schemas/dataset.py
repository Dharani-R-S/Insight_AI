"""
Pydantic Schemas for Dataset Ingestion, OLAP Querying, and Schema Inspection.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ColumnInfo(BaseModel):
    """Metadata describing a single column in a dataset."""

    name: str
    data_type: str
    nullable: bool = True
    sample_values: List[Any] = Field(default_factory=list)


class IngestResponse(BaseModel):
    """Response returned upon successful dataset ingestion."""

    dataset_id: str
    original_filename: str
    parquet_path: str
    total_rows: int
    total_columns: int
    columns: List[ColumnInfo]
    created_at: datetime = Field(default_factory=datetime.utcnow)


class QueryRequest(BaseModel):
    """Request payload for executing direct DuckDB SQL queries against a dataset."""

    sql: str = Field(..., description="Vectorized SQL query string to execute")
    parquet_path: Optional[str] = Field(
        None, description="Absolute or relative path to the target Parquet dataset file"
    )
    limit: Optional[int] = Field(1000, description="Maximum number of rows to return")


class QueryResult(BaseModel):
    """Result payload returned by DuckDB query execution engine."""

    columns: List[str]
    column_types: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    execution_time_ms: float
    sql_executed: str


class DatasetSchema(BaseModel):
    """Full schema breakdown for an ingested dataset."""

    dataset_id: str
    file_size_bytes: int
    total_rows: int
    total_columns: int
    columns: List[ColumnInfo]
    preview: List[Dict[str, Any]]
