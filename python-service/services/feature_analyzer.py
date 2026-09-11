"""
Feature Analyzer - Hybrid approach (rules + LLM) for intelligent visualization recommendations
Analyzes dataset to suggest appropriate charts based on data characteristics
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Tuple, Optional
import os
from services.llm import call_llm, resolve_llm_config


class FeatureAnalyzer:
    """Analyze dataset features for visualization recommendations"""
    
    def __init__(self, llm_config: Optional[Dict[str, Any]] = None):
        self.llm_config = llm_config
    
    def analyze_dataset(self, df: pd.DataFrame, max_recommendations: int = 5, llm_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Analyze dataset and provide visualization recommendations using hybrid approach.
        """
        if df.empty:
            return {'recommendations': [], 'error': 'Empty dataset'}
        
        active_config = llm_config or self.llm_config
        try:
            # Step 1: Rule-based analysis
            rule_recommendations = self._rule_based_recommendations(df)
            
            # Step 2: LLM enhancement
            try:
                enhanced_recommendations = self._llm_enhance_recommendations(
                    df, rule_recommendations, active_config
                )
            except Exception as llm_err:
                print(f"⚠️ LLM enhancement skipped: {llm_err}")
                enhanced_recommendations = rule_recommendations
            
            # Step 3: Limit to max recommendations
            final_recommendations = enhanced_recommendations[:max_recommendations]
            
            return {
                'recommendations': final_recommendations,
                'summary': {
                    'total_recommendations': len(final_recommendations),
                    'dataset_info': {
                        'rows': len(df),
                        'columns': len(df.columns),
                        'numeric_cols': self._get_numeric_columns(df),
                        'categorical_cols': self._get_categorical_columns(df),
                    }
                }
            }
        
        except Exception as e:
            return {'recommendations': [], 'error': str(e)}
    
    def _rule_based_recommendations(self, df: pd.DataFrame) -> List[Dict]:
        """Generate recommendations based on data characteristics"""
        recommendations = []
        
        numeric_cols = self._get_numeric_columns(df)
        categorical_cols = self._get_categorical_columns(df)
        datetime_cols = self._get_datetime_columns(df)
        
        # Calculate importance (variance for numeric, cardinality for categorical)
        col_importance = self._calculate_column_importance(df, numeric_cols, categorical_cols)
        
        # Rule 1: Time series chart (if datetime + numeric)
        if datetime_cols and numeric_cols:
            dt_col = datetime_cols[0]
            num_col = col_importance[0] if col_importance else numeric_cols[0]
            recommendations.append({
                'type': 'line',
                'title': f'{num_col} Over Time',
                'description': 'Trend analysis',
                'x_axis': dt_col,
                'y_axis': num_col,
                'rationale': 'Time-series pattern detected',
                'confidence': 0.9,
                'features': [dt_col, num_col],
            })
        
        # Rule 2: Numeric distribution (histogram)
        if numeric_cols:
            for col in numeric_cols[:2]:
                recommendations.append({
                    'type': 'histogram',
                    'title': f'{col} Distribution',
                    'description': 'Frequency distribution',
                    'x_axis': col,
                    'y_axis': 'frequency',
                    'rationale': 'Analyze numeric distribution',
                    'confidence': 0.75,
                    'features': [col],
                })
        
        # Rule 3: Categorical breakdown (bar chart)
        if categorical_cols and numeric_cols:
            cat_col = categorical_cols[0]
            num_col = col_importance[0] if col_importance else numeric_cols[0]
            
            # Check cardinality (don't create bar with 1000+ categories)
            if df[cat_col].nunique() <= 50:
                recommendations.append({
                    'type': 'bar',
                    'title': f'{num_col} by {cat_col}',
                    'description': 'Categorical comparison',
                    'x_axis': cat_col,
                    'y_axis': num_col,
                    'rationale': 'Compare values across categories',
                    'confidence': 0.85,
                    'features': [cat_col, num_col],
                })
        
        # Rule 4: Category distribution (pie chart)
        if categorical_cols:
            cat_col = categorical_cols[0]
            if df[cat_col].nunique() <= 10:
                recommendations.append({
                    'type': 'pie',
                    'title': f'{cat_col} Distribution',
                    'description': 'Proportion breakdown',
                    'x_axis': cat_col,
                    'y_axis': None,
                    'rationale': 'Show proportions of categories',
                    'confidence': 0.7,
                    'features': [cat_col],
                })
        
        # Rule 5: Correlation scatter (if 2+ numeric columns)
        if len(numeric_cols) >= 2:
            col1, col2 = numeric_cols[0], numeric_cols[1]
            recommendations.append({
                'type': 'scatter',
                'title': f'{col1} vs {col2}',
                'description': 'Correlation analysis',
                'x_axis': col1,
                'y_axis': col2,
                'rationale': 'Detect relationships between variables',
                'confidence': 0.8,
                'features': [col1, col2],
            })
        
        return recommendations
    
    def _llm_enhance_recommendations(self, df: pd.DataFrame, 
                                   rule_recs: List[Dict],
                                   llm_config: Optional[Dict[str, Any]] = None) -> List[Dict]:
        """Enhance rule-based recommendations using configured LLM provider"""
        if not rule_recs:
            return rule_recs
        
        try:
            # Prepare dataset summary for LLM
            summary = self._prepare_dataset_summary(df)
            
            # Create prompt
            prompt = f"""
Analyze this dataset and suggest visualization recommendations.
Dataset: {summary}

Existing rule-based recommendations:
{self._format_recommendations(rule_recs)}

Please suggest any additional visualizations that might be valuable.
Return ONLY valid recommendations in this exact format:
- Chart type (bar, line, pie, scatter, histogram, area)
- Columns to use (must exist in dataset)
- Brief rationale

IMPORTANT: Only suggest charts if the columns actually exist in the dataset.
Only suggest column pairs that make sense together.
"""
            
            response_text = call_llm(
                prompt=prompt,
                system_prompt="You are an expert data visualization AI assistant.",
                llm_config=llm_config,
                temperature=0.2,
                max_tokens=500,
            )
            
            # Parse LLM response and add to recommendations
            additional_recs = self._parse_llm_response(response_text, df)
            
            # Merge and deduplicate
            all_recs = rule_recs + additional_recs
            unique_recs = self._deduplicate_recommendations(all_recs)
            
            return sorted(unique_recs, key=lambda x: x['confidence'], reverse=True)
        
        except Exception as e:
            print(f"⚠️ LLM enhancement failed: {e}")
            return rule_recs
    
    def _prepare_dataset_summary(self, df: pd.DataFrame) -> str:
        """Create a compact summary of dataset for LLM"""
        numeric_cols = self._get_numeric_columns(df)
        categorical_cols = self._get_categorical_columns(df)
        datetime_cols = self._get_datetime_columns(df)
        
        summary = f"""
- Rows: {len(df)}, Columns: {len(df.columns)}
- Numeric columns ({len(numeric_cols)}): {', '.join(numeric_cols[:5])}
- Categorical columns ({len(categorical_cols)}): {', '.join(categorical_cols[:5])}
- DateTime columns ({len(datetime_cols)}): {', '.join(datetime_cols[:5])}
"""
        return summary
    
    def _format_recommendations(self, recs: List[Dict]) -> str:
        """Format recommendations for LLM"""
        return "\n".join([
            f"- {r['type']}: {r['title']} ({r['x_axis']} vs {r['y_axis']})"
            for r in recs
        ])
    
    def _parse_llm_response(self, response: str, df: pd.DataFrame) -> List[Dict]:
        """Parse LLM response and create recommendation objects"""
        recommendations = []
        lines = response.split('\n')
        
        for line in lines:
            if not line.strip() or not line.startswith('-'):
                continue
            
            try:
                # Try to extract chart type and columns
                parts = line.replace('-', '').strip().split(':')
                if len(parts) < 2:
                    continue
                
                chart_type = parts[0].strip().lower()
                rest = ':'.join(parts[1:]).strip()
                
                # Validate chart type
                if chart_type not in ['bar', 'line', 'pie', 'scatter', 'histogram', 'area']:
                    continue
                
                # Try to extract columns
                cols = self._extract_columns_from_text(rest, df)
                if not cols:
                    continue
                
                # Create recommendation
                rec = {
                    'type': chart_type,
                    'title': rest.split('(')[0].strip(),
                    'description': 'LLM suggestion',
                    'x_axis': cols[0] if len(cols) > 0 else None,
                    'y_axis': cols[1] if len(cols) > 1 else None,
                    'rationale': 'Suggested by AI analysis',
                    'confidence': 0.6,
                    'features': cols,
                }
                
                if rec['x_axis']:  # Only add if has at least x_axis
                    recommendations.append(rec)
            
            except:
                continue
        
        return recommendations
    
    def _extract_columns_from_text(self, text: str, df: pd.DataFrame) -> List[str]:
        """Extract valid column names from text"""
        cols = []
        for col in df.columns:
            if col.lower() in text.lower():
                cols.append(col)
        return cols[:2]  # Max 2 columns
    
    def _deduplicate_recommendations(self, recs: List[Dict]) -> List[Dict]:
        """Remove duplicate recommendations"""
        seen = set()
        unique = []
        
        for rec in recs:
            key = (rec['type'], tuple(sorted(rec['features'])))
            if key not in seen:
                seen.add(key)
                unique.append(rec)
        
        return unique
    
    def _is_id_column(self, col_name: str) -> bool:
        """Check if column is an identifier key rather than a quantitative metric."""
        name = str(col_name).lower().strip()
        return (
            name.endswith('_id') or 
            name.startswith('id_') or 
            name in ['id', 'uuid', 'index', 'seq', 'sequence', 'no', 'number', 'code', 'row_id'] or 
            '_id_' in name
        )

    def _get_numeric_columns(self, df: pd.DataFrame) -> List[str]:
        """Get quantitative numeric columns (excluding identifier keys)"""
        cols = df.select_dtypes(include=[np.number]).columns.tolist()
        return [c for c in cols if not self._is_id_column(c)]

    def _get_categorical_columns(self, df: pd.DataFrame) -> List[str]:
        """Get categorical columns (excluding identifier keys)"""
        cols = df.select_dtypes(include=['object']).columns.tolist()
        return [c for c in cols if not self._is_id_column(c)]

    def _get_datetime_columns(self, df: pd.DataFrame) -> List[str]:
        """Get datetime columns"""
        datetime_cols = []
        for col in df.columns:
            name = str(col).lower().strip()
            if 'date' in name or 'time' in name or 'year' in name or 'month' in name or 'timestamp' in name:
                datetime_cols.append(col)
                continue
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                datetime_cols.append(col)
            elif df[col].dtype == 'object':
                try:
                    pd.to_datetime(df[col], errors='coerce')
                    if df[col].notna().sum() > len(df) * 0.5:
                        datetime_cols.append(col)
                except:
                    pass
        return datetime_cols
    
    def _calculate_column_importance(self, df: pd.DataFrame, 
                                    numeric_cols: List[str],
                                    categorical_cols: List[str]) -> List[str]:
        """Rank columns by importance (variance for numeric, cardinality for categorical)"""
        importance = []
        
        # Numeric: by variance
        for col in numeric_cols:
            try:
                variance = df[col].var()
                importance.append((col, variance))
            except:
                pass
        
        # Sort by importance
        importance.sort(key=lambda x: x[1], reverse=True)
        return [col for col, _ in importance]
    
    def generate_dashboard(self, df: pd.DataFrame, max_charts: int = 8) -> List[Dict]:
        """
        Generate a complete dashboard with multiple related visualizations.
        Creates 6-8 charts showing different aspects of the data.
        
        Returns list of chart objects with data already prepared for frontend rendering.
        """
        if df.empty:
            return []
        
        try:
            numeric_cols = self._get_numeric_columns(df)
            categorical_cols = self._get_categorical_columns(df)
            datetime_cols = self._get_datetime_columns(df)
            
            charts = []
            
            # Chart 1: Time series (if datetime exists)
            if datetime_cols and numeric_cols:
                dt_col = datetime_cols[0]
                num_col = numeric_cols[0]
                chart = self._create_time_series_chart(df, dt_col, num_col)
                if chart:
                    charts.append(chart)
            
            # Chart 2: Top values bar chart (categorical)
            if categorical_cols and numeric_cols:
                cat_col = categorical_cols[0]
                num_col = numeric_cols[0]
                if df[cat_col].nunique() <= 50:
                    chart = self._create_bar_chart(df, cat_col, num_col)
                    if chart:
                        charts.append(chart)
            
            # Chart 3: Distribution (numeric)
            if numeric_cols:
                chart = self._create_histogram(df, numeric_cols[0])
                if chart:
                    charts.append(chart)
            
            # Chart 4: Category breakdown (pie)
            if categorical_cols:
                cat_col = categorical_cols[0]
                if df[cat_col].nunique() <= 10:
                    chart = self._create_pie_chart(df, cat_col)
                    if chart:
                        charts.append(chart)
            
            # Chart 5: Correlation scatter (if 2+ numeric)
            if len(numeric_cols) >= 2:
                chart = self._create_scatter_chart(df, numeric_cols[0], numeric_cols[1])
                if chart:
                    charts.append(chart)
            
            # Chart 6: Top N values
            if categorical_cols and numeric_cols:
                cat_col = categorical_cols[0]
                num_col = numeric_cols[0]
                if df[cat_col].nunique() > 5:
                    chart = self._create_top_n_chart(df, cat_col, num_col)
                    if chart:
                        charts.append(chart)
            
            # Chart 7: Multi-series area (if 3+ numeric)
            if len(numeric_cols) >= 3 and datetime_cols:
                chart = self._create_area_chart(df, datetime_cols[0], numeric_cols[:2])
                if chart:
                    charts.append(chart)
            
            # Chart 8: Summary statistics card
            if numeric_cols:
                chart = self._create_summary_card(df, numeric_cols)
                if chart:
                    charts.append(chart)
            
            return charts[:max_charts]
        
        except Exception as e:
            print(f"⚠️ Dashboard generation error: {e}")
            return []
    
    def _create_time_series_chart(self, df: pd.DataFrame, dt_col: str, num_col: str) -> Dict:
        """Create time series line chart"""
        try:
            df_sorted = df.sort_values(dt_col)
            df_sorted[dt_col] = pd.to_datetime(df_sorted[dt_col])
            df_sorted['date_str'] = df_sorted[dt_col].astype(str).str[:10]
            
            grouped = df_sorted.groupby('date_str')[num_col].mean().reset_index()
            grouped.columns = ['date', num_col]
            
            return {
                'type': 'line',
                'title': f'{num_col} Over Time',
                'description': 'Trend analysis',
                'rationale': 'Visualize temporal trends in the data',
                'x_axis': 'date',
                'y_axis': num_col,
                'series': [num_col],
                'confidence': 0.9,
                'features': [dt_col, num_col],
                'data': grouped.head(100).to_dict('records')
            }
        except:
            return None
    
    def _create_bar_chart(self, df: pd.DataFrame, cat_col: str, num_col: str) -> Dict:
        """Create bar chart"""
        try:
            grouped = df.groupby(cat_col)[num_col].sum().reset_index()
            grouped = grouped.sort_values(num_col, ascending=False).head(20)
            grouped.columns = [cat_col, num_col]
            
            return {
                'type': 'bar',
                'title': f'{num_col} by {cat_col}',
                'description': 'Categorical comparison',
                'rationale': 'Compare values across categories',
                'x_axis': cat_col,
                'y_axis': num_col,
                'series': [num_col],
                'confidence': 0.85,
                'features': [cat_col, num_col],
                'data': grouped.to_dict('records')
            }
        except:
            return None
    
    def _create_histogram(self, df: pd.DataFrame, col: str) -> Dict:
        """Create histogram"""
        try:
            counts, bins = np.histogram(df[col].dropna(), bins=20)
            bin_labels = [f'{bins[i]:.1f}-{bins[i+1]:.1f}' for i in range(len(bins)-1)]
            
            histogram_data = [
                {col: label, 'frequency': int(count)}
                for label, count in zip(bin_labels, counts)
            ]
            
            return {
                'type': 'histogram',
                'title': f'{col} Distribution',
                'description': 'Frequency distribution',
                'rationale': 'Analyze distribution patterns',
                'x_axis': col,
                'y_axis': 'frequency',
                'series': ['frequency'],
                'confidence': 0.75,
                'features': [col],
                'data': histogram_data
            }
        except:
            return None
    
    def _create_pie_chart(self, df: pd.DataFrame, cat_col: str) -> Dict:
        """Create pie chart"""
        try:
            value_counts = df[cat_col].value_counts().reset_index()
            value_counts.columns = [cat_col, 'count']
            
            return {
                'type': 'pie',
                'title': f'{cat_col} Distribution',
                'description': 'Proportion breakdown',
                'rationale': 'Show distribution of categories',
                'x_axis': cat_col,
                'y_axis': 'count',
                'series': ['count'],
                'confidence': 0.7,
                'features': [cat_col],
                'data': value_counts.head(10).to_dict('records')
            }
        except:
            return None
    
    def _create_scatter_chart(self, df: pd.DataFrame, col1: str, col2: str) -> Dict:
        """Create scatter chart"""
        try:
            scatter_data = df[[col1, col2]].dropna().head(200).to_dict('records')
            
            return {
                'type': 'scatter',
                'title': f'{col1} vs {col2}',
                'description': 'Correlation analysis',
                'rationale': 'Detect relationships between variables',
                'x_axis': col1,
                'y_axis': col2,
                'series': [col2],
                'confidence': 0.8,
                'features': [col1, col2],
                'data': scatter_data
            }
        except:
            return None
    
    def _create_top_n_chart(self, df: pd.DataFrame, cat_col: str, num_col: str, n: int = 10) -> Dict:
        """Create top N values bar chart"""
        try:
            top_n = df.groupby(cat_col)[num_col].sum().reset_index()
            top_n = top_n.sort_values(num_col, ascending=False).head(n)
            top_n.columns = [cat_col, num_col]
            
            return {
                'type': 'bar',
                'title': f'Top {n} {cat_col}',
                'description': 'Top values ranking',
                'rationale': 'Identify highest values',
                'x_axis': cat_col,
                'y_axis': num_col,
                'series': [num_col],
                'confidence': 0.8,
                'features': [cat_col, num_col],
                'data': top_n.to_dict('records')
            }
        except:
            return None
    
    def _create_area_chart(self, df: pd.DataFrame, dt_col: str, num_cols: List[str]) -> Dict:
        """Create area chart"""
        try:
            df_sorted = df.sort_values(dt_col)
            df_sorted[dt_col] = pd.to_datetime(df_sorted[dt_col])
            df_sorted['date_str'] = df_sorted[dt_col].astype(str).str[:10]
            
            grouped = df_sorted.groupby('date_str')[num_cols].mean().reset_index()
            grouped.columns = ['date'] + num_cols
            
            return {
                'type': 'area',
                'title': f'Multi-Metric Trends',
                'description': 'Multiple metrics over time',
                'rationale': 'Compare trends across metrics',
                'x_axis': 'date',
                'y_axis': num_cols[0],
                'series': num_cols,
                'confidence': 0.75,
                'features': [dt_col] + num_cols,
                'data': grouped.head(100).to_dict('records')
            }
        except:
            return None
    
    def _create_summary_card(self, df: pd.DataFrame, numeric_cols: List[str]) -> Dict:
        """Create summary statistics"""
        try:
            stats = {}
            for col in numeric_cols[:3]:
                stats[f'{col}_mean'] = float(df[col].mean())
                stats[f'{col}_median'] = float(df[col].median())
                stats[f'{col}_std'] = float(df[col].std())
            
            # For now, return as a bar chart of means
            means = [
                {
                    'metric': col,
                    'value': float(df[col].mean())
                }
                for col in numeric_cols[:5]
            ]
            
            return {
                'type': 'bar',
                'title': 'Summary Statistics',
                'description': 'Average values by metric',
                'rationale': 'Quick overview of key metrics',
                'x_axis': 'metric',
                'y_axis': 'value',
                'series': ['value'],
                'confidence': 0.85,
                'features': numeric_cols[:5],
                'data': means
            }
        except:
            return None
