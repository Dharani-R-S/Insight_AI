"""
Robust Auto-Visualization Engine with intelligent feature selection and strict validation.
- Uses hybrid approach: rules-based filtering + Groq LLM recommendations
- Strict validation of LLM output against actual dataset
- Fallback visualization system if LLM fails
"""
import os
import json
import pandas as pd
import numpy as np
from groq import Groq
from typing import Dict, List, Any, Tuple


# Initialize Groq client
_groq_client = None


def get_groq_client():
    global _groq_client
    if _groq_client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key or api_key == "your-groq-api-key-here":
            raise ValueError("GROQ_API_KEY not configured")
        _groq_client = Groq(api_key=api_key)
    return _groq_client


def select_important_features(df: pd.DataFrame) -> Dict[str, List[str]]:
    """
    RULE 1: Select IMPORTANT features instead of sending all columns.
    Identify high-variance numeric and high-cardinality categorical columns.
    
    Returns:
        {
            "numeric_important": [...],  # Numeric columns with variance > 0
            "categorical_important": [...],  # Categorical with 2-20 unique values
            "all_numeric": [...],
            "all_categorical": [...]
        }
    """
    important = {
        "numeric_important": [],
        "categorical_important": [],
        "all_numeric": [],
        "all_categorical": []
    }
    
    for col in df.columns:
        dtype = df[col].dtype
        
        if pd.api.types.is_numeric_dtype(dtype):
            important["all_numeric"].append(col)
            # Select numeric columns with reasonable variance
            series = pd.to_numeric(df[col], errors='coerce').dropna()
            if len(series) > 0:
                variance = series.var()
                if variance > 0 and not np.isinf(variance):  # Non-zero variance
                    important["numeric_important"].append(col)
        else:
            important["all_categorical"].append(col)
            # Select categorical columns with 2-20 unique values (good for grouping)
            unique_count = df[col].nunique()
            if 2 <= unique_count <= 20:
                important["categorical_important"].append(col)
    
    return important


def create_minimal_feature_description(df: pd.DataFrame, important_features: Dict) -> str:
    """
    RULE 2: Send MINIMAL info to LLM (only important features, not full data).
    Avoid overwhelming the LLM with unnecessary columns.
    """
    numeric_cols = important_features["numeric_important"][:5]  # Limit to 5
    categorical_cols = important_features["categorical_important"][:5]  # Limit to 5
    
    description = {
        "dataset": {
            "total_rows": len(df),
            "total_columns": len(df.columns),
            "important_numeric_columns": numeric_cols,
            "important_categorical_columns": categorical_cols,
            "numeric_stats": {},
            "categorical_samples": {}
        }
    }
    
    # Add stats only for important numeric columns
    for col in numeric_cols:
        series = pd.to_numeric(df[col], errors='coerce').dropna()
        if len(series) > 0:
            description["dataset"]["numeric_stats"][col] = {
                "mean": float(np.round(series.mean(), 2)),
                "min": float(np.round(series.min(), 2)),
                "max": float(np.round(series.max(), 2)),
                "unique_count": int(series.nunique())
            }
    
    # Add samples for categorical columns
    for col in categorical_cols:
        description["dataset"]["categorical_samples"][col] = df[col].dropna().unique()[:5].tolist()
    
    return json.dumps(description, indent=2)


def validate_recommendation(rec: Dict, important_features: Dict, df: pd.DataFrame) -> Tuple[bool, str]:
    """
    RULE 3: STRICT VALIDATION of LLM recommendations.
    Check if chart type matches data types and columns exist.
    
    Returns:
        (is_valid: bool, error_message: str)
    """
    chart_type = rec.get("type", "").lower()
    x_axis = rec.get("x_axis")
    y_axis = rec.get("y_axis")
    
    # Check if columns exist in dataset
    valid_columns = df.columns.tolist()
    
    if x_axis and x_axis not in valid_columns:
        return False, f"❌ Column '{x_axis}' not found in dataset"
    
    if y_axis and y_axis not in valid_columns:
        return False, f"❌ Column '{y_axis}' not found in dataset"
    
    # Validate chart type matches data types
    if chart_type in ["scatter", "line", "area"]:
        # These need 2 numeric columns
        if not x_axis or not y_axis:
            return False, f"❌ {chart_type.upper()} needs x_axis and y_axis defined"
        
        x_is_numeric = pd.api.types.is_numeric_dtype(df[x_axis])
        y_is_numeric = pd.api.types.is_numeric_dtype(df[y_axis])
        
        if not (x_is_numeric and y_is_numeric):
            return False, f"❌ {chart_type.upper()} needs numeric columns, got {type(df[x_axis].dtype).__name__} and {type(df[y_axis].dtype).__name__}"
    
    elif chart_type == "bar":
        # Bar chart: typically categorical x-axis, numeric y-axis
        if not x_axis or not y_axis:
            return False, f"❌ BAR chart needs x_axis and y_axis"
        # Allow flexibility - can have numeric x-axis too
    
    elif chart_type == "pie":
        # Pie chart: categorical for labels, numeric for values
        if not x_axis:
            return False, f"❌ PIE chart needs x_axis (labels)"
    
    elif chart_type == "histogram":
        # Histogram: single numeric column
        if not y_axis:
            return False, f"❌ HISTOGRAM needs y_axis (numeric column)"
        if not pd.api.types.is_numeric_dtype(df[y_axis]):
            return False, f"❌ HISTOGRAM needs numeric column, got {type(df[y_axis].dtype).__name__}"
    
    return True, "✅ Valid"


def get_llm_recommendations(important_features: Dict, feature_description: str) -> List[Dict]:
    """
    RULE 4: Ask LLM for recommendations with strict format requirements and constraints.
    """
    numeric_cols = important_features["numeric_important"]
    categorical_cols = important_features["categorical_important"]
    
    constraints = f"""
STRICT CONSTRAINTS:
1. Recommend ONLY from these columns: {numeric_cols} + {categorical_cols}
2. For SCATTER/LINE: x_axis and y_axis must be from NUMERIC columns
3. For BAR: x_axis from CATEGORICAL, y_axis from NUMERIC
4. For PIE: x_axis from CATEGORICAL (max 10 unique), no y_axis needed
5. For HISTOGRAM: y_axis must be NUMERIC, no x_axis
6. Return EXACTLY 3-5 recommendations, no more
7. Each must have type, x_axis, y_axis (or null), title, rationale
"""
    
    prompt = f"""You are a data visualization expert. Recommend the BEST visualizations for this dataset.

DATASET STRUCTURE:
{feature_description}

{constraints}

Return ONLY valid JSON (no markdown, no backticks):
{{
  "recommendations": [
    {{
      "type": "bar|line|scatter|pie|histogram",
      "x_axis": "column_name or null",
      "y_axis": "column_name or null", 
      "title": "what does this show",
      "rationale": "why is this useful"
    }}
  ]
}}"""
    
    try:
        client = get_groq_client()
        model_name = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {
                        "role": "system",
                        "content": "Output ONLY valid JSON. No explanation, no markdown."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=800,
            )
        except Exception as model_err:
            fallback = "openai/gpt-oss-120b"
            if model_name != fallback and ("model_not_found" in str(model_err) or "does not exist" in str(model_err)):
                response = client.chat.completions.create(
                    model=fallback,
                    messages=[
                        {
                            "role": "system",
                            "content": "Output ONLY valid JSON. No explanation, no markdown."
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    temperature=0.3,
                    max_tokens=800,
                )
            else:
                raise
        
        response_text = response.choices[0].message.content.strip()
        # Remove markdown if present
        response_text = response_text.replace("```json", "").replace("```", "").strip()
        
        result = json.loads(response_text)
        return result.get("recommendations", [])
    
    except Exception as e:
        print(f"⚠️ LLM error: {str(e)}")
        return []


def generate_fallback_visualizations(important_features: Dict, df: pd.DataFrame) -> List[Dict]:
    """
    RULE 5: If LLM fails, use RULE-BASED fallbacks.
    """
    fallbacks = []
    
    numeric_cols = important_features["numeric_important"]
    categorical_cols = important_features["categorical_important"]
    
    # Fallback 1: Distribution of first numeric column (histogram)
    if numeric_cols:
        fallbacks.append({
            "type": "histogram",
            "x_axis": None,
            "y_axis": numeric_cols[0],
            "title": f"Distribution of {numeric_cols[0]}",
            "rationale": "Shows distribution of key metric",
            "confidence": 0.7
        })
    
    # Fallback 2: Numeric vs Numeric (scatter if 2+ exist)
    if len(numeric_cols) >= 2:
        fallbacks.append({
            "type": "scatter",
            "x_axis": numeric_cols[0],
            "y_axis": numeric_cols[1],
            "title": f"{numeric_cols[0]} vs {numeric_cols[1]}",
            "rationale": "Correlation between key metrics",
            "confidence": 0.7
        })
    
    # Fallback 3: Categorical breakdown (bar)
    if categorical_cols and numeric_cols:
        fallbacks.append({
            "type": "bar",
            "x_axis": categorical_cols[0],
            "y_axis": numeric_cols[0],
            "title": f"{numeric_cols[0]} by {categorical_cols[0]}",
            "rationale": "Breakdown by category",
            "confidence": 0.7
        })
    
    return fallbacks


def auto_visualize(df: pd.DataFrame) -> Dict[str, Any]:
    """
    MAIN ENTRY POINT: Full auto-visualization pipeline with strict validation.
    
    Process:
    1. Extract important features (rule-based)
    2. Create minimal feature description
    3. Get LLM recommendations
    4. Validate STRICTLY against dataset
    5. Return validated recommendations or fallbacks
    """
    print("=" * 60)
    print("🎨 AUTO-VISUALIZATION ENGINE")
    print("=" * 60)
    
    # Step 1: Select important features
    print("\n📌 STEP 1: Selecting important features...")
    important_features = select_important_features(df)
    print(f"   • Important numeric: {important_features['numeric_important']}")
    print(f"   • Important categorical: {important_features['categorical_important']}")
    
    # Step 2: Create minimal description
    print("\n📝 STEP 2: Creating minimal feature description...")
    feature_description = create_minimal_feature_description(df, important_features)
    print(f"   • Sending {len(important_features['numeric_important']) + len(important_features['categorical_important'])} important columns to LLM")
    
    # Step 3: Get LLM recommendations
    print("\n🧠 STEP 3: Getting LLM recommendations...")
    llm_recs = get_llm_recommendations(important_features, feature_description)
    print(f"   • Received {len(llm_recs)} recommendations from LLM")
    
    # Step 4: Validate recommendations strictly
    print("\n✅ STEP 4: Validating recommendations...")
    validated_recs = []
    for idx, rec in enumerate(llm_recs):
        is_valid, msg = validate_recommendation(rec, important_features, df)
        if is_valid:
            rec["id"] = f"rec-{idx}"
            rec["confidence"] = rec.get("confidence", 0.8 - idx * 0.1)
            validated_recs.append(rec)
            print(f"   ✓ Recommendation {idx+1}: {rec.get('type', 'unknown').upper()} - {msg}")
        else:
            print(f"   ✗ Recommendation {idx+1}: REJECTED - {msg}")
    
    # Step 5: Use fallbacks if needed
    if len(validated_recs) < 2:
        print("\n📋 STEP 5: Using fallback visualizations...")
        fallback_recs = generate_fallback_visualizations(important_features, df)
        validated_recs.extend(fallback_recs)
        print(f"   • Added {len(fallback_recs)} fallback recommendations")
    
    print("\n" + "=" * 60)
    print(f"✨ FINAL: {len(validated_recs)} validated recommendations")
    print("=" * 60)
    
    return {
        "recommendations": validated_recs[:5],  # Max 5
        "important_features": important_features
    }
