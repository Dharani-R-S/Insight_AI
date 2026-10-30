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
  Sparkle,
  Lightning,
  PaperPlaneTilt,
  PaperPlaneRight,
  CheckCircle,
  WarningCircle
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
  const [categorizedQueries, setCategorizedQueries] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
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

  // Compute smart, grounded heuristic recommendations strictly from columns & schema
  const computeHeuristicRecs = useCallback((info) => {
    if (!info || !info.columns || info.columns.length === 0) {
      return [];
    }
    const cols = info.columns;
    const lowerCols = cols.map(c => String(c).toLowerCase());
    const queries = [];

    const addQuery = (question, category) => {
      queries.push({ question, category });
    };

    const isMedia = lowerCols.some(c => ['title', 'series_or_movie', 'genre', 'director', 'imdb_score', 'actors'].includes(c));
    const isSales = lowerCols.some(c => ['sales', 'revenue', 'order_date', 'profit', 'product', 'quantity'].includes(c));

    if (isMedia) {
      if (lowerCols.includes('series_or_movie')) {
        addQuery("What is the distribution of movies and TV shows?", "Overview");
      }
      if (lowerCols.includes('genre')) {
        addQuery("What content distribution can be identified by genre?", "Categories");
      }
      if (lowerCols.includes('country_availability') || lowerCols.includes('country')) {
        addQuery("Which countries have the most titles available?", "Ranking");
      }
      if (lowerCols.some(c => c.includes('rating'))) {
        addQuery("Which content ratings appear most frequently?", "Categories");
      }
      if (lowerCols.some(c => c.includes('release') || c.includes('year') || c.includes('date'))) {
        addQuery("How has the number of titles released changed over time?", "Trends");
      }
      if (lowerCols.includes('imdb_score')) {
        addQuery("Top 10 highest-rated titles by IMDb Score", "Ranking");
      }
      if (lowerCols.includes('runtime')) {
        addQuery("What is the average runtime across titles?", "Statistics");
      }
      if (lowerCols.includes('director')) {
        addQuery("Which directors have directed the most titles?", "Ranking");
      }
      addQuery("Which columns contain the most missing or null values?", "Data Quality");
    } else if (isSales) {
      if (lowerCols.some(c => c.includes('region'))) {
        addQuery("What is the total sales per region?", "Overview");
      }
      if (lowerCols.some(c => c.includes('product'))) {
        addQuery("Top 5 products by sales volume", "Ranking");
      }
      if (lowerCols.some(c => c.includes('date'))) {
        addQuery("How do sales trend month over month?", "Trends");
      }
      if (lowerCols.some(c => c.includes('profit')) && lowerCols.some(c => c.includes('sales'))) {
        addQuery("Relationship between sales and profit margins", "Statistics");
      }
      if (lowerCols.some(c => c.includes('quantity'))) {
        addQuery("Average order quantity across categories", "Statistics");
      }
      addQuery("Which columns contain the most missing or null values?", "Data Quality");
    } else {
      const clean = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const numCols = cols.filter(c => ['sales', 'revenue', 'cost', 'price', 'amount', 'score', 'quantity', 'profit', 'total'].some(k => c.toLowerCase().includes(k)));
      const catCols = cols.filter(c => !numCols.includes(c) && !c.toLowerCase().endsWith('_id'));
      const dateCols = cols.filter(c => ['date', 'time', 'year', 'month'].some(k => c.toLowerCase().includes(k)));

      if (dateCols.length && numCols.length) {
        addQuery(`How has ${clean(numCols[0])} changed over ${clean(dateCols[0])}?`, "Trends");
      }
      if (numCols.length && catCols.length) {
        addQuery(`Show total ${clean(numCols[0])} per ${clean(catCols[0])}`, "Overview");
        addQuery(`Average ${clean(numCols[0])} by ${clean(catCols[0])}`, "Categories");
      }
      if (catCols.length) {
        addQuery(`Top 5 ${clean(catCols[0])} by frequency`, "Ranking");
      }
      if (numCols.length) {
        addQuery(`What is the distribution of ${clean(numCols[0])}?`, "Statistics");
      }
      addQuery("Which columns contain the most missing or null values?", "Data Quality");
    }

    return queries;
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
          if (data.categorized_queries && data.categorized_queries.length > 0) {
            setCategorizedQueries(data.categorized_queries);
            setAiRecommendations(data.categorized_queries.map(q => q.question));
            return;
          } else if (data.queries && data.queries.length > 0) {
            const mapped = data.queries.map(q => ({ question: q, category: 'Suggested' }));
            setCategorizedQueries(mapped);
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

    const fallbacks = computeHeuristicRecs(datasetInfo);
    setCategorizedQueries(fallbacks);
    setAiRecommendations(fallbacks.map(q => q.question));
  }, [datasetInfo, authFetch, computeHeuristicRecs]);

  // Refresh queries whenever dataset changes
  useEffect(() => {
    if (datasetInfo && datasetInfo.columns && datasetInfo.columns.length > 0) {
      const initial = computeHeuristicRecs(datasetInfo);
      setCategorizedQueries(initial);
      setAiRecommendations(initial.map(q => q.question));
      fetchAiRecommendations();
    }
  }, [datasetInfo?.table_name, datasetInfo?.columns?.length, datasetInfo?.is_cleaned, computeHeuristicRecs, fetchAiRecommendations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim(), { question: input.trim(), mode });
    setInput('');
  };

  const handleSelectQuery = (question, executeNow = false) => {
    setInput(question);
    if (executeNow) {
      onSendMessage(question, { question, mode });
      setInput('');
    } else {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
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

  const categories = ['All', ...new Set(categorizedQueries.map(q => q.category))];
  const displayedQueries = selectedCategory === 'All' 
    ? categorizedQueries 
    : categorizedQueries.filter(q => q.category === selectedCategory);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)]">

      {/* Mode Selector Tabs */}
      <div className="flex gap-2 p-3 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-card)] flex-wrap items-center">
        <button
          onClick={() => setMode('analyze')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            mode === 'analyze'
              ? 'bg-[var(--color-accent)] text-white shadow-xs'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          <Database size={13} />
          Analyze (SQL)
        </button>
        <button
          onClick={() => setMode('visualize')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            mode === 'visualize'
              ? 'bg-[var(--color-accent-secondary)] text-white shadow-xs'
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
              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]'
          }`}
          title="Query History & Bookmarks"
        >
          <Clock size={13} />
          <span>{queryHistory.length}</span>
        </button>
      </div>

      {/* Query History Panel */}
      {showHistory && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs space-y-2 max-h-56 overflow-y-auto">
          <div className="flex items-center justify-between pb-1 border-b border-[var(--color-border)]">
            <div className="flex gap-2">
              <button
                onClick={() => setHistoryTab('history')}
                className={`font-semibold pb-0.5 cursor-pointer ${historyTab === 'history' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}
              >
                History ({queryHistory.length})
              </button>
              <button
                onClick={() => setHistoryTab('bookmarks')}
                className={`font-semibold pb-0.5 cursor-pointer ${historyTab === 'bookmarks' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}
              >
                Bookmarks ({bookmarks.length})
              </button>
            </div>
            {historyTab === 'history' && queryHistory.length > 0 && (
              <button onClick={onClearHistory} className="text-[10px] text-rose-500 hover:underline cursor-pointer">
                Clear
              </button>
            )}
          </div>

          <div className="space-y-1">
            {historyTab === 'history' ? (
              queryHistory.length === 0 ? (
                <p className="text-[11px] text-[var(--color-text-muted)] italic">No recent queries.</p>
              ) : (
                queryHistory.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleHistorySelect(item.question)}
                    className="w-full text-left p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] truncate flex items-center justify-between group cursor-pointer"
                  >
                    <span className="truncate">{item.question}</span>
                    <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">{formatRelativeTime(item.timestamp)}</span>
                  </button>
                ))
              )
            ) : (
              bookmarks.length === 0 ? (
                <p className="text-[11px] text-[var(--color-text-muted)] italic">No bookmarks saved yet.</p>
              ) : (
                bookmarks.map((bm) => (
                  <button
                    key={bm.id}
                    onClick={() => handleHistorySelect(bm.question)}
                    className="w-full text-left p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] truncate flex items-center justify-between group cursor-pointer"
                  >
                    <span className="truncate font-semibold">{bm.title}</span>
                    <span className="text-[9px] text-[var(--color-accent)] shrink-0">Run →</span>
                  </button>
                ))
              )
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto space-y-4 py-6">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center">
              <Sparkle size={26} weight="fill" />
            </div>
            
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                Ask InsightAI About Your Data
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                {hasDataset
                  ? `Ask analytical questions about ${datasetInfo.table_name || 'your dataset'}. InsightAI compiles DuckDB SQL queries and returns tables and charts.`
                  : 'Upload a dataset from the sidebar to activate conversational analytics.'}
              </p>
            </div>

            {hasDataset && categorizedQueries.length > 0 && (
              <div className="w-full space-y-3 pt-2 text-left">
                {/* Header & Category Filter */}
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
                  <span className="text-[11px] font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
                    <Lightning size={13} className="text-[var(--color-accent)]" weight="fill" />
                    <span>Suggested Analytical Queries</span>
                  </span>
                  <button
                    type="button"
                    onClick={fetchAiRecommendations}
                    disabled={isLoadingRecs}
                    className="text-[10px] text-[var(--color-accent)] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <ArrowCounterClockwise size={10} className={isLoadingRecs ? 'animate-spin' : ''} />
                    <span>{isLoadingRecs ? 'Analyzing...' : 'Refresh'}</span>
                  </button>
                </div>

                {/* Category Pills */}
                {categories.length > 2 && (
                  <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap cursor-pointer transition-all ${
                          selectedCategory === cat 
                            ? 'bg-[var(--color-accent)] text-white' 
                            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {/* Query Cards */}
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {displayedQueries.map((item, i) => (
                    <div
                      key={i}
                      className="card p-2.5 bg-[var(--color-bg-card)] border-[var(--color-border)] hover:border-[var(--color-accent)] transition-all group flex items-center justify-between gap-2 shadow-xs"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectQuery(item.question, false)}
                        className="text-left text-xs font-semibold text-[var(--color-text-primary)] flex-1 truncate hover:text-[var(--color-accent)] cursor-pointer"
                        title={item.question}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] shrink-0">
                            {item.category}
                          </span>
                          <span className="truncate">{item.question}</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectQuery(item.question, true)}
                        className="p-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-accent)] hover:text-white text-[var(--color-text-muted)] transition-colors shrink-0 cursor-pointer"
                        title="Run query immediately"
                      >
                        <ArrowRight size={12} />
                      </button>
                    </div>
                  ))}
                </div>
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
                className={`max-w-[85%] rounded-xl px-4 py-3 text-xs leading-relaxed font-medium space-y-2.5 ${
                  msg.role === 'user'
                    ? 'bg-[var(--color-accent)] text-white rounded-br-sm shadow-xs font-semibold'
                    : 'card border-[var(--color-border-soft)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-xs'
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
                        <Brain size={10} /> DuckDB SQL Query
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
            <div className="card px-4 py-2.5 bg-[var(--color-bg-card)] border-[var(--color-border-soft)] flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
              <span className="text-xs text-[var(--color-text-secondary)] font-semibold">Generating query & analyzing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sticky Bottom AI Suggested Query Carousel */}
      {hasDataset && categorizedQueries.length > 0 && (
        <div className="px-3.5 pt-2 pb-1.5 border-t border-[var(--color-border-soft)] bg-[var(--color-bg-card)]/80 backdrop-blur-xs flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-semibold px-0.5">
            <span className="flex items-center gap-1 text-[var(--color-accent)]">
              <Sparkle size={11} weight="fill" />
              Suggested Questions
            </span>
            <button
              type="button"
              onClick={fetchAiRecommendations}
              disabled={isLoadingRecs}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer flex items-center gap-1"
              title="Refresh suggestions"
            >
              <ArrowCounterClockwise size={10} className={isLoadingRecs ? 'animate-spin' : ''} />
              <span>{isLoadingRecs ? 'Analyzing...' : 'Refresh'}</span>
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
            {categorizedQueries.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectQuery(item.question, false)}
                className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-[var(--color-bg-secondary)] hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40 text-[var(--color-text-secondary)] transition-all cursor-pointer truncate max-w-[280px] shadow-2xs flex items-center gap-1.5"
                title={item.question}
              >
                <span className="text-[9px] px-1 py-0.2 rounded bg-[var(--color-bg-card)] text-[var(--color-text-muted)] font-bold">
                  {item.category}
                </span>
                <span className="truncate">{item.question}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[var(--color-border-soft)] bg-[var(--color-bg-primary)]">
        <div className="flex gap-2.5 items-center bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 focus-within:border-[var(--color-accent)] focus-within:shadow-xs transition-all">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={hasDataset ? `Ask anything about ${datasetInfo?.table_name || 'your dataset'}...` : 'Upload a dataset to begin...'}
            disabled={!hasDataset || isLoading}
            className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] disabled:opacity-40 font-medium"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || !hasDataset}
            className="w-8 h-8 rounded-lg flex items-center justify-center p-0 shrink-0 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-white shadow-xs"
            title="Send query (Enter)"
            aria-label="Send query"
          >
            <PaperPlaneRight size={15} weight="fill" className="text-white shrink-0 ml-0.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
