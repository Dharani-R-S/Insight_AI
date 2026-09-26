"""
Pydantic Schemas for Phase 5 — AI & Conversational Intelligence Engine.
Defines request/response contracts for Root-Cause "Why" Analysis and
Next Best Question recommendation services.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ─── Root-Cause Variance Analysis ────────────────────────────────────────────


class VarianceDriver(BaseModel):
    """A single dimensional driver contributing to the observed variance."""

    dimension: str = Field(
        ...,
        description="Categorical column name (e.g., Region, Category).",
    )
    segment: str = Field(
        ...,
        description="Specific value within the dimension (e.g., 'West', 'Electronics').",
    )
    baseline_value: float = Field(
        ...,
        description="Aggregated metric value in the baseline period.",
    )
    comparison_value: float = Field(
        ...,
        description="Aggregated metric value in the comparison period.",
    )
    absolute_change: float = Field(
        ...,
        description="Absolute difference (comparison - baseline).",
    )
    percentage_change: float = Field(
        ...,
        description="Percentage change relative to the baseline value.",
    )
    contribution_pct: float = Field(
        ...,
        description="This driver's contribution as a percentage of the total observed variance.",
    )


class VarianceRequest(BaseModel):
    """Request payload for root-cause variance decomposition analysis."""

    parquet_path: Optional[str] = Field(
        None,
        description="Absolute path to the Parquet dataset file.",
    )
    dataset_id: Optional[str] = Field(
        None,
        description="Dataset identifier in storage/parquet directory.",
    )
    metric_column: str = Field(
        ...,
        description="The numeric column to analyze variance on (e.g., 'revenue', 'profit').",
        example="revenue",
    )
    date_column: str = Field(
        ...,
        description="The temporal column used to partition baseline vs. comparison periods.",
        example="order_date",
    )
    baseline_start: str = Field(
        ...,
        description="Start date of the baseline period (inclusive, ISO format YYYY-MM-DD).",
        example="2024-01-01",
    )
    baseline_end: str = Field(
        ...,
        description="End date of the baseline period (inclusive, ISO format YYYY-MM-DD).",
        example="2024-03-31",
    )
    comparison_start: str = Field(
        ...,
        description="Start date of the comparison period (inclusive, ISO format YYYY-MM-DD).",
        example="2024-04-01",
    )
    comparison_end: str = Field(
        ...,
        description="End date of the comparison period (inclusive, ISO format YYYY-MM-DD).",
        example="2024-06-30",
    )
    dimension_columns: Optional[List[str]] = Field(
        None,
        description=(
            "Categorical columns to decompose variance by. "
            "If omitted, the engine auto-detects all categorical (VARCHAR) columns."
        ),
    )
    aggregation: str = Field(
        "SUM",
        description="Aggregation function to apply to the metric column (SUM, AVG, COUNT).",
    )
    top_n: int = Field(
        3,
        description="Number of top contributing drivers to extract per dimension.",
    )
    llm_config: Optional[Dict[str, Any]] = Field(
        None,
        description="Optional LLM provider configuration override (provider, api_key, model).",
    )


class VarianceResponse(BaseModel):
    """Response payload containing the root-cause analysis results."""

    metric_column: str
    aggregation: str
    baseline_total: float = Field(
        ...,
        description="Total aggregated metric value in the baseline period.",
    )
    comparison_total: float = Field(
        ...,
        description="Total aggregated metric value in the comparison period.",
    )
    total_absolute_change: float
    total_percentage_change: float
    top_drivers: List[VarianceDriver] = Field(
        ...,
        description="Top contributing dimensional drivers ranked by absolute impact.",
    )
    narrative: str = Field(
        ...,
        description="LLM-generated 2-sentence executive summary grounded in statistical drivers.",
    )
    execution_time_ms: float


# ─── Next Best Question Recommendations ─────────────────────────────────────


class NextQuestionsRequest(BaseModel):
    """Request payload for generating follow-up question suggestion chips."""

    parquet_path: Optional[str] = Field(
        None,
        description="Absolute path to the Parquet dataset file.",
    )
    dataset_id: Optional[str] = Field(
        None,
        description="Dataset identifier in storage/parquet directory.",
    )
    last_query: Optional[str] = Field(
        None,
        description="The most recent natural language question asked by the user.",
    )
    last_sql: Optional[str] = Field(
        None,
        description="The most recent SQL query that was executed.",
    )
    last_result_columns: Optional[List[str]] = Field(
        None,
        description="Column names from the last query result set.",
    )
    last_result_sample: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="Sample rows (up to 5) from the last query result set.",
    )
    llm_config: Optional[Dict[str, Any]] = Field(
        None,
        description="Optional LLM provider configuration override.",
    )


class NextQuestionsResponse(BaseModel):
    """Response payload containing 3 actionable follow-up question chips."""

    questions: List[str] = Field(
        ...,
        description="Exactly 3 actionable follow-up questions based on the current context.",
        min_length=1,
        max_length=5,
    )
    context_summary: str = Field(
        ...,
        description="Brief summary of the context used to generate suggestions.",
    )
    execution_time_ms: float
