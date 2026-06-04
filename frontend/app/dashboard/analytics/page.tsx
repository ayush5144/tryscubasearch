'use client'

import { useEffect, useState, useCallback, useRef, type ReactElement } from 'react'
import { useAuth } from '@clerk/nextjs'
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getAnalyticsSummary,
  getTopQueries,
  getZeroResults,
  getQueryLog,
  type AnalyticsSummary,
  type TopQueryItem,
  type ZeroResultItem,
  type QueryLogItem,
  ApiError,
} from '@/lib/api-client'

const PAGE_SIZE = 7

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

function downloadCsv(data: ZeroResultItem[]) {
  const header = 'query,count,last_seen\n'
  const rows = data
    .map(
      (r) =>
        `"${r.query.replace(/"/g, '""')}",${r.count},"${r.last_seen}"`,
    )
    .join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'zero-result-queries.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function formatDateLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  })
}

function IntentBadge({ intent }: { intent: string }) {
  const styles: Record<string, string> = {
    clicked: 'bg-green-50 text-green-700 border border-green-200',
    searched: 'bg-blue-50 text-blue-700 border border-blue-200',
    searched_browsed: 'bg-sky-50 text-sky-700 border border-sky-200',
    browsed: 'bg-green-50 text-green-700 border border-green-200',
    abandoned: 'bg-zinc-100 text-[#64748b] border border-zinc-200',
  }
  const labels: Record<string, string> = {
    clicked: 'Clicked',
    searched: 'Searched',
    searched_browsed: 'Searched + Browsed',
    browsed: 'Browsed',
    abandoned: 'Abandoned',
  }
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[intent] ?? styles.abandoned}`}>
      {labels[intent] ?? intent}
    </span>
  )
}

function IntentInfoPopover() {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const visible = pinned || hovered

  useEffect(() => {
    if (!pinned) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [pinned])

  const rows: { badge: ReactElement; meaning: string }[] = [
    {
      badge: <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200">Clicked</span>,
      meaning: 'Clicked a result - found what they wanted',
    },
    {
      badge: <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200">Browsed</span>,
      meaning: 'Engaged with results (hovered or scrolled) but didn\'t click',
    },
    {
      badge: <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">Searched + Browsed</span>,
      meaning: 'Browsed results, then pressed Enter on the same query',
    },
    {
      badge: <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">Searched</span>,
      meaning: 'Pressed Enter - deliberate query submission',
    },
    {
      badge: <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-zinc-100 text-[#64748b] border border-zinc-200">Abandoned</span>,
      meaning: 'Left without any interaction - results may be off',
    },
  ]

  return (
    <div ref={ref} className="relative inline-flex items-center ml-1.5">
      <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setPinned(p => !p)}
        className="text-[#c0c7d1] hover:text-[#64748b] transition-colors"
        aria-label="Intent badge guide"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="6.5" stroke="currentColor" />
          <path d="M7 6.2v3.3M7 4.8v.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </button>

      {visible && (
        <div className="absolute left-0 top-6 z-50 w-80 rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="px-3 pt-3 pb-1 border-b border-zinc-100">
            <p className="text-xs font-medium text-[#242843]">Intent badges</p>
            <p className="text-xs text-[#94a3b8] mt-0.5">What each tag means</p>
          </div>
          <div className="p-3">
            <table className="w-full text-xs border-separate border-spacing-y-1.5">
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td className="pr-3 align-middle whitespace-nowrap">{row.badge}</td>
                    <td className="text-[#64748b] align-middle leading-snug">{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Scrollbar + max-h applied only when expanded so mouse-scroll works over all rows
const scrollbarClass =
  'max-h-[697px] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-thumb:hover]:bg-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full'

const NavRow = ({
  colSpan,
  page,
  expanded,
  total,
  onPrev,
  onNext,
  onToggleExpand,
  hasMore,
  loadingMore,
  onLoadAll,
  showExpandToggle = true,
}: {
  colSpan: number
  page: number
  expanded: boolean
  total: number
  onPrev: () => void
  onNext: () => void
  onToggleExpand: () => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadAll?: () => void
  showExpandToggle?: boolean
}) => {
  if (total <= PAGE_SIZE && !hasMore) return null
  const start = page * PAGE_SIZE + 1
  const end = Math.min((page + 1) * PAGE_SIZE, total)
  return (
    <TableRow className="hover:bg-transparent border-t border-zinc-100">
      <TableCell colSpan={colSpan} className="py-2 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <button
              onClick={onPrev}
              disabled={page === 0}
              className="flex h-6 w-6 items-center justify-center rounded text-[#94a3b8] hover:text-[#242843] disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={onNext}
              disabled={expanded || (page + 1) * PAGE_SIZE >= total}
              className="flex h-6 w-6 items-center justify-center rounded text-[#94a3b8] hover:text-[#242843] disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="ml-2 text-xs text-[#94a3b8]">
              {expanded ? `${total} rows` : `${start}-${end} of ${total}`}
            </span>
            {hasMore && onLoadAll && (
              <button
                onClick={onLoadAll}
                disabled={loadingMore}
                className="ml-2 text-xs text-[#64748b] underline underline-offset-2 hover:text-[#242843] disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load all'}
              </button>
            )}
          </div>
          {showExpandToggle && (
            <button
              onClick={onToggleExpand}
              className="text-xs text-[#94a3b8] hover:text-[#64748b]"
            >
              {expanded ? 'Collapse' : 'Expand all'}
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

export default function AnalyticsPage() {
  const { getToken } = useAuth()

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [topQueries, setTopQueries] = useState<TopQueryItem[]>([])
  const [zeroResults, setZeroResults] = useState<ZeroResultItem[]>([])
  const [queryLog, setQueryLog] = useState<QueryLogItem[]>([])
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingTop, setLoadingTop] = useState(true)
  const [loadingZero, setLoadingZero] = useState(true)
  const [loadingLog, setLoadingLog] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [datesManuallyChanged, setDatesManuallyChanged] = useState(false)
  const [topSortField, setTopSortField] = useState<'count' | 'avg_results'>('count')
  const [topSortDir, setTopSortDir] = useState<'asc' | 'desc'>('desc')
  const [zeroSortField, setZeroSortField] = useState<'count' | 'last_seen'>('count')
  const [zeroSortDir, setZeroSortDir] = useState<'asc' | 'desc'>('desc')
  const [logSortField, setLogSortField] = useState<'searched_at' | 'result_count'>('searched_at')
  const [logSortDir, setLogSortDir] = useState<'asc' | 'desc'>('desc')
  const [copiedTop, setCopiedTop] = useState(false)
  const [copiedZero, setCopiedZero] = useState(false)
  const [intentFilter, setIntentFilter] = useState<string | null>(null)
  const [copiedLog, setCopiedLog] = useState(false)

  // Pagination + expand state
  const [topPage, setTopPage] = useState(0)
  const [topExpanded, setTopExpanded] = useState(false)
  const [zeroPage, setZeroPage] = useState(0)
  const [zeroExpanded, setZeroExpanded] = useState(false)
  const [logPage, setLogPage] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreLog, setHasMoreLog] = useState(true)
  const [loadingMoreTop, setLoadingMoreTop] = useState(false)
  const [hasMoreTop, setHasMoreTop] = useState(true)
  const [loadingMoreZero, setLoadingMoreZero] = useState(false)
  const [hasMoreZero, setHasMoreZero] = useState(true)

  const today = new Date().toISOString().split('T')[0]
  const planStart = '2020-01-01'

  const loadTables = useCallback(
    async (from: string, to: string) => {
      setLoadingTop(true)
      setLoadingZero(true)
      setLoadingLog(true)
      try {
        const token = await getToken()
        if (!token) return
        const [top, zero] = await Promise.all([
          getTopQueries(token, 20, from, to),
          getZeroResults(token, 20, from, to),
        ])
        setTopQueries(top)
        setHasMoreTop(top.length >= 20)
        setZeroResults(zero)
        setHasMoreZero(zero.length >= 20)
        try {
          const log = await getQueryLog(token, 50, from, to)
          setQueryLog(log)
          setHasMoreLog(log.length >= 50)
        } catch {
          setQueryLog([])
          setHasMoreLog(false)
        }
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Failed to load analytics.',
        )
      } finally {
        setLoadingTop(false)
        setLoadingZero(false)
        setLoadingLog(false)
      }
    },
    [getToken],
  )

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        if (!token) return

        const [sum, top, zero] = await Promise.all([
          getAnalyticsSummary(token),
          getTopQueries(token, 20),
          getZeroResults(token, 20),
        ])
        setSummary(sum)
        setTopQueries(top)
        setHasMoreTop(top.length >= 20)
        setZeroResults(zero)
        setHasMoreZero(zero.length >= 20)
        // query-log is isolated - a failure here won't blank the whole page
        try {
          const log = await getQueryLog(token, 50)
          setQueryLog(log)
          setHasMoreLog(log.length >= 50)
        } catch {
          setQueryLog([])
          setHasMoreLog(false)
        }

        const defaultFrom = new Date()
        defaultFrom.setDate(defaultFrom.getDate() - (sum.days_window ?? 7))
        setFromDate(defaultFrom.toISOString().split('T')[0])
        setToDate(today)
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Failed to load analytics.',
        )
      } finally {
        setLoadingSummary(false)
        setLoadingTop(false)
        setLoadingZero(false)
        setLoadingLog(false)
      }
    }

    load()
  }, [getToken])

  useEffect(() => {
    if (datesManuallyChanged && fromDate && toDate) {
      loadTables(fromDate, toDate)
    }
  }, [fromDate, toDate, datesManuallyChanged, loadTables])

  // Reset pages when data changes (e.g. after date filter)
  useEffect(() => { setTopPage(0) }, [topQueries.length])
  useEffect(() => { setZeroPage(0) }, [zeroResults.length])
  useEffect(() => { setLogPage(0) }, [queryLog.length])

  function handleFromDate(value: string) {
    setFromDate(value)
    setDatesManuallyChanged(true)
  }

  function handleToDate(value: string) {
    setToDate(value)
    setDatesManuallyChanged(true)
  }

  async function loadAllTop() {
    setLoadingMoreTop(true)
    try {
      const token = await getToken()
      if (!token) return
      let all = [...topQueries]
      let batch: typeof all = []
      do {
        batch = await getTopQueries(token, 100, datesManuallyChanged ? fromDate : undefined, datesManuallyChanged ? toDate : undefined, all.length)
        all = [...all, ...batch]
      } while (batch.length >= 100)
      setTopQueries(all)
      setHasMoreTop(false)
      setTopExpanded(true)
    } catch { setHasMoreTop(false) }
    finally { setLoadingMoreTop(false) }
  }

  async function loadAllZero() {
    setLoadingMoreZero(true)
    try {
      const token = await getToken()
      if (!token) return
      let all = [...zeroResults]
      let batch: typeof all = []
      do {
        batch = await getZeroResults(token, 100, datesManuallyChanged ? fromDate : undefined, datesManuallyChanged ? toDate : undefined, all.length)
        all = [...all, ...batch]
      } while (batch.length >= 100)
      setZeroResults(all)
      setHasMoreZero(false)
      setZeroExpanded(true)
    } catch { setHasMoreZero(false) }
    finally { setLoadingMoreZero(false) }
  }

  async function loadAllLog() {
    setLoadingMore(true)
    try {
      const token = await getToken()
      if (!token) return
      let all = [...queryLog]
      let batch: typeof all = []
      do {
        batch = await getQueryLog(token, 200, datesManuallyChanged ? fromDate : undefined, datesManuallyChanged ? toDate : undefined, all.length)
        all = [...all, ...batch]
      } while (batch.length >= 200)
      setQueryLog(all)
      setHasMoreLog(false)
    } catch { setHasMoreLog(false) }
    finally { setLoadingMore(false) }
  }

  function handleTopSort(field: 'count' | 'avg_results') {
    if (field === topSortField) {
      setTopSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setTopSortField(field)
      setTopSortDir('desc')
    }
  }

  function handleZeroSort(field: 'count' | 'last_seen') {
    if (field === zeroSortField) {
      setZeroSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setZeroSortField(field)
      setZeroSortDir('desc')
    }
  }

  function handleLogSort(field: 'searched_at' | 'result_count') {
    if (field === logSortField) {
      setLogSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setLogSortField(field)
      setLogSortDir('desc')
    }
  }

  async function copyTopQueries() {
    const sorted = [...topQueries].sort((a, b) => {
      const val = topSortField === 'count' ? a.count - b.count : a.avg_results - b.avg_results
      return topSortDir === 'desc' ? -val : val
    })
    await navigator.clipboard.writeText(sorted.map((r) => r.query).join('\n'))
    setCopiedTop(true)
    setTimeout(() => setCopiedTop(false), 2000)
  }

  async function copyZeroQueries() {
    const sorted = [...zeroResults].sort((a, b) => {
      const val =
        zeroSortField === 'count'
          ? a.count - b.count
          : a.last_seen > b.last_seen
            ? 1
            : a.last_seen < b.last_seen
              ? -1
              : 0
      return zeroSortDir === 'desc' ? -val : val
    })
    await navigator.clipboard.writeText(sorted.map((r) => r.query).join('\n'))
    setCopiedZero(true)
    setTimeout(() => setCopiedZero(false), 2000)
  }

  async function copyLogQueries() {
    await navigator.clipboard.writeText(sortedLog.map(r => r.query).join('\n'))
    setCopiedLog(true)
    setTimeout(() => setCopiedLog(false), 2000)
  }

  if (error) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-[#242843]">Analytics</h1>
        <div className="mt-6 rounded-md border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  const windowLabel = datesManuallyChanged && fromDate && toDate
    ? `${formatDateLabel(fromDate)} – ${formatDateLabel(toDate)}`
    : summary?.days_window === 30
      ? 'Last 30 days of search activity.'
      : 'Last 7 days of search activity.'

  const showCtr = summary?.ctr !== null && summary?.ctr !== undefined

  const sortedTop = [...topQueries].sort((a, b) => {
    const val = topSortField === 'count' ? a.count - b.count : a.avg_results - b.avg_results
    return topSortDir === 'desc' ? -val : val
  })

  const sortedZero = [...zeroResults].sort((a, b) => {
    const val =
      zeroSortField === 'count'
        ? a.count - b.count
        : a.last_seen > b.last_seen
          ? 1
          : a.last_seen < b.last_seen
            ? -1
            : 0
    return zeroSortDir === 'desc' ? -val : val
  })

  // Filter by intent, then sort
  const intentFiltered = intentFilter
    ? queryLog.filter(r => {
        if (intentFilter === 'searched') {
          return r.intent === 'searched' || r.intent === 'searched_browsed'
        }
        return r.intent === intentFilter
      })
    : queryLog
  const sortedLog = [...intentFiltered].sort((a, b) => {
    const val = logSortField === 'searched_at'
      ? (a.searched_at > b.searched_at ? 1 : a.searched_at < b.searched_at ? -1 : 0)
      : (a.result_count ?? -1) - (b.result_count ?? -1)
    return logSortDir === 'desc' ? -val : val
  })

  // Per session, billing applies to the final (latest) settled query.
  const billedKeys = new Set(
    Object.values(
      sortedLog.reduce<Record<string, QueryLogItem>>((acc, row) => {
        const sid = row.session_id
        if (!sid) {
          return acc
        }
        const current = acc[sid]
        if (!current || row.searched_at > current.searched_at) {
          acc[sid] = row
        }
        return acc
      }, {}),
    ).map((row) => `${row.session_id}|${row.searched_at}|${row.query}`),
  )

  const visibleTop = topExpanded ? sortedTop : sortedTop.slice(topPage * PAGE_SIZE, (topPage + 1) * PAGE_SIZE)
  const visibleZero = zeroExpanded ? sortedZero : sortedZero.slice(zeroPage * PAGE_SIZE, (zeroPage + 1) * PAGE_SIZE)
  const visibleLog = sortedLog.slice(logPage * PAGE_SIZE, (logPage + 1) * PAGE_SIZE)

  const dateInputClass =
    'rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-[#242843] focus:outline-none focus:ring-1 focus:ring-zinc-400'

  const activeSortBtn = 'bg-[#4338ca] text-white rounded px-2.5 py-1 text-xs font-medium'
  const inactiveSortBtn =
    'bg-white text-[#64748b] border border-zinc-200 rounded px-2.5 py-1 text-xs font-medium hover:text-[#242843]'

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold text-[#242843]">Analytics</h1>
        <p className="mt-1 text-sm text-[#64748b]">{windowLabel}</p>
      </div>

      <div className={`mt-6 grid gap-4 ${showCtr ? 'grid-cols-6' : 'grid-cols-4'}`}>
        <div className="rounded-lg border border-zinc-100 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">
            Total Sessions
          </p>
          {loadingSummary ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className="mt-1 text-2xl font-semibold text-[#242843]">
              {summary?.total_sessions.toLocaleString() ?? '-'}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-zinc-100 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">
            Total Queries
          </p>
          {loadingSummary ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className="mt-1 text-2xl font-semibold text-[#242843]">
              {summary?.total_searches.toLocaleString() ?? '-'}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-zinc-100 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">
            Zero-Result Searches
          </p>
          {loadingSummary ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className="mt-1 text-2xl font-semibold text-[#242843]">
              {summary?.zero_result_count.toLocaleString() ?? '-'}
            </p>
          )}
        </div>

        {showCtr && (
          <div className="rounded-lg border border-zinc-100 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">
                Click-Through Rate
              </p>
              <span className="group relative">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-[#c0c7d1] hover:text-[#64748b] cursor-help transition-colors">
                  <circle cx="7" cy="7" r="6.5" stroke="currentColor" />
                  <path d="M7 6.2v3.3M7 4.8v.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
                <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-48 rounded-md bg-[#242843] px-2.5 py-1.5 text-[10px] leading-tight text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-50">
                  Clicks / total searches. Measures how often users find and click a result.
                </span>
              </span>
            </div>
            {loadingSummary ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className="mt-1 text-2xl font-semibold text-[#242843]">
                {summary?.ctr != null ? `${(summary.ctr * 100).toFixed(1)}%` : '-'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Date range filter */}
      <div className="mt-6 flex items-center gap-2">
        <span className="text-xs text-[#64748b]">From</span>
        <input
          type="date"
          className={dateInputClass}
          value={fromDate}
          min={planStart}
          max={toDate || today}
          onChange={(e) => handleFromDate(e.target.value)}
        />
        <span className="text-xs text-[#64748b]">to</span>
        <input
          type="date"
          className={dateInputClass}
          value={toDate}
          min={fromDate || planStart}
          max={today}
          onChange={(e) => handleToDate(e.target.value)}
        />
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-0.5">
              <h2 className="text-base font-semibold text-[#242843]">Recent Activity</h2>
              <IntentInfoPopover />
            </div>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Individual settled search events - what viewers actually searched.
            </p>
            <p className="mt-0.5 text-xs text-[#94a3b8]">
              Blue dot marks the final query used for session billing.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button
                className={logSortField === 'searched_at' ? activeSortBtn : inactiveSortBtn}
                onClick={() => handleLogSort('searched_at')}
              >
                Time{logSortField === 'searched_at' ? (logSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
              <button
                className={logSortField === 'result_count' ? activeSortBtn : inactiveSortBtn}
                onClick={() => handleLogSort('result_count')}
              >
                Results{logSortField === 'result_count' ? (logSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
              <Button variant="outline" size="sm" onClick={copyLogQueries}>
                {copiedLog ? 'Copied!' : 'Copy all'}
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              {[null, 'clicked', 'browsed', 'searched', 'abandoned'].map((intent) => (
                <button
                  key={intent ?? 'all'}
                  onClick={() => { setIntentFilter(intent); setLogPage(0) }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    intentFilter === intent
                      ? 'bg-[#4338ca] text-white'
                      : 'bg-zinc-100 text-[#64748b] hover:bg-zinc-200'
                  }`}
                >
                  {intent ? intent.charAt(0).toUpperCase() + intent.slice(1) : 'All'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-100 overflow-hidden">
          {loadingLog ? (
            <div className="p-4"><TableSkeleton rows={5} /></div>
          ) : sortedLog.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#94a3b8]">
              No settled search events yet. Searches are logged once a user pauses, clicks, or presses Enter.
            </div>
          ) : (
            <div>
              <table className="w-full table-fixed caption-bottom text-sm">
                <colgroup>
                  <col className="w-[50%]" />
                  <col className="w-[18%]" />
                  <col className="w-[10%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Results</TableHead>
                    <TableHead>Intent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLog.map((row, idx) => {
                    const billedKey = row.session_id
                      ? `${row.session_id}|${row.searched_at}|${row.query}`
                      : `single|${row.searched_at}|${row.query}`
                    const isBilled = row.session_id ? billedKeys.has(billedKey) : true

                    return (
                      <TableRow key={`${row.searched_at}-${row.query}-${idx}`}>
                        <TableCell className="font-medium text-[#242843] max-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isBilled && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2563eb]"
                                title="Billable query for this session"
                                aria-label="Billable query"
                              />
                            )}
                            <span className="truncate" title={row.query}>{row.query}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-[#64748b] text-sm whitespace-nowrap">
                          {row.searched_at ? new Date(row.searched_at).toLocaleString('en-GB', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          }) : '-'}
                        </TableCell>
                        <TableCell className="text-right text-[#64748b]">{row.result_count ?? '-'}</TableCell>
                        <TableCell>
                          <IntentBadge intent={row.intent} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                <TableFooter className="sticky bottom-0 z-10 bg-white">
                  <NavRow
                    colSpan={4}
                    page={logPage}
                    expanded={false}
                    total={sortedLog.length}
                    onPrev={() => setLogPage(p => p - 1)}
                    onNext={() => setLogPage(p => p + 1)}
                    onToggleExpand={() => {}}
                    hasMore={hasMoreLog}
                    loadingMore={loadingMore}
                    onLoadAll={loadAllLog}
                    showExpandToggle={false}
                  />
                </TableFooter>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#242843]">Top Queries</h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Most-searched terms that returned results.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={topSortField === 'count' ? activeSortBtn : inactiveSortBtn}
              onClick={() => handleTopSort('count')}
            >
              Searches{topSortField === 'count' ? (topSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
            <button
              className={topSortField === 'avg_results' ? activeSortBtn : inactiveSortBtn}
              onClick={() => handleTopSort('avg_results')}
            >
              Avg Results{topSortField === 'avg_results' ? (topSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
            <Button variant="outline" size="sm" onClick={copyTopQueries}>
              {copiedTop ? 'Copied!' : 'Copy all'}
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-100 overflow-hidden">
          {loadingTop ? (
            <div className="p-4">
              <TableSkeleton rows={5} />
            </div>
          ) : sortedTop.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#94a3b8]">
              No search data yet. Add the widget to your platform to start collecting data.
            </div>
          ) : (
            <div className={topExpanded ? scrollbarClass : ''}>
              <table className="w-full table-fixed caption-bottom text-sm">
                <colgroup>
                  <col className="w-[60%]" />
                  <col className="w-[20%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="text-right">Searches</TableHead>
                    <TableHead className="text-right">Avg results</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTop.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-[#242843] max-w-0">
                        <span className="block truncate" title={row.query}>{row.query}</span>
                      </TableCell>
                      <TableCell className="text-right text-[#64748b]">
                        {row.count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-[#64748b]">
                        {row.avg_results.toFixed(1)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter className="sticky bottom-0 z-10 bg-white">
                  <NavRow
                    colSpan={3}
                    page={topPage}
                    expanded={topExpanded}
                    total={sortedTop.length}
                    onPrev={() => setTopPage(p => p - 1)}
                    onNext={() => setTopPage(p => p + 1)}
                    onToggleExpand={() => { setTopExpanded(e => !e); setTopPage(0) }}
                    hasMore={hasMoreTop}
                    loadingMore={loadingMoreTop}
                    onLoadAll={loadAllTop}
                  />
                </TableFooter>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#242843]">
              Zero-Result Queries
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Searches that returned no content - consider adding these titles.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={zeroSortField === 'count' ? activeSortBtn : inactiveSortBtn}
              onClick={() => handleZeroSort('count')}
            >
              Searches{zeroSortField === 'count' ? (zeroSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
            <button
              className={zeroSortField === 'last_seen' ? activeSortBtn : inactiveSortBtn}
              onClick={() => handleZeroSort('last_seen')}
            >
              Last Seen{zeroSortField === 'last_seen' ? (zeroSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
            <Button variant="outline" size="sm" onClick={copyZeroQueries}>
              {copiedZero ? 'Copied!' : 'Copy all'}
            </Button>
            {!loadingZero && zeroResults.length > 0 && summary?.days_window === 30 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCsv(zeroResults)}
              >
                Export CSV
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-100 overflow-hidden">
          {loadingZero ? (
            <div className="p-4">
              <TableSkeleton rows={5} />
            </div>
          ) : sortedZero.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#94a3b8]">
              No zero-result queries. Great - your catalog covers what customers are
              searching for.
            </div>
          ) : (
            <div className={zeroExpanded ? scrollbarClass : ''}>
              <table className="w-full table-fixed caption-bottom text-sm">
                <colgroup>
                  <col className="w-[60%]" />
                  <col className="w-[20%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="text-right">Searches</TableHead>
                    <TableHead className="text-right">Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleZero.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-[#242843] max-w-0">
                        <span className="block truncate" title={row.query}>{row.query}</span>
                      </TableCell>
                      <TableCell className="text-right text-[#64748b]">
                        {row.count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-[#64748b] text-sm">
                        {row.last_seen
                          ? new Date(row.last_seen).toLocaleDateString()
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter className="sticky bottom-0 z-10 bg-white">
                  <NavRow
                    colSpan={3}
                    page={zeroPage}
                    expanded={zeroExpanded}
                    total={sortedZero.length}
                    onPrev={() => setZeroPage(p => p - 1)}
                    onNext={() => setZeroPage(p => p + 1)}
                    onToggleExpand={() => { setZeroExpanded(e => !e); setZeroPage(0) }}
                    hasMore={hasMoreZero}
                    loadingMore={loadingMoreZero}
                    onLoadAll={loadAllZero}
                  />
                </TableFooter>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Terminology footer */}
      <section className="mt-10 rounded-lg border border-zinc-100 bg-zinc-50 px-5 py-4">
        <p className="text-xs font-semibold text-[#242843] mb-2">How we count</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs text-[#64748b]">
          <div>
            <p className="font-medium text-[#242843]">Query</p>
            <p>Every search API call. Typing &quot;christopher nolan films&quot; fires ~4 queries as each keystroke triggers a search. This is what we process behind the scenes.</p>
          </div>
          <div>
            <p className="font-medium text-[#242843]">Session</p>
            <p>One viewer using your search bar once. A session starts when they type and ends when they click, press Enter, or leave. Typing &quot;christopher nolan films&quot; = 1 session, not 4.</p>
          </div>
          <div>
            <p className="font-medium text-[#242843]">Billing</p>
            <p>Your plan limit counts sessions, not queries. This means you pay for real viewer interactions, not keystrokes. A platform with 500 viewers searching daily uses ~500 sessions/day.</p>
          </div>
        </div>
      </section>

    </div>
  )
}
