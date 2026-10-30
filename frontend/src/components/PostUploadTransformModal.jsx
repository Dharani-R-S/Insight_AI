import { GitMerge, SquaresFour, Broom, ArrowRight, CheckCircle, WarningCircle } from '@phosphor-icons/react';

export default function PostUploadTransformModal({ 
  datasetInfo, 
  onCleanClick,
  onTransformClick, 
  onDashboardClick 
}) {
  if (!datasetInfo) return null;

  const quality = datasetInfo.quality_profile;
  const hasIssues = quality?.has_issues;
  const missingCount = quality?.missing_cells_total ?? 0;
  const dupCount = quality?.duplicate_rows ?? 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 select-none">
      <div className="card p-6 bg-[var(--color-bg-card)] border-[var(--color-border)] w-full max-w-xl space-y-5 text-left shadow-2xl animate-fade-in font-sans">
        
        {/* Header Badge */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0">
            <CheckCircle size={22} weight="bold" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] tracking-tight">
              Dataset Loaded Successfully
            </h3>
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mt-0.5">
              <span className="font-medium text-[var(--color-text-secondary)]">{datasetInfo.name || datasetInfo.table_name || 'Dataset'}</span>
              <span>•</span>
              <span className="font-mono">{datasetInfo.row_count?.toLocaleString()} rows</span>
              <span>•</span>
              <span className="font-mono">{datasetInfo.columns?.length} cols</span>
            </div>
          </div>
        </div>

        {/* Quality status banner if issues detected */}
        {hasIssues ? (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
            <WarningCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-semibold text-amber-500">
                Quality issues detected ({quality.quality_score}/100 quality score)
              </span>
              <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
                Found {missingCount.toLocaleString()} missing values across {quality.columns_with_missing_count} columns
                {dupCount > 0 ? ` and ${dupCount} duplicate rows` : ''}. 
                We recommend reviewing and cleaning these issues before analyzing.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Your dataset has been analyzed and indexed. Would you like to review data quality, apply transformations, or proceed straight to the Dashboard?
          </p>
        )}

        {/* Choice Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          
          {/* Choice 1: Review Quality & Clean */}
          <button
            onClick={onCleanClick}
            className={`card p-3.5 border cursor-pointer text-left transition-all space-y-2 group ${
              hasIssues 
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5 hover:bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]/30' 
                : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)] bg-[var(--color-bg-secondary)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-[var(--color-accent)] text-white">
                <Broom size={16} />
              </div>
              <ArrowRight size={13} className="text-[var(--color-accent)] group-hover:translate-x-1 transition-transform" />
            </div>
            <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">
              Quality & Clean
            </h4>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-normal">
              {hasIssues ? `Fix ${missingCount} nulls & noise` : 'Review column noise & outliers'}
            </p>
          </button>

          {/* Choice 2: Transformation Studio */}
          <button
            onClick={onTransformClick}
            className="card p-3.5 border-[var(--color-border)] hover:border-[var(--color-border-hover)] bg-[var(--color-bg-secondary)] cursor-pointer text-left transition-all space-y-2 group"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">
                <GitMerge size={16} />
              </div>
              <ArrowRight size={13} className="text-[var(--color-text-muted)] group-hover:translate-x-1 transition-transform" />
            </div>
            <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">
              Transform Studio
            </h4>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-normal">
              Merge CSVs, formulas, group & aggregate.
            </p>
          </button>

          {/* Choice 3: Dashboard */}
          <button
            onClick={onDashboardClick}
            className="card p-3.5 border-[var(--color-border)] hover:border-[var(--color-border-hover)] bg-[var(--color-bg-secondary)] cursor-pointer text-left transition-all space-y-2 group"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">
                <SquaresFour size={16} />
              </div>
              <ArrowRight size={13} className="text-[var(--color-text-muted)] group-hover:translate-x-1 transition-transform" />
            </div>
            <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">
              Go to Dashboard
            </h4>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-normal">
              Proceed to executive auto-charts & AI.
            </p>
          </button>

        </div>

      </div>
    </div>
  );
}
