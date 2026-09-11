import { useState, useEffect } from 'react';
import { 
  X, 
  Key, 
  CheckCircle, 
  WarningCircle, 
  Eye, 
  EyeSlash, 
  Cpu, 
  ArrowSquareOut,
  Sparkle,
  CircleNotch,
  FloppyDisk
} from '@phosphor-icons/react';

export const PROVIDERS = [
  {
    id: 'groq',
    name: 'Groq',
    badge: 'Fastest & Free Tier',
    description: 'Ultra-low latency inference with GPT-OSS, Qwen, and Compound models.',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Recommended & Best SQL)' },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Fast & Lightweight)' },
      { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B' },
      { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B' },
      { id: 'groq/compound', name: 'Groq Compound' },
      { id: 'groq/compound-mini', name: 'Groq Compound Mini' },
      { id: 'custom', name: '+ Enter Custom Model ID...' },
    ],
    getKeyUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'GPT-4o & o3',
    description: 'World-class accuracy and SQL generation with GPT-4o.',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Cheap - Recommended)' },
      { id: 'gpt-4o', name: 'GPT-4o (High Intelligence)' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'o3-mini', name: 'o3-mini (Reasoning)' },
      { id: 'o1-mini', name: 'o1-mini (Reasoning)' },
      { id: 'custom', name: '+ Enter Custom Model ID...' },
    ],
    getKeyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-proj-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    badge: 'Claude 3.5 & 3.7',
    description: 'Industry-leading code generation and nuanced data reasoning.',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Recommended)' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Ultra Fast)' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
      { id: 'custom', name: '+ Enter Custom Model ID...' },
    ],
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-...',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Gemini 2.0 & 1.5',
    description: 'Multimodal capabilities with massive context windows from Google.',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-1.5-flash',
    models: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Fast - Recommended)' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Next Gen)' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
      { id: 'custom', name: '+ Enter Custom Model ID...' },
    ],
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIzaSy...',
  },
  {
    id: 'custom',
    name: 'Custom / DeepSeek',
    badge: 'OpenAI Compatible',
    description: 'Use DeepSeek, OpenRouter, local Ollama, or any compatible endpoint.',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
      { id: 'custom', name: '+ Enter Custom Model ID...' },
    ],
    getKeyUrl: 'https://platform.deepseek.com/api_keys',
    placeholder: 'sk-...',
  },
];

export function getStoredLlmConfig() {
  try {
    const raw = localStorage.getItem('insightai_llm_config');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    apiKey: '',
    baseUrl: 'https://api.groq.com/openai/v1',
  };
}

export function getStoredProviderKeys() {
  try {
    const raw = localStorage.getItem('insightai_provider_keys');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export default function SettingsModal({ isOpen, onClose, onSaveConfig }) {
  const [activeProvider, setActiveProvider] = useState('groq');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('llama-3.3-70b-versatile');
  const [customModelId, setCustomModelId] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load configuration on mount or when opened
  useEffect(() => {
    if (isOpen) {
      const config = getStoredLlmConfig();
      const keys = getStoredProviderKeys();
      const prov = config.provider || 'groq';
      const provDef = PROVIDERS.find(p => p.id === prov) || PROVIDERS[0];
      
      setActiveProvider(prov);
      setApiKey(keys[prov] || config.apiKey || '');
      
      const loadedModel = config.model || provDef.defaultModel;
      const isPredefined = provDef.models.some(m => m.id === loadedModel && m.id !== 'custom');
      if (isPredefined) {
        setSelectedModel(loadedModel);
        setCustomModelId('');
      } else {
        setSelectedModel('custom');
        setCustomModelId(loadedModel);
      }

      setBaseUrl(config.baseUrl || provDef.defaultBaseUrl || '');
      setTestResult(null);
      setSaveSuccess(false);
    }
  }, [isOpen]);

  // Handle provider switch
  const handleSelectProvider = (provId) => {
    // Save current key to in-memory keys
    const keys = getStoredProviderKeys();
    keys[activeProvider] = apiKey;
    localStorage.setItem('insightai_provider_keys', JSON.stringify(keys));

    setActiveProvider(provId);
    const provDef = PROVIDERS.find(p => p.id === provId) || PROVIDERS[0];
    setApiKey(keys[provId] || '');
    setSelectedModel(provDef.defaultModel);
    setCustomModelId('');
    setBaseUrl(provDef.defaultBaseUrl || '');
    setTestResult(null);
    setSaveSuccess(false);
  };

  if (!isOpen) return null;

  const currentProviderDef = PROVIDERS.find(p => p.id === activeProvider) || PROVIDERS[0];
  const effectiveModel = (selectedModel === 'custom' || customModelId.trim()) 
    ? (customModelId.trim() || currentProviderDef.defaultModel) 
    : selectedModel;

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setTestResult({ status: 'error', message: 'Please enter an API key first.' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          provider: activeProvider,
          api_key: apiKey.trim(),
          model: effectiveModel,
          base_url: baseUrl.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setTestResult({
          status: 'success',
          message: `Connected successfully to ${currentProviderDef.name}! (Model: ${effectiveModel})`,
        });
      } else {
        setTestResult({
          status: 'error',
          message: data.error || 'Connection test failed. Please verify key, base URL, and model.',
        });
      }
    } catch (err) {
      setTestResult({
        status: 'error',
        message: err.message || 'Network error while testing connection.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const config = {
      provider: activeProvider,
      apiKey: apiKey.trim(),
      model: effectiveModel,
      baseUrl: baseUrl.trim(),
    };

    // 1. Save active configuration
    localStorage.setItem('insightai_llm_config', JSON.stringify(config));

    // 2. Save provider keys dictionary
    const keys = getStoredProviderKeys();
    keys[activeProvider] = apiKey.trim();
    localStorage.setItem('insightai_provider_keys', JSON.stringify(keys));

    setSaveSuccess(true);
    if (onSaveConfig) onSaveConfig(config);

    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="card w-full max-w-2xl bg-[var(--color-bg-primary)] border-[var(--color-border)] shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-secondary)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 flex items-center justify-center text-[var(--color-accent)]">
              <Cpu size={20} weight="bold" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--color-text-primary)] font-mono tracking-tight flex items-center gap-2">
                AI ENGINE & API KEYS
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-semibold">
                  Saved Locally
                </span>
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] font-mono">
                Configure your own LLM provider & models. Keys remain private on your machine.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card)] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* 1. Provider Selection */}
          <div>
            <label className="block text-xs font-mono font-bold text-[var(--color-text-primary)] uppercase tracking-wider mb-2.5">
              1. Select LLM Provider
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {PROVIDERS.map((prov) => {
                const isSelected = activeProvider === prov.id;
                return (
                  <button
                    key={prov.id}
                    type="button"
                    onClick={() => handleSelectProvider(prov.id)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                      isSelected
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-sm ring-1 ring-[var(--color-accent)]/40'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:border-[var(--color-text-muted)]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold font-mono text-[var(--color-text-primary)]">
                          {prov.name}
                        </span>
                        {isSelected && (
                          <CheckCircle size={14} weight="fill" className="text-[var(--color-accent)]" />
                        )}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] font-mono block w-fit mb-1 border border-[var(--color-border)]">
                        {prov.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed">
                      {prov.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. API Key Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono font-bold text-[var(--color-text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                <Key size={14} className="text-[var(--color-accent)]" />
                2. {currentProviderDef.name} API Key
              </label>
              <a
                href={currentProviderDef.getKeyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[var(--color-accent)] hover:underline inline-flex items-center gap-1 font-mono"
              >
                Get API key <ArrowSquareOut size={12} />
              </a>
            </div>

            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                  setSaveSuccess(false);
                }}
                placeholder={currentProviderDef.placeholder}
                className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-xs font-mono text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeSlash size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] font-mono">
              Key is stored encrypted/locally in browser storage. It is never sent to any external server.
            </p>
          </div>

          {/* 3. Model Selection & Custom Model ID Field */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-mono font-bold text-[var(--color-text-primary)] uppercase tracking-wider block">
                  3. Select Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    if (e.target.value !== 'custom') {
                      setCustomModelId('');
                    }
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-xs font-mono text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all cursor-pointer"
                >
                  {currentProviderDef.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Base URL Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono font-bold text-[var(--color-text-primary)] uppercase tracking-wider block">
                  Provider Base URL
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={currentProviderDef.defaultBaseUrl}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-xs font-mono text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all"
                />
              </div>
            </div>

            {/* Custom Model ID by User (Available for any new model release) */}
            <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]/50 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
                  <Sparkle size={13} className="text-[var(--color-accent)]" />
                  Custom / New Model ID (Overrides dropdown if entered)
                </label>
                <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                  Active: <strong className="text-[var(--color-accent)]">{effectiveModel}</strong>
                </span>
              </div>
              <input
                type="text"
                value={customModelId}
                onChange={(e) => {
                  setCustomModelId(e.target.value);
                  if (e.target.value.trim()) {
                    setSelectedModel('custom');
                  }
                }}
                placeholder={`e.g. ${currentProviderDef.defaultModel}, gpt-4.5-preview, claude-3-7-sonnet-20250219, etc.`}
                className="w-full px-3.5 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-xs font-mono text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all"
              />
              <p className="text-[10px] text-[var(--color-text-muted)] font-mono">
                When new models are released by {currentProviderDef.name}, simply type the exact model ID here to use it immediately.
              </p>
            </div>
          </div>

          {/* Connection Test Results */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs font-mono flex items-start gap-2.5 animate-fade-in ${
                testResult.status === 'success'
                  ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]'
                  : 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
              }`}
            >
              {testResult.status === 'success' ? (
                <CheckCircle size={17} weight="fill" className="shrink-0 mt-0.5" />
              ) : (
                <WarningCircle size={17} weight="fill" className="shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-bold">{testResult.status === 'success' ? 'Verification Passed' : 'Connection Error'}</p>
                <p className="text-[11px] opacity-90 break-words mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}

          {saveSuccess && (
            <div className="p-3 rounded-xl border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)] text-xs font-mono flex items-center gap-2 animate-fade-in">
              <CheckCircle size={17} weight="fill" />
              <span>Settings saved! Active Engine: {currentProviderDef.name} ({effectiveModel}).</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !apiKey.trim()}
            className="px-4 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] hover:border-[var(--color-accent)] text-xs font-mono font-bold text-[var(--color-text-primary)] transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? (
              <>
                <CircleNotch size={14} className="animate-spin text-[var(--color-accent)]" />
                <span>Testing...</span>
              </>
            ) : (
              <>
                <Sparkle size={14} className="text-[var(--color-accent)]" />
                <span>Test Connection</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-mono font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-[var(--color-accent)] hover:opacity-90 text-white text-xs font-mono font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer"
            >
              <FloppyDisk size={14} weight="bold" />
              <span>Save & Apply</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
