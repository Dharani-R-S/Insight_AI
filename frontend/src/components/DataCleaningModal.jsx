import { useState } from 'react';
import { Broom, Check, X, DownloadSimple, FileCsv, FileX, FileCode } from '@phosphor-icons/react';
import { downloadTransformedDataset } from '../utils/exportUtils';

export default function DataCleaningModal({ isOpen, onClose, onCleanSuccess, authFetch, currentData = null }) {
  const [imputeNumeric, setImputeNumeric] = useState('mean');
  const [fillText, setFillText] = useState('N/A');
  const [dropDuplicates, setDropDuplicates] = useState(true);
  const [dropEmptyCols, setDropEmptyCols] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [cleanedResult, setCleanedResult] = useState(null);

  if (!isOpen) return null;

  const handleClean = async () => {
    setIsLoading(true);
    setError('');
    setSummary(null);

    const doFetch = authFetch || fetch;

    try {
      const res = await doFetch('/api/datasets/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          impute_numeric: imputeNumeric,
          fill_text: fillText,
          drop_duplicates: dropDuplicates,
          drop_empty_cols: dropEmptyCols,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cleaning failed');

      setSummary(data.cleaned_summary);
      setCleanedResult(data);
      if (onCleanSuccess) {
        onCleanSuccess(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (format) => {
    setIsExporting(true);
    try {
      await downloadTransformedDataset({
        format,
        authFetch,
        rows: cleanedResult?.sample_rows || currentData,
        baseName: 'cleaned_transformed_dataset'
      });
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="card w-full max-w-md bg-[var(--color-bg-card)] border-[var(--color-border)] p-6 shadow-xl space-y-5">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)]">
              <Broom size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Clean & Transform Dataset</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Impute missing values, drop duplicates, and export</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1 rounded-md hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Options Form */}
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              Numeric Missing Value Imputation
            </label>
            <select
              value={imputeNumeric}
              onChange={(e) => setImputeNumeric(e.target.value)}
              className="input-field w-full text-xs cursor-pointer"
            >
              <option value="mean">Replace with Column Mean (Average)</option>
              <option value="median">Replace with Column Median</option>
              <option value="mode">Replace with Column Mode (Most Frequent)</option>
              <option value="zero">Fill with Zero (0)</option>
              <option value="none">Do Not Impute Numeric Values</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              Text / Categorical Missing Value Fill
            </label>
            <input
              type="text"
              value={fillText}
              onChange={(e) => setFillText(e.target.value)}
              placeholder="e.g. N/A or Unknown"
              className="input-field w-full text-xs"
            />
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer text-[var(--color-text-primary)] select-none">
              <input
                type="checkbox"
                checked={dropDuplicates}
                onChange={(e) => setDropDuplicates(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--color-border)] text-[var(--color-accent)] accent-[var(--color-accent)]"
              />
              <span className="text-xs">Remove exact duplicate rows</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-[var(--color-text-primary)] select-none">
              <input
                type="checkbox"
                checked={dropEmptyCols}
                onChange={(e) => setDropEmptyCols(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--color-border)] text-[var(--color-accent)] accent-[var(--color-accent)]"
              />
              <span className="text-xs">Drop completely empty columns</span>
            </label>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-xs border border-[var(--color-danger)]/20">
            {error}
          </div>
        )}

        {/* Summary output & Download Options */}
        {summary && (
          <div className="p-3.5 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-3">
            <div className="flex items-center justify-between text-xs text-[var(--color-success)] font-medium">
              <span className="flex items-center gap-1.5">
                <Check size={14} weight="bold" /> Dataset cleaned & ready!
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                -{summary.rows_removed} rows, -{summary.cols_removed} cols
              </span>
            </div>

            {/* Transformed Dataset Download Options */}
            <div className="pt-2 border-t border-[var(--color-border)]">
              <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mb-2 flex items-center gap-1.5">
                <DownloadSimple size={13} />
                <span>Download Transformed Dataset:</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleDownload('csv')}
                  disabled={isExporting}
                  className="btn-secondary text-xs py-1.5 flex items-center justify-center gap-1.5 hover:border-[var(--color-accent)] cursor-pointer"
                >
                  <FileCsv size={14} className="text-emerald-500" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload('xlsx')}
                  disabled={isExporting}
                  className="btn-secondary text-xs py-1.5 flex items-center justify-center gap-1.5 hover:border-[var(--color-accent)] cursor-pointer"
                >
                  <FileX size={14} className="text-emerald-500" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload('json')}
                  disabled={isExporting}
                  className="btn-secondary text-xs py-1.5 flex items-center justify-center gap-1.5 hover:border-[var(--color-accent)] cursor-pointer"
                >
                  <FileCode size={14} className="text-amber-500" />
                  <span>JSON</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary px-3.5 py-1.5 text-xs cursor-pointer"
          >
            {summary ? 'Done' : 'Cancel'}
          </button>
          {!summary && (
            <button
              type="button"
              onClick={handleClean}
              disabled={isLoading}
              className="btn-primary px-4 py-1.5 text-xs shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isLoading ? (
                <span>Processing...</span>
              ) : (
                <>
                  <Broom size={14} />
                  <span>Apply Cleaning</span>
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
