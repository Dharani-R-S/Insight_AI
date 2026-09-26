import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import Sidebar from './components/Sidebar';
import FileUpload from './components/FileUpload';
import DashboardPage from './components/DashboardPage';
import ChatPanel from './components/ChatPanel';
import ResultsPanel from './components/ResultsPanel';
import VisualBuilder from './components/VisualBuilder';
import DataTable from './components/DataTable';
import InsightsPanel from './components/InsightsPanel';
import StatsPanel from './components/StatsPanel';
import DataCleaningModal from './components/DataCleaningModal';
import KnowledgeGraph from './components/KnowledgeGraph';
import SettingsModal from './components/SettingsModal';
import DataTransformStudio from './components/DataTransformStudio';
import PostUploadTransformModal from './components/PostUploadTransformModal';
import { Broom, DownloadSimple, CaretDown, Sparkle, MagnifyingGlass, X, List } from '@phosphor-icons/react';
import { downloadTransformedDataset } from './utils/exportUtils';

function authFetch(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('ui_theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState('landing'); // 'landing' | 'auth' | 'app'
  const [activePage, setActivePage] = useState('dashboard');
  const [selectedRecommendation, setSelectedRecommendation] = useState(null);
  const [savedDashboard, setSavedDashboard] = useState(null);
  const [isCleanModalOpen, setIsCleanModalOpen] = useState(false);
  const [isDataExportOpen, setIsDataExportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [llmConfig, setLlmConfig] = useState(() => {
    try {
      const stored = localStorage.getItem('ai_settings');
      return stored ? JSON.parse(stored) : { provider: 'groq', model: 'openai/gpt-oss-120b' };
    } catch {
      return { provider: 'groq', model: 'openai/gpt-oss-120b' };
    }
  });

  const [nlFilterInput, setNlFilterInput] = useState('');
  const [nlFilterActive, setNlFilterActive] = useState(null);
  const [nlFilterRows, setNlFilterRows] = useState(null);
  const [isFilteringNL, setIsFilteringNL] = useState(false);

  const [datasetInfo, setDatasetInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showPostUploadModal, setShowPostUploadModal] = useState(false);
  const [fullData, setFullData] = useState(null);

  const handleUpdateActiveDataset = (transformedRows, transformedCols) => {
    if (!transformedRows || transformedRows.length === 0) return;
    setFullData(transformedRows);
    setDatasetInfo((prev) => ({
      ...prev,
      columns: transformedCols || (transformedRows[0] ? Object.keys(transformedRows[0]) : prev?.columns || []),
      row_count: transformedRows.length,
      sample_rows: transformedRows.slice(0, 100),
    }));
    setActivePage('dashboard');
  };
  const [queryHistory, setQueryHistory] = useState(() => {
    try {
      const raw = localStorage.getItem('query_history');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ui_theme', theme);
  }, [theme]);

  // ─── Restore session ───
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) { setAuthChecked(true); return; }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (data.user) { setUser(data.user); setView('app'); }
        else localStorage.removeItem('auth_token');
      })
      .catch(() => localStorage.removeItem('auth_token'))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await authFetch('/api/datasets/current');
        if (!res.ok) return;
        const data = await res.json();
        setDatasetInfo(data);
        setActivePage((prev) => (prev === 'landing' ? 'dashboard' : prev));

        try {
          const tableRes = await authFetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: 'Show all data' }),
          });
          const tableData = await tableRes.json();
          setFullData(tableData.table_result || data.sample_rows);
        } catch {
          setFullData(data.sample_rows || []);
        }
      } catch {
        // Ignore restore errors
      }
    })();
  }, [user]);

  const handleLogin = (userData) => { setUser(userData); setView('app'); };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    setUser(null); setView('landing');
    setDatasetInfo(null); setMessages([]);
    setResults(null); setFullData(null);
    setQueryHistory([]);
    setActivePage('dashboard');
  };

  const handleUploadSuccess = async (data) => {
    setDatasetInfo(data);
    setMessages([{
      role: 'assistant',
      content: `Dataset loaded — ${data.row_count} rows, ${data.columns?.length} columns. Go to Ask AI to start querying!`,
    }]);
    setResults(null);
    setShowPostUploadModal(true);
    setActivePage('dashboard');

    try {
      const res = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Show all data' }),
      });
      const result = await res.json();
      setFullData(result.table_result || data.sample_rows);
    } catch {
      setFullData(data.sample_rows);
    }
  };

  const handleSendMessage = async (question, messageData = {}) => {
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);

    // Persist query to history (deduplicate, cap at 30)
    setQueryHistory((prev) => {
      const next = [
        { question, timestamp: Date.now() },
        ...prev.filter((h) => h.question !== question),
      ].slice(0, 30);
      try { localStorage.setItem('query_history', JSON.stringify(next)); } catch {}
      return next;
    });

    try {
      const res = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, ...messageData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.insights?.length ? data.insights.join(' ') : 'Here are the results.',
        sql: data.sql_query,
      }]);
      setResults(data);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateVisualization = (recommendation) => {
    setSelectedRecommendation(recommendation);
    setActivePage('visualize');
  };

  const handleFilterTableFromGraph = async (col, val, customQuery) => {
    let query = '';
    if (customQuery) {
      query = customQuery;
    } else if (typeof col === 'string' && (!val || col.toLowerCase().startsWith('show '))) {
      query = col;
    } else if (col && val) {
      query = `show records where ${col} is '${val}'`;
    }
    if (!query) return;
    setNlFilterInput(query);
    setActivePage('data');
    setIsFilteringNL(true);
    try {
      const res = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });
      const data = await res.json();
      if (res.ok && data.table_result) {
        setNlFilterRows(data.table_result);
        setNlFilterActive(query);
      }
    } catch (err) {
      console.error('Graph filter error:', err);
    } finally {
      setIsFilteringNL(false);
    }
  };

  const handleNLFilterSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!nlFilterInput.trim() || isFilteringNL) return;
    setIsFilteringNL(true);
    try {
      const res = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: nlFilterInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.table_result) {
        setNlFilterRows(data.table_result);
        setNlFilterActive(nlFilterInput.trim());
      } else {
        alert(data.error || 'Failed to retrieve data for filter');
      }
    } catch (err) {
      console.error('NL Filter error:', err);
    } finally {
      setIsFilteringNL(false);
    }
  };

  const handleResetNLFilter = () => {
    setNlFilterRows(null);
    setNlFilterActive(null);
    setNlFilterInput('');
  };

  const handleOpenSavedVisualization = (saved) => {
    if (!saved) return;
    if (saved.type === 'dashboard') {
      setSavedDashboard(saved);
      setSelectedRecommendation(null);
      setActivePage('visualize');
      return;
    }
    setSavedDashboard(null);
    setSelectedRecommendation({
      type: saved.type,
      title: saved.title,
      x_axis: saved.x_axis || saved.x_col,
      y_axis: saved.y_axis,
      y_cols: saved.y_cols || [],
    });
    setActivePage('visualize');
  };

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  if (!authChecked) return null;
  if (view === 'landing') return (
    <LandingPage onGetStarted={() => setView('auth')} theme={theme} onToggleTheme={handleToggleTheme} />
  );
  if (view === 'auth') return (
    <AuthPage onLogin={handleLogin} onBack={() => setView('landing')} theme={theme} onToggleTheme={handleToggleTheme} />
  );

  // ─── Main App ───
  const { sql_query, table_result, stats, insights, prediction } = results || {};

  const handleDataExport = async (format) => {
    setIsDataExportOpen(false);
    try {
      await downloadTransformedDataset({
        format,
        authFetch,
        rows: nlFilterRows?.length ? nlFilterRows : (table_result?.length ? table_result : (fullData?.length ? fullData : datasetInfo?.sample_rows)),
        baseName: datasetInfo?.table_name || 'dataset'
      });
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <DashboardPage
            datasetInfo={datasetInfo}
            results={results}
            onNavigate={setActivePage}
            onCreateVisualization={handleCreateVisualization}
            onOpenSavedVisualization={handleOpenSavedVisualization}
            authFetch={authFetch}
          />
        );

      case 'ask':
        return (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Chat column */}
            <div className="w-[380px] shrink-0 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-secondary)]">
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Ask AI</h2>
                <p className="text-[10px] text-[var(--color-text-muted)]">Query your data in plain English</p>
              </div>
              <div className="flex-1 min-h-0">
                <ChatPanel
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  isLoading={isLoading}
                  hasDataset={!!datasetInfo}
                  datasetInfo={datasetInfo}
                  authFetch={authFetch}
                  queryHistory={queryHistory}
                  onClearHistory={() => {
                    setQueryHistory([]);
                    try { localStorage.removeItem('query_history'); } catch {}
                  }}
                />
              </div>
            </div>
            {/* Results column */}
            <div className="flex-1 min-w-0 bg-[var(--color-bg-primary)] flex flex-col">
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Results</h2>
                <p className="text-[10px] text-[var(--color-text-muted)]">Charts, tables and insights</p>
              </div>
              <div className="flex-1 min-h-0">
                <ResultsPanel
                  results={results}
                  columns={datasetInfo?.columns || []}
                  fullData={fullData}
                  datasetInfo={datasetInfo}
                  onExecuteQuery={(query) => {
                    setActivePage('ask');
                    handleSendMessage(query, { question: query, mode: 'analyze' });
                  }}
                  onFilterTable={handleFilterTableFromGraph}
                  onNavigateTab={(tab) => setActivePage(tab)}
                />
              </div>
            </div>
          </div>
        );

      case 'visualize':
        return (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Visual Builder</h2>
              <p className="text-[10px] text-[var(--color-text-muted)]">Drag columns to build custom charts</p>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {datasetInfo
                ? (
                  <VisualBuilder
                    columns={datasetInfo.columns}
                    tableData={fullData}
                    datasetInfo={datasetInfo}
                    selectedRecommendation={selectedRecommendation}
                    savedDashboard={savedDashboard}
                    clearSavedDashboard={() => setSavedDashboard(null)}
                  />
                )
                : <EmptyPage icon="📊" title="No dataset" desc="Upload a CSV to build visualizations." />}
            </div>
          </div>
        );

      case 'transform':
        return (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {datasetInfo ? (
              <DataTransformStudio
                primaryData={fullData || datasetInfo?.sample_rows}
                datasetInfo={datasetInfo}
                onUpdateActiveDataset={handleUpdateActiveDataset}
                authFetch={authFetch}
              />
            ) : (
              <EmptyPage icon="🔀" title="No dataset" desc="Upload a dataset to open the Data Transformation Studio." />
            )}
          </div>
        );

      case 'graph':
        return (
          <div className="flex-1 min-h-0 p-4 flex">
            {datasetInfo ? (
              <KnowledgeGraph
                tableData={table_result?.length ? table_result : fullData}
                datasetInfo={datasetInfo}
                columns={datasetInfo.columns}
                onExecuteQuery={(query) => {
                  setActivePage('ask');
                  handleSendMessage(query, { question: query, mode: 'analyze' });
                }}
                onFilterTable={handleFilterTableFromGraph}
                onNavigateTab={(tab) => setActivePage(tab)}
              />
            ) : (
              <EmptyPage icon="🌐" title="No dataset" desc="Upload a dataset to explore the Knowledge Graph." />
            )}
          </div>
        );

      case 'data':
        return (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Data Browser</h2>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  {nlFilterActive
                    ? `Showing ${nlFilterRows?.length ?? 0} results matching "${nlFilterActive}"`
                    : table_result?.length
                      ? `Showing ${table_result.length} query results`
                      : fullData?.length
                        ? `${fullData.length.toLocaleString()} rows loaded — click any column header to profile it`
                        : 'No data'}
                </p>
              </div>
              {datasetInfo && (
                <div className="flex items-center gap-2 relative">
                  <div className="relative">
                    <button
                      onClick={() => setIsDataExportOpen((prev) => !prev)}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                      title="Export dataset"
                    >
                      <DownloadSimple size={14} className="text-[var(--color-accent)]" />
                      <span>Export Data</span>
                      <CaretDown size={11} className="text-[var(--color-text-muted)]" />
                    </button>
                    {isDataExportOpen && (
                      <div className="absolute right-0 mt-1.5 w-44 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-md shadow-xl z-50 py-1 text-xs">
                        <button
                          onClick={() => handleDataExport('csv')}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--color-bg-hover)] flex items-center justify-between text-[var(--color-text-primary)]"
                        >
                          <span>CSV (.csv)</span>
                          <span className="text-[10px] text-[var(--color-text-muted)] font-mono">Plain</span>
                        </button>
                        <button
                          onClick={() => handleDataExport('excel')}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--color-bg-hover)] flex items-center justify-between text-[var(--color-text-primary)]"
                        >
                          <span>Excel (.xlsx)</span>
                          <span className="text-[10px] text-emerald-500 font-mono font-medium">Sheet</span>
                        </button>
                        <button
                          onClick={() => handleDataExport('json')}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--color-bg-hover)] flex items-center justify-between text-[var(--color-text-primary)]"
                        >
                          <span>JSON (.json)</span>
                          <span className="text-[10px] text-[var(--color-text-muted)] font-mono">Raw</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setIsCleanModalOpen(true)}
                    className="btn-secondary px-3.5 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Broom size={14} className="text-[var(--color-accent)]" />
                    <span>Clean Dataset</span>
                  </button>
                </div>
              )}
            </div>

            {/* Natural Language Search / Retrieval Bar */}
            {datasetInfo && (
              <div className="px-6 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] flex flex-col md:flex-row items-center gap-3 justify-between">
                <form onSubmit={handleNLFilterSubmit} className="flex-1 flex items-center gap-2 w-full">
                  <div className="flex-1 flex items-center gap-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 focus-within:border-[var(--color-accent)] transition-all">
                    <Sparkle size={15} className="text-[var(--color-accent)] shrink-0" />
                    <input
                      type="text"
                      value={nlFilterInput}
                      onChange={(e) => setNlFilterInput(e.target.value)}
                      placeholder="Search data with natural language (e.g. 'show records where strike > 21500' or 'top 10 by volume')..."
                      className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none font-medium"
                      disabled={isFilteringNL}
                    />
                    {(nlFilterInput || nlFilterActive) && (
                      <button
                        type="button"
                        onClick={handleResetNLFilter}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-0.5 cursor-pointer"
                        title="Clear filter"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!nlFilterInput.trim() || isFilteringNL}
                    className="btn-primary px-3.5 py-1.5 text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shadow-sm"
                  >
                    {isFilteringNL ? (
                      <span>Searching...</span>
                    ) : (
                      <>
                        <MagnifyingGlass size={13} weight="bold" />
                        <span>Search with AI</span>
                      </>
                    )}
                  </button>
                </form>

                {nlFilterActive && (
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 text-xs text-[var(--color-accent)] font-medium shrink-0">
                    <span className="truncate max-w-xs">Filter: "{nlFilterActive}" ({nlFilterRows?.length ?? 0} rows)</span>
                    <button 
                      onClick={handleResetNLFilter} 
                      className="text-[10px] font-bold underline hover:text-[var(--color-text-primary)] cursor-pointer ml-1"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-hidden p-4 flex">
              {(nlFilterRows || table_result?.length || fullData?.length) ? (
                <DataTable data={nlFilterRows ? nlFilterRows : (table_result?.length ? table_result : fullData)} />
              ) : (
                <EmptyPage icon="📋" title="No data" desc="Upload a CSV or run a query." />
              )}
            </div>

            <DataCleaningModal
              isOpen={isCleanModalOpen}
              onClose={() => setIsCleanModalOpen(false)}
              authFetch={authFetch}
              onCleanSuccess={async (cleanedData) => {
                setDatasetInfo((prev) => ({
                  ...prev,
                  columns: cleanedData.columns,
                  row_count: cleanedData.row_count,
                  sample_rows: cleanedData.sample_rows,
                  schema: cleanedData.schema,
                }));

                try {
                  const tableRes = await authFetch('/api/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: 'Show all data' }),
                  });
                  const result = await tableRes.json();
                  setFullData(result.table_result || cleanedData.sample_rows);
                } catch {
                  setFullData(cleanedData.sample_rows);
                }
              }}
            />
          </div>
        );

      case 'insights':
        return (
          <div className="flex-1 overflow-auto p-6 bg-[var(--color-bg-primary)]">
            <div className="mb-5">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Insights & Statistics</h2>
              <p className="text-[10px] text-[var(--color-text-muted)]">AI-generated analysis of your last query</p>
            </div>
            {stats && Object.keys(stats).length > 0 && (
              <div className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">Statistics</p>
                <StatsPanel stats={stats} />
              </div>
            )}
            {(insights?.length > 0 || prediction) && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">AI Insights</p>
                <InsightsPanel insights={insights} prediction={prediction} />
              </div>
            )}
            {!stats && !insights?.length && !prediction && (
              <EmptyPage icon="💡" title="No insights yet" desc="Run a query in Ask AI to generate insights." />
            )}
          </div>
        );

      case 'sql':
        return (
          <div className="flex-1 overflow-auto p-6 bg-[var(--color-bg-primary)]">
            <div className="mb-5">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">SQL Query</h2>
              <p className="text-[10px] text-[var(--color-text-muted)]">The SQL generated from your last natural language question</p>
            </div>
            {sql_query ? (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-accent)]">Generated SQL</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{table_result?.length ?? 0} rows returned</span>
                </div>
                <pre className="text-sm font-mono text-[var(--color-accent)] whitespace-pre-wrap leading-relaxed bg-[var(--color-bg-primary)] rounded-lg p-4 border border-[var(--color-border)] overflow-x-auto">
                  {sql_query}
                </pre>
              </div>
            ) : (
              <EmptyPage icon="🔍" title="No query yet" desc="Ask a question in the Ask AI page to see the generated SQL." />
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-[var(--color-bg-primary)] overflow-hidden relative">
      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div 
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-xs"
        />
      )}

      {/* Sidebar Drawer Container (Responsive) */}
      <div className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 md:static md:translate-x-0 ${
        isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
      }`}>
        <Sidebar
          activePage={activePage}
          onNavigate={(page) => {
            setActivePage(page);
            setIsMobileMenuOpen(false);
          }}
          datasetInfo={datasetInfo}
          user={user}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={() => {
            setIsSettingsOpen(true);
            setIsMobileMenuOpen(false);
          }}
          llmConfig={llmConfig}
        >
          <FileUpload
            onUploadSuccess={(data) => {
              handleUploadSuccess(data);
              setIsMobileMenuOpen(false);
            }}
            isUploading={isUploading}
            setIsUploading={setIsUploading}
            authFetch={authFetch}
          />
        </Sidebar>
      </div>

      {/* Page content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden w-full">
        {/* Mobile Header Bar */}
        <div className="md:hidden flex items-center justify-between px-3.5 py-2.5 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-md hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              <List size={18} />
            </button>
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">InsightAI</span>
          </div>
          <span className="text-[11px] text-[var(--color-text-muted)] font-medium capitalize">
            {activePage === 'transform' ? 'Transformations' : activePage}
          </span>
        </div>

        {renderPage()}
      </main>

      {/* Post-Upload Transform Modal */}
      {showPostUploadModal && (
        <PostUploadTransformModal
          datasetInfo={datasetInfo}
          onTransformClick={() => {
            setShowPostUploadModal(false);
            setActivePage('transform');
          }}
          onDashboardClick={() => {
            setShowPostUploadModal(false);
            setActivePage('dashboard');
          }}
        />
      )}

      {/* Global Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        authFetch={authFetch}
        user={user}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onSettingsSaved={(cfg) => setLlmConfig(cfg)}
      />
    </div>
  );
}

function EmptyPage({ icon, title, desc }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <span className="text-4xl mb-3 block">{icon}</span>
      <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">{title}</h3>
      <p className="text-xs text-[var(--color-text-muted)] max-w-xs">{desc}</p>
    </div>
  );
}
