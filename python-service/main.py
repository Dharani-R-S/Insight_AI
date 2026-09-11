"""
AI Business Intelligence Platform — Python Microservice
FastAPI application that handles CSV processing, NL→SQL (via Groq),
query execution, chart generation, statistics, and predictions.
"""
import os
import re
import shutil
import pandas as pd
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
env_file = Path(__file__).resolve().parent / ".env"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)
else:
    load_dotenv()

# Import services
from services.database import csv_to_sqlite, load_file_to_sqlite, export_dataset_from_sqlite, execute_query, validate_sql
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
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


# ─── Request Models ───
class AnalyzeRequest(BaseModel):
    question: str
    db_path: str
    schema: dict
    sample_rows: list


class RecommendVisualizationsRequest(BaseModel):
    columns: list = None  # Frontend format: list of column names
    schema: dict = None  # Frontend format: schema info
    sample_rows: list = None  # Frontend format: sample data rows
    db_path: str = None  # Legacy format: database path
    query: str = "SELECT * FROM data"  # Legacy format: optional SQL query


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


class CleanDataRequest(BaseModel):
    db_path: str
    impute_numeric: str = "mean"  # "mean", "median", "mode", "zero", "none"
    fill_text: str = "N/A"
    drop_duplicates: bool = True
    drop_empty_cols: bool = True


class ExportDataRequest(BaseModel):
    db_path: str
    format: str = "csv"  # "csv", "xlsx", "json"
    filename: str = "transformed_dataset"


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


ALLOWED_EXTENSIONS = {'.csv', '.tsv', '.tab', '.txt', '.xlsx', '.xls', '.xlsm', '.xlsb', '.json', '.jsonl', '.parquet'}

# ─── POST /upload ───
@app.post("/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """
    Upload a dataset file (CSV, Excel, JSON, TSV, Parquet) and convert it to SQLite.
    Returns schema info and sample rows.
    """
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Supported: CSV, Excel (.xlsx, .xls), JSON, TSV, Parquet."
        )

    try:
        safe_filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', file.filename)
        file_path = UPLOAD_DIR / f"{int(pd.Timestamp.now().timestamp())}_{safe_filename}"
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        print(f"📂 Dataset saved: {file_path} ({len(content) / 1024:.1f} KB, format: {ext})")

        # Convert dataset to SQLite
        result = load_file_to_sqlite(str(file_path))
        print(f"✅ SQLite created: {result['row_count']} rows, {len(result['columns'])} columns")

        return result

    except Exception as e:
        print(f"❌ Upload processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Upload processing failed: {str(e)}")


# ─── POST /export-data ───
@app.post("/export-data")
async def export_data(request: ExportDataRequest):
    """
    Export SQLite table 'data' to CSV, Excel (.xlsx), or JSON.
    """
    try:
        filename, media_type, file_bytes = export_dataset_from_sqlite(
            request.db_path,
            export_format=request.format,
            base_filename=request.filename or "transformed_dataset"
        )
        return Response(
            content=file_bytes,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Dataset database file not found")
    except Exception as e:
        print(f"❌ Export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


# ─── POST /analyze ───
@app.post("/analyze")
async def analyze_data(request: AnalyzeRequest):
    """
    Full analysis pipeline:
    1. Convert question to SQL via Groq
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

    result = {
        "sql_query": "",
        "table_result": [],
        "chart_base64": "",
        "stats": {},
        "insights": [],
        "prediction": {},
    }

    try:
        # Step 1: NL → SQL via Groq
        print(f"🧠 Converting to SQL: \"{question}\"")
        sql_query = nl_to_sql(question, schema, sample_rows)
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
            analyzer = FeatureAnalyzer()
            result = analyzer.analyze_dataset(df, max_recommendations=5)
            
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
        analyzer = FeatureAnalyzer()
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


# ─── Settings Endpoints ───
class SettingsUpdateRequest(BaseModel):
    provider: str = "groq"
    model: str = "openai/gpt-oss-120b"
    api_key: str = None


@app.get("/settings")
async def get_settings():
    api_key = os.getenv("GROQ_API_KEY", "")
    current_model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    available_models = [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b",
        "qwen/qwen3.6-27b",
        "groq/compound",
        "groq/compound-mini",
    ]

    if api_key and api_key != "your-groq-api-key-here":
        try:
            from groq import Groq
            g_client = Groq(api_key=api_key)
            models_list = g_client.models.list()
            chat_models = [m.id for m in models_list.data if not m.id.startswith("whisper")]
            if chat_models:
                available_models = chat_models
        except Exception:
            pass

    return {
        "provider": "groq",
        "model": current_model,
        "has_key": bool(api_key and api_key != "your-groq-api-key-here"),
        "masked_key": f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else ("Configured" if api_key else ""),
        "available_models": available_models,
    }


@app.post("/settings")
async def update_settings(req: SettingsUpdateRequest):
    if req.model:
        os.environ["GROQ_MODEL"] = req.model.strip()
    if req.api_key and req.api_key.strip():
        os.environ["GROQ_API_KEY"] = req.api_key.strip()
        try:
            import services.llm as llm_svc
            llm_svc.client = None
            import services.auto_visualize as auto_vis_svc
            auto_vis_svc._groq_client = None
            import services.recommendations as rec_svc
            rec_svc.client = None
        except Exception:
            pass

    # Persist to python-service/.env
    try:
        env_file = Path(__file__).resolve().parent / ".env"
        current_content = env_file.read_text(encoding="utf-8") if env_file.exists() else ""
        lines = [l for l in current_content.splitlines() if not l.startswith("GROQ_API_KEY=") and not l.startswith("GROQ_MODEL=")]
        key_val = os.getenv("GROQ_API_KEY", "")
        model_val = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
        lines.append(f"GROQ_API_KEY={key_val}")
        lines.append(f"GROQ_MODEL={model_val}")
        env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except Exception as e:
        print(f"⚠️ Could not save to .env: {e}")

    return await get_settings()


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
        "model": os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
