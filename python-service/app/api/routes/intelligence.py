"""
AI & Conversational Intelligence API Router — Phase 5.

Exposes POST endpoints for:
  - /api/intelligence/root-cause  — Root-Cause "Why" Variance Analysis
  - /api/intelligence/next-questions — Next Best Question suggestion chips

Both endpoints are fully stateless: all dataset references, time periods,
and context are received via the request payload.
"""

import logging
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import settings
from app.core.deps import get_optional_current_user
from app.models.user import User
from models.intelligence import (
    NextQuestionsRequest,
    NextQuestionsResponse,
    VarianceRequest,
    VarianceResponse,
)
from services.diagnostic_engine import DiagnosticAnalyzer
from services.recommendation_engine import RecommendationEngine

logger = logging.getLogger("insightai.intelligence_router")

router = APIRouter(tags=["AI & Conversational Intelligence Engine"])


def _resolve_parquet_path(
    parquet_path: Optional[str] = None,
    dataset_id: Optional[str] = None,
) -> Path:
    """
    Resolve a Parquet dataset path from explicit path, dataset_id, or auto-detect.
    Raises HTTPException if no valid dataset is found.
    """
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

    # Auto-detect: use the most recently modified Parquet file
    parquet_files = list(settings.PARQUET_DIR.glob("*.parquet"))
    if parquet_files:
        parquet_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        return parquet_files[0]

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No dataset available. Upload a dataset first or provide a valid parquet_path / dataset_id.",
    )


# ─── Root-Cause Variance Analysis ────────────────────────────────────────────


@router.post(
    "/api/intelligence/root-cause",
    response_model=VarianceResponse,
    status_code=status.HTTP_200_OK,
    summary="Root-Cause 'Why' Variance Decomposition",
    description=(
        "Decomposes a metric variance between two time periods into its top contributing "
        "dimensional drivers using DuckDB statistical queries, then generates a grounded "
        "2-sentence executive narrative via the LLM."
    ),
)
@router.post(
    "/intelligence/root-cause",
    response_model=VarianceResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def analyze_root_cause(
    request: VarianceRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    POST /api/intelligence/root-cause

    Stateless root-cause analysis pipeline:
      1. Resolve the Parquet dataset.
      2. Execute DuckDB variance decomposition queries.
      3. Extract top N statistical drivers.
      4. Pass ONLY the drivers to the LLM for a grounded 2-sentence narrative.
      5. Return the full VarianceResponse.
    """
    start_time = time.perf_counter()

    # 1. Resolve dataset
    resolved_path = _resolve_parquet_path(
        parquet_path=request.parquet_path,
        dataset_id=request.dataset_id,
    )

    try:
        # 2. Execute DuckDB variance decomposition (heavy computation offloaded to DuckDB)
        analysis_result = DiagnosticAnalyzer.analyze_variance(
            parquet_path=resolved_path,
            metric_column=request.metric_column,
            date_column=request.date_column,
            baseline_start=request.baseline_start,
            baseline_end=request.baseline_end,
            comparison_start=request.comparison_start,
            comparison_end=request.comparison_end,
            dimension_columns=request.dimension_columns,
            aggregation=request.aggregation,
            top_n=request.top_n,
        )

        # 3. Generate grounded LLM narrative from ONLY the statistical drivers
        narrative = RecommendationEngine.generate_variance_narrative(
            metric_column=request.metric_column,
            aggregation=request.aggregation,
            baseline_total=analysis_result["baseline_total"],
            comparison_total=analysis_result["comparison_total"],
            total_absolute_change=analysis_result["total_absolute_change"],
            total_percentage_change=analysis_result["total_percentage_change"],
            top_drivers=analysis_result["top_drivers"],
            llm_config=request.llm_config,
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        return VarianceResponse(
            metric_column=request.metric_column,
            aggregation=request.aggregation,
            baseline_total=analysis_result["baseline_total"],
            comparison_total=analysis_result["comparison_total"],
            total_absolute_change=analysis_result["total_absolute_change"],
            total_percentage_change=analysis_result["total_percentage_change"],
            top_drivers=analysis_result["top_drivers"],
            narrative=narrative,
            execution_time_ms=round(elapsed_ms, 2),
        )

    except ValueError as ve:
        logger.warning(f"Validation error in root-cause analysis: {ve}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except FileNotFoundError as fnf:
        logger.warning(f"Dataset not found: {fnf}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(fnf),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Root-cause analysis failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Root-cause analysis engine error: {str(exc)}",
        )


# ─── Next Best Question Suggestions ─────────────────────────────────────────


@router.post(
    "/api/intelligence/next-questions",
    response_model=NextQuestionsResponse,
    status_code=status.HTTP_200_OK,
    summary="Next Best Question Recommendation",
    description=(
        "Analyzes the current dataset schema and last query context to generate "
        "3 actionable follow-up question suggestion chips via the LLM."
    ),
)
@router.post(
    "/intelligence/next-questions",
    response_model=NextQuestionsResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def suggest_next_questions(
    request: NextQuestionsRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    POST /api/intelligence/next-questions

    Stateless next-question pipeline:
      1. Resolve the Parquet dataset.
      2. Extract schema metadata via DuckDB.
      3. Pass schema + last query context to the LLM.
      4. Return exactly 3 follow-up question chips.
    """
    start_time = time.perf_counter()

    # 1. Resolve dataset
    resolved_path = _resolve_parquet_path(
        parquet_path=request.parquet_path,
        dataset_id=request.dataset_id,
    )

    try:
        # 2. Extract schema summary from DuckDB
        schema_summary = DiagnosticAnalyzer.get_schema_summary(
            parquet_path=resolved_path,
        )

        # 3. Generate follow-up questions via LLM
        questions = RecommendationEngine.generate_next_questions(
            schema_summary=schema_summary,
            last_query=request.last_query,
            last_sql=request.last_sql,
            last_result_columns=request.last_result_columns,
            last_result_sample=request.last_result_sample,
            llm_config=request.llm_config,
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        # Build context summary for transparency
        context_parts = []
        if request.last_query:
            context_parts.append(f"Last question: '{request.last_query}'")
        context_parts.append(
            f"Dataset: {len(schema_summary.get('columns', {}))} columns, "
            f"{schema_summary.get('row_count', 0)} rows"
        )
        context_summary = " | ".join(context_parts)

        return NextQuestionsResponse(
            questions=questions,
            context_summary=context_summary,
            execution_time_ms=round(elapsed_ms, 2),
        )

    except ValueError as ve:
        logger.warning(f"Validation error in next-questions: {ve}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Next-question generation failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Next Best Question engine error: {str(exc)}",
        )
