"""
Database service — Multi-format dataset ingestion (CSV, Excel, JSON, TSV, Parquet),
SQLite conversion, safe query execution, and dataset export.
"""
import sqlite3
import pandas as pd
import os
import re
import io
import json
import csv
from pathlib import Path


def load_file_to_sqlite(file_path: str) -> dict:
    """
    Load a dataset file into an in-memory SQLite database saved to disk.
    Supports CSV, TSV, TXT, Excel (.xlsx, .xls, .xlsm, .xlsb), JSON, JSONL, and Parquet.
    Disambiguates duplicate columns, cleans numeric values, and sanitizes schema for SQLite.
    """
    file_path = str(file_path)
    ext = os.path.splitext(file_path)[1].lower()

    df = None

    if ext in ['.xlsx', '.xls', '.xlsm', '.xlsb']:
        try:
            df = pd.read_excel(file_path)
        except Exception as exc:
            raise ValueError(f"Failed to read Excel file: {exc}")

    elif ext in ['.json', '.jsonl']:
        try:
            # Try reading as standard json array
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                data = json.load(f)
            if isinstance(data, list):
                df = pd.json_normalize(data)
            elif isinstance(data, dict):
                # Try finding array inside object or normalize dict
                array_key = next((k for k, v in data.items() if isinstance(v, list)), None)
                if array_key:
                    df = pd.json_normalize(data[array_key])
                else:
                    df = pd.json_normalize([data])
        except Exception:
            # Fallback to json lines
            try:
                df = pd.read_json(file_path, lines=True)
            except Exception as exc:
                raise ValueError(f"Failed to read JSON dataset: {exc}")

    elif ext == '.parquet':
        try:
            df = pd.read_parquet(file_path)
        except Exception as exc:
            raise ValueError(f"Failed to read Parquet dataset: {exc}")

    elif ext in ['.tsv', '.tab', '.txt']:
        try:
            df = pd.read_csv(file_path, sep='\t')
        except Exception:
            try:
                df = pd.read_csv(file_path, sep=None, engine='python')
            except Exception as exc:
                raise ValueError(f"Failed to read delimited text file: {exc}")

    else:
        # Default: CSV reader with smart header detection and encoding fallback
        header_idx = 0
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                sample_lines = [f.readline() for _ in range(15)]
            rows = list(csv.reader([l for l in sample_lines if l.strip()]))
            if rows:
                max_cols = max(len(r) for r in rows)
                for idx, r in enumerate(rows):
                    if len(r) >= max_cols - 2:
                        non_empty = [cell.strip() for cell in r if cell.strip()]
                        text_cells = [cell for cell in non_empty if any(c.isalpha() for c in cell)]
                        if len(text_cells) >= len(non_empty) * 0.4 and len(non_empty) > 0:
                            header_idx = idx
                            break
        except Exception:
            header_idx = 0

        encodings = ['utf-8', 'utf-8-sig', 'latin1', 'cp1252']
        read_success = False
        for enc in encodings:
            try:
                df = pd.read_csv(file_path, skiprows=header_idx, encoding=enc)
                read_success = True
                break
            except Exception:
                continue

        if not read_success:
            try:
                df = pd.read_csv(file_path, encoding='utf-8', errors='replace')
            except Exception as exc:
                raise ValueError(f"Failed to read CSV file: {exc}")

    if df is None or len(df) == 0:
        raise ValueError("The uploaded dataset contains no rows or data.")

    # Drop completely empty columns
    df = df.dropna(how="all", axis=1)

    # Disambiguate duplicate column names & sanitize for SQLite
    clean_cols = []
    seen = {}
    for col in df.columns:
        c = re.sub(r'[^a-zA-Z0-9_]', '_', str(col).strip()).lower()
        c = re.sub(r'_+', '_', c).strip('_')
        if not c:
            c = "col"
        if c in seen:
            seen[c] += 1
            c = f"{c}_{seen[c]}"
        else:
            seen[c] = 0
        clean_cols.append(c)
    df.columns = clean_cols

    # Clean numeric columns containing strings with currency symbols, commas, or hyphens
    for col in df.columns:
        if df[col].dtype == object:
            # Check if majority of values are formatted numbers
            sample_vals = df[col].dropna().astype(str).str.strip()
            # Strip $, €, £, ₹, commas, percent
            cleaned = sample_vals.str.replace(r'[\$,€,£,₹,%]', '', regex=True).replace({"-": None, "": None, "nan": None, "None": None})
            numeric_series = pd.to_numeric(cleaned, errors="coerce")
            if sample_vals.count() > 0 and numeric_series.notnull().sum() >= (sample_vals.count() * 0.5):
                df[col] = pd.to_numeric(
                    df[col].astype(str).str.replace(r'[\$,€,£,₹,%]', '', regex=True).str.replace(",", ""),
                    errors="coerce"
                )

    # Create SQLite database alongside the file
    db_path = file_path.rsplit('.', 1)[0] + '.db'
    conn = sqlite3.connect(db_path)

    # Write dataframe to SQLite table named 'data'
    df.to_sql('data', conn, if_exists='replace', index=False)

    # Get schema info
    cursor = conn.execute("PRAGMA table_info(data)")
    columns_info = cursor.fetchall()

    schema = {}
    columns = []
    for col_info in columns_info:
        col_name = col_info[1]
        col_type = col_info[2]
        columns.append(col_name)
        schema[col_name] = col_type

    # Get JSON-safe sample rows
    sample_df = df.head(5)
    sample_rows = json.loads(sample_df.to_json(orient='records'))
    row_count = len(df)

    conn.close()

    summary_stats = compute_dataset_summary_stats(df)

    return {
        "db_path": db_path,
        "table_name": "data",
        "columns": columns,
        "schema": schema,
        "sample_rows": sample_rows,
        "row_count": row_count,
        "summary_stats": summary_stats,
    }


def compute_dataset_summary_stats(df: pd.DataFrame) -> dict:
    """
    Compute comprehensive full-dataset statistics for Executive KPIs.
    """
    import numpy as np
    row_count = len(df)
    columns = list(df.columns)
    
    numeric_cols = []
    for col in df.select_dtypes(include=[np.number]).columns:
        col_lower = str(col).lower()
        if not (col_lower.endswith('_id') or col_lower.startswith('id_') or col_lower in ['id', 'index', 'seq', 'ji_lu_shu', 'row_id']):
            numeric_cols.append(col)
            
    def metric_priority(col_name):
        n = str(col_name).lower()
        if 'sales' in n: return 1
        if 'revenue' in n: return 2
        if 'profit' in n: return 3
        if 'amount' in n: return 4
        if 'price' in n: return 5
        if 'cost' in n: return 6
        if 'qty' in n or 'quantity' in n: return 7
        return 10

    numeric_cols_sorted = sorted(numeric_cols, key=metric_priority)
    primary_col = numeric_cols_sorted[0] if numeric_cols_sorted else None
    
    primary_metric_info = None
    if primary_col:
        series = pd.to_numeric(df[primary_col], errors='coerce').dropna()
        total_val = float(series.sum()) if len(series) > 0 else 0.0
        avg_val = float(series.mean()) if len(series) > 0 else 0.0
        
        n_lower = str(primary_col).lower()
        is_curr = any(k in n_lower for k in ['sales', 'revenue', 'profit', 'amount', 'price', 'cost', 'val', 'value'])
        
        primary_metric_info = {
            "column": primary_col,
            "label": primary_col.replace('_', ' ').title(),
            "total": total_val,
            "avg": avg_val,
            "is_currency": is_curr
        }

    secondary_col = numeric_cols_sorted[1] if len(numeric_cols_sorted) > 1 else None
    secondary_metric_info = None
    if secondary_col:
        series = pd.to_numeric(df[secondary_col], errors='coerce').dropna()
        n_lower = str(secondary_col).lower()
        secondary_metric_info = {
            "column": secondary_col,
            "label": secondary_col.replace('_', ' ').title(),
            "total": float(series.sum()) if len(series) > 0 else 0.0,
            "avg": float(series.mean()) if len(series) > 0 else 0.0,
            "is_currency": any(k in n_lower for k in ['sales', 'revenue', 'profit', 'amount', 'price', 'cost'])
        }

    cat_cols = []
    cat_summary = {}
    for col in df.select_dtypes(include=['object', 'category']).columns:
        col_lower = str(col).lower()
        if not (col_lower.endswith('_id') or col_lower.startswith('id_') or col_lower in ['id', 'index', 'seq']):
            cat_cols.append(col)
            cat_summary[col] = int(df[col].nunique())

    return {
        "row_count": row_count,
        "column_count": len(columns),
        "primary_metric": primary_metric_info,
        "secondary_metric": secondary_metric_info,
        "categorical_counts": cat_summary,
        "numeric_columns": numeric_cols,
        "categorical_columns": cat_cols
    }


# Backwards compatibility alias
csv_to_sqlite = load_file_to_sqlite


def export_dataset_from_sqlite(db_path: str, export_format: str = "csv", base_filename: str = "transformed_dataset") -> tuple[str, str, bytes]:
    """
    Exports the full SQLite table 'data' into CSV, Excel (.xlsx), or JSON.
    Returns (filename, content_type, file_bytes).
    """
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database file not found: {db_path}")

    conn = sqlite3.connect(db_path)
    try:
        df = pd.read_sql("SELECT * FROM data", conn)
    finally:
        conn.close()

    fmt = export_format.lower().strip()

    if fmt in ['xlsx', 'excel']:
        buf = io.BytesIO()
        df.to_excel(buf, index=False, engine='openpyxl')
        filename = f"{base_filename}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return filename, media_type, buf.getvalue()

    elif fmt in ['json']:
        json_str = df.to_json(orient='records', indent=2)
        filename = f"{base_filename}.json"
        media_type = "application/json"
        return filename, media_type, json_str.encode('utf-8')

    else:
        # Default: CSV
        csv_str = df.to_csv(index=False)
        filename = f"{base_filename}.csv"
        media_type = "text/csv"
        return filename, media_type, csv_str.encode('utf-8')


def get_schema(db_path: str) -> dict:
    """Get schema information and summary stats from an existing SQLite database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("PRAGMA table_info(data)")
    columns_info = cursor.fetchall()

    schema = {}
    for col_info in columns_info:
        schema[col_info[1]] = col_info[2]

    # Get sample rows and full dataframe summary stats
    full_df = pd.read_sql("SELECT * FROM data", conn)
    sample_df = full_df.head(5)
    sample_rows = json.loads(sample_df.to_json(orient='records'))
    summary_stats = compute_dataset_summary_stats(full_df)

    conn.close()
    return {"schema": schema, "sample_rows": sample_rows, "summary_stats": summary_stats}


def validate_sql(sql: str) -> bool:
    """
    Validate that the SQL query is safe (SELECT only).
    Returns True if safe, False otherwise.
    """
    sql_upper = sql.strip().upper()

    # Block destructive operations
    dangerous_keywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE']
    for keyword in dangerous_keywords:
        if re.search(rf'\b{keyword}\b', sql_upper):
            return False

    # Must start with SELECT or WITH (for CTEs)
    if not (sql_upper.startswith('SELECT') or sql_upper.startswith('WITH')):
        return False

    return True


def _normalise_identifier(identifier: str) -> str:
    """Convert common column-name styles to the same comparison form."""
    return re.sub(r'[^a-zA-Z0-9]', '_', str(identifier).strip()).lower().strip('_')


def _repair_sql_column_names(conn: sqlite3.Connection, sql: str) -> str:
    """
    Resolve LLM-generated column spellings against the actual SQLite schema.
    """
    actual_columns = [row[1] for row in conn.execute("PRAGMA table_info(data)").fetchall()]
    by_normalised_name = {
        _normalise_identifier(column): column
        for column in actual_columns
    }

    if not actual_columns:
        return sql

    identifier_pattern = re.compile(r'(?<!["`])\b[A-Za-z_][A-Za-z0-9_]*\b(?!["`])')

    def replace_identifier(match: re.Match) -> str:
        token = match.group(0)
        actual = by_normalised_name.get(_normalise_identifier(token))
        if not actual or actual.lower() == token.lower():
            return token
        escaped = actual.replace('"', '""')
        return f'"{escaped}"'

    return identifier_pattern.sub(replace_identifier, sql)


def execute_query(db_path: str, sql: str) -> list[dict]:
    """
    Execute a SELECT query against the SQLite database.
    Returns results as a list of dictionaries.
    """
    if not validate_sql(sql):
        raise ValueError("Only SELECT queries are allowed. Destructive operations are blocked.")

    conn = sqlite3.connect(db_path)
    try:
        try:
            df = pd.read_sql(sql, conn)
        except Exception as first_error:
            repaired_sql = _repair_sql_column_names(conn, sql)
            if repaired_sql == sql:
                raise first_error
            print(f"Retrying query with schema-resolved column names: {repaired_sql}")
            df = pd.read_sql(repaired_sql, conn)
        result = json.loads(df.to_json(orient='records'))
        return result
    except Exception as e:
        raise ValueError(f"SQL execution error: {str(e)}")
    finally:
        conn.close()
