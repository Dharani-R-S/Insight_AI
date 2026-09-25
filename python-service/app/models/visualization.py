"""
InsightAI Semantic Layer & Visualization Recommender Data Models.
Defines strict Pydantic schemas for Chart Specifications, Axis Configurations,
Semantic Metrics, MetricStore, and Dark-Mode Neon Aizen Aesthetics.
"""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.dataset import ColumnInfo


class ChartType(str, Enum):
    BAR = "bar"
    LINE = "line"
    SCATTER = "scatter"
    PIE = "pie"
    AREA = "area"
    RADAR = "radar"
    COMPOSED = "composed"


class MetricFormat(str, Enum):
    CURRENCY = "currency"
    NUMBER = "number"
    PERCENTAGE = "percentage"
    DURATION = "duration"
    SCIENTIFIC = "scientific"
    RAW = "raw"


class BaseVisModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class SemanticMetric(BaseVisModel):
    """
    Semantic Metric Layer definition for business logic, unit formatting,
    and automatic currency / percentage axis decoration.
    """
    name: str = Field(..., description="Column or metric identifier")
    label: str = Field(..., description="Human-readable business label (e.g., 'Total Revenue ($)')")
    format_type: Union[MetricFormat, str] = Field(
        default=MetricFormat.NUMBER,
        alias="format",
        description="Formatting type (currency, percentage, number, raw)",
    )
    unit: Optional[str] = Field(default=None, description="Metric unit symbol ($ , %, ms, units)")
    prefix: Optional[str] = Field(default="", description="Value prefix symbol ($ , €)")
    suffix: Optional[str] = Field(default="", description="Value suffix symbol (%, /mo, units)")
    decimals: int = Field(default=2, description="Decimal precision for rendering")
    calculation: Optional[str] = Field(default=None, description="Underlying SQL or math expression")


class MetricStore(BaseVisModel):
    """
    Registry and heuristic detector for semantic metrics across datasets.
    """
    metrics: Dict[str, SemanticMetric] = Field(default_factory=dict)

    @classmethod
    def infer_semantic_metric(cls, col_name: str, sample_values: Optional[List[Any]] = None) -> SemanticMetric:
        """
        Heuristically determine the business semantics, unit, and format of a column name.
        """
        lower = col_name.lower().strip()
        formatted_label = " ".join([word.capitalize() for word in lower.replace("_", " ").split()])

        # Currency Patterns
        currency_keywords = ["revenue", "sales", "price", "cost", "salary", "spend", "budget", "profit", "amount", "total_val", "discount", "fee", "income", "usd", "tax"]
        if any(k in lower for k in currency_keywords):
            return SemanticMetric(
                name=col_name,
                label=f"{formatted_label} ($)",
                format_type=MetricFormat.CURRENCY,
                unit="$",
                prefix="$",
                decimals=2,
            )

        # Percentage Patterns
        pct_keywords = ["rate", "pct", "percent", "percentage", "margin", "ratio", "score_pct", "growth", "churn", "retention"]
        if any(k in lower for k in pct_keywords):
            return SemanticMetric(
                name=col_name,
                label=f"{formatted_label} (%)",
                format_type=MetricFormat.PERCENTAGE,
                unit="%",
                suffix="%",
                decimals=1,
            )

        # Count / Quantity Patterns
        count_keywords = ["count", "quantity", "units", "qty", "orders", "users", "sessions", "items", "views", "clicks", "total_"]
        if any(k in lower for k in count_keywords):
            return SemanticMetric(
                name=col_name,
                label=formatted_label,
                format_type=MetricFormat.NUMBER,
                decimals=0,
            )

        # Default Numeric / Raw
        return SemanticMetric(
            name=col_name,
            label=formatted_label,
            format_type=MetricFormat.NUMBER,
            decimals=2,
        )


class AxisConfig(BaseVisModel):
    """
    Axis configuration for Recharts XAxis / YAxis.
    """
    key: str = Field(..., description="Data key representing this axis in the payload")
    label: str = Field(..., description="Display title for the axis")
    data_type: str = Field(..., description="Data type category: datetime, categorical, numeric, boolean")
    scale: str = Field(default="linear", description="Axis scale: linear, band, point, time")
    format_type: Optional[Union[MetricFormat, str]] = Field(default=None, alias="format")
    unit: Optional[str] = Field(default=None)
    prefix: Optional[str] = Field(default="")
    suffix: Optional[str] = Field(default="")
    min_val: Optional[Union[float, int]] = None
    max_val: Optional[Union[float, int]] = None


class ChartSeries(BaseVisModel):
    """
    Series styling and mapping for Bar, Line, Area, or Scatter.
    """
    key: str = Field(..., description="Data key for metric value")
    name: Optional[str] = Field(default=None, description="Display name for legend")
    color: str = Field(default="#06b6d4", description="Hex color for stroke or fill")
    fill: Optional[str] = Field(default=None)
    stroke: Optional[str] = Field(default=None)
    chart_type: Optional[str] = Field(default=None)
    aggregation: Optional[str] = Field(default=None)


class ChartTheme(BaseVisModel):
    """
    System-terminal Dark Mode aesthetic specifications.
    Strict slate & neon palette with Aizen-inspired structural elegance.
    """
    mode: Literal["dark", "system"] = "dark"
    background: str = "#0f172a"
    card_background: str = "#1e293b"
    grid_color: str = "#334155"
    text_primary: str = "#f8fafc"
    text_secondary: str = "#94a3b8"
    tooltip_background: str = "rgba(15, 23, 42, 0.95)"
    tooltip_border: str = "#334155"
    accent_color: str = "#06b6d4"
    palette: List[str] = Field(
        default=[
            "#06b6d4",  # Neon Cyan
            "#10b981",  # Emerald Matrix
            "#8b5cf6",  # Electric Violet
            "#3b82f6",  # Cyber Blue
            "#f59e0b",  # Amber Glow
            "#f43f5e",  # Laser Crimson
            "#14b8a6",  # Teal Core
            "#a855f7",  # Neon Purple
        ]
    )


class ChartSpec(BaseVisModel):
    """
    Pydantic-validated JSON specification for React Recharts components.
    Zero images or HTML. Pure structural JSON with theme and semantic data.
    """
    id: str = Field(..., description="Unique specification identifier")
    chart_type: Literal["bar", "line", "scatter", "pie", "area", "composed"] = Field(
        ...,
        description="Target Recharts component type (bar, line, scatter, pie, area)",
    )
    title: str = Field(..., description="Actionable title describing the visualization")
    subtitle: Optional[str] = Field(default=None, description="Secondary context or date range")
    rationale: str = Field(..., description="Heuristic explanation for why this chart was selected")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Recommendation match score (0.0 - 1.0)")
    x_axis_key: str = Field(..., description="Primary X-axis key (dimension or date)")
    y_axis_key: Union[str, List[str]] = Field(..., description="Primary Y-axis key(s) (metrics)")
    x_axis: AxisConfig
    y_axis: AxisConfig
    series: List[ChartSeries] = Field(default_factory=list)
    data_payload: List[Dict[str, Any]] = Field(..., description="Aggregated and formatted row data for Recharts")
    theme: ChartTheme = Field(default_factory=ChartTheme)
    semantic_metric: Optional[SemanticMetric] = None
    total_points: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


# --- Request & Response Models ---

class AutoVisualizeRequest(BaseVisModel):
    dataset_id: Optional[str] = Field(
        default=None,
        description="Dataset identifier stored in storage/parquet directory",
    )
    parquet_path: Optional[str] = Field(
        default=None,
        description="Absolute path to the Parquet dataset file",
    )
    sql_query: Optional[str] = Field(
        default=None,
        description="Optional SQL query to execute against dataset before generating charts",
    )
    data: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Direct row payload if client already has query results",
    )
    columns: Optional[List[str]] = Field(
        default=None,
        description="Optional list of column names if data is provided directly",
    )
    metric_overrides: Optional[Dict[str, SemanticMetric]] = Field(
        default=None,
        description="Custom semantic metric definitions to override heuristic inference",
    )
    max_recommendations: int = Field(
        default=3,
        description="Maximum number of top recommended charts to return (default: 3)",
    )


class AutoVisualizeResponse(BaseVisModel):
    dataset_id: Optional[str] = None
    total_rows: int
    total_columns: int
    recommendations: List[ChartSpec] = Field(
        default_factory=list,
        description="Ranked list of top recommended Recharts JSON specifications",
    )
    detected_metrics: List[SemanticMetric] = Field(
        default_factory=list,
        description="Semantic metrics detected across dataset numeric columns",
    )
    execution_time_ms: float
