import { 
  SquaresFour, 
  ChatTeardropText, 
  ChartBar, 
  Table, 
  Lightbulb, 
  Database, 
  Moon, 
  Sun,
  SignOut,
  LockKey,
  ShareNetwork,
  GitMerge,
  Gear,
  ChartPieSlice
} from '@phosphor-icons/react';

const PRIMARY_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: SquaresFour },
  { id: 'ask', label: 'Ask AI', icon: ChatTeardropText },
  { id: 'data', label: 'Browse Table', icon: Table },
];

const TOOLS_NAV = [
  { id: 'visualize', label: 'Visual Builder', icon: ChartBar },
  { id: 'transform', label: 'Transformations', icon: GitMerge },
  { id: 'graph', label: 'Knowledge Graph', icon: ShareNetwork },
  { id: 'sql', label: 'SQL Query', icon: Database },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
];

export default function Sidebar({ 
  activePage, 
  onNavigate, 
  datasetInfo, 
  user, 
  onLogout, 
  children, 
  theme, 
  onToggleTheme,
  onOpenSettings,
  llmConfig,
}) {
  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  const providerName = (llmConfig?.provider || 'groq').toUpperCase();

  const renderNavGroup = (items, title) => (
    <div className="mb-4">
      {title && (
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)] px-2.5 mb-1.5">
          {title}
        </p>
      )}
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          const isLocked = item.id !== 'dashboard' && !datasetInfo;
          return (
            <button
              key={item.id}
              onClick={() => !isLocked && onNavigate(item.id)}
              disabled={isLocked}
              title={isLocked ? 'Upload a dataset first' : item.label}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors group cursor-pointer
                ${isActive
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-semibold'
                  : isLocked
                    ? 'text-[var(--color-text-muted)] opacity-40 cursor-not-allowed'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]'
                }`}
            >
              <Icon 
                size={15} 
                weight={isActive ? "bold" : "regular"} 
                className={isActive ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)]"} 
              />
              <span className="flex-1 text-left truncate">{item.label}</span>
              {isLocked && <LockKey size={12} className="opacity-40" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <aside className="w-56 h-screen flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] shrink-0 select-none">

      {/* Brand Header */}
      <div className="px-3.5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-[var(--color-accent)] flex items-center justify-center text-white shadow-xs shrink-0">
            <ChartPieSlice size={14} weight="fill" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-[var(--color-text-primary)] tracking-tight">InsightAI</span>
              <span className="text-[9px] font-medium text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] px-1 rounded">BI</span>
            </div>
          </div>
        </div>
        <button 
          onClick={onToggleTheme} 
          className="theme-toggle"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>

      {/* Upload Drop Zone */}
      <div className="border-b border-[var(--color-border)]">
        {children}
      </div>

      {/* Navigation Menu (Reduced to Primary + Tools Groups) */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {renderNavGroup(PRIMARY_NAV, 'Main')}
        {renderNavGroup(TOOLS_NAV, 'Analysis & Tools')}

        {/* Active Dataset Metadata Mini Card */}
        {datasetInfo && (
          <div className="pt-2 border-t border-[var(--color-border)] px-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                Active Dataset
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
            </div>
            <div className="card p-2.5 bg-[var(--color-bg-card)] space-y-1.5 shadow-none">
              <div className="flex items-center justify-between text-[11px] text-[var(--color-text-primary)] font-medium">
                <span>{datasetInfo.row_count?.toLocaleString()} rows</span>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span>{datasetInfo.columns?.length} cols</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {datasetInfo.columns?.slice(0, 4).map((col) => (
                  <span key={col} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] font-mono border border-[var(--color-border)] truncate max-w-[80px]">
                    {col}
                  </span>
                ))}
                {datasetInfo.columns?.length > 4 && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] font-mono border border-[var(--color-border)]">
                    +{datasetInfo.columns.length - 4}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* User / Settings / Sign Out Footer */}
      <div className="p-2.5 border-t border-[var(--color-border)] bg-[var(--color-bg-card)]">
        {user ? (
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)] flex items-center justify-center text-[10px] font-semibold shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-text-primary)] truncate leading-none mb-1">{user.name}</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] inline-block"></span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate">{providerName}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={onOpenSettings}
                title="AI Engine Settings"
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] p-1.5 rounded-md hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
              >
                <Gear size={14} />
              </button>
              <button
                onClick={onLogout}
                title="Sign out"
                className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1.5 rounded-md hover:bg-[var(--color-danger)]/10 transition-colors cursor-pointer"
              >
                <SignOut size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[var(--color-text-muted)] font-medium">Engine: {providerName}</p>
            <button
              onClick={onOpenSettings}
              title="Settings"
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] p-1 rounded hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
            >
              <Gear size={13} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
