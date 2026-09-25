"""
Stateless DuckDB OLAP Engine Service.
Executes vectorized SQL transformations and dataset ingestion using DuckDB.
Ensures zero main-thread blocking by running all heavy computational tasks in worker thread pools.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from decimal import Decimal
import logging
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple, Union
import duckdb

from app.core.config import settings
from app.schemas.dataset import ColumnInfo, DatasetSchema, QueryResult

logger = logging.getLogger("insightai.duckdb_engine")

# Dedicated thread pool executor for CPU-heavy DuckDB queries
_thread_pool = ThreadPoolExecutor(max_workers=settings.DUCKDB_THREADS)


class DuckDBEngine:
    """Enterprise Stateless DuckDB Analytics Engine."""

    @staticmethod
    def _create_ephemeral_connection() -> duckdb.DuckDBPyConnection:
        """Create a new, isolated in-memory DuckDB connection configured with resource boundaries."""
        conn = duckdb.connect(database=":memory:", read_only=False)
        conn.execute(f"SET memory_limit = '{settings.DUCKDB_MEMORY_LIMIT}';")
        conn.execute(f"SET threads = {settings.DUCKDB_THREADS};")
        return conn

    @staticmethod
    def _serialize_value(val: Any) -> Any:
        """Convert DuckDB-native return objects (dates, decimals, bytes) into JSON-compatible values."""
        if isinstance(val, (datetime, date)):
            return val.isoformat()
        if isinstance(val, Decimal):
            return float(val)
        if isinstance(val, bytes):
            return val.decode("utf-8", errors="replace")
        return val

    @classmethod
    def _sync_ingest_file_to_parquet(
        cls, file_path: Path, output_parquet_path: Path
    ) -> Dict[str, Any]:
        """Synchronously ingest a raw dataset file (CSV/JSON/Parquet) and persist as an optimized Parquet file."""
        conn = cls._create_ephemeral_connection()
        try:
            suffix = file_path.suffix.lower()

            # Materialize source file into DuckDB temporary relation or write Parquet directly
            if suffix in [".csv", ".txt", ".tsv"]:
                delim = "\t" if suffix == ".tsv" else ","
                read_stmt = (
                    f"SELECT * FROM read_csv_auto('{file_path.as_posix()}', "
                    f"delim='{delim}', header=True, ignore_errors=True)"
                )
                copy_stmt = (
                    f"COPY ({read_stmt}) TO '{output_parquet_path.as_posix()}' "
                    f"(FORMAT PARQUET, COMPRESSION 'SNAPPY')"
                )
                conn.execute(copy_stmt)
            elif suffix == ".json":
                read_stmt = f"SELECT * FROM read_json_auto('{file_path.as_posix()}')"
                copy_stmt = (
                    f"COPY ({read_stmt}) TO '{output_parquet_path.as_posix()}' "
                    f"(FORMAT PARQUET, COMPRESSION 'SNAPPY')"
                )
                conn.execute(copy_stmt)
            elif suffix == ".parquet":
                read_stmt = f"SELECT * FROM read_parquet('{file_path.as_posix()}')"
                copy_stmt = (
                    f"COPY ({read_stmt}) TO '{output_parquet_path.as_posix()}' "
                    f"(FORMAT PARQUET, COMPRESSION 'SNAPPY')"
                )
                conn.execute(copy_stmt)
            elif suffix in [".xlsx", ".xls", ".xlsm", ".xlsb"]:
                import pandas as pd
                df = pd.read_excel(file_path)
                df.columns = [str(c).strip() for c in df.columns]
                df.to_parquet(str(output_parquet_path), engine="pyarrow", compression="snappy", index=False)
            else:
                raise ValueError(f"Unsupported file format for ingestion: {suffix}")

            # Extract dataset metadata statelessly from generated Parquet file
            count_res = conn.execute(
                f"SELECT COUNT(*) FROM read_parquet('{output_parquet_path.as_posix()}')"
            ).fetchone()
            total_rows = count_res[0] if count_res else 0

            describe_res = conn.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{output_parquet_path.as_posix()}')"
            ).fetchall()

            columns_info: List[ColumnInfo] = []
            for col in describe_res:
                col_name = str(col[0])
                col_type = str(col[1])
                nullable = str(col[2]).upper() == "YES"

                # Fetch sample values statelessly
                sample_res = conn.execute(
                    f"SELECT DISTINCT \"{col_name}\" FROM read_parquet('{output_parquet_path.as_posix()}') "
                    f"WHERE \"{col_name}\" IS NOT NULL LIMIT 5"
                ).fetchall()
                samples = [cls._serialize_value(r[0]) for r in sample_res]

                columns_info.append(
                    ColumnInfo(
                        name=col_name,
                        data_type=col_type,
                        nullable=nullable,
                        sample_values=samples,
                    )
                )

            return {
                "parquet_path": str(output_parquet_path),
                "total_rows": total_rows,
                "total_columns": len(columns_info),
                "columns": columns_info,
            }
        finally:
            conn.close()

    @classmethod
    async def ingest_file_to_parquet(
        cls, file_path: Path, output_parquet_path: Path
    ) -> Dict[str, Any]:
        """Asynchronously ingest a dataset file in a non-blocking thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            cls._sync_ingest_file_to_parquet,
            file_path,
            output_parquet_path,
        )

    @classmethod
    def _sync_execute_query(
        cls,
        sql_query: str,
        parquet_path: Optional[Path] = None,
        table_name: str = "dataset",
        limit: Optional[int] = 1000,
    ) -> QueryResult:
        """Synchronously execute a vectorized DuckDB SQL query against a registered Parquet file or in-memory view."""
        start_time = time.perf_counter()
        conn = cls._create_ephemeral_connection()

        try:
            # Register parquet table view if provided
            if parquet_path and parquet_path.exists():
                conn.execute(
                    f"CREATE VIEW {table_name} AS SELECT * FROM read_parquet('{parquet_path.as_posix()}')"
                )

            # Restrict non-SELECT statements for safety in query endpoint
            stripped_sql = sql_query.strip().strip(";").lower()
            if not (stripped_sql.startswith("select") or stripped_sql.startswith("with")):
                raise ValueError("Only SELECT or WITH queries are permitted for execution.")

            # Apply row limit if provided
            final_sql = sql_query.strip().rstrip(";")
            if limit and "limit" not in stripped_sql:
                final_sql += f" LIMIT {limit}"

            # Execute query
            cursor = conn.execute(final_sql)

            # Extract schema metadata
            description = cursor.description
            column_names = [desc[0] for desc in description] if description else []
            column_types = [str(desc[1]) for desc in description] if description else []

            # Fetch rows statelessly without Pandas dependency
            raw_rows = cursor.fetchall()
            serialized_rows = [
                {
                    col_name: cls._serialize_value(val)
                    for col_name, val in zip(column_names, row)
                }
                for row in raw_rows
            ]

            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            return QueryResult(
                columns=column_names,
                column_types=column_types,
                rows=serialized_rows,
                row_count=len(serialized_rows),
                execution_time_ms=round(elapsed_ms, 2),
                sql_executed=final_sql,
            )
        finally:
            conn.close()

    @classmethod
    async def execute_query(
        cls,
        sql_query: str,
        parquet_path: Optional[Path] = None,
        table_name: str = "dataset",
        limit: Optional[int] = 1000,
    ) -> QueryResult:
        """Asynchronously execute a vectorized DuckDB query in a non-blocking thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            cls._sync_execute_query,
            sql_query,
            parquet_path,
            table_name,
            limit,
        )

    @classmethod
    def _sync_get_schema(cls, dataset_id: str, parquet_path: Path) -> DatasetSchema:
        """Inspect and return schema metadata and sample rows for a Parquet dataset."""
        conn = cls._create_ephemeral_connection()
        try:
            conn.execute(
                f"CREATE VIEW dataset AS SELECT * FROM read_parquet('{parquet_path.as_posix()}')"
            )

            count_res = conn.execute("SELECT COUNT(*) FROM dataset").fetchone()
            total_rows = count_res[0] if count_res else 0

            describe_res = conn.execute("DESCRIBE SELECT * FROM dataset").fetchall()
            columns_info: List[ColumnInfo] = []

            for col in describe_res:
                col_name = str(col[0])
                col_type = str(col[1])
                nullable = str(col[2]).upper() == "YES"

                samples_res = conn.execute(
                    f"SELECT DISTINCT \"{col_name}\" FROM dataset WHERE \"{col_name}\" IS NOT NULL LIMIT 3"
                ).fetchall()
                samples = [cls._serialize_value(r[0]) for r in samples_res]

                columns_info.append(
                    ColumnInfo(
                        name=col_name,
                        data_type=col_type,
                        nullable=nullable,
                        sample_values=samples,
                    )
                )

            # Fetch preview rows
            preview_cursor = conn.execute("SELECT * FROM dataset LIMIT 10")
            col_names = [d[0] for d in preview_cursor.description]
            preview_rows = [
                {k: cls._serialize_value(v) for k, v in zip(col_names, r)}
                for r in preview_cursor.fetchall()
            ]

            file_size = parquet_path.stat().st_size if parquet_path.exists() else 0

            return DatasetSchema(
                dataset_id=dataset_id,
                file_size_bytes=file_size,
                total_rows=total_rows,
                total_columns=len(columns_info),
                columns=columns_info,
                preview=preview_rows,
            )
        finally:
            conn.close()

    @classmethod
    async def get_schema(cls, dataset_id: str, parquet_path: Path) -> DatasetSchema:
        """Asynchronously fetch dataset schema metadata in a non-blocking thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            cls._sync_get_schema,
            dataset_id,
            parquet_path,
        )

    @classmethod
    def _sync_materialize_query_to_parquet(
        cls,
        sql_query: str,
        output_parquet_path: Path,
        parquet_path: Optional[Path] = None,
        table_name: str = "dataset",
    ) -> Dict[str, Any]:
        """Materialize a SQL query directly to a Parquet file without converting to intermediate Pandas dataframes."""
        start_time = time.perf_counter()
        conn = cls._create_ephemeral_connection()
        try:
            if parquet_path and parquet_path.exists():
                conn.execute(
                    f"CREATE VIEW {table_name} AS SELECT * FROM read_parquet('{parquet_path.as_posix()}')"
                )

            cleaned_sql = sql_query.strip().rstrip(";")
            copy_stmt = (
                f"COPY ({cleaned_sql}) TO '{output_parquet_path.as_posix()}' "
                f"(FORMAT PARQUET, COMPRESSION 'SNAPPY')"
            )
            conn.execute(copy_stmt)

            count_res = conn.execute(
                f"SELECT COUNT(*) FROM read_parquet('{output_parquet_path.as_posix()}')"
            ).fetchone()
            total_rows = count_res[0] if count_res else 0

            describe_res = conn.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{output_parquet_path.as_posix()}')"
            ).fetchall()

            columns_info: List[ColumnInfo] = []
            for col in describe_res:
                col_name = str(col[0])
                col_type = str(col[1])
                nullable = str(col[2]).upper() == "YES"

                sample_res = conn.execute(
                    f"SELECT DISTINCT \"{col_name}\" FROM read_parquet('{output_parquet_path.as_posix()}') "
                    f"WHERE \"{col_name}\" IS NOT NULL LIMIT 3"
                ).fetchall()
                samples = [cls._serialize_value(r[0]) for r in sample_res]

                columns_info.append(
                    ColumnInfo(
                        name=col_name,
                        data_type=col_type,
                        nullable=nullable,
                        sample_values=samples,
                    )
                )

            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            return {
                "parquet_path": str(output_parquet_path),
                "total_rows": total_rows,
                "total_columns": len(columns_info),
                "columns": columns_info,
                "execution_time_ms": round(elapsed_ms, 2),
            }
        finally:
            conn.close()

    @classmethod
    async def materialize_query_to_parquet(
        cls,
        sql_query: str,
        output_parquet_path: Path,
        parquet_path: Optional[Path] = None,
        table_name: str = "dataset",
    ) -> Dict[str, Any]:
        """Asynchronously materialize a SQL query to Parquet in the worker thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            cls._sync_materialize_query_to_parquet,
            sql_query,
            output_parquet_path,
            parquet_path,
            table_name,
        )

