import { 
  SquaresFour, 
  ChatTeardropText, 
  ChartBar, 
  Table, 
  Lightbulb, 
  Database, 
  Sparkle, 
  Moon, 
  Sun,
  SignOut,
  LockKey,
  ShareNetwork,
  GitMerge,
  Gear
} from '@phosphor-icons/react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: SquaresFour },
  { id: 'ask', label: 'Ask AI', icon: ChatTeardropText },
  { id: 'transform', label: 'Transformations', icon: GitMerge },
  { id: 'graph', label: 'Knowledge Graph', icon: ShareNetwork },
  { id: 'visualize', label: 'Visualize', icon: ChartBar },
  { id: 'data', label: 'Browse Table', icon: Table },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
  { id: 'sql', label: 'SQL Query', icon: Database },
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
    : '?';

  const providerName = (llmConfig?.provider || 'groq').toUpperCase();

  return (
    <aside className="w-56 h-screen flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] shrink-0 select-none">

      {/* Brand Header */}
      <div className="px-4 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-[var(--color-accent)] flex items-center justify-center text-white font-mono font-bold text-xs shadow-sm">
            IA
          </div>
          <div>
            <h1 className="text-xs font-mono font-bold text-[var(--color-text-primary)] tracking-tight">INSIGHTAI</h1>
            <p className="text-[9px] text-[var(--color-text-muted)] font-mono">DATABASE ASSISTANT</p>
          </div>
        </div>
        <button 
          onClick={onToggleTheme} 
          className="theme-toggle p-1.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer font-mono"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>

      {/* Upload Drop Zone */}
      <div className="border-b border-[var(--color-border)]">
        {children}
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        <div>
          <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--color-text-muted)] px-2 mb-2">
            WORKSPACE
          </p>
          <div className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              const isLocked = item.id !== 'dashboard' && !datasetInfo;
              return (
                <button
                  key={item.id}
                  onClick={() => !isLocked && onNavigate(item.id)}
                  disabled={isLocked}
                  title={isLocked ? 'Upload a dataset first' : item.label}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-mono font-medium transition-all duration-150 group cursor-pointer
                    ${isActive
                      ? 'bg-[var(--color-bg-card)] text-[var(--color-accent)] border border-[var(--color-border)] shadow-xs font-bold'
                      : isLocked
                        ? 'text-[var(--color-text-muted)] opacity-40 cursor-not-allowed'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-text-primary)]'
                    }`}
                >
                  <Icon size={15} weight={isActive ? "bold" : "regular"} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {isLocked && <LockKey size={11} className="opacity-60" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dataset Metadata Card */}
        {datasetInfo && (
          <div className="pt-3 border-t border-[var(--color-border)]">
            <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--color-text-muted)] px-2 mb-2">
              ACTIVE DATASET
            </p>
            <div className="card p-2.5 border-[var(--color-border)] bg-[var(--color-bg-card)] mx-0 space-y-2">
              <div className="flex items-center justify-between text-[10px] text-[var(--color-text-secondary)] font-mono font-bold">
                <span>{datasetInfo.row_count?.toLocaleString()} rows</span>
                <span>{datasetInfo.columns?.length} cols</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {datasetInfo.columns?.slice(0, 4).map((col) => (
                  <span key={col} className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] font-mono border border-[var(--color-border)] truncate max-w-[80px]">
                    {col}
                  </span>
                ))}
                {datasetInfo.columns?.length > 4 && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] font-mono">
                    +{datasetInfo.columns.length - 4}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* User / Settings / Sign Out Footer */}
      <div className="px-3 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-card)]">
        {user ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent)] flex items-center justify-center text-[10px] font-mono font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-mono font-bold text-[var(--color-text-primary)] truncate leading-none mb-0.5">{user.name}</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] inline-block"></span>
                  <span className="text-[9px] text-[var(--color-text-muted)] font-mono truncate">{providerName}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-0.5">
              <button
                onClick={onOpenSettings}
                title="AI Engine & API Keys Settings"
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] p-1.5 rounded-lg hover:bg-[var(--color-accent)]/10 transition-colors cursor-pointer"
              >
                <Gear size={15} weight="bold" />
              </button>
              <button
                onClick={onLogout}
                title="Sign out"
                className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1.5 rounded-lg hover:bg-[var(--color-danger)]/10 transition-colors cursor-pointer"
              >
                <SignOut size={15} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-[9px] text-[var(--color-text-muted)] font-mono font-bold">Engine: {providerName}</p>
            <button
              onClick={onOpenSettings}
              title="Settings"
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] p-1 rounded hover:bg-[var(--color-accent)]/10 transition-colors cursor-pointer"
            >
              <Gear size={13} weight="bold" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

