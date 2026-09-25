"""
Phase 4 Architecture Test Suite — Semantic Layer & Auto-Visualization Recommender.
Tests Column Profiling, MetricStore Semantic Inference, Heuristic Rule Engine,
UI/UX Dark-Mode Aizen Theme Styling, and POST /api/visualize/auto API Endpoint.
"""

import asyncio
from pathlib import Path
import tempfile
from fastapi.testclient import TestClient

from app.main import app
from app.models.visualization import (
    AxisConfig,
    ChartSpec,
    ChartTheme,
    ChartType,
    MetricFormat,
    MetricStore,
    SemanticMetric,
)
from app.services.duckdb_engine import DuckDBEngine
from app.services.visualization_engine import VisualizationEngine

client = TestClient(app)


def test_semantic_metric_store():
    print("\n=======================================================")
    print("1. Testing MetricStore Semantic Layer Inferences")
    print("=======================================================")

    # 1. Currency Metric Inference
    rev_metric = MetricStore.infer_semantic_metric("total_revenue")
    assert rev_metric.format_type == MetricFormat.CURRENCY
    assert rev_metric.prefix == "$"
    assert rev_metric.unit == "$"
    assert "Revenue" in rev_metric.label
    print(f" [OK] Currency semantic detected: '{rev_metric.name}' -> {rev_metric.label} ({rev_metric.prefix})")

    # 2. Percentage Metric Inference
    margin_metric = MetricStore.infer_semantic_metric("profit_margin_pct")
    assert margin_metric.format_type == MetricFormat.PERCENTAGE
    assert margin_metric.suffix == "%"
    assert margin_metric.decimals == 1
    print(f" [OK] Percentage semantic detected: '{margin_metric.name}' -> {margin_metric.label} ({margin_metric.suffix})")

    # 3. Count / Quantity Metric Inference
    qty_metric = MetricStore.infer_semantic_metric("order_quantity")
    assert qty_metric.format_type == MetricFormat.NUMBER
    assert qty_metric.decimals == 0
    print(f" [OK] Count semantic detected: '{qty_metric.name}' -> {qty_metric.label}")


def test_heuristic_rule_engine():
    print("\n=======================================================")
    print("2. Testing Heuristic Visualization Rule Engine")
    print("=======================================================")

    # Test Case A: Time Series (Date + Numeric) -> Expect Line & Area Charts
    ts_data = [
        {"order_date": "2026-01-01", "sales_usd": 1200.0, "units": 5},
        {"order_date": "2026-01-02", "sales_usd": 1500.0, "units": 8},
        {"order_date": "2026-01-03", "sales_usd": 900.0, "units": 3},
        {"order_date": "2026-01-04", "sales_usd": 2100.0, "units": 10},
    ]
    ts_recs = VisualizationEngine.recommend_visualizations(ts_data)
    rec_types = [c.chart_type for c in ts_recs]
    assert "line" in rec_types
    assert "area" in rec_types
    assert ts_recs[0].confidence >= 0.90
    assert ts_recs[0].theme.mode == "dark"
    assert len(ts_recs[0].theme.palette) >= 8
    print(f" [OK] Rule 1 (Date + Numeric) verified: generated {rec_types}")

    # Test Case B: Low Cardinality Categorical + Numeric -> Expect Bar & Pie Charts
    cat_data = [
        {"department": "Hardware", "revenue": 5000.0},
        {"department": "Software", "revenue": 8500.0},
        {"department": "Cloud", "revenue": 12000.0},
        {"department": "Consulting", "revenue": 3200.0},
    ]
    cat_recs = VisualizationEngine.recommend_visualizations(cat_data)
    cat_types = [c.chart_type for c in cat_recs]
    assert "bar" in cat_types
    assert "pie" in cat_types
    print(f" [OK] Rule 2 (Categorical + Numeric, Cardinality <= 7) verified: generated {cat_types}")

    # Test Case C: Two Numeric Columns -> Expect Scatter Plot
    scatter_data = [
        {"marketing_spend": 100.0, "conversions": 15.0},
        {"marketing_spend": 250.0, "conversions": 38.0},
        {"marketing_spend": 400.0, "conversions": 72.0},
        {"marketing_spend": 550.0, "conversions": 95.0},
    ]
    scatter_recs = VisualizationEngine.recommend_visualizations(scatter_data)
    scatter_types = [c.chart_type for c in scatter_recs]
    assert "scatter" in scatter_types
    print(f" [OK] Rule 3 (Two Continuous Numerics) verified: generated {scatter_types}")


async def test_auto_visualize_api_endpoint():
    print("\n=======================================================")
    print("3. Testing POST /api/visualize/auto Endpoint")
    print("=======================================================")

    # 1. Direct JSON rows payload
    inline_payload = {
        "data": [
            {"region": "North America", "sales": 45000.0, "profit": 12000.0},
            {"region": "EMEA", "sales": 38000.0, "profit": 9500.0},
            {"region": "APAC", "sales": 52000.0, "profit": 16000.0},
            {"region": "LATAM", "sales": 18000.0, "profit": 4000.0},
        ],
        "max_recommendations": 3,
    }
    res = client.post("/api/visualize/auto", json=inline_payload)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["total_rows"] == 4
    assert len(data["recommendations"]) > 0
    assert len(data["detected_metrics"]) >= 2

    top_chart = data["recommendations"][0]
    assert top_chart["chart_type"] in ["bar", "composed", "pie"]
    assert top_chart["theme"]["background"] == "#0f172a"
    assert "data_payload" in top_chart
    assert len(top_chart["data_payload"]) > 0
    print(f" [OK] Direct payload visualization succeeded! Generated {len(data['recommendations'])} specs.")
    print(f"      Top Chart: '{top_chart['title']}' ({top_chart['chart_type']}, confidence: {top_chart['confidence']})")

    # 2. Parquet Dataset with SQL Query Execution
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "metrics.csv"
        parquet_path = tmp_path / "metrics.parquet"

        csv_content = (
            "timestamp,server_id,cpu_usage_pct,memory_mb,latency_ms\n"
            "2026-03-01 00:00:00,srv-1,45.2,1024,12.5\n"
            "2026-03-01 01:00:00,srv-1,62.8,1536,18.2\n"
            "2026-03-01 02:00:00,srv-1,88.4,2048,34.0\n"
            "2026-03-01 03:00:00,srv-1,35.1,890,9.1\n"
        )
        csv_path.write_text(csv_content, encoding="utf-8")
        await DuckDBEngine.ingest_file_to_parquet(csv_path, parquet_path)

        parquet_payload = {
            "parquet_path": str(parquet_path),
            "sql_query": "SELECT timestamp, cpu_usage_pct, latency_ms FROM dataset ORDER BY timestamp ASC",
            "max_recommendations": 3,
        }
        p_res = client.post("/api/visualize/auto", json=parquet_payload)
        assert p_res.status_code == 200, p_res.text
        p_data = p_res.json()

        assert p_data["total_rows"] == 4
        assert len(p_data["recommendations"]) > 0
        time_chart = p_data["recommendations"][0]
        assert time_chart["chart_type"] in ["line", "area", "composed"]
        assert time_chart["x_axis"]["data_type"] == "datetime"
        print(f" [OK] Parquet + SQL query auto-visualization succeeded ({p_data['execution_time_ms']}ms).")
        print(f"      Recommended: {[c['chart_type'] for c in p_data['recommendations']]}")


async def main():
    test_semantic_metric_store()
    test_heuristic_rule_engine()
    await test_auto_visualize_api_endpoint()
    print("\n=======================================================")
    print("ALL PHASE 4 AUTO-VISUALIZATION TESTS PASSED 100%!")
    print("=======================================================")


if __name__ == "__main__":
    asyncio.run(main())
