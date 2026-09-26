"""
Diagnostic Analyzer — DuckDB-native Statistical Variance Decomposition Engine.

Offloads all heavy variance computation to DuckDB's vectorized OLAP engine.
Extracts only the top N contributing dimensional drivers, never sending
raw data to the LLM. Maintains absolute statelessness: every invocation
receives the dataset reference and parameters via the request payload.
"""

import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import duckdb

from app.core.config import settings
from models.intelligence import VarianceDriver

logger = logging.getLogger("insightai.diagnostic_engine")

# Allowed aggregation functions (whitelist to prevent injection)
_VALID_AGGREGATIONS = {"SUM", "AVG", "COUNT", "MIN", "MAX"}


class DiagnosticAnalyzer:
    """
    Stateless DuckDB-powered variance decomposition engine.

    Workflow:
      1. Connect to an ephemeral in-memory DuckDB instance.
      2. Register the Parquet file as a read-only view.
      3. Auto-detect categorical dimension columns if not specified.
      4. For each dimension, compute aggregated metric in baseline and comparison
         periods, calculate absolute and percentage change, and rank by impact.
      5. Return the top N drivers along with overall totals — ready for LLM narration.
    """

    @staticmethod
    def _create_connection() -> duckdb.DuckDBPyConnection:
        """Create a resource-bounded ephemeral DuckDB connection."""
        conn = duckdb.connect(database=":memory:", read_only=False)
        conn.execute(f"SET memory_limit = '{settings.DUCKDB_MEMORY_LIMIT}';")
        conn.execute(f"SET threads = {settings.DUCKDB_THREADS};")
        return conn

    @classmethod
    def analyze_variance(
        cls,
        parquet_path: Path,
        metric_column: str,
        date_column: str,
        baseline_start: str,
        baseline_end: str,
        comparison_start: str,
        comparison_end: str,
        dimension_columns: Optional[List[str]] = None,
        aggregation: str = "SUM",
        top_n: int = 3,
    ) -> Dict[str, Any]:
        """
        Execute a full root-cause variance decomposition against the Parquet dataset.

        Returns:
            Dictionary containing baseline_total, comparison_total, total_absolute_change,
            total_percentage_change, and a ranked list of VarianceDriver objects.
        """
        start_time = time.perf_counter()
        agg_func = aggregation.upper().strip()

        if agg_func not in _VALID_AGGREGATIONS:
            raise ValueError(
                f"Invalid aggregation function '{agg_func}'. "
                f"Must be one of: {', '.join(sorted(_VALID_AGGREGATIONS))}"
            )

        if not parquet_path.exists():
            raise FileNotFoundError(f"Parquet dataset not found: {parquet_path}")

        conn = cls._create_connection()
        try:
            # ── 1. Register Parquet as a DuckDB view ──
            conn.execute(
                f"CREATE VIEW dataset AS SELECT * FROM read_parquet('{parquet_path.as_posix()}')"
            )

            # ── 2. Validate that the requested columns exist ──
            describe_res = conn.execute("DESCRIBE dataset").fetchall()
            all_columns = {str(row[0]): str(row[1]) for row in describe_res}

            if metric_column not in all_columns:
                raise ValueError(
                    f"Metric column '{metric_column}' does not exist in dataset. "
                    f"Available columns: {list(all_columns.keys())}"
                )
            if date_column not in all_columns:
                raise ValueError(
                    f"Date column '{date_column}' does not exist in dataset. "
                    f"Available columns: {list(all_columns.keys())}"
                )

            # ── 3. Auto-detect categorical dimensions if not provided ──
            if dimension_columns:
                for dim in dimension_columns:
                    if dim not in all_columns:
                        raise ValueError(
                            f"Dimension column '{dim}' does not exist. "
                            f"Available: {list(all_columns.keys())}"
                        )
                dims = dimension_columns
            else:
                # Select VARCHAR/string-type columns excluding the metric and date columns
                varchar_types = {"VARCHAR", "TEXT", "STRING", "CHAR", "BPCHAR"}
                dims = [
                    col_name
                    for col_name, col_type in all_columns.items()
                    if col_type.upper() in varchar_types
                    and col_name != metric_column
                    and col_name != date_column
                ]
                if not dims:
                    raise ValueError(
                        "No categorical dimension columns detected in the dataset. "
                        "Please specify dimension_columns explicitly."
                    )

            logger.info(
                f"Variance analysis: metric={metric_column}, date={date_column}, "
                f"dims={dims}, agg={agg_func}, periods=[{baseline_start}..{baseline_end}] "
                f"vs [{comparison_start}..{comparison_end}]"
            )

            # ── 4. Compute overall totals for baseline and comparison ──
            totals_sql = f"""
                SELECT
                    {agg_func}(CASE
                        WHEN CAST("{date_column}" AS DATE) BETWEEN '{baseline_start}' AND '{baseline_end}'
                        THEN "{metric_column}" END
                    ) AS baseline_total,
                    {agg_func}(CASE
                        WHEN CAST("{date_column}" AS DATE) BETWEEN '{comparison_start}' AND '{comparison_end}'
                        THEN "{metric_column}" END
                    ) AS comparison_total
                FROM dataset
                WHERE CAST("{date_column}" AS DATE) BETWEEN '{baseline_start}' AND '{comparison_end}'
            """
            totals_row = conn.execute(totals_sql).fetchone()
            baseline_total = float(totals_row[0]) if totals_row[0] is not None else 0.0
            comparison_total = float(totals_row[1]) if totals_row[1] is not None else 0.0
            total_abs_change = comparison_total - baseline_total
            total_pct_change = (
                round((total_abs_change / baseline_total) * 100, 2)
                if baseline_total != 0
                else 0.0
            )

            # ── 5. Decompose variance by each dimension ──
            all_drivers: List[VarianceDriver] = []

            for dim in dims:
                decomp_sql = f"""
                    SELECT
                        "{dim}" AS segment,
                        COALESCE(
                            {agg_func}(CASE
                                WHEN CAST("{date_column}" AS DATE)
                                     BETWEEN '{baseline_start}' AND '{baseline_end}'
                                THEN "{metric_column}" END
                            ), 0
                        ) AS baseline_val,
                        COALESCE(
                            {agg_func}(CASE
                                WHEN CAST("{date_column}" AS DATE)
                                     BETWEEN '{comparison_start}' AND '{comparison_end}'
                                THEN "{metric_column}" END
                            ), 0
                        ) AS comparison_val
                    FROM dataset
                    WHERE CAST("{date_column}" AS DATE) BETWEEN '{baseline_start}' AND '{comparison_end}'
                      AND "{dim}" IS NOT NULL
                    GROUP BY "{dim}"
                    ORDER BY ABS(
                        COALESCE(
                            {agg_func}(CASE
                                WHEN CAST("{date_column}" AS DATE)
                                     BETWEEN '{comparison_start}' AND '{comparison_end}'
                                THEN "{metric_column}" END
                            ), 0
                        )
                        - COALESCE(
                            {agg_func}(CASE
                                WHEN CAST("{date_column}" AS DATE)
                                     BETWEEN '{baseline_start}' AND '{baseline_end}'
                                THEN "{metric_column}" END
                            ), 0
                        )
                    ) DESC
                    LIMIT {top_n}
                """

                rows = conn.execute(decomp_sql).fetchall()

                for row in rows:
                    segment = str(row[0]) if row[0] is not None else "Unknown"
                    bv = float(row[1])
                    cv = float(row[2])
                    abs_change = cv - bv
                    pct_change = (
                        round((abs_change / bv) * 100, 2) if bv != 0 else 0.0
                    )
                    contribution = (
                        round((abs_change / total_abs_change) * 100, 2)
                        if total_abs_change != 0
                        else 0.0
                    )

                    all_drivers.append(
                        VarianceDriver(
                            dimension=dim,
                            segment=segment,
                            baseline_value=round(bv, 2),
                            comparison_value=round(cv, 2),
                            absolute_change=round(abs_change, 2),
                            percentage_change=pct_change,
                            contribution_pct=contribution,
                        )
                    )

            # ── 6. Rank all drivers across dimensions by absolute impact ──
            all_drivers.sort(key=lambda d: abs(d.absolute_change), reverse=True)
            top_drivers = all_drivers[:top_n]

            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            return {
                "baseline_total": round(baseline_total, 2),
                "comparison_total": round(comparison_total, 2),
                "total_absolute_change": round(total_abs_change, 2),
                "total_percentage_change": total_pct_change,
                "top_drivers": top_drivers,
                "execution_time_ms": round(elapsed_ms, 2),
            }

        finally:
            conn.close()

    @classmethod
    def get_schema_summary(
        cls,
        parquet_path: Path,
    ) -> Dict[str, Any]:
        """
        Extract a compact schema summary from a Parquet dataset for LLM context injection.

        Returns:
            Dictionary with column names, types, categorical columns, and numeric columns.
        """
        conn = cls._create_connection()
        try:
            conn.execute(
                f"CREATE VIEW dataset AS SELECT * FROM read_parquet('{parquet_path.as_posix()}')"
            )

            describe_res = conn.execute("DESCRIBE dataset").fetchall()
            columns: Dict[str, str] = {}
            categorical_cols: List[str] = []
            numeric_cols: List[str] = []

            varchar_types = {"VARCHAR", "TEXT", "STRING", "CHAR", "BPCHAR"}
            numeric_types = {
                "INTEGER", "INT", "BIGINT", "SMALLINT", "TINYINT",
                "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "REAL",
                "HUGEINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT",
            }

            for row in describe_res:
                col_name = str(row[0])
                col_type = str(row[1]).upper()
                columns[col_name] = col_type

                base_type = col_type.split("(")[0].strip()
                if base_type in varchar_types:
                    categorical_cols.append(col_name)
                elif base_type in numeric_types:
                    numeric_cols.append(col_name)

            # Get row count
            count_res = conn.execute("SELECT COUNT(*) FROM dataset").fetchone()
            row_count = count_res[0] if count_res else 0

            # Get sample values for categorical columns (for LLM context)
            sample_values: Dict[str, List[str]] = {}
            for col in categorical_cols[:5]:  # Limit to first 5 categorical columns
                samples = conn.execute(
                    f'SELECT DISTINCT "{col}" FROM dataset '
                    f'WHERE "{col}" IS NOT NULL LIMIT 5'
                ).fetchall()
                sample_values[col] = [str(s[0]) for s in samples]

            return {
                "columns": columns,
                "categorical_columns": categorical_cols,
                "numeric_columns": numeric_cols,
                "row_count": row_count,
                "sample_values": sample_values,
            }

        finally:
            conn.close()
