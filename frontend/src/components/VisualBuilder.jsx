import { useState, useMemo, useEffect, useRef } from 'react';
import AutoDashboard from './AutoDashboard';
import { createChartFileName, downloadSvgAsPng } from '../utils/exportUtils';
import { authFetch } from '../utils/api';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, ScatterChart, Scatter,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Label
} from 'recharts';

const CHART_TYPES = [
  { id: 'bar', label: 'Bar', icon: '📊' },
  { id: 'line', label: 'Line', icon: '📈' },
  { id: 'area', label: 'Area', icon: '🏔️' },
  { id: 'scatter', label: 'Scatter', icon: '⚬' },
  { id: 'pie', label: 'Pie', icon: '🥧' },
  { id: 'histogram', label: 'Histogram', icon: '📉' },
];

const COLORS = [
  '#6366f1', // Indigo
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#14b8a6', // Teal
];

export default function VisualBuilder({
  columns,
  tableData,
  datasetInfo,
  selectedRecommendation,
  savedDashboard,
  clearSavedDashboard,
}) {
  const [chartType, setChartType] = useState('bar');
  const [xCol, setXCol] = useState('');
  const [yCols, setYCols] = useState([]);
  const [autoRecs, setAutoRecs] = useState([]);
  const [isLoadingAuto, setIsLoadingAuto] = useState(false);
  const [showAutoDashboard, setShowAutoDashboard] = useState(false);
  const [manualPulse, setManualPulse] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [pendingDownload, setPendingDownload] = useState(null);
  const manualSectionRef = useRef(null);
  const chartContainerRef = useRef(null);
  const pulseTimeoutRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Fetch auto-visualization recommendations
  const fetchAutoVisualizations = async () => {
    if (!tableData || tableData.length === 0 || !columns) return;
    
    setIsLoadingAuto(true);
    try {
      const res = await authFetch('/api/datasets/auto-visualize', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataset_id: datasetInfo?.dataset_id,
          columns: columns || [],
          schema: datasetInfo?.schema || {},
          sample_rows: tableData.slice(0, 100) || [],
        }),
      });
      const data = await res.json();
      if (res.ok && data.recommendations) {
        setAutoRecs(data.recommendations);
      }
    } catch (err) {
      console.error('Failed to fetch auto-visualizations:', err);
    } finally {
      setIsLoadingAuto(false);
    }
  };

  // Load recommendations on mount
  useEffect(() => {
    if (tableData && tableData.length > 0) {
      fetchAutoVisualizations();
    }
  }, [tableData?.length]);

  // Apply recommendation to builder
  const applyRecommendation = (rec) => {
    if (!rec) return;
    if (rec.type === 'histogram') {
      const sourceCol = rec.x_axis || rec.y_axis;
      if (sourceCol) {
        setXCol(sourceCol);
        setYCols(['frequency']);
        setChartType('histogram');
      }
      return;
    }
    if (rec.x_axis) setXCol(rec.x_axis);
    if (rec.y_cols && rec.y_cols.length > 0) {
      setYCols(rec.y_cols);
    } else if (rec.y_axis) {
      setYCols([rec.y_axis]);
    }
    setChartType(rec.type || 'bar');
  };

  useEffect(() => {
    if (selectedRecommendation) {
      applyRecommendation(selectedRecommendation);
    }
  }, [selectedRecommendation]);

  useEffect(() => {
    if (!pendingDownload) {
      return;
    }

    if (!xCol) {
      return;
    }

    let retries = 0;
    let rafId;
    let timeoutId;

    const tryDownload = () => {
      const svg = chartContainerRef.current?.querySelector('svg');
      if (!svg) {
        if (retries < 30) {
          retries++;
          rafId = requestAnimationFrame(tryDownload);
        } else {
          setPendingDownload(null);
          setSaveNotice('Download failed');
        }
        return;
      }

      // SVG is now in the DOM. Wait a moment for Recharts to update/render completely
      timeoutId = setTimeout(async () => {
        try {
          const currentSvg = chartContainerRef.current?.querySelector('svg');
          if (currentSvg) {
            await downloadSvgAsPng(
              currentSvg,
              createChartFileName(pendingDownload.title, pendingDownload.type || 'chart')
            );
            setSaveNotice('Downloaded');
          }
        } catch (error) {
          console.error('Download failed:', error);
          setSaveNotice('Download failed');
        } finally {
          setPendingDownload(null);
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = setTimeout(() => setSaveNotice(''), 1600);
        }
      }, 500); // 500ms to allow animations to settle initially
    };

    rafId = requestAnimationFrame(tryDownload);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [pendingDownload, xCol, yCols, chartType, tableData]);

  // Determine numeric vs non-numeric columns from actual data
  const { numericCols, categoricalCols } = useMemo(() => {
    if (!tableData || tableData.length === 0 || !columns) {
      return { numericCols: [], categoricalCols: columns || [] };
    }
    const num = [];
    const cat = [];
    columns.forEach(col => {
      const sample = tableData.slice(0, 10).map(r => r[col]).filter(v => v != null);
      const isNumeric = sample.length > 0 && sample.every(v => !isNaN(Number(v)));
      if (isNumeric) num.push(col);
      else cat.push(col);
    });
    return { numericCols: num, categoricalCols: cat };
  }, [columns, tableData]);

  // Prepare chart data
  const chartData = useMemo(() => {
    if (!tableData || !xCol) return [];

    if (chartType === 'scatter') {
      const yKey = yCols[0];
      if (!yKey) return [];
      return tableData
        .map((row) => ({
          [xCol]: Number(row[xCol]),
          [yKey]: Number(row[yKey]),
        }))
        .filter((row) => !Number.isNaN(row[xCol]) && !Number.isNaN(row[yKey]))
        .slice(0, 200);
    }

    if (chartType === 'histogram') {
      const values = tableData
        .map((row) => Number(row[xCol]))
        .filter((v) => !Number.isNaN(v));
      if (values.length === 0) return [];
      const min = Math.min(...values);
      const max = Math.max(...values);
      const binCount = Math.min(12, Math.max(6, Math.round(Math.sqrt(values.length))));
      const binSize = (max - min) / binCount || 1;
      const bins = Array.from({ length: binCount }, (_, i) => ({
        start: min + i * binSize,
        end: min + (i + 1) * binSize,
        count: 0,
      }));
      values.forEach((val) => {
        const idx = Math.min(binCount - 1, Math.floor((val - min) / binSize));
        bins[idx].count += 1;
      });
      return bins.map((bin) => ({
        [xCol]: `${bin.start.toFixed(1)}-${bin.end.toFixed(1)}`,
        frequency: bin.count,
      }));
    }

    if (chartType === 'pie') {
      const yKey = yCols[0];
      const grouped = {};
      tableData.forEach((row) => {
        const key = String(row[xCol] ?? 'Unknown');
        if (!grouped[key]) grouped[key] = 0;
        const val = yKey ? Number(row[yKey]) : 1;
        grouped[key] += Number.isNaN(val) ? 0 : val;
      });
      return Object.entries(grouped)
        .map(([key, value]) => ({ [xCol]: key, [yKey || 'value']: value }))
        .slice(0, 12);
    }

    if (!yCols.length) return [];

    const grouped = {};
    tableData.forEach((row) => {
      const key = String(row[xCol] ?? 'Unknown');
      if (!grouped[key]) {
        grouped[key] = { [xCol]: key };
        yCols.forEach((y) => { grouped[key][y] = 0; });
      }
      yCols.forEach((y) => {
        grouped[key][y] += Number(row[y]) || 0;
      });
    });
    return Object.values(grouped).slice(0, 50);
  }, [tableData, xCol, yCols, chartType]);

  const handleDragStart = (e, col) => {
    e.dataTransfer.setData('text/plain', col);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {};

  const handleDropX = (e) => {
    e.preventDefault();
    const col = e.dataTransfer.getData('text/plain');
    if (col) setXCol(col);
  };

  const handleDropY = (e) => {
    e.preventDefault();
    const col = e.dataTransfer.getData('text/plain');
    if (col && !yCols.includes(col) && col !== xCol) {
      setYCols(prev => [...prev, col]);
    }
  };

  const removeYCol = (col) => setYCols(prev => prev.filter(c => c !== col));
  const clearAll = () => { setXCol(''); setYCols([]); };

  const downloadVisualization = (payload) => {
    setPendingDownload(payload);
  };

  const tooltipStyle = {
    contentStyle: {
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      color: 'var(--color-text-primary)',
      fontSize: '12px',
    },
  };

  const axisTick = { fill: 'var(--color-text-muted)', fontSize: 11 };
  const formatAxisLabel = (label) => {
    if (label == null) return '';
    const text = String(label);
    return text.length > 12 ? `${text.slice(0, 12)}…` : text;
  };
  const formatNumber = (value) => {
    if (value == null || Number.isNaN(Number(value))) return value;
    return Number(value).toLocaleString();
  };
  const tooltipFormatter = (value) => [formatNumber(value), 'Value'];

  const canRender = xCol && chartData.length > 0 && (chartType === 'histogram' || yCols.length > 0);

  // Show Auto Dashboard if toggled
  if (showAutoDashboard || savedDashboard) {
    return (
      <AutoDashboard
        tableData={tableData}
        columns={columns}
        datasetInfo={datasetInfo}
        initialCharts={savedDashboard?.charts}
        initialSummary={savedDashboard?.summary}
        readOnly={!!savedDashboard}
        onClose={() => {
          if (savedDashboard && clearSavedDashboard) clearSavedDashboard();
          setShowAutoDashboard(false);
        }}
      />
    );
  }

  return (
    <div className="flex h-full">
      {/* Column Palette — left sidebar */}
      <div className="w-52 shrink-0 border-r border-[var(--color-border)] p-3 overflow-y-auto">
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
          Columns
        </h4>
        <p className="text-[10px] text-[var(--color-text-muted)] mb-3">Drag to X or Y axis</p>

        {categoricalCols.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] text-[var(--color-text-muted)] mb-1.5 font-medium">Categorical</p>
            <div className="space-y-1">
              {categoricalCols.map(col => (
                <div
                  key={col}
                  draggable
                  onDragStart={(e) => handleDragStart(e, col)}
                  onDragEnd={handleDragEnd}
                  className="text-xs px-2.5 py-1.5 rounded-md bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] font-mono cursor-grab active:cursor-grabbing hover:bg-[var(--color-bg-elevated)] transition-colors border border-transparent hover:border-[var(--color-border-hover)] select-none"
                >
                  {col}
                </div>
              ))}
            </div>
          </div>
        )}

        {numericCols.length > 0 && (
          <div>
            <p className="text-[10px] text-[var(--color-text-muted)] mb-1.5 font-medium">Numeric</p>
            <div className="space-y-1">
              {numericCols.map(col => (
                <div
                  key={col}
                  draggable
                  onDragStart={(e) => handleDragStart(e, col)}
                  onDragEnd={handleDragEnd}
                  className="text-xs px-2.5 py-1.5 rounded-md bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-mono cursor-grab active:cursor-grabbing hover:bg-[var(--color-accent-secondary-soft)] transition-colors border border-transparent hover:border-[var(--color-accent)] select-none"
                >
                  # {col}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chart area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar with Auto Visualization Button */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] flex-wrap gap-2">
          <button
            onClick={() => setShowAutoDashboard(true)}
            className="px-5 py-2.5 rounded-[11px] font-semibold text-sm bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-soft)] text-white shadow-md hover:shadow-lg transition-all flex items-center gap-2.5 flex-shrink-0"
          >
            <span className="text-base">✨</span>
            Auto Visualization
          </button>

          <button
            type="button"
            onClick={() => {
              manualSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              setManualPulse(true);
              if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
              pulseTimeoutRef.current = setTimeout(() => setManualPulse(false), 700);
            }}
            className="text-xs text-[var(--color-text-muted)] font-medium hover:text-[var(--color-text-primary)] transition-colors"
          >
            or build manually below →
          </button>
        </div>

        {/* Config bar */}
        <div
          ref={manualSectionRef}
          className={`flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] flex-wrap ${manualPulse ? 'manual-flash' : ''}`}
        >
          {/* Chart type selector */}
          <div className="flex gap-1 bg-[var(--color-bg-primary)] rounded-lg p-0.5">
            {CHART_TYPES.map(ct => (
              <button
                key={ct.id}
                onClick={() => setChartType(ct.id)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${chartType === ct.id
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                title={ct.label}
              >
                {ct.icon} {ct.label}
              </button>
            ))}
          </div>

          {/* X axis drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropX}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed text-xs min-w-[120px] transition-colors ${xCol
                ? 'border-[var(--color-success)] bg-[rgba(34,197,94,0.08)]'
                : 'border-[var(--color-border-hover)] bg-[var(--color-bg-card)]'
              }`}
          >
            <span className="text-[var(--color-text-muted)] text-[10px] font-medium">X:</span>
            {xCol ? (
              <span className="font-mono text-[var(--color-success)]">{xCol}</span>
            ) : (
              <span className="text-[var(--color-text-muted)]">Drop column</span>
            )}
          </div>

          {/* Y axis drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropY}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed text-xs min-w-[120px] transition-colors ${yCols.length > 0
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
                : 'border-[var(--color-border-hover)] bg-[var(--color-bg-card)]'
              }`}
          >
            <span className="text-[var(--color-text-muted)] text-[10px] font-medium">Y:</span>
            {yCols.length > 0 ? (
              <div className="flex gap-1 flex-wrap">
                {yCols.map(col => (
                  <span
                    key={col}
                    className="font-mono text-[var(--color-accent)] flex items-center gap-1"
                  >
                    {col}
                    <button
                      onClick={() => removeYCol(col)}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] text-[10px]"
                    >✕</button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[var(--color-text-muted)]">Drop column(s)</span>
            )}
          </div>

          {(xCol || yCols.length > 0) && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadVisualization({
                  source: 'manual',
                  title: `Manual ${chartType} chart`,
                  type: chartType,
                  x_axis: xCol,
                  y_axis: yCols[0] || null,
                  y_cols: yCols,
                })}
                disabled={!canRender}
                className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)] disabled:opacity-40"
              >
                Download
              </button>
              {saveNotice && (
                <span className="text-[10px] text-[var(--color-success)] font-medium">
                  {saveNotice}
                </span>
              )}
              <button onClick={clearAll} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Auto Visualization Recommendations */}
        {autoRecs.length > 0 && (
          <div className="border-t border-[var(--color-border)] px-4 py-3 bg-[var(--color-bg-card)]">
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                ✨ AI Recommendations
                {isLoadingAuto && <span className="text-[10px] animate-pulse">Loading...</span>}
              </label>
              <span className="text-[11px] text-[var(--color-text-muted)]">{autoRecs.length} charts</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 scroll-smooth">
              {autoRecs.map((rec, idx) => (
                <div key={rec.id || idx} className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => applyRecommendation(rec)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-[9px] border text-xs font-medium whitespace-nowrap transition-all ${
                      xCol === rec.x_axis && yCols.includes(rec.y_axis) && chartType === rec.type
                        ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                        : 'bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                    }`}
                    title={rec.rationale}
                  >
                    <span>{rec.type === 'bar' ? '📊' : rec.type === 'line' ? '📈' : rec.type === 'pie' ? '🥧' : rec.type === 'scatter' ? '🔹' : '📉'}</span>
                    {rec.title}
                    {rec.confidence && <span className="text-[10px] opacity-70">({Math.round(rec.confidence * 100)}%)</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyRecommendation(rec);
                      setPendingDownload({
                        title: rec.title || `${rec.type} chart`,
                        type: rec.type,
                      });
                    }}
                    className="text-[10px] px-2 py-2 rounded-[9px] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)]"
                    title="Download visualization"
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chart render */}
        <div className="flex-1 p-4 flex items-center justify-center overflow-hidden">
          {!canRender ? (
            <div className="text-center animate-fade-in">
              <span className="text-3xl block mb-3">📊</span>
              <p className="text-sm text-[var(--color-text-secondary)] mb-1">Build a visualization</p>
              <p className="text-xs text-[var(--color-text-muted)] max-w-xs">
                Drag columns from the left panel to the X and Y drop zones, then pick a chart type.
              </p>
            </div>
          ) : (
            <div ref={chartContainerRef} className="w-full h-full animate-fade-in">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'pie' ? (
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey={yCols[0]}
                      nameKey={xCol}
                      cx="50%"
                      cy="50%"
                      outerRadius="75%"
                      label={({ name, percent }) => `${formatAxisLabel(name)} ${(percent * 100).toFixed(0)}%`}
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
                    <Legend />
                  </PieChart>
                ) : chartType === 'scatter' ? (
                  <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey={xCol}
                      name={xCol}
                      tick={axisTick}
                      tickFormatter={formatAxisLabel}
                    >
                      <Label value={xCol} position="insideBottom" offset={-6} fill="var(--color-text-secondary)" />
                    </XAxis>
                    <YAxis
                      dataKey={yCols[0]}
                      name={yCols[0]}
                      tick={axisTick}
                      tickFormatter={formatNumber}
                    >
                      <Label value={yCols[0]} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" />
                    </YAxis>
                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
                    <Scatter data={chartData} fill={COLORS[0]} isAnimationActive={false} />
                  </ScatterChart>
                ) : chartType === 'area' ? (
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <defs>
                      {yCols.map((_, i) => (
                        <linearGradient key={i} id={`area-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey={xCol} tick={axisTick} tickFormatter={formatAxisLabel}>
                      <Label value={xCol} position="insideBottom" offset={-6} fill="var(--color-text-secondary)" />
                    </XAxis>
                    <YAxis tick={axisTick} tickFormatter={formatNumber}>
                      <Label value={yCols[0] || 'Value'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" />
                    </YAxis>
                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
                    <Legend />
                    {yCols.map((y, i) => (
                      <Area key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} fill={`url(#area-${i})`} strokeWidth={2} isAnimationActive={false} />
                    ))}
                  </AreaChart>
                ) : chartType === 'line' ? (
                  <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey={xCol} tick={axisTick} tickFormatter={formatAxisLabel}>
                      <Label value={xCol} position="insideBottom" offset={-6} fill="var(--color-text-secondary)" />
                    </XAxis>
                    <YAxis tick={axisTick} tickFormatter={formatNumber}>
                      <Label value={yCols[0] || 'Value'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" />
                    </YAxis>
                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
                    <Legend />
                    {yCols.map((y, i) => (
                      <Line key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                ) : chartType === 'histogram' ? (
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey={xCol} tick={axisTick} tickFormatter={formatAxisLabel}>
                      <Label value={xCol} position="insideBottom" offset={-6} fill="var(--color-text-secondary)" />
                    </XAxis>
                    <YAxis tick={axisTick} tickFormatter={formatNumber}>
                      <Label value="Count" angle={-90} position="insideLeft" fill="var(--color-text-secondary)" />
                    </YAxis>
                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
                    <Legend />
                    <Bar dataKey="frequency" fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                  </BarChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey={xCol} tick={axisTick} tickFormatter={formatAxisLabel}>
                      <Label value={xCol} position="insideBottom" offset={-6} fill="var(--color-text-secondary)" />
                    </XAxis>
                    <YAxis tick={axisTick} tickFormatter={formatNumber}>
                      <Label value={yCols[0] || 'Value'} angle={-90} position="insideLeft" fill="var(--color-text-secondary)" />
                    </YAxis>
                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter} />
                    <Legend />
                    {yCols.map((y, i) => (
                      <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={45} isAnimationActive={false} />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
