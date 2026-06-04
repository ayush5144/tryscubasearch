'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  getApiKeys,
  type ApiKeyItem,
  type SearchProduct,
  ApiError,
} from '@/lib/api-client'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const WIDGET_SCRIPT_ID = 'scs-test-widget'

type ScubaSearchGlobal = Window & {
  ScubaSearch?: {
    destroy?: () => void
    click?: (productId: string) => void
    engage?: () => void
  }
}

type DirectSearchResponse = {
  results: SearchProduct[]
  total: number
  cache_hit: boolean
  processing_time_ms: number
  log_id?: string
}

/** Kill any existing widget instance - destroy listeners, remove script + DOM */
function cleanupWidget() {
  const scubaWindow = window as ScubaSearchGlobal
  if (scubaWindow.ScubaSearch?.destroy) scubaWindow.ScubaSearch.destroy()
  const prev = document.getElementById(WIDGET_SCRIPT_ID)
  if (prev) prev.remove()
  document.querySelectorAll('.scs-wrap, .scs-wrapper, .scs-dropdown').forEach((el) => el.remove())
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function ModeToggle({
  mode,
  onChange,
}: {
  mode: 'api' | 'widget'
  onChange: (m: 'api' | 'widget') => void
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-1 gap-1">
      <button
        onClick={() => onChange('api')}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          mode === 'api'
            ? 'bg-white text-[#242843] shadow-sm border border-zinc-200'
            : 'text-[#64748b] hover:text-[#242843]'
        }`}
      >
        API mode
      </button>
      <button
        onClick={() => onChange('widget')}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          mode === 'widget'
            ? 'bg-white text-[#242843] shadow-sm border border-zinc-200'
            : 'text-[#64748b] hover:text-[#242843]'
        }`}
      >
        Widget mode
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Widget mode - injects real widget.js, full tracking
// ---------------------------------------------------------------------------

function SemanticSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const label =
    value === 0 ? 'Keyword only' :
    value === 1 ? 'Semantic only' :
    value < 0.4 ? 'Keyword-heavy' :
    value > 0.6 ? 'Semantic-heavy' : 'Balanced'

  return (
    <div className="mx-auto mt-4 flex max-w-xl items-center gap-3">
      <span className="shrink-0 text-xs text-[#64748b]">Keyword</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-[#4338ca]"
      />
      <span className="shrink-0 text-xs text-[#64748b]">Semantic</span>
      <input
        type="number"
        min="0"
        max="100"
        step="1"
        value={Math.round(value * 100)}
        onChange={(e) => {
          const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0))
          onChange(v / 100)
        }}
        className="w-12 shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-center text-xs font-medium text-[#242843] focus:outline-none focus:ring-1 focus:ring-[#4338ca]/30"
      />
      <span className="shrink-0 text-xs text-[#64748b]">{label}</span>
    </div>
  )
}

function WidgetMode({ apiKey }: { apiKey: string }) {
  const [semanticRatio, setSemanticRatio] = useState(0.5)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inject widget - debounced on semanticRatio to avoid destroying input mid-drag
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      cleanupWidget()

      const script = document.createElement('script')
      script.id = WIDGET_SCRIPT_ID
      script.src = '/widget.js'
      script.setAttribute('data-api-key', apiKey)
      script.setAttribute('data-api-base', API_BASE_URL + '/api/v1')
      script.setAttribute('data-placeholder', 'Search titles...')
      script.setAttribute('data-theme', 'light')
      script.setAttribute('data-max-results', '8')
      script.setAttribute('data-semantic-ratio', String(semanticRatio))
      document.body.appendChild(script)
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      cleanupWidget()
    }
  }, [apiKey, semanticRatio])

  return (
    <div className="mt-8">
      <div className="flex justify-center">
        <input
          type="search"
          placeholder="Search titles..."
          className="w-full max-w-xl h-12 px-4 border border-zinc-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-zinc-300"
        />
      </div>
      <SemanticSlider value={semanticRatio} onChange={setSemanticRatio} />
      <p className="mt-3 text-center text-xs text-[#94a3b8]">
        Running real <code className="font-mono bg-zinc-100 px-1 rounded">widget.js</code> with default dropdown UI - full session tracking
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

function ProductCard({
  product,
  onProductClick,
}: {
  product: SearchProduct
  onProductClick?: () => void
}) {
  const card = (
    <div
      className={`group flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white transition-shadow hover:shadow-md ${
        product.product_url ? 'cursor-pointer' : ''
      }`}
    >
      <div className="aspect-square w-full overflow-hidden bg-zinc-100">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.title ?? ''}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium text-[#242843] leading-snug">
          {product.title ?? 'Untitled title'}
        </p>
      </div>
    </div>
  )

  if (product.product_url) {
    return (
      <a href={product.product_url} target="_blank" rel="noopener noreferrer" onClick={onProductClick}>
        {card}
      </a>
    )
  }
  return card
}

function ResultsSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-zinc-200">
          <Skeleton className="aspect-square w-full" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// API key entry prompt
// ---------------------------------------------------------------------------

function ApiKeyPrompt({ keyPrefix, onSubmit }: { keyPrefix: string; onSubmit: (key: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-6">
      <p className="text-sm font-medium text-[#242843]">Enter your full API key to start searching</p>
      <p className="mt-1 text-sm text-[#64748b]">
        Your key starting with{' '}
        <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-mono text-[#242843]">{keyPrefix}...</code>{' '}
        was shown once when you created it. Paste it below.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Input
          type="password"
          placeholder="ssk_live_..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onSubmit(value.trim()) }}
          className="max-w-sm font-mono text-sm"
          autoFocus
        />
        <button
          disabled={!value.trim()}
          onClick={() => onSubmit(value.trim())}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use this key
        </button>
      </div>
      <p className="mt-3 text-xs text-[#94a3b8]">
        Don&apos;t have the key? Create a new one in{' '}
        <a href="/dashboard/settings" className="font-medium text-[#64748b] underline underline-offset-2 hover:text-[#242843]">
          Settings
        </a>.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// API mode - direct /search + /click + /settle flow (like testapi.html)
// ---------------------------------------------------------------------------

function ApiMode({
  apiKey,
  semanticRatio,
  onSemanticRatioChange,
  results,
  setResults,
  hasSearched,
  setHasSearched,
}: {
  apiKey: string
  semanticRatio: number
  onSemanticRatioChange: (v: number) => void
  results: SearchProduct[]
  setResults: (r: SearchProduct[]) => void
  hasSearched: boolean
  setHasSearched: (v: boolean) => void
}) {
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastLogIdRef = useRef<string | null>(null)
  const querySnapshotsRef = useRef<Array<{ value: string; timestamp: number }>>([])
  const queryMetaRef = useRef<Record<string, { result_count: number; cache_hit: boolean; response_ms: number }>>({})
  const engagementRef = useRef(false)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        void settle('visibilitychange')
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [apiKey, sessionId])

  function resetSearchState() {
    setResults([])
    setHasSearched(false)
    setLastQuery('')
    setError(null)
    lastLogIdRef.current = null
    querySnapshotsRef.current = []
    queryMetaRef.current = {}
    engagementRef.current = false
    abortRef.current?.abort()
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }

  async function settle(signal: 'idle' | 'enter' | 'click' | 'visibilitychange') {
    if (querySnapshotsRef.current.length === 0) return
    try {
      await fetch(`${API_BASE_URL}/api/v1/search/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          log_id: lastLogIdRef.current,
          session_id: sessionId,
          queries: querySnapshotsRef.current,
          query_meta: queryMetaRef.current,
          signal,
          engagement: signal === 'click' || engagementRef.current,
        }),
      })
    } catch {
      // fire-and-forget in test mode
    }
  }

  async function doSearch(nextQuery: string) {
    const trimmed = nextQuery.trim()
    if (trimmed.length < 2) {
      resetSearchState()
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setError(null)
    engagementRef.current = false

    try {
      const startedAt = Date.now()
      const res = await fetch(`${API_BASE_URL}/api/v1/search`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: trimmed,
          limit: 12,
          semantic_ratio: semanticRatio,
        }),
      })
      const data = (await res.json()) as DirectSearchResponse | { detail?: { message?: string } | string }
      if (!res.ok) {
        const message =
          typeof data === 'object' && data && 'detail' in data
            ? typeof data.detail === 'string'
              ? data.detail
              : data.detail?.message ?? `Search failed (${res.status})`
            : `Search failed (${res.status})`
        throw new Error(message)
      }

      const okData = data as DirectSearchResponse
      lastLogIdRef.current = okData.log_id ?? null
      const lastSnapshot = querySnapshotsRef.current[querySnapshotsRef.current.length - 1]
      if (lastSnapshot?.value !== trimmed) {
        querySnapshotsRef.current.push({ value: trimmed, timestamp: Date.now() })
      }
      queryMetaRef.current[trimmed] = {
        result_count: okData.results.length,
        cache_hit: okData.cache_hit === true,
        response_ms: okData.processing_time_ms ?? Date.now() - startedAt,
      }
      setResults(okData.results ?? [])
      setLastQuery(trimmed)
      setHasSearched(true)

      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => {
        void settle('idle')
        settleTimerRef.current = null
      }, 3000)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setResults([])
      setHasSearched(true)
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleInputChange(nextValue: string) {
    setQuery(nextValue)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = nextValue.trim()
    if (!trimmed) {
      resetSearchState()
      return
    }

    debounceRef.current = setTimeout(() => {
      void doSearch(trimmed)
    }, 100)
  }

  function markEngaged() {
    engagementRef.current = true
  }

  async function handleProductClick(productId: string) {
    markEngaged()
    try {
      await fetch(`${API_BASE_URL}/api/v1/search/click`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          product_id: productId,
          search_log_id: lastLogIdRef.current,
        }),
      })
    } catch {
      // fire-and-forget in test mode
    }
    await settle('click')
  }

  return (
    <div className="mt-8">
      <div className="flex justify-center">
        <input
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (debounceRef.current) clearTimeout(debounceRef.current)
              const trimmed = query.trim()
              if (trimmed) {
                void (async () => {
                  await doSearch(trimmed)
                  await settle('enter')
                })()
              }
            }
            if (e.key === 'Escape') {
              setQuery('')
              resetSearchState()
            }
          }}
          type="search"
          placeholder="Search titles..."
          className="w-full max-w-xl h-12 px-4 border border-zinc-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
        />
      </div>

      <SemanticSlider value={semanticRatio} onChange={onSemanticRatioChange} />

      {error && (
        <div className="mx-auto mt-4 max-w-xl rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {hasSearched && results.length === 0 ? (
        <div className="mt-10 text-center text-sm text-[#64748b]">
          No results for &ldquo;{lastQuery}&rdquo;.
          <p className="mt-2 text-xs text-[#94a3b8]">
            If you haven&apos;t uploaded titles yet,{' '}
            <a href="/dashboard/documents" className="font-medium text-[#242843] underline underline-offset-2 hover:text-[#64748b]">upload a catalog</a>{' '}
            in Documents first.
          </p>
        </div>
      ) : results.length > 0 ? (
        <div
          className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          onWheel={markEngaged}
          onTouchMove={markEngaged}
        >
          {results.map((product) => (
            <div key={product.id} onMouseEnter={markEngaged} onFocus={markEngaged}>
              <ProductCard
                product={product}
                onProductClick={() => void handleProductClick(product.id)}
              />
            </div>
          ))}
        </div>
      ) : (
        !hasSearched && !isLoading && (
          <div className="mt-10 text-center text-sm text-[#94a3b8]">
            Start typing to see results from your catalog.
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type KeysPhase =
  | { phase: 'loading' }
  | { phase: 'no-keys' }
  | { phase: 'need-full-key'; keyPrefix: string }
  | { phase: 'ready'; apiKey: string }
  | { phase: 'error'; message: string }

export default function TestScubaPage() {
  const { getToken } = useAuth()

  const [keysPhase, setKeysPhase] = useState<KeysPhase>({ phase: 'loading' })
  const [mode, setMode] = useState<'api' | 'widget'>('api')

  const [results, setResults] = useState<SearchProduct[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [semanticRatio, setSemanticRatio] = useState(0.5)

  const apiKeyRef = useRef<string>('')

  useEffect(() => {
    async function loadKeys() {
      try {
        const token = await getToken()
        if (!token) return
        const keys: ApiKeyItem[] = await getApiKeys(token)
        const activeKey = keys.find((k) => k.is_active)
        if (!activeKey) {
          setKeysPhase({ phase: 'no-keys' })
        } else {
          setKeysPhase({ phase: 'need-full-key', keyPrefix: activeKey.key_prefix })
        }
      } catch (err) {
        setKeysPhase({ phase: 'error', message: err instanceof ApiError ? err.message : 'Failed to load API keys.' })
      }
    }
    loadKeys()
  }, [getToken])

  // Kill previous widget and reset state when switching modes
  useEffect(() => {
    cleanupWidget()
    queueMicrotask(() => {
      setResults([])
      setHasSearched(false)
    })
  }, [mode])

  const apiKey = keysPhase.phase === 'ready' ? keysPhase.apiKey : ''

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#242843]">Try Search</h1>
          <p className="mt-1 text-sm text-[#64748b]">
            {mode === 'api'
              ? 'Direct API search flow, matching testapi.html.'
              : 'Real widget.js - same script your platform pastes.'}
          </p>
        </div>
        {keysPhase.phase === 'ready' && (
          <ModeToggle mode={mode} onChange={setMode} />
        )}
      </div>

      {/* Loading */}
      {keysPhase.phase === 'loading' && (
        <div className="mt-8 flex justify-center">
          <Skeleton className="h-12 w-full max-w-xl rounded-lg" />
        </div>
      )}

      {/* Error */}
      {keysPhase.phase === 'error' && (
        <div className="mt-6 rounded-md border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {keysPhase.message}
        </div>
      )}

      {/* No keys */}
      {keysPhase.phase === 'no-keys' && (
        <div className="mt-8 rounded-md border border-zinc-100 bg-zinc-50 p-8 text-center">
          <p className="text-sm font-medium text-[#242843]">No API key found</p>
          <p className="mt-1 text-sm text-[#64748b]">
            Create an API key in{' '}
            <a href="/dashboard/settings" className="font-medium text-[#242843] underline underline-offset-2 hover:text-[#64748b]">Settings</a>{' '}
            first.
          </p>
        </div>
      )}

      {/* Need full key */}
      {keysPhase.phase === 'need-full-key' && (
        <ApiKeyPrompt
          keyPrefix={keysPhase.keyPrefix}
          onSubmit={(key) => {
            apiKeyRef.current = key
            setKeysPhase({ phase: 'ready', apiKey: key })
          }}
        />
      )}

      {/* Ready */}
      {keysPhase.phase === 'ready' && (
        <>
          {mode === 'widget' ? (
            <WidgetMode apiKey={apiKey} />
          ) : (
            <ApiMode
              apiKey={apiKey}
              semanticRatio={semanticRatio}
              onSemanticRatioChange={setSemanticRatio}
              results={results}
              setResults={setResults}
              hasSearched={hasSearched}
              setHasSearched={setHasSearched}
            />
          )}
        </>
      )}
    </div>
  )
}
