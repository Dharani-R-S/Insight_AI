/**
 * Centralized API client with automatic JWT and multi-provider LLM headers injection.
 */
const MODEL_REPLACEMENTS = {
  'llama-3.1-8b-instant': 'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'llama3-8b-8192': 'openai/gpt-oss-120b',
  'llama3-70b-8192': 'openai/gpt-oss-120b',
  'mixtral-8x7b-32768': 'openai/gpt-oss-120b',
  'gemma2-9b-it': 'openai/gpt-oss-120b',
};

export function getLlmHeaders() {
  const headers = {};
  try {
    const raw = localStorage.getItem('insightai_llm_config');
    if (raw) {
      const config = JSON.parse(raw);
      const prov = (config.provider || 'groq').toLowerCase();
      let model = config.model || '';

      if (prov === 'groq' && MODEL_REPLACEMENTS[model]) {
        model = MODEL_REPLACEMENTS[model];
      }

      if (config.provider) headers['x-llm-provider'] = config.provider;
      if (config.apiKey) headers['x-llm-api-key'] = config.apiKey;
      if (model) headers['x-llm-model'] = model;
      if (config.baseUrl) headers['x-llm-base-url'] = config.baseUrl;
    }
  } catch {}
  return headers;
}

export function authFetch(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  const llmHeaders = getLlmHeaders();

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...llmHeaders,
  };

  return fetch(url, {
    ...options,
    headers,
  });
}
