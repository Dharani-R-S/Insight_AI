import { useState, useMemo } from 'react';
import DataTable from './DataTable';
import { 
  GitMerge, 
  Plus, 
  Calculator, 
  Broom, 
  Funnel, 
  DownloadSimple, 
  Check, 
  X, 
  ArrowRight,
  Database,
  UploadSimple,
  Sparkle,
  CaretDown
} from '@phosphor-icons/react';
import { downloadTransformedDataset } from '../utils/exportUtils';

function defaultAuthFetch(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function DataTransformStudio({ 
  primaryData, 
  datasetInfo, 
  onUpdateActiveDataset,
  authFetch = defaultAuthFetch
}) {
  const [activeData, setActiveData] = useState(primaryData || []);
  const [activeColumns, setActiveColumns] = useState(() => 
    primaryData && primaryData.length > 0 ? Object.keys(primaryData[0]) : (datasetInfo?.columns || [])
  );
  const [secondaryData, setSecondaryData] = useState(null);
  const [secondaryName, setSecondaryName] = useState('');
  const [secondaryColumns, setSecondaryColumns] = useState([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Applied Steps Timeline
  const [appliedSteps, setAppliedSteps] = useState([
    { id: 1, name: 'Load Primary Dataset', desc: `${primaryData?.length || 0} rows initialized` }
  ]);

  const [activeModal, setActiveModal] = useState(null); // 'join' | 'formula' | 'groupby' | 'impute' | 'filter'
  const [isProcessing, setIsProcessing] = useState(false);

  // Form states
  const [joinType, setJoinType] = useState('left');
  const [joinKey1, setJoinKey1] = useState(activeColumns[0] || '');
  const [joinKey2, setJoinKey2] = useState('');

  const [calcColName, setCalcColName] = useState('');
  const [calcCol1, setCalcCol1] = useState(activeColumns[0] || '');
  const [calcOp, setCalcOp] = useState('*');
  const [calcCol2, setCalcCol2] = useState('');
  const [calcScalar, setCalcScalar] = useState('');

  const [groupCols, setGroupCols] = useState([]);
  const [aggCol, setAggCol] = useState(activeColumns[0] || '');
  const [aggFunc, setAggFunc] = useState('sum');

  const [imputeCol, setImputeCol] = useState(activeColumns[0] || '');
  const [imputeStrategy, setImputeStrategy] = useState('zero');

  const [filterCol, setFilterCol] = useState(activeColumns[0] || '');
  const [filterOp, setFilterOp] = useState('==');
  const [filterVal, setFilterVal] = useState('');

  // Handle Secondary Dataset Upload for Joins
  const handleSecondaryUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSecondaryName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (!text) return;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
      const rows = [];
      for (let i = 1; i < Math.min(lines.length, 1000); i++) {
        const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
        const rowObj = {};
        headers.forEach((h, idx) => {
          const raw = parts[idx];
          rowObj[h] = !isNaN(Number(raw)) && raw !== '' ? Number(raw) : raw;
        });
        rows.push(rowObj);
      }
      setSecondaryData(rows);
      setSecondaryColumns(headers);
      setJoinKey2(headers[0] || '');
    };
    reader.readAsText(file);
  };

  // 1. Execute Multi-Dataset Join
  const handleExecuteJoin = async () => {
    if (!secondaryData || !joinKey1 || !joinKey2) {
      alert('Please upload a secondary dataset and select join keys.');
      return;
    }
    setIsProcessing(true);
    try {
      const res = await authFetch('/api/transform/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset1_rows: activeData,
          dataset2_rows: secondaryData,
          join_type: joinType,
          key1: joinKey1,
          key2: joinKey2,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveData(data.rows);
        setActiveColumns(data.columns);
        setAppliedSteps(prev => [
          ...prev,
          { id: Date.now(), name: `Join: ${joinType.toUpperCase()} JOIN ${secondaryName}`, desc: `Key: ${joinKey1} ⟕ ${joinKey2} (${data.row_count} rows)` }
        ]);
        setActiveModal(null);
      } else {
        alert(data.error || 'Join operation failed');
      }
    } catch (err) {
      console.error('Join error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Execute Calculated Column Formula
  const handleExecuteCalculatedColumn = async () => {
    if (!calcColName || !calcCol1) {
      alert('Please specify a new column name and source column.');
      return;
    }
    setIsProcessing(true);
    try {
      const res = await authFetch('/api/transform/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_rows: activeData,
          action: 'calculated_column',
          params: {
            new_column: calcColName,
            col1: calcCol1,
            op: calcOp,
            col2: calcCol2 || null,
            scalar: calcScalar !== '' ? Number(calcScalar) : null,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveData(data.rows);
        setActiveColumns(data.columns);
        setAppliedSteps(prev => [
          ...prev,
          { id: Date.now(), name: `Calculated Column: [${calcColName}]`, desc: `${calcCol1} ${calcOp} ${calcCol2 || calcScalar}` }
        ]);
        setActiveModal(null);
        setCalcColName('');
      } else {
        alert(data.error || 'Calculation failed');
      }
    } catch (err) {
      console.error('Calculation error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Execute Group By & Aggregation
  const handleExecuteGroupBy = async () => {
    if (groupCols.length === 0 || !aggCol) {
      alert('Please select group by columns and an aggregation target.');
      return;
    }
    setIsProcessing(true);
    try {
      const res = await authFetch('/api/transform/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_rows: activeData,
          action: 'group_by',
          params: {
            group_cols: groupCols,
            agg_cols: [{ col: aggCol, func: aggFunc }],
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveData(data.rows);
        setActiveColumns(data.columns);
        setAppliedSteps(prev => [
          ...prev,
          { id: Date.now(), name: `Group By: ${groupCols.join(', ')}`, desc: `${aggFunc.toUpperCase()}(${aggCol}) → ${data.row_count} rows` }
        ]);
        setActiveModal(null);
      } else {
        alert(data.error || 'Group By failed');
      }
    } catch (err) {
      console.error('Group by error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Execute Impute Missing Values
  const handleExecuteImpute = async () => {
    if (!imputeCol) return;
    setIsProcessing(true);
    try {
      const res = await authFetch('/api/transform/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_rows: activeData,
          action: 'impute',
          params: {
            column: imputeCol,
            strategy: imputeStrategy,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveData(data.rows);
        setAppliedSteps(prev => [
          ...prev,
          { id: Date.now(), name: `Clean: Fill NA on [${imputeCol}]`, desc: `Strategy: ${imputeStrategy}` }
        ]);
        setActiveModal(null);
      }
    } catch (err) {
      console.error('Impute error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 5. Execute Filter Rows
  const handleExecuteFilter = async () => {
    if (!filterCol || filterVal === '') return;
    setIsProcessing(true);
    try {
      const res = await authFetch('/api/transform/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_rows: activeData,
          action: 'filter',
          params: {
            column: filterCol,
            operator: filterOp,
            value: filterVal,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveData(data.rows);
        setAppliedSteps(prev => [
          ...prev,
          { id: Date.now(), name: `Filter: [${filterCol}] ${filterOp} ${filterVal}`, desc: `${data.row_count} rows matching` }
        ]);
        setActiveModal(null);
      }
    } catch (err) {
      console.error('Filter error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Export Handlers (CSV, Excel, JSON)
  const handleExportFormat = async (format) => {
    setIsExportOpen(false);
    setIsExporting(true);
    try {
      await downloadTransformedDataset({
        format,
        authFetch,
        rows: activeData,
        baseName: datasetInfo?.table_name || 'transformed_dataset'
      });
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export dataset: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] select-none">
      
      {/* Studio Header Bar */}
      <div className="px-6 py-3.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <GitMerge size={18} className="text-[var(--color-accent)]" />
            <h2 className="text-sm font-semibold tracking-tight text-[var(--color-text-primary)]">Data Transformation Studio</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
              Pipeline
            </span>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            {activeData.length.toLocaleString()} rows · {activeColumns.length} columns · {appliedSteps.length} applied steps
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onUpdateActiveDataset(activeData, activeColumns)}
            className="btn-primary px-3.5 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="Set this transformed data as the active workspace dataset"
          >
            <Check size={14} weight="bold" />
            <span>Apply to Workspace</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              disabled={isExporting || !activeData?.length}
              className="btn-secondary px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <DownloadSimple size={14} />
              <span>{isExporting ? 'Exporting...' : 'Export'}</span>
              <CaretDown size={12} className={`transition-transform ${isExportOpen ? 'rotate-180' : ''}`} />
            </button>

            {isExportOpen && (
              <div className="absolute right-0 mt-1.5 w-44 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] shadow-xl z-50 py-1 text-xs">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider border-b border-[var(--color-border)]">
                  Export Dataset
                </div>
                <button
                  onClick={() => handleExportFormat('csv')}
                  className="w-full text-left px-3 py-2 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center justify-between cursor-pointer"
                >
                  <span>CSV File</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono">.csv</span>
                </button>
                <button
                  onClick={() => handleExportFormat('excel')}
                  className="w-full text-left px-3 py-2 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center justify-between cursor-pointer"
                >
                  <span>Excel Workbook</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono">.xlsx</span>
                </button>
                <button
                  onClick={() => handleExportFormat('json')}
                  className="w-full text-left px-3 py-2 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] flex items-center justify-between cursor-pointer"
                >
                  <span>JSON Array</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono">.json</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Studio Body (3 Panel Layout) */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        
        {/* Left Toolbar Operations Catalog */}
        <div className="w-60 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 overflow-y-auto space-y-4 shrink-0 font-sans">
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Transformations
            </p>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Select a transformation step</p>
          </div>

          <div className="space-y-1.5">
            <button
              onClick={() => setActiveModal('join')}
              className="w-full card p-2.5 flex items-center gap-2.5 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-card)] transition-all cursor-pointer group"
            >
              <div className="w-7 h-7 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center shrink-0">
                <GitMerge size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">Multi-Dataset Join</p>
                <p className="text-[10px] text-[var(--color-text-muted)] truncate">Merge 2 CSV datasets</p>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('formula')}
              className="w-full card p-2.5 flex items-center gap-2.5 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-card)] transition-all cursor-pointer group"
            >
              <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                <Calculator size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">Calculated Column</p>
                <p className="text-[10px] text-[var(--color-text-muted)] truncate">Math formulas & arithmetic</p>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('groupby')}
              className="w-full card p-2.5 flex items-center gap-2.5 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-card)] transition-all cursor-pointer group"
            >
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                <Database size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">Group & Aggregate</p>
                <p className="text-[10px] text-[var(--color-text-muted)] truncate">Pivot SUM, AVG, COUNT</p>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('impute')}
              className="w-full card p-2.5 flex items-center gap-2.5 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-card)] transition-all cursor-pointer group"
            >
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                <Broom size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">Clean & Impute NA</p>
                <p className="text-[10px] text-[var(--color-text-muted)] truncate">Fill missing values</p>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('filter')}
              className="w-full card p-2.5 flex items-center gap-2.5 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-card)] transition-all cursor-pointer group"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                <Funnel size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">Filter Rows</p>
                <p className="text-[10px] text-[var(--color-text-muted)] truncate">Conditional row filters</p>
              </div>
            </button>
          </div>

          {/* Applied Steps Pipeline Bar */}
          <div className="pt-4 border-t border-[var(--color-border)]">
            <div className="px-1 mb-2 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Pipeline Steps
              </p>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {appliedSteps.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {appliedSteps.map((step, idx) => (
                <div key={step.id} className="card p-2.5 bg-[var(--color-bg-card)] border-[var(--color-border)] text-xs space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-[9px] font-mono font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <p className="font-medium text-[var(--color-text-primary)] truncate text-[11px]">{step.name}</p>
                  </div>
                  <p className="text-[10px] text-[var(--color-text-muted)] truncate pl-5 font-mono">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Main Preview Table Grid */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col min-w-0 font-sans">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] tracking-tight">
              Transformed Data Preview
            </h3>
            <span className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              Active Preview
            </span>
          </div>

          <div className="flex-1 min-h-0">
            <DataTable data={activeData} />
          </div>
        </div>

      </div>

      {/* ── Transformation Modals ── */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-sans">
          <div className="card p-6 bg-[var(--color-bg-card)] border-[var(--color-border)] w-full max-w-md space-y-5 text-left shadow-2xl">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">
                {activeModal === 'join' && 'Multi-Dataset Join (Merge)'}
                {activeModal === 'formula' && 'Add Calculated Column'}
                {activeModal === 'groupby' && 'Group By & Aggregate'}
                {activeModal === 'impute' && 'Impute Missing Values'}
                {activeModal === 'filter' && 'Filter Rows'}
              </h4>
              <button 
                onClick={() => setActiveModal(null)} 
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1 rounded-md hover:bg-[var(--color-bg-elevated)] cursor-pointer transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal 1: Join */}
            {activeModal === 'join' && (
              <div className="space-y-4 text-xs font-sans">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Secondary Dataset (CSV)</label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleSecondaryUpload}
                    className="w-full text-xs text-[var(--color-text-muted)] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-[var(--color-accent)] file:text-white cursor-pointer"
                  />
                  {secondaryName && <p className="text-[11px] text-emerald-500 font-medium mt-1">Loaded: {secondaryName} ({secondaryData?.length} rows)</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Join Type</label>
                    <select
                      value={joinType}
                      onChange={e => setJoinType(e.target.value)}
                      className="input-field w-full text-xs"
                    >
                      <option value="inner">Inner Join</option>
                      <option value="left">Left Join</option>
                      <option value="right">Right Join</option>
                      <option value="outer">Full Outer Join</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Primary Key</label>
                    <select
                      value={joinKey1}
                      onChange={e => setJoinKey1(e.target.value)}
                      className="input-field w-full text-xs"
                    >
                      {activeColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {secondaryColumns.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Secondary Key</label>
                    <select
                      value={joinKey2}
                      onChange={e => setJoinKey2(e.target.value)}
                      className="input-field w-full text-xs"
                    >
                      {secondaryColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}

                <button
                  onClick={handleExecuteJoin}
                  disabled={isProcessing || !secondaryData}
                  className="w-full btn-primary py-2 text-xs font-semibold cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isProcessing ? 'Merging Datasets...' : 'Execute Join'}
                </button>
              </div>
            )}

            {/* Modal 2: Formula */}
            {activeModal === 'formula' && (
              <div className="space-y-4 text-xs font-sans">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">New Column Name</label>
                  <input
                    type="text"
                    placeholder="e.g. total_revenue"
                    value={calcColName}
                    onChange={e => setCalcColName(e.target.value)}
                    className="input-field w-full text-xs"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 items-center">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Column 1</label>
                    <select value={calcCol1} onChange={e => setCalcCol1(e.target.value)} className="input-field w-full text-xs">
                      {activeColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Operator</label>
                    <select value={calcOp} onChange={e => setCalcOp(e.target.value)} className="input-field w-full text-center text-xs">
                      <option value="*">× (Multiply)</option>
                      <option value="+">+ (Add)</option>
                      <option value="-">- (Subtract)</option>
                      <option value="/">÷ (Divide)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Column 2</label>
                    <select value={calcCol2} onChange={e => setCalcCol2(e.target.value)} className="input-field w-full text-xs">
                      <option value="">None (Use Constant)</option>
                      {activeColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {!calcCol2 && (
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Constant Numeric Value</label>
                    <input
                      type="number"
                      placeholder="e.g. 1.05"
                      value={calcScalar}
                      onChange={e => setCalcScalar(e.target.value)}
                      className="input-field w-full text-xs"
                    />
                  </div>
                )}

                <button
                  onClick={handleExecuteCalculatedColumn}
                  disabled={isProcessing || !calcColName}
                  className="w-full btn-primary py-2 text-xs font-semibold cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isProcessing ? 'Calculating...' : 'Create Calculated Column'}
                </button>
              </div>
            )}

            {/* Modal 3: Group By */}
            {activeModal === 'groupby' && (
              <div className="space-y-4 text-xs font-sans">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Group By Dimension</label>
                  <select
                    value={groupCols[0] || ''}
                    onChange={e => setGroupCols([e.target.value])}
                    className="input-field w-full text-xs"
                  >
                    {activeColumns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Aggregate Target</label>
                    <select value={aggCol} onChange={e => setAggCol(e.target.value)} className="input-field w-full text-xs">
                      {activeColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Function</label>
                    <select value={aggFunc} onChange={e => setAggFunc(e.target.value)} className="input-field w-full text-xs">
                      <option value="sum">SUM</option>
                      <option value="mean">AVERAGE (Mean)</option>
                      <option value="count">COUNT</option>
                      <option value="min">MIN</option>
                      <option value="max">MAX</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleExecuteGroupBy}
                  disabled={isProcessing}
                  className="w-full btn-primary py-2 text-xs font-semibold cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isProcessing ? 'Aggregating...' : 'Execute Group By'}
                </button>
              </div>
            )}

            {/* Modal 4: Impute */}
            {activeModal === 'impute' && (
              <div className="space-y-4 text-xs font-sans">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Target Column</label>
                  <select value={imputeCol} onChange={e => setImputeCol(e.target.value)} className="input-field w-full text-xs">
                    {activeColumns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Fill Strategy</label>
                  <select value={imputeStrategy} onChange={e => setImputeStrategy(e.target.value)} className="input-field w-full text-xs">
                    <option value="zero">Fill with Zero (0)</option>
                    <option value="mean">Fill with Column Mean</option>
                    <option value="median">Fill with Median</option>
                    <option value="mode">Fill with Most Frequent (Mode)</option>
                    <option value="ffill">Forward Fill (Next Row Value)</option>
                  </select>
                </div>
                <button
                  onClick={handleExecuteImpute}
                  disabled={isProcessing}
                  className="w-full btn-primary py-2 text-xs font-semibold cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isProcessing ? 'Cleaning...' : 'Apply Imputation'}
                </button>
              </div>
            )}

            {/* Modal 5: Filter */}
            {activeModal === 'filter' && (
              <div className="space-y-4 text-xs font-sans">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Column</label>
                    <select value={filterCol} onChange={e => setFilterCol(e.target.value)} className="input-field w-full text-xs">
                      {activeColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Condition</label>
                    <select value={filterOp} onChange={e => setFilterOp(e.target.value)} className="input-field w-full text-xs">
                      <option value="==">Equals (==)</option>
                      <option value="!=">Not Equals (!=)</option>
                      <option value=">">Greater Than (&gt;)</option>
                      <option value="<">Less Than (&lt;)</option>
                      <option value="contains">Contains Text</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">Filter Value</label>
                  <input
                    type="text"
                    placeholder="Value to compare..."
                    value={filterVal}
                    onChange={e => setFilterVal(e.target.value)}
                    className="input-field w-full text-xs"
                  />
                </div>
                <button
                  onClick={handleExecuteFilter}
                  disabled={isProcessing || filterVal === ''}
                  className="w-full btn-primary py-2 text-xs font-semibold cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isProcessing ? 'Filtering...' : 'Apply Filter'}
                </button>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
