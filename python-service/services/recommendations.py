"""
Visualization recommendation service — Uses Groq LLM to recommend visualizations
based on dataset features, column types, and statistical analysis.
"""
import os
import json
import pandas as pd
import numpy as np
from groq import Groq


# Initialize Groq client
client = None


def get_client():
    global client
    if client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key or api_key == "your-groq-api-key-here":
            raise ValueError(
                "GROQ_API_KEY is not set. Please add your Groq API key to python-service/.env"
            )
        client = Groq(api_key=api_key)
    return client


def analyze_dataset_features(df: pd.DataFrame) -> dict:
    """
    Analyze dataset to extract features for visualization recommendation.
    
    Args:
        df: pandas DataFrame to analyze
    
    Returns:
        Dictionary containing:
        - column_names: list of column names
        - data_types: dict mapping column name to type
        - numeric_columns: list of numeric columns
        - categorical_columns: list of categorical columns
        - statistics: stats for numeric columns
        - sample_values: sample values from each column
        - relationships: potential relationships detected
    """
    features = {
        "column_names": df.columns.tolist(),
        "data_types": {},
        "numeric_columns": [],
        "categorical_columns": [],
        "statistics": {},
        "sample_values": {},
        "relationships": [],
        "row_count": len(df),
        "column_count": len(df.columns),
    }
    
    # Analyze each column
    for col in df.columns:
        dtype = df[col].dtype
        
        # Classify as numeric or categorical
        if pd.api.types.is_numeric_dtype(dtype):
            features["numeric_columns"].append(col)
            features["data_types"][col] = "numeric"
            
            # Compute statistics
            series = df[col].dropna()
            if len(series) > 0:
                features["statistics"][col] = {
                    "mean": float(np.round(series.mean(), 2)),
                    "median": float(np.round(series.median(), 2)),
                    "std": float(np.round(series.std(), 2)) if len(series) > 1 else 0,
                    "min": float(np.round(series.min(), 2)),
                    "max": float(np.round(series.max(), 2)),
                    "q25": float(np.round(series.quantile(0.25), 2)),
                    "q75": float(np.round(series.quantile(0.75), 2)),
                    "unique_count": int(series.nunique()),
                }
            
            # Sample values
            features["sample_values"][col] = df[col].dropna().head(5).tolist()
            
        else:
            features["categorical_columns"].append(col)
            features["data_types"][col] = "categorical"
            
            # Sample values
            features["sample_values"][col] = df[col].dropna().unique().tolist()[:5]
    
    # Detect potential relationships
    numeric_cols = features["numeric_columns"]
    if len(numeric_cols) >= 2:
        # Check for correlations
        numeric_df = df[numeric_cols].dropna()
        if len(numeric_df) > 1:
            corr_matrix = numeric_df.corr()
            for i, col1 in enumerate(numeric_cols):
                for j, col2 in enumerate(numeric_cols):
                    if i < j:
                        corr = corr_matrix.iloc[i, j]
                        if abs(corr) > 0.5:
                            features["relationships"].append({
                                "column1": col1,
                                "column2": col2,
                                "correlation": float(np.round(corr, 2)),
                                "type": "correlation"
                            })
    
    # Detect time series (check for datetime-like columns)
    for col in df.columns:
        if 'date' in col.lower() or 'time' in col.lower():
            features["relationships"].append({
                "column": col,
                "type": "time_series",
                "description": "Time-based column detected"
            })
            break
    
    return features


def generate_recommendations(features: dict) -> dict:
    """
    Use Groq LLM to generate visualization recommendations based on dataset features.
    
    Args:
        features: Dictionary from analyze_dataset_features()
    
    Returns:
        Dictionary with recommendations in specified format
    """
    
    # Prepare feature description for LLM
    feature_description = json.dumps(features, indent=2)
    
    prompt = f"""You are an expert data visualization specialist. Based on the following dataset features, 
provide visualization recommendations that would be most effective for analyzing this data.

DATASET FEATURES:
{feature_description}

Your recommendations should be practical and help users understand the data effectively.

Return ONLY a valid JSON object (no markdown, no backticks) with this exact structure:
{{
  "recommendations": [
    {{
      "type": "bar|line|scatter|pie|area|histogram|heatmap|box",
      "x_axis": "feature_name or null",
      "y_axis": "feature_name or null",
      "title": "descriptive title for the visualization",
      "rationale": "brief explanation of why this visualization is suitable",
      "features": ["column1", "column2"]
    }}
  ]
}}

IMPORTANT GUIDELINES:
1. Recommend 3-5 visualizations that best show different aspects of the data
2. For numeric distributions → use histogram or box
3. For categorical comparisons → use bar chart
4. For trends over time → use line chart
5. For relationships between two numeric variables → use scatter
6. For categorical proportions → use pie chart
7. For time series data → prioritize line charts
8. For multiple numeric columns with categories → consider area charts
9. Include correlation information in rationale if relationships detected
10. Ensure x_axis and y_axis are actual column names from the dataset (or null if not applicable)
11. Include 2-3 relevant features for each recommendation in the "features" field

Generate the JSON response now:"""
    
    try:
        groq_client = get_client()
        model_name = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
        try:
            response = groq_client.chat.completions.create(
                model=model_name,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a data visualization expert. Output ONLY a valid JSON object "
                            "with visualization recommendations. No explanation, no markdown, no backticks."
                        )
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=1200,
            )
        except Exception as model_err:
            fallback = "openai/gpt-oss-120b"
            if model_name != fallback and ("model_not_found" in str(model_err) or "does not exist" in str(model_err)):
                response = groq_client.chat.completions.create(
                    model=fallback,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a data visualization expert. Output ONLY a valid JSON object with visualization recommendations. No explanation, no markdown, no backticks."
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    temperature=0.3,
                    max_tokens=1200,
                )
            else:
                raise
        
        response_text = response.choices[0].message.content.strip()
        
        # Remove markdown code blocks if present
        import re
        response_text = re.sub(r'^```\w*\n?', '', response_text)
        response_text = re.sub(r'\n?```$', '', response_text)
        response_text = response_text.strip()
        
        # Parse JSON
        try:
            result = json.loads(response_text)
            
            # Validate recommendations structure and add frontend-required fields
            if "recommendations" in result and isinstance(result["recommendations"], list):
                # Validate each recommendation
                for idx, rec in enumerate(result["recommendations"]):
                    if not isinstance(rec, dict):
                        continue
                    # Ensure required fields exist
                    if "type" not in rec:
                        rec["type"] = "bar"
                    if "title" not in rec:
                        rec["title"] = "Visualization"
                    if "rationale" not in rec:
                        rec["rationale"] = "Recommended for data analysis"
                    # Add frontend-required fields
                    if "id" not in rec:
                        rec["id"] = f"rec-{idx}"
                    if "confidence" not in rec:
                        rec["confidence"] = 0.75 + (0.1 * (4 - idx)) / 5  # Descending confidence
                    if "features" not in rec:
                        # Try to extract from x_axis and y_axis
                        features_list = []
                        if rec.get("x_axis"):
                            features_list.append(rec["x_axis"])
                        if rec.get("y_axis"):
                            features_list.append(rec["y_axis"])
                        if not features_list:
                            features_list = features.get("column_names", [])[:2]
                        rec["features"] = features_list
                
                return result
            else:
                return {
                    "recommendations": [],
                    "error": "Invalid response format from LLM"
                }
        
        except json.JSONDecodeError as e:
            return {
                "recommendations": [],
                "error": f"Failed to parse LLM response: {str(e)}",
                "raw_response": response_text[:200]  # First 200 chars for debugging
            }
    
    except Exception as e:
        return {
            "recommendations": [],
            "error": f"Groq API error: {str(e)}"
        }


def recommend_visualizations(df: pd.DataFrame) -> dict:
    """
    Main entry point: analyze dataset and generate visualization recommendations.
    
    Args:
        df: pandas DataFrame to analyze
    
    Returns:
        Dictionary with recommendations in specified format
    """
    try:
        # Analyze features
        features = analyze_dataset_features(df)
        
        # Generate recommendations using LLM
        recommendations = generate_recommendations(features)
        
        # Add feature analysis to response
        recommendations["features_analyzed"] = {
            "row_count": features["row_count"],
            "column_count": features["column_count"],
            "numeric_columns": features["numeric_columns"],
            "categorical_columns": features["categorical_columns"],
        }
        
        return recommendations
    
    except Exception as e:
        return {
            "recommendations": [],
            "error": f"Recommendation generation failed: {str(e)}"
        }
