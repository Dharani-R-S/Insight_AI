"""
Chart generation service — Smart chart selection and Plotly rendering.
"""
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import plotly.io as pio
import base64
import re


def prettify_col(col: str) -> str:
    """Turn raw SQL column names into readable chart labels.

    Examples:
        sum(sales)   → Sales (sum)
        avg(profit)  → Profit (avg)
        region       → Region
    """
    m = re.match(r'^(sum|avg|count|min|max)\s*\((.+)\)$', col.strip(), re.IGNORECASE)
    if m:
        agg, inner = m.group(1).lower(), m.group(2).strip().strip('"')
        return f"{inner.replace('_', ' ').title()} ({agg})"
    return col.strip('"').replace('_', ' ').title()


def _resolve_axes(df: pd.DataFrame):
    """Return (x_col, y_cols, non_num_cols) with x always being the
    first categorical column and y_cols always being numeric columns.

    Handles the common case where the SQL model puts the aggregate
    first: e.g. columns = ['sum(sales)', 'region'].
    """
    cols = list(df.columns)
    num_cols = df.select_dtypes(include='number').columns.tolist()
    non_num_cols = [c for c in cols if c not in num_cols]

    # Prefer a text/categorical column as the x-axis label
    x_col = non_num_cols[0] if non_num_cols else cols[0]
    y_cols = num_cols if num_cols else [c for c in cols if c != x_col]
    return x_col, y_cols, non_num_cols


def detect_chart_type(df: pd.DataFrame) -> str:
    """
    Detect the best chart type based on the data shape and content.
    Uses _resolve_axes so the x-column is always categorical (not numeric).

    Returns: 'bar', 'line', 'pie', 'histogram', or 'scatter'
    """
    if df.empty or len(df.columns) < 1:
        return 'bar'

    cols = list(df.columns)
    num_cols = df.select_dtypes(include='number').columns.tolist()
    non_num_cols = [c for c in cols if c not in num_cols]

    # Single numeric column → histogram
    if len(cols) == 1 and len(num_cols) == 1:
        return 'histogram'

    if len(cols) >= 2:
        # Always use the categorical column as the x-axis for type detection
        x_col, _, _ = _resolve_axes(df)
        x_values = df[x_col].astype(str)

        # Check if x-axis is time-based
        is_time = False
        try:
            pd.to_datetime(x_values, format='mixed')
            is_time = True
        except (ValueError, TypeError):
            time_patterns = [
                r'^\d{4}$',           # Year
                r'^\d{4}[-/]\d{2}',   # YYYY-MM
                r'(?i)^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)',
            ]
            if all(any(re.match(p, str(v)) for p in time_patterns)
                   for v in x_values.head(3)):
                is_time = True

        if is_time:
            return 'line'

        # Few distinct categories → pie
        if len(df) <= 6 and len(num_cols) >= 1 and len(non_num_cols) >= 1:
            return 'pie'

        # Many data points → line
        if len(df) > 15:
            return 'line'

    return 'bar'


def generate_chart(df: pd.DataFrame, chart_type: str = None) -> str:
    """
    Generate a chart from a DataFrame and return it as a base64-encoded PNG.

    Args:
        df: The data to chart
        chart_type: Override chart type detection (optional)

    Returns:
        Base64-encoded PNG string, or empty string if chart cannot be generated
    """
    if df.empty or len(df.columns) < 1:
        return ""

    if chart_type is None:
        chart_type = detect_chart_type(df)

    cols = list(df.columns)
    num_cols = df.select_dtypes(include='number').columns.tolist()

    # Resolve correct categorical (x) and numeric (y) axes — Fix #3
    x_col, y_cols, non_num_cols = _resolve_axes(df)

    # Dark theme template
    layout_defaults = dict(
        template="plotly_dark",
        paper_bgcolor='rgba(15,15,26,0.9)',
        plot_bgcolor='rgba(22,33,62,0.6)',
        font=dict(family="Inter, sans-serif", color="#e8e8f0"),
        margin=dict(l=50, r=30, t=50, b=50),
        height=400,
        width=700,
    )

    try:
        fig = None

        if chart_type == 'histogram' and len(num_cols) >= 1:
            fig = px.histogram(
                df, x=num_cols[0],
                title=f"Distribution of {prettify_col(num_cols[0])}",
                color_discrete_sequence=['#6c63ff'],
            )

        elif chart_type == 'pie' and len(cols) >= 2:
            # Fix #3: always use categorical as names, numeric as values
            pie_label = x_col
            pie_value = y_cols[0] if y_cols else cols[1]
            fig = px.pie(
                df, names=pie_label, values=pie_value,
                title=f"{prettify_col(pie_value)} by {prettify_col(pie_label)}",
                color_discrete_sequence=px.colors.sequential.Purp,
            )

        elif chart_type == 'line' and len(cols) >= 2 and len(num_cols) >= 1:
            # Fix #3: use categorical column on x-axis
            line_x = x_col
            line_ys = y_cols if y_cols else [c for c in cols if c != line_x]
            fig = go.Figure()
            colors = ['#6c63ff', '#00e676', '#ffab40', '#ff5252', '#40c4ff']
            for i, yc in enumerate(line_ys[:5]):
                fig.add_trace(go.Scatter(
                    x=df[line_x], y=df[yc],
                    mode='lines+markers',
                    name=prettify_col(yc),
                    line=dict(color=colors[i % len(colors)], width=2),
                    marker=dict(size=6),
                ))
            # Fix #5: readable title
            y_labels = ', '.join(prettify_col(c) for c in line_ys[:3])
            fig.update_layout(title=f"{y_labels} over {prettify_col(line_x)}")

        elif chart_type == 'scatter' and len(num_cols) >= 2:
            fig = px.scatter(
                df, x=num_cols[0], y=num_cols[1],
                title=f"{prettify_col(num_cols[1])} vs {prettify_col(num_cols[0])}",
                color_discrete_sequence=['#6c63ff'],
            )

        else:  # bar chart (default)
            if len(cols) >= 2:
                # Fix #3: use categorical as x, all numerics as y bars
                bar_x = x_col
                bar_ys = y_cols if y_cols else [c for c in cols if c != bar_x]
                if not bar_ys:
                    return ""
                fig = go.Figure()
                colors = ['#6c63ff', '#8b83ff', '#00e676', '#ffab40', '#ff5252']
                for i, yc in enumerate(bar_ys[:5]):
                    fig.add_trace(go.Bar(
                        x=df[bar_x], y=df[yc],
                        name=prettify_col(yc),
                        marker_color=colors[i % len(colors)],
                    ))
                # Fix #5: readable title
                y_labels = ', '.join(prettify_col(c) for c in bar_ys[:3])
                fig.update_layout(
                    title=f"{y_labels} by {prettify_col(bar_x)}",
                    barmode='group',
                )
            else:
                return ""

        if fig is None:
            return ""

        fig.update_layout(**layout_defaults)

        # Convert to base64 PNG
        img_bytes = pio.to_image(fig, format="png", scale=2)
        return base64.b64encode(img_bytes).decode('utf-8')

    except Exception as e:
        print(f"Chart generation error: {e}")
        return ""
