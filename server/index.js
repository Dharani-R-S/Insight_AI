import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';
const JWT_SECRET = process.env.JWT_SECRET || 'insightai-secret-key-change-in-production';

// ─── Storage Directory Setup ───
const dataDir = process.env.APP_DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── Users Store (Zero Native Dependency, 100% Cross-Platform) ───
const usersFile = path.join(dataDir, 'users.json');

// Initialize usersFile from existing seed if available
if (!fs.existsSync(usersFile)) {
  const seedFile = path.join(__dirname, 'users.json');
  if (fs.existsSync(seedFile)) {
    try {
      fs.copyFileSync(seedFile, usersFile);
    } catch {}
  }
}

function getUsers() {
  try {
    if (fs.existsSync(usersFile)) {
      const data = fs.readFileSync(usersFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error reading users.json:', e);
  }
  return [];
}

function saveUsers(users) {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving users.json:', e);
  }
}

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure uploads directory exists in writable dataDir
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ─── Auth Middleware ───
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// ─── POST /api/auth/signup ───
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const users = getUsers();
    const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = {
      id: Date.now(),
      name,
      email,
      password_hash,
      created_at: new Date().toISOString()
    };
    users.push(user);
    saveUsers(users);

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    console.log(`✅ New user registered: ${email}`);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('❌ Signup error:', err.message);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

// ─── POST /api/auth/login ───
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const users = getUsers();
    const row = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!row) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = { id: row.id, name: row.name, email: row.email };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    console.log(`🔑 User logged in: ${email}`);
    res.json({ token, user });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─── GET /api/auth/me ───
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─── Allowed Dataset File Formats ───
const ALLOWED_EXTENSIONS = new Set([
  '.csv', '.tsv', '.tab', '.txt',
  '.xlsx', '.xls', '.xlsm', '.xlsb',
  '.json', '.jsonl',
  '.parquet'
]);

// ─── Multer config ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const uniqueName = `${Date.now()}-${safeName}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Unsupported file type '${ext}'. Supported: CSV, Excel (.xlsx, .xls), JSON, TSV, Parquet.`));
    }
    cb(null, true);
  },
});

// Store current session info per user
const userSessions = new Map();

function getUserSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      dbPath: null,
      schema: null,
      sampleRows: null,
      tableName: null,
      columns: null,
      rowCount: null,
    });
  }
  return userSessions.get(userId);
}

// ─── POST /api/upload (protected) ───
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`📂 File received: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path), req.file.originalname);

    const response = await axios.post(`${PYTHON_URL}/upload`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const updatedSession = {
      dbPath: response.data.db_path,
      schema: response.data.schema,
      sampleRows: response.data.sample_rows,
      tableName: response.data.table_name,
      columns: response.data.columns,
      rowCount: response.data.row_count,
    };

    userSessions.set(req.user.id, updatedSession);

    console.log(`✅ Dataset loaded for ${req.user.email}: ${updatedSession.rowCount} rows, ${updatedSession.columns?.length} columns`);

    res.json({
      table_name: updatedSession.tableName,
      columns: updatedSession.columns,
      row_count: updatedSession.rowCount,
      sample_rows: updatedSession.sampleRows,
      schema: updatedSession.schema,
    });
  } catch (err) {
    console.error('❌ Upload error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.detail || err.message || 'Upload failed',
    });
  }
});

// ─── GET /api/datasets/current (protected) ───
app.get('/api/datasets/current', requireAuth, (req, res) => {
  const currentSession = getUserSession(req.user.id);
  if (!currentSession.dbPath) {
    return res.status(404).json({ error: 'No dataset in current session.' });
  }

  res.json({
    table_name: currentSession.tableName,
    columns: currentSession.columns,
    row_count: currentSession.rowCount,
    sample_rows: currentSession.sampleRows,
    schema: currentSession.schema,
  });
});

// ─── POST /api/datasets/clean (protected) ───
app.post('/api/datasets/clean', requireAuth, async (req, res) => {
  try {
    const currentSession = getUserSession(req.user.id);
    if (!currentSession.dbPath) {
      return res.status(400).json({ error: 'No dataset in session to clean.' });
    }

    const { impute_numeric, fill_text, drop_duplicates, drop_empty_cols } = req.body;

    const response = await axios.post(`${PYTHON_URL}/clean-data`, {
      db_path: currentSession.dbPath,
      impute_numeric: impute_numeric || 'mean',
      fill_text: fill_text || 'N/A',
      drop_duplicates: drop_duplicates ?? true,
      drop_empty_cols: drop_empty_cols ?? true,
    });

    const updatedSession = {
      ...currentSession,
      schema: response.data.schema,
      sampleRows: response.data.sample_rows,
      columns: response.data.columns,
      rowCount: response.data.row_count,
    };

    userSessions.set(req.user.id, updatedSession);

    console.log(`🧹 Dataset cleaned for ${req.user.email}: ${response.data.cleaned_summary?.rows_removed ?? 0} rows removed`);

    res.json(response.data);
  } catch (err) {
    console.error('❌ Clean dataset error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.detail || err.message || 'Cleaning failed',
    });
  }
});

// ─── GET & POST /api/datasets/export (protected) ───
const handleExportDataset = async (req, res) => {
  try {
    const currentSession = getUserSession(req.user.id);
    if (!currentSession.dbPath) {
      return res.status(400).json({ error: 'No active dataset in session to export.' });
    }

    const format = (req.query.format || req.body?.format || 'csv').toLowerCase().trim();
    const filename = (req.query.filename || req.body?.filename || 'transformed_dataset').trim();

    console.log(`📥 Exporting dataset for ${req.user.email} in format: ${format}`);

    const response = await axios.post(`${PYTHON_URL}/export-data`, {
      db_path: currentSession.dbPath,
      format,
      filename,
    }, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const contentDisposition = response.headers['content-disposition'] || `attachment; filename="${filename}.${format}"`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('❌ Dataset export error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.detail || err.message || 'Dataset export failed',
    });
  }
};

app.get('/api/datasets/export', requireAuth, handleExportDataset);
app.post('/api/datasets/export', requireAuth, handleExportDataset);

// ─── POST /api/ask (protected) ───
app.post('/api/ask', requireAuth, async (req, res) => {
  try {
    const { question } = req.body;
    const currentSession = getUserSession(req.user.id);

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!currentSession.dbPath) {
      return res.status(400).json({ error: 'No dataset uploaded. Please upload a CSV file first.' });
    }

    console.log(`💬 Question from ${req.user.email}: "${question}"`);

    const response = await axios.post(`${PYTHON_URL}/analyze`, {
      question,
      db_path: currentSession.dbPath,
      schema: currentSession.schema,
      sample_rows: currentSession.sampleRows,
    }, {
      timeout: 60000,
    });

    console.log(`✅ Analysis complete. SQL: ${response.data.sql_query?.substring(0, 60)}...`);

    res.json(response.data);
  } catch (err) {
    console.error('❌ Analysis error:', err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.detail || err.message || 'Analysis failed',
    });
  }
});

// ─── POST /api/recommend-visualizations (protected) ───
app.post('/api/recommend-visualizations', requireAuth, async (req, res) => {
  try {
    const { columns, schema, sample_rows } = req.body;

    if (!columns || columns.length === 0) {
      return res.status(400).json({ error: 'Columns information is required' });
    }

    console.log(`📊 Getting visualization recommendations for ${columns.length} columns`);

    try {
      // Try to get AI recommendations from Python service
      const response = await axios.post(`${PYTHON_URL}/recommend-visualizations`, {
        columns,
        schema,
        sample_rows,
      }, {
        timeout: 30000,
      });

      console.log(`✅ AI Recommendations generated: ${response.data.recommendations?.length || 0} suggestions`);
      return res.json(response.data);
    } catch (aiErr) {
      console.warn('⚠️ AI recommendations failed, using fallback:', aiErr.message);
      
      // Fallback to basic recommendations if Python service fails
      const fallbackRecommendations = generateFallbackRecommendations(columns);
      return res.json({ recommendations: fallbackRecommendations });
    }
  } catch (err) {
    console.error('❌ Recommendation error:', err.message);
    res.status(500).json({
      error: err.message || 'Failed to generate recommendations',
    });
  }
});

// ─── POST /api/recommend-queries (protected) ───
app.post('/api/recommend-queries', requireAuth, async (req, res) => {
  try {
    const response = await axios.post(`${PYTHON_URL}/recommend-queries`, req.body, { timeout: 15000 });
    res.json(response.data);
  } catch (err) {
    console.warn('⚠️ AI recommend-queries failed:', err.message);
    const cols = req.body.columns || [];
    res.json({
      queries: [
        'Show total sales per region',
        'Top 5 categories by volume',
        'Average values across groups',
        'Distribution of records'
      ]
    });
  }
});

// ─── Settings Endpoints (protected) ───
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const response = await axios.get(`${PYTHON_URL}/settings`, { timeout: 10000 });
    res.json(response.data);
  } catch (err) {
    res.json({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      has_key: true,
      available_models: [
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b',
        'qwen/qwen3.6-27b',
        'groq/compound',
        'groq/compound-mini'
      ]
    });
  }
});

app.post('/api/settings', requireAuth, async (req, res) => {
  try {
    const response = await axios.post(`${PYTHON_URL}/settings`, req.body, { timeout: 15000 });
    res.json(response.data);
  } catch (err) {
    console.error('Settings update error:', err.message);
    res.status(500).json({ error: err.response?.data?.detail || err.message || 'Failed to update settings' });
  }
});

app.post('/api/settings/test', requireAuth, async (req, res) => {
  try {
    const response = await axios.post(`${PYTHON_URL}/test-connection`, req.body, { timeout: 15000 });
    res.json(response.data);
  } catch (err) {
    console.error('Settings test error:', err.response?.data || err.message);
    res.status(err.response?.status || 400).json({
      error: err.response?.data?.detail || err.message || 'AI Connection failed',
    });
  }
});

// ─── Data Transformation Proxies ───
app.post('/api/transform/join', async (req, res) => {
  try {
    const pyRes = await axios.post(`${PYTHON_URL}/api/transform/join`, req.body);
    res.json(pyRes.data);
  } catch (err) {
    console.error('Transform join error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.detail || err.message });
  }
});

app.post('/api/transform/apply', async (req, res) => {
  try {
    const pyRes = await axios.post(`${PYTHON_URL}/api/transform/apply`, req.body);
    res.json(pyRes.data);
  } catch (err) {
    console.error('Transform apply error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.detail || err.message });
  }
});

// ─── POST /api/datasets/auto-visualize (protected) ───
app.post('/api/datasets/auto-visualize', requireAuth, async (req, res) => {
  try {
    const currentSession = getUserSession(req.user.id);
    if (!currentSession.dbPath) {
      return res.status(400).json({ error: 'No dataset uploaded. Please upload a CSV file first.' });
    }

    console.log(`🎨 Auto-visualize initiated for dataset with ${currentSession.columns?.length || 0} columns`);

    // Step 1: Get visualization recommendations from Python service
    try {
      const recommendationResponse = await axios.post(`${PYTHON_URL}/recommend-visualizations`, {
        columns: currentSession.columns,
        schema: currentSession.schema,
        sample_rows: currentSession.sampleRows,
      }, {
        timeout: 30000,
      });

      if (!recommendationResponse.data.recommendations || recommendationResponse.data.recommendations.length === 0) {
        return res.status(400).json({ error: 'Could not generate visualization recommendations.' });
      }

      const recommendations = recommendationResponse.data.recommendations;
      console.log(`✅ Received ${recommendations.length} recommendations from AI`);

      // Step 2: Validate recommendations
      const validRecommendations = recommendations
        .slice(0, 5) // Limit to 5 recommendations
        .filter(rec => {
          // Check if recommended columns exist in dataset
          if (rec.features && Array.isArray(rec.features)) {
            return rec.features.some(col => currentSession.columns.includes(col));
          }
          if (rec.columns && Array.isArray(rec.columns)) {
            return rec.columns.some(col => currentSession.columns.includes(col));
          }
          // If no specific columns mentioned, accept the recommendation
          return true;
        })
        .map((rec, idx) => ({
          ...rec,
          id: rec.id || `rec-${idx}`,
          type: rec.type || 'bar',
          title: rec.title || `${(rec.type || 'bar').charAt(0).toUpperCase() + (rec.type || 'bar').slice(1)} Chart`,
          description: rec.description || rec.rationale || 'Recommended visualization',
          x_axis: rec.x_axis || (rec.features?.[0]) || (rec.columns?.[0]) || null,
          y_axis: rec.y_axis || (rec.features?.[1]) || (rec.columns?.[1]) || null,
          columns: rec.columns || rec.features || []
        }));

      if (validRecommendations.length === 0) {
        return res.status(400).json({ error: 'No valid recommendations generated for the dataset.' });
      }

      console.log(`✅ Validated ${validRecommendations.length} recommendations`);

      // Step 3: Call Python service to generate chart data
      let chartsData = {};
      try {
        const chartsResponse = await axios.post(`${PYTHON_URL}/analyze/generate-charts`, {
          recommendations: validRecommendations,
          sample_rows: currentSession.sampleRows,
          db_path: currentSession.dbPath,
          query: 'SELECT * FROM data',
        }, {
          timeout: 60000,
        });

        chartsData = chartsResponse.data.charts || {};
        console.log(`✅ Generated chart data for ${Object.keys(chartsData).length} visualizations`);
      } catch (chartErr) {
        console.warn('⚠️ Chart generation failed:', chartErr.message);
        // Continue without chart data - return recommendations only
        chartsData = {};
      }

      // Step 4: Combine recommendations with chart data
      const result = {
        recommendations: validRecommendations.map(rec => {
          const chartId = rec.id || `rec-0`;
          const chartData = chartsData[chartId] || {};
          
          return {
            id: rec.id,
            type: rec.type,
            title: rec.title,
            description: rec.description,
            columns: rec.columns,
            confidence: rec.confidence || 0.75,
            x_axis: rec.x_axis,
            y_axis: rec.y_axis,
            chartData: {
              data: chartData.data || [],
              config: chartData.config || {},
              metadata: chartData.metadata || {}
            }
          };
        }),
        summary: {
          totalRecommendations: validRecommendations.length,
          datasetInfo: {
            rowCount: currentSession.rowCount,
            columnCount: currentSession.columns?.length || 0,
            columns: currentSession.columns || []
          }
        }
      };

      console.log(`✨ Auto-visualization complete with ${result.recommendations.length} recommendations`);
      res.json(result);

    } catch (recErr) {
      console.error('❌ Recommendation generation error:', recErr.response?.data || recErr.message);
      res.status(500).json({
        error: recErr.response?.data?.detail || recErr.message || 'Failed to generate recommendations'
      });
    }
  } catch (err) {
    console.error('❌ Auto-visualize error:', err.message);
    res.status(500).json({
      error: err.message || 'Auto-visualization failed'
    });
  }
});

// ─── POST /api/datasets/auto-dashboard (protected) ───
app.post('/api/datasets/auto-dashboard', requireAuth, async (req, res) => {
  try {
    const currentSession = getUserSession(req.user.id);
    if (!currentSession.dbPath) {
      return res.status(400).json({ error: 'No dataset uploaded. Please upload a CSV file first.' });
    }

    console.log(`🎨 Auto-dashboard initiated for dataset with ${currentSession.columns?.length || 0} columns`);

    // Call Python service to generate dashboard with chart data
    try {
      const dashboardResponse = await axios.post(`${PYTHON_URL}/analyze/auto-dashboard`, {
        columns: currentSession.columns,
        schema: currentSession.schema,
        sample_rows: currentSession.sampleRows.slice(0, 500),
        db_path: currentSession.dbPath,
      }, {
        timeout: 60000,
      });

      if (!dashboardResponse.data.charts || dashboardResponse.data.charts.length === 0) {
        return res.status(400).json({ error: 'Could not generate dashboard visualizations.' });
      }

      const charts = dashboardResponse.data.charts;
      console.log(`✅ Generated ${charts.length} dashboard charts`);

      res.json({
        charts: charts,
        summary: {
          totalCharts: charts.length,
          datasetInfo: {
            rowCount: currentSession.rowCount,
            columnCount: currentSession.columns?.length || 0,
            columns: currentSession.columns || []
          }
        }
      });

    } catch (dashErr) {
      console.error('❌ Dashboard generation error:', dashErr.response?.data || dashErr.message);
      res.status(500).json({
        error: dashErr.response?.data?.detail || dashErr.message || 'Failed to generate dashboard'
      });
    }
  } catch (err) {
    console.error('❌ Auto-dashboard error:', err.message);
    res.status(500).json({
      error: err.message || 'Dashboard generation failed'
    });
  }
});

// ─── Fallback Recommendation Generator ───
function generateFallbackRecommendations(columns) {
  const recommendations = [];
  
  if (columns.length < 2) {
    return recommendations;
  }

  // Simple heuristics for fallback recommendations
  recommendations.push({
    id: 'fallback-bar',
    type: 'bar',
    title: 'Categorical Overview',
    rationale: 'Display values across different categories or time periods.',
    features: columns.slice(0, 2),
    confidence: 0.7,
  });

  if (columns.length >= 2) {
    recommendations.push({
      id: 'fallback-line',
      type: 'line',
      title: 'Trend Analysis',
      rationale: 'Track changes over time or identify patterns in sequential data.',
      features: columns.slice(0, 2),
      confidence: 0.65,
    });
  }

  if (columns.length >= 1) {
    recommendations.push({
      id: 'fallback-pie',
      type: 'pie',
      title: 'Distribution Breakdown',
      rationale: 'Show the proportion of each category in your dataset.',
      features: [columns[0]],
      confidence: 0.6,
    });
  }

  if (columns.length >= 2) {
    recommendations.push({
      id: 'fallback-scatter',
      type: 'scatter',
      title: 'Correlation Exploration',
      rationale: 'Identify relationships between two numeric variables.',
      features: columns.slice(0, 2),
      confidence: 0.65,
    });
  }

  return recommendations;
}

// ─── Health Check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', python_service: PYTHON_URL });
});

// ─── Serve Static Frontend in Production / Desktop ───
const frontendDist = process.env.FRONTEND_DIST || path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  console.log(`🌐 Serving static frontend from: ${frontendDist}`);
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  console.warn(`⚠️ Frontend dist directory not found at: ${frontendDist}`);
}

// ─── Error Handler ───
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Express server running on http://localhost:${PORT}`);
  console.log(`📡 Python service: ${PYTHON_URL}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`🔐 Users Store: ${usersFile}\n`);
});
