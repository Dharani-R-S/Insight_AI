"""
InsightAI Transformation Pipeline Data Models & Schemas.
Defines strict Pydantic schemas for Power Query transformation steps using Discriminated Unions.
"""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field
from typing_extensions import Annotated

from app.schemas.dataset import ColumnInfo


class FilterOperator(str, Enum):
    EQUALS = "=="
    EQUALS_ALT = "="
    NOT_EQUALS = "!="
    NOT_EQUALS_ALT = "<>"
    GREATER_THAN = ">"
    GREATER_THAN_OR_EQUAL = ">="
    LESS_THAN = "<"
    LESS_THAN_OR_EQUAL = "<="
    CONTAINS = "contains"
    NOT_CONTAINS = "not_contains"
    STARTS_WITH = "starts_with"
    ENDS_WITH = "ends_with"
    IS_NULL = "is_null"
    IS_NOT_NULL = "is_not_null"
    IN_LIST = "in"
    NOT_IN_LIST = "not_in"
    BETWEEN = "between"


class ArithmeticOperator(str, Enum):
    ADD = "+"
    SUBTRACT = "-"
    MULTIPLY = "*"
    DIVIDE = "/"
    MODULO = "%"
    POWER = "**"
    POWER_ALT = "^"


class AggregationFunction(str, Enum):
    SUM = "sum"
    AVG = "avg"
    MEAN = "mean"
    COUNT = "count"
    COUNT_DISTINCT = "count_distinct"
    MIN = "min"
    MAX = "max"
    STDDEV = "stddev"
    VARIANCE = "variance"
    MEDIAN = "median"
    MODE = "mode"
    FIRST = "first"
    LAST = "last"


class ImputeStrategy(str, Enum):
    ZERO = "zero"
    VALUE = "value"
    CUSTOM = "custom"
    MEAN = "mean"
    MEDIAN = "median"
    MODE = "mode"
    FFILL = "ffill"
    BFILL = "bfill"


class JoinType(str, Enum):
    INNER = "inner"
    LEFT = "left"
    RIGHT = "right"
    FULL = "full"
    OUTER = "outer"
    CROSS = "cross"


# --- Step Schemas ---

class BaseStep(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class FilterStep(BaseStep):
    type: Literal["filter"] = Field(default="filter", alias="action")
    column: str = Field(..., description="Target column name to filter on")
    operator: Union[FilterOperator, str] = Field(
        default=FilterOperator.EQUALS,
        description="Filter comparison operator (e.g. ==, !=, >, <, contains, is_null)",
    )
    value: Optional[Any] = Field(
        default=None,
        description="Comparison value or array of values for 'in' operator",
    )
    second_value: Optional[Any] = Field(
        default=None,
        description="Upper bound value when operator is 'between'",
    )


class CalculateStep(BaseStep):
    type: Literal["calculate", "calculated_column"] = Field(default="calculate", alias="action")
    new_column: str = Field(..., description="Name of the new calculated column")
    expression: Optional[str] = Field(
        default=None,
        description="SQL arithmetic expression (e.g., 'colA + colB * 2')",
    )
    col1: Optional[str] = Field(
        default=None,
        description="First operand column name (for structured arithmetic)",
    )
    op: Optional[Union[ArithmeticOperator, str]] = Field(
        default=None,
        description="Arithmetic operator (+, -, *, /, %, **)",
    )
    col2: Optional[str] = Field(
        default=None,
        description="Second operand column name (optional if scalar is used)",
    )
    scalar: Optional[Union[int, float, str]] = Field(
        default=None,
        description="Scalar value for arithmetic operation",
    )


class AggregationField(BaseStep):
    column: str = Field(..., alias="col", description="Target column to aggregate")
    func: Union[AggregationFunction, str] = Field(
        default=AggregationFunction.SUM,
        description="Aggregation function (sum, avg, count, min, max, median, etc.)",
    )
    alias: Optional[str] = Field(
        default=None,
        description="Resulting column name alias (defaults to func_column)",
    )


class AggregateStep(BaseStep):
    type: Literal["aggregate", "group_by"] = Field(default="aggregate", alias="action")
    group_by: List[str] = Field(
        default_factory=list,
        alias="group_cols",
        description="List of column names to GROUP BY",
    )
    aggregations: List[AggregationField] = Field(
        default_factory=list,
        alias="agg_cols",
        description="List of column aggregations",
    )


class ImputeStep(BaseStep):
    type: Literal["impute"] = Field(default="impute", alias="action")
    column: str = Field(..., description="Column to impute missing null values")
    strategy: Union[ImputeStrategy, str] = Field(
        default=ImputeStrategy.ZERO,
        description="Imputation strategy: zero, mean, median, mode, value/custom, ffill, bfill",
    )
    fill_value: Optional[Any] = Field(
        default=None,
        description="Custom value to fill nulls when strategy is 'value' or 'custom'",
    )
    order_by: Optional[str] = Field(
        default=None,
        description="Order by column for sequential window imputation (ffill/bfill)",
    )


class JoinStep(BaseStep):
    type: Literal["join"] = Field(default="join", alias="action")
    join_type: Union[JoinType, str] = Field(
        default=JoinType.INNER,
        description="Join type: inner, left, right, full, outer",
    )
    right_table: Optional[str] = Field(
        default=None,
        description="Secondary table or view name",
    )
    right_parquet_path: Optional[str] = Field(
        default=None,
        description="Parquet file path of secondary dataset to join against",
    )
    right_dataset_id: Optional[str] = Field(
        default=None,
        description="Dataset identifier of secondary dataset",
    )
    left_on: Union[str, List[str]] = Field(
        ...,
        alias="key1",
        description="Join key column(s) in left (primary) dataset",
    )
    right_on: Union[str, List[str]] = Field(
        ...,
        alias="key2",
        description="Join key column(s) in right (secondary) dataset",
    )


class RenameStep(BaseStep):
    type: Literal["rename"] = Field(default="rename", alias="action")
    old_column: Optional[str] = Field(default=None, description="Old column name")
    new_column: Optional[str] = Field(default=None, description="New column name")
    mapping: Optional[Dict[str, str]] = Field(
        default=None,
        description="Dictionary mapping old column names to new column names",
    )


class SortColumn(BaseStep):
    column: str
    ascending: bool = True



class SortStep(BaseStep):
    type: Literal["sort", "order_by"] = Field(default="sort", alias="action")
    columns: Optional[List[SortColumn]] = None
    by: Optional[List[str]] = None
    ascending: bool = True


class DropDuplicatesStep(BaseStep):
    type: Literal["drop_duplicates", "distinct"] = Field(
        default="drop_duplicates", alias="action"
    )
    columns: Optional[List[str]] = Field(
        default=None,
        description="Subset of columns to determine uniqueness. If None, considers all columns.",
    )


class SelectColumnsStep(BaseStep):
    type: Literal["select_columns"] = Field(default="select_columns", alias="action")
    columns: List[str] = Field(..., description="List of columns to keep")


class DropColumnsStep(BaseStep):
    type: Literal["drop_columns"] = Field(default="drop_columns", alias="action")
    columns: List[str] = Field(..., description="List of columns to drop")


# Discriminated Union for Transformation Steps
TransformStep = Annotated[
    Union[
        FilterStep,
        CalculateStep,
        AggregateStep,
        ImputeStep,
        JoinStep,
        RenameStep,
        SortStep,
        DropDuplicatesStep,
        SelectColumnsStep,
        DropColumnsStep,
    ],
    Field(discriminator="type"),
]


# --- Request & Response Models ---

class PipelineRequest(BaseModel):
    parquet_path: Optional[str] = Field(
        default=None,
        description="Absolute path to the primary Parquet dataset file",
    )
    dataset_id: Optional[str] = Field(
        default=None,
        description="Dataset identifier stored in storage/parquet directory",
    )
    source_table: Optional[str] = Field(
        default="dataset",
        description="DuckDB source view or table name if already registered",
    )
    steps: List[TransformStep] = Field(
        default_factory=list,
        description="Ordered sequence of transformation steps to compile and execute",
    )
    limit: Optional[int] = Field(
        default=100,
        description="Maximum rows to return for preview (default: 100)",
    )


class CommitRequest(BaseModel):
    parquet_path: Optional[str] = Field(
        default=None,
        description="Absolute path to the primary Parquet dataset file",
    )
    dataset_id: Optional[str] = Field(
        default=None,
        description="Dataset identifier stored in storage/parquet directory",
    )
    source_table: Optional[str] = Field(
        default="dataset",
        description="DuckDB source view or table name",
    )
    steps: List[TransformStep] = Field(
        default_factory=list,
        description="Ordered sequence of transformation steps to materialize",
    )
    target_dataset_name: Optional[str] = Field(
        default=None,
        description="Human-readable name for the newly transformed dataset",
    )
    target_dataset_id: Optional[str] = Field(
        default=None,
        description="Custom UUID for newly created dataset (auto-generated if omitted)",
    )


class PreviewResponse(BaseModel):
    columns: List[str]
    column_types: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    total_steps: int
    compiled_sql: str
    execution_time_ms: float


class CommitResponse(BaseModel):
    dataset_id: str
    dataset_name: str
    parquet_path: str
    total_rows: int
    total_columns: int
    columns: List[ColumnInfo]
    compiled_sql: str
    execution_time_ms: float
