"""
Statistical analysis and auto-insights generation service.
"""
import pandas as pd
import numpy as np


def compute_stats(df: pd.DataFrame) -> dict:
    """
    Compute basic statistics for all numeric columns in the DataFrame.

    Returns:
        Dictionary of {column_name: {mean, median, std, min, max, count}}
    """
    numeric_df = df.select_dtypes(include='number')

    if numeric_df.empty:
        return {}

    stats = {}
    for col in numeric_df.columns:
        series = numeric_df[col].dropna()
        if len(series) == 0:
            continue
        stats[col] = {
            "mean": round(float(series.mean()), 2),
            "median": round(float(series.median()), 2),
            "std": round(float(series.std()), 2) if len(series) > 1 else 0,
            "min": round(float(series.min()), 2),
            "max": round(float(series.max()), 2),
            "count": int(len(series)),
        }

    return stats


def detect_trends(df: pd.DataFrame) -> list[str]:
    """
    Detect basic trends in numeric columns.

    Returns:
        List of trend description strings
    """
    trends = []
    numeric_cols = df.select_dtypes(include='number').columns.tolist()

    for col in numeric_cols:
        series = df[col].dropna()
        if len(series) < 3:
            continue

        # Simple trend: compare first half avg to second half avg
        mid = len(series) // 2
        first_half = series.iloc[:mid].mean()
        second_half = series.iloc[mid:].mean()

        if second_half > first_half * 1.1:
            trends.append(f"{col} shows an upward trend (increased by {((second_half/first_half - 1)*100):.1f}%).")
        elif second_half < first_half * 0.9:
            trends.append(f"{col} shows a downward trend (decreased by {((1 - second_half/first_half)*100):.1f}%).")
        else:
            trends.append(f"{col} remains relatively stable.")

    return trends


def generate_insights(df: pd.DataFrame, stats: dict = None) -> list[str]:
    if stats is None:
        stats = {}
    """
    Generate auto-insight statements from the data and statistics.

    Returns:
        List of insight strings
    """
    insights = []

    if df.empty:
        return insights

    cols = list(df.columns)
    numeric_cols = df.select_dtypes(include='number').columns.tolist()
    non_numeric_cols = [c for c in cols if c not in numeric_cols]

    # Insight 0: Correlation insight for 2-numeric-column results (scatter / relationship queries)
    if len(numeric_cols) >= 2 and len(non_numeric_cols) == 0:
        try:
            import numpy as np
            x = pd.to_numeric(df[numeric_cols[0]], errors='coerce').dropna()
            y = pd.to_numeric(df[numeric_cols[1]], errors='coerce').dropna()
            common_idx = x.index.intersection(y.index)
            if len(common_idx) >= 5:
                x_vals = x[common_idx]
                y_vals = y[common_idx]
                if x_vals.nunique() > 1 and y_vals.nunique() > 1:
                    corr = float(np.corrcoef(x_vals, y_vals)[0, 1])
                    if not np.isnan(corr) and not np.isinf(corr):
                        lbl_x = numeric_cols[0].replace('_', ' ').title()
                        lbl_y = numeric_cols[1].replace('_', ' ').title()
                        strength = (
                            "strong positive" if corr >= 0.7 else
                            "moderate positive" if corr >= 0.4 else
                            "weak positive" if corr > 0.1 else
                            "strong negative" if corr <= -0.7 else
                            "moderate negative" if corr <= -0.4 else
                            "weak negative" if corr < -0.1 else
                            "negligible"
                        )
                        insights.append(
                            f"{lbl_x} and {lbl_y} show a {strength} correlation (r = {corr:.2f})."
                        )
        except Exception:
            pass

    # Insight 1: Identify top contributor (categorical + numeric)
    if non_numeric_cols and numeric_cols:
        cat_col = non_numeric_cols[0]
        num_col = numeric_cols[0]

        try:
            grouped = df.groupby(cat_col)[num_col].sum().sort_values(ascending=False)
            if len(grouped) > 1:
                top = grouped.index[0]
                top_val = grouped.iloc[0]
                total = grouped.sum()
                pct = (top_val / total * 100) if total > 0 else 0
                insights.append(
                    f"{cat_col.replace('_', ' ').title()} '{top}' contributes the highest "
                    f"{num_col.replace('_', ' ')} ({pct:.1f}% of total)."
                )
                # Also mention lowest
                bot = grouped.index[-1]
                bot_pct = (grouped.iloc[-1] / total * 100) if total > 0 else 0
                if len(grouped) > 2:
                    insights.append(
                        f"'{bot}' contributes the least {num_col.replace('_', ' ')} ({bot_pct:.1f}% of total)."
                    )
        except Exception:
            pass

    # Insight 2: Min and max from stats
    for col, col_stats in stats.items():
        if 'min' in col_stats and 'max' in col_stats:
            range_val = col_stats['max'] - col_stats['min']
            insights.append(
                f"{col.replace('_', ' ').title()} ranges from {col_stats['min']:,.2f} "
                f"to {col_stats['max']:,.2f} (range: {range_val:,.2f})."
            )
            if 'mean' in col_stats:
                insights.append(
                    f"Average {col.replace('_', ' ')} is {col_stats['mean']:,.2f}."
                )
            break  # Just one column's range insight

    # Insight 3: Add trend insights
    trends = detect_trends(df)
    insights.extend(trends[:2])  # Limit to 2 trend insights

    # Insight 4: Row count insight
    insights.append(f"Analysis based on {len(df)} data points across {len(cols)} columns.")

    return insights

