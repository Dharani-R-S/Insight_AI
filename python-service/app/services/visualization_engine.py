"""
Semantic Layer & Auto-Visualization Recommender Engine for InsightAI.
Analyzes DuckDB tabular query results, infers semantic metrics, executes rule-based heuristics,
and produces Pydantic-validated JSON Chart Specifications (Zero PNG/HTML).
"""

from datetime import date, datetime
from decimal import Decimal
import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union
import uuid

from app.models.visualization import (
    AxisConfig,
    ChartSeries,
    ChartSpec,
    ChartTheme,
    ChartType,
    MetricFormat,
    MetricStore,
    SemanticMetric,
)
from app.schemas.dataset import ColumnInfo

logger = logging.getLogger("insightai.visualization_engine")

# Strict Slate & Neon Palette (Aizen-inspired structural elegance)
DEFAULT_THEME_PALETTE = [
    "#06b6d4",  # Neon Cyan
    "#10b981",  # Emerald Matrix
    "#8b5cf6",  # Electric Violet
    "#3b82f6",  # Cyber Blue
    "#f59e0b",  # Amber Glow
    "#f43f5e",  # Laser Crimson
    "#14b8a6",  # Teal Core
    "#a855f7",  # Neon Purple
]


class ColumnProfile:
    """Statistical and semantic profile of a dataset column."""

    def __init__(
        self,
        name: str,
        sql_type: Optional[str] = None,
        sample_values: Optional[List[Any]] = None,
    ):
        self.name = name
        self.sql_type = (sql_type or "").upper()
        self.sample_values = sample_values or []
        self.is_datetime = False
        self.is_numeric = False
        self.is_categorical = False
        self.is_boolean = False
        self.cardinality = 0
        self.min_val: Optional[float] = None
        self.max_val: Optional[float] = None
        self.null_count = 0


class VisualizationEngine:
    """
    Enterprise Auto-Visualization Recommender.
    Executes rule-based heuristics over DuckDB result sets and applies Semantic Layer metrics.
    """

    DATE_PATTERNS = [
        re.compile(r"^\d{4}[-/]\d{2}([-/]\d{2})?"),  # YYYY-MM-DD or YYYY-MM
        re.compile(r"^\d{2}[-/]\d{2}[-/]\d{4}"),    # MM/DD/YYYY or DD-MM-YYYY
        re.compile(r"^\d{4}$"),                     # YYYY
    ]

    MONTH_KEYWORDS = {
        "jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "oct", "nov", "dec",
    }

    DATE_NAME_KEYWORDS = {
        "date", "time", "timestamp", "year", "month", "day", "quarter",
        "period", "created_at", "updated_at", "order_date", "timestamp_utc",
    }

    @classmethod
    def _is_datetime_value(cls, val: Any) -> bool:
        """Check if an individual scalar value represents a date or timestamp."""
        if val is None:
            return False
        if isinstance(val, (datetime, date)):
            return True
        if isinstance(val, (int, float)):
            return False

        str_val = str(val).strip().lower()
        if any(pat.match(str_val) for pat in cls.DATE_PATTERNS):
            return True
        if any(m in str_val for m in cls.MONTH_KEYWORDS) and len(str_val) < 20:
            return True
        return False

    @classmethod
    def _is_numeric_value(cls, val: Any) -> bool:
        """Check if an individual scalar value represents a real numeric value."""
        if val is None:
            return False
        if isinstance(val, bool):
            return False
        if isinstance(val, (int, float, Decimal)):
            return True
        if isinstance(val, str):
            try:
                float(val.replace(",", "").strip("$€£%"))
                return True
            except ValueError:
                return False
        return False

    @classmethod
    def _to_float(cls, val: Any) -> Optional[float]:
        """Safely parse scalar value to float."""
        if val is None or isinstance(val, bool):
            return None
        if isinstance(val, (int, float, Decimal)):
            return float(val)
        if isinstance(val, str):
            try:
                return float(val.replace(",", "").strip("$€£%"))
            except ValueError:
                return None
        return None

    @classmethod
    def profile_columns(
        cls,
        rows: List[Dict[str, Any]],
        columns: Optional[List[str]] = None,
        schema_info: Optional[List[ColumnInfo]] = None,
    ) -> Dict[str, ColumnProfile]:
        """
        Profiles all dataset columns to detect data types, cardinality, min/max, and nulls.
        """
        if not columns:
            if rows:
                columns = list(rows[0].keys())
            elif schema_info:
                columns = [c.name for c in schema_info]
            else:
                return {}

        sql_type_map = {c.name: c.data_type for c in (schema_info or [])}
        profiles: Dict[str, ColumnProfile] = {}

        for col in columns:
            p = ColumnProfile(
                name=col,
                sql_type=sql_type_map.get(col, ""),
                sample_values=[r.get(col) for r in rows[:10] if r.get(col) is not None],
            )

            # Analyze distinct values and types across rows
            distinct_vals: Set[Any] = set()
            numeric_vals: List[float] = []
            datetime_matches = 0
            total_non_nulls = 0

            lower_col = col.lower()
            name_indicates_date = any(k in lower_col for k in cls.DATE_NAME_KEYWORDS)

            for r in rows:
                val = r.get(col)
                if val is None:
                    p.null_count += 1
                    continue

                total_non_nulls += 1
                distinct_vals.add(str(val))

                if cls._is_datetime_value(val):
                    datetime_matches += 1

                flt = cls._to_float(val)
                if flt is not None:
                    numeric_vals.append(flt)

            p.cardinality = len(distinct_vals)

            # Assign primary type classification
            if (
                "DATE" in p.sql_type
                or "TIME" in p.sql_type
                or (total_non_nulls > 0 and datetime_matches / total_non_nulls >= 0.7)
                or (name_indicates_date and total_non_nulls > 0 and datetime_matches > 0)
            ):
                p.is_datetime = True
            elif (
                any(t in p.sql_type for t in ["INT", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "REAL"])
                or (total_non_nulls > 0 and len(numeric_vals) / total_non_nulls >= 0.8)
            ):
                p.is_numeric = True
                if numeric_vals:
                    p.min_val = min(numeric_vals)
                    p.max_val = max(numeric_vals)
            elif "BOOL" in p.sql_type or distinct_vals.issubset({"True", "False", "true", "false", "0", "1"}):
                p.is_boolean = True
            else:
                p.is_categorical = True

            profiles[col] = p

        return profiles

    @classmethod
    def recommend_visualizations(
        cls,
        rows: List[Dict[str, Any]],
        columns: Optional[List[str]] = None,
        schema_info: Optional[List[ColumnInfo]] = None,
        metric_overrides: Optional[Dict[str, SemanticMetric]] = None,
        max_recommendations: int = 3,
    ) -> List[ChartSpec]:
        """
        Analyzes data with heuristic rule engine, applies semantic layer, and returns top ranked ChartSpecs.
        """
        if not rows:
            return []

        profiles = cls.profile_columns(rows, columns=columns, schema_info=schema_info)
        overrides = metric_overrides or {}

        datetime_cols = [p.name for p in profiles.values() if p.is_datetime]
        numeric_cols = [p.name for p in profiles.values() if p.is_numeric]
        categorical_cols = [p.name for p in profiles.values() if p.is_categorical or p.is_boolean]

        # Infer Semantic Metrics for numeric columns
        semantic_metrics: Dict[str, SemanticMetric] = {}
        for ncol in numeric_cols:
            if ncol in overrides:
                semantic_metrics[ncol] = overrides[ncol]
            else:
                samples = profiles[ncol].sample_values
                semantic_metrics[ncol] = MetricStore.infer_semantic_metric(ncol, samples)

        candidate_charts: List[Tuple[float, ChartSpec]] = []
        theme = ChartTheme()

        # -------------------------------------------------------------
        # HEURISTIC RULE 1: Time Series / Trend Analysis (Date + Numeric)
        # -------------------------------------------------------------
        if datetime_cols and numeric_cols:
            date_col = datetime_cols[0]
            primary_metric_col = numeric_cols[0]
            sem_metric = semantic_metrics[primary_metric_col]

            # Aggregate / Prepare time series data payload
            ts_payload = cls._format_timeseries_payload(rows, date_col, numeric_cols[:2])

            # 1A. Line Chart Recommendation
            line_spec = ChartSpec(
                id=f"chart_{uuid.uuid4().hex[:8]}",
                chart_type="line",
                title=f"{sem_metric.label} Trend Analysis",
                subtitle=f"Temporal progression over {date_col}",
                rationale=f"Identified datetime column '{date_col}' and continuous numeric metric '{primary_metric_col}'. Line chart highlights trends, fluctuations, and velocity over time.",
                confidence=0.97,
                x_axis_key=date_col,
                y_axis_key=primary_metric_col,
                x_axis=AxisConfig(
                    key=date_col,
                    label=date_col.replace("_", " ").title(),
                    data_type="datetime",
                    scale="point",
                ),
                y_axis=AxisConfig(
                    key=primary_metric_col,
                    label=sem_metric.label,
                    data_type="numeric",
                    format=sem_metric.format_type,
                    unit=sem_metric.unit,
                    prefix=sem_metric.prefix,
                    suffix=sem_metric.suffix,
                    min_val=profiles[primary_metric_col].min_val,
                    max_val=profiles[primary_metric_col].max_val,
                ),
                series=[
                    ChartSeries(
                        key=primary_metric_col,
                        name=sem_metric.label,
                        color=DEFAULT_THEME_PALETTE[0],
                        stroke=DEFAULT_THEME_PALETTE[0],
                        chart_type="line",
                    )
                ],
                data_payload=ts_payload,
                theme=theme,
                semantic_metric=sem_metric,
                total_points=len(ts_payload),
            )
            candidate_charts.append((0.97, line_spec))

            # 1B. Area Chart Recommendation
            area_spec = ChartSpec(
                id=f"chart_{uuid.uuid4().hex[:8]}",
                chart_type="area",
                title=f"{sem_metric.label} Volume Trajectory",
                subtitle=f"Cumulative volume distribution across {date_col}",
                rationale=f"Area chart visualizes continuous volume and cumulative impact for '{primary_metric_col}' across time periods.",
                confidence=0.92,
                x_axis_key=date_col,
                y_axis_key=primary_metric_col,
                x_axis=AxisConfig(
                    key=date_col,
                    label=date_col.replace("_", " ").title(),
                    data_type="datetime",
                    scale="point",
                ),
                y_axis=AxisConfig(
                    key=primary_metric_col,
                    label=sem_metric.label,
                    data_type="numeric",
                    format=sem_metric.format_type,
                    unit=sem_metric.unit,
                    prefix=sem_metric.prefix,
                    suffix=sem_metric.suffix,
                ),
                series=[
                    ChartSeries(
                        key=primary_metric_col,
                        name=sem_metric.label,
                        color=DEFAULT_THEME_PALETTE[1],
                        fill=f"url(#gradient_{primary_metric_col})",
                        stroke=DEFAULT_THEME_PALETTE[1],
                        chart_type="area",
                    )
                ],
                data_payload=ts_payload,
                theme=theme,
                semantic_metric=sem_metric,
                total_points=len(ts_payload),
            )
            candidate_charts.append((0.92, area_spec))

        # -------------------------------------------------------------
        # HEURISTIC RULE 2: Categorical Breakdown & Proportions (Cat + Num)
        # -------------------------------------------------------------
        if categorical_cols and numeric_cols:
            cat_col = categorical_cols[0]
            cat_profile = profiles[cat_col]
            primary_metric_col = numeric_cols[0]
            sem_metric = semantic_metrics[primary_metric_col]

            cat_payload = cls._format_categorical_payload(rows, cat_col, primary_metric_col)

            # 2A. High-Contrast Bar Chart Recommendation
            bar_spec = ChartSpec(
                id=f"chart_{uuid.uuid4().hex[:8]}",
                chart_type="bar",
                title=f"{sem_metric.label} by {cat_col.replace('_', ' ').title()}",
                subtitle=f"Categorical comparison across {cat_col}",
                rationale=f"Discrete categories in '{cat_col}' ({cat_profile.cardinality} distinct groups) paired with '{primary_metric_col}'. Bar chart provides immediate comparative ranking.",
                confidence=0.95,
                x_axis_key=cat_col,
                y_axis_key=primary_metric_col,
                x_axis=AxisConfig(
                    key=cat_col,
                    label=cat_col.replace("_", " ").title(),
                    data_type="categorical",
                    scale="band",
                ),
                y_axis=AxisConfig(
                    key=primary_metric_col,
                    label=sem_metric.label,
                    data_type="numeric",
                    format=sem_metric.format_type,
                    unit=sem_metric.unit,
                    prefix=sem_metric.prefix,
                    suffix=sem_metric.suffix,
                ),
                series=[
                    ChartSeries(
                        key=primary_metric_col,
                        name=sem_metric.label,
                        color=DEFAULT_THEME_PALETTE[0],
                        fill=DEFAULT_THEME_PALETTE[0],
                        chart_type="bar",
                    )
                ],
                data_payload=cat_payload,
                theme=theme,
                semantic_metric=sem_metric,
                total_points=len(cat_payload),
            )
            candidate_charts.append((0.95, bar_spec))

            # 2B. Pie / Donut Chart Recommendation (if cardinality <= 7)
            if 2 <= cat_profile.cardinality <= 7:
                pie_spec = ChartSpec(
                    id=f"chart_{uuid.uuid4().hex[:8]}",
                    chart_type="pie",
                    title=f"{sem_metric.label} Share by {cat_col.replace('_', ' ').title()}",
                    subtitle=f"Proportional breakdown ({cat_profile.cardinality} segments)",
                    rationale=f"Low cardinality dimension '{cat_col}' ({cat_profile.cardinality} segments) is ideal for proportional share and contribution analysis.",
                    confidence=0.90,
                    x_axis_key=cat_col,
                    y_axis_key=primary_metric_col,
                    x_axis=AxisConfig(
                        key=cat_col,
                        label=cat_col.replace("_", " ").title(),
                        data_type="categorical",
                        scale="band",
                    ),
                    y_axis=AxisConfig(
                        key=primary_metric_col,
                        label=sem_metric.label,
                        data_type="numeric",
                        format=sem_metric.format_type,
                        unit=sem_metric.unit,
                        prefix=sem_metric.prefix,
                        suffix=sem_metric.suffix,
                    ),
                    series=[
                        ChartSeries(
                            key=primary_metric_col,
                            name=sem_metric.label,
                            color=DEFAULT_THEME_PALETTE[i % len(DEFAULT_THEME_PALETTE)],
                            chart_type="pie",
                        )
                        for i in range(len(cat_payload))
                    ],
                    data_payload=cat_payload,
                    theme=theme,
                    semantic_metric=sem_metric,
                    total_points=len(cat_payload),
                )
                candidate_charts.append((0.90, pie_spec))

        # -------------------------------------------------------------
        # HEURISTIC RULE 3: Correlation & Relationship (Two Numeric Columns)
        # -------------------------------------------------------------
        if len(numeric_cols) >= 2:
            num_x = numeric_cols[0]
            num_y = numeric_cols[1]
            metric_x = semantic_metrics[num_x]
            metric_y = semantic_metrics[num_y]

            scatter_payload = cls._format_scatter_payload(rows, num_x, num_y)

            scatter_spec = ChartSpec(
                id=f"chart_{uuid.uuid4().hex[:8]}",
                chart_type="scatter",
                title=f"Correlation: {metric_x.label} vs. {metric_y.label}",
                subtitle="Bivariate correlation and distribution analysis",
                rationale=f"Two continuous numeric variables '{num_x}' and '{num_y}' detected. Scatter plot reveals clustering, outliers, linear correlation, and variance.",
                confidence=0.88,
                x_axis_key=num_x,
                y_axis_key=num_y,
                x_axis=AxisConfig(
                    key=num_x,
                    label=metric_x.label,
                    data_type="numeric",
                    format=metric_x.format_type,
                    unit=metric_x.unit,
                    prefix=metric_x.prefix,
                    suffix=metric_x.suffix,
                    min_val=profiles[num_x].min_val,
                    max_val=profiles[num_x].max_val,
                ),
                y_axis=AxisConfig(
                    key=num_y,
                    label=metric_y.label,
                    data_type="numeric",
                    format=metric_y.format_type,
                    unit=metric_y.unit,
                    prefix=metric_y.prefix,
                    suffix=metric_y.suffix,
                    min_val=profiles[num_y].min_val,
                    max_val=profiles[num_y].max_val,
                ),
                series=[
                    ChartSeries(
                        key=num_y,
                        name=f"{metric_x.name} × {metric_y.name}",
                        color=DEFAULT_THEME_PALETTE[2],
                        fill=DEFAULT_THEME_PALETTE[2],
                        chart_type="scatter",
                    )
                ],
                data_payload=scatter_payload,
                theme=theme,
                semantic_metric=metric_y,
                total_points=len(scatter_payload),
            )
            candidate_charts.append((0.88, scatter_spec))

        # -------------------------------------------------------------
        # HEURISTIC RULE 4: Multi-Metric Dual Axis / Composed Chart
        # -------------------------------------------------------------
        if (categorical_cols or datetime_cols) and len(numeric_cols) >= 2:
            dim_col = (datetime_cols or categorical_cols)[0]
            m1_col = numeric_cols[0]
            m2_col = numeric_cols[1]
            m1_metric = semantic_metrics[m1_col]
            m2_metric = semantic_metrics[m2_col]

            composed_payload = cls._format_composed_payload(rows, dim_col, [m1_col, m2_col])

            composed_spec = ChartSpec(
                id=f"chart_{uuid.uuid4().hex[:8]}",
                chart_type="composed",
                title=f"Comparative: {m1_metric.label} & {m2_metric.label}",
                subtitle=f"Dual-metric perspective across {dim_col}",
                rationale=f"Multi-metric composition pairing '{m1_col}' (Bar) with '{m2_col}' (Line) over '{dim_col}' for cross-metric correlation.",
                confidence=0.91,
                x_axis_key=dim_col,
                y_axis_key=[m1_col, m2_col],
                x_axis=AxisConfig(
                    key=dim_col,
                    label=dim_col.replace("_", " ").title(),
                    data_type="datetime" if dim_col in datetime_cols else "categorical",
                    scale="band",
                ),
                y_axis=AxisConfig(
                    key=m1_col,
                    label=f"{m1_metric.label} / {m2_metric.label}",
                    data_type="numeric",
                    format=m1_metric.format_type,
                ),
                series=[
                    ChartSeries(
                        key=m1_col,
                        name=m1_metric.label,
                        color=DEFAULT_THEME_PALETTE[0],
                        fill=DEFAULT_THEME_PALETTE[0],
                        chart_type="bar",
                    ),
                    ChartSeries(
                        key=m2_col,
                        name=m2_metric.label,
                        color=DEFAULT_THEME_PALETTE[4],
                        stroke=DEFAULT_THEME_PALETTE[4],
                        chart_type="line",
                    ),
                ],
                data_payload=composed_payload,
                theme=theme,
                semantic_metric=m1_metric,
                total_points=len(composed_payload),
            )
            candidate_charts.append((0.91, composed_spec))

        # Sort candidates by confidence score descending and slice top N
        candidate_charts.sort(key=lambda item: item[0], reverse=True)
        top_charts = [spec for _, spec in candidate_charts[:max_recommendations]]

        logger.info(f"Generated {len(top_charts)} recommended chart specifications.")
        return top_charts

    # --- Data Payload Helpers ---

    @classmethod
    def _format_timeseries_payload(
        cls,
        rows: List[Dict[str, Any]],
        date_col: str,
        metric_cols: List[str],
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Format and sort time-series rows for Recharts Line/Area components."""
        cleaned_rows = []
        for r in rows[:limit]:
            d_val = r.get(date_col)
            if d_val is None:
                continue
            entry = {date_col: str(d_val)}
            for m in metric_cols:
                flt = cls._to_float(r.get(m))
                entry[m] = flt if flt is not None else 0.0
            cleaned_rows.append(entry)
        return cleaned_rows

    @classmethod
    def _format_categorical_payload(
        cls,
        rows: List[Dict[str, Any]],
        cat_col: str,
        metric_col: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Format and sort categorical rows for Recharts Bar/Pie components."""
        cat_map: Dict[str, float] = {}
        for r in rows:
            cat_val = str(r.get(cat_col, "Unknown"))
            flt = cls._to_float(r.get(metric_col)) or 0.0
            cat_map[cat_val] = cat_map.get(cat_val, 0.0) + flt

        sorted_cats = sorted(cat_map.items(), key=lambda x: x[1], reverse=True)[:limit]
        return [{cat_col: k, metric_col: round(v, 2)} for k, v in sorted_cats]

    @classmethod
    def _format_scatter_payload(
        cls,
        rows: List[Dict[str, Any]],
        num_x: str,
        num_y: str,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Format bivariate scatter coordinates for Recharts Scatter component."""
        scatter_points = []
        for r in rows[:limit]:
            x_flt = cls._to_float(r.get(num_x))
            y_flt = cls._to_float(r.get(num_y))
            if x_flt is not None and y_flt is not None:
                scatter_points.append({num_x: x_flt, num_y: y_flt})
        return scatter_points

    @classmethod
    def _format_composed_payload(
        cls,
        rows: List[Dict[str, Any]],
        dim_col: str,
        metric_cols: List[str],
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Format dual-metric rows for Recharts ComposedChart component."""
        composed_rows = []
        for r in rows[:limit]:
            dim_val = str(r.get(dim_col, "Unknown"))
            entry = {dim_col: dim_val}
            for m in metric_cols:
                flt = cls._to_float(r.get(m))
                entry[m] = round(flt, 2) if flt is not None else 0.0
            composed_rows.append(entry)
        return composed_rows
