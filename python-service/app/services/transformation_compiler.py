"""
Vectorized Data Transformation Engine (Power Query Compiler) for DuckDB.
Translates JSON transformation pipelines into chained DuckDB Common Table Expressions (CTEs).
Enforces zero pandas usage, strict SQLGlot identifier escaping, and AST security validation.
"""

from datetime import date, datetime
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from app.models.transform import (
    AggregateStep,
    AggregationField,
    AggregationFunction,
    ArithmeticOperator,
    CalculateStep,
    DropColumnsStep,
    DropDuplicatesStep,
    FilterOperator,
    FilterStep,
    ImputeStep,
    ImputeStrategy,
    JoinStep,
    JoinType,
    PipelineRequest,
    RenameStep,
    SelectColumnsStep,
    SortStep,
    TransformStep,
)
from app.services.sql_validator import validate_sql

logger = logging.getLogger("insightai.duckdb_compiler")


class DuckDBCompiler:
    """
    Stateless Compiler that compiles JSON pipeline audit trails into a single
    vectorized DuckDB SQL query using Common Table Expressions (CTEs).
    """

    @staticmethod
    def escape_identifier(name: str) -> str:
        """
        Safely escape a SQL identifier (column or table name) to prevent SQL injection.
        Wraps in double quotes and escapes any embedded double quotes.
        """
        if not name or not isinstance(name, str):
            raise ValueError("Identifier must be a non-empty string.")
        cleaned = name.replace('"', '""').strip()
        if not cleaned:
            raise ValueError("Identifier cannot be blank.")
        return f'"{cleaned}"'

    @staticmethod
    def escape_literal(val: Any) -> str:
        """
        Safely formats and escapes literal values (strings, numbers, booleans, dates) for DuckDB SQL.
        """
        if val is None:
            return "NULL"
        if isinstance(val, bool):
            return "TRUE" if val else "FALSE"
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, (datetime, date)):
            return f"'{val.isoformat()}'"
        if isinstance(val, (list, tuple, set)):
            escaped_items = [DuckDBCompiler.escape_literal(v) for v in val]
            return f"({', '.join(escaped_items)})" if escaped_items else "(NULL)"

        # String value escaping
        str_val = str(val).replace("'", "''")
        return f"'{str_val}'"

    @classmethod
    def compile_filter(cls, step: FilterStep, source_cte: str) -> str:
        """Compile a Filter step into a SELECT * FROM source WHERE ... clause."""
        col = cls.escape_identifier(step.column)
        op = str(step.operator).lower()
        val = step.value

        if op in ["==", "="]:
            if val is None:
                clause = f"{col} IS NULL"
            else:
                clause = f"{col} = {cls.escape_literal(val)}"
        elif op in ["!=", "<>"]:
            if val is None:
                clause = f"{col} IS NOT NULL"
            else:
                clause = f"{col} != {cls.escape_literal(val)} OR {col} IS NULL"
        elif op == ">":
            clause = f"{col} > {cls.escape_literal(val)}"
        elif op == ">=":
            clause = f"{col} >= {cls.escape_literal(val)}"
        elif op == "<":
            clause = f"{col} < {cls.escape_literal(val)}"
        elif op == "<=":
            clause = f"{col} <= {cls.escape_literal(val)}"
        elif op == "contains":
            pattern = f"%{str(val).replace('%', '').replace('_', '')}%".replace("'", "''")
            clause = f"CAST({col} AS VARCHAR) ILIKE '{pattern}'"
        elif op == "not_contains":
            pattern = f"%{str(val).replace('%', '').replace('_', '')}%".replace("'", "''")
            clause = f"(CAST({col} AS VARCHAR) NOT ILIKE '{pattern}' OR {col} IS NULL)"
        elif op == "starts_with":
            pattern = f"{str(val).replace('%', '').replace('_', '')}%".replace("'", "''")
            clause = f"CAST({col} AS VARCHAR) ILIKE '{pattern}'"
        elif op == "ends_with":
            pattern = f"%{str(val).replace('%', '').replace('_', '')}".replace("'", "''")
            clause = f"CAST({col} AS VARCHAR) ILIKE '{pattern}'"
        elif op in ["is_null", "null"]:
            clause = f"{col} IS NULL"
        elif op in ["is_not_null", "not_null"]:
            clause = f"{col} IS NOT NULL"
        elif op == "in":
            if not isinstance(val, (list, tuple, set)):
                val = [val]
            clause = f"{col} IN {cls.escape_literal(val)}"
        elif op == "not_in":
            if not isinstance(val, (list, tuple, set)):
                val = [val]
            clause = f"{col} NOT IN {cls.escape_literal(val)}"
        elif op == "between":
            low = cls.escape_literal(val)
            high = cls.escape_literal(step.second_value)
            clause = f"{col} BETWEEN {low} AND {high}"
        else:
            # Fallback direct equality
            clause = f"{col} = {cls.escape_literal(val)}"

        return f"SELECT * FROM {source_cte} WHERE {clause}"

    @classmethod
    def compile_calculate(cls, step: CalculateStep, source_cte: str) -> str:
        """Compile a Calculate step into arithmetic column expression."""
        new_col = cls.escape_identifier(step.new_column)

        if step.expression:
            # Freeform arithmetic expression validation via sqlglot
            raw_expr = step.expression.strip()
            try:
                parsed_expr = sqlglot.parse_one(raw_expr, read="duckdb")
                # Ensure no forbidden DDL/DML nodes or subqueries
                for node in parsed_expr.walk():
                    if isinstance(node, (exp.Select, exp.Command, exp.Drop, exp.Delete, exp.Insert, exp.Update)):
                        raise ValueError("Subqueries or statements are forbidden in column calculation expressions.")
                safe_expr_sql = parsed_expr.sql(dialect="duckdb")
            except ParseError as pe:
                raise ValueError(f"Invalid arithmetic expression syntax: {pe}")
            expr_clause = safe_expr_sql
        else:
            # Structured arithmetic calculation
            if not step.col1 or not step.op:
                raise ValueError("Calculate step requires 'col1' and 'op' or an 'expression'.")

            col1_esc = cls.escape_identifier(step.col1)
            op = str(step.op).strip()

            if step.col2:
                operand2 = cls.escape_identifier(step.col2)
            elif step.scalar is not None:
                operand2 = cls.escape_literal(step.scalar)
            else:
                operand2 = "0"

            if op == "/":
                expr_clause = f"CASE WHEN {operand2} = 0 OR {operand2} IS NULL THEN 0 ELSE (CAST({col1_esc} AS DOUBLE) / {operand2}) END"
            elif op in ["**", "^"]:
                expr_clause = f"POWER(CAST({col1_esc} AS DOUBLE), {operand2})"
            elif op in ["+", "-", "*", "%"]:
                expr_clause = f"({col1_esc} {op} {operand2})"
            else:
                raise ValueError(f"Unsupported arithmetic operator '{op}'.")

        return f"SELECT *, {expr_clause} AS {new_col} FROM {source_cte}"

    @classmethod
    def compile_aggregate(cls, step: AggregateStep, source_cte: str) -> str:
        """Compile an Aggregate step into GROUP BY and aggregation expressions."""
        group_cols_escaped = [cls.escape_identifier(c) for c in step.group_by]
        agg_exprs = []

        for agg in step.aggregations:
            col_raw = agg.column.strip()
            func = str(agg.func).lower().strip()

            # Handle column identifier or wildcard
            col_esc = "*" if col_raw == "*" else cls.escape_identifier(col_raw)
            alias_name = agg.alias or f"{func}_{col_raw}"
            alias_esc = cls.escape_identifier(alias_name)

            if func in ["sum"]:
                expr = f"SUM({col_esc})"
            elif func in ["avg", "mean"]:
                expr = f"AVG({col_esc})"
            elif func in ["count"]:
                expr = f"COUNT({col_esc})"
            elif func in ["count_distinct", "distinct_count"]:
                expr = f"COUNT(DISTINCT {col_esc})"
            elif func in ["min"]:
                expr = f"MIN({col_esc})"
            elif func in ["max"]:
                expr = f"MAX({col_esc})"
            elif func in ["median"]:
                expr = f"MEDIAN({col_esc})"
            elif func in ["mode"]:
                expr = f"MODE({col_esc})"
            elif func in ["stddev", "std"]:
                expr = f"STDDEV({col_esc})"
            elif func in ["variance", "var"]:
                expr = f"VARIANCE({col_esc})"
            elif func in ["first"]:
                expr = f"FIRST({col_esc})"
            elif func in ["last"]:
                expr = f"LAST({col_esc})"
            else:
                raise ValueError(f"Unsupported aggregation function: '{func}'")

            agg_exprs.append(f"{expr} AS {alias_esc}")

        if not agg_exprs and not group_cols_escaped:
            raise ValueError("Aggregate step must specify at least one aggregation or group by column.")

        select_parts = group_cols_escaped + agg_exprs
        select_clause = ", ".join(select_parts)

        if group_cols_escaped:
            group_by_clause = ", ".join(group_cols_escaped)
            return f"SELECT {select_clause} FROM {source_cte} GROUP BY {group_by_clause}"
        else:
            return f"SELECT {select_clause} FROM {source_cte}"

    @classmethod
    def compile_impute(cls, step: ImputeStep, source_cte: str) -> str:
        """Compile an Impute step using DuckDB EXCLUDE and COALESCE window functions."""
        col_esc = cls.escape_identifier(step.column)
        strategy = str(step.strategy).lower().strip()

        if strategy in ["zero", "0"]:
            replacement = "0"
        elif strategy in ["mean", "avg"]:
            replacement = f"AVG({col_esc}) OVER ()"
        elif strategy == "median":
            replacement = f"MEDIAN({col_esc}) OVER ()"
        elif strategy == "mode":
            replacement = f"MODE({col_esc}) OVER ()"
        elif strategy == "ffill":
            order_clause = f"ORDER BY {cls.escape_identifier(step.order_by)}" if step.order_by else ""
            replacement = f"LAST_VALUE({col_esc} IGNORE NULLS) OVER ({order_clause} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)"
        elif strategy == "bfill":
            order_clause = f"ORDER BY {cls.escape_identifier(step.order_by)}" if step.order_by else ""
            replacement = f"FIRST_VALUE({col_esc} IGNORE NULLS) OVER ({order_clause} ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)"
        elif strategy in ["value", "custom"]:
            if step.fill_value is None:
                raise ValueError("fill_value must be provided when imputation strategy is 'value' or 'custom'.")
            replacement = cls.escape_literal(step.fill_value)
        else:
            raise ValueError(f"Unsupported imputation strategy: '{strategy}'")

        return f"SELECT * EXCLUDE ({col_esc}), COALESCE({col_esc}, {replacement}) AS {col_esc} FROM {source_cte}"

    @classmethod
    def compile_join(cls, step: JoinStep, source_cte: str, join_idx: int) -> Tuple[Optional[str], str]:
        """
        Compile a Join step.
        Returns a tuple of (optional_secondary_cte_def, join_select_query).
        """
        join_type_str = str(step.join_type).upper()
        if join_type_str == "OUTER":
            join_type_str = "FULL OUTER"
        elif join_type_str == "FULL":
            join_type_str = "FULL OUTER"

        right_cte_name = f"join_source_{join_idx}"
        right_cte_def = None

        if step.right_parquet_path:
            clean_path = Path(step.right_parquet_path).as_posix().replace("'", "''")
            right_cte_def = f"{right_cte_name} AS (SELECT * FROM read_parquet('{clean_path}'))"
            right_ref = right_cte_name
        elif step.right_dataset_id:
            right_cte_def = f"{right_cte_name} AS (SELECT * FROM read_parquet('storage/parquet/{step.right_dataset_id}.parquet'))"
            right_ref = right_cte_name
        elif step.right_table:
            right_ref = cls.escape_identifier(step.right_table)
        else:
            raise ValueError("Join step must specify right_parquet_path, right_dataset_id, or right_table.")

        left_keys = [step.left_on] if isinstance(step.left_on, str) else step.left_on
        right_keys = [step.right_on] if isinstance(step.right_on, str) else step.right_on

        if len(left_keys) != len(right_keys):
            raise ValueError("Left join keys and right join keys must have the exact same number of columns.")

        on_conditions = [
            f"{source_cte}.{cls.escape_identifier(lk)} = {right_ref}.{cls.escape_identifier(rk)}"
            for lk, rk in zip(left_keys, right_keys)
        ]
        on_clause = " AND ".join(on_conditions)

        join_sql = f"SELECT {source_cte}.*, {right_ref}.* FROM {source_cte} {join_type_str} JOIN {right_ref} ON {on_clause}"
        return right_cte_def, join_sql

    @classmethod
    def compile_rename(cls, step: RenameStep, source_cte: str) -> str:
        """Compile a Rename step using DuckDB native RENAME clause."""
        rename_pairs = []
        if step.mapping:
            for old_name, new_name in step.mapping.items():
                rename_pairs.append(f"{cls.escape_identifier(old_name)} AS {cls.escape_identifier(new_name)}")
        elif step.old_column and step.new_column:
            rename_pairs.append(f"{cls.escape_identifier(step.old_column)} AS {cls.escape_identifier(step.new_column)}")
        else:
            raise ValueError("Rename step requires 'mapping' dictionary or 'old_column' and 'new_column'.")

        renames_str = ", ".join(rename_pairs)
        return f"SELECT * RENAME ({renames_str}) FROM {source_cte}"

    @classmethod
    def compile_sort(cls, step: SortStep, source_cte: str) -> str:
        """Compile a Sort step into ORDER BY."""
        order_parts = []
        if step.columns:
            for sc in step.columns:
                direction = "ASC" if sc.ascending else "DESC"
                order_parts.append(f"{cls.escape_identifier(sc.column)} {direction}")
        elif step.by:
            direction = "ASC" if step.ascending else "DESC"
            for col in step.by:
                order_parts.append(f"{cls.escape_identifier(col)} {direction}")
        else:
            raise ValueError("Sort step requires 'columns' or 'by' parameter.")

        order_by_clause = ", ".join(order_parts)
        return f"SELECT * FROM {source_cte} ORDER BY {order_by_clause}"

    @classmethod
    def compile_drop_duplicates(cls, step: DropDuplicatesStep, source_cte: str) -> str:
        """Compile a Drop Duplicates step into SELECT DISTINCT."""
        if step.columns:
            cols = ", ".join([cls.escape_identifier(c) for c in step.columns])
            return f"SELECT DISTINCT ON ({cols}) * FROM {source_cte}"
        return f"SELECT DISTINCT * FROM {source_cte}"

    @classmethod
    def compile_select_columns(cls, step: SelectColumnsStep, source_cte: str) -> str:
        """Compile a Select Columns step."""
        cols = ", ".join([cls.escape_identifier(c) for c in step.columns])
        return f"SELECT {cols} FROM {source_cte}"

    @classmethod
    def compile_drop_columns(cls, step: DropColumnsStep, source_cte: str) -> str:
        """Compile a Drop Columns step using DuckDB EXCLUDE."""
        cols = ", ".join([cls.escape_identifier(c) for c in step.columns])
        return f"SELECT * EXCLUDE ({cols}) FROM {source_cte}"

    @classmethod
    def compile_pipeline(
        cls,
        pipeline: PipelineRequest,
        limit: Optional[int] = None,
    ) -> str:
        """
        Compiles a complete PipelineRequest into a CTE-chained DuckDB SQL query.

        Format:
        WITH step_0 AS (SELECT * FROM read_parquet(...)),
             step_1 AS (SELECT * FROM step_0 WHERE ...),
             step_2 AS (SELECT category, SUM(sales) FROM step_1 GROUP BY category)
        SELECT * FROM step_2 LIMIT 100
        """
        ctes: List[str] = []

        # 1. Base Source CTE (step_0)
        if pipeline.parquet_path:
            clean_path = Path(pipeline.parquet_path).as_posix().replace("'", "''")
            base_query = f"SELECT * FROM read_parquet('{clean_path}')"
        elif pipeline.dataset_id:
            parquet_file = f"storage/parquet/{pipeline.dataset_id}.parquet"
            clean_path = Path(parquet_file).as_posix().replace("'", "''")
            base_query = f"SELECT * FROM read_parquet('{clean_path}')"
        elif pipeline.source_table:
            base_query = f"SELECT * FROM {cls.escape_identifier(pipeline.source_table)}"
        else:
            base_query = "SELECT * FROM dataset"

        ctes.append(f"step_0 AS (\n    {base_query}\n)")

        current_cte = "step_0"
        join_counter = 1

        # 2. Iterate through transformation steps and chain CTEs
        for idx, step in enumerate(pipeline.steps, start=1):
            next_cte = f"step_{idx}"

            if isinstance(step, FilterStep):
                step_sql = cls.compile_filter(step, current_cte)
            elif isinstance(step, CalculateStep):
                step_sql = cls.compile_calculate(step, current_cte)
            elif isinstance(step, AggregateStep):
                step_sql = cls.compile_aggregate(step, current_cte)
            elif isinstance(step, ImputeStep):
                step_sql = cls.compile_impute(step, current_cte)
            elif isinstance(step, JoinStep):
                secondary_cte, step_sql = cls.compile_join(step, current_cte, join_counter)
                join_counter += 1
                if secondary_cte:
                    ctes.append(secondary_cte)
            elif isinstance(step, RenameStep):
                step_sql = cls.compile_rename(step, current_cte)
            elif isinstance(step, SortStep):
                step_sql = cls.compile_sort(step, current_cte)
            elif isinstance(step, DropDuplicatesStep):
                step_sql = cls.compile_drop_duplicates(step, current_cte)
            elif isinstance(step, SelectColumnsStep):
                step_sql = cls.compile_select_columns(step, current_cte)
            elif isinstance(step, DropColumnsStep):
                step_sql = cls.compile_drop_columns(step, current_cte)
            else:
                raise ValueError(f"Unknown transformation step type: {type(step)}")

            ctes.append(f"{next_cte} AS (\n    {step_sql}\n)")
            current_cte = next_cte

        # 3. Assemble complete chained CTE query
        cte_block = ",\n".join(ctes)
        final_query = f"WITH {cte_block}\nSELECT * FROM {current_cte}"

        if limit is not None and limit > 0:
            final_query += f" LIMIT {limit}"

        # 4. Enforce AST Security Validation
        validated_sql = validate_sql(final_query)
        logger.info(f"Compiled pipeline with {len(pipeline.steps)} steps successfully.")
        return validated_sql
