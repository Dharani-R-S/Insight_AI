const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execSync } = require('child_process');

let mainWindow = null;
let splashWindow = null;
let pythonProcess = null;
let expressProcess = null;
let isQuitting = false;

const EXPRESS_PORT = process.env.PORT || 5000;
const PYTHON_PORT = process.env.PYTHON_PORT || 8000;

// Setup paths
const isDev = !app.isPackaged && process.argv.includes('--dev');
const rootDir = isDev
  ? path.resolve(__dirname, '..')
  : path.join(process.resourcesPath, 'app');

const userDataPath = path.join(app.getPath('userData'), 'data');
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

const logFilePath = path.join(userDataPath, 'insightai.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(logFilePath, line);
  } catch {}
  console.log(msg);
}

log(`App starting... isPackaged=${app.isPackaged}, isDev=${isDev}, resourcesPath=${process.resourcesPath}`);

// Resolve Resource Directories
function getResourcePath(...subPaths) {
  if (isDev) {
    return path.join(rootDir, ...subPaths);
  }
  // Try extraResources first, then app directory
  const extraPath = path.join(process.resourcesPath, ...subPaths);
  if (fs.existsSync(extraPath)) {
    return extraPath;
  }
  return path.join(process.resourcesPath, 'app', ...subPaths);
}

const serverDir = getResourcePath('server');
const frontendDistPath = getResourcePath('frontend', 'dist');
const pythonExePath = app.isPackaged
  ? path.join(process.resourcesPath, 'python-service', 'python-service.exe')
  : path.join(rootDir, 'python-service', 'dist', 'python-service', 'python-service.exe');

log(`Server directory: ${serverDir}`);
log(`Frontend dist: ${frontendDistPath}`);
log(`Python executable: ${pythonExePath}`);

let serviceLogs = {
  python: [],
  express: [],
};

// ─── Health Check Helper ───
function checkEndpoint(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServices(timeoutMs = 45000) {
  const startTime = Date.now();
  const expressHealthUrl = `http://127.0.0.1:${EXPRESS_PORT}/api/health`;
  const pythonHealthUrl = `http://127.0.0.1:${PYTHON_PORT}/health`;

  log(`Checking services: Express (${expressHealthUrl}), Python (${pythonHealthUrl})`);

  while (Date.now() - startTime < timeoutMs) {
    const [expressOk, pythonOk] = await Promise.all([
      checkEndpoint(expressHealthUrl),
      checkEndpoint(pythonHealthUrl),
    ]);

    if (expressOk && pythonOk) {
      log('Both Express and Python services are healthy!');
      return true;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

// ─── Process Kill Utility ───
function killProcess(proc, name) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /T /F 2>nul`);
    } else {
      proc.kill('SIGKILL');
    }
    log(`Terminated ${name} (PID: ${proc.pid})`);
  } catch (err) {}
}

// ─── Helper to load key-value from .env ───
function loadEnvVariables() {
  const possiblePaths = [
    path.join(rootDir, 'python-service', '.env'),
    path.join(process.resourcesPath, 'python-service', '.env'),
    path.join(process.resourcesPath, '.env'),
    path.join(userDataPath, '.env'),
    path.join(rootDir, '.env')
  ];
  const loaded = {};
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const lines = fs.readFileSync(p, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...vParts] = trimmed.split('=');
            let val = vParts.join('=').trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            loaded[k.trim()] = val;
          }
        }
        log(`Loaded environment configuration from: ${p}`);
        break;
      } catch (e) {}
    }
  }
  return loaded;
}

const customEnv = loadEnvVariables();

// ─── Start Python Service ───
function startPythonService() {
  const pyEnv = {
    ...process.env,
    ...customEnv,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHON_PORT: String(PYTHON_PORT),
    PORT: String(PYTHON_PORT),
    APP_DATA_DIR: userDataPath,
  };

  log(`Python Groq Key set: ${Boolean(pyEnv.GROQ_API_KEY)}`);

  if (fs.existsSync(pythonExePath)) {
    log(`Spawning Python binary: ${pythonExePath}`);
    pythonProcess = spawn(pythonExePath, [], {
      cwd: path.dirname(pythonExePath),
      env: pyEnv,
      windowsHide: true,
    });
  } else {
    const pyScript = path.join(rootDir, 'python-service', 'main.py');
    log(`Spawning python script: ${pyScript}`);
    pythonProcess = spawn('python', [pyScript], {
      cwd: path.join(rootDir, 'python-service'),
      env: pyEnv,
      windowsHide: true,
    });
  }

  pythonProcess.stdout?.on('data', (d) => {
    const line = d.toString().trim();
    serviceLogs.python.push(line);
    if (serviceLogs.python.length > 500) {
      serviceLogs.python.splice(0, serviceLogs.python.length - 500);
    }
    log(`[Python] ${line}`);
  });
  pythonProcess.stderr?.on('data', (d) => {
    const line = d.toString().trim();
    serviceLogs.python.push(line);
    if (serviceLogs.python.length > 500) {
      serviceLogs.python.splice(0, serviceLogs.python.length - 500);
    }
    log(`[Python Err] ${line}`);
  });
  pythonProcess.on('exit', (code) => {
    log(`[Python] Exited with code ${code}`);
  });
}

// ─── Start Express Server ───
function startExpressServer() {
  const expressScript = path.join(serverDir, 'index.js');
  const srvEnv = {
    ...process.env,
    PORT: String(EXPRESS_PORT),
    PYTHON_SERVICE_URL: `http://127.0.0.1:${PYTHON_PORT}`,
    APP_DATA_DIR: userDataPath,
    FRONTEND_DIST: frontendDistPath,
    ELECTRON_RUN_AS_NODE: '1',
  };

  log(`Spawning Express server via Electron Node runtime: ${expressScript}`);

  expressProcess = spawn(process.execPath, [expressScript], {
    cwd: serverDir,
    env: srvEnv,
    windowsHide: true,
  });

  expressProcess.stdout?.on('data', (d) => {
    const line = d.toString().trim();
    serviceLogs.express.push(line);
    if (serviceLogs.express.length > 500) {
      serviceLogs.express.splice(0, serviceLogs.express.length - 500);
    }
    log(`[Express] ${line}`);
  });
  expressProcess.stderr?.on('data', (d) => {
    const line = d.toString().trim();
    serviceLogs.express.push(line);
    if (serviceLogs.express.length > 500) {
      serviceLogs.express.splice(0, serviceLogs.express.length - 500);
    }
    log(`[Express Err] ${line}`);
  });
  expressProcess.on('exit', (code) => {
    log(`[Express] Exited with code ${code}`);
  });
}

// ─── Splash Window ───
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 380,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// ─── Main Window ───
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'InsightAI Studio',
    autoHideMenuBar: true,
    backgroundColor: '#090d16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: isDev,
    },
  });

  if (!isDev) {
    mainWindow.removeMenu();
  }

  const appUrl = `http://127.0.0.1:${EXPRESS_PORT}`;
  log(`Loading App URL: ${appUrl}`);
  mainWindow.loadURL(appUrl);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // Completely lock down DevTools and developer shortcuts in production
  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = (input.key || '').toLowerCase();
      // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U
      if (
        key === 'f12' ||
        (input.control && input.shift && ['i', 'j', 'c'].includes(key)) ||
        (input.control && key === 'u')
      ) {
        event.preventDefault();
      }
    });

    // Disable right-click inspect context menu
    mainWindow.webContents.on('context-menu', (event) => {
      event.preventDefault();
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Lifecycle ───
app.whenReady().then(async () => {
  createSplashWindow();

  startPythonService();
  startExpressServer();

  const ready = await waitForServices(25000);

  if (ready) {
    createMainWindow();
  } else {
    log('Services did not become ready within timeout.');
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }

    const errDetails = [
      'Express Logs:\n' + (serviceLogs.express.slice(-10).join('\n') || 'None'),
      '\nPython Logs:\n' + (serviceLogs.python.slice(-10).join('\n') || 'None'),
      `\nLog file: ${logFilePath}`
    ].join('\n');

    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'InsightAI Studio Notice',
      message: 'Services took longer than expected to start up. Opening window now.',
      detail: errDetails,
    });

    createMainWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

function cleanupProcesses() {
  if (isQuitting) return;
  isQuitting = true;
  log('Cleaning up child processes...');
  killProcess(pythonProcess, 'Python Service');
  killProcess(expressProcess, 'Express Server');
}

app.on('before-quit', cleanupProcesses);
app.on('will-quit', cleanupProcesses);
app.on('window-all-closed', () => {
  cleanupProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
