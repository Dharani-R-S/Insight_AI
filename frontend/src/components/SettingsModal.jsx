import { useState, useEffect } from 'react';
import { 
  X, 
  Cpu, 
  Sparkle, 
  Check, 
  CheckCircle, 
  WarningCircle, 
  Eye, 
  EyeSlash, 
  ArrowClockwise, 
  Sun, 
  Moon, 
  SignOut,
  Sliders
} from '@phosphor-icons/react';

const PROVIDER_OPTIONS = [
  { id: 'groq', name: 'Groq (Ultra-Fast)', icon: '⚡' },
  { id: 'openai', name: 'OpenAI (Direct)', icon: '🤖' },
  { id: 'ollama', name: 'Ollama (Local)', icon: '💻' },
];

const DEFAULT_GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'groq/compound',
  'groq/compound-mini',
];

export default function SettingsModal({
  isOpen,
  onClose,
  authFetch,
  user,
  onLogout,
  theme,
  onToggleTheme,
  onSettingsSaved
}) {
  const [activeTab, setActiveTab] = useState('ai'); // 'ai' | 'preferences' | 'account'
  const [provider, setProvider] = useState('groq');
  const [model, setModel] = useState('openai/gpt-oss-120b');
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasServerKey, setHasServerKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [availableModels, setAvailableModels] = useState(DEFAULT_GROQ_MODELS);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testStatus, setTestStatus] = useState(null); // { ok: bool, message: string }
  const [isTesting, setIsTesting] = useState(false);

  // Fetch current settings on open
  useEffect(() => {
    if (!isOpen) return;
    setSaveSuccess(false);
    setTestStatus(null);
    loadSettings();
  }, [isOpen]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      // Check localStorage first
      const stored = localStorage.getItem('ai_settings');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.provider) setProvider(parsed.provider);
          if (parsed.model) setModel(parsed.model);
        } catch {}
      }

      if (authFetch) {
        const res = await authFetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.provider) setProvider(data.provider);
          if (data.model) setModel(data.model);
          if (data.has_key) setHasServerKey(true);
          if (data.masked_key) setMaskedKey(data.masked_key);
          if (data.available_models?.length) {
            setAvailableModels(data.available_models);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    try {
      const activeModel = model === 'custom' ? customModel : model;
      const res = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Show all data' }),
      });
      if (res.ok) {
        setTestStatus({ ok: true, message: `Connected to ${activeModel} successfully!` });
      } else {
        const errData = await res.json();
        setTestStatus({ ok: false, message: errData.error || 'Connection failed' });
      }
    } catch (err) {
      setTestStatus({ ok: false, message: err.message || 'Connection test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    const activeModel = model === 'custom' ? customModel.trim() : model;

    try {
      // Save locally
      localStorage.setItem('ai_settings', JSON.stringify({
        provider,
        model: activeModel,
      }));

      // Push to backend
      if (authFetch) {
        await authFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            model: activeModel,
            api_key: apiKey ? apiKey.trim() : undefined,
          }),
        });
      }

      setSaveSuccess(true);
      if (onSettingsSaved) {
        onSettingsSaved({ provider, model: activeModel });
      }

      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 900);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setTestStatus({ ok: false, message: 'Could not save settings to server.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div 
        className="w-full max-w-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-elevated)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center">
              <Sliders size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Settings</h2>
              <p className="text-[11px] text-[var(--color-text-muted)]">Configure AI model engine and preferences</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-6">
          <button
            onClick={() => setActiveTab('ai')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'ai'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Cpu size={14} />
            <span>AI Engine</span>
          </button>
          <button
            onClick={() => setActiveTab('preferences')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'preferences'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Sparkle size={14} />
            <span>Preferences</span>
          </button>
          <button
            onClick={() => setActiveTab('account')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'account'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <span>Account</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'ai' && (
            <>
              {/* Provider Selection */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-primary)] mb-2">
                  AI Provider
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {PROVIDER_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProvider(p.id)}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                        provider === p.id
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                          : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                      }`}
                    >
                      <div className="text-base mb-1">{p.icon}</div>
                      <div className="text-xs font-medium leading-tight">{p.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Model Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-primary)]">
                    Model Selection
                  </label>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                    Active: {model}
                  </span>
                </div>
                <select
                  value={availableModels.includes(model) ? model : 'custom'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setModel('custom');
                    } else {
                      setModel(val);
                    }
                  }}
                  className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] outline-none font-mono"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m} {m === 'openai/gpt-oss-120b' ? '★ Recommended' : ''}
                    </option>
                  ))}
                  <option value="custom">Custom Model Name...</option>
                </select>

                {model === 'custom' && (
                  <div className="mt-2">
                    <input
                      type="text"
                      placeholder="e.g. openai/gpt-oss-20b or custom model id"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] outline-none font-mono"
                    />
                  </div>
                )}
                <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
                  <span className="text-emerald-500 font-medium">openai/gpt-oss-120b</span> is the default high-performance reasoning model on your Groq key.
                </p>
              </div>

              {/* API Key */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-primary)]">
                    Groq API Key
                  </label>
                  {hasServerKey && (
                    <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                      <CheckCircle size={12} weight="fill" /> Key is configured ({maskedKey})
                    </span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={hasServerKey ? 'Enter new key to replace existing...' : 'gsk_...'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg pl-3 pr-10 py-2 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((prev) => !prev)}
                    className="absolute right-3 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  >
                    {showApiKey ? <EyeSlash size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  API keys are stored securely on your local server.
                </p>
              </div>

              {/* Test Connection Button & Result */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="btn-secondary px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <ArrowClockwise size={13} className={isTesting ? 'animate-spin' : ''} />
                  <span>{isTesting ? 'Testing connection...' : 'Test AI Connection'}</span>
                </button>

                {testStatus && (
                  <div className={`mt-2 p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                    testStatus.ok
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}>
                    {testStatus.ok ? <CheckCircle size={16} weight="fill" /> : <WarningCircle size={16} weight="fill" />}
                    <span>{testStatus.message}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                <div>
                  <h4 className="text-xs font-medium text-[var(--color-text-primary)]">Color Theme</h4>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Switch between dark and light palette</p>
                </div>
                <button
                  onClick={onToggleTheme}
                  className="btn-secondary px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  {theme === 'dark' ? <Moon size={14} className="text-indigo-400" /> : <Sun size={14} className="text-amber-400" />}
                  <span className="capitalize">{theme} Mode</span>
                </button>
              </div>

              <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                <h4 className="text-xs font-medium text-[var(--color-text-primary)] mb-1">Supported File Types</h4>
                <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                  CSV (.csv), Excel (.xlsx, .xls), JSON (.json, .jsonl), TSV (.tsv, .tab), Parquet (.parquet).
                </p>
              </div>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                <p className="text-xs text-[var(--color-text-muted)] mb-1">Signed in as</p>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{user?.name || 'User'}</h3>
                <p className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5">{user?.email || 'No email'}</p>
              </div>

              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  className="w-full btn-secondary text-rose-500 hover:text-rose-400 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer border-rose-500/20 hover:border-rose-500/40"
                >
                  <SignOut size={14} />
                  <span>Sign Out</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
            {saveSuccess ? '✓ Saved successfully' : 'Changes apply immediately'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary px-3.5 py-1.5 text-xs font-medium cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saveSuccess ? (
                <>
                  <Check size={14} weight="bold" />
                  <span>Saved!</span>
                </>
              ) : isSaving ? (
                <>
                  <ArrowClockwise size={14} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
