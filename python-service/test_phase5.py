"""
Phase 5 Architecture Test Suite — AI & Conversational Intelligence Engine.
Tests Root-Cause Variance Decomposition (DuckDB), Grounded Narrative Generation,
Next Best Question Generation, and FastAPI Endpoints.
"""

import asyncio
from pathlib import Path
import tempfile
import duckdb
import pandas as pd
from fastapi.testclient import TestClient

from app.main import app
from models.intelligence import (
    VarianceDriver,
    VarianceRequest,
    VarianceResponse,
    NextQuestionsRequest,
    NextQuestionsResponse,
)
from services.diagnostic_engine import DiagnosticAnalyzer
from services.recommendation_engine import RecommendationEngine

client = TestClient(app)


def _create_sample_parquet(tmp_dir: Path) -> Path:
    """Create a mock dataset with dates, metrics, and categories."""
    data = {
        "order_date": [
            "2024-01-15", "2024-02-10", "2024-03-20", # Baseline period (Q1)
            "2024-01-20", "2024-02-15", "2024-03-25",
            "2024-04-10", "2024-05-15", "2024-06-20", # Comparison period (Q2)
            "2024-04-15", "2024-05-20", "2024-06-25",
        ],
        "region": [
            "North", "North", "South",
            "West", "North", "South",
            "North", "North", "South",
            "West", "North", "South",
        ],
        "category": [
            "Electronics", "Furniture", "Electronics",
            "Electronics", "Furniture", "Furniture",
            "Electronics", "Furniture", "Electronics",
            "Electronics", "Furniture", "Furniture",
        ],
        "revenue": [
            1000.0, 1500.0, 800.0,
            1200.0, 1400.0, 900.0,   # Baseline Total: 6800.0
            600.0, 700.0, 400.0,
            800.0, 600.0, 500.0,     # Comparison Total: 3600.0 (Drop of 3200.0)
        ],
    }
    df = pd.DataFrame(data)
    parquet_path = tmp_dir / "sample_sales.parquet"
    df.to_parquet(parquet_path)
    return parquet_path


def test_diagnostic_analyzer():
    print("\n=======================================================")
    print("1. Testing DuckDB Statistical Variance Decomposition Engine")
    print("=======================================================")

    with tempfile.TemporaryDirectory() as tmp:
        p_path = _create_sample_parquet(Path(tmp))

        res = DiagnosticAnalyzer.analyze_variance(
            parquet_path=p_path,
            metric_column="revenue",
            date_column="order_date",
            baseline_start="2024-01-01",
            baseline_end="2024-03-31",
            comparison_start="2024-04-01",
            comparison_end="2024-06-30",
            dimension_columns=["region", "category"],
            aggregation="SUM",
            top_n=3,
        )

        assert res["baseline_total"] == 6800.0
        assert res["comparison_total"] == 3600.0
        assert res["total_absolute_change"] == -3200.0
        assert round(res["total_percentage_change"], 2) == -47.06
        assert len(res["top_drivers"]) > 0

        print(f" [OK] Baseline Total: ${res['baseline_total']}")
        print(f" [OK] Comparison Total: ${res['comparison_total']}")
        print(f" [OK] Absolute Change: ${res['total_absolute_change']}")
        print(f" [OK] Top Drivers Count: {len(res['top_drivers'])}")
        driver = res["top_drivers"][0]
        print(f" [OK] Primary Driver: [{driver.dimension}={driver.segment}] change=${driver.absolute_change} ({driver.contribution_pct}%)")


def test_recommendation_engine_fallback_narrative():
    print("\n=======================================================")
    print("2. Testing Recommendation Engine Narrative Fallback")
    print("=======================================================")

    drivers = [
        VarianceDriver(
            dimension="region",
            segment="North",
            baseline_value=3900.0,
            comparison_value=1900.0,
            absolute_change=-2000.0,
            percentage_change=-51.28,
            contribution_pct=62.5,
        )
    ]

    narrative = RecommendationEngine.generate_variance_narrative(
        metric_column="revenue",
        aggregation="SUM",
        baseline_total=6800.0,
        comparison_total=3600.0,
        total_absolute_change=-3200.0,
        total_percentage_change=-47.06,
        top_drivers=drivers,
    )

    assert isinstance(narrative, str)
    assert len(narrative) > 0
    print(f" [OK] Narrative Generated:\n  \"{narrative}\"")


def test_recommendation_engine_next_questions():
    print("\n=======================================================")
    print("3. Testing Next Best Question Recommendation Chips")
    print("=======================================================")

    questions = RecommendationEngine.generate_next_questions(
        schema_summary="Columns: revenue (DOUBLE), region (VARCHAR), category (VARCHAR)",
        last_query="What is the total revenue by region?",
        last_sql="SELECT region, SUM(revenue) FROM sales GROUP BY region",
        last_result_columns=["region", "SUM(revenue)"],
        last_result_sample=[{"region": "North", "SUM(revenue)": 1900.0}],
    )

    assert isinstance(questions, list)
    assert len(questions) == 3
    for q in questions:
        assert isinstance(q, str)
        print(f" [OK] Suggestion Chip: \"{q}\"")


def test_api_root_cause():
    print("\n=======================================================")
    print("4. Testing POST /api/intelligence/root-cause API Endpoint")
    print("=======================================================")

    with tempfile.TemporaryDirectory() as tmp:
        p_path = _create_sample_parquet(Path(tmp))

        payload = {
            "parquet_path": str(p_path),
            "metric_column": "revenue",
            "date_column": "order_date",
            "baseline_start": "2024-01-01",
            "baseline_end": "2024-03-31",
            "comparison_start": "2024-04-01",
            "comparison_end": "2024-06-30",
            "dimension_columns": ["region", "category"],
            "aggregation": "SUM",
            "top_n": 3,
        }

        response = client.post("/api/intelligence/root-cause", json=payload)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["metric_column"] == "revenue"
        assert data["baseline_total"] == 6800.0
        assert data["comparison_total"] == 3600.0
        assert "narrative" in data
        assert len(data["top_drivers"]) > 0
        print(f" [OK] Status Code: {response.status_code}")
        print(f" [OK] Narrative Returned: \"{data['narrative']}\"")


def test_api_next_questions():
    print("\n=======================================================")
    print("5. Testing POST /api/intelligence/next-questions API Endpoint")
    print("=======================================================")

    with tempfile.TemporaryDirectory() as tmp:
        p_path = _create_sample_parquet(Path(tmp))

        payload = {
            "parquet_path": str(p_path),
            "last_query": "Show me total revenue",
            "last_sql": "SELECT SUM(revenue) FROM sales",
            "last_result_columns": ["SUM(revenue)"],
            "last_result_sample": [{"SUM(revenue)": 10400.0}],
        }

        response = client.post("/api/intelligence/next-questions", json=payload)
        assert response.status_code == 200, response.text
        data = response.json()
        assert "questions" in data
        assert len(data["questions"]) == 3
        print(f" [OK] Status Code: {response.status_code}")
        print(f" [OK] Questions count: {len(data['questions'])}")
        print(f" [OK] First Question: \"{data['questions'][0]}\"")


if __name__ == "__main__":
    test_diagnostic_analyzer()
    test_recommendation_engine_fallback_narrative()
    test_recommendation_engine_next_questions()
    test_api_root_cause()
    test_api_next_questions()
    print("\n=======================================================")
    print(" ALL PHASE 5 TESTS PASSED SUCCESSFULLY! ")
    print("=======================================================\n")
