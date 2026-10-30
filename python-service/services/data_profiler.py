"""
InsightAI Dataset Quality Profiler & Interactive Cleaning Engine.
Provides deep dataset profiling:
- Missing/null value analysis per column
- Exact duplicate row detection
- Inconsistent data types and formatting issues
- Outlier detection via IQR
- Interactive column-by-column cleaning transformations
- Non-destructive original dataset preservation and reverting
"""

import sqlite3
import json
import re
from typing import Dict, List, Any, Optional
import pandas as pd
import numpy as np


def profile_dataset(db_path: str, table_name: str = "data") -> Dict[str, Any]:
    """
    Perform deep quality and noise analysis on an uploaded SQLite dataset.
    """
    conn = sqlite3.connect(db_path)
    try:
        # Check if original backup exists
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='data_original'")
        has_original = bool(cur.fetchone())
        
        df = pd.read_sql(f"SELECT * FROM {table_name}", conn)
        total_rows = len(df)
        total_cols = len(df.columns)

        if total_rows == 0 or total_cols == 0:
            return {
                "has_issues": False,
                "total_rows": total_rows,
                "total_columns": total_cols,
                "duplicate_rows": 0,
                "duplicate_pct": 0.0,
                "missing_cells_total": 0,
                "missing_cells_pct": 0.0,
                "quality_score": 100,
                "columns": [],
                "has_original": has_original
            }

        # 1. Duplicate rows
        dup_count = int(df.duplicated().sum())
        dup_pct = round((dup_count / total_rows) * 100, 1) if total_rows > 0 else 0.0

        # 2. Total missing cells
        total_cells = total_rows * total_cols
        total_missing = int(df.isnull().sum().sum())
        missing_cells_pct = round((total_missing / total_cells) * 100, 1) if total_cells > 0 else 0.0

        columns_profile = []
        total_outliers = 0
        columns_with_missing_count = 0

        for col in df.columns:
            series = df[col]
            missing_count = int(series.isnull().sum())
            missing_pct = round((missing_count / total_rows) * 100, 1) if total_rows > 0 else 0.0
            if missing_count > 0:
                columns_with_missing_count += 1

            non_null = series.dropna()
            unique_count = int(series.nunique())

            # Infer column type
            is_numeric = pd.api.types.is_numeric_dtype(series.dtype)
            is_datetime = False
            if not is_numeric:
                # Check if parseable as datetime
                if non_null.astype(str).str.contains(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}').sum() > len(non_null) * 0.7:
                    is_datetime = True

            col_info = {
                "name": col,
                "display_name": col.replace("_", " ").title(),
                "total_rows": total_rows,
                "missing_count": missing_count,
                "missing_pct": missing_pct,
                "unique_count": unique_count,
                "sample_values": [str(v) for v in non_null.unique()[:4]],
            }

            if is_numeric:
                col_info["type_category"] = "numeric"
                col_info["data_type"] = "Integer" if pd.api.types.is_integer_dtype(series.dtype) else "Float"

                if len(non_null) > 0:
                    col_info["mean"] = float(round(non_null.mean(), 2))
                    col_info["median"] = float(round(non_null.median(), 2))
                    mode_s = non_null.mode()
                    col_info["mode"] = float(round(mode_s.iloc[0], 2)) if not mode_s.empty else None
                    col_info["min"] = float(round(non_null.min(), 2))
                    col_info["max"] = float(round(non_null.max(), 2))
                    col_info["std"] = float(round(non_null.std(), 2)) if len(non_null) > 1 else 0.0

                    # Outlier calculation via IQR (Tukey's fences)
                    q25 = non_null.quantile(0.25)
                    q75 = non_null.quantile(0.75)
                    iqr = q75 - q25
                    lower_bound = q25 - 1.5 * iqr
                    upper_bound = q75 + 1.5 * iqr

                    outliers = non_null[(non_null < lower_bound) | (non_null > upper_bound)]
                    col_outlier_count = int(len(outliers))
                    col_info["outlier_count"] = col_outlier_count
                    col_info["outlier_pct"] = round((col_outlier_count / len(non_null)) * 100, 1)
                    col_info["outlier_bounds"] = [float(round(lower_bound, 2)), float(round(upper_bound, 2))]
                    total_outliers += col_outlier_count
                else:
                    col_info["mean"] = None
                    col_info["median"] = None
                    col_info["mode"] = None
                    col_info["outlier_count"] = 0
                    col_info["outlier_pct"] = 0.0

                # Suggested action
                if missing_count > 0:
                    if col_info.get("outlier_count", 0) > 0:
                        col_info["suggested_action"] = "Fill with median (recommended for skewed data), mean, zero, custom value, or remove rows"
                        col_info["default_action"] = "median"
                    else:
                        col_info["suggested_action"] = "Fill with mean, median, zero, custom value, or remove rows"
                        col_info["default_action"] = "mean"
                else:
                    col_info["suggested_action"] = "No missing values"
                    col_info["default_action"] = "keep"

                col_info["allowed_actions"] = [
                    {"id": "mean", "label": "Fill with Mean (Average)"},
                    {"id": "median", "label": "Fill with Median (Robust)"},
                    {"id": "zero", "label": "Fill with Zero (0)"},
                    {"id": "mode", "label": "Fill with Mode"},
                    {"id": "custom", "label": "Fill with Custom Value..."},
                    {"id": "drop_rows", "label": "Remove affected rows"},
                    {"id": "keep", "label": "Keep missing values"}
                ]

            elif is_datetime:
                col_info["type_category"] = "datetime"
                col_info["data_type"] = "Date / Time"
                col_info["outlier_count"] = 0
                col_info["outlier_pct"] = 0.0

                if len(non_null) > 0:
                    col_info["min"] = str(non_null.min())
                    col_info["max"] = str(non_null.max())
                    mode_s = non_null.mode()
                    col_info["mode"] = str(mode_s.iloc[0]) if not mode_s.empty else None

                if missing_count > 0:
                    col_info["suggested_action"] = "Fill with mode, custom date, or remove affected rows"
                    col_info["default_action"] = "mode"
                else:
                    col_info["suggested_action"] = "No missing values"
                    col_info["default_action"] = "keep"

                col_info["allowed_actions"] = [
                    {"id": "mode", "label": "Fill with Mode (Most Frequent)"},
                    {"id": "custom", "label": "Fill with Custom Date..."},
                    {"id": "drop_rows", "label": "Remove affected rows"},
                    {"id": "keep", "label": "Keep missing values"}
                ]

            else:
                col_info["type_category"] = "categorical"
                col_info["data_type"] = "Text / Categorical"
                col_info["outlier_count"] = 0
                col_info["outlier_pct"] = 0.0

                if len(non_null) > 0:
                    mode_s = non_null.mode()
                    col_info["mode"] = str(mode_s.iloc[0]) if not mode_s.empty else None

                # Detect whitespace or inconsistent casing issues
                str_vals = non_null.astype(str)
                whitespace_count = int((str_vals.str.strip() != str_vals).sum())
                col_info["whitespace_issues"] = whitespace_count

                if missing_count > 0:
                    col_info["suggested_action"] = "Fill with 'Unknown', mode, custom value, or remove affected rows"
                    col_info["default_action"] = "unknown"
                else:
                    col_info["suggested_action"] = "No missing values"
                    col_info["default_action"] = "keep"

                col_info["allowed_actions"] = [
                    {"id": "unknown", "label": "Fill with 'Unknown'"},
                    {"id": "mode", "label": "Fill with Mode (Most Frequent)"},
                    {"id": "custom", "label": "Fill with Custom Value..."},
                    {"id": "trim_whitespace", "label": "Trim Whitespace"},
                    {"id": "drop_rows", "label": "Remove affected rows"},
                    {"id": "keep", "label": "Keep missing values"}
                ]

            columns_profile.append(col_info)

        # Calculate Overall Dataset Quality Score (0 - 100)
        # Deduct for missingness, duplicates, and extreme noise
        score = 100.0
        score -= min(missing_cells_pct * 1.5, 35.0)
        score -= min(dup_pct * 1.2, 25.0)
        outlier_ratio = (total_outliers / (total_rows * max(1, len([c for c in columns_profile if c['type_category'] == 'numeric'])))) * 100
        score -= min(outlier_ratio * 0.5, 15.0)
        quality_score = max(10, min(100, int(round(score))))

        has_issues = (total_missing > 0) or (dup_count > 0) or (total_outliers > 0)

        return {
            "has_issues": has_issues,
            "quality_score": quality_score,
            "total_rows": total_rows,
            "total_columns": total_cols,
            "duplicate_rows": dup_count,
            "duplicate_pct": dup_pct,
            "missing_cells_total": total_missing,
            "missing_cells_pct": missing_cells_pct,
            "columns_with_missing_count": columns_with_missing_count,
            "total_outliers": total_outliers,
            "has_original": has_original,
            "columns": columns_profile
        }
    finally:
        conn.close()


def clean_dataset_interactive(
    db_path: str,
    table_name: str = "data",
    remove_duplicates: bool = False,
    column_actions: Optional[Dict[str, Any]] = None,
    outlier_actions: Optional[Dict[str, str]] = None,
    standardize_text: bool = True,
    preview_only: bool = False
) -> Dict[str, Any]:
    """
    Apply user-selected data cleaning transformations to the SQLite dataset.
    If preview_only=True, runs on a copy in memory and returns statistics/sample.
    If preview_only=False, preserves 'data_original' and writes cleaned dataframe to 'data'.
    """
    conn = sqlite3.connect(db_path)
    try:
        # Check if original backup exists; if not, create it before modifying
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='data_original'")
        has_original = bool(cur.fetchone())

        df_initial = pd.read_sql(f"SELECT * FROM {table_name}", conn)
        df = df_initial.copy()

        initial_rows = len(df)
        initial_missing = int(df.isnull().sum().sum())
        initial_cols = len(df.columns)

        if not preview_only and not has_original:
            df_initial.to_sql("data_original", conn, if_exists="replace", index=False)
            has_original = True

        rows_dropped_duplicates = 0
        if remove_duplicates:
            before_dup = len(df)
            df = df.drop_duplicates()
            rows_dropped_duplicates = before_dup - len(df)

        modified_columns = []
        filled_values_count = 0
        rows_dropped_missing = 0

        column_actions = column_actions or {}
        outlier_actions = outlier_actions or {}

        # 1. Apply column missing value imputation or row drops
        for col, config in column_actions.items():
            if col not in df.columns:
                continue

            action = config.get("action", "keep")
            custom_val = config.get("custom_value")
            is_numeric = pd.api.types.is_numeric_dtype(df[col].dtype)

            missing_mask = df[col].isnull()
            col_missing_count = int(missing_mask.sum())

            if col_missing_count == 0 and action not in ["trim_whitespace"]:
                continue

            if action == "mean" and is_numeric:
                mean_val = float(df[col].mean()) if not df[col].dropna().empty else 0.0
                df[col] = df[col].fillna(mean_val)
                filled_values_count += col_missing_count
                modified_columns.append({"column": col, "action": f"Filled {col_missing_count} with mean ({round(mean_val, 2)})"})

            elif action == "median" and is_numeric:
                med_val = float(df[col].median()) if not df[col].dropna().empty else 0.0
                df[col] = df[col].fillna(med_val)
                filled_values_count += col_missing_count
                modified_columns.append({"column": col, "action": f"Filled {col_missing_count} with median ({round(med_val, 2)})"})

            elif action == "mode":
                mode_s = df[col].mode()
                mode_val = mode_s.iloc[0] if not mode_s.empty else (0 if is_numeric else "Unknown")
                df[col] = df[col].fillna(mode_val)
                filled_values_count += col_missing_count
                modified_columns.append({"column": col, "action": f"Filled {col_missing_count} with mode ('{mode_val}')"})

            elif action == "zero" and is_numeric:
                df[col] = df[col].fillna(0)
                filled_values_count += col_missing_count
                modified_columns.append({"column": col, "action": f"Filled {col_missing_count} with 0"})

            elif action == "unknown":
                label = config.get("label") or "Unknown"
                df[col] = df[col].fillna(label)
                filled_values_count += col_missing_count
                modified_columns.append({"column": col, "action": f"Filled {col_missing_count} with '{label}'"})

            elif action == "custom":
                val = custom_val
                if is_numeric:
                    try:
                        val = float(custom_val)
                    except (ValueError, TypeError):
                        val = 0.0
                else:
                    val = str(custom_val if custom_val is not None else "")
                df[col] = df[col].fillna(val)
                filled_values_count += col_missing_count
                modified_columns.append({"column": col, "action": f"Filled {col_missing_count} with custom value ({val})"})

            elif action == "drop_rows":
                before_drop = len(df)
                df = df.dropna(subset=[col])
                dropped = before_drop - len(df)
                rows_dropped_missing += dropped
                modified_columns.append({"column": col, "action": f"Dropped {dropped} rows with missing values"})

            elif action == "trim_whitespace" and not is_numeric:
                df[col] = df[col].astype(str).str.strip()
                modified_columns.append({"column": col, "action": "Trimmed leading/trailing whitespace"})

        # 2. Outlier actions
        outliers_clipped = 0
        for col, o_action in outlier_actions.items():
            if col in df.columns and pd.api.types.is_numeric_dtype(df[col].dtype):
                non_null = df[col].dropna()
                if len(non_null) > 4:
                    q25 = non_null.quantile(0.25)
                    q75 = non_null.quantile(0.75)
                    iqr = q75 - q25
                    lower_bound = q25 - 1.5 * iqr
                    upper_bound = q75 + 1.5 * iqr

                    if o_action == "clip_iqr":
                        before_clip = df[col].copy()
                        df[col] = df[col].clip(lower=lower_bound, upper=upper_bound)
                        outliers_clipped += int((before_clip != df[col]).sum())
                        modified_columns.append({"column": col, "action": f"Clipped outliers to [{round(lower_bound, 2)}, {round(upper_bound, 2)}]"})
                    elif o_action == "drop_outliers":
                        before_drop = len(df)
                        df = df[(df[col] >= lower_bound) & (df[col] <= upper_bound) | df[col].isnull()]
                        dropped_o = before_drop - len(df)
                        modified_columns.append({"column": col, "action": f"Dropped {dropped_o} outlier rows"})

        # 3. Standardize text whitespace globally if selected
        if standardize_text:
            text_cols = df.select_dtypes(include=['object']).columns
            for tc in text_cols:
                df[tc] = df[tc].apply(lambda x: x.strip() if isinstance(x, str) else x)

        final_rows = len(df)
        final_missing = int(df.isnull().sum().sum())
        total_rows_removed = initial_rows - final_rows

        # Format sample rows
        sample_rows = json.loads(df.head(10).to_json(orient='records'))

        cursor = conn.execute("PRAGMA table_info(data)")
        columns_info = cursor.fetchall()
        schema = {col_info[1]: col_info[2] for col_info in columns_info}
        columns = list(df.columns)

        if not preview_only:
            # Materialize cleaned data into SQLite
            df.to_sql(table_name, conn, if_exists="replace", index=False)
            conn.commit()

        return {
            "preview_only": preview_only,
            "has_original_backup": has_original,
            "summary": {
                "initial_rows": initial_rows,
                "final_rows": final_rows,
                "rows_removed": total_rows_removed,
                "rows_dropped_duplicates": rows_dropped_duplicates,
                "rows_dropped_missing": rows_dropped_missing,
                "initial_missing": initial_missing,
                "final_missing": final_missing,
                "values_filled": filled_values_count,
                "outliers_clipped": outliers_clipped,
                "columns_modified": modified_columns,
            },
            "columns": columns,
            "schema": schema,
            "sample_rows": sample_rows,
            "row_count": final_rows,
        }
    finally:
        conn.close()


def revert_to_original(db_path: str, table_name: str = "data") -> Dict[str, Any]:
    """
    Restore 'data' from 'data_original' table backup.
    """
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='data_original'")
        if not cur.fetchone():
            raise ValueError("No original dataset backup found for this session.")

        df_orig = pd.read_sql("SELECT * FROM data_original", conn)
        df_orig.to_sql(table_name, conn, if_exists="replace", index=False)
        conn.commit()

        cursor = conn.execute(f"PRAGMA table_info({table_name})")
        columns_info = cursor.fetchall()
        schema = {col_info[1]: col_info[2] for col_info in columns_info}
        columns = list(df_orig.columns)
        sample_rows = json.loads(df_orig.head(10).to_json(orient='records'))

        return {
            "success": True,
            "message": "Reverted dataset to original uploaded state.",
            "columns": columns,
            "schema": schema,
            "sample_rows": sample_rows,
            "row_count": len(df_orig),
        }
    finally:
        conn.close()
