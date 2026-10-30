# -*- coding: utf-8 -*-
"""
Test Suite verifying all Copilot Pull Request Review fixes.
Covers:
  1. Avoid sending raw uploaded records to external LLMs (privacy opt-in & redaction)
  2. Multi-word greetings phrase matching & generic interrogative guardrails
  3. String schema fallback in RecommendationEngine (no UnboundLocalError)
  4. FeatureAnalyzer recommendation deduplication with df (no NameError)
  5. Correlation insights skipped on constant numeric columns (no r = nan)
  6. Percentage formatting precedence before currency in database summary stats
  7. Data completeness computed from actual non-null cells
  8. Numeric calendar year time-series chart detection & generation (no scatter or epoch 1970)
"""

import sys
import os
import io
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from services.llm import is_out_of_bounds_query, nl_to_sql, _sanitize_sample_row
from services.analysis import generate_insights
from services.database import compute_dataset_summary_stats
from services.feature_analyzer import FeatureAnalyzer
from services.recommendation_engine import RecommendationEngine
from services.charts import detect_chart_type
from services.chart_generator import generate_line


def test_1_privacy_and_sample_rows():
    print("\n--- Test 1: Avoid sending raw uploaded records to external LLMs ---")
    schema = {"id": "INTEGER", "name": "TEXT", "email": "TEXT", "salary": "REAL"}
    sample_rows = [{"id": 1, "name": "Alice Secret", "email": "alice@confidential.com", "salary": 150000}]

    # By default (allow_sample_rows not set / False), sample row must NOT be in prompt
    # We test _sanitize_sample_row directly
    sanitized = _sanitize_sample_row(sample_rows[0])
    assert sanitized["email"] == "[REDACTED]", f"Expected email redacted, got: {sanitized['email']}"
    assert sanitized["salary"] == "[REDACTED]", f"Expected salary redacted, got: {sanitized['salary']}"

    # Also test value pattern sanitizer (e.g. email in custom col)
    custom_row = {"user_info": "john.doe@example.com", "phone_num": "555-123-4567"}
    sanitized_custom = _sanitize_sample_row(custom_row)
    assert sanitized_custom["user_info"] == "[REDACTED_EMAIL]"
    assert sanitized_custom["phone_num"] == "[REDACTED]" or sanitized_custom["phone_num"] == "[REDACTED_PHONE]"

    print(" [PASS] Privacy sanitization and redaction verified successfully.")


def test_2_multi_word_greetings_and_generic_interrogatives():
    print("\n--- Test 2: Multi-word greetings & generic interrogatives ---")
    schema = {"sales": "REAL", "region": "TEXT"}

    greetings = [
        "good morning",
        "good afternoon",
        "Good Evening!",
        "thank you",
        "thanks a lot",
        "what is this",
        "what can you do",
        "how to use this",
    ]
    for g in greetings:
        is_out, msg = is_out_of_bounds_query(g, schema)
        assert is_out, f"Greeting '{g}' should be intercepted"
        assert msg.startswith("CONVERSATIONAL:"), f"Greeting '{g}' missing CONVERSATIONAL prefix: {msg}"
        print(f" [PASS] Greeting intercepted: '{g}'")

    # Generic interrogatives that do not contain dataset/BI intent should be out of bounds
    generic_questions = [
        "What is the best movie of all time?",
        "Which car should I buy in 2026?",
        "What happened in the year 1945?",
    ]
    for q in generic_questions:
        is_out, msg = is_out_of_bounds_query(q, schema)
        assert is_out, f"Generic interrogative '{q}' should be intercepted as OUT_OF_BOUNDS"
        assert msg.startswith("OUT_OF_BOUNDS:"), f"Expected OUT_OF_BOUNDS prefix for '{q}': {msg}"
        print(f" [PASS] Generic interrogative blocked: '{q}'")


def test_3_string_schema_recommendation_fallback():
    print("\n--- Test 3: RecommendationEngine string schema fallback ---")
    # When schema_summary is string and LLM fails/mocked, fallback must NOT raise UnboundLocalError
    questions = RecommendationEngine.generate_next_questions(
        schema_summary="Columns: revenue (DOUBLE), region (VARCHAR), category (VARCHAR)",
        last_query="What is the total revenue by region?",
        llm_config={"provider": "invalid_provider", "api_key": "dummy"},
    )
    assert isinstance(questions, list), "Expected list of questions"
    assert len(questions) == 3, f"Expected exactly 3 questions, got: {len(questions)}"
    for q in questions:
        assert isinstance(q, str) and len(q) > 0
    print(f" [PASS] String schema fallback generated 3 questions without UnboundLocalError: {questions}")


def test_4_feature_analyzer_deduplication():
    print("\n--- Test 4: FeatureAnalyzer deduplication with DataFrame ---")
    df = pd.DataFrame({
        "order_date": pd.date_range("2024-01-01", periods=10),
        "sales": np.arange(10) * 100.0,
        "region": ["North", "South"] * 5,
    })
    analyzer = FeatureAnalyzer()
    recs = [
        {
            "type": "line",
            "title": "sales over time",
            "features": ["order_date", "sales"],
            "x_axis": "order_date",
            "y_axis": "sales",
            "confidence": 0.9,
        },
        {
            "type": "line",
            "title": "sales over time duplicate",
            "features": ["order_date", "sales"],
            "x_axis": "order_date",
            "y_axis": "sales",
            "confidence": 0.8,
        },
    ]
    # Calling with df should not raise NameError
    unique = analyzer._deduplicate_recommendations(recs, df)
    assert len(unique) == 1, f"Expected 1 unique recommendation, got {len(unique)}"
    print(f" [PASS] _deduplicate_recommendations deduplicated cleanly without NameError.")


def test_5_constant_column_correlation_skip():
    print("\n--- Test 5: Skip correlation insights for constant numeric columns ---")
    # Column B is constant (all 10.0) -> correlation is nan
    df = pd.DataFrame({
        "metric_a": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
        "metric_b": [10.0, 10.0, 10.0, 10.0, 10.0, 10.0],
    })
    insights = generate_insights(df)
    for insight in insights:
        assert "nan" not in insight.lower(), f"Emitted nan correlation insight: {insight}"
        assert "correlation" not in insight.lower(), f"Constant column emitted correlation: {insight}"
    print(" [PASS] Constant column correlation was skipped; no 'r = nan' insight emitted.")


def test_6_percentage_precedence_over_currency():
    print("\n--- Test 6: Percentage precedence before currency formatting ---")
    df = pd.DataFrame({
        "profit_margin_pct": [12.5, 14.2, 10.8, 15.0],
        "total_revenue": [50000.0, 60000.0, 45000.0, 70000.0],
        "region": ["North", "South", "East", "West"],
    })
    stats = compute_dataset_summary_stats(df)
    # primary_col should have is_percentage properly classified
    p_info = stats["primary_metric"]
    s_info = stats["secondary_metric"]

    for info in [p_info, s_info]:
        if info and "margin" in info["column"].lower() or "pct" in info["column"].lower():
            assert info["is_percentage"] is True, f"Expected is_percentage=True for {info['column']}"
            assert info["is_currency"] is False, f"Expected is_currency=False for {info['column']}"
        elif info and "revenue" in info["column"].lower():
            assert info["is_currency"] is True, f"Expected is_currency=True for {info['column']}"
            assert info["is_percentage"] is False, f"Expected is_percentage=False for {info['column']}"

    print(f" [PASS] Percentage precedence verified: {p_info['column']} is_pct={p_info['is_percentage']}, is_curr={p_info['is_currency']}")


def test_7_data_completeness():
    print("\n--- Test 7: Data completeness calculation ---")
    df = pd.DataFrame({
        "col_a": [1, None, 3, 4],
        "col_b": ["x", "y", None, "w"],
    })
    stats = compute_dataset_summary_stats(df)
    assert "completeness_pct" in stats
    assert stats["total_cells"] == 8
    assert stats["non_null_cells"] == 6
    assert stats["completeness_pct"] == 75.0, f"Expected 75.0%, got {stats['completeness_pct']}"
    print(f" [PASS] Data completeness computed accurately: {stats['completeness_pct']}% ({stats['non_null_cells']}/{stats['total_cells']})")


def test_8_chart_type_numeric_year_and_calendar_generator():
    print("\n--- Test 8: Numeric calendar year time-series handling ---")
    df = pd.DataFrame({
        "release_year": [2018, 2019, 2020, 2021, 2022],
        "box_office": [100.0, 150.0, 80.0, 200.0, 250.0],
    })
    # Should detect as line, not scatter
    detected = detect_chart_type(df)
    assert detected == "line", f"Expected 'line' chart for release_year, got '{detected}'"
    print(f" [PASS] detect_chart_type returned '{detected}' for numeric year dataset.")

    # Should not convert 2018 into Jan 1970
    chart_res = generate_line(df, "release_year", "box_office", {})
    assert chart_res["data"], "Expected non-empty chart data"
    first_x = chart_res["data"][0]["name"]
    assert first_x == "2018", f"Expected year '2018', got '{first_x}'"
    print(f" [PASS] generate_line preserved calendar year as '{first_x}' without epoch 1970 conversion.")


if __name__ == "__main__":
    test_1_privacy_and_sample_rows()
    test_2_multi_word_greetings_and_generic_interrogatives()
    test_3_string_schema_recommendation_fallback()
    test_4_feature_analyzer_deduplication()
    test_5_constant_column_correlation_skip()
    test_6_percentage_precedence_over_currency()
    test_7_data_completeness()
    test_8_chart_type_numeric_year_and_calendar_generator()
    print("\n=======================================================")
    print(" ALL COPILOT REVIEW VERIFICATION TESTS PASSED! ")
    print("=======================================================\n")

