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
const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
const JWT_SECRET = process.env.JWT_SECRET || 'insightai-secret-key-change-in-production';

// ─── Storage Directory Setup ───
const dataDir = process.env.APP_DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── User Store (Pure JS JSON Database - No Native C++ Mismatch) ───
const usersFile = path.join(dataDir, 'users.json');
function loadUsers() {
  if (!fs.existsSync(usersFile)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save users:', err);
  }
}

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure uploads directory exists
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
    const users = loadUsers();
    const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now(),
      name,
      email,
      password_hash,
      created_at: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers(users);

    const user = { id: newUser.id, name: newUser.name, email: newUser.email };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    console.log(`✅ New user registered: ${email}`);
    res.json({ token, user });
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
    const users = loadUsers();
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

// ─── Multer config ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.csv') {
      return cb(new Error('Only CSV files are allowed'));
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

// ─── Extract LLM Configuration Helper ───
function extractLlmConfig(req) {
  const bodyConfig = req.body?.llm_config || req.body?.llmConfig || {};
  const provider = req.headers['x-llm-provider'] || bodyConfig.provider || undefined;
  const apiKey = req.headers['x-llm-api-key'] || bodyConfig.api_key || bodyConfig.apiKey || undefined;
  const model = req.headers['x-llm-model'] || bodyConfig.model || undefined;
  const baseUrl = req.headers['x-llm-base-url'] || bodyConfig.base_url || bodyConfig.baseUrl || undefined;

  return {
    provider,
    api_key: apiKey,
    model,
    base_url: baseUrl,
  };
}

// ─── POST /api/llm/test ───
app.post('/api/llm/test', async (req, res) => {
  try {
    const config = extractLlmConfig(req);
    const provider = config.provider || req.body.provider || 'groq';
    const apiKey = config.api_key || req.body.api_key || req.body.apiKey || '';
    const model = config.model || req.body.model || '';
    const baseUrl = config.base_url || req.body.base_url || req.body.baseUrl || '';

    const response = await axios.post(`${PYTHON_URL}/llm/test`, {
      provider,
      api_key: apiKey,
      model,
      base_url: baseUrl,
    }, { timeout: 35000 });

    res.json(response.data);
  } catch (err) {
    console.error('❌ LLM Test error:', err.response?.data || err.message);
    res.status(err.response?.status || 400).json({
      error: err.response?.data?.detail || err.message || 'LLM connection test failed',
    });
  }
});

// ─── POST /api/ask (protected) ───
app.post('/api/ask', requireAuth, async (req, res) => {
  try {
    const { question } = req.body;
    const currentSession = getUserSession(req.user.id);
    const llmConfig = extractLlmConfig(req);

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!currentSession.dbPath) {
      return res.status(400).json({ error: 'No dataset uploaded. Please upload a CSV file first.' });
    }

    console.log(`💬 Question from ${req.user.email} (Provider: ${llmConfig.provider || 'default'}): "${question}"`);

    const response = await axios.post(`${PYTHON_URL}/analyze`, {
      question,
      db_path: currentSession.dbPath,
      schema: currentSession.schema,
      sample_rows: currentSession.sampleRows,
      llm_config: llmConfig,
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
    const llmConfig = extractLlmConfig(req);

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
        llm_config: llmConfig,
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

// ─── POST /api/datasets/auto-visualize (protected) ───
app.post('/api/datasets/auto-visualize', requireAuth, async (req, res) => {
  try {
    const currentSession = getUserSession(req.user.id);
    const llmConfig = extractLlmConfig(req);
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
        llm_config: llmConfig,
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
      console.warn('⚠️ Recommendation generation warning:', recErr.response?.data || recErr.message);
      res.json({
        recommendations: [],
        summary: { totalRecommendations: 0 },
        error: recErr.response?.data?.detail || recErr.message || 'Failed to generate recommendations'
      });
    }
  } catch (err) {
    console.error('❌ Auto-visualize error:', err.message);
    res.json({
      recommendations: [],
      summary: { totalRecommendations: 0 },
      error: err.message || 'Auto-visualization failed'
    });
  }
});

// ─── POST /api/datasets/auto-dashboard (protected) ───
app.post('/api/datasets/auto-dashboard', requireAuth, async (req, res) => {
  try {
    const currentSession = getUserSession(req.user.id);
    const llmConfig = extractLlmConfig(req);
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
        llm_config: llmConfig,
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

// ─── Health Check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', python_service: PYTHON_URL });
});

// ─── Serve Static Frontend in Production / Desktop ───
const frontendDist = process.env.FRONTEND_DIST || path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
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
  console.log(`🔐 Auth DB: ${path.join(dataDir, 'auth.db')}\n`);
});
