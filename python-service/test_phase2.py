"""
Phase 2 Architecture Test Suite.
Verifies SQLGlot AST Validation, Groq LLM Text-to-SQL integration,
DuckDB Schema Context Injection, and POST /api/ask API endpoint.
"""

import asyncio
import os
from pathlib import Path
import tempfile
from fastapi.testclient import TestClient

from app.main import app
from app.services.duckdb_engine import DuckDBEngine
from app.services.sql_validator import validate_sql
from app.services.llm_service import LLMService, clean_llm_sql_response
from app.schemas.dataset import ColumnInfo, DatasetSchema

client = TestClient(app)


def test_sql_ast_validator():
    print("--- 1. Testing SQLGlot AST Security Validator ---")

    # Safe Read-Only SELECT Queries
    safe_queries = [
        "SELECT * FROM dataset",
        "SELECT category, SUM(sales) as rev FROM dataset GROUP BY category ORDER BY rev DESC",
        "WITH cte AS (SELECT category, sales FROM dataset WHERE sales > 100) SELECT category, AVG(sales) FROM cte GROUP BY category",
        "SELECT COUNT(*), COUNT(DISTINCT region) FROM dataset",
    ]

    for q in safe_queries:
        formatted = validate_sql(q)
        assert formatted is not None
        assert "SELECT" in formatted.upper()
    print("[OK] All valid SELECT queries passed AST validation.")

    # Unsafe Malicious Queries
    unsafe_queries = [
        "DROP TABLE dataset",
        "DELETE FROM dataset WHERE sales > 0",
        "UPDATE dataset SET sales = 0",
        "INSERT INTO dataset VALUES (1, 'Test', 100)",
        "ALTER TABLE dataset ADD COLUMN hacked VARCHAR",
        "SELECT * FROM dataset; DROP TABLE dataset",
        "TRUNCATE dataset",
    ]

    for uq in unsafe_queries:
        try:
            validate_sql(uq)
            assert False, f"FAILED TO BLOCK UNSAFE QUERY: {uq}"
        except ValueError as ve:
            print(f"   [Blocked Unsafe Query] '{uq}' -> {ve}")

    print("[OK] All unsafe DDL/DML mutation queries were successfully blocked by AST parser.")


def test_llm_cleaner_and_context_injection():
    print("\n--- 2. Testing LLM Response Cleaner & Context Injection ---")

    raw_response = "```sql\nSELECT category, SUM(sales) FROM dataset GROUP BY category;\n```"
    cleaned = clean_llm_sql_response(raw_response)
    assert cleaned == "SELECT category, SUM(sales) FROM dataset GROUP BY category"
    print("[OK] Markdown codeblock cleaning works correctly.")

    dummy_schema = DatasetSchema(
        dataset_id="test_id",
        file_size_bytes=1024,
        total_rows=100,
        total_columns=2,
        columns=[
            ColumnInfo(name="category", data_type="VARCHAR", nullable=True, sample_values=["Tech", "Books"]),
            ColumnInfo(name="sales", data_type="DOUBLE", nullable=True, sample_values=[150.0, 300.5]),
        ],
        preview=[],
    )
    context_str = LLMService.format_schema_context(dummy_schema, "sales_data")
    assert "Table Name: 'sales_data'" in context_str
    assert "category (VARCHAR)" in context_str
    assert "sales (DOUBLE)" in context_str
    print("[OK] Dynamic schema context injection formatting verified.")


async def test_analytics_api_endpoint():
    print("\n--- 3. Testing POST /api/ask Endpoint ---")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "retail.csv"
        parquet_path = tmp_path / "retail.parquet"

        csv_content = (
            "id,store,category,sales,quantity\n"
            "1,Store A,Electronics,1200.0,5\n"
            "2,Store B,Furniture,800.0,2\n"
            "3,Store A,Electronics,1500.0,4\n"
            "4,Store C,Office,300.0,10\n"
        )
        csv_path.write_text(csv_content, encoding="utf-8")

        # Ingest CSV to Parquet
        ingest_res = await DuckDBEngine.ingest_file_to_parquet(csv_path, parquet_path)
        assert ingest_res["total_rows"] == 4

        # Test request without GROQ_API_KEY set (should handle gracefully)
        if not os.getenv("GROQ_API_KEY"):
            print("   [Note] GROQ_API_KEY not set in environment. Testing error boundary...")
            response = client.post(
                "/api/ask",
                json={
                    "question": "What is total sales by category?",
                    "parquet_path": str(parquet_path),
                },
            )
            assert response.status_code == 400
            assert "GROQ_API_KEY" in response.json()["detail"]
            print("[OK] Missing GROQ_API_KEY error handled gracefully with HTTP 400.")
        else:
            print("   [Info] GROQ_API_KEY detected. Testing end-to-end LLM + AST + DuckDB execution...")
            response = client.post(
                "/api/ask",
                json={
                    "question": "What is total sales by category?",
                    "parquet_path": str(parquet_path),
                },
            )
            assert response.status_code == 200, response.text
            payload = response.json()
            assert "validated_sql" in payload
            assert "rows" in payload
            assert isinstance(payload["rows"], list)
            print(f"[OK] End-to-end Execution Succeeded!")
            print(f"     Generated SQL: {payload['validated_sql']}")
            print(f"     Results ({payload['row_count']} rows in {payload['execution_time_ms']}ms): {payload['rows']}")


async def main():
    test_sql_ast_validator()
    test_llm_cleaner_and_context_injection()
    await test_analytics_api_endpoint()
    print("\n==========================================")
    print("ALL PHASE 2 ARCHITECTURE TESTS PASSED SUCCESSFULLY!")
    print("==========================================")


if __name__ == "__main__":
    asyncio.run(main())
