"""
InsightAI Dynamic Dashboard & Smart Query Generator.
Generates fully dataset-aware KPIs, charts, and natural language analytical queries
for ANY uploaded dataset (Netflix, Sales, Supermarket, Healthcare, Finance, etc.).
"""

import json
import re
from typing import Dict, List, Any, Optional
import pandas as pd
import numpy as np


def detect_column_roles(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Introspect dataset columns to discover semantic and statistical roles.
    """
    roles = {
        "primary_id": None,
        "title_or_name": None,
        "date_cols": [],
        "year_cols": [],
        "currency_num_cols": [],
        "score_num_cols": [],
        "general_num_cols": [],
        "binary_or_low_cardinality_cat": [],
        "medium_cardinality_cat": [],
        "high_cardinality_cat": [],
        "multi_value_cat": [],
        "all_categorical": [],
        "all_numeric": []
    }

    cols = list(df.columns)
    for col in cols:
        series = df[col]
        col_lower = str(col).lower()
        non_null = series.dropna()

        # Check numeric
        if pd.api.types.is_numeric_dtype(series.dtype):
            roles["all_numeric"].append(col)
            # Check if year
            if any(k in col_lower for k in ["year", "release_year", "yr"]):
                roles["year_cols"].append(col)
            # Check if currency/monetary
            elif any(k in col_lower for k in ["sales", "revenue", "boxoffice", "price", "profit", "cost", "budget", "amount", "spend", "income"]):
                roles["currency_num_cols"].append(col)
            # Check if score/rating
            elif any(k in col_lower for k in ["score", "rating", "rank", "rate", "percent", "pct"]):
                roles["score_num_cols"].append(col)
            else:
                roles["general_num_cols"].append(col)
            continue

        # Check datetime
        if pd.api.types.is_datetime64_any_dtype(series.dtype):
            roles["date_cols"].append(col)
            continue

        if len(non_null) > 0:
            sample_str = non_null.astype(str)
            # Check if text contains dates
            if sample_str.str.contains(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}').sum() > len(non_null) * 0.5:
                roles["date_cols"].append(col)
                continue

        # Categorical / text
        roles["all_categorical"].append(col)
        unique_cnt = series.nunique()

        # Primary name / title
        if any(col_lower == k for k in ["title", "name", "movie", "item", "product", "film"]):
            roles["title_or_name"] = col
        elif any(col_lower.endswith(k) for k in ["_name", "title", "_id"]) and not roles["primary_id"]:
            roles["primary_id"] = col

        # Multi-value field (e.g. genre with "Comedy, Drama, Action" or tags with "Action, Thriller")
        if len(non_null) > 0 and sample_str.str.contains(r',\s*').sum() > len(non_null) * 0.2:
            roles["multi_value_cat"].append(col)

        if 2 <= unique_cnt <= 6:
            roles["binary_or_low_cardinality_cat"].append(col)
        elif 7 <= unique_cnt <= 35:
            roles["medium_cardinality_cat"].append(col)
        else:
            roles["high_cardinality_cat"].append(col)

    return roles


def compute_dynamic_kpis(df: pd.DataFrame, roles: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate meaningful, schema-aware KPIs based on the actual columns.
    Avoids hardcoding '$' unless the column is genuinely currency!
    """
    total_rows = len(df)
    total_cols = len(df.columns)
    missing_pct = round((df.isnull().sum().sum() / max(1, total_rows * total_cols)) * 100, 1)
    completeness_pct = round(100.0 - missing_pct, 1)

    # 1. Primary Hero KPI
    primary = {}
    if roles["title_or_name"]:
        col = roles["title_or_name"]
        uniq = df[col].nunique()
        primary = {
            "label": f"Total {col.replace('_', ' ').title()}s",
            "value": f"{uniq:,}",
            "desc": f"Unique {col.replace('_', ' ')}s tracked across {total_rows:,} records",
            "badge": "Primary Entity"
        }
    elif roles["currency_num_cols"]:
        col = roles["currency_num_cols"][0]
        val = df[col].sum()
        formatted_val = f"${val:,.0f}" if val >= 1000 else f"${val:,.2f}"
        if val >= 1_000_000_000:
            formatted_val = f"${val / 1_000_000_000:.2f}B"
        elif val >= 1_000_000:
            formatted_val = f"${val / 1_000_000:.2f}M"
        primary = {
            "label": f"Total {col.replace('_', ' ').title()}",
            "value": formatted_val,
            "desc": f"Aggregated across {total_rows:,} records",
            "badge": "Financial Metric"
        }
    elif roles["score_num_cols"]:
        col = roles["score_num_cols"][0]
        avg_score = df[col].dropna().mean()
        primary = {
            "label": f"Average {col.replace('_', ' ').title()}",
            "value": f"{avg_score:.2f}" if pd.notnull(avg_score) else "N/A",
            "desc": f"Mean score calculated from active observations",
            "badge": "Quality Metric"
        }
    else:
        primary = {
            "label": "Total Active Records",
            "value": f"{total_rows:,}",
            "desc": f"Dataset dimensions: {total_cols} columns",
            "badge": "Dataset Size"
        }

    # 2. Secondary KPIs (up to 4 cards)
    secondary = []

    # Secondary 1: Binary / Type distribution (e.g. Series vs Movie, Active vs Inactive)
    if roles["binary_or_low_cardinality_cat"]:
        b_col = roles["binary_or_low_cardinality_cat"][0]
        counts = df[b_col].dropna().value_counts()
        if len(counts) >= 2:
            top1_name, top1_cnt = counts.index[0], counts.iloc[0]
            top2_name, top2_cnt = counts.index[1], counts.iloc[1]
            p1 = round((top1_cnt / max(1, len(df[b_col].dropna()))) * 100)
            p2 = round((top2_cnt / max(1, len(df[b_col].dropna()))) * 100)
            secondary.append({
                "label": f"{b_col.replace('_', ' ').title()} Breakdown",
                "value": f"{p1}% / {p2}%",
                "icon": "pie",
                "desc": f"{str(top1_name).title()} ({p1}%) vs {str(top2_name).title()} ({p2}%)"
            })

    # Secondary 2: Country / Geographic reach or medium category count
    country_cols = [c for c in roles["all_categorical"] if any(k in c.lower() for k in ["country", "region", "city", "state", "location"])]
    if country_cols:
        c_col = country_cols[0]
        c_series = df[c_col].dropna()
        if c_col in roles["multi_value_cat"]:
            # Split comma separated countries
            all_countries = c_series.astype(str).str.split(r',\s*').explode().str.strip()
            unique_countries = all_countries[all_countries != ""].nunique()
        else:
            unique_countries = c_series.nunique()
        secondary.append({
            "label": "Geographic Reach",
            "value": f"{unique_countries:,} Locations",
            "icon": "globe",
            "desc": f"Distinct locations covered in {c_col.replace('_', ' ').title()}"
        })
    elif roles["medium_cardinality_cat"]:
        m_col = roles["medium_cardinality_cat"][0]
        cnt = df[m_col].nunique()
        secondary.append({
            "label": f"Unique {m_col.replace('_', ' ').title()}s",
            "value": f"{cnt:,} Groups",
            "icon": "grid",
            "desc": f"Categorical dimension variation"
        })

    # Secondary 3: Temporal span or Year range
    if roles["date_cols"] or roles["year_cols"]:
        t_col = (roles["year_cols"] + roles["date_cols"])[0]
        t_series = df[t_col].dropna()
        if len(t_series) > 0:
            if t_col in roles["year_cols"]:
                y_min = int(t_series.min())
                y_max = int(t_series.max())
                secondary.append({
                    "label": f"{t_col.replace('_', ' ').title()} Span",
                    "value": f"{y_min} – {y_max}",
                    "icon": "clock",
                    "desc": f"Spans {y_max - y_min + 1} chronological years"
                })
            else:
                try:
                    dates = pd.to_datetime(t_series, errors='coerce').dropna()
                    if len(dates) > 0:
                        secondary.append({
                            "label": "Temporal Coverage",
                            "value": f"{dates.min().year} – {dates.max().year}",
                            "icon": "clock",
                            "desc": f"Time window of recorded observations"
                        })
                except Exception:
                    pass

    # Secondary 4: Quality / Score or Data Completeness
    if roles["score_num_cols"]:
        s_col = roles["score_num_cols"][0]
        val = df[s_col].dropna().mean()
        if pd.notnull(val):
            secondary.append({
                "label": f"Avg {s_col.replace('_', ' ').title()}",
                "value": f"{val:.2f}",
                "icon": "star",
                "desc": f"Score distribution midpoint"
            })
    
    # If less than 3 secondary KPIs, add Data Completeness
    if len(secondary) < 3:
        secondary.append({
            "label": "Data Completeness",
            "value": f"{completeness_pct}%",
            "icon": "check",
            "statusColor": "text-emerald-500",
            "desc": f"{total_rows * total_cols - df.isnull().sum().sum():,} complete cells"
        })

    return {
        "primary": primary,
        "secondary": secondary[:3]
    }


def generate_dataset_dashboard(df: pd.DataFrame, max_charts: int = 8) -> Dict[str, Any]:
    """
    Introspect dataset and generate clean, highly-relevant, correctly-aggregated charts.
    """
    if df.empty:
        return {"kpis": None, "charts": [], "summary": {}}

    total_rows = len(df)
    total_cols = len(df.columns)
    roles = detect_column_roles(df)
    kpis = compute_dynamic_kpis(df, roles)
    charts = []

    # -------------------------------------------------------------
    # 1. Content Distribution / Binary Breakdown (Donut / Pie)
    # -------------------------------------------------------------
    if roles["binary_or_low_cardinality_cat"]:
        cat_col = roles["binary_or_low_cardinality_cat"][0]
        vc = df[cat_col].dropna().value_counts()
        if len(vc) >= 2:
            pie_data = [
                {"name": str(k).title(), "value": int(v), "formatted": f"{int(v):,} ({round(v/len(df)*100, 1)}%)"}
                for k, v in vc.items()
            ]
            charts.append({
                "id": f"chart_pie_{cat_col}",
                "type": "pie",
                "title": f"Distribution of {cat_col.replace('_', ' ').title()}",
                "description": f"Proportion breakdown across {len(pie_data)} categories",
                "x_axis": "name",
                "y_axis": "value",
                "features": [cat_col],
                "data": pie_data,
                "confidence": 0.95
            })

    # -------------------------------------------------------------
    # 2. Chronological Trend (Area / Line Chart)
    # -------------------------------------------------------------
    time_col = None
    if roles["date_cols"]:
        time_col = roles["date_cols"][0]
        try:
            dates = pd.to_datetime(df[time_col], errors='coerce').dropna()
            if len(dates) > 10:
                year_counts = dates.dt.year.value_counts().sort_index()
                # Filter out crazy future/past outliers (e.g., year < 1920 or year > 2030)
                year_counts = year_counts[(year_counts.index >= 1920) & (year_counts.index <= 2030)]
                line_data = [
                    {"name": str(yr), "year": int(yr), "count": int(cnt), "value": int(cnt)}
                    for yr, cnt in year_counts.items()
                ]
                if len(line_data) >= 3:
                    charts.append({
                        "id": f"chart_trend_{time_col}",
                        "type": "area",
                        "title": f"Releases & Activity Over Time ({time_col.replace('_', ' ').title()})",
                        "description": f"Yearly volume trend from {line_data[0]['year']} to {line_data[-1]['year']}",
                        "x_axis": "name",
                        "y_axis": "value",
                        "series": ["value"],
                        "features": [time_col],
                        "data": line_data,
                        "confidence": 0.92
                    })
        except Exception:
            pass
    elif roles["year_cols"]:
        y_col = roles["year_cols"][0]
        y_series = pd.to_numeric(df[y_col], errors='coerce').dropna()
        y_counts = y_series[(y_series >= 1920) & (y_series <= 2030)].value_counts().sort_index()
        line_data = [
            {"name": str(int(yr)), "year": int(yr), "count": int(cnt), "value": int(cnt)}
            for yr, cnt in y_counts.items()
        ]
        if len(line_data) >= 3:
            charts.append({
                "id": f"chart_trend_{y_col}",
                "type": "area",
                "title": f"Releases by {y_col.replace('_', ' ').title()}",
                "description": f"Annual volume trend",
                "x_axis": "name",
                "y_axis": "value",
                "series": ["value"],
                "features": [y_col],
                "data": line_data,
                "confidence": 0.90
            })

    # -------------------------------------------------------------
    # 3. Categorical Ranking / Genre / Content Type (Bar Chart)
    # -------------------------------------------------------------
    # Check multi-value column first (e.g. genre with "Comedy, Drama, Romance")
    if roles["multi_value_cat"]:
        m_col = roles["multi_value_cat"][0]
        exploded = df[m_col].dropna().astype(str).str.split(r',\s*').explode().str.strip()
        exploded = exploded[(exploded != "") & (exploded != "nan")]
        top_cats = exploded.value_counts().head(10)
        bar_data = [
            {"name": str(cat).title(), "value": int(cnt), "formatted": f"{int(cnt):,} titles"}
            for cat, cnt in top_cats.items()
        ]
        if bar_data:
            charts.append({
                "id": f"chart_bar_{m_col}",
                "type": "bar",
                "title": f"Top 10 {m_col.replace('_', ' ').title()}s",
                "description": f"Most frequent individual {m_col.replace('_', ' ')} items across dataset",
                "x_axis": "name",
                "y_axis": "value",
                "series": ["value"],
                "features": [m_col],
                "data": bar_data,
                "confidence": 0.94
            })
    elif roles["medium_cardinality_cat"]:
        m_col = roles["medium_cardinality_cat"][0]
        # Aggregate by count or sum of primary numeric column
        if roles["currency_num_cols"]:
            num_c = roles["currency_num_cols"][0]
            grouped = df.groupby(m_col)[num_c].sum().sort_values(ascending=False).head(10)
            bar_data = [
                {"name": str(cat).title()[:20], "value": float(round(val, 2)), "formatted": f"${val:,.0f}"}
                for cat, val in grouped.items()
            ]
            charts.append({
                "id": f"chart_bar_{m_col}_{num_c}",
                "type": "bar",
                "title": f"Total {num_c.replace('_', ' ').title()} by {m_col.replace('_', ' ').title()}",
                "description": f"Top 10 categories ranked by {num_c.replace('_', ' ')}",
                "x_axis": "name",
                "y_axis": "value",
                "series": ["value"],
                "features": [m_col, num_c],
                "data": bar_data,
                "confidence": 0.88
            })
        else:
            top_cats = df[m_col].dropna().value_counts().head(10)
            bar_data = [
                {"name": str(cat).title()[:20], "value": int(cnt), "formatted": f"{int(cnt):,} records"}
                for cat, cnt in top_cats.items()
            ]
            charts.append({
                "id": f"chart_bar_{m_col}",
                "type": "bar",
                "title": f"Top {m_col.replace('_', ' ').title()}s by Volume",
                "description": f"Frequency distribution across top 10 categories",
                "x_axis": "name",
                "y_axis": "value",
                "series": ["value"],
                "features": [m_col],
                "data": bar_data,
                "confidence": 0.86
            })

    # -------------------------------------------------------------
    # 4. Rating / Classification Breakdown (Bar / Pie)
    # -------------------------------------------------------------
    rating_cols = [c for c in roles["all_categorical"] if any(k in c.lower() for k in ["rating", "view_rating", "certification", "grade", "content_rating"])]
    if rating_cols:
        r_col = rating_cols[0]
        top_ratings = df[r_col].dropna().value_counts().head(8)
        rating_data = [
            {"name": str(r).upper()[:15], "value": int(cnt), "formatted": f"{int(cnt):,} titles"}
            for r, cnt in top_ratings.items()
        ]
        charts.append({
            "id": f"chart_bar_{r_col}",
            "type": "bar",
            "title": f"Content Ratings ({r_col.replace('_', ' ').title()})",
            "description": f"Distribution of content maturity and audience certifications",
            "x_axis": "name",
            "y_axis": "value",
            "series": ["value"],
            "features": [r_col],
            "data": rating_data,
            "confidence": 0.89
        })

    # -------------------------------------------------------------
    # 5. Geographic Reach / Country Availability (Bar)
    # -------------------------------------------------------------
    geo_cols = [c for c in roles["all_categorical"] if any(k in c.lower() for k in ["country", "region", "market", "state"])]
    if geo_cols and geo_cols[0] != roles.get("binary_or_low_cardinality_cat", [None])[0]:
        g_col = geo_cols[0]
        g_series = df[g_col].dropna().astype(str)
        if g_col in roles["multi_value_cat"]:
            exploded = g_series.str.split(r',\s*').explode().str.strip()
            top_countries = exploded[(exploded != "") & (exploded != "nan")].value_counts().head(10)
        else:
            top_countries = g_series.value_counts().head(10)

        geo_data = [
            {"name": str(cntry).title()[:20], "value": int(cnt), "formatted": f"{int(cnt):,} titles"}
            for cntry, cnt in top_countries.items()
        ]
        if geo_data:
            charts.append({
                "id": f"chart_geo_{g_col}",
                "type": "bar",
                "title": f"Top 10 Countries by Availability",
                "description": f"Content density across primary markets",
                "x_axis": "name",
                "y_axis": "value",
                "series": ["value"],
                "features": [g_col],
                "data": geo_data,
                "confidence": 0.91
            })

    # -------------------------------------------------------------
    # 6. Score or Numerical Metric Distribution (Histogram)
    # -------------------------------------------------------------
    target_num_col = None
    if roles["score_num_cols"]:
        target_num_col = roles["score_num_cols"][0]
    elif roles["general_num_cols"]:
        target_num_col = roles["general_num_cols"][0]
    elif roles["currency_num_cols"]:
        target_num_col = roles["currency_num_cols"][0]

    if target_num_col:
        series_clean = pd.to_numeric(df[target_num_col], errors='coerce').dropna()
        if len(series_clean) > 20:
            counts, bins = np.histogram(series_clean, bins=12)
            hist_data = [
                {
                    "name": f"{bins[i]:.1f} - {bins[i+1]:.1f}",
                    "range": f"{bins[i]:.1f} - {bins[i+1]:.1f}",
                    "value": int(counts[i]),
                    "count": int(counts[i])
                }
                for i in range(len(counts))
            ]
            charts.append({
                "id": f"chart_hist_{target_num_col}",
                "type": "bar",
                "title": f"{target_num_col.replace('_', ' ').title()} Distribution",
                "description": f"Statistical frequency spread across 12 equal-interval bins",
                "x_axis": "name",
                "y_axis": "value",
                "series": ["value"],
                "features": [target_num_col],
                "data": hist_data,
                "confidence": 0.85
            })

    # -------------------------------------------------------------
    # 7. Correlation / Relationship Scatter (if 2+ numeric columns)
    # -------------------------------------------------------------
    if len(roles["all_numeric"]) >= 2:
        num1 = roles["all_numeric"][0]
        num2 = roles["all_numeric"][1]
        subset = df[[num1, num2]].dropna()
        if len(subset) > 10:
            # Sample up to 80 points to keep chart performant and crisp
            sample_df = subset.sample(min(80, len(subset)), random_state=42)
            scatter_data = [
                {
                    "name": f"Pt {idx+1}",
                    num1: float(round(r[num1], 2)),
                    num2: float(round(r[num2], 2)),
                    "x": float(round(r[num1], 2)),
                    "y": float(round(r[num2], 2))
                }
                for idx, r in sample_df.iterrows()
            ]
            charts.append({
                "id": f"chart_scatter_{num1}_{num2}",
                "type": "scatter",
                "title": f"{num1.replace('_', ' ').title()} vs {num2.replace('_', ' ').title()}",
                "description": f"Bivariate relationship analysis",
                "x_axis": num1,
                "y_axis": num2,
                "features": [num1, num2],
                "data": scatter_data,
                "confidence": 0.83
            })

    return {
        "kpis": kpis,
        "charts": charts[:max_charts],
        "summary": {
            "total_charts": len(charts[:max_charts]),
            "dataset_info": {
                "rows": total_rows,
                "columns": total_cols
            }
        }
    }


def generate_smart_queries(
    columns: List[str],
    schema: Any,
    sample_rows: List[Dict[str, Any]],
    df: Optional[pd.DataFrame] = None
) -> List[Dict[str, str]]:
    """
    Generate highly-grounded, categorized analytical questions tailored strictly
    to the active dataset. Never returns unrelated queries.
    """
    # Normalize schema into dict {column_name: type_str}
    schema_dict = {}
    if isinstance(schema, dict):
        schema_dict = schema
    elif isinstance(schema, list):
        for item in schema:
            if isinstance(item, dict):
                col_name = item.get("column") or item.get("name") or item.get("col")
                col_type = item.get("type") or item.get("data_type") or ""
                if col_name:
                    schema_dict[col_name] = str(col_type)
            elif isinstance(item, (list, tuple)) and len(item) >= 3:
                schema_dict[item[1]] = str(item[2])

    cols_clean = [str(c).lower().strip() for c in columns]
    queries = []

    # Helper function to add a query if not already added
    seen_texts = set()
    def add_q(text: str, category: str):
        cleaned = text.strip()
        if cleaned and cleaned not in seen_texts:
            seen_texts.add(cleaned)
            queries.append({"question": cleaned, "category": category})

    # Detect entity types
    is_media_dataset = any(k in cols_clean for k in ["title", "series_or_movie", "genre", "director", "imdb_score", "view_rating", "actors"])
    is_sales_dataset = any(k in cols_clean for k in ["sales", "revenue", "order_date", "profit", "customer", "product", "quantity"])

    # 1. Overview & Summaries
    if is_media_dataset:
        if "series_or_movie" in cols_clean:
            add_q("What is the distribution of movies and TV shows?", "Overview")
        if "genre" in cols_clean:
            add_q("What content distribution can be identified by genre?", "Categories")
        if "country_availability" in cols_clean:
            add_q("Which countries have the most titles available?", "Ranking")
        if any("rating" in c for c in cols_clean):
            rating_col = [c for c in columns if "rating" in c.lower()][0]
            add_q(f"Which {rating_col.replace('_', ' ')} categories appear most frequently?", "Categories")
        if any("release" in c for c in cols_clean):
            add_q("How has the number of titles released changed over time?", "Trends")
        if "imdb_score" in cols_clean:
            add_q("Top 10 highest-rated titles by IMDb Score", "Ranking")
        if "runtime" in cols_clean:
            add_q("What is the average runtime across titles?", "Statistics")
        if "director" in cols_clean:
            add_q("Which directors have directed the most titles?", "Ranking")

    elif is_sales_dataset:
        if any("region" in c for c in cols_clean):
            add_q("What is the total sales per region?", "Overview")
        if any("product" in c for c in cols_clean):
            add_q("Top 5 products by sales volume", "Ranking")
        if any("date" in c for c in cols_clean):
            add_q("How do sales trend month over month?", "Trends")
        if any("profit" in c for c in cols_clean) and any("sales" in c for c in cols_clean):
            add_q("Relationship between sales and profit margins", "Statistics")
        if any("quantity" in c for c in cols_clean):
            add_q("Average order quantity across categories", "Statistics")

    # Generic & Adaptive queries based on existing columns
    date_cols = [c for c in columns if any(k in c.lower() for k in ["date", "year", "time", "month"])]
    num_cols = [c for c in columns if any(t in str(schema_dict.get(c, '')).lower() for t in ['int', 'float', 'real', 'num', 'double']) or any(k in c.lower() for k in ['score', 'sales', 'cost', 'price', 'amount', 'votes', 'total', 'count'])]
    cat_cols = [c for c in columns if c not in num_cols and not c.lower().endswith('_id')]

    clean_n = lambda s: s.replace('_', ' ').title()

    # Trend queries
    if date_cols:
        d = date_cols[0]
        if num_cols:
            add_q(f"How does {clean_n(num_cols[0])} trend over {clean_n(d)}?", "Trends")
        else:
            add_q(f"How has record count changed over {clean_n(d)}?", "Trends")

    # Category comparisons
    if cat_cols and num_cols:
        add_q(f"Average {clean_n(num_cols[0])} grouped by {clean_n(cat_cols[0])}", "Categories")
        add_q(f"Show total {clean_n(num_cols[0])} per {clean_n(cat_cols[0])}", "Overview")

    if cat_cols:
        add_q(f"Top 5 {clean_n(cat_cols[0])} by frequency", "Ranking")

    # Distribution & Stats
    if num_cols:
        add_q(f"What is the distribution of {clean_n(num_cols[0])}?", "Statistics")
        if len(num_cols) > 1:
            add_q(f"Correlation between {clean_n(num_cols[0])} and {clean_n(num_cols[1])}", "Statistics")

    # Data Quality query
    add_q("Which columns contain the most missing or null values?", "Data Quality")

    return queries[:8]
