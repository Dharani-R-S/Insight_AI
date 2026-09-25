"""
Phase 3 Architecture Test Suite — Vectorized Data Transformation Engine.
Tests DuckDBCompiler CTE Chaining, Filter, Calculate, Aggregate, Impute, Join,
SQL Injection Prevention, Preview Endpoint, and Commit Materialization.
"""

import asyncio
from pathlib import Path
import tempfile
from fastapi.testclient import TestClient

from app.main import app
from app.models.transform import (
    AggregateStep,
    AggregationField,
    AggregationFunction,
    CalculateStep,
    CommitRequest,
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
    SortColumn,
    SortStep,
)
from app.services.duckdb_engine import DuckDBEngine
from app.services.transformation_compiler import DuckDBCompiler

client = TestClient(app)


def test_compiler_cte_chaining_and_security():
    print("--- 1. Testing DuckDBCompiler CTE Chaining & SQL Injection Safety ---")

    pipeline = PipelineRequest(
        source_table="sales_data",
        steps=[
            FilterStep(column="revenue", operator=">", value=100.0),
            CalculateStep(new_column="profit", col1="revenue", op="-", col2="cost"),
            AggregateStep(
                group_by=["category"],
                aggregations=[
                    AggregationField(column="profit", func="sum", alias="total_profit"),
                    AggregationField(column="*", func="count", alias="order_count"),
                ],
            ),
        ],
    )

    sql = DuckDBCompiler.compile_pipeline(pipeline, limit=50)
    print(f"[Generated SQL Plan]:\n{sql}\n")

    assert "WITH" in sql
    assert "step_0 AS" in sql
    assert "step_1 AS" in sql
    assert "step_2 AS" in sql
    assert "step_3 AS" in sql
    assert "FROM step_3" in sql
    assert "LIMIT 50" in sql
    print("[OK] CTE Chaining compiled with valid structure.")


    # Test Identifier & Literal Escaping / Injection Prevention
    malicious_col = 'category"; DROP TABLE sales_data; --'
    escaped_id = DuckDBCompiler.escape_identifier(malicious_col)
    assert '""' in escaped_id
    assert escaped_id.startswith('"') and escaped_id.endswith('"')

    malicious_val = "Tech' OR '1'='1"
    escaped_val = DuckDBCompiler.escape_literal(malicious_val)
    assert "''" in escaped_val
    print("[OK] SQL Identifier and Literal escaping safely defuses injection attempts.")


def test_compiler_operations():
    print("\n--- 2. Testing Transformation Step Compilation Logic ---")

    # 1. Filter
    f_step = FilterStep(column="name", operator="contains", value="Laptop")
    f_sql = DuckDBCompiler.compile_filter(f_step, "step_0")
    assert "ILIKE '%Laptop%'" in f_sql
    print("   [OK] Filter compilation verified.")

    # 2. Calculate (with divide by zero protection)
    c_step = CalculateStep(new_column="margin", col1="profit", op="/", col2="revenue")
    c_sql = DuckDBCompiler.compile_calculate(c_step, "step_1")
    assert "CASE WHEN" in c_sql
    print("   [OK] Calculate compilation verified.")

    # 3. Aggregate
    a_step = AggregateStep(
        group_by=["region", "store"],
        aggregations=[
            AggregationField(column="revenue", func="avg", alias="avg_rev"),
            AggregationField(column="customer_id", func="count_distinct", alias="unique_customers"),
        ],
    )
    a_sql = DuckDBCompiler.compile_aggregate(a_step, "step_2")
    assert "AVG(\"revenue\")" in a_sql
    assert "COUNT(DISTINCT \"customer_id\")" in a_sql
    assert "GROUP BY \"region\", \"store\"" in a_sql
    print("   [OK] Aggregate compilation verified.")

    # 4. Impute
    imp_mean = ImputeStep(column="score", strategy="mean")
    imp_sql = DuckDBCompiler.compile_impute(imp_mean, "step_3")
    assert "AVG(\"score\") OVER ()" in imp_sql
    assert "EXCLUDE (\"score\")" in imp_sql
    print("   [OK] Impute (Mean window function) compilation verified.")

    # 5. Join
    j_step = JoinStep(
        join_type="left",
        right_table="customers",
        left_on="customer_id",
        right_on="id",
    )
    right_cte, j_sql = DuckDBCompiler.compile_join(j_step, "step_4", 1)
    assert "LEFT JOIN \"customers\"" in j_sql
    assert "step_4.\"customer_id\" = \"customers\".\"id\"" in j_sql
    print("   [OK] Join compilation verified.")

    # 6. Rename
    r_step = RenameStep(old_column="old_name", new_column="new_name")
    r_sql = DuckDBCompiler.compile_rename(r_step, "step_5")
    assert 'RENAME ("old_name" AS "new_name")' in r_sql
    print("   [OK] Rename compilation verified.")


async def test_end_to_end_preview_and_commit():
    print("\n--- 3. Testing End-to-End Preview & Commit Endpoints with DuckDB ---")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        sales_csv = tmp_path / "sales.csv"
        customers_csv = tmp_path / "customers.csv"
        sales_parquet = tmp_path / "sales.parquet"
        customers_parquet = tmp_path / "customers.parquet"

        # Create primary sales dataset (with nulls for imputation)
        sales_data = (
            "order_id,cust_id,category,price,units,discount\n"
            "1,C101,Electronics,1200.0,2,\n"
            "2,C102,Books,40.0,3,5.0\n"
            "3,C101,Electronics,800.0,1,10.0\n"
            "4,C103,Furniture,350.0,4,\n"
            "5,C102,Books,60.0,1,0.0\n"
            "6,C104,Electronics,2000.0,2,50.0\n"
        )
        sales_csv.write_text(sales_data, encoding="utf-8")

        # Create secondary customers dataset
        customers_data = (
            "cust_id,cust_name,tier\n"
            "C101,Acme Corp,Enterprise\n"
            "C102,Beta Ltd,SMB\n"
            "C103,Gamma Inc,SMB\n"
            "C104,Delta LLC,Enterprise\n"
        )
        customers_csv.write_text(customers_data, encoding="utf-8")

        # Ingest both datasets to Parquet
        await DuckDBEngine.ingest_file_to_parquet(sales_csv, sales_parquet)
        await DuckDBEngine.ingest_file_to_parquet(customers_csv, customers_parquet)

        # Build Multi-Step Transformation Pipeline
        # Step 1: Impute missing discounts with 0.0
        # Step 2: Calculate gross_total = price * units
        # Step 3: Calculate net_total = gross_total - discount
        # Step 4: Filter rows where net_total > 50
        # Step 5: Join with Customers dataset
        # Step 6: Group by category & tier, aggregate sum(net_total)
        pipeline_steps = [
            {"type": "impute", "column": "discount", "strategy": "zero"},
            {"type": "calculate", "new_column": "gross_total", "col1": "price", "op": "*", "col2": "units"},
            {"type": "calculate", "new_column": "net_total", "col1": "gross_total", "op": "-", "col2": "discount"},
            {"type": "filter", "column": "net_total", "operator": ">", "value": 50.0},
            {
                "type": "join",
                "join_type": "inner",
                "right_parquet_path": str(customers_parquet),
                "left_on": "cust_id",
                "right_on": "cust_id",
            },
            {
                "type": "aggregate",
                "group_by": ["category", "tier"],
                "aggregations": [
                    {"column": "net_total", "func": "sum", "alias": "total_revenue"},
                    {"column": "*", "func": "count", "alias": "order_count"},
                ],
            },
        ]

        # 1. Test POST /api/transform/preview
        preview_payload = {
            "parquet_path": str(sales_parquet),
            "steps": pipeline_steps,
            "limit": 10,
        }
        preview_res = client.post("/api/transform/preview", json=preview_payload)
        assert preview_res.status_code == 200, preview_res.text
        preview_data = preview_res.json()

        assert "total_revenue" in preview_data["columns"]
        assert "order_count" in preview_data["columns"]
        assert preview_data["row_count"] > 0
        assert preview_data["total_steps"] == 6
        print(f"[OK] Transformation Preview Succeeded! Rows returned: {len(preview_data['rows'])}")
        print(f"     Preview Output: {preview_data['rows']}")
        print(f"     Execution Time: {preview_data['execution_time_ms']}ms")

        # 2. Test POST /api/transform/commit (Physical Materialization)
        commit_payload = {
            "parquet_path": str(sales_parquet),
            "steps": pipeline_steps,
            "target_dataset_name": "Transformed Revenue Summary",
        }
        commit_res = client.post("/api/transform/commit", json=commit_payload)
        assert commit_res.status_code == 201, commit_res.text
        commit_data = commit_res.json()

        assert commit_data["dataset_name"] == "Transformed Revenue Summary"
        assert Path(commit_data["parquet_path"]).exists()
        assert commit_data["total_rows"] == preview_data["row_count"]
        assert commit_data["total_columns"] >= 4
        print(f"[OK] Transformation Commit Succeeded! Parquet written to: {commit_data['parquet_path']}")
        print(f"     Committed {commit_data['total_rows']} rows, {commit_data['total_columns']} columns.")


async def main():
    test_compiler_cte_chaining_and_security()
    test_compiler_operations()
    await test_end_to_end_preview_and_commit()
    print("\n=======================================================")
    print("ALL PHASE 3 TRANSFORMATION ENGINE TESTS PASSED!")
    print("=======================================================")


if __name__ == "__main__":
    asyncio.run(main())
