"""
Natural Language to SQL Execution API Router for InsightAI Analytics Engine.
Exposes POST /api/ask endpoint for automated context injection, LLM Text-to-SQL translation,
AST validation via SQLGlot, and stateless DuckDB execution.
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.deps import get_optional_current_user
from app.models.user import User
from app.services.duckdb_engine import DuckDBEngine
from app.services.llm_service import LLMService
from app.services.sql_validator import validate_sql

logger = logging.getLogger("insightai.analytics_router")

router = APIRouter(tags=["Natural Language Analytics"])


class AskRequest(BaseModel):
    question: str = Field(
        ...,
        description="Plain-English natural language question to query the dataset.",
        example="What are the top 5 sales categories by total revenue?",
    )
    parquet_path: Optional[str] = Field(
        None,
        description="Absolute path to the Parquet dataset file. Optional if dataset_id is provided or uploaded.",
    )
    dataset_id: Optional[str] = Field(
        None,
        description="Dataset identifier stored in storage/parquet directory.",
    )
    table_name: Optional[str] = Field(
        "dataset",
        description="DuckDB table view name to reference in SQL query.",
    )
    limit: Optional[int] = Field(
        1000,
        description="Maximum row count limit for query execution.",
    )


class AskResponse(BaseModel):
    question: str
    generated_sql: str
    validated_sql: str
    columns: List[str]
    column_types: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    execution_time_ms: float
    dataset_id: Optional[str] = None


@router.post("/api/ask", response_model=AskResponse, status_code=status.HTTP_200_OK)
@router.post("/ask", response_model=AskResponse, status_code=status.HTTP_200_OK)
async def ask_question(
    request: AskRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    POST /api/ask
    
    Translates a plain-English question into a safe, read-only DuckDB SQL query,
    enforces AST validation using SQLGlot, executes against DuckDB, and returns JSON rows.
    """
    if not request.question or not request.question.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The 'question' parameter cannot be empty.",
        )

    # 1. Resolve Parquet dataset path
    resolved_parquet_path: Optional[Path] = None
    target_dataset_id = request.dataset_id or "default_dataset"

    if request.parquet_path:
        path = Path(request.parquet_path)
        if path.exists():
            resolved_parquet_path = path
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Specified parquet file does not exist at path: {request.parquet_path}",
            )
    elif request.dataset_id:
        path = settings.PARQUET_DIR / f"{request.dataset_id}.parquet"
        if path.exists():
            resolved_parquet_path = path
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dataset with ID '{request.dataset_id}' was not found in storage.",
            )
    else:
        # Fallback: locate most recent Parquet file in storage directory
        parquet_files = list(settings.PARQUET_DIR.glob("*.parquet"))
        if parquet_files:
            parquet_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            resolved_parquet_path = parquet_files[0]
            target_dataset_id = resolved_parquet_path.stem
            logger.info(f"Auto-selected latest Parquet dataset: {resolved_parquet_path}")

    if not resolved_parquet_path or not resolved_parquet_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Parquet dataset available. Please upload a dataset first or provide a valid parquet_path or dataset_id.",
        )

    try:
        # 2. Fetch schema from DuckDB engine statelessly
        schema_info = await DuckDBEngine.get_schema(
            dataset_id=target_dataset_id,
            parquet_path=resolved_parquet_path,
        )

        # 3. Generate raw SQL using Groq LLM Service
        generated_sql = await LLMService.generate_sql_from_natural_language(
            question=request.question,
            schema=schema_info,
            table_name=request.table_name or "dataset",
        )

        # 4. Enforce AST parsing and read-only validation using SQLGlot
        validated_sql = validate_sql(generated_sql)

        # 5. Execute safe SQL query statelessly against DuckDB
        query_result = await DuckDBEngine.execute_query(
            sql_query=validated_sql,
            parquet_path=resolved_parquet_path,
            table_name=request.table_name or "dataset",
            limit=request.limit,
        )

        return AskResponse(
            question=request.question,
            generated_sql=generated_sql,
            validated_sql=validated_sql,
            columns=query_result.columns,
            column_types=query_result.column_types,
            rows=query_result.rows,
            row_count=query_result.row_count,
            execution_time_ms=query_result.execution_time_ms,
            dataset_id=target_dataset_id,
        )

    except ValueError as ve:
        logger.warning(f"Validation or input error processing question: {ve}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error processing natural language query: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Natural Language SQL Engine error: {str(exc)}",
        )
