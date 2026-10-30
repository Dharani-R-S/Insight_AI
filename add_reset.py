with open('frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Add ArrowCounterClockwise to imports
old_imp = "import { Broom, DownloadSimple, CaretDown, Sparkle, MagnifyingGlass, X, List } from '@phosphor-icons/react';"
new_imp = "import { Broom, DownloadSimple, CaretDown, Sparkle, MagnifyingGlass, X, List, ArrowCounterClockwise } from '@phosphor-icons/react';"
code = code.replace(old_imp, new_imp)

# 2. Add handleResetToFullData
old_reset = """  const handleResetNLFilter = () => {
    setNlFilterRows(null);
    setNlFilterActive(null);
    setNlFilterInput('');
  };"""

new_reset = """  const handleResetNLFilter = () => {
    setNlFilterRows(null);
    setNlFilterActive(null);
    setNlFilterInput('');
  };

  const handleResetToFullData = async () => {
    setResults(null);
    setNlFilterRows(null);
    setNlFilterActive(null);
    setNlFilterInput('');
    if (!fullData || fullData.length === 0) {
      try {
        const res = await authFetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: 'Show all data' }),
        });
        const data = await res.json();
        if (data.table_result) {
          setFullData(data.table_result);
        }
      } catch {}
    }
  };"""
code = code.replace(old_reset, new_reset)

# 3. Update Data Browser subtitle and top header controls
old_header = """            <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Data Browser</h2>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  {nlFilterActive
                    ? `Showing ${nlFilterRows?.length ?? 0} results matching "${nlFilterActive}"`
                    : table_result?.length
                      ? `Showing ${table_result.length} query results`
                      : fullData?.length
                        ? `${fullData.length.toLocaleString()} rows loaded — click any column header to profile it`
                        : 'No data'}
                </p>
              </div>
              {datasetInfo && (
                <div className="flex items-center gap-2 relative">
                  <div className="relative">
                    <button
                      onClick={() => setIsDataExportOpen((prev) => !prev)}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                      title="Export dataset"
                    >
                      <DownloadSimple size={14} className="text-[var(--color-accent)]" />
                      <span>Export Data</span>
                      <CaretDown size={11} className="text-[var(--color-text-muted)]" />
                    </button>"""

new_header = """            <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Data Browser</h2>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  {nlFilterActive ? (
                    <span>
                      Showing {nlFilterRows?.length ?? 0} results matching "{nlFilterActive}" •{' '}
                      <button onClick={handleResetToFullData} className="text-[var(--color-accent)] hover:underline font-semibold cursor-pointer">
                        Reset to full table ({fullData?.length?.toLocaleString() || datasetInfo?.row_count?.toLocaleString()} rows)
                      </button>
                    </span>
                  ) : table_result?.length ? (
                    <span>
                      Showing {table_result.length} query results •{' '}
                      <button onClick={handleResetToFullData} className="text-[var(--color-accent)] hover:underline font-semibold cursor-pointer">
                        Reset to full table ({fullData?.length?.toLocaleString() || datasetInfo?.row_count?.toLocaleString()} rows)
                      </button>
                    </span>
                  ) : fullData?.length ? (
                    `${fullData.length.toLocaleString()} rows loaded — click any column header to profile it`
                  ) : (
                    'No data'
                  )}
                </p>
              </div>
              {datasetInfo && (
                <div className="flex items-center gap-2 relative">
                  {(table_result?.length || nlFilterRows || nlFilterActive) && (
                    <button
                      onClick={handleResetToFullData}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1.5 text-amber-500 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-all"
                      title="Reset table to view full dataset"
                    >
                      <ArrowCounterClockwise size={13} weight="bold" />
                      <span>Reset Table</span>
                    </button>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => setIsDataExportOpen((prev) => !prev)}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                      title="Export dataset"
                    >
                      <DownloadSimple size={14} className="text-[var(--color-accent)]" />
                      <span>Export Data</span>
                      <CaretDown size={11} className="text-[var(--color-text-muted)]" />
                    </button>"""
code = code.replace(old_header, new_header)

# 4. Add Reset button inside search bar form
old_form_btn = """                  <button
                    type="submit"
                    disabled={!nlFilterInput.trim() || isFilteringNL}
                    className="btn-primary px-3.5 py-1.5 text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shadow-sm"
                  >
                    {isFilteringNL ? (
                      <span>Searching...</span>
                    ) : (
                      <>
                        <MagnifyingGlass size={13} weight="bold" />
                        <span>Search with AI</span>
                      </>
                    )}
                  </button>
                </form>"""

new_form_btn = """                  <button
                    type="submit"
                    disabled={!nlFilterInput.trim() || isFilteringNL}
                    className="btn-primary px-3.5 py-1.5 text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shadow-sm"
                  >
                    {isFilteringNL ? (
                      <span>Searching...</span>
                    ) : (
                      <>
                        <MagnifyingGlass size={13} weight="bold" />
                        <span>Search with AI</span>
                      </>
                    )}
                  </button>
                  {(table_result?.length || nlFilterRows || nlFilterActive || nlFilterInput) && (
                    <button
                      type="button"
                      onClick={handleResetToFullData}
                      className="btn-secondary px-3 py-1.5 text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all"
                      title="Reset filter and view full dataset"
                    >
                      <ArrowCounterClockwise size={13} />
                      <span>Reset</span>
                    </button>
                  )}
                </form>"""
code = code.replace(old_form_btn, new_form_btn)

# 5. Remove duplicate DataCleaningModal inside case 'data'
old_inner_modal = """            <DataCleaningModal
              isOpen={isCleanModalOpen}
              onClose={() => setIsCleanModalOpen(false)}
              authFetch={authFetch}
              onCleanSuccess={async (cleanedData) => {
                setDatasetInfo((prev) => ({
                  ...prev,
                  columns: cleanedData.columns,
                  row_count: cleanedData.row_count,
                  sample_rows: cleanedData.sample_rows,
                  schema: cleanedData.schema,
                }));

                try {
                  const tableRes = await authFetch('/api/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: 'Show all data' }),
                  });
                  const result = await tableRes.json();
                  setFullData(result.table_result || cleanedData.sample_rows);
                } catch {
                  setFullData(cleanedData.sample_rows);
                }
              }}
            />"""
code = code.replace(old_inner_modal, "")

with open('frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated App.jsx with Reset button")

