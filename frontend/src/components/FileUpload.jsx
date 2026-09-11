import { useState, useRef } from 'react';
import { UploadSimple, CheckCircle, Warning, FileText } from '@phosphor-icons/react';

const SUPPORTED_EXTS = ['.csv', '.xlsx', '.xls', '.xlsm', '.xlsb', '.json', '.jsonl', '.tsv', '.tab', '.txt', '.parquet'];
const ACCEPT_STRING = SUPPORTED_EXTS.join(',');

export default function FileUpload({
  onUploadSuccess,
  isUploading,
  setIsUploading,
  authFetch,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const doFetch = authFetch || fetch;

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const uploadFile = async (file) => {
    if (!file) return;

    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    if (!SUPPORTED_EXTS.includes(fileExt)) {
      setError(`Unsupported file type (${fileExt}). Supported: CSV, Excel (.xlsx, .xls), JSON, TSV, Parquet`);
      return;
    }

    setError('');
    setFileName(file.name);
    setIsUploading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await doFetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onUploadSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) uploadFile(e.dataTransfer.files[0]);
  };

  const handleChange = (e) => {
    if (e.target.files?.[0]) uploadFile(e.target.files[0]);
  };

  return (
    <div className="p-2.5">
      <div
        className={`relative rounded-lg p-2.5 text-center cursor-pointer border border-dashed transition-colors ${
          dragActive
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
            : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-elevated)]'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_STRING}
          className="hidden"
          onChange={handleChange}
        />

        {isUploading ? (
          <div className="flex flex-col items-center gap-1.5 py-1">
            <div className="w-3.5 h-3.5 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
            <p className="text-[11px] text-[var(--color-text-secondary)] font-medium">
              Parsing & loading dataset...
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 py-0.5 group">
            <div className="text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)] transition-colors">
              <UploadSimple size={15} />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-primary)] leading-tight">
                Import data file
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                CSV, Excel, JSON, TSV, Parquet
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-1 justify-center text-[11px] text-[var(--color-danger)] leading-normal">
          <Warning size={12} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {fileName && !isUploading && !error && (
        <div className="mt-2 flex items-center justify-center gap-1 text-[11px] text-[var(--color-success)] font-medium">
          <CheckCircle size={12} weight="fill" />
          <span className="truncate max-w-[150px]">{fileName} ready</span>
        </div>
      )}
    </div>
  );
}
