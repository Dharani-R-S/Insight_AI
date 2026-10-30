# -*- coding: utf-8 -*-
"""
InsightAI Core Logic Test Suite — No network calls required.
Tests:
  1. is_out_of_bounds_query   — OOB, conversational, and valid BI queries
  2. nl_to_sql fast paths     — common/show-all, show records where, relationship fast path
  3. _fix_where_having_duplication
  4. generate_insights         — correlation detection for 2-numeric-column results
  5. detect_chart_type         — scatter path for pure numeric data
  6. generate_insights         — top/bottom contributor, range, trend
"""

import sys
import os

# Make sure imports resolve from the python-service root
sys.path.insert(0, os.path.dirname(__file__))

import io
import re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pandas as pd
import numpy as np

from services.llm import is_out_of_bounds_query, nl_to_sql, _fix_where_having_duplication
from services.analysis import generate_insights, compute_stats, detect_trends
from services.charts import detect_chart_type

# ──────────────────────────────────────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────────────────────────────────────

SAMPLE_SCHEMA = {
    "hidden_gem_score": "REAL",
    "imdb_score": "REAL",
    "title": "TEXT",
    "genre": "TEXT",
    "release_year": "INTEGER",
    "runtime": "REAL",
    "votes": "INTEGER",
}

SIMPLE_NUM_SCHEMA = {
    "score": "REAL",
    "rating": "REAL",
}

EMPTY_SCHEMA: dict = {}

PASS = "[PASS]"
FAIL = "[FAIL]"

def ok(name: str) -> None:
    print(f"  {PASS} {name}")

def fail(name: str, detail: str) -> None:
    print(f"  {FAIL} FAILED: {name}")
    print(f"       → {detail}")
    raise AssertionError(f"{name}: {detail}")

# ──────────────────────────────────────────────────────────────────────────────
# 1. is_out_of_bounds_query
# ──────────────────────────────────────────────────────────────────────────────

def test_out_of_bounds():
    print("\n" + "="*60)
    print("1. is_out_of_bounds_query")
    print("="*60)

    # 1a. Explicit OOB triggers
    oob_cases = [
        "write a poem about machine learning",
        "tell me a joke",
        "what is the capital of France",
        "weather in London today",
        "write a python script to parse JSON",
        "quicksort implementation in C++",
        "translate to Spanish: hello world",
        "play a game with me",
        "write an essay about AI ethics",
    ]
    for q in oob_cases:
        is_out, msg = is_out_of_bounds_query(q, SAMPLE_SCHEMA)
        assert is_out, f"Expected OOB for: '{q}'"
        assert "OUT_OF_BOUNDS:" in msg or "CONVERSATIONAL:" in msg, f"Missing prefix in msg for: '{q}'"
        ok(f"OOB trigger: '{q[:45]}'")

    # 1b. Conversational / greeting queries -> should also be flagged but friendly
    conv_cases = [
        "hello",
        "hi",
        "hey there",
        "help",
        "thanks",
        "ok",
    ]
    for q in conv_cases:
        is_out, msg = is_out_of_bounds_query(q, SAMPLE_SCHEMA)
        assert is_out, f"Expected greeting guard for: '{q}'"
        assert "CONVERSATIONAL:" in msg, f"Missing CONVERSATIONAL prefix for: '{q}'"
        ok(f"Greeting guard: '{q}'")

    # 1c. Valid BI / analytics queries -> should NOT be blocked
    valid_cases = [
        ("Show total hidden_gem_score per genre", SAMPLE_SCHEMA),
        ("Top 5 titles by imdb_score", SAMPLE_SCHEMA),
        ("Average rating by release year", SAMPLE_SCHEMA),
        ("Relationship between hidden gem score and imdb score", SAMPLE_SCHEMA),
        ("Distribution of votes", SAMPLE_SCHEMA),
        ("Count of records by genre", SAMPLE_SCHEMA),
        ("Which title has the highest imdb score", SAMPLE_SCHEMA),
        ("Select all data", SAMPLE_SCHEMA),
        ("Show all", SAMPLE_SCHEMA),
        ("what is the trend in scores over time", SAMPLE_SCHEMA),
        ("imdb score stats", SAMPLE_SCHEMA),
        ("summarize the data", SAMPLE_SCHEMA),
    ]
    for q, schema in valid_cases:
        is_out, msg = is_out_of_bounds_query(q, schema)
        assert not is_out, f"Incorrectly blocked valid query: '{q}' -> msg: '{msg[:80]}'"
        ok(f"Valid BI query passes: '{q[:55]}'")

    # 1d. A query with just 'data' as a standalone term (no greeting) should pass
    is_out, _ = is_out_of_bounds_query("show data trends", EMPTY_SCHEMA)
    assert not is_out, "Query with 'show' and 'data' should pass even with empty schema"
    ok("'show data trends' passes (contains data terms)")

    # 'hello world data' triggers greeting guard (3 words, 'hello' matches greeting set) — correct
    is_out2, msg2 = is_out_of_bounds_query("hello world data", EMPTY_SCHEMA)
    assert is_out2 and "CONVERSATIONAL:" in msg2, \
        f"'hello world data' should hit greeting guard (3 words + greeting token)"
    ok("'hello world data' correctly hits greeting guard (3 tokens, contains 'hello')")


# ──────────────────────────────────────────────────────────────────────────────
# 2. nl_to_sql fast paths (no LLM needed)
# ──────────────────────────────────────────────────────────────────────────────

def test_nl_to_sql_fast_paths():
    print("\n" + "="*60)
    print("2. nl_to_sql fast paths")
    print("="*60)

    # 2a. Show-all fast path
    show_all_cases = [
        "Show all data",
        "show all",
        "SELECT ALL",
        "show data",
        "all data",
        "Show Records",
        "view all data",
        "view data",
    ]
    for q in show_all_cases:
        result = nl_to_sql(q, SAMPLE_SCHEMA)
        assert result.upper().startswith("SELECT"), f"Expected SELECT for '{q}', got: {result[:60]}"
        assert "LIMIT" in result.upper(), f"Expected LIMIT in result for '{q}', got: {result}"
        ok(f"Show-all fast path: '{q}'")

    # 2b. show records where (single condition)
    q = "show records where genre is 'Drama'"
    result = nl_to_sql(q, SAMPLE_SCHEMA)
    assert "WHERE" in result.upper(), f"Expected WHERE in: {result}"
    assert "genre" in result.lower(), f"Expected genre in: {result}"
    ok(f"show records where (single): '{q}'")

    # 2c. show records where (multi-condition)
    q = "show records where genre is 'Action' and release_year is '2020'"
    result = nl_to_sql(q, SAMPLE_SCHEMA)
    assert "WHERE" in result.upper(), f"Expected WHERE in: {result}"
    assert "AND" in result.upper(), f"Expected AND in: {result}"
    ok(f"show records where (multi): '{q}'")

    # 2d. Relationship fast path
    q = "Relationship between hidden gem score and imdb score"
    result = nl_to_sql(q, SAMPLE_SCHEMA)
    assert result.upper().startswith("SELECT"), f"Expected SELECT for relationship query, got: {result[:60]}"
    assert "hidden_gem_score" in result or "imdb_score" in result, \
        f"Expected column names in relationship query result: {result}"
    ok(f"Relationship fast path: '{q}'")

    # 2e. OOB returns correctly prefixed string
    q = "write a poem about data"
    result = nl_to_sql(q, SAMPLE_SCHEMA)
    assert "OUT_OF_BOUNDS:" in result or "CONVERSATIONAL:" in result, \
        f"Expected OOB/CONV prefix for '{q}', got: {result[:80]}"
    ok(f"OOB returned with correct prefix: '{q}'")

    # 2f. Conversational greeting returns CONVERSATIONAL prefix
    q = "hello"
    result = nl_to_sql(q, SAMPLE_SCHEMA)
    assert result.startswith("CONVERSATIONAL:"), f"Expected CONVERSATIONAL for '{q}', got: {result[:80]}"
    ok(f"Conversational greeting handled: '{q}'")


# ──────────────────────────────────────────────────────────────────────────────
# 3. _fix_where_having_duplication
# ──────────────────────────────────────────────────────────────────────────────

def test_fix_where_having_duplication():
    print("\n" + "="*60)
    print("3. _fix_where_having_duplication")
    print("="*60)

    # Should remove avg_col from WHERE when HAVING uses AVG(avg_col)
    sql_bad = (
        "SELECT occupation, AVG(stress_level) FROM data "
        "WHERE stress_level > 5 AND phone_hours > 6 "
        "GROUP BY occupation "
        "HAVING AVG(stress_level) > 7"
    )
    result = _fix_where_having_duplication(sql_bad)
    assert "phone_hours > 6" in result, f"phone_hours should stay in WHERE: {result}"
    assert "stress_level > 5" not in result, \
        f"stress_level should be removed from WHERE. Result: {result}"
    ok("Removes aggregate column from WHERE when in HAVING")

    # No HAVING - should be unchanged
    sql_clean = "SELECT genre, SUM(votes) FROM data WHERE release_year > 2000 GROUP BY genre"
    result2 = _fix_where_having_duplication(sql_clean)
    assert "release_year > 2000" in result2, f"WHERE condition should remain: {result2}"
    ok("No HAVING - WHERE left unchanged")

    # No WHERE - should be unchanged
    sql_no_where = "SELECT genre, AVG(imdb_score) FROM data GROUP BY genre HAVING AVG(imdb_score) > 7"
    result3 = _fix_where_having_duplication(sql_no_where)
    assert "HAVING" in result3.upper(), f"HAVING should remain: {result3}"
    ok("No WHERE - HAVING left unchanged")


# ──────────────────────────────────────────────────────────────────────────────
# 4. generate_insights - correlation detection
# ──────────────────────────────────────────────────────────────────────────────

def test_generate_insights_correlation():
    print("\n" + "="*60)
    print("4. generate_insights - correlation detection")
    print("="*60)

    # Strongly correlated data
    n = 100
    x = np.linspace(1, 10, n)
    y = 2 * x + np.random.normal(0, 0.1, n)
    df_corr = pd.DataFrame({"hidden_gem_score": x, "imdb_score": y})
    stats = compute_stats(df_corr)
    insights = generate_insights(df_corr, stats)
    insight_text = " ".join(insights)
    assert "correlation" in insight_text.lower(), f"Expected correlation insight. Got: {insights}"
    assert "strong positive" in insight_text.lower() or "moderate positive" in insight_text.lower(), \
        f"Expected strong/moderate positive. Got: {insights}"
    ok("Strong positive correlation detected correctly")

    # Negatively correlated data
    y_neg = -2 * x + np.random.normal(0, 0.1, n)
    df_neg = pd.DataFrame({"score": x, "rating": y_neg})
    stats_neg = compute_stats(df_neg)
    insights_neg = generate_insights(df_neg, stats_neg)
    neg_text = " ".join(insights_neg).lower()
    assert "negative" in neg_text, f"Expected negative correlation insight. Got: {insights_neg}"
    ok("Negative correlation detected correctly")

    # Uncorrelated random data
    rng = np.random.default_rng(42)
    df_rand = pd.DataFrame({"a": rng.random(100), "b": rng.random(100)})
    stats_rand = compute_stats(df_rand)
    insights_rand = generate_insights(df_rand, stats_rand)
    rand_text = " ".join(insights_rand).lower()
    assert "correlation" in rand_text, f"Expected some correlation insight. Got: {insights_rand}"
    ok("Random data correlation labelled correctly")


# ──────────────────────────────────────────────────────────────────────────────
# 5. generate_insights - categorical top/bottom contributor + range + trend
# ──────────────────────────────────────────────────────────────────────────────

def test_generate_insights_categorical():
    print("\n" + "="*60)
    print("5. generate_insights - categorical insights")
    print("="*60)

    df = pd.DataFrame({
        "genre": ["Action", "Drama", "Comedy", "Action", "Drama", "Comedy", "Comedy"],
        "imdb_score": [7.5, 8.1, 6.0, 7.8, 8.3, 5.9, 6.1],
        "votes": [10000, 20000, 5000, 12000, 22000, 4000, 4500],
    })
    stats = compute_stats(df)
    insights = generate_insights(df, stats)
    text = " ".join(insights)

    assert "Drama" in text or "Action" in text, f"Expected top contributor in insights: {insights}"
    ok("Top contributor identified")

    assert "Analysis based on" in text, f"Expected row count insight: {insights}"
    ok("Row count insight present")

    assert "ranges from" in text.lower(), f"Expected range insight: {insights}"
    ok("Range insight present")


# ──────────────────────────────────────────────────────────────────────────────
# 6. detect_chart_type
# ──────────────────────────────────────────────────────────────────────────────

def test_detect_chart_type():
    print("\n" + "="*60)
    print("6. detect_chart_type")
    print("="*60)

    # Two numeric columns - should be scatter
    df_scatter = pd.DataFrame({"hidden_gem_score": [1.0, 2.0, 3.0], "imdb_score": [7.0, 8.0, 9.0]})
    chart = detect_chart_type(df_scatter)
    assert chart == "scatter", f"Expected scatter for 2 numeric cols, got: {chart}"
    ok("Two numeric columns -> scatter")

    # Single numeric column - histogram
    df_hist = pd.DataFrame({"imdb_score": [7.0, 8.0, 6.5, 9.0]})
    chart2 = detect_chart_type(df_hist)
    assert chart2 == "histogram", f"Expected histogram, got: {chart2}"
    ok("Single numeric column -> histogram")

    # Categorical + numeric - bar (5 rows)
    df_bar = pd.DataFrame({"genre": ["A", "B", "C", "D", "E"], "score": [7, 8, 6, 9, 5]})
    chart3 = detect_chart_type(df_bar)
    assert chart3 in ("bar", "pie"), f"Expected bar/pie, got: {chart3}"
    ok(f"Categorical + numeric (5 rows) -> {chart3}")

    # Many rows categorical + numeric -> line
    df_line = pd.DataFrame({
        "category": [f"cat_{i}" for i in range(20)],
        "value": list(range(20)),
    })
    chart4 = detect_chart_type(df_line)
    assert chart4 in ("line", "bar"), f"Expected line/bar for 20 rows, got: {chart4}"
    ok(f"Many rows categorical + numeric -> {chart4}")


# ──────────────────────────────────────────────────────────────────────────────
# RUNNER
# ──────────────────────────────────────────────────────────────────────────────

def run_all():
    tests = [
        test_out_of_bounds,
        test_nl_to_sql_fast_paths,
        test_fix_where_having_duplication,
        test_generate_insights_correlation,
        test_generate_insights_categorical,
        test_detect_chart_type,
    ]

    passed = 0
    failed = 0
    errors = []

    for t in tests:
        try:
            t()
            passed += 1
        except AssertionError as e:
            failed += 1
            errors.append(str(e))
        except Exception as e:
            failed += 1
            errors.append(f"{t.__name__}: Unexpected error - {e}")
            import traceback
            traceback.print_exc()

    print("\n" + "="*60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    if errors:
        print("\nFailed tests:")
        for err in errors:
            print(f"  x {err}")
    else:
        print("All tests passed!")
    print("="*60)
    return failed == 0


if __name__ == "__main__":
    success = run_all()
    sys.exit(0 if success else 1)
