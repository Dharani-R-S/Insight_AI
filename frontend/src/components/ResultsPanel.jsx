import { useState, useEffect } from 'react';
import ChartDisplay from './ChartDisplay';
import DataTable from './DataTable';
import StatsPanel from './StatsPanel';
import InsightsPanel from './InsightsPanel';
import VisualBuilder from './VisualBuilder';
import KnowledgeGraph from './KnowledgeGraph';
import { 
  ChartBar, 
  Table, 
  Lightbulb, 
  TrendUp, 
  Code, 
  Sliders, 
  ShareNetwork,
  Printer
} from '@phosphor-icons/react';

const TABS = [
  { id: 'chart', label: 'Chart', icon: ChartBar },
  { id: 'table', label: 'Table', icon: Table },
  { id: 'explore', label: 'Explore', icon: Sliders },
  { id: 'graph', label: 'Knowledge Graph', icon: ShareNetwork },
  { id: 'stats', label: 'Stats', icon: TrendUp },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
  { id: 'sql', label: 'SQL', icon: Code },
];

export default function ResultsPanel({ 
  results, 
  columns = [], 
  fullData = [], 
  datasetInfo,
  onExecuteQuery,
  onFilterTable,
  onNavigateTab
}) {
  const [activeTab, setActiveTab] = useState('chart');

  useEffect(() => {
    if (results) {
      if (results.chart_base64 || (results.table_result && results.table_result.length > 0)) {
        setActiveTab('chart');
      } else if (results.sql_query) {
        setActiveTab('sql');
      }
    }
  }, [results]);

  const hasResults = !!results;
  const { sql_query, table_result, chart_base64, stats, insights, prediction } = results || {};

  // Determine if chart can be rendered from table_result
  const canAutoChart = !!(table_result &&
    table_result.length > 0 &&
    table_result[0] &&
    Object.keys(table_result[0]).length >= 2 &&
    Object.keys(table_result[0]).slice(1).some(k => !isNaN(Number(table_result[0][k]))));

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] select-none">
      {/* Tabs Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            if (tab.id !== 'explore' && !hasResults) return null;
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-semibold'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {hasResults && (
          <button
            onClick={() => window.print()}
            className="btn-secondary px-2.5 py-1 text-xs cursor-pointer flex items-center gap-1.5 no-print shrink-0"
            title="Export PDF Report"
          >
            <Printer size={13} />
            <span>Export</span>
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden p-4" key={activeTab}>
        {!hasResults && activeTab !== 'explore' ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-[var(--color-text-muted)] space-y-2">
            <ChartBar size={28} className="opacity-40" />
            <p className="text-xs font-medium">Run a query in Ask AI to view dynamic charts and tables</p>
          </div>
        ) : (
          <>
            {activeTab === 'chart' && (
              canAutoChart ? (
                <div className="h-full bg-[var(--color-bg-card)] rounded-lg border border-[var(--color-border)] p-4">
                  <ChartDisplay data={table_result} />
                </div>
              ) : chart_base64 ? (
                <div className="flex items-center justify-center h-full bg-[var(--color-bg-card)] rounded-lg border border-[var(--color-border)] p-4">
                  <img
                    src={`data:image/png;base64,${chart_base64}`}
                    alt="Analysis Chart"
                    className="max-h-full max-w-full object-contain rounded-md"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center p-8 text-[var(--color-text-muted)] space-y-2">
                  <ChartBar size={28} className="opacity-40" />
                  <p className="text-xs font-medium">No chart automatically generated for this query.</p>
                  <button
                    onClick={() => setActiveTab('explore')}
                    className="btn-secondary px-3 py-1.5 text-xs mt-2 cursor-pointer"
                  >
                    Build Custom Chart in Explore →
                  </button>
                </div>
              )
            )}

            {activeTab === 'table' && (
              <div className="h-full">
                <DataTable data={table_result?.length ? table_result : fullData} />
              </div>
            )}

            {activeTab === 'graph' && (
              <div className="h-full">
                <KnowledgeGraph
                  tableData={table_result?.length ? table_result : fullData}
                  datasetInfo={datasetInfo}
                  columns={columns}
                  onExecuteQuery={onExecuteQuery}
                  onFilterTable={onFilterTable}
                  onNavigateTab={onNavigateTab}
                />
              </div>
            )}

            {activeTab === 'explore' && (
              <VisualBuilder
                columns={columns}
                tableData={table_result?.length ? table_result : fullData}
              />
            )}

            {activeTab === 'stats' && (
              <div className="h-full overflow-auto bg-[var(--color-bg-card)] rounded-lg border border-[var(--color-border)] p-5">
                <StatsPanel stats={stats} />
              </div>
            )}

            {activeTab === 'insights' && (
              <div className="h-full overflow-auto bg-[var(--color-bg-card)] rounded-lg border border-[var(--color-border)] p-5">
                <InsightsPanel insights={insights} prediction={prediction} />
              </div>
            )}

            {activeTab === 'sql' && (
              <div className="h-full overflow-auto bg-[var(--color-bg-code)] text-[var(--color-text-primary)] rounded-lg border border-[var(--color-border)] p-4 space-y-3 font-mono">
                {/* Window Header */}
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                  </div>
                  <span className="text-[11px] text-[var(--color-text-muted)] font-mono">query.sql</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-medium text-[var(--color-text-secondary)]">Executed SQL Statement</span>
                  <span className="text-[11px] text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 rounded font-mono">
                    ✓ {table_result?.length ?? 0} rows returned
                  </span>
                </div>
                <pre className="text-xs font-mono text-[var(--color-text-primary)] whitespace-pre-wrap leading-relaxed bg-[var(--color-bg-primary)] rounded-lg p-3.5 border border-[var(--color-border)]">
                  {sql_query}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
