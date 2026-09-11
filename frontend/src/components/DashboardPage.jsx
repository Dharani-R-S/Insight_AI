import { useState, useEffect } from 'react';
import { 
  Table, 
  Columns, 
  Lightbulb, 
  FolderOpen, 
  ChartBar, 
  ChartLine, 
  ChartPie, 
  DotsNine, 
  GridFour, 
  ArrowRight,
  Trash,
  Clock,
  Printer,
  TrendUp,
  CurrencyDollar,
  ChartDonut,
  Sliders,
  ShareNetwork,
  GitMerge,
  CheckCircle,
  ChatTeardropText,
  DownloadSimple,
  FileCsv,
  FileX,
  FileCode
} from '@phosphor-icons/react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  AreaChart, 
  Area, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip,
  CartesianGrid
} from 'recharts';
import { downloadTransformedDataset } from '../utils/exportUtils';

function getVisualIcon(type) {
  switch (type?.toLowerCase()) {
    case 'bar': return <ChartBar size={16} className="text-[var(--color-text-muted)]" />;
    case 'line': return <ChartLine size={16} className="text-[var(--color-text-muted)]" />;
    case 'pie': return <ChartPie size={16} className="text-[var(--color-text-muted)]" />;
    case 'scatter': return <DotsNine size={16} className="text-[var(--color-text-muted)]" />;
    case 'heatmap': return <GridFour size={16} className="text-[var(--color-text-muted)]" />;
    case 'area': return <ChartLine size={16} className="text-[var(--color-text-muted)]" />;
    default: return <ChartBar size={16} className="text-[var(--color-text-muted)]" />;
  }
}

const STORAGE_KEY = 'saved_visualizations';

function loadSavedVisualizations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedVisualizations(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

const localAuthFetch = async (url, options = {}) => {
  const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
};

// Multi-color desaturated, colorblind-safe palette (Retool/Linear standard)
const CHART_PALETTE = ['#6366f1', '#14b8a6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];

// Clean interactive chart renderer for recommendation cards
function DashboardChartPreview({ rec, sampleRows, colorIndex = 0 }) {
  const chartData = rec?.chartData?.data?.length ? rec.chartData.data : null;
  const type = rec?.type?.toLowerCase() || 'bar';

  const previewData = chartData || (() => {
    if (!sampleRows || sampleRows.length === 0) return [];
    const xAxis = rec?.x_axis || rec?.features?.[0] || Object.keys(sampleRows[0])[0];
    const yAxis = rec?.y_axis || rec?.features?.[1] || Object.keys(sampleRows[0]).find(k => k !== xAxis && typeof sampleRows[0][k] === 'number') || Object.keys(sampleRows[0])[1];
    
    const grouped = {};
    sampleRows.slice(0, 10).forEach(row => {
      const xVal = String(row[xAxis] ?? 'Other').slice(0, 12);
      const yVal = parseFloat(row[yAxis]) || 1;
      grouped[xVal] = (grouped[xVal] || 0) + yVal;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  })();

  if (!previewData || previewData.length === 0) return null;

  const chartColor = CHART_PALETTE[colorIndex % CHART_PALETTE.length];
  const nameKey = previewData[0]?.name !== undefined ? 'name' : (rec.x_axis || 'x');
  const valKey = previewData[0]?.value !== undefined ? 'value' : (rec.y_axis || 'y');

  return (
    <div className="h-44 w-full pt-2">
      <ResponsiveContainer width="100%" height="100%">
        {type === 'line' || type === 'area' ? (
          <AreaChart data={previewData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${rec.id || rec.type}-${colorIndex}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartColor} stopOpacity={0.15}/>
                <stop offset="95%" stopColor={chartColor} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey={nameKey} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={{ stroke: 'var(--color-border)', opacity: 0.5 }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ 
                background: 'var(--color-bg-elevated)', 
                borderColor: 'var(--color-border)', 
                borderRadius: '8px', 
                fontSize: '12px', 
                color: 'var(--color-text-primary)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
              }} 
            />
            <Area type="monotone" dataKey={valKey} stroke={chartColor} strokeWidth={1.5} fillOpacity={1} fill={`url(#grad-${rec.id || rec.type}-${colorIndex})`} />
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Pie data={previewData} dataKey={valKey} nameKey={nameKey} cx="50%" cy="50%" outerRadius={56} innerRadius={32} paddingAngle={2}>
              {previewData.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} stroke="var(--color-bg-card)" strokeWidth={1.5} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ 
                background: 'var(--color-bg-elevated)', 
                borderColor: 'var(--color-border)', 
                borderRadius: '8px', 
                fontSize: '12px', 
                color: 'var(--color-text-primary)' 
              }} 
            />
          </PieChart>
        ) : (
          <BarChart data={previewData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey={nameKey} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={{ stroke: 'var(--color-border)', opacity: 0.5 }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ 
                background: 'var(--color-bg-elevated)', 
                borderColor: 'var(--color-border)', 
                borderRadius: '8px', 
                fontSize: '12px', 
                color: 'var(--color-text-primary)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
              }} 
            />
            <Bar dataKey={valKey} fill={chartColor} radius={[3, 3, 0, 0]} maxBarSize={36} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export default function DashboardPage({ 
  datasetInfo, 
  results, 
  onNavigate, 
  onCreateVisualization, 
  onOpenSavedVisualization,
  recommendations: cachedRecommendations,
  onRecommendationsFetched,
  authFetch
}) {
  const doAuthFetch = authFetch || localAuthFetch;
  const { insights } = results || {};
  const [recommendations, setRecommendations] = useState(cachedRecommendations || null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [savedVisuals, setSavedVisuals] = useState(loadSavedVisualizations());
  const [isExportOpen, setIsExportOpen] = useState(false);

  useEffect(() => {
    if (cachedRecommendations) {
      setRecommendations(cachedRecommendations);
    }
  }, [cachedRecommendations]);

  useEffect(() => {
    if (datasetInfo && datasetInfo.columns?.length > 0 && !cachedRecommendations && (!recommendations || recommendations.length === 0)) {
      fetchRecommendations();
    }
  }, [datasetInfo?.columns?.length, cachedRecommendations]);

  useEffect(() => {
    const handleSavedUpdate = () => setSavedVisuals(loadSavedVisualizations());
    window.addEventListener('saved-visualizations', handleSavedUpdate);
    window.addEventListener('storage', handleSavedUpdate);
    return () => {
      window.removeEventListener('saved-visualizations', handleSavedUpdate);
      window.removeEventListener('storage', handleSavedUpdate);
    };
  }, []);

  const handleDeleteSaved = (id) => {
    const updated = savedVisuals.filter((item) => item.id !== id);
    setSavedVisuals(updated);
    saveSavedVisualizations(updated);
    window.dispatchEvent(new Event('saved-visualizations'));
  };

  const fetchRecommendations = async () => {
    setIsLoadingRecs(true);
    try {
      const res = await doAuthFetch('/api/datasets/auto-visualize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetInfo?.dataset_id,
          columns: datasetInfo?.columns || [],
          schema: datasetInfo?.schema || {},
          sample_rows: datasetInfo?.sample_rows || [],
        }),
      });
      if (!res.ok) {
        setRecommendations([]);
        return;
      }
      const data = await res.json();
      const recs = data.recommendations || [];
      setRecommendations(recs);
      if (onRecommendationsFetched) {
        onRecommendationsFetched(recs);
      }
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
      setRecommendations([]);
    } finally {
      setIsLoadingRecs(false);
    }
  };

  const handleDownload = async (format) => {
    setIsExportOpen(false);
    try {
      await downloadTransformedDataset({
        format,
        authFetch: doAuthFetch,
        rows: datasetInfo?.sample_rows,
        baseName: datasetInfo?.table_name || 'dataset'
      });
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  // Calculate Executive KPIs
  const computeExecutiveKPIs = () => {
    if (!datasetInfo || !datasetInfo.sample_rows || datasetInfo.sample_rows.length === 0) return null;

    const rows = datasetInfo.sample_rows;
    const cols = datasetInfo.columns || [];

    const numericCol = cols.find(c => {
      const name = c.toLowerCase();
      return (name.includes('sales') || name.includes('amount') || name.includes('revenue') || name.includes('price') || name.includes('cost') || name.includes('qty') || name.includes('quantity')) && typeof rows[0][c] === 'number';
    }) || cols.find(c => typeof rows[0][c] === 'number');

    const catCol = cols.find(c => {
      const name = c.toLowerCase();
      return (name.includes('category') || name.includes('region') || name.includes('product') || name.includes('rep') || name.includes('type')) && typeof rows[0][c] === 'string';
    }) || cols.find(c => typeof rows[0][c] === 'string');

    let sumVal = 0;
    let avgVal = 0;
    if (numericCol) {
      const vals = rows.map(r => parseFloat(r[numericCol])).filter(v => !isNaN(v));
      sumVal = vals.reduce((a, b) => a + b, 0);
      avgVal = vals.length ? sumVal / vals.length : 0;
    }

    const uniqueCats = catCol ? new Set(rows.map(r => r[catCol])).size : 0;

    return {
      primary: {
        label: numericCol ? `Total ${numericCol.replace(/_/g, ' ')}` : 'Total Records',
        value: numericCol ? (sumVal > 1000 ? `$${Math.round(sumVal).toLocaleString()}` : sumVal.toLocaleString()) : datasetInfo.row_count?.toLocaleString(),
        desc: `Calculated across ${datasetInfo.row_count?.toLocaleString()} active records`,
        badge: 'Primary Metric'
      },
      secondary: [
        {
          label: numericCol ? `Avg ${numericCol.replace(/_/g, ' ')}` : 'Data Columns',
          value: numericCol ? `$${avgVal.toFixed(2)}` : `${datasetInfo.columns?.length} Cols`,
          icon: TrendUp,
          desc: 'Average metric value per record'
        },
        {
          label: catCol ? `Unique ${catCol.replace(/_/g, ' ')}s` : 'Active Schema',
          value: catCol ? uniqueCats.toLocaleString() : `${datasetInfo.columns?.length} Dimensions`,
          icon: ChartDonut,
          desc: 'Categorical dimension breakdown'
        },
        {
          label: 'Data Completeness',
          value: '100% Parsed',
          icon: CheckCircle,
          statusColor: 'text-emerald-500',
          desc: 'SQLite memory instance ready'
        }
      ]
    };
  };

  const kpis = computeExecutiveKPIs();
  const cleanInsights = (insights || []).filter(ins => !ins.toLowerCase().includes('product_id ranges') && !ins.toLowerCase().includes('id remains'));

  return (
    <div className="flex-1 overflow-auto p-8 bg-[var(--color-bg-primary)]">
      {/* Executive Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-1">
            Executive Overview
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {datasetInfo 
              ? `${datasetInfo.row_count?.toLocaleString()} records across ${datasetInfo.columns?.length} dimensions · In-memory instance active` 
              : 'Upload a dataset to generate visual analytics and metrics'}
          </p>
        </div>

        {datasetInfo && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onNavigate('transform')}
              className="btn-secondary text-xs"
            >
              <GitMerge size={14} className="text-[var(--color-text-muted)]" />
              <span>Transform</span>
            </button>
            <button
              onClick={() => onNavigate('graph')}
              className="btn-secondary text-xs"
            >
              <ShareNetwork size={14} className="text-[var(--color-text-muted)]" />
              <span>Graph</span>
            </button>
            <button
              onClick={() => onNavigate('visualize')}
              className="btn-secondary text-xs"
            >
              <Sliders size={14} className="text-[var(--color-text-muted)]" />
              <span>Visual Builder</span>
            </button>

            {/* Download Transformed Dataset Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsExportOpen(!isExportOpen)}
                className="btn-secondary text-xs flex items-center gap-1.5"
                title="Download dataset in CSV, Excel, or JSON"
              >
                <DownloadSimple size={14} className="text-[var(--color-text-muted)]" />
                <span>Export Data</span>
              </button>
              {isExportOpen && (
                <div className="absolute right-0 mt-1 w-36 card bg-[var(--color-bg-elevated)] border-[var(--color-border)] p-1 z-30 shadow-lg text-xs space-y-0.5 animate-fade-in">
                  <button
                    onClick={() => handleDownload('csv')}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--color-bg-card)] flex items-center gap-2 cursor-pointer"
                  >
                    <FileCsv size={14} className="text-emerald-500" />
                    <span>CSV (.csv)</span>
                  </button>
                  <button
                    onClick={() => handleDownload('xlsx')}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--color-bg-card)] flex items-center gap-2 cursor-pointer"
                  >
                    <FileX size={14} className="text-emerald-500" />
                    <span>Excel (.xlsx)</span>
                  </button>
                  <button
                    onClick={() => handleDownload('json')}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--color-bg-card)] flex items-center gap-2 cursor-pointer"
                  >
                    <FileCode size={14} className="text-amber-500" />
                    <span>JSON (.json)</span>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => window.print()}
              className="btn-primary text-xs no-print"
            >
              <Printer size={14} />
              <span>Export PDF</span>
            </button>
          </div>
        )}
      </div>

      {!datasetInfo ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center h-[50vh] text-center max-w-sm mx-auto space-y-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)]">
            <FolderOpen size={20} />
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">No active dataset</h3>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Drag and drop a CSV, Excel, JSON, TSV, or Parquet file into the sidebar uploader. InsightAI will parse the schema and render automated charts.
          </p>
        </div>
      ) : (
        <div className="space-y-8">

          {/* Metric Hierarchy Strip (Hero Card + 3 Secondary Cards) */}
          {kpis && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Primary Hero Metric Card (takes 2 columns) */}
              <div className="lg:col-span-2 card p-5 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-[var(--color-text-secondary)] capitalize">
                      {kpis.primary.label}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--color-accent)] bg-[var(--color-accent-muted)] px-2 py-0.5 rounded">
                      {kpis.primary.badge}
                    </span>
                  </div>
                  <div className="text-3xl font-semibold text-[var(--color-text-primary)] tracking-tight">
                    {kpis.primary.value}
                  </div>
                </div>
                <div className="pt-3 border-t border-[var(--color-border-soft)] mt-4">
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {kpis.primary.desc}
                  </p>
                </div>
              </div>

              {/* Secondary Metric Cards (1 column each) */}
              {kpis.secondary.map((sec, idx) => {
                const Icon = sec.icon;
                return (
                  <div key={idx} className="card p-4 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-xs font-medium text-[var(--color-text-muted)] capitalize truncate">
                          {sec.label}
                        </span>
                        <Icon size={15} className={sec.statusColor || 'text-[var(--color-text-muted)]'} />
                      </div>
                      <div className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight">
                        {sec.value}
                      </div>
                    </div>
                    <div className="pt-2.5 border-t border-[var(--color-border-soft)] mt-3">
                      <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                        {sec.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Automated Visualizations Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Automated Visual Analytics
                </h3>
              </div>
              <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] px-2.5 py-0.5 rounded">
                {recommendations?.length || 0} charts generated
              </span>
            </div>

            {isLoadingRecs ? (
              <div className="card p-10 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col items-center justify-center gap-2.5">
                <div className="w-5 h-5 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
                <p className="text-xs text-[var(--color-text-secondary)]">Computing chart distributions and heuristics...</p>
              </div>
            ) : recommendations && recommendations.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recommendations.map((rec, idx) => (
                  <div
                    key={rec.id || idx}
                    className="card p-4 bg-[var(--color-bg-card)] border-[var(--color-border)] hover:border-[var(--color-border-hover)] cursor-pointer group transition-all flex flex-col"
                    onClick={() => onCreateVisualization ? onCreateVisualization(rec) : onNavigate('visualize')}
                  >
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-soft)] pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                          {getVisualIcon(rec.type)}
                        </div>
                        <div>
                          <h4 className="font-medium text-[var(--color-text-primary)] text-xs">
                            {rec.title || `${rec.type} Analysis`}
                          </h4>
                          <p className="text-[11px] text-[var(--color-text-muted)]">
                            {rec.type?.toUpperCase()} · {rec.x_axis || 'X'} vs {rec.y_axis || 'Y'}
                          </p>
                        </div>
                      </div>
                      <div className="p-1 text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)] transition-colors">
                        <ArrowRight size={14} />
                      </div>
                    </div>

                    {/* Chart Preview */}
                    <DashboardChartPreview rec={rec} sampleRows={datasetInfo.sample_rows} colorIndex={idx} />

                    {/* Card Footer */}
                    <div className="pt-3 border-t border-[var(--color-border-soft)] mt-auto flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                      <span className="truncate max-w-[80%] text-[11px]">{rec.description || rec.rationale}</span>
                      <span className="text-[11px] text-[var(--color-accent)] group-hover:underline shrink-0">Open Builder →</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Saved Visualizations Section */}
          {savedVisuals.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                  <Clock size={15} className="text-[var(--color-text-muted)]" />
                  <span>Custom Visualizations</span>
                </h3>
                <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] px-2 py-0.5 rounded">
                  {savedVisuals.length} saved
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {savedVisuals.map((viz) => (
                  <div key={viz.id} className="card p-4 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col justify-between">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">
                          {viz.type || 'Custom Chart'}
                        </p>
                        <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {viz.title || 'Custom Visualization'}
                        </h4>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSaved(viz.id);
                        }}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1 rounded hover:bg-[var(--color-danger)]/10 transition-colors cursor-pointer"
                        title="Delete chart"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border-soft)] text-xs">
                      <div className="flex gap-1.5">
                        {viz.x_axis && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] font-mono">X: {viz.x_axis}</span>}
                        {viz.y_axis && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] font-mono">Y: {viz.y_axis}</span>}
                      </div>
                      <button
                        onClick={() => onOpenSavedVisualization && onOpenSavedVisualization(viz)}
                        className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer"
                      >
                        Open Builder →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Insights & Schema Profiler Strip */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Insights */}
            <div className="card p-5 bg-[var(--color-bg-card)] border-[var(--color-border)] space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2.5">
                <h3 className="text-xs font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                  <Lightbulb size={15} className="text-[var(--color-text-muted)]" />
                  <span>Key Insights</span>
                </h3>
                <button onClick={() => onNavigate('insights')} className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer">
                  Full Report →
                </button>
              </div>
              <div className="space-y-2">
                {cleanInsights.length > 0 ? (
                  cleanInsights.slice(0, 4).map((insight, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-soft)]">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mt-1.5 shrink-0" />
                      <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">{insight}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)] py-3 text-center">
                    Ask questions in the Ask AI tab to generate query insights.
                  </p>
                )}
              </div>
            </div>

            {/* Column Dimensions */}
            <div className="card p-5 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2.5 mb-3">
                  <h3 className="text-xs font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                    <Columns size={15} className="text-[var(--color-text-muted)]" />
                    <span>Active Schema Columns</span>
                  </h3>
                  <span className="text-[11px] text-[var(--color-text-muted)]">{datasetInfo.columns?.length} columns</span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {datasetInfo.columns?.map((col) => (
                    <span key={col} className="text-[11px] px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] font-mono border border-[var(--color-border)]">
                      {col}
                    </span>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-[var(--color-border-soft)] flex items-center justify-between mt-3">
                <span className="text-[11px] text-[var(--color-text-muted)]">Profile column distributions</span>
                <button onClick={() => onNavigate('data')} className="btn-secondary text-xs">
                  Browse Data →
                </button>
              </div>
            </div>
          </div>

          {/* Quick Hub Navigation */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { id: 'ask', icon: ChatTeardropText, label: 'Ask AI', desc: 'Query in plain English' },
              { id: 'visualize', icon: ChartBar, label: 'Visual Builder', desc: 'Custom chart composer' },
              { id: 'data', icon: Table, label: 'Data Browser', desc: 'Explore raw tabular records' },
              { id: 'insights', icon: Lightbulb, label: 'Insights Report', desc: 'AI summary & metrics' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className="card p-4 text-left group bg-[var(--color-bg-card)] hover:border-[var(--color-border-hover)] transition-all cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)] mb-2.5 transition-colors">
                    <Icon size={15} />
                  </div>
                  <p className="text-xs font-semibold text-[var(--color-text-primary)] mb-0.5">{item.label}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">{item.desc}</p>
                </button>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}
