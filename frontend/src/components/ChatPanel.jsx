import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Database, 
  ChartBar, 
  Clock, 
  ArrowCounterClockwise, 
  ChatTeardropText, 
  ArrowRight, 
  ArrowUp,
  Brain,
  BookmarkSimple,
  Bookmark,
  Trash,
  Sparkle,
  Lightning
} from '@phosphor-icons/react';

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ChatPanel({
  messages,
  onSendMessage,
  isLoading,
  hasDataset,
  datasetInfo,
  authFetch,
  queryHistory = [],
  onClearHistory,
}) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('analyze');
  const [showHistory, setShowHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState('history'); // 'history' | 'bookmarks'
  
  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const raw = localStorage.getItem('bookmarked_queries');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Compute smart heuristic recommendations immediately from columns & schema
  const computeHeuristicRecs = useCallback((info) => {
    if (!info || !info.columns || info.columns.length === 0) {
      return [
        'Show total sales per region',
        'Top 5 categories by volume',
        'Average values across groups',
        'Distribution of records'
      ];
    }
    const cols = info.columns;
    const schema = info.schema || {};
    const clean = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    
    const numCols = cols.filter((c) => {
      const t = String(schema[c] || '').toLowerCase();
      return ['int', 'float', 'real', 'num', 'cost', 'sales', 'price', 'amount', 'age', 'revenue', 'profit', 'rate', 'total', 'score', 'salary'].some(k => t.includes(k) || c.toLowerCase().includes(k));
    });
    const catCols = cols.filter((c) => !numCols.includes(c) && !c.toLowerCase().endsWith('_id'));
    
    const recs = [];
    if (numCols.length > 0 && catCols.length > 0) {
      recs.push(`Show total ${clean(numCols[0])} per ${clean(catCols[0])}`);
      recs.push(`Average ${clean(numCols[0])} by ${clean(catCols[0])}`);
    }
    if (catCols.length > 1 && numCols.length > 0) {
      recs.push(`Compare ${clean(numCols[0])} across ${clean(catCols[1])}`);
    }
    if (catCols.length > 0) {
      recs.push(`Top 5 ${clean(catCols[0])} by count`);
    }
    if (numCols.length > 0) {
      recs.push(`Distribution of ${clean(numCols[0])}`);
      if (numCols.length > 1) {
        recs.push(`Relationship between ${clean(numCols[0])} and ${clean(numCols[1])}`);
      }
    }
    return recs.length >= 3 ? recs : ['Show total sales per region', 'Top 5 categories by count', 'Average values across groups'];
  }, []);

  const fetchAiRecommendations = useCallback(async () => {
    if (!datasetInfo || !datasetInfo.columns || datasetInfo.columns.length === 0) return;
    setIsLoadingRecs(true);
    try {
      if (authFetch) {
        const res = await authFetch('/api/recommend-queries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            columns: datasetInfo.columns,
            schema_info: datasetInfo.schema || {},
            sample_rows: (datasetInfo.sample_rows || []).slice(0, 3),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.queries && data.queries.length > 0) {
            setAiRecommendations(data.queries);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('AI recommendation fetch error:', err);
    } finally {
      setIsLoadingRecs(false);
    }
    setAiRecommendations(computeHeuristicRecs(datasetInfo));
  }, [datasetInfo, authFetch, computeHeuristicRecs]);

  useEffect(() => {
    if (datasetInfo && datasetInfo.columns && datasetInfo.columns.length > 0) {
      setAiRecommendations(computeHeuristicRecs(datasetInfo));
      fetchAiRecommendations();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetInfo?.filename, datasetInfo?.columns?.length, computeHeuristicRecs, fetchAiRecommendations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim(), { question: input.trim(), mode });
    setInput('');
  };

  const handleHistorySelect = (question) => {
    setInput(question);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBookmark = (question, sql) => {
    const title = prompt('Name this verified query:', question) || question;
    const newBookmark = { id: Date.now(), title, question, sql, timestamp: Date.now() };
    const updated = [newBookmark, ...bookmarks.filter((b) => b.question !== question)];
    setBookmarks(updated);
    try { localStorage.setItem('bookmarked_queries', JSON.stringify(updated)); } catch {}
  };

  const handleRemoveBookmark = (id, e) => {
    e.stopPropagation();
    const updated = bookmarks.filter((b) => b.id !== id);
    setBookmarks(updated);
    try { localStorage.setItem('bookmarked_queries', JSON.stringify(updated)); } catch {}
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)]">

      {/* Mode Selector Tabs */}
      <div className="flex gap-2 p-3 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-card)] flex-wrap items-center">
        <button
          onClick={() => setMode('analyze')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            mode === 'analyze'
              ? 'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/15'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          <Database size={13} />
          Analyze (SQL)
        </button>
        <button
          onClick={() => setMode('visualize')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            mode === 'visualize'
              ? 'bg-[var(--color-accent-secondary)] text-white shadow-sm shadow-[var(--color-accent-secondary)]/15'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          <ChartBar size={13} />
          Visualize (Chart)
        </button>

        {/* History Toggle */}
        <button
          onClick={() => setShowHistory((v) => !v)}
          className={`ml-auto flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
            showHistory
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-accent)]'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]'
          }`}
          title="Query History & Bookmarks"
        >
          <Clock size={13} />
          {bookmarks.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
          )}
        </button>
      </div>

      {/* Query History & Bookmarks Drawer */}
      {showHistory && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/90 animate-fade-in max-h-64 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
            <div className="flex gap-2">
              <button
                onClick={() => setHistoryTab('history')}
                className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded cursor-pointer ${
                  historyTab === 'history'
                    ? 'bg-[var(--color-bg-card)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)]'
                }`}
              >
                History ({queryHistory.length})
              </button>
              <button
                onClick={() => setHistoryTab('bookmarks')}
                className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded cursor-pointer ${
                  historyTab === 'bookmarks'
                    ? 'bg-[var(--color-bg-card)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)]'
                }`}
              >
                Bookmarked ({bookmarks.length})
              </button>
            </div>
            {historyTab === 'history' && queryHistory.length > 0 && (
              <button
                onClick={() => onClearHistory?.()}
                className="text-[9px] font-bold text-[var(--color-text-muted)] hover:text-[var(--color-danger)] cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 py-1">
            {historyTab === 'history' ? (
              queryHistory.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-4 font-semibold">
                  No history yet. Ask a question!
                </p>
              ) : (
                queryHistory.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => handleHistorySelect(item.question)}
                    className="w-full text-left px-4 py-2.5 text-xs hover:bg-[var(--color-bg-card)] transition-colors flex items-start gap-2.5 group border-b border-[var(--color-border)] last:border-0 cursor-pointer"
                  >
                    <ArrowCounterClockwise size={12} className="text-[var(--color-text-muted)] mt-0.5 shrink-0" />
                    <span className="flex-1 text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] line-clamp-1 transition-colors font-semibold">
                      {item.question}
                    </span>
                    <span className="text-[9px] text-[var(--color-text-muted)] shrink-0 mt-0.5 font-semibold">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </button>
                ))
              )
            ) : (
              bookmarks.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-4 font-semibold">
                  No bookmarked queries yet. Click 'Bookmark' on any query result!
                </p>
              ) : (
                bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    onClick={() => handleHistorySelect(bm.question)}
                    className="w-full text-left px-4 py-2.5 text-xs hover:bg-[var(--color-bg-card)] transition-colors flex items-center justify-between group border-b border-[var(--color-border)] last:border-0 cursor-pointer"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <Bookmark size={12} weight="fill" className="text-[var(--color-accent)] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-bold text-[var(--color-text-primary)] truncate leading-tight">{bm.title}</p>
                        <p className="text-[10px] text-[var(--color-text-muted)] truncate font-mono mt-0.5">{bm.question}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleRemoveBookmark(bm.id, e)}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                ))
              )
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in max-w-[280px] mx-auto space-y-4">
            <div className="p-3.5 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
              <ChatTeardropText size={28} />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                What would you like to know?
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] font-semibold leading-relaxed">
                {hasDataset
                  ? mode === 'analyze'
                    ? 'Translate questions into executable SQL, load table results, and view auto-generated charts.'
                    : 'Ask for specific dimensions or metrics to build matching interactive charts.'
                  : 'Upload a CSV dataset from the sidebar to activate the AI interface.'}
              </p>
            </div>
            {hasDataset && (
              <div className="flex flex-col gap-2 w-full pt-2">
                <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-semibold px-1">
                  <span className="flex items-center gap-1 text-[var(--color-accent)]">
                    <Sparkle size={12} weight="fill" />
                    AI Recommended Queries
                  </span>
                  <button
                    type="button"
                    onClick={fetchAiRecommendations}
                    disabled={isLoadingRecs}
                    className="hover:text-[var(--color-accent)] transition-colors cursor-pointer flex items-center gap-1 text-[10px]"
                    title="Generate new AI suggestions"
                  >
                    <ArrowCounterClockwise size={10} className={isLoadingRecs ? 'animate-spin' : ''} />
                    <span>{isLoadingRecs ? 'Generating...' : 'Refresh'}</span>
                  </button>
                </div>
                {aiRecommendations.slice(0, 4).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="card text-left text-xs px-3.5 py-2.5 bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] font-semibold transition-all group cursor-pointer flex items-center justify-between"
                  >
                    <span className="truncate">{q}</span>
                    <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-all group-hover:translate-x-0.5 text-[var(--color-accent)]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-xs leading-relaxed font-semibold space-y-2.5 ${
                  msg.role === 'user'
                    ? 'bg-[var(--color-accent)] text-white rounded-br-sm shadow-sm'
                    : 'card border-[var(--color-border-soft)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)]'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                
                {msg.mode && msg.role === 'user' && (
                  <div className="text-[9px] opacity-75 flex items-center gap-1 border-t border-white/10 pt-1.5 font-bold uppercase tracking-wider">
                    {msg.mode === 'analyze' ? <Database size={10} /> : <ChartBar size={10} />}
                    <span>{msg.mode === 'analyze' ? 'Analyze Mode' : 'Visualize Mode'}</span>
                  </div>
                )}
                
                {msg.sql && (
                  <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2.5 font-mono text-[10px] text-[var(--color-accent)] border border-[var(--color-border)] overflow-x-auto flex flex-col gap-1.5">
                    <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-1">
                      <span className="text-[8px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1">
                        <Brain size={10} /> Generated SQL Query
                      </span>
                      <button
                        onClick={() => handleBookmark(messages[i - 1]?.content || 'Query', msg.sql)}
                        className="text-[9px] text-[var(--color-accent)] hover:underline flex items-center gap-1 font-bold cursor-pointer"
                      >
                        <BookmarkSimple size={11} /> Bookmark
                      </button>
                    </div>
                    <pre className="leading-relaxed">{msg.sql}</pre>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="card px-4 py-3 bg-[var(--color-bg-card)] border-[var(--color-border-soft)]">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" style={{ animationDelay: '0.15s' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" style={{ animationDelay: '0.3s' }} />
                </div>
                <span className="text-[10px] text-[var(--color-text-secondary)] font-bold uppercase tracking-wider">Thinking…</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Suggested Queries Interactive Chips */}
      {hasDataset && aiRecommendations.length > 0 && (
        <div className="px-3.5 pt-2 pb-1.5 border-t border-[var(--color-border-soft)] bg-[var(--color-bg-card)]/60 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-semibold px-0.5">
            <span className="flex items-center gap-1 text-[var(--color-accent)]">
              <Sparkle size={11} weight="fill" />
              AI Suggested Queries
            </span>
            <button
              type="button"
              onClick={fetchAiRecommendations}
              disabled={isLoadingRecs}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer flex items-center gap-1"
              title="Get new AI recommendations"
            >
              <ArrowCounterClockwise size={10} className={isLoadingRecs ? 'animate-spin' : ''} />
              <span>{isLoadingRecs ? 'Analyzing...' : 'Refresh'}</span>
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
            {aiRecommendations.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setInput(q);
                  inputRef.current?.focus();
                }}
                className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-[var(--color-bg-secondary)] hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-accent)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 text-[var(--color-text-secondary)] transition-all cursor-pointer truncate max-w-[240px] shadow-sm flex items-center gap-1.5"
                title={q}
              >
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[var(--color-border-soft)] bg-[var(--color-bg-primary)]/80">
        <div className="flex gap-2.5 items-center bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 focus-within:border-[var(--color-accent)] focus-within:shadow-sm transition-all">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={hasDataset ? 'Ask a question about your dataset...' : 'Upload a dataset to begin...'}
            disabled={!hasDataset || isLoading}
            className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] disabled:opacity-40 font-semibold"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || !hasDataset}
            className="btn-primary w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-sm transition-all disabled:opacity-40 cursor-pointer"
          >
            <ArrowUp size={14} weight="bold" />
          </button>
        </div>
      </form>
    </div>
  );
}
