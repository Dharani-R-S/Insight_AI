"""
AI Business Intelligence Platform — Python Microservice
FastAPI application that handles CSV processing, NL→SQL (via Groq),
query execution, chart generation, statistics, and predictions.
"""
import sys
import io
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import os
import re
import shutil
import pandas as pd
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import services
from services.database import csv_to_sqlite, execute_query, validate_sql
from services.llm import nl_to_sql
from services.charts import generate_chart
from services.analysis import compute_stats, generate_insights
from services.prediction import predict
from services.recommendations import recommend_visualizations
from services.recharts_generator import generate_recharts_data, generate_multiple_charts
from services.auto_visualize import auto_visualize
from services.chart_generator import generate_multiple_chart_data
from services.feature_analyzer import FeatureAnalyzer
from services.transform_service import execute_join, apply_transformation_step

# ─── FastAPI App ───
app = FastAPI(
    title="InsightAI - BI Analysis Service",
    description="AI-powered data analysis microservice",
    version="1.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure uploads directory
UPLOAD_DIR = Path(os.environ.get("APP_DATA_DIR", Path(__file__).parent)) / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ─── Request Models ───
class LLMTestRequest(BaseModel):
    provider: str = "groq"
    api_key: str = ""
    model: str = ""
    base_url: str = ""


class AnalyzeRequest(BaseModel):
    question: str
    db_path: str
    schema: dict
    sample_rows: list
    llm_config: dict = None


class RecommendVisualizationsRequest(BaseModel):
    columns: list = None  # Frontend format: list of column names
    schema: dict = None  # Frontend format: schema info
    sample_rows: list = None  # Frontend format: sample data rows
    db_path: str = None  # Legacy format: database path
    query: str = "SELECT * FROM data"  # Legacy format: optional SQL query
    llm_config: dict = None


class GenerateChartsRequest(BaseModel):
    recommendations: list  # List of recommendation objects with type, columns, etc.
    sample_rows: list  # Dataset sample rows
    db_path: str = None  # Optional: full database path if available
    query: str = "SELECT * FROM data"  # Optional: SQL query to fetch full dataset


class AutoDashboardRequest(BaseModel):
    columns: list = None
    schema: dict = None
    sample_rows: list = None
    db_path: str = None
    query: str = "SELECT * FROM data"
    llm_config: dict = None


class CleanDataRequest(BaseModel):
    db_path: str
    impute_numeric: str = "mean"  # "mean", "median", "mode", "zero", "none"
    fill_text: str = "N/A"
    drop_duplicates: bool = True
    drop_empty_cols: bool = True


# ─── POST /clean-data ───
@app.post("/clean-data")
async def clean_data(request: CleanDataRequest):
    """
    Data Cleaning & Preprocessing Suite:
    - Fills numeric missing values (mean, median, mode, or zero)
    - Replaces missing text entries with fill_text ("N/A")
    - Removes exact duplicate rows
    - Drops completely empty columns
    - Re-writes clean table into SQLite database
    """
    db_path = request.db_path
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Database file not found")

    import sqlite3
    try:
        conn = sqlite3.connect(db_path)
        df = pd.read_sql("SELECT * FROM data", conn)
        initial_rows = len(df)
        initial_cols = len(df.columns)

        # 1. Drop completely empty columns
        if request.drop_empty_cols:
            df = df.dropna(how="all", axis=1)

        # 2. Remove duplicate rows
        if request.drop_duplicates:
            df = df.drop_duplicates()

        # 3. Numeric imputation
        numeric_cols = df.select_dtypes(include=['number']).columns
        for col in numeric_cols:
            if df[col].isnull().any():
                if request.impute_numeric == "mean":
                    val = df[col].mean()
                elif request.impute_numeric == "median":
                    val = df[col].median()
                elif request.impute_numeric == "zero":
                    val = 0
                elif request.impute_numeric == "mode":
                    mode_vals = df[col].mode()
                    val = mode_vals.iloc[0] if not mode_vals.empty else 0
                else:
                    val = None

                if val is not None:
                    df[col] = df[col].fillna(val)

        # 4. Text / Categorical filling
        text_cols = df.select_dtypes(include=['object']).columns
        for col in text_cols:
            if df[col].isnull().any():
                df[col] = df[col].fillna(request.fill_text)

        # Re-write cleaned dataframe to SQLite
        df.to_sql('data', conn, if_exists='replace', index=False)

        # Fetch updated schema and sample rows
        cursor = conn.execute("PRAGMA table_info(data)")
        columns_info = cursor.fetchall()
        schema = {col_info[1]: col_info[2] for col_info in columns_info}
        columns = list(schema.keys())

        sample_df = df.head(5)
        sample_rows = sample_df.to_dict(orient='records')
        row_count = len(df)
        conn.close()

        print(f"🧹 Cleaned dataset ({db_path}): {initial_rows} -> {row_count} rows, {initial_cols} -> {len(columns)} cols")

        return {
            "db_path": db_path,
            "table_name": "data",
            "columns": columns,
            "schema": schema,
            "sample_rows": sample_rows,
            "row_count": row_count,
            "cleaned_summary": {
                "rows_removed": initial_rows - row_count,
                "cols_removed": initial_cols - len(columns),
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data cleaning failed: {str(e)}")


# ─── POST /upload ───
@app.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    """
    Upload a CSV file and convert it to a SQLite database.
    Returns schema info and sample rows.
    """
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    try:
        # Save uploaded file
        file_path = UPLOAD_DIR / f"{int(pd.Timestamp.now().timestamp())}_{file.filename}"
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        print(f"📂 CSV saved: {file_path} ({len(content) / 1024:.1f} KB)")

        # Convert CSV to SQLite
        result = csv_to_sqlite(str(file_path))
        print(f"✅ SQLite created: {result['row_count']} rows, {len(result['columns'])} columns")

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload processing failed: {str(e)}")


# ─── POST /llm/test ───
@app.post("/llm/test")
async def test_llm_connection(request: LLMTestRequest):
    """
    Test user LLM API key and model connectivity.
    """
    try:
        from services.llm import call_llm
        test_response = call_llm(
            prompt="Reply with the exact word 'READY' to confirm the API connection works.",
            system_prompt="You are a system diagnostic tool. Answer with 'READY'.",
            llm_config={
                "provider": request.provider,
                "api_key": request.api_key,
                "model": request.model,
                "base_url": request.base_url,
            },
            max_tokens=20,
        )
        return {
            "status": "success",
            "message": "Connected successfully!",
            "provider": request.provider,
            "response": test_response,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── POST /analyze ───
@app.post("/analyze")
async def analyze_data(request: AnalyzeRequest):
    """
    Full analysis pipeline:
    1. Convert question to SQL via configured LLM provider
    2. Execute SQL query
    3. Generate chart
    4. Compute statistics
    5. Generate insights
    6. Predict (if asked)
    """
    question = request.question
    db_path = request.db_path
    schema = request.schema
    sample_rows = request.sample_rows
    llm_config = request.llm_config

    result = {
        "sql_query": "",
        "table_result": [],
        "chart_base64": "",
        "stats": {},
        "insights": [],
        "prediction": {},
    }

    try:
        # Step 1: NL → SQL via LLM
        print(f"🧠 Converting to SQL: \"{question}\" (Provider: {llm_config.get('provider') if llm_config else 'env/groq'})")
        sql_query = nl_to_sql(question, schema, sample_rows, llm_config=llm_config)
        result["sql_query"] = sql_query
        print(f"📝 SQL: {sql_query}")

        # Step 2: Validate and execute SQL
        if not validate_sql(sql_query):
            raise HTTPException(
                status_code=400,
                detail="Generated SQL contains unsafe operations. Only SELECT queries are allowed."
            )

        table_result = execute_query(db_path, sql_query)
        result["table_result"] = table_result
        print(f"📊 Query returned {len(table_result)} rows")

        # Convert to DataFrame for analysis
        if table_result:
            df = pd.DataFrame(table_result)

            # Step 3: Generate chart
            try:
                chart_b64 = generate_chart(df)
                result["chart_base64"] = chart_b64
                if chart_b64:
                    print("📈 Chart generated")
            except Exception as e:
                print(f"⚠️ Chart generation failed: {e}")

            # Step 4: Compute statistics
            try:
                stats = compute_stats(df)
                result["stats"] = stats
            except Exception as e:
                print(f"⚠️ Stats computation failed: {e}")

            # Step 5: Generate insights
            try:
                insights = generate_insights(df, result["stats"])
                result["insights"] = insights
            except Exception as e:
                print(f"⚠️ Insights generation failed: {e}")

        # Step 6: Prediction (if question mentions prediction)
        prediction_keywords = ['predict', 'forecast', 'next month', 'next quarter', 'next year', 'future', 'estimate']
        if any(kw in question.lower() for kw in prediction_keywords):
            try:
                # Load full dataset for prediction
                full_df = pd.read_sql("SELECT * FROM data", __import__('sqlite3').connect(db_path))
                pred = predict(full_df, question)
                result["prediction"] = pred
                if pred.get("predicted_value"):
                    result["insights"].append(pred["message"])
                    print(f"🔮 Prediction: {pred['predicted_value']}")
            except Exception as e:
                result["prediction"] = {"error": str(e)}
                print(f"⚠️ Prediction failed: {e}")

        return result

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


# ─── POST /recommend-visualizations ───
@app.post("/recommend-visualizations")
async def recommend_visualizations_endpoint(request: RecommendVisualizationsRequest):
    """
    HYBRID auto-visualization: rules + LLM for intelligent recommendations.
    """
    try:
        # Use frontend format (columns, sample_rows)
        if request.columns and request.sample_rows:
            print(f"\n📊 Using HYBRID auto-visualization engine...")
            print(f"   Columns: {len(request.columns)}")
            print(f"   Rows: {len(request.sample_rows)}")
            
            # Convert to DataFrame
            df = pd.DataFrame(request.sample_rows)
            
            # Use new hybrid analyzer (rules + LLM)
            analyzer = FeatureAnalyzer(llm_config=request.llm_config)
            result = analyzer.analyze_dataset(df, max_recommendations=5, llm_config=request.llm_config)
            
            return {
                "recommendations": result.get("recommendations", []),
                "summary": result.get("summary", {}),
                "status": "success"
            }
        
        else:
            raise ValueError("Columns and sample_rows required for auto-visualization")
    
    except Exception as e:
        print(f"❌ Recommendation error: {str(e)}")
        return {
            "recommendations": [],
            "error": str(e),
            "status": "error"
        }


# ─── POST /analyze/generate-charts ───
@app.post("/analyze/generate-charts")
async def generate_charts(request: GenerateChartsRequest):
    """
    Generate Recharts-compatible chart data for visualization recommendations.
    """
    try:
        print(f"\n📊 Generating chart data for {len(request.recommendations)} recommendations...")
        
        # Get the dataset
        df = None
        if request.db_path:
            # Load from database
            import sqlite3
            conn = sqlite3.connect(request.db_path)
            cursor = conn.cursor()
            cursor.execute(request.query or "SELECT * FROM data")
            cols = [description[0] for description in cursor.description]
            rows = cursor.fetchall()
            conn.close()
            df = pd.DataFrame(rows, columns=cols)
            print(f"   Loaded from DB: {len(df)} rows, {len(df.columns)} columns")
        
        elif request.sample_rows:
            # Use sample rows
            df = pd.DataFrame(request.sample_rows)
            print(f"   Using sample data: {len(df)} rows, {len(df.columns)} columns")
        
        else:
            return {
                "charts": {},
                "error": "No dataset provided"
            }
        
        # Generate chart data for each recommendation
        chart_data_map = generate_multiple_chart_data(df, request.recommendations)
        
        print(f"   ✅ Generated {len(chart_data_map)} charts")
        
        return {
            "charts": chart_data_map,
            "summary": {
                "total": len(chart_data_map),
                "success": sum(1 for c in chart_data_map.values() if "error" not in c)
            }
        }
    
    except Exception as e:
        print(f"❌ Chart generation error: {str(e)}")
        return {
            "charts": {},
            "error": str(e)
        }


# ─── POST /analyze/auto-dashboard ───
@app.post("/analyze/auto-dashboard")
async def auto_dashboard(request: AutoDashboardRequest):
    """
    Generate a complete dashboard with multiple related visualizations.
    AI analyzes data and creates 6-8 charts showing different aspects.
    """
    try:
        print(f"\n🎨 Auto-dashboard generation...")
        
        # Get the dataset
        df = None
        if request.db_path:
            import sqlite3
            conn = sqlite3.connect(request.db_path)
            cursor = conn.cursor()
            cursor.execute(request.query or "SELECT * FROM data")
            cols = [description[0] for description in cursor.description]
            rows = cursor.fetchall()
            conn.close()
            df = pd.DataFrame(rows, columns=cols)
            print(f"   Loaded from DB: {len(df)} rows, {len(df.columns)} columns")
        
        elif request.sample_rows:
            df = pd.DataFrame(request.sample_rows)
            print(f"   Using sample data: {len(df)} rows, {len(df.columns)} columns")
        
        else:
            return {
                "charts": [],
                "error": "No dataset provided"
            }
        
        # Use FeatureAnalyzer to generate intelligent dashboard
        analyzer = FeatureAnalyzer(llm_config=request.llm_config)
        charts = analyzer.generate_dashboard(df)
        
        print(f"   ✅ Generated {len(charts)} dashboard charts")
        
        return {
            "charts": charts,
            "summary": {
                "total": len(charts),
                "dataset_info": {
                    "rows": len(df),
                    "columns": len(df.columns),
                }
            }
        }
    
    except Exception as e:
        print(f"❌ Dashboard generation error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "charts": [],
            "error": str(e)
        }


# ─── Transformation Endpoints ───
class JoinRequest(BaseModel):
    dataset1_rows: list
    dataset2_rows: list
    join_type: str = "inner"
    key1: str
    key2: str

class TransformRequest(BaseModel):
    table_rows: list
    action: str
    params: dict

@app.post("/api/transform/join")
async def api_transform_join(request: JoinRequest):
    try:
        df1 = pd.DataFrame(request.dataset1_rows)
        df2 = pd.DataFrame(request.dataset2_rows)
        merged_df = execute_join(df1, df2, request.join_type, request.key1, request.key2)
        records = merged_df.to_dict(orient="records")
        cols = list(merged_df.columns)
        return {"columns": cols, "rows": records, "row_count": len(records)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/transform/apply")
async def api_transform_apply(request: TransformRequest):
    try:
        df = pd.DataFrame(request.table_rows)
        result_df = apply_transformation_step(df, request.action, request.params)
        records = result_df.to_dict(orient="records")
        cols = list(result_df.columns)
        return {"columns": cols, "rows": records, "row_count": len(records)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ─── Health Check ───
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "InsightAI Python Service",
        "groq_configured": bool(os.getenv("GROQ_API_KEY") and os.getenv("GROQ_API_KEY") != "your-groq-api-key-here"),
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PYTHON_PORT", os.environ.get("PORT", 8000)))
    if getattr(sys, "frozen", False):
        import multiprocessing
        multiprocessing.freeze_support()
        uvicorn.run(app, host="127.0.0.1", port=port)
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
