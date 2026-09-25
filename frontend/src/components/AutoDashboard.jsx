import { useState, useEffect, useRef } from 'react';
import { authFetch } from '../utils/api';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, ScatterChart, Scatter,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Label
} from 'recharts';
import {
  createChartFileName,
  downloadDashboardAsHtml,
  downloadDashboardAsPdf,
  downloadDashboardAsPng,
  downloadSvgAsPng,
} from '../utils/exportUtils';

const COLORS = [
  'var(--color-accent)',
  'var(--color-accent-secondary)',
  'var(--color-success)',
  'var(--color-warning)',
  '#e16a86',
  '#3d77b0'
];

const ICON_MAP = {
  bar: '📊',
  line: '📈',
  area: '🏔️',
  scatter: '🔹',
  pie: '🥧',
  histogram: '📉'
};

export default function AutoDashboard({
  tableData,
  columns,
  datasetInfo,
  initialCharts,
  onClose,
}) {
  const [dashboards, setDashboards] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportError, setExportError] = useState(null);
  const cardRefs = useRef({});

  useEffect(() => {
    if (initialCharts && Array.isArray(initialCharts)) {
      setDashboards(initialCharts);
      setIsLoading(false);
      setError(null);
      return;
    }

    fetchAutoDashboard();
  }, [tableData?.length, initialCharts]);

  const fetchAutoDashboard = async () => {
    if (!tableData || tableData.length === 0 || !columns) {
      setError('No data available');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await authFetch('/api/datasets/auto-dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataset_id: datasetInfo?.dataset_id,
          columns: columns || [],
          schema: datasetInfo?.schema || {},
          sample_rows: tableData.slice(0, 500) || [],
        }),
      });

      const data = await res.json();
      if (res.ok && data.charts && data.charts.length > 0) {
        setDashboards(data.charts);
      } else {
        setError(data.error || 'Failed to generate dashboard');
      }
    } catch (fetchError) {
      console.error('Failed to fetch auto-dashboard:', fetchError);
      setError('Error generating visualizations');
    } finally {
      setIsLoading(false);
    }
  };

  const PALETTES = [
    ['#6366f1', '#4f46e5', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'],
    ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#6366f1', '#14b8a6'],
    ['#10b981', '#059669', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'],
    ['#f59e0b', '#d97706', '#ec4899', '#8b5cf6', '#6366f1', '#3b82f6', '#10b981', '#06b6d4'],
    ['#ec4899', '#db2777', '#8b5cf6', '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4'],
  ];

  const renderChart = (chart, chartIdx = 0) => {
    if (!chart.data || chart.data.length === 0) {
      return (
        <div className="w-full h-64 flex items-center justify-center text-[var(--color-text-muted)]">
          No data for this chart
        </div>
      );
    }

    const palette = PALETTES[chartIdx % PALETTES.length];

    const tooltipStyle = {
      contentStyle: {
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        color: 'var(--color-text-primary)',
        fontSize: '12px',
      },
    };
    const axisTick = { fill: 'var(--color-text-muted)', fontSize: 10 };
    const formatAxisLabel = (label) => {
      if (label == null) return '';
      const text = String(label);
      return text.length > 12 ? `${text.slice(0, 12)}…` : text;
    };
    const formatNumber = (value) => {
      if (value == null || Number.isNaN(Number(value))) return value;
      const num = Number(value);
      if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
      if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
      return num.toLocaleString();
    };
    const tooltipFormatter = (value, name) => [formatNumber(value), name];

    switch (chart.type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart.data} margin={{ top: 15, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey={chart.x_axis} tick={axisTick} tickFormatter={formatAxisLabel} angle={-20} textAnchor="end" height={40}>
                <Label value={chart.x_axis} position="insideBottom" offset={-15} fill="var(--color-text-secondary)" fontSize={11} />
              </XAxis>
              <YAxis tick={axisTick} tickFormatter={formatNumber}>
                <Label value={chart.y_axis || 'Value'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" fontSize={11} />
              </YAxis>
              <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
              <Legend />
              {chart.series && chart.series.map((seriesName, sIdx) => (
                <Bar key={seriesName} dataKey={seriesName} radius={[6, 6, 0, 0]}>
                  {chart.data && chart.data.map((_, entryIdx) => (
                    <Cell key={`cell-${entryIdx}`} fill={palette[(entryIdx + sIdx) % palette.length]} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chart.data} margin={{ top: 15, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey={chart.x_axis} tick={axisTick} tickFormatter={formatAxisLabel} angle={-20} textAnchor="end" height={40}>
                <Label value={chart.x_axis} position="insideBottom" offset={-15} fill="var(--color-text-secondary)" fontSize={11} />
              </XAxis>
              <YAxis tick={axisTick} tickFormatter={formatNumber}>
                <Label value={chart.y_axis || 'Value'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" fontSize={11} />
              </YAxis>
              <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
              <Legend />
              {chart.series && chart.series.map((seriesName, index) => (
                <Line key={seriesName} type="monotone" dataKey={seriesName} stroke={palette[index % palette.length]} strokeWidth={2.5} dot={{ r: 3, fill: palette[index % palette.length] }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chart.data} margin={{ top: 15, right: 20, left: 10, bottom: 25 }}>
              <defs>
                {chart.series && chart.series.map((_, sIdx) => (
                  <linearGradient key={sIdx} id={`grad-auto-${chartIdx}-${sIdx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={palette[sIdx % palette.length]} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={palette[sIdx % palette.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey={chart.x_axis} tick={axisTick} tickFormatter={formatAxisLabel} angle={-20} textAnchor="end" height={40}>
                <Label value={chart.x_axis} position="insideBottom" offset={-15} fill="var(--color-text-secondary)" fontSize={11} />
              </XAxis>
              <YAxis tick={axisTick} tickFormatter={formatNumber}>
                <Label value={chart.y_axis || 'Value'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" fontSize={11} />
              </YAxis>
              <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
              <Legend />
              {chart.series && chart.series.map((seriesName, index) => (
                <Area
                  key={seriesName}
                  type="monotone"
                  dataKey={seriesName}
                  stroke={palette[index % palette.length]}
                  fill={`url(#grad-auto-${chartIdx}-${index})`}
                  strokeWidth={2.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 15, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey={chart.x_axis} name={chart.x_axis} tick={axisTick} tickFormatter={formatAxisLabel} angle={-20} textAnchor="end" height={40}>
                <Label value={chart.x_axis} position="insideBottom" offset={-15} fill="var(--color-text-secondary)" fontSize={11} />
              </XAxis>
              <YAxis dataKey={chart.y_axis} name={chart.y_axis} tick={axisTick} tickFormatter={formatNumber}>
                <Label value={chart.y_axis || 'Value'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" fontSize={11} />
              </YAxis>
              <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
              <Scatter data={chart.data}>
                {chart.data && chart.data.map((_, i) => (
                  <Cell key={i} fill={palette[i % palette.length]} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={chart.data}
                dataKey={chart.y_axis}
                nameKey={chart.x_axis}
                cx="50%"
                cy="50%"
                outerRadius={85}
                innerRadius={35}
                paddingAngle={3}
                label={({ name, percent }) => `${formatAxisLabel(name)} ${(percent * 100).toFixed(0)}%`}
              >
                {chart.data && chart.data.map((_, index) => (
                  <Cell key={index} fill={palette[index % palette.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'histogram':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart.data} margin={{ top: 15, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey={chart.x_axis} tick={axisTick} tickFormatter={formatAxisLabel} angle={-20} textAnchor="end" height={40}>
                <Label value={chart.x_axis} position="insideBottom" offset={-15} fill="var(--color-text-secondary)" fontSize={11} />
              </XAxis>
              <YAxis tick={axisTick} tickFormatter={formatNumber}>
                <Label value={chart.y_axis || 'Count'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" fontSize={11} />
              </YAxis>
              <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
              <Bar dataKey={chart.y_axis} radius={[6, 6, 0, 0]}>
                {chart.data && chart.data.map((_, index) => (
                  <Cell key={`hist-${index}`} fill={palette[index % palette.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      default:
        return <div className="text-red-500 text-sm">Unsupported chart type: {chart.type}</div>;
    }
  };

  const dashboardTitle = datasetInfo?.table_name ? `${datasetInfo.table_name} dashboard` : 'InsightAI dashboard';

  const handleDownloadChart = async (chart, index) => {
    try {
      setExportError(null);
      const svgNode = cardRefs.current[index]?.querySelector('svg');
      await downloadSvgAsPng(svgNode, createChartFileName(chart.title, chart.type));
    } catch (downloadError) {
      console.error('Download failed:', downloadError);
      setExportError(downloadError.message || 'Unable to download chart');
    }
  };

  const handleDownloadDashboardHtml = async () => {
    try {
      setExportError(null);
      await downloadDashboardAsHtml(dashboardTitle, dashboards);
    } catch (downloadError) {
      console.error('Dashboard HTML export failed:', downloadError);
      setExportError(downloadError.message || 'Unable to export dashboard HTML');
    }
  };

  const handleDownloadDashboardPng = async () => {
    try {
      setExportError(null);
      await downloadDashboardAsPng(dashboardTitle, dashboards);
    } catch (downloadError) {
      console.error('Dashboard PNG export failed:', downloadError);
      setExportError(downloadError.message || 'Unable to export dashboard PNG');
    }
  };

  const handleDownloadDashboardPdf = async () => {
    try {
      setExportError(null);
      await downloadDashboardAsPdf(dashboardTitle, dashboards);
    } catch (downloadError) {
      console.error('Dashboard PDF export failed:', downloadError);
      setExportError(downloadError.message || 'Unable to export dashboard PDF');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-primary)] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-card)]">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            ✨ AI Dashboard
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Auto-generated visualizations showing relationships in your data
          </p>
          {exportError && (
            <p className="text-xs text-[var(--color-danger)] mt-2">
              {exportError}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadDashboardPng}
            className="px-3 py-2 text-xs font-semibold rounded-[10px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)]"
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={handleDownloadDashboardPdf}
            className="px-3 py-2 text-xs font-semibold rounded-[10px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)]"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={handleDownloadDashboardHtml}
            className="px-3 py-2 text-xs font-semibold rounded-[10px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)]"
          >
            Download HTML
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-[10px] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-all"
          >
            ← Back to Builder
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 border-4 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              Analyzing dataset...
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Generating optimal visualizations with AI
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="text-3xl">⚠️</span>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {error}
            </p>
            <button
              onClick={fetchAutoDashboard}
              className="mt-3 px-4 py-2 text-sm font-medium rounded-[10px] bg-[var(--color-accent)] text-white hover:shadow-md transition-all"
            >
              Retry
            </button>
          </div>
        ) : dashboards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="text-3xl">📊</span>
            <p className="text-sm text-[var(--color-text-secondary)]">
              No visualizations could be generated
            </p>
            <p className="text-xs text-[var(--color-text-muted)] max-w-xs text-center">
              Try uploading a larger dataset with more columns and rows
            </p>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dashboards.map((chart, index) => (
              <div
                key={index}
                ref={(node) => {
                  if (node) {
                    cardRefs.current[index] = node;
                  } else {
                    delete cardRefs.current[index];
                  }
                }}
                className="card p-5 border-[var(--color-border)] hover:border-[var(--color-accent)] hover:shadow-md transition-all"
              >
                <div className="mb-4 pb-3 border-b border-[var(--color-border-soft)]">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{ICON_MAP[chart.type] || '📊'}</span>
                      <div>
                        <h3 className="font-semibold text-sm text-[var(--color-text-primary)]">
                          {chart.title}
                        </h3>
                        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mt-0.5">
                          {chart.type} chart
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadChart(chart, index)}
                      className="text-[10px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)]"
                    >
                      Download
                    </button>
                    {chart.confidence && (
                      <div className="text-right">
                        <div className="text-sm font-bold text-[var(--color-accent)]">
                          {Math.round(chart.confidence * 100)}%
                        </div>
                        <p className="text-[10px] text-[var(--color-text-muted)]">match</p>
                      </div>
                    )}
                  </div>
                  {chart.rationale && (
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {chart.rationale}
                    </p>
                  )}
                </div>

                <div className="w-full">
                  {renderChart(chart, index)}
                </div>

                {chart.features && chart.features.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-[var(--color-border-soft)]">
                    <p className="text-xs text-[var(--color-text-muted)] font-medium mb-2">
                      Columns:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {chart.features.map((feature, featureIndex) => (
                        <span
                          key={featureIndex}
                          className="text-xs px-2 py-1 rounded-[7px] bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-medium"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {dashboards.length > 0 && (
        <div className="border-t border-[var(--color-border-soft)] px-6 py-3 bg-[var(--color-bg-card)] text-center">
          <p className="text-xs text-[var(--color-text-muted)]">
            {dashboards.length} visualizations auto-generated • Analyzing {tableData?.length?.toLocaleString()} rows
          </p>
        </div>
      )}
    </div>
  );
}
