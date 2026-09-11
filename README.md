# InsightAI — Intelligent Business Intelligence & Analytics Platform

InsightAI is an enterprise-grade, conversational business intelligence and data transformation platform. It enables teams to upload diverse datasets, perform multi-step data transformations (joins, formulas, aggregations, cleaning), query in natural language using Groq-powered LLMs, and generate executive dashboards, interactive charts, and predictive analytics — wrapped in a modern, Linear/Vercel-inspired design system.

---

## Key Capabilities

- **Modern Senior-Grade UI / UX**:
  - Clean, distraction-free aesthetic with refined typography (Inter / Geist), curated slate color palettes, and polished dark/light themes.
  - Responsive layout with collapsible sidebar, mobile drawer, and high-density tabular views.

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
  - Dynamic fallback model routing (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, etc.).
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
  - Natural language search & filter bar (e.g., *"show records where sales > 5000"* or *"top 10 by profit"*).

- **Multi-User Authentication & Settings**:
  - JWT token authentication with bcrypt password hashing in SQLite.
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
│               Node.js Express Gateway (5000)           │
│   • Auth & Session Management (better-sqlite3)         │
│   • Multi-Format File Uploads (Multer)                 │
│   • Data Export Pipeline (CSV, Excel, JSON, Parquet)   │
│   • Microservice Reverse Proxy                         │
└───────────────┬────────────────────────────────────────┘
                │ HTTP Proxy
                ▼
┌────────────────────────────────────────────────────────┐
│             Python FastAPI Analytics Engine (8000)     │
│   • Text-to-SQL & NL Insights (Groq SDK)               │
│   • Data Transformation Studio (Pandas & NumPy)        │
│   • Auto-Visualization Engine & Chart Generation       │
│   • Scikit-Learn Forecasting & Predictions             │
│   • SQLite In-Memory Database per Session              │
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
│   │   │   ├── PostUploadTransformModal.jsx# Post-upload decision modal
│   │   │   ├── ResultsPanel.jsx            # Query result charts, tables & SQL view
│   │   │   ├── SettingsModal.jsx           # Runtime LLM & API key settings
│   │   │   ├── Sidebar.jsx                 # Main navigation & theme switch
│   │   │   ├── StatsPanel.jsx              # Statistical summary cards
│   │   │   └── VisualBuilder.jsx           # Custom drag-and-drop chart builder
│   │   ├── utils/
│   │   │   └── exportUtils.js              # PDF, PNG, HTML, Excel & CSV exporters
│   │   ├── App.jsx                         # Main app routing & state coordinator
│   │   ├── index.css                       # Design tokens, variables & typography
│   │   └── main.jsx                        # React entry point
│   ├── package.json
│   └── vite.config.js
│
├── server/                       # Node.js Express Gateway
│   ├── index.js                  # Gateway routes, auth, uploads & proxy handlers
│   ├── auth.db                   # SQLite database for user accounts
│   ├── package.json
│   └── .env                      # Server configuration (PORT, JWT_SECRET, etc.)
│
├── python-service/               # FastAPI Analytics Microservice
│   ├── main.py                   # FastAPI app routes & request handlers
│   ├── requirements.txt          # Python dependencies
│   ├── services/
│   │   ├── analysis.py           # Statistical analysis & profiling
│   │   ├── auto_visualize.py     # AI auto-chart recommender
│   │   ├── charts.py             # Chart specification & aggregation generator
│   │   ├── database.py           # Multi-format ingestion & SQLite session manager
│   │   ├── llm.py                # Groq client, prompt templates & SQL validator
│   │   ├── prediction.py         # Scikit-learn regression forecasting
│   │   ├── recommendations.py    # Follow-up query recommendations
│   │   └── transform_service.py  # Joins, formulas, imputations & filters engine
│   └── .env                      # Python service config (GROQ_API_KEY, GROQ_MODEL)
│
├── sample_data/
│   └── sales_data.csv            # Sample dataset for immediate testing
└── README.md
```

---

## Getting Started

### Prerequisites
- **Node.js** 18+ and `npm`
- **Python** 3.10+ with `pip`
- **Groq API Key** (Free tier available at [console.groq.com](https://console.groq.com))

---

### Step 1: Configure & Start Python Service (Port 8000)

```bash
cd python-service
python -m venv venv

# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

Create or edit `python-service/.env`:
```ini
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
PORT=8000
```

Start the FastAPI microservice:
```bash
python main.py
```
> The service runs at `http://localhost:8000`. Health check is available at `http://localhost:8000/health`.

---

### Step 2: Configure & Start Express Gateway (Port 5000)

```bash
cd ../server
npm install
```

Create or edit `server/.env`:
```ini
PORT=5000
PYTHON_SERVICE_URL=http://localhost:8000
JWT_SECRET=your-super-secret-jwt-key
```

Start the backend:
```bash
npm run dev
```
> The API gateway runs at `http://localhost:5000`.

---

### Step 3: Start React Frontend (Port 5173)

```bash
cd ../frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## API Reference

### Express Gateway (`http://localhost:5000`)

| Method | Route | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/signup` | Register new user account | No |
| `POST` | `/api/auth/login` | Log in and receive JWT token | No |
| `GET` | `/api/auth/me` | Fetch active user profile | Yes |
| `POST` | `/api/upload` | Upload dataset (`.csv`, `.xlsx`, `.json`, `.parquet`) | Yes |
| `GET` | `/api/datasets/current` | Retrieve current active dataset metadata | Yes |
| `POST` | `/api/ask` | Natural language question to SQL + insights | Yes |
| `POST` | `/api/datasets/clean` | Clean dataset (missing values, drop duplicates) | Yes |
| `GET` | `/api/datasets/export` | Download dataset (`?format=csv\|excel\|json\|parquet`) | Yes |
| `POST` | `/api/datasets/auto-visualize` | Generate AI visualization recommendations | Yes |
| `POST` | `/api/transform/join` | Merge 2 datasets via Inner/Left/Right/Outer join | Yes |
| `POST` | `/api/transform/apply` | Apply calculated column, groupby, impute, or filter | Yes |
| `GET` | `/api/settings` | Get current Groq model and available models list | Yes |
| `POST` | `/api/settings` | Update runtime Groq model or API key | Yes |

---

### Python Analytics Service (`http://localhost:8000`)

| Method | Route | Description |
|---|---|---|
| `POST` | `/upload` | Ingest file into session SQLite database |
| `POST` | `/analyze` | Execute SQL, generate charts, calculate stats & predict |
| `POST` | `/recommend-visualizations`| Suggest top 5 visualizations from dataset schema |
| `POST` | `/analyze/generate-charts` | Build plot configurations for recommended charts |
| `POST` | `/api/transform/join` | Execute Pandas merge with specified join type & keys |
| `POST` | `/api/transform/apply` | Execute calculated column, groupby, impute, or filter |
| `GET` | `/settings` | Return model configurations & check key status |
| `POST` | `/settings` | Update runtime model and write to `.env` |
| `GET` | `/health` | Service health status and Groq configuration check |

---

## Security & Reliability Guardrails

- **SQL Sanitization**: All natural language queries are restricted to strict `SELECT` statements. Destructive operations (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`) are blocked by an AST regex validator before execution.
- **Session Isolation**: Each user session operates with its own SQLite database instance.
- **Rate-Limit & Fallback Handling**: Dynamic Groq model fallback prevents service interruptions if rate limits are reached.
- **JWT Protection**: Sensitive API endpoints enforce Bearer token verification.

---

## Tech Stack Summary

| Area | Technologies |
|---|---|
| **Frontend** | React 19, Vite 7, TailwindCSS v4, Phosphor Icons, Recharts |
| **Backend Gateway** | Node.js, Express 4, better-sqlite3, Multer, Axios, JWT, bcryptjs |
| **Microservice** | Python 3.10+, FastAPI, Uvicorn, Pydantic |
| **Data & Analytics** | Pandas, NumPy, Scikit-learn, SQLite, Plotly |
| **AI / LLM** | Groq SDK (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, etc.) |
| **Export Engines** | SheetJS (Excel), html2canvas, jsPDF |

---

## License

MIT License. Built for enterprise data intelligence and modern BI workflows.
