import { useState, useEffect } from 'react';
import {
  Broom,
  MagicWand,
  PaperPlaneRight,
  ChatCircleDots,
  Lightning, 
  Check, 
  X, 
  Sparkle, 
  WarningCircle, 
  CheckCircle, 
  ArrowsClockwise, 
  Eye, 
  ShieldCheck, 
  Trash, 
  ArrowRight,
  Sliders,
  CaretRight,
  Funnel,
  Info
} from '@phosphor-icons/react';

export default function DataCleaningModal({ 
  isOpen, 
  onClose, 
  onCleanSuccess, 
  authFetch, 
  datasetInfo,
  initialQualityProfile = null
}) {
  const [profile, setProfile] = useState(initialQualityProfile);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  
  // User cleaning decisions
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [standardizeText, setStandardizeText] = useState(true);
  const [columnActions, setColumnActions] = useState({});
  const [outlierActions, setOutlierActions] = useState({});
  
  // Active issue view: 'missing' | 'outliers'
  const [activeTab, setActiveTab] = useState('missing');

  // Workflow step: 'configure' | 'preview' | 'applied'
  const [step, setStep] = useState('configure');
  const [previewResult, setPreviewResult] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedSummary, setAppliedSummary] = useState(null);
  const [error, setError] = useState('');
  // AI Cleaning Agent States
  const [aiPrompt, setAiPrompt] = useState('');
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiPlan, setAiPlan] = useState(null);
  const [aiMode, setAiMode] = useState(null); // 'auto' | 'prompt'
  const [showPromptInput, setShowPromptInput] = useState(false);


  // Fetch quality profile if not passed
  useEffect(() => {
    if (!isOpen) return;

    if (initialQualityProfile) {
      initSelections(initialQualityProfile);
      setProfile(initialQualityProfile);
      return;
    }

    const fetchQuality = async () => {
      setIsLoadingProfile(true);
      setError('');
      try {
        const doFetch = authFetch || fetch;
        const res = await doFetch('/api/datasets/profile-quality', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ db_path: datasetInfo?.db_path })
        });
        if (!res.ok) throw new Error('Failed to analyze dataset quality');
        const data = await res.json();
        setProfile(data);
        initSelections(data);
      } catch (err) {
        console.error('Profile fetch error:', err);
        setError(err.message || 'Could not profile dataset');
      } finally {
        setIsLoadingProfile(false);
      }
    };

    fetchQuality();
  }, [isOpen, initialQualityProfile, datasetInfo]);

  const initSelections = (prof) => {
    if (!prof || !prof.columns) return;
    setRemoveDuplicates((prof.duplicate_rows || 0) > 0);

    const initialColActions = {};
    const initialOutlierActions = {};

    prof.columns.forEach((col) => {
      // ONLY initialize missing action if the column actually has missing values
      if (col.missing_count > 0) {
        initialColActions[col.name] = {
          action: col.default_action || (col.type_category === 'numeric' ? 'median' : 'unknown'),
          custom_value: '',
          label: 'Unknown'
        };
      }
      // ONLY initialize outlier action if the column actually has outliers
      if (col.outlier_count > 0) {
        initialOutlierActions[col.name] = 'retain'; // Default to safe retention
      }
    });

    setColumnActions(initialColActions);
    setOutlierActions(initialOutlierActions);
    setStep('configure');
    setPreviewResult(null);
    setAppliedSummary(null);

    // Set sensible default active tab
    if ((prof.missing_cells_total || 0) > 0) {
      setActiveTab('missing');
    } else if ((prof.total_outliers || 0) > 0) {
      setActiveTab('outliers');
    } else {
      setActiveTab('missing');
    }
  };

  const handleActionChange = (colName, action) => {
    setColumnActions((prev) => ({
      ...prev,
      [colName]: {
        ...(prev[colName] || {}),
        action,
      }
    }));
  };

  const handleCustomValueChange = (colName, customValue) => {
    setColumnActions((prev) => ({
      ...prev,
      [colName]: {
        ...(prev[colName] || {}),
        custom_value: customValue,
      }
    }));
  };

  const handleOutlierActionChange = (colName, action) => {
    setOutlierActions((prev) => ({
      ...prev,
      [colName]: action
    }));
  };

  const handleApplyDefaults = () => {
    if (!profile?.columns) return;
    initSelections(profile);
  };

  
  // AI Cleaning Agent API Call
  const handleRunAICleaning = async (promptOverride = null) => {
    setIsLoadingAI(true);
    setError('');
    const targetPrompt = promptOverride !== null ? promptOverride : (aiPrompt.trim() ? aiPrompt.trim() : null);

    try {
      const doFetch = authFetch || fetch;
      const res = await doFetch('/api/datasets/ai-clean-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db_path: datasetInfo?.db_path,
          prompt: targetPrompt,
        }),
      });

      const plan = await res.json();
      if (!res.ok) throw new Error(plan.error || 'Failed to generate AI cleaning plan');

      // Update cleaning selections based on AI plan
      if (plan.column_actions) {
        setColumnActions((prev) => ({
          ...prev,
          ...plan.column_actions,
        }));
      }
      if (plan.outlier_actions) {
        setOutlierActions((prev) => ({
          ...prev,
          ...plan.outlier_actions,
        }));
      }
      if (plan.remove_duplicates !== undefined) {
        setRemoveDuplicates(plan.remove_duplicates);
      }
      if (plan.standardize_text !== undefined) {
        setStandardizeText(plan.standardize_text);
      }

      setAiPlan(plan);
      setAiMode(targetPrompt ? 'prompt' : 'auto');
    } catch (err) {
      console.error('AI cleaning plan error:', err);
      setError(err.message || 'Could not run AI cleaning agent');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleResetToKeep = () => {
    if (!profile?.columns) return;
    const keepActions = {};
    profile.columns.forEach((col) => {
      if (col.missing_count > 0) {
        keepActions[col.name] = { action: 'keep' };
      }
    });
    const keepOutliers = {};
    profile.columns.forEach((col) => {
      if (col.outlier_count > 0) {
        keepOutliers[col.name] = 'retain';
      }
    });
    setColumnActions(keepActions);
    setOutlierActions(keepOutliers);
    setRemoveDuplicates(false);
  };

  // Preview transformations
  const handleRequestPreview = async () => {
    setIsLoadingPreview(true);
    setError('');
    try {
      const doFetch = authFetch || fetch;
      const res = await doFetch('/api/datasets/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db_path: datasetInfo?.db_path,
          remove_duplicates: removeDuplicates,
          column_actions: columnActions,
          outlier_actions: outlierActions,
          standardize_text: standardizeText,
          preview_only: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview calculation failed');

      setPreviewResult(data);
      setStep('preview');
    } catch (err) {
      console.error('Preview error:', err);
      setError(err.message || 'Could not generate cleaning preview');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Apply transformations
  const handleApplyClean = async () => {
    setIsApplying(true);
    setError('');
    try {
      const doFetch = authFetch || fetch;
      const res = await doFetch('/api/datasets/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db_path: datasetInfo?.db_path,
          remove_duplicates: removeDuplicates,
          column_actions: columnActions,
          outlier_actions: outlierActions,
          standardize_text: standardizeText,
          preview_only: false,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cleaning execution failed');

      setAppliedSummary(data.summary);
      setStep('applied');

      if (onCleanSuccess) {
        onCleanSuccess(data);
      }
      if (onClose) {
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Cleaning execution failed');
    } finally {
      setIsApplying(false);
    }
  };

  if (!isOpen) return null;

  // Separate issues strictly by category so columns without missing values never appear in the missing table
  const colsWithMissing = (profile?.columns || []).filter((c) => c.missing_count > 0);
  const colsWithOutliers = (profile?.columns || []).filter((c) => c.outlier_count > 0);
  const duplicateCount = profile?.duplicate_rows || 0;
  const totalMissing = profile?.missing_cells_total || 0;
  const totalOutliers = profile?.total_outliers || 0;

  const hasAnyIssues = totalMissing > 0 || duplicateCount > 0 || totalOutliers > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-fade-in select-none">
      <div className="card w-full max-w-4xl bg-[var(--color-bg-card)] border-[var(--color-border)] shadow-2xl rounded-2xl flex flex-col max-h-[90vh] overflow-hidden my-auto">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-secondary)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 text-[var(--color-accent)] flex items-center justify-center shrink-0">
              <Broom size={18} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Dataset Quality Analysis & Cleaning
                </h3>
                {profile && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    profile.quality_score >= 80 
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                      : profile.quality_score >= 60 
                        ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' 
                        : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                  }`}>
                    Quality Score: {profile.quality_score}/100
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Review detected noise, missing values, and configure column-level transformations before analysis
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {isLoadingProfile ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <ArrowsClockwise size={28} className="animate-spin text-[var(--color-accent)]" />
              <p className="text-xs text-[var(--color-text-muted)] font-medium">Profiling dataset quality and noise patterns...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2.5">
              <WarningCircle size={18} className="shrink-0" />
              <span>{error}</span>
            </div>
          ) : !hasAnyIssues ? (
            /* Graceful Clean State */
            <div className="py-12 px-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle size={36} weight="bold" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-[var(--color-text-primary)]">
                  No Data Issues Detected!
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] max-w-md mx-auto leading-relaxed">
                  All {profile?.total_columns} columns are complete with zero missing values and zero duplicate records. 
                  Your dataset is clean, robust, and ready for analytics.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary px-5 py-2 text-xs font-semibold rounded-xl cursor-pointer shadow-md inline-flex items-center gap-2"
              >
                <span>Continue to Dashboard</span>
                <ArrowRight size={14} weight="bold" />
              </button>
            </div>
          ) : (
            <>
              {/* Quality Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Missing Values Card */}
                <div className="card p-3 bg-[var(--color-bg-secondary)] border-[var(--color-border)]">
                  <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mb-1">
                    <span>Missing Values</span>
                    {totalMissing === 0 ? (
                      <CheckCircle size={14} className="text-emerald-500" weight="bold" />
                    ) : (
                      <WarningCircle size={14} className="text-amber-500" />
                    )}
                  </div>
                  <div className="text-lg font-bold text-[var(--color-text-primary)]">
                    {totalMissing.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {profile.missing_cells_pct}% of total cells
                  </div>
                </div>

                {/* Duplicate Rows Card */}
                <div className="card p-3 bg-[var(--color-bg-secondary)] border-[var(--color-border)]">
                  <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mb-1">
                    <span>Duplicate Rows</span>
                    {duplicateCount === 0 ? (
                      <CheckCircle size={14} className="text-emerald-500" weight="bold" />
                    ) : (
                      <WarningCircle size={14} className="text-amber-500" />
                    )}
                  </div>
                  <div className="text-lg font-bold text-[var(--color-text-primary)]">
                    {duplicateCount.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {profile.duplicate_pct}% of rows
                  </div>
                </div>

                {/* Columns Affected Card */}
                <div className="card p-3 bg-[var(--color-bg-secondary)] border-[var(--color-border)]">
                  <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mb-1">
                    <span>Columns with Missing</span>
                    <Sliders size={14} className={colsWithMissing.length > 0 ? "text-amber-500" : "text-emerald-500"} />
                  </div>
                  <div className="text-lg font-bold text-[var(--color-text-primary)]">
                    {colsWithMissing.length} / {profile.total_columns}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {colsWithMissing.length === 0 ? 'All columns complete' : 'Contain missing fields'}
                  </div>
                </div>

                {/* Potential Outliers Card */}
                <div className="card p-3 bg-[var(--color-bg-secondary)] border-[var(--color-border)]">
                  <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mb-1">
                    <span>Potential Outliers</span>
                    <Info size={14} className={totalOutliers > 0 ? "text-blue-400" : "text-emerald-500"} />
                  </div>
                  <div className="text-lg font-bold text-[var(--color-text-primary)]">
                    {totalOutliers.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {colsWithOutliers.length} numerical columns
                  </div>
                </div>
              </div>

                            {/* AI Cleaning Agent Copilot Suite */}
              <div className="card p-4 bg-gradient-to-r from-[var(--color-bg-secondary)] via-[var(--color-bg-card)] to-[var(--color-bg-secondary)] border border-[var(--color-accent)]/30 rounded-xl space-y-3.5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center justify-center font-bold">
                      <Sparkle size={16} weight="fill" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--color-text-primary)]">AI Data Cleaning Agent</span>
                        <span className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.2 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                          Intelligent Automation
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        Use 1-click intelligent auto-clean or describe custom cleaning instructions in plain English
                      </p>
                    </div>
                  </div>

                  {/* Top Two AI Buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowPromptInput(false);
                        handleRunAICleaning(null);
                      }}
                      disabled={isLoadingAI}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5 bg-gradient-to-r from-[var(--color-accent)] to-blue-600 hover:opacity-90 text-white shadow-xs transition-all disabled:opacity-50"
                      title="Automatically analyze and configure optimal cleaning transformations"
                    >
                      {isLoadingAI && aiMode === 'auto' ? (
                        <>
                          <ArrowsClockwise size={13} className="animate-spin" />
                          <span>Auto-Cleaning...</span>
                        </>
                      ) : (
                        <>
                          <MagicWand size={14} weight="bold" />
                          <span>Auto-Clean with AI</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowPromptInput((prev) => !prev)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5 border transition-all ${
                        showPromptInput
                          ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border-[var(--color-border)]'
                          : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border-[var(--color-border)]'
                      }`}
                    >
                      <ChatCircleDots size={14} weight="bold" className="text-[var(--color-accent)]" />
                      <span>{showPromptInput ? 'Hide AI Prompt' : 'Custom AI Prompt'}</span>
                    </button>
                  </div>
                </div>

                {/* Prompt Input Drawer */}
                {showPromptInput && (
                  <div className="pt-2 border-t border-[var(--color-border)]/60 space-y-2 animate-fade-in">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (aiPrompt.trim()) handleRunAICleaning(aiPrompt.trim());
                      }}
                      className="flex items-center gap-2"
                    >
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          placeholder="e.g. 'Fill missing numbers with median, replace unknown text with Unknown, and remove duplicates'..."
                          className="input-field w-full text-xs py-2 px-3 pr-8 bg-[var(--color-bg-primary)] border-[var(--color-border)] rounded-lg focus:border-[var(--color-accent)]"
                          autoFocus
                        />
                        {aiPrompt && (
                          <button
                            type="button"
                            onClick={() => setAiPrompt('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={isLoadingAI || !aiPrompt.trim()}
                        className="btn-primary px-3.5 py-2 text-xs font-semibold rounded-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                      >
                        {isLoadingAI && aiMode === 'prompt' ? (
                          <ArrowsClockwise size={13} className="animate-spin" />
                        ) : (
                          <PaperPlaneRight size={13} weight="bold" />
                        )}
                        <span>Run Agent</span>
                      </button>
                    </form>

                    {/* Quick suggestion prompt chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-[var(--color-text-muted)] font-medium">Quick suggestions:</span>
                      {[
                        'Fill missing values with median & Unknown and drop duplicates',
                        'Impute numbers with 0 and fill text with Unknown',
                        'Drop rows with missing values and clip extreme outliers',
                        'Keep all raw values and only purge duplicate rows'
                      ].map((chip, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setAiPrompt(chip);
                            handleRunAICleaning(chip);
                          }}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] border border-[var(--color-border)] cursor-pointer transition-colors"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Plan Execution & Reasoning Result Banner */}
                {aiPlan && (
                  <div className="p-3 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 text-xs space-y-2 animate-fade-in">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <Sparkle size={15} weight="fill" className="text-[var(--color-accent)] shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <span className="font-semibold text-[var(--color-accent)]">
                            {aiMode === 'prompt' ? 'AI Agent Custom Plan Applied' : 'AI Auto-Clean Plan Configured'}
                          </span>
                          <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
                            {aiPlan.reasoning}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleRequestPreview}
                          disabled={isLoadingPreview}
                          className="btn-secondary px-2.5 py-1 text-[11px] font-semibold rounded-lg cursor-pointer flex items-center gap-1"
                        >
                          <Eye size={12} weight="bold" />
                          <span>Preview</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleApplyClean}
                          disabled={isApplying}
                          className="btn-primary px-3 py-1 text-[11px] font-semibold rounded-lg cursor-pointer flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                          <Check size={12} weight="bold" />
                          <span>Apply Now</span>
                        </button>
                      </div>
                    </div>

                    {/* Summary Badges */}
                    {aiPlan.summary_items?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {aiPlan.summary_items.slice(0, 6).map((item, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[10px] text-[var(--color-text-secondary)]"
                          >
                            <span className="font-semibold text-[var(--color-text-primary)]">{item.title}:</span>
                            <span className="text-[var(--color-accent)] font-mono">{item.badge}</span>
                          </span>
                        ))}
                        {aiPlan.summary_items.length > 6 && (
                          <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                            +{aiPlan.summary_items.length - 6} more actions
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Deduplication & Global Options */}
              <div className="card p-3.5 bg-[var(--color-bg-secondary)] border-[var(--color-border)] flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--color-text-primary)]">
                    <input 
                      type="checkbox" 
                      checked={removeDuplicates} 
                      onChange={(e) => setRemoveDuplicates(e.target.checked)}
                      disabled={duplicateCount === 0}
                      className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-accent)] cursor-pointer"
                    />
                    <span>
                      {duplicateCount > 0 ? (
                        <>Remove Duplicate Rows <span className="font-bold text-amber-500 font-mono">({duplicateCount} detected)</span></>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">No duplicate rows detected</span>
                      )}
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--color-text-primary)]">
                    <input 
                      type="checkbox" 
                      checked={standardizeText} 
                      onChange={(e) => setStandardizeText(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-accent)] cursor-pointer"
                    />
                    <span>Trim Whitespace & Clean Text</span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleApplyDefaults}
                    className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline cursor-pointer"
                  >
                    Auto-Fill Recommendations
                  </button>
                  <span className="text-[var(--color-text-muted)]">•</span>
                  <button
                    type="button"
                    onClick={handleResetToKeep}
                    className="text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  >
                    Reset (Keep All)
                  </button>
                </div>
              </div>

              {/* Step Navigation Tabs */}
              <div className="flex items-center gap-3 border-b border-[var(--color-border)] pb-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setStep('configure')}
                  className={`pb-1 border-b-2 transition-all cursor-pointer ${
                    step === 'configure' 
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]' 
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  1. Configure Actions
                </button>
                <CaretRight size={12} className="text-[var(--color-text-muted)]" />
                <button
                  type="button"
                  onClick={handleRequestPreview}
                  disabled={isLoadingPreview}
                  className={`pb-1 border-b-2 transition-all cursor-pointer ${
                    step === 'preview' 
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]' 
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  2. Preview Changes
                </button>
                {step === 'applied' && (
                  <>
                    <CaretRight size={12} className="text-[var(--color-text-muted)]" />
                    <span className="pb-1 border-b-2 border-emerald-500 text-emerald-500 flex items-center gap-1">
                      <CheckCircle size={13} weight="bold" /> 3. Applied & Materialized
                    </span>
                  </>
                )}
              </div>

              {/* View Step 1: Configure Actions */}
              {step === 'configure' && (
                <div className="space-y-4">
                  {/* Category Filter Pills */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('missing')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                        activeTab === 'missing'
                          ? 'bg-[var(--color-accent)] text-white shadow-xs'
                          : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)]'
                      }`}
                    >
                      <span>Missing Values</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        activeTab === 'missing' ? 'bg-white/20 text-white' : 'bg-[var(--color-bg-primary)] text-[var(--color-text-muted)]'
                      }`}>
                        {colsWithMissing.length}
                      </span>
                    </button>

                    {colsWithOutliers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('outliers')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                          activeTab === 'outliers'
                            ? 'bg-[var(--color-accent)] text-white shadow-xs'
                            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)]'
                        }`}
                      >
                        <span>Outliers Analysis</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                          activeTab === 'outliers' ? 'bg-white/20 text-white' : 'bg-[var(--color-bg-primary)] text-[var(--color-text-muted)]'
                        }`}>
                          {colsWithOutliers.length}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* TAB A: Missing Values Resolution Table */}
                  {activeTab === 'missing' && (
                    <div className="space-y-3">
                      {colsWithMissing.length === 0 ? (
                        /* Explicit reassurance when zero missing values exist */
                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
                          <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" weight="bold" />
                          <div className="text-xs space-y-1">
                            <span className="font-semibold text-emerald-500">
                              Zero Missing Values Detected
                            </span>
                            <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
                              All {profile?.total_columns} columns in this dataset are complete with no null or empty cells. 
                              No missing value imputation is necessary.
                              {duplicateCount > 0 ? ` You can review duplicate rows above, or proceed to the dashboard.` : ''}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-bg-card)]">
                          <div className="max-h-[380px] overflow-y-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] uppercase tracking-wider text-[10px] sticky top-0 border-b border-[var(--color-border)] z-10">
                                <tr>
                                  <th className="py-2.5 px-3 font-semibold">Column</th>
                                  <th className="py-2.5 px-3 font-semibold">Data Type</th>
                                  <th className="py-2.5 px-3 font-semibold text-right">Missing</th>
                                  <th className="py-2.5 px-3 font-semibold text-right">Missing %</th>
                                  <th className="py-2.5 px-3 font-semibold">Suggested Action</th>
                                  <th className="py-2.5 px-3 font-semibold w-56">Cleaning Decision</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--color-border)]">
                                {colsWithMissing.map((col) => {
                                  const currentAction = columnActions[col.name]?.action || 'keep';
                                  const isCustom = currentAction === 'custom';

                                  return (
                                    <tr key={col.name} className="hover:bg-[var(--color-bg-hover)] transition-colors">
                                      <td className="py-2.5 px-3 font-semibold text-[var(--color-text-primary)]">
                                        <span>{col.name}</span>
                                      </td>
                                      <td className="py-2.5 px-3 text-[var(--color-text-secondary)]">
                                        <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[10px] font-mono">
                                          {col.data_type}
                                        </span>
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-mono text-[var(--color-text-primary)]">
                                        {col.missing_count.toLocaleString()}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-mono">
                                        <span className={col.missing_pct > 20 ? 'text-rose-500 font-bold' : col.missing_pct > 5 ? 'text-amber-500' : 'text-[var(--color-text-muted)]'}>
                                          {col.missing_pct}%
                                        </span>
                                      </td>
                                      <td className="py-2.5 px-3 text-[11px] text-[var(--color-text-secondary)] max-w-xs truncate" title={col.suggested_action}>
                                        {col.suggested_action}
                                      </td>
                                      <td className="py-2.5 px-3">
                                        <div className="space-y-1.5">
                                          <select
                                            value={currentAction}
                                            onChange={(e) => handleActionChange(col.name, e.target.value)}
                                            className="input-field w-full text-xs py-1 px-2 cursor-pointer bg-[var(--color-bg-primary)] border-[var(--color-border)]"
                                          >
                                            {(col.allowed_actions || []).map((act) => (
                                              <option key={act.id} value={act.id}>
                                                {act.label}
                                              </option>
                                            ))}
                                          </select>

                                          {isCustom && (
                                            <input
                                              type={col.type_category === 'numeric' ? 'number' : 'text'}
                                              placeholder={col.type_category === 'numeric' ? 'e.g. 0' : 'e.g. Unknown or N/A'}
                                              value={columnActions[col.name]?.custom_value ?? ''}
                                              onChange={(e) => handleCustomValueChange(col.name, e.target.value)}
                                              className="input-field w-full text-xs py-1 px-2 bg-[var(--color-bg-primary)] border-[var(--color-border)]"
                                              autoFocus
                                            />
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB B: Outlier Analysis Section (Cleanly separated from missing values) */}
                  {activeTab === 'outliers' && colsWithOutliers.length > 0 && (
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-[var(--color-text-secondary)] flex items-start gap-2.5">
                        <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <span className="font-semibold text-blue-400">Understanding Statistical Outliers</span>
                          <p className="text-[11px] leading-relaxed">
                            Outliers are data points that fall outside Tukey's IQR boundaries (1.5 × IQR beyond Q1 or Q3). 
                            They often represent genuine real-world events. We default to <strong>Keep All (Safe)</strong> so valid observations are preserved.
                          </p>
                        </div>
                      </div>

                      <div className="border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-bg-card)]">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--color-border)]">
                            <tr>
                              <th className="py-2.5 px-3 font-semibold">Column</th>
                              <th className="py-2.5 px-3 font-semibold">Data Type</th>
                              <th className="py-2.5 px-3 font-semibold text-right">Outliers</th>
                              <th className="py-2.5 px-3 font-semibold text-right">Outlier %</th>
                              <th className="py-2.5 px-3 font-semibold">IQR Expected Bounds</th>
                              <th className="py-2.5 px-3 font-semibold w-56">Outlier Handling</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {colsWithOutliers.map((col) => {
                              const currentStrategy = outlierActions[col.name] || 'retain';
                              const bounds = col.outlier_bounds || [];

                              return (
                                <tr key={col.name} className="hover:bg-[var(--color-bg-hover)] transition-colors">
                                  <td className="py-2.5 px-3 font-semibold text-[var(--color-text-primary)]">
                                    <span>{col.name}</span>
                                  </td>
                                  <td className="py-2.5 px-3 text-[var(--color-text-secondary)]">
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[10px] font-mono">
                                      {col.data_type}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[var(--color-text-primary)] font-bold">
                                    {col.outlier_count.toLocaleString()}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[var(--color-text-muted)]">
                                    {col.outlier_pct}%
                                  </td>
                                  <td className="py-2.5 px-3 text-[11px] text-[var(--color-text-secondary)] font-mono">
                                    {bounds.length === 2 ? `[${bounds[0]}, ${bounds[1]}]` : 'Calculated via IQR'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <select
                                      value={currentStrategy}
                                      onChange={(e) => handleOutlierActionChange(col.name, e.target.value)}
                                      className="input-field w-full text-xs py-1 px-2 cursor-pointer bg-[var(--color-bg-primary)] border-[var(--color-border)]"
                                    >
                                      <option value="retain">Keep All (Safe - Recommended)</option>
                                      <option value="clip_iqr">Cap to IQR Fences (Clip Extremes)</option>
                                      <option value="drop_outliers">Remove Outlier Rows</option>
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* View Step 2: Preview Summary & Sample */}
              {step === 'preview' && previewResult && (
                <div className="space-y-4 animate-fade-in">
                  <div className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-3">
                    <h4 className="text-xs font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5">
                      <Eye size={15} className="text-[var(--color-accent)]" />
                      <span>Impact of Proposed Cleaning Operations</span>
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="card p-2.5 bg-[var(--color-bg-card)]">
                        <span className="text-[10px] text-[var(--color-text-muted)] block">Row Count</span>
                        <div className="font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
                          <span>{previewResult.summary.initial_rows.toLocaleString()}</span>
                          <ArrowRight size={10} className="text-[var(--color-text-muted)]" />
                          <span className="text-emerald-500">{previewResult.summary.final_rows.toLocaleString()}</span>
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          -{previewResult.summary.rows_removed} rows removed
                        </span>
                      </div>

                      <div className="card p-2.5 bg-[var(--color-bg-card)]">
                        <span className="text-[10px] text-[var(--color-text-muted)] block">Missing Values</span>
                        <div className="font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
                          <span>{previewResult.summary.initial_missing.toLocaleString()}</span>
                          <ArrowRight size={10} className="text-[var(--color-text-muted)]" />
                          <span className="text-emerald-500">{previewResult.summary.final_missing.toLocaleString()}</span>
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {previewResult.summary.values_filled} cells imputed
                        </span>
                      </div>

                      <div className="card p-2.5 bg-[var(--color-bg-card)]">
                        <span className="text-[10px] text-[var(--color-text-muted)] block">Duplicates Purged</span>
                        <div className="font-bold text-emerald-500 text-sm">
                          {previewResult.summary.rows_dropped_duplicates}
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)]">exact duplicates removed</span>
                      </div>

                      <div className="card p-2.5 bg-[var(--color-bg-card)]">
                        <span className="text-[10px] text-[var(--color-text-muted)] block">Outliers Clipped</span>
                        <div className="font-bold text-[var(--color-text-primary)] text-sm">
                          {previewResult.summary.outliers_clipped}
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)]">extreme values bounded</span>
                      </div>
                    </div>

                    {/* Columns Modified List */}
                    {previewResult.summary.columns_modified?.length > 0 && (
                      <div className="pt-2">
                        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1">
                          Column Imputation Log:
                        </span>
                        <div className="space-y-1">
                          {previewResult.summary.columns_modified.map((mod, idx) => (
                            <div key={idx} className="text-[11px] flex items-center gap-2 text-[var(--color-text-secondary)]">
                              <span className="font-mono font-semibold text-[var(--color-text-primary)]">{mod.column}</span>:
                              <span>{mod.action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cleaned Data Sample Preview */}
                  {previewResult.sample_rows && previewResult.sample_rows.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                        Transformed Data Sample (First 5 Rows)
                      </span>
                      <div className="border border-[var(--color-border)] rounded-xl overflow-x-auto bg-[var(--color-bg-card)]">
                        <table className="text-left text-[11px] border-collapse w-full">
                          <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] text-[10px] border-b border-[var(--color-border)]">
                            <tr>
                              {Object.keys(previewResult.sample_rows[0] || {}).slice(0, 7).map((col) => (
                                <th key={col} className="p-2 font-mono whitespace-nowrap">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {previewResult.sample_rows.slice(0, 5).map((row, i) => (
                              <tr key={i} className="hover:bg-[var(--color-bg-hover)]">
                                {Object.values(row).slice(0, 7).map((val, j) => (
                                  <td key={j} className="p-2 font-mono whitespace-nowrap text-[var(--color-text-secondary)]">
                                    {val === null || val === undefined ? <span className="text-rose-400">null</span> : String(val)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* View Step 3: Success Confirmation */}
              {step === 'applied' && appliedSummary && (
                <div className="py-8 text-center space-y-4 animate-fade-in">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 flex items-center justify-center mx-auto">
                    <CheckCircle size={32} weight="bold" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-base font-bold text-[var(--color-text-primary)]">
                      Cleaning Applied Successfully!
                    </h4>
                    <p className="text-xs text-[var(--color-text-secondary)] max-w-md mx-auto">
                      Dataset now has {appliedSummary.final_rows.toLocaleString()} clean rows. 
                      Original raw dataset is backed up in <span className="font-mono">data_original</span> and can be reverted at any time.
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="btn-primary px-5 py-2 text-xs font-semibold rounded-xl cursor-pointer shadow-md inline-flex items-center gap-2"
                    >
                      <span>Continue to Visual Dashboard</span>
                      <ArrowRight size={14} weight="bold" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-3.5 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span>Original dataset is always preserved and reversible.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary px-3.5 py-1.5 text-xs font-semibold rounded-xl cursor-pointer"
            >
              Skip & Keep Raw Data
            </button>

            {step === 'configure' && hasAnyIssues && (
              <>
                <button
                  type="button"
                  onClick={handleRequestPreview}
                  disabled={isLoadingPreview || isApplying}
                  className="btn-secondary px-3.5 py-1.5 text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-1.5"
                >
                  {isLoadingPreview ? (
                    <>
                      <ArrowsClockwise size={13} className="animate-spin" />
                      <span>Previewing...</span>
                    </>
                  ) : (
                    <>
                      <Eye size={14} weight="bold" />
                      <span>Preview Changes</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleApplyClean}
                  disabled={isApplying || isLoadingPreview}
                  className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
                >
                  {isApplying ? (
                    <>
                      <ArrowsClockwise size={13} className="animate-spin" />
                      <span>Applying Transformations...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} weight="bold" />
                      <span>Apply Selected Changes</span>
                    </>
                  )}
                </button>
              </>
            )}

            {step === 'preview' && (
              <>
                <button
                  type="button"
                  onClick={() => setStep('configure')}
                  className="btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Back to Configure
                </button>
                <button
                  type="button"
                  onClick={handleApplyClean}
                  disabled={isApplying}
                  className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
                >
                  {isApplying ? (
                    <>
                      <ArrowsClockwise size={13} className="animate-spin" />
                      <span>Applying Transformations...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} weight="bold" />
                      <span>Confirm & Apply Cleaning</span>
                    </>
                  )}
                </button>
              </>
            )}

            {step === 'applied' && (
              <button
                type="button"
                onClick={onClose}
                className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Done
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
