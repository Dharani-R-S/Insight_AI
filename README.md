# InsightAI — Intelligent Enterprise BI & Vectorized Data Analytics Platform

[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688.svg?style=flat&logo=fastapi)](https://fastapi.tiangolo.com)
[![DuckDB](https://img.shields.io/badge/DuckDB-OLAP%20Engine-FFF000.svg?style=flat&logo=duckdb)](https://duckdb.org)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?style=flat&logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF.svg?style=flat&logo=vite)](https://vitejs.dev)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg?style=flat&logo=python)](https://python.org)
[![SQLGlot](https://img.shields.io/badge/Security-SQLGlot%20AST-4CAF50.svg?style=flat)](https://github.com/tobymao/sqlglot)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

InsightAI is an enterprise-grade, conversational business intelligence, data engineering, and predictive analytics platform. It empowers data teams and business stakeholders to upload diverse datasets, execute multi-step vectorized data transformations (Power Query backend), query datasets in plain English using LLM Text-to-SQL, perform AI-powered root-cause variance analysis with grounded executive summaries, receive intelligent follow-up question suggestions, and interact with real-time executive dashboards, force-directed knowledge graphs, and predictive forecasting models.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              React 19 Frontend                                 │
│        (Vite 7, TailwindCSS v4, Phosphor Icons, Recharts, Network Graphs)       │
└───────────────────────┬─────────────────────────────────┬──────────────────────┘
                        │ HTTP / REST                     │ JWT Bearer Auth
                        ▼                                 ▼
┌────────────────────────────────────────┐ ┌────────────────────────────────────┐
│      Express Gateway (Port 5000)       │ │ Python FastAPI Service (Port 8000) │
│  • Multi-user session persistence      │ │  • Phase 1: DuckDB OLAP & Auth     │
│  • Static distribution proxy           │ │  • Phase 2: NL Text-to-SQL & AST   │
│  • Uploads file-stream gateway         │ │  • Phase 3: Power Query CTE Engine │
│                                        │ │  • Phase 5: AI Intelligence Engine │
└────────────────────────────────────────┘ └─────────────────┬──────────────────┘
                                                             │
                                   ┌─────────────────────────┼────────────────────────┐
                                   │                         │                        │
                                   ▼                         ▼                        ▼
                    ┌──────────────────────────┐ ┌───────────────────────┐ ┌──────────────────────────┐
                    │   DuckDB OLAP Engine     │ │   Groq LLM Service    │ │  Intelligence Engine     │
                    │ • Stateless CTE Chaining │ │ • Text-to-SQL         │ │ • Root-Cause Analysis    │
                    │ • Snappy Parquet Storage  │ │ • Schema Injection    │ │ • Variance Decomposition │
                    │ • Zero-Pandas Engine     │ │ • SQLGlot AST Guard   │ │ • Next Best Question     │
                    └──────────────────────────┘ └───────────────────────┘ │ • Grounded Narratives    │
                                                                          └──────────────────────────┘
```

---

## Core Capabilities & Engineering Phases

### Phase 1: Stateless DuckDB OLAP Engine & Authentication
- **Vectorized Parquet Storage**: Converts raw CSV, TSV, JSON, and Excel (`.xlsx`, `.xls`) uploads directly into high-efficiency, compressed **Parquet (`.parquet`)** files with PyArrow.
- **Non-Blocking Query Execution**: Offloads heavy analytical SQL queries to CPU worker thread pools (`ThreadPoolExecutor`), eliminating event loop starvation.
- **JWT Authentication & Native Bcrypt**: Secure user registration, authentication, and session inspection with signed JWT access tokens.
- **Stateless Column Profiling**: Computes exact row counts, distinct values, null distributions, data types, and sample previews directly from Parquet metadata.

### Phase 2: Conversational Analytics & AST Security Validator
- **Natural Language to SQL (`POST /api/ask`)**: Translates plain-English business questions into executable DuckDB SQL queries via Groq LLMs (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`).
- **Dynamic Schema Context Injection**: Automatically introspects active dataset schema, column types, and sample data values to ground LLM query generation in precise facts.
- **SQLGlot AST Security Firewall**: Parses and walks the Abstract Syntax Tree (AST) of generated SQL queries to guarantee **read-only `SELECT`/`WITH` operations**. Blocks all destructive DDL/DML mutations (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, `PRAGMA`, multi-statement semicolons).
- **Statistical Summaries & Predictive Forecasting**: Automated linear regression and statistical trend analysis.

### Phase 3: Vectorized Data Transformation Engine (Power Query Backend)
- **Zero Pandas in Transformations**: All transformations are compiled directly into native DuckDB SQL. No in-memory dataframe bottlenecks.
- **CTE Chaining Architecture**: Converts JSON transformation audit trails into chained Common Table Expressions (`WITH step_0 AS (...), step_1 AS (...)... SELECT * FROM step_n`).
- **Comprehensive Transformation Operations**:
  - **Filter**: Compiles to parameterized/escaped `WHERE` clauses (`==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_null`, `is_not_null`, `in`, `not_in`, `between`).
  - **Calculate (Formulas)**: Compiles structured arithmetic (`+`, `-`, `*`, `/`, `%`, `^`) with **built-in divide-by-zero protection** (`CASE WHEN col = 0 THEN 0 ELSE ... END`) and validated custom SQL expressions.
  - **Aggregate (Group By & Pivot)**: Compiles `GROUP BY` with `SUM`, `AVG`, `MEAN`, `COUNT`, `COUNT_DISTINCT`, `MIN`, `MAX`, `MEDIAN`, `MODE`, `STDDEV`, `VARIANCE`.
  - **Impute (Missing Data Cleaning)**: Compiles `COALESCE` and DuckDB `EXCLUDE (...)` window functions for `zero`, `mean`, `median`, `mode`, `ffill` (forward fill), `bfill` (backward fill), and `custom` scalar replacements.
  - **Join (Multi-Dataset Merge)**: Compiles `INNER`, `LEFT`, `RIGHT`, and `FULL OUTER` joins between multiple Parquet datasets with single or multi-column keys.
  - **Structural Operations**: `Rename` (DuckDB `RENAME`), `Sort` (`ORDER BY ASC/DESC`), `Drop Duplicates` (`DISTINCT ON`), `Select Columns`, `Drop Columns` (`EXCLUDE`).
- **Stateless Pipeline Preview (`POST /api/transform/preview`)**: Fast interactive preview for UI with configurable row limit (default: 100).
- **Physical Parquet Materialization (`POST /api/transform/commit`)**: Persists the transformed dataset into a newly minted, compressed `.parquet` file using DuckDB native `COPY (...) TO ... (FORMAT PARQUET)`.

### Phase 5: AI & Conversational Intelligence Engine
- **Root-Cause "Why" Analysis (`POST /api/intelligence/root-cause`)**: Decomposes metric variance between two time periods into its top contributing dimensional drivers. All heavy computation (grouped aggregations, absolute/percentage change, ranking) is offloaded to DuckDB — never to the LLM.
- **DuckDB Statistical Offloading**: The `DiagnosticAnalyzer` writes native DuckDB SQL that calculates variance grouped by categorical columns (Region, Category, etc.), sorts by magnitude, and extracts only the top 3 drivers.
- **Grounded LLM Narration**: Passes ONLY the pre-computed top 3 statistical drivers to the Groq LLM. A strict system prompt forbids the LLM from hallucinating reasons outside of the provided statistical data. The output is exactly 2 sentences.
- **Next Best Question (`POST /api/intelligence/next-questions`)**: Analyzes the current dataset schema and last query context to dynamically generate 3 actionable follow-up question suggestion chips. The LLM returns these strictly as a JSON list of strings.
- **Deterministic Fallbacks**: When the LLM is unavailable, both services degrade gracefully — the root-cause summary is constructed from raw statistics, and follow-up questions are generated from schema metadata.

---

## API Reference

### AI & Conversational Intelligence Endpoints (Phase 5)

| Method | Route | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/intelligence/root-cause` | Decomposes metric variance into top dimensional drivers with LLM narrative | Optional |
| `POST` | `/api/intelligence/next-questions` | Generates 3 follow-up question suggestion chips from schema + query context | Optional |

#### Root-Cause Variance Analysis Request (`POST /api/intelligence/root-cause`):
```json
{
  "parquet_path": "storage/parquet/sales_data.parquet",
  "metric_column": "revenue",
  "date_column": "order_date",
  "baseline_start": "2024-01-01",
  "baseline_end": "2024-03-31",
  "comparison_start": "2024-04-01",
  "comparison_end": "2024-06-30",
  "dimension_columns": ["region", "category"],
  "aggregation": "SUM",
  "top_n": 3
}
```

#### Next Best Question Request (`POST /api/intelligence/next-questions`):
```json
{
  "parquet_path": "storage/parquet/sales_data.parquet",
  "last_query": "What are the top 5 regions by revenue?",
  "last_sql": "SELECT region, SUM(revenue) FROM dataset GROUP BY region ORDER BY SUM(revenue) DESC LIMIT 5",
  "last_result_columns": ["region", "sum(revenue)"]
}
```

### Transformation Engine Endpoints (Phase 3)

| Method | Route | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/transform/preview` | Compiles pipeline JSON into CTE SQL and returns preview rows & metadata | Optional |
| `POST` | `/api/transform/commit` | Materializes pipeline into a new `.parquet` file and returns schema | Optional |
| `POST` | `/api/transform/compile` | Returns compiled CTE SQL string and step summary without execution | Optional |

#### Sample Pipeline Request Payload (`POST /api/transform/preview`):
```json
{
  "parquet_path": "storage/parquet/retail_sales.parquet",
  "steps": [
    {
      "type": "impute",
      "column": "discount",
      "strategy": "zero"
    },
    {
      "type": "calculate",
      "new_column": "gross_revenue",
      "col1": "price",
      "op": "*",
      "col2": "quantity"
    },
    {
      "type": "calculate",
      "new_column": "net_revenue",
      "col1": "gross_revenue",
      "op": "-",
      "col2": "discount"
    },
    {
      "type": "filter",
      "column": "net_revenue",
      "operator": ">=",
      "value": 100.0
    },
    {
      "type": "aggregate",
      "group_by": ["category", "region"],
      "aggregations": [
        { "column": "net_revenue", "func": "sum", "alias": "total_revenue" },
        { "column": "*", "func": "count", "alias": "order_count" }
      ]
    },
    {
      "type": "sort",
      "by": ["total_revenue"],
      "ascending": false
    }
  ],
  "limit": 100
}
```

### Conversational Analytics & Ask AI Endpoints (Phase 2)

| Method | Route | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/ask` | Translates natural language question to SQL, validates AST, executes on DuckDB | Optional |

### Core Engine & Ingestion Endpoints (Phase 1)

| Method | Route | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register new user account | No |
| `POST` | `/api/v1/auth/login` | Authenticate & receive JWT access token | No |
| `GET` | `/api/v1/auth/me` | Retrieve current authenticated user profile | Yes |
| `POST` | `/api/v1/datasets/ingest` | Stateless file ingestion directly into compressed Parquet storage | Yes |
| `POST` | `/api/v1/datasets/query` | Execute safe vectorized DuckDB SQL queries with row limits | Yes |
| `GET` | `/api/v1/datasets/{id}/schema` | Inspect dataset schema, column profiling & sample preview | Yes |
| `GET` | `/health` | Service health probe & engine version info | No |

---

## Repository Structure

```
.
├── frontend/                     # React 19 + Vite 7 Application
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
├── python-service/               # FastAPI Analytics, Transformation & DuckDB Microservice
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── analytics.py            # POST /api/ask natural language SQL endpoint
│   │   │   │   └── transform.py            # POST /api/transform preview, commit, compile
│   │   │   ├── v1/
│   │   │   │   ├── auth.py                 # JWT Signup & Login endpoints
│   │   │   │   └── datasets.py             # Parquet Ingestion, Query & Schema endpoints
│   │   │   ├── legacy.py                   # Legacy SQLite / BI proxy compatibility routes
│   │   │   └── router.py                   # API router aggregator
│   │   ├── core/
│   │   │   ├── config.py                   # Pydantic Settings, memory limits & paths
│   │   │   ├── deps.py                     # Auth & Database dependency injectors
│   │   │   └── security.py                 # Native Bcrypt hashing & PyJWT token handling
│   │   ├── db/
│   │   │   └── session.py                  # Metadata database engine & sessionmaker
│   │   ├── models/
│   │   │   ├── transform.py                # Pydantic Discriminated Union Step Models
│   │   │   └── user.py                     # SQLAlchemy User entity
│   │   ├── schemas/
│   │   │   ├── auth.py                     # Auth request & response schemas
│   │   │   ├── dataset.py                  # Dataset schema, ColumnInfo & QueryResult
│   │   │   └── transform.py                # Transformation schemas alias
│   │   ├── services/
│   │   │   ├── auth_service.py             # Auth business logic
│   │   │   ├── duckdb_engine.py            # Vectorized stateless DuckDB OLAP engine
│   │   │   ├── llm_service.py              # Groq Text-to-SQL & Context Formatter
│   │   │   ├── sql_validator.py            # SQLGlot AST read-only security validator
│   │   │   └── transformation_compiler.py  # CTE Chaining Power Query Compiler
│   │   └── main.py                         # FastAPI application entrypoint
│   ├── models/
│   │   └── intelligence.py                  # Phase 5 Pydantic schemas (Variance/NextQ)
│   ├── services/
│   │   ├── diagnostic_engine.py             # DuckDB variance decomposition analyzer
│   │   └── recommendation_engine.py         # Grounded LLM narrative & question gen
│   ├── storage/
│   │   ├── parquet/                        # Compressed Parquet dataset storage
│   │   └── uploads/                        # Temporary streaming upload buffers
│   ├── test_phase1.py                      # Phase 1 test suite (Auth, DuckDB Ingest/Query)
│   ├── test_phase2.py                      # Phase 2 test suite (SQLGlot AST, LLM Text-to-SQL)
│   ├── test_phase3.py                      # Phase 3 test suite (CTE Chaining, Power Query)
│   ├── test_phase4.py                      # Phase 4 test suite (Visualization Engine)
│   ├── test_master_suite.py                # Comprehensive Master Architecture Test Suite
│   ├── requirements.txt                    # Production backend dependencies
│   └── main.py                             # Root microservice launcher wrapper
│
├── server/                       # Node.js / Express Gateway & Session Proxy
│   ├── index.js                  # Express routing, multer streaming & user session map
│   ├── package.json
│   └── users.json                # User storage fallback
│
├── sample_data/                  # Sample datasets for demonstration
│   └── sales_data.csv
└── README.md
```

---

## Getting Started

### Prerequisites
- **Python** 3.11+
- **Node.js** 18+ and `npm`
- **Groq API Key** (Free tier available at [console.groq.com](https://console.groq.com))

---

### Step 1: Start the Python Backend Service (Port 8000)

1. Open a terminal and navigate to `python-service`:
   ```bash
   cd python-service
   ```

2. Activate virtual environment:
   ```powershell
   # Windows PowerShell:
   .\.venv\Scripts\Activate.ps1

   # macOS/Linux:
   source .venv/bin/activate
   ```

3. Install backend dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure environment variables in `python-service/.env`:
   ```ini
   SECRET_KEY=insightai_super_secret_jwt_key_2026!
   GROQ_API_KEY=gsk_your_groq_api_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   DUCKDB_MEMORY_LIMIT=2GB
   DUCKDB_THREADS=4
   ```

5. Launch the microservice:
   ```bash
   python main.py
   ```
   > FastAPI service runs at `http://localhost:8000`. Interactive API Docs are available at `http://localhost:8000/api/v1/docs`.

---

### Step 2: Start Express Gateway (Port 5000)

1. Open a new terminal tab and navigate to `server`:
   ```bash
   cd server
   npm install
   npm run dev
   ```
   > Express server runs at `http://localhost:5000`.

---

### Step 3: Start React Frontend (Port 5173)

1. Open a new terminal tab and navigate to `frontend`:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   > Frontend runs at `http://localhost:5173`.

---

## Testing & Quality Assurance

Run any of the automated test suites in `python-service`:

```powershell
# Run Master Comprehensive Architecture & Edge Case Suite (Phase 1, 2, 3)
python test_master_suite.py

# Run Phase 3 Transformation Engine Test Suite
python test_phase3.py

# Run Phase 2 Text-to-SQL & AST Security Test Suite
python test_phase2.py

# Run Phase 1 Auth & DuckDB Ingestion Test Suite
python test_phase1.py
```

### Test Coverage Highlights
- ✅ **CTE Chaining**: Generates valid, chained SQL `WITH step_0 AS (...), step_1 AS (...) SELECT * FROM step_n`.
- ✅ **AST Security**: Blocks 100% of malicious DDL/DML injection attacks (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, semicolons).
- ✅ **Operator Precision**: 14+ comparison, pattern-matching (`ILIKE`), and null-check operators verified.
- ✅ **Divide-by-Zero Protection**: Arithmetic compilation automatically injects `CASE WHEN ... = 0 THEN 0` guards.
- ✅ **Imputation Integrity**: Evaluated mean, median, mode, zero, custom values, and forward/backward fill window functions.
- ✅ **Physical Materialization**: Direct Parquet writing via DuckDB `COPY (...) TO (FORMAT PARQUET)` without in-memory dataframe copies.
- ✅ **DuckDB Statistical Offloading**: Variance decomposition runs entirely in DuckDB — raw data never reaches the LLM.
- ✅ **Grounded LLM Narratives**: Executive summaries are constrained to pre-computed statistical drivers only.
- ✅ **Next Best Question**: Schema-aware follow-up suggestions returned as a strict JSON array of 3 strings.

---

## License

MIT License. Built for scalable enterprise data intelligence, modern BI workflows, and vectorized analytical transformations.
