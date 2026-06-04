'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { AlertCircle, CheckCircle2, ChevronDown, Database, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  ColumnInfo,
  DatabaseType,
  DatabaseStatus,
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
  listDatabaseTables,
  previewDatabaseColumns,
  resyncDatabase,
} from '@/lib/api-client'

const SCUBA_FIELDS = [
  { key: 'title',       label: 'Title',                    required: true  },
  { key: 'description', label: 'Description',              required: false },
  { key: 'category',    label: 'Genre',                    required: false },
  { key: 'tags',        label: 'Tags (comma-separated)',   required: false },
  { key: 'actors',      label: 'Actors / Cast',            required: false },
  { key: 'director',    label: 'Director',                 required: false },
  { key: 'writer',      label: 'Writer',                   required: false },
  { key: 'content_type', label: 'Content Type',            required: false },
  { key: 'year',        label: 'Release Year',             required: false },
  { key: 'language',    label: 'Language',                 required: false },
  { key: 'duration_mins', label: 'Duration (minutes)',     required: false },
  { key: 'image_url',   label: 'Thumbnail URL',            required: false },
  { key: 'product_url', label: 'Content URL',              required: false },
  { key: 'external_id', label: 'External ID',              required: false },
]

const EMPTY_DATABASE_STATUS: DatabaseStatus = {
  connected: false,
  db_type: null,
  table_name: null,
  field_mapping: null,
  sync_status: null,
  product_count: null,
  last_synced_at: null,
  error_message: null,
  source_columns: null,
}

const DATABASE_OPTIONS: Array<{
  value: DatabaseType
  label: string
  description: string
  placeholder: string
  prefixes: string[]
  locationHint: string
}> = [
  {
    value: 'postgres',
    label: 'PostgreSQL',
    description: 'For Postgres catalogs',
    placeholder: 'postgresql://user:password@host:5432/dbname',
    prefixes: ['postgres://', 'postgresql://'],
    locationHint: 'Tables are loaded from the public schema.',
  },
  {
    value: 'mysql',
    label: 'MySQL / MariaDB',
    description: 'For MySQL or MariaDB catalogs',
    placeholder: 'mysql://user:password@host:3306/dbname',
    prefixes: ['mysql://', 'mysql+pymysql://', 'mariadb://', 'mariadb+pymysql://'],
    locationHint: 'Tables are loaded from the selected database.',
  },
]

function SyncBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending',   className: 'bg-amber-50 text-amber-700 border-amber-200'   },
    syncing: { label: 'Syncing...',  className: 'bg-[#4338ca]/8 text-[#4338ca] border-[#4338ca]/15' },
    done:    { label: 'Synced',    className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    failed:  { label: 'Failed',    className: 'bg-red-50 text-red-700 border-red-200'         },
  }
  const s = map[status] ?? map.pending
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}

// Build the options list for a field's column selector.
// Top level: plain column names. JSON columns also get sub-paths like "metadata.price".
function buildOptions(columns: ColumnInfo[]): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = []
  for (const c of columns) {
    opts.push({ value: c.name, label: `${c.name}  (${c.type})` })
    if (c.type === 'jsonb' || c.type === 'json') {
      // Suggest common sub-keys so users know dot-notation is available
      for (const sub of ['title', 'description', 'image', 'url', 'category', 'genre', 'actors', 'director', 'language', 'year']) {
        opts.push({ value: `${c.name}.${sub}`, label: `  ${c.name}.${sub}  (JSON path)` })
      }
    }
  }
  return opts
}

function getDatabaseOption(dbType: DatabaseType) {
  return DATABASE_OPTIONS.find((option) => option.value === dbType) ?? DATABASE_OPTIONS[0]
}

function getDatabaseLabel(dbType: DatabaseType | null | undefined) {
  if (!dbType) return 'Database'
  return getDatabaseOption(dbType).label
}

function validateConnectionString(dbType: DatabaseType, value: string): string | null {
  const raw = value.trim()
  const { prefixes, label } = getDatabaseOption(dbType)

  if (!raw) return 'Enter a database connection string.'
  if (!prefixes.some((prefix) => raw.startsWith(prefix))) {
    return `${label} URL must start with ${prefixes.join(' or ')}. Enter only the database URL, not the table name.`
  }
  if (raw.includes(',') || raw.toLowerCase().includes(' table')) {
    return 'Connection string looks malformed. Enter only the database URL, not the table name.'
  }
  return null
}

export default function DatabasePage() {
  const { getToken } = useAuth()

  const [status, setStatus] = useState<DatabaseStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [dbType, setDbType] = useState<DatabaseType>('postgres')

  // Step 1: connection string
  const [connStr, setConnStr] = useState('')
  const [loadingTables, setLoadingTables] = useState(false)
  const [tables, setTables] = useState<string[]>([])

  // Step 2: table selection
  const [tableName, setTableName] = useState('')
  const [loadingCols, setLoadingCols] = useState(false)
  const [columns, setColumns] = useState<ColumnInfo[]>([])

  // Step 3: mapping
  const [mapping, setMapping] = useState<Record<string, string>>({})

  const [step, setStep] = useState<'conn' | 'table' | 'mapping'>('conn')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const loadStatus = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    try {
      const nextStatus = await getDatabaseStatus(token)
      setStatus(nextStatus)
      if (nextStatus.db_type) setDbType(nextStatus.db_type)
    } catch {
      setStatus(EMPTY_DATABASE_STATUS)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { loadStatus() }, [loadStatus])

  useEffect(() => {
    if (!status?.connected) return
    if (status.sync_status !== 'syncing' && status.sync_status !== 'pending') return
    const t = setInterval(loadStatus, 3000)
    return () => clearInterval(t)
  }, [loadStatus, status?.connected, status?.sync_status])

  // Step 1 → fetch tables on blur / button click
  async function handleLoadTables() {
    const raw = connStr.trim()
    const validationError = validateConnectionString(dbType, raw)
    if (validationError) {
      setError(validationError)
      return
    }
    setLoadingTables(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const list = await listDatabaseTables(token, {
        db_type: dbType,
        connection_string: raw,
      })
      if (!list.length) {
        throw new Error(dbType === 'postgres' ? 'No tables found in public schema' : 'No tables found in this database')
      }
      setTables(list)
      setTableName(list[0])
      setStep('table')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLoadingTables(false)
    }
  }

  // Step 2 → fetch columns for chosen table
  async function handleLoadColumns() {
    if (!tableName) return
    setLoadingCols(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const cols = await previewDatabaseColumns(token, {
        db_type: dbType,
        connection_string: connStr.trim(),
        table_name: tableName,
      })
      setColumns(cols)
      // auto-map obvious matches
      const auto: Record<string, string> = {}
      for (const f of SCUBA_FIELDS) {
        const match = cols.find(c =>
          c.name.toLowerCase() === f.key ||
          c.name.toLowerCase().replace(/[_ ]/g, '') === f.key.replace(/_/g, '')
        )
        if (match) auto[f.key] = match.name
      }
      setMapping(auto)
      setStep('mapping')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load columns')
    } finally {
      setLoadingCols(false)
    }
  }

  async function handleConnect() {
    if (!mapping.title) { setError('Title mapping is required'); return }
    setConnecting(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      await connectDatabase(token, {
        db_type: dbType,
        connection_string: connStr.trim(),
        table_name: tableName,
        field_mapping: mapping,
      })
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect')
    } finally {
      setConnecting(false)
    }
  }

  async function handleResync() {
    const token = await getToken()
    if (!token) return
    try { await resyncDatabase(token); await loadStatus() }
    catch (e) { setError(e instanceof Error ? e.message : 'Resync failed') }
  }

  async function handleDisconnect() {
    const token = await getToken()
    if (!token) return
    try {
      await disconnectDatabase(token)
      setStatus(EMPTY_DATABASE_STATUS)
      setDbType('postgres')
      setConnStr(''); setTableName(''); setTables([]); setColumns([])
      setMapping({}); setStep('conn'); setConfirmDisconnect(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Disconnect failed') }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[300px]">
      <Loader2 className="h-6 w-6 animate-spin text-[#4338ca]" />
    </div>
  )

  // ── Connected ─────────────────────────────────────────────────────────────
  if (status?.connected) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4338ca]/8">
            <Database className="h-5 w-5 text-[#4338ca]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#242843]">Database Connected</h1>
            <p className="text-sm text-[#64748b]">{getDatabaseLabel(status.db_type)} · {status.table_name}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#242843]">Sync status</p>
            <SyncBadge status={status.sync_status ?? 'pending'} />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[#94a3b8] text-xs">Documents synced</p>
              <p className="font-semibold text-[#242843]">{status.product_count ?? '-'}</p>
            </div>
            <div>
              <p className="text-[#94a3b8] text-xs">Last synced</p>
              <p className="font-semibold text-[#242843]">
                {status.last_synced_at ? new Date(status.last_synced_at).toLocaleString() : '-'}
              </p>
            </div>
          </div>
          {status.error_message && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {status.error_message}
            </div>
          )}
        </div>

        {status.field_mapping && Object.keys(status.field_mapping).length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 mb-4">
            <p className="text-sm font-semibold text-[#242843] mb-3">Field mapping</p>
            <div className="flex flex-col gap-1.5">
              {Object.entries(status.field_mapping).map(([scuba, col]) => (
                <div key={scuba} className="flex items-center justify-between text-sm">
                  <span className="text-[#64748b]">{scuba}</span>
                  <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-[#242843]">{col as string}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleResync}
            disabled={status.sync_status === 'syncing' || status.sync_status === 'pending'}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <RefreshCw className="h-4 w-4" /> Resync catalog
          </button>
          {!confirmDisconnect ? (
            <button onClick={() => setConfirmDisconnect(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-[#64748b] hover:border-red-300 hover:text-red-600 transition-all">
              <Trash2 className="h-4 w-4" /> Disconnect
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#64748b]">Sure?</span>
              <button onClick={handleDisconnect} className="text-sm font-semibold text-red-600 hover:text-red-700">Yes, disconnect</button>
              <button onClick={() => setConfirmDisconnect(false)} className="text-sm text-[#64748b]">Cancel</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Setup flow ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4338ca]/8">
          <Database className="h-5 w-5 text-[#4338ca]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#242843]">Connect a Database</h1>
          <p className="text-sm text-[#64748b]">Pull documents directly from PostgreSQL or MySQL/MariaDB.</p>
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Step 1 - connection string */}
      <div className={`rounded-2xl border bg-white p-6 mb-4 ${step !== 'conn' ? 'border-[#4338ca]/30' : 'border-slate-200'}`}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[#242843]">
            {step !== 'conn' && <CheckCircle2 className="inline h-4 w-4 text-emerald-500 mr-1.5 -mt-0.5" />}
            Step 1 - Database connection
          </p>
          {step !== 'conn' && (
            <button onClick={() => { setStep('conn'); setTables([]); setColumns([]); setMapping({}) }}
              className="text-xs text-[#4338ca] hover:underline">Edit</button>
            )}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {DATABASE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setDbType(option.value)
                setError(null)
                setTables([])
                setTableName('')
                setColumns([])
                setMapping({})
                setStep('conn')
              }}
              disabled={step !== 'conn'}
              className={`rounded-xl border px-4 py-3 text-left transition-all ${
                dbType === option.value
                  ? 'border-[#4338ca]/30 bg-[#4338ca]/6'
                  : 'border-slate-200 hover:border-slate-300'
              } ${step !== 'conn' ? 'cursor-not-allowed opacity-70' : ''}`}
            >
              <div className="text-sm font-semibold text-[#242843]">{option.label}</div>
              <div className="mt-1 text-xs text-[#64748b]">{option.description}</div>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={connStr}
            onChange={(e) => setConnStr(e.target.value)}
            disabled={step !== 'conn'}
            placeholder={getDatabaseOption(dbType).placeholder}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-mono text-[#242843] placeholder:text-[#94a3b8] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15 disabled:bg-slate-50 disabled:text-[#94a3b8] transition-all"
          />
          {step === 'conn' && (
            <button
              onClick={handleLoadTables}
              disabled={loadingTables || !connStr.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
            >
              {loadingTables ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
            </button>
            )}
        </div>
        <div className="mt-1.5 space-y-1 text-xs text-[#94a3b8]">
          <p>Supports PostgreSQL and MySQL/MariaDB.</p>
          <p>Your connection string is encrypted before it is saved, and we recommend using a read-only database user for extra safety.</p>
        </div>
      </div>

      {/* Step 2 - table picker */}
      {(step === 'table' || step === 'mapping') && (
        <div className={`rounded-2xl border bg-white p-6 mb-4 ${step === 'mapping' ? 'border-[#4338ca]/30' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#242843]">
              {step === 'mapping' && <CheckCircle2 className="inline h-4 w-4 text-emerald-500 mr-1.5 -mt-0.5" />}
              Step 2 - Select table
            </p>
            {step === 'mapping' && (
              <button onClick={() => { setStep('table'); setColumns([]); setMapping({}) }}
                className="text-xs text-[#4338ca] hover:underline">Edit</button>
            )}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <select
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                disabled={step === 'mapping'}
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15 disabled:bg-slate-50 disabled:text-[#94a3b8] transition-all"
              >
                {tables.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
            </div>
            {step === 'table' && (
              <button
                onClick={handleLoadColumns}
                disabled={loadingCols || !tableName}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
              >
                {loadingCols ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Preview columns'}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-[#94a3b8]">
            {tables.length} table{tables.length !== 1 ? 's' : ''} found. {getDatabaseOption(dbType).locationHint}
          </p>
        </div>
      )}

      {/* Step 3 - field mapping */}
      {step === 'mapping' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 mb-4">
          <p className="text-sm font-semibold text-[#242843] mb-1">Step 3 - Map fields</p>
          <p className="text-xs text-[#94a3b8] mb-4">
            {columns.length} columns found. JSON columns show dot-path options (e.g. <span className="font-mono">metadata.genre</span>).
          </p>
          <div className="flex flex-col gap-3">
            {SCUBA_FIELDS.map((field) => {
              const opts = buildOptions(columns)
              return (
                <div key={field.key} className="flex items-center gap-4">
                  <div className="w-44 flex-shrink-0">
                    <span className="text-sm text-[#242843]">{field.label}</span>
                    {field.required && <span className="ml-1 text-red-500 text-xs">*</span>}
                  </div>
                  <div className="relative flex-1">
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                      className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15 transition-all"
                    >
                      <option value="">- not mapped -</option>
                      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <div className="flex gap-3">
          <button
            onClick={handleConnect}
            disabled={connecting || !mapping.title}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-6 py-3 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
            {connecting ? 'Connecting...' : 'Connect & sync'}
          </button>
        </div>
      )}
    </div>
  )
}
