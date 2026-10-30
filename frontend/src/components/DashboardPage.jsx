import { useState, useEffect } from 'react';
import { 
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
  ChartDonut,
  Sliders,
  ShareNetwork,
  GitMerge,
  CheckCircle,
  DownloadSimple,
  FileCsv,
  FileX,
  FileCode,
  Broom,
  ArrowCounterClockwise,
  ShieldCheck,
  WarningCircle,
  Globe,
  Star
} from '@phosphor-icons/react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  AreaChart, 
  Area, 
  LineChart,
  Line,
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid,
  Legend,
  ScatterChart,
  Scatter
} from 'recharts';
import { downloadTransformedDataset } from '../utils/exportUtils';

function getVisualIcon(type) {
  switch (type?.toLowerCase()) {
    case 'bar': return <ChartBar size={15} className="text-[var(--color-accent)]" />;
    case 'line': return <ChartLine size={15} className="text-emerald-500" />;
    case 'area': return <ChartLine size={15} className="text-indigo-500" />;
    case 'pie': return <ChartPie size={15} className="text-amber-500" />;
    case 'scatter': return <DotsNine size={15} className="text-rose-500" />;
    case 'heatmap': return <GridFour size={15} className="text-cyan-500" />;
    default: return <ChartBar size={15} className="text-[var(--color-accent)]" />;
  }
}

function getKpiIcon(iconName) {
  switch (iconName) {
    case 'pie': return ChartDonut;
    case 'globe': return Globe;
    case 'clock': return Clock;
    case 'star': return Star;
    case 'check': return CheckCircle;
    case 'trend': return TrendUp;
    default: return TrendUp;
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

// Refined, colorblind-safe modern palette
const CHART_PALETTE = [
  '#6366f1', '#14b8a6', '#f59e0b', '#8b5cf6', '#06b6d4', 
  '#ec4899', '#3b82f6', '#10b981', '#f97316', '#64748b'
];

function formatNumber(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return val;
  const num = Number(val);
  if (Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toLocaleString();
}

function truncateLabel(label, maxLen = 14) {
  if (label === null || label === undefined) return '';
  const str = String(label);
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

// Clean interactive chart renderer for dashboard cards
function DashboardChartPreview({ chart, colorIndex = 0 }) {
  const type = chart?.type?.toLowerCase() || 'bar';
  const data = chart?.data || [];

  if (!data || data.length === 0) {
    return (
      <div className="h-48 w-full flex items-center justify-center text-xs text-[var(--color-text-muted)] italic">
        No aggregated data points available
      </div>
    );
  }

  const primaryColor = CHART_PALETTE[colorIndex % CHART_PALETTE.length];
  const tooltipStyle = {
    contentStyle: { 
      background: 'var(--color-bg-elevated)', 
      borderColor: 'var(--color-border)', 
      borderRadius: '8px', 
      fontSize: '11px', 
      color: 'var(--color-text-primary)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
    }
  };

  const xAxisKey = chart.x_axis || 'name';
  const yAxisKey = chart.y_axis || 'value';

  const formatAxisLabel = (val) => {
    const s = String(val ?? '');
    return s.length > 14 ? `${s.slice(0, 12)}...` : s;
  };

  return (
    <div className="h-52 w-full pt-2">
      <ResponsiveContainer width="100%" height="100%">
        {type === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 20 }}>
            <defs>
              <linearGradient id={`grad-area-${chart.id || colorIndex}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={primaryColor} stopOpacity={0.25}/>
                <stop offset="95%" stopColor={primaryColor} stopOpacity={0.0}/>
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis 
              dataKey={xAxisKey} 
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={{ stroke: 'var(--color-border)', opacity: 0.5 }} 
              tickLine={false}
              tickFormatter={(v) => truncateLabel(v, 10)}
            />
            <YAxis 
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={false} 
              tickLine={false}
              tickFormatter={formatNumber}
            />
            <Tooltip 
              {...tooltipStyle}
              formatter={(val, name) => [formatNumber(val), chart.y_axis || name]}
              labelFormatter={(lbl) => `Period / Year: ${lbl}`}
            />
            <Area 
              type="monotone" 
              dataKey={yAxisKey} 
              stroke={primaryColor} 
              strokeWidth={2} 
              fillOpacity={1} 
              fill={`url(#grad-area-${chart.id || colorIndex})`} 
            />
          </AreaChart>
        ) : type === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 20 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis 
              dataKey={xAxisKey} 
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={{ stroke: 'var(--color-border)', opacity: 0.5 }} 
              tickLine={false}
              tickFormatter={(v) => truncateLabel(v, 10)}
            />
            <YAxis 
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={false} 
              tickLine={false}
              tickFormatter={formatNumber}
            />
            <Tooltip 
              {...tooltipStyle}
              formatter={(val, name) => [formatNumber(val), chart.y_axis || name]}
            />
            <Line 
              type="monotone" 
              dataKey={yAxisKey} 
              stroke={primaryColor} 
              strokeWidth={2} 
              dot={{ r: 2.5, fill: primaryColor }} 
            />
          </LineChart>
        ) : type === 'pie' ? (
          <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Pie 
              data={data} 
              dataKey={yAxisKey} 
              nameKey={xAxisKey} 
              cx="50%" 
              cy="50%" 
              outerRadius={68} 
              innerRadius={38} 
              paddingAngle={3}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} stroke="var(--color-bg-card)" strokeWidth={1.5} />
              ))}
            </Pie>
            <Tooltip 
              {...tooltipStyle}
              formatter={(val, name, entry) => [
                entry.payload.formatted || formatNumber(val), 
                name
              ]}
            />
            <Legend 
              verticalAlign="bottom" 
              height={28}
              iconSize={8}
              formatter={(val) => <span className="text-[10px] text-[var(--color-text-secondary)]">{truncateLabel(val, 16)}</span>}
            />
          </PieChart>
        ) : type === 'scatter' ? (
          <ScatterChart margin={{ top: 8, right: 12, left: -16, bottom: 15 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis 
              dataKey={xAxisKey} 
              name={xAxisKey}
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={{ stroke: 'var(--color-border)', opacity: 0.5 }} 
              tickLine={false}
              tickFormatter={formatNumber}
            />
            <YAxis 
              dataKey={yAxisKey} 
              name={yAxisKey}
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={false} 
              tickLine={false}
              tickFormatter={formatNumber}
            />
            <Tooltip 
              {...tooltipStyle}
              formatter={(val, name) => [formatNumber(val), name]}
            />
            <Scatter data={data} fill={primaryColor} opacity={0.7} />
          </ScatterChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 25 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis 
              dataKey={xAxisKey} 
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={{ stroke: 'var(--color-border)', opacity: 0.5 }} 
              tickLine={false} 
              tickFormatter={(v) => truncateLabel(v, 12)}
              angle={-20}
              textAnchor="end"
              height={35}
            />
            <YAxis 
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} 
              axisLine={false} 
              tickLine={false}
              tickFormatter={formatNumber}
            />
            <Tooltip 
              {...tooltipStyle}
              formatter={(val, name, entry) => [
                entry.payload.formatted || formatNumber(val), 
                chart.y_axis || name
              ]}
              labelFormatter={(lbl) => `Category: ${lbl}`}
            />
            <Bar dataKey={yAxisKey} fill={primaryColor} radius={[4, 4, 0, 0]} maxBarSize={34}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE[(i + colorIndex) % CHART_PALETTE.length]} />
              ))}
            </Bar>
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
  onOpenCleanModal,
  onRevertOriginal,
  authFetch
}) {
  const doAuthFetch = authFetch || localAuthFetch;
  const [dashboardData, setDashboardData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savedVisuals, setSavedVisuals] = useState(loadSavedVisualizations());
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isReverting, setIsReverting] = useState(false);

  useEffect(() => {
    if (datasetInfo && datasetInfo.columns?.length > 0) {
      fetchDashboard();
    }
  }, [datasetInfo?.table_name, datasetInfo?.columns?.length, datasetInfo?.row_count]);

  useEffect(() => {
    const handleSavedUpdate = () => setSavedVisuals(loadSavedVisualizations());
    window.addEventListener('saved-visualizations', handleSavedUpdate);
    window.addEventListener('storage', handleSavedUpdate);
    return () => {
      window.removeEventListener('saved-visualizations', handleSavedUpdate);
      window.removeEventListener('storage', handleSavedUpdate);
    };
  }, []);

  const fetchDashboard = async () => {
    setIsLoading(true);
    try {
      const res = await doAuthFetch('/api/datasets/auto-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: datasetInfo?.columns || [],
          schema: datasetInfo?.schema || {},
          sample_rows: (datasetInfo?.sample_rows || []).slice(0, 500),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } catch (err) {
      console.error('Failed to load auto-dashboard:', err);
    } finally {
      setIsLoading(false);
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

  const handleDeleteSaved = (id) => {
    const updated = savedVisuals.filter((item) => item.id !== id);
    setSavedVisuals(updated);
    saveSavedVisualizations(updated);
    window.dispatchEvent(new Event('saved-visualizations'));
  };

// Calculate Executive KPIs
  const computeExecutiveKPIs = () => {
    if (!datasetInfo) return null;

    const stats = datasetInfo.summary_stats;
    const rows = datasetInfo.sample_rows || [];
    const cols = datasetInfo.columns || [];

    const formatVal = (val, isCurr, isPct) => {
      if (typeof val !== 'number' || isNaN(val)) return '0';
      if (isPct) {
        return `${val.toFixed(1)}%`;
      }
      if (isCurr) {
        if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
        if (val >= 1000) return `$${Math.round(val).toLocaleString()}`;
        return `$${val.toFixed(2)}`;
      } else {
        if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
        return Math.round(val).toLocaleString();
      }
    };

    const pluralizeCat = (catName) => {
      if (!catName) return 'Categories';
      const clean = catName.replace(/_/g, ' ').trim();
      if (clean.toLowerCase().endsWith('y')) {
        return clean.slice(0, -1) + 'ies';
      }
      if (clean.toLowerCase().endsWith('s')) {
        return clean;
      }
      return clean + 's';
    };

    if (stats && stats.primary_metric) {
      const pm = stats.primary_metric;
      const catEntries = Object.entries(stats.categorical_counts || {});
      const topCat = catEntries.length > 0 ? catEntries[0] : null;

      const completenessNum = typeof stats.completeness_pct === 'number' ? stats.completeness_pct : 100;
      const completenessVal = `${completenessNum}% Parsed`;
      const completenessColor = completenessNum >= 95 ? 'text-emerald-500' : (completenessNum >= 80 ? 'text-amber-500' : 'text-rose-500');

      return {
        primary: {
          label: `Total ${pm.label}`,
          value: formatVal(pm.total, pm.is_currency, pm.is_percentage),
          desc: `Calculated across ${stats.row_count?.toLocaleString()} active records`,
          badge: 'Primary Metric'
        },
        secondary: [
          {
            label: `Avg ${pm.label}`,
            value: formatVal(pm.avg, pm.is_currency, pm.is_percentage),
            icon: TrendUp,
            desc: 'Average metric value per record'
          },
          {
            label: topCat ? `Unique ${pluralizeCat(topCat[0])}` : 'Active Schema',
            value: topCat ? topCat[1].toLocaleString() : `${cols.length} Dimensions`,
            icon: ChartDonut,
            desc: 'Categorical dimension breakdown'
          },
          {
            label: 'Data Completeness',
            value: completenessVal,
            icon: CheckCircle,
            statusColor: completenessColor,
            desc: stats.non_null_cells ? `${stats.non_null_cells.toLocaleString()} non-null cells verified` : 'Full dataset verified'
          }
        ]
      };
    }

    // Fallback if summary_stats is not provided
    const pctKeywords = ['pct', 'percent', 'percentage', 'rate', 'ratio', 'margin', 'growth'];
    const currKeywords = ['sales', 'revenue', 'profit', 'amount', 'price', 'cost'];

    const numericCol = cols.find(c => {
      const name = c.toLowerCase();
      return currKeywords.some(k => name.includes(k)) && rows.length > 0 && typeof rows[0][c] === 'number';
    }) || cols.find(c => {
      const name = c.toLowerCase();
      return (name.includes('qty') || name.includes('quantity')) && rows.length > 0 && typeof rows[0][c] === 'number';
    }) || cols.find(c => rows.length > 0 && typeof rows[0][c] === 'number');

    const catCol = cols.find(c => {
      const name = c.toLowerCase();
      return (name.includes('category') || name.includes('region') || name.includes('product') || name.includes('rep') || name.includes('type')) && rows.length > 0 && typeof rows[0][c] === 'string';
    }) || cols.find(c => rows.length > 0 && typeof rows[0][c] === 'string');

    let sumVal = 0;
    let avgVal = 0;
    if (numericCol) {
      const vals = rows.map(r => parseFloat(r[numericCol])).filter(v => !isNaN(v));
      sumVal = vals.reduce((a, b) => a + b, 0);
      avgVal = vals.length ? sumVal / vals.length : 0;
    }

    const uniqueCats = catCol ? new Set(rows.map(r => r[catCol])).size : 0;
    const nLower = numericCol ? numericCol.toLowerCase() : '';
    const isPercentage = Boolean(numericCol && pctKeywords.some(k => nLower.includes(k)));
    const isCurrency = Boolean(numericCol && !isPercentage && currKeywords.some(k => nLower.includes(k)));

    // Calculate completeness from sample rows
    let nonNullCount = 0;
    const totalSampleCells = rows.length * cols.length;
    if (totalSampleCells > 0) {
      rows.forEach(r => {
        cols.forEach(c => {
          const val = r[c];
          if (val !== null && val !== undefined && val !== '') nonNullCount++;
        });
      });
    }
    const fallbackCompletenessNum = totalSampleCells > 0 ? parseFloat(((nonNullCount / totalSampleCells) * 100).toFixed(1)) : 100;
    const fallbackCompletenessVal = `${fallbackCompletenessNum}% Parsed`;
    const fallbackCompletenessColor = fallbackCompletenessNum >= 95 ? 'text-emerald-500' : (fallbackCompletenessNum >= 80 ? 'text-amber-500' : 'text-rose-500');

    return {
      primary: {
        label: numericCol ? `Total ${numericCol.replace(/_/g, ' ')}` : 'Total Records',
        value: numericCol ? formatVal(sumVal, isCurrency, isPercentage) : (datasetInfo.row_count?.toLocaleString() || '0'),
        desc: `Calculated across ${datasetInfo.row_count?.toLocaleString()} active records`,
        badge: 'Primary Metric'
      },
      secondary: [
        {
          label: numericCol ? `Avg ${numericCol.replace(/_/g, ' ')}` : 'Data Columns',
          value: numericCol ? formatVal(avgVal, isCurrency, isPercentage) : `${cols.length} Cols`,
          icon: TrendUp,
          desc: 'Average metric value per record'
        },
        {
          label: catCol ? `Unique ${pluralizeCat(catCol)}` : 'Active Schema',
          value: catCol ? uniqueCats.toLocaleString() : `${cols.length} Dimensions`,
          icon: ChartDonut,
          desc: 'Categorical dimension breakdown'
        },
        {
          label: 'Data Completeness',
          value: fallbackCompletenessVal,
          icon: CheckCircle,
          statusColor: fallbackCompletenessColor,
          desc: `${nonNullCount.toLocaleString()} non-null sample cells verified`
        }
      ]
    };
  };

  const handleRevert = async () => {
    if (!window.confirm('Are you sure you want to revert to the original unmodified dataset? All cleaning actions will be reset.')) return;
    setIsReverting(true);
    try {
      if (onRevertOriginal) {
        await onRevertOriginal();
      } else {
        await doAuthFetch('/api/datasets/revert-original', { method: 'POST' });
        window.location.reload();
      }
    } catch (err) {
      console.error('Revert error:', err);
    } finally {
      setIsReverting(false);
    }
  };

  const kpis = dashboardData?.kpis;
  const charts = dashboardData?.charts || [];
  const isCleaned = datasetInfo?.is_cleaned;

  return (
    <div className="flex-1 overflow-auto p-6 md:p-8 bg-[var(--color-bg-primary)]">
      {/* Executive Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] tracking-tight">
              Executive Analytics Dashboard
            </h2>
            {datasetInfo && (
              <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                isCleaned 
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/25' 
                  : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
              }`}>
                {isCleaned ? <ShieldCheck size={12} weight="bold" /> : <WarningCircle size={12} />}
                <span>{isCleaned ? 'Cleaned Dataset Active' : 'Raw Dataset'}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] font-medium">
            {datasetInfo 
              ? `${datasetInfo.row_count?.toLocaleString()} records across ${datasetInfo.columns?.length} dimensions · Auto-profiled` 
              : 'Upload a dataset to generate visual analytics and metrics'}
          </p>
        </div>

        {datasetInfo && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Clean Data Action Button */}
            <button
              onClick={onOpenCleanModal}
              className="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer hover:border-[var(--color-accent)]"
              title="Inspect dataset quality, missing values, and anomalies"
            >
              <Broom size={14} className="text-[var(--color-accent)]" />
              <span>{isCleaned ? 'Re-Clean Data' : 'Clean & Fix Noise'}</span>
            </button>

            {/* Revert Original Button if cleaned */}
            {isCleaned && (
              <button
                onClick={handleRevert}
                disabled={isReverting}
                className="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer text-amber-500 hover:border-amber-500"
                title="Restore original uploaded dataset"
              >
                <ArrowCounterClockwise size={13} className={isReverting ? 'animate-spin' : ''} />
                <span>Revert to Raw</span>
              </button>
            )}

            <button
              onClick={() => onNavigate('ask')}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <span>Ask AI</span>
            </button>

            <button
              onClick={() => onNavigate('transform')}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <GitMerge size={14} className="text-[var(--color-text-muted)]" />
              <span>Transform</span>
            </button>

            <button
              onClick={() => onNavigate('visualize')}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <Sliders size={14} className="text-[var(--color-text-muted)]" />
              <span>Visual Builder</span>
            </button>

            {/* Export Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsExportOpen(!isExportOpen)}
                className="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
                title="Download dataset"
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
              className="btn-primary text-xs no-print cursor-pointer shadow-sm flex items-center gap-1.5"
            >
              <Printer size={14} />
              <span>Print PDF</span>
            </button>
          </div>
        )}
      </div>

      {!datasetInfo ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center h-[50vh] text-center max-w-sm mx-auto space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)]">
            <FolderOpen size={24} />
          </div>
          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">No active dataset</h3>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Drag and drop a CSV, Excel (.xlsx), or JSON file into the sidebar uploader. InsightAI will profile its schema and render an adaptive executive dashboard.
          </p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Dynamic Metric Hierarchy Strip (Hero Card + 3 Secondary Cards) */}
          {kpis && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3.5">
              {/* Primary Hero Metric Card (takes 2 columns) */}
              <div className="lg:col-span-2 card p-5 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      {kpis.primary?.label || 'Total Records'}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--color-accent)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-2 py-0.5 rounded-full">
                      {kpis.primary?.badge || 'Core Metric'}
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-[var(--color-text-primary)] tracking-tight">
                    {kpis.primary?.value || datasetInfo.row_count?.toLocaleString()}
                  </div>
                </div>
                <div className="pt-3 border-t border-[var(--color-border-soft)] mt-3">
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {kpis.primary?.desc}
                  </p>
                </div>
              </div>

              {/* Secondary Metric Cards (1 column each) */}
              {(kpis.secondary || []).map((sec, idx) => {
                const IconComponent = getKpiIcon(sec.icon);
                return (
                  <div key={idx} className="card p-4 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col justify-between shadow-xs">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-[var(--color-text-muted)] truncate" title={sec.label}>
                          {sec.label}
                        </span>
                        <IconComponent size={16} className={sec.statusColor || 'text-[var(--color-accent)]'} />
                      </div>
                      <div className="text-xl font-bold text-[var(--color-text-primary)] tracking-tight">
                        {sec.value}
                      </div>
                    </div>
                    <div className="pt-2.5 border-t border-[var(--color-border-soft)] mt-2.5">
                      <p className="text-[10px] text-[var(--color-text-muted)] truncate" title={sec.desc}>
                        {sec.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Automated Visual Analytics Section */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                <span>Automated Visual Analytics</span>
                <span className="text-xs text-[var(--color-text-muted)] font-normal">
                  ({charts.length} adaptive views)
                </span>
              </h3>
              <button
                onClick={fetchDashboard}
                disabled={isLoading}
                className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline cursor-pointer flex items-center gap-1"
              >
                <ArrowCounterClockwise size={12} className={isLoading ? 'animate-spin' : ''} />
                <span>Refresh Charts</span>
              </button>
            </div>

            {isLoading ? (
              <div className="card p-12 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col items-center justify-center gap-2.5">
                <div className="w-6 h-6 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
                <p className="text-xs text-[var(--color-text-secondary)] font-medium">Aggregating dataset distributions and building charts...</p>
              </div>
            ) : charts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {charts.map((chart, idx) => (
                  <div
                    key={chart.id || idx}
                    className="card p-4 bg-[var(--color-bg-card)] border-[var(--color-border)] hover:border-[var(--color-border-hover)] cursor-pointer group transition-all flex flex-col shadow-xs"
                    onClick={() => onCreateVisualization ? onCreateVisualization(chart) : onNavigate('visualize')}
                  >
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-soft)] pb-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                          {getVisualIcon(chart.type)}
                        </div>
                        <div>
                          <h4 className="font-bold text-[var(--color-text-primary)] text-xs">
                            {chart.title}
                          </h4>
                          <p className="text-[10px] text-[var(--color-text-muted)] font-medium">
                            {chart.type?.toUpperCase()} · {chart.x_axis || 'X'} vs {chart.y_axis || 'Y'}
                          </p>
                        </div>
                      </div>
                      <div className="p-1 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] group-hover:translate-x-0.5 transition-all">
                        <ArrowRight size={14} />
                      </div>
                    </div>

                    {/* Chart Preview */}
                    <DashboardChartPreview chart={chart} colorIndex={idx} />

                    {/* Card Footer */}
                    <div className="pt-2.5 border-t border-[var(--color-border-soft)] mt-auto flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                      <span className="truncate max-w-[80%] text-[10px] text-[var(--color-text-muted)] font-medium">
                        {chart.description}
                      </span>
                      <span className="text-[11px] font-semibold text-[var(--color-accent)] group-hover:underline shrink-0">
                        Open Builder →
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card p-8 bg-[var(--color-bg-card)] text-center text-xs text-[var(--color-text-muted)]">
                No automatic visualizations generated for this dataset schema.
              </div>
            )}
          </div>

          {/* Saved Visualizations Section */}
          {savedVisuals.length > 0 && (
            <div className="space-y-3.5 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                  <Clock size={16} className="text-[var(--color-text-muted)]" />
                  <span>Custom Saved Visualizations</span>
                </h3>
                <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] px-2 py-0.5 rounded-full font-semibold">
                  {savedVisuals.length} saved
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {savedVisuals.map((viz) => (
                  <div key={viz.id} className="card p-3.5 bg-[var(--color-bg-card)] border-[var(--color-border)] flex flex-col justify-between shadow-xs">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold">
                          {viz.type || 'Custom Chart'}
                        </p>
                        <h4 className="text-xs font-bold text-[var(--color-text-primary)]">
                          {viz.title || 'Saved Visualization'}
                        </h4>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSaved(viz.id);
                        }}
                        className="text-[var(--color-text-muted)] hover:text-rose-500 p-1 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Delete chart"
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between pt-2.5 border-t border-[var(--color-border-soft)] text-xs mt-3">
                      <div className="flex gap-1">
                        {viz.x_axis && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] font-mono">X: {viz.x_axis}</span>}
                        {viz.y_axis && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] font-mono">Y: {viz.y_axis}</span>}
                      </div>
                      <button
                        onClick={() => onOpenSavedVisualization && onOpenSavedVisualization(viz)}
                        className="text-xs font-semibold text-[var(--color-accent)] hover:underline cursor-pointer"
                      >
                        Open →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
