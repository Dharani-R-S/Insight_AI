import os
import sys
import json
import sqlite3
import pandas as pd

# Add python-service to sys.path
sys.path.insert(0, os.path.abspath('python-service'))

from services.data_profiler import profile_dataset, clean_dataset_interactive, revert_to_original
from services.dashboard_engine import generate_dataset_dashboard, generate_smart_queries

def run_tests():
    print("=" * 60)
    print("STARTING COMPREHENSIVE SYSTEM VERIFICATION")
    print("=" * 60)

    # ---------------------------------------------------------
    # TEST 1: Netflix Dataset Quality Analysis & Profiling
    # ---------------------------------------------------------
    print("\n--- TEST 1: Profiling Netflix Dataset ---")
    netflix_excel = 'sample_data/Netflix_Dataset.xlsx'
    test_db = 'sample_data/test_netflix.db'
    if os.path.exists(test_db):
        os.remove(test_db)

    print(f"Loading {netflix_excel} into temporary database {test_db}...")
    df_netflix = pd.read_excel(netflix_excel)
    print(f"Loaded {len(df_netflix)} rows and {len(df_netflix.columns)} columns.")

    conn = sqlite3.connect(test_db)
    df_netflix.to_sql('data', conn, if_exists='replace', index=False)
    conn.close()

    # Profile dataset
    profile = profile_dataset(test_db)
    print(f"Quality Score: {profile['quality_score']}/100")
    print(f"Total Rows: {profile['total_rows']}")
    print(f"Total Missing Cells: {profile['missing_cells_total']} ({profile['missing_cells_pct']}%)")
    print(f"Duplicate Rows: {profile['duplicate_rows']}")
    print(f"Columns with Issues: {profile['columns_with_missing_count']}")

    # Print top columns with missing values
    print("\nMissing values breakdown (first 6 columns):")
    cols_with_missing = [c for c in profile['columns'] if c['missing_count'] > 0]
    for c in cols_with_missing[:6]:
        print(f"  - {c['name']} ({c['type_category']}): {c['missing_count']} missing ({c['missing_pct']}%) -> Suggested: {c['default_action']}")

    assert profile['total_rows'] == len(df_netflix), "Total rows mismatch!"
    assert profile['missing_cells_total'] > 0, "Missing cells should be detected for Netflix dataset!"
    assert profile['has_issues'] is True, "Dataset should have issues detected!"

    # ---------------------------------------------------------
    # TEST 2: Interactive Data Cleaning & Non-destructive Revert
    # ---------------------------------------------------------
    print("\n--- TEST 2: Interactive Cleaning (Preview & Apply) ---")
    # A. Preview Mode
    column_actions = {
        'Director': {'action': 'unknown'},
        'Country': {'action': 'custom', 'custom_value': 'Global'},
        'Rotten Tomatoes Score': {'action': 'median'},
        'IMDb Votes': {'action': 'zero'},
    }
    preview_res = clean_dataset_interactive(
        test_db,
        remove_duplicates=True,
        column_actions=column_actions,
        preview_only=True
    )
    print("Preview Summary:", json.dumps(preview_res['summary'], indent=2))
    assert preview_res['preview_only'] is True, "Preview flag should be true!"
    assert preview_res['summary']['values_filled'] > 0, "Values filled should be > 0"

    # Verify that database was NOT changed during preview
    conn = sqlite3.connect(test_db)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM data WHERE Director IS NULL OR Director = ''")
    still_null = cur.fetchone()[0]
    conn.close()
    assert still_null > 0, "Preview should NOT modify database table!"
    print(f"Confirmed: database remained untouched during preview ({still_null} null directors).")

    # B. Execute Cleaning
    print("\nExecuting interactive cleaning...")
    clean_res = clean_dataset_interactive(
        test_db,
        remove_duplicates=True,
        column_actions=column_actions,
        preview_only=False
    )
    print("Applied Summary:", json.dumps(clean_res['summary'], indent=2))
    assert clean_res['preview_only'] is False, "Preview flag should be false on apply!"
    assert clean_res['summary']['values_filled'] > 0, "Values filled should be > 0!"

    # Verify non-destructive backup
    conn = sqlite3.connect(test_db)
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cur.fetchall()]
    assert 'data_original' in tables, "Original table 'data_original' must be preserved!"
    cur.execute("SELECT COUNT(*) FROM data_original")
    orig_rows = cur.fetchone()[0]
    print(f"Confirmed: 'data_original' exists with {orig_rows} original rows.")
    conn.close()

    # C. Revert to Original
    print("\nTesting Revert to Original...")
    revert_res = revert_to_original(test_db)
    print(f"Reverted dataset row count: {revert_res['row_count']}")
    assert revert_res['row_count'] == orig_rows, "Reverted rows must match original!"

    # Clean up test db
    if os.path.exists(test_db):
        os.remove(test_db)
    print("Quality & Cleaning tests passed successfully!")

    # ---------------------------------------------------------
    # TEST 3: Dynamic Dashboard Engine (Netflix Dataset)
    # ---------------------------------------------------------
    print("\n--- TEST 3: Dynamic Dashboard on Netflix Dataset ---")
    dash_netflix = generate_dataset_dashboard(df_netflix)
    kpis = dash_netflix['kpis']
    print(f"Primary KPI: {kpis['primary']['label']} = {kpis['primary']['value']} ({kpis['primary']['desc']})")
    print("Secondary KPIs:")
    for sk in kpis['secondary']:
        print(f"  - {sk['label']}: {sk['value']} ({sk['desc']})")

    # Verify no sales/$ hallucinated for Netflix
    assert '$' not in str(kpis['primary']['value']), "Netflix primary KPI must not contain dollar sign!"
    for sk in kpis['secondary']:
        assert '$' not in str(sk['value']), f"Netflix secondary KPI '{sk['label']}' must not contain dollar sign!"

    print(f"\nGenerated {len(dash_netflix['charts'])} dynamic charts:")
    for ch in dash_netflix['charts']:
        print(f"  - [{ch['type'].upper()}] {ch['title']} (x: {ch.get('x_axis')}, y: {ch.get('y_axis')}) -> {len(ch['data'])} points")

    assert len(dash_netflix['charts']) >= 4, "Should generate at least 4 smart visualizations!"

    # ---------------------------------------------------------
    # TEST 4: Dynamic Dashboard Engine (Sales Dataset)
    # ---------------------------------------------------------
    print("\n--- TEST 4: Dynamic Dashboard on Sales Dataset ---")
    sales_csv = 'sample_data/sales_data.csv'
    df_sales = pd.read_csv(sales_csv)
    dash_sales = generate_dataset_dashboard(df_sales)
    print(f"Sales Primary KPI: {dash_sales['kpis']['primary']['label']} = {dash_sales['kpis']['primary']['value']}")
    print(f"Sales Secondary KPIs: {[s['label'] for s in dash_sales['kpis']['secondary']]}")
    print(f"Sales Charts generated: {len(dash_sales['charts'])}")
    assert len(dash_sales['charts']) >= 3, "Sales dashboard should generate multiple charts!"

    # ---------------------------------------------------------
    # TEST 5: Context-Aware AI Suggested Queries
    # ---------------------------------------------------------
    print("\n--- TEST 5: Context-Aware AI Suggested Queries ---")
    netflix_schema = [{"column": col, "type": str(df_netflix[col].dtype)} for col in df_netflix.columns]
    sample_rows = df_netflix.head(3).to_dict(orient='records')

    queries_netflix = generate_smart_queries(list(df_netflix.columns), netflix_schema, sample_rows)
    print(f"Generated {len(queries_netflix)} smart queries for Netflix dataset:")
    categories = set(q.get('category') for q in queries_netflix)
    print(f"Categories covered: {categories}")
    for q in queries_netflix[:8]:
        print(f"  - [{q.get('category')}] {q['question']}")

    # Verify query relevance
    query_texts = " ".join([q['question'].lower() for q in queries_netflix])
    assert 'movie' in query_texts or 'series' in query_texts or 'genre' in query_texts or 'release' in query_texts, \
        "Netflix queries must reference actual Netflix columns!"

    print("\nAll 5 verification suites completed successfully with 0 errors!")

if __name__ == '__main__':
    run_tests()
