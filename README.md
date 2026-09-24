# InsightAI — Intelligent Business Intelligence & Analytics Platform

InsightAI is an enterprise-grade, conversational business intelligence and data transformation platform. It enables teams to upload diverse datasets, perform multi-step data transformations (joins, formulas, aggregations, cleaning), query in natural language using Groq-powered LLMs, and generate executive dashboards, interactive charts, and predictive analytics — wrapped in a modern design system.

---

## Key Capabilities

- **Modern Senior-Grade UI / UX**:
  - Clean, distraction-free aesthetic with refined typography (Inter / Geist), curated slate color palettes, and polished dark/light themes.
  - Responsive layout with collapsible sidebar, mobile drawer, and high-density tabular views.

- **Stateless DuckDB OLAP Engine**:
  - Vectorized SQL ingestion and query execution via **DuckDB** and **PyArrow**.
  - Direct conversion of CSV, TSV, JSON, and Parquet uploads into high-performance compressed **Parquet (`.parquet`)** storage.
  - Non-blocking execution running heavy OLAP queries inside worker thread pools (`ThreadPoolExecutor`).

- **Data Transformation Studio (Power Query)**:
  - **Multi-Dataset Joins**: Merge two datasets using Inner, Left, Right, or Full Outer joins with custom key matching.
  - **Calculated Columns**: Create arithmetic formulas (`+`, `-`, `×`, `÷`) between columns or with constant scalar values.
  - **Group & Aggregate**: Pivot datasets by dimension with `SUM`, `AVERAGE`, `COUNT`, `MIN`, and `MAX`.
  - **Clean & Impute Missing Data**: Fill N/A values via Zero, Mean, Median, Mode, or Forward Fill.
  - **Row Filtering**: Filter datasets with conditional operators (`==`, `!=`, `>`, `<`, `contains`).
  - **Pipeline History**: Visual applied steps audit trail tracking every transformation.
  - **Workspace Sync**: One-click sync to update all active workspace pages with transformed data.
  - **Multi-Format Export**: Download transformed datasets as **CSV**, **Excel (`.xlsx`)**, or **JSON**.

- **Multi-Format Data Ingestion**:
  - Native support for **CSV**, **Excel (`.xlsx`, `.xls`)**, **JSON**, **TSV**, and **Parquet (`.parquet`)**.
  - Automatic column profiling, schema inference, and data type detection.

- **Conversational Analytics (Ask AI)**:
  - Translate plain English questions into validated, read-only SQL queries via Groq LLMs.
  - Multi-turn chat history with fast rerun and prompt suggestions.
  - Dynamic fallback model routing (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, etc.).
  - Automated statistical summaries, insights, and Scikit-Learn linear regression predictions.

- **Executive Dashboard & Auto-Visualizer**:
  - Instant high-level KPI cards: total rows, column profiling, and missing value rates.
  - AI-driven chart recommendations based on dataset distribution and heuristics.
  - Export entire dashboards to **PDF**, **PNG**, or standalone **HTML** reports.

- **Drag-and-Drop Visual Builder**:
  - Build custom visualizations by selecting dimensions, metrics, chart types (Bar, Line, Area, Scatter, Pie), and aggregations.
  - Save custom charts directly to your active dashboard.

- **Interactive Knowledge Graph**:
  - Visual force-directed network diagram displaying relationships and correlations between data entities.
  - Click any node to profile columns, execute context-aware queries, or filter table data.

- **Data Browser with AI Search**:
  - High-performance data table with column profiling modals (min, max, mean, unique values, missing rate).
  - Natural language search & filter bar.

- **Multi-User Authentication & Security**:
  - JWT token authentication with native `bcrypt` password hashing.
  - In-app AI settings modal to configure Groq API keys and select models dynamically.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   React 19 Frontend                    │
│      (Vite 7, TailwindCSS v4, Phosphor Icons, Recharts)│
└───────────────┬────────────────────────────────────────┘
                │ HTTP / REST & JWT Auth
                ▼
┌────────────────────────────────────────────────────────┐
│             Python FastAPI Microservice (8000)         │
│   • Auth & Session Management (PyJWT & native bcrypt) │
│   • Stateless File Ingestion & Parquet Converter       │
│   • Vectorized DuckDB OLAP Query Engine                │
│   • Text-to-SQL & NL Insights (Groq SDK)               │
│   • Auto-Visualization Engine & Predictions            │
└────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
.
├── frontend/                     # React + Vite application
│   ├── src/
│   │   ├── components/
│   │   │   ├── AuthPage.jsx                # Login / Registration page
│   │   │   ├── AutoDashboard.jsx           # AI Recommended Dashboard views
│   │   │   ├── ChatPanel.jsx               # Natural language query chat panel
│   │   │   ├── ColumnProfilePanel.jsx      # Deep column statistics modal
│   │   │   ├── DashboardPage.jsx           # Executive overview & KPI cards
│   │   │   ├── DataCleaningModal.jsx       # Quick dataset cleaning dialog
│   │   │   ├── DataTable.jsx               # Tabular data viewer
│   │   │   ├── DataTransformStudio.jsx     # Power Query transformation studio
│   │   │   ├── FileUpload.jsx              # Drag-and-drop multi-format uploader
│   │   │   ├── InsightsPanel.jsx           # Plain-English anomaly & trends panel
│   │   │   ├── KnowledgeGraph.jsx          # Interactive force-directed network graph
│   │   │   ├── LandingPage.jsx             # Public welcome & product overview page
│   │   │   ├── ResultsPanel.jsx            # Query result charts, tables & SQL view
│   │   │   ├── SettingsModal.jsx           # Runtime LLM & API key settings
│   │   │   ├── Sidebar.jsx                 # Main navigation & theme switch
│   │   │   ├── StatsPanel.jsx              # Statistical summary cards
│   │   │   └── VisualBuilder.jsx           # Custom drag-and-drop chart builder
│   │   ├── App.jsx                         # Main app routing & state coordinator
│   │   ├── index.css                       # Design tokens, variables & typography
│   │   └── main.jsx                        # React entry point
│   ├── package.json
│   └── vite.config.js
│
├── python-service/               # Consolidated FastAPI Analytics & Auth Microservice
│   ├── app/
│   │   ├── api/                  # API Routers
│   │   │   ├── v1/               # Version 1 endpoints (/auth & /datasets)
│   │   │   │   ├── auth.py       # Login, Signup & User profile endpoints
│   │   │   │   └── datasets.py   # Ingest, query & schema inspection endpoints
│   │   │   └── router.py         # Main API router aggregator
│   │   ├── core/                 # Core Infrastructure
│   │   │   ├── config.py         # Pydantic BaseSettings, storage paths & limits
│   │   │   ├── deps.py           # Authentication & DB FastAPI dependencies
│   │   │   └── security.py       # Native Bcrypt hashing & PyJWT token handling
│   │   ├── db/                   # Database session management for metadata/auth
│   │   ├── models/               # SQLAlchemy models (User entity)
│   │   ├── schemas/              # Pydantic schemas (Auth & Datasets)
│   │   ├── services/             # Core Services
│   │   │   ├── auth_service.py   # Signup & login business logic
│   │   │   └── duckdb_engine.py  # Stateless vectorized DuckDB OLAP engine
│   │   └── main.py               # Main FastAPI app entrypoint & middlewares
│   ├── main.py                   # Root microservice launcher wrapper
│   ├── requirements.txt          # Production backend dependencies
│   ├── test_phase1.py            # Automated architecture test suite
│   └── .env                      # Python service environment variables
│
├── sample_data/
│   └── sales_data.csv            # Sample dataset for testing
└── README.md
```

---

## Getting Started

### Prerequisites
- **Python** 3.11+ with `pip`
- **Node.js** 18+ and `npm`
- **Groq API Key** (Free tier available at [consolegroq.com](https://console.groq.com))

---

### Step 1: Configure & Start Python Service (Port 8000)

1. Navigate to `python-service`:
   ```powershell
   cd python-service
   ```

2. Activate virtual environment (or create one):
   ```powershell
   # Windows PowerShell:
   .\.venv\Scripts\Activate.ps1
   
   # macOS/Linux:
   source .venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Create or edit `python-service/.env`:
   ```ini
   SECRET_KEY=insightai_super_secret_jwt_key_2026!
   GROQ_API_KEY=gsk_your_groq_api_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   ```

5. Start the microservice:
   ```bash
   python main.py
   ```
   > Server runs at `http://localhost:8000`. Interactive API Docs available at `http://localhost:8000/api/v1/docs`.

---

### Step 2: Start React Frontend (Port 5173)

1. Open a new terminal tab and navigate to `frontend`:
   ```bash
   cd frontend
   npm install
   ```

2. Start the dev server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## API Reference

### Microservice Endpoints (`http://localhost:8000`)

| Method | Route | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register new user account | No |
| `POST` | `/api/v1/auth/login` | Authenticate & receive JWT access token | No |
| `GET` | `/api/v1/auth/me` | Retrieve active user profile | Yes |
| `POST` | `/api/v1/datasets/ingest` | Statelessly ingest file to Parquet format | Yes |
| `POST` | `/api/v1/datasets/query` | Execute non-blocking vectorized DuckDB SQL | Yes |
| `GET` | `/api/v1/datasets/{id}/schema` | Inspect dataset schema and preview rows | Yes |
| `GET` | `/health` | Service health status & probe | No |

---

## Security & Reliability Guardrails

- **SQL Sanitization**: All natural language queries are restricted to strict `SELECT` statements. Destructive operations (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`) are blocked by AST regex validation.
- **Stateless Concurrency**: Heavy DuckDB queries run statelessly inside worker thread pools (`ThreadPoolExecutor`), keeping the FastAPI event loop responsive under high load.
- **JWT Protection**: Protected endpoints enforce Bearer token verification via `HTTPBearer` dependencies.

---

## Tech Stack Summary

| Area | Technologies |
|---|---|
| **Frontend** | React 19, Vite 7, TailwindCSS v4, Phosphor Icons, Recharts |
| **Backend Service** | Python 3.11+, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy |
| **OLAP Engine** | DuckDB, PyArrow (Vectorized SQL Execution) |
| **Auth & Security** | PyJWT, native Bcrypt password hashing |
| **AI / LLM** | Groq SDK (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, etc.) |

---

## License

MIT License. Built for enterprise data intelligence and modern BI workflows.
