'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'
import {
  ApiError,
  ApiKeyItem,
  ApiSyncStatus,
  BulkSyncResponse,
  CatalogStats,
  ColumnInfo,
  IngestJobStatus,
  SyncDocument,
  connectApiSyncSource,
  disconnectApiSync,
  getApiKeys,
  getApiSyncStatus,
  getCatalog,
  getIngestJob,
  previewApiSyncSource,
  pushDocuments,
  sendSyncWebhook,
  triggerApiSync,
} from '@/lib/api-client'
import { CsvUploadSection } from './_components/CsvUploadSection'
import { PullSyncSection } from './_components/PullSyncSection'
import { RestPushSection } from './_components/RestPushSection'
import { SyncSectionRow } from './_components/SyncSectionRow'
import { WebhookSyncSection } from './_components/WebhookSyncSection'
import {
  WEBHOOK_SAMPLE,
  buildPushSample,
  DEFAULT_PUSH_SAMPLES,
  formatJobSummary,
  parseJsonObject,
  SCUBA_FIELDS,
} from './_components/sync-shared'

type SyncMode = 'replace' | 'append' | 'update'
type OpenSection = 'rest' | 'pull' | 'webhook' | 'csv' | null

export default function SyncPage() {
  const { getToken } = useAuth()

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<OpenSection>('rest')

  const [apiKey, setApiKey] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogStats | null>(null)
  const [pullStatus, setPullStatus] = useState<ApiSyncStatus | null>(null)

  const [pushMode, setPushMode] = useState<SyncMode>('append')
  const [pushBody, setPushBody] = useState(buildPushSample('append'))
  const [pushBusy, setPushBusy] = useState(false)
  const [pushResult, setPushResult] = useState<BulkSyncResponse | null>(null)
  const [pushJob, setPushJob] = useState<IngestJobStatus | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)

  const [webhookBody, setWebhookBody] = useState(WEBHOOK_SAMPLE)
  const [webhookBusy, setWebhookBusy] = useState(false)
  const [webhookResult, setWebhookResult] = useState<BulkSyncResponse | null>(null)
  const [webhookJob, setWebhookJob] = useState<IngestJobStatus | null>(null)
  const [webhookError, setWebhookError] = useState<string | null>(null)

  const [sourceUrl, setSourceUrl] = useState('')
  const [headersText, setHeadersText] = useState('{\n  \n}')
  const [itemsPath, setItemsPath] = useState('items')
  const [syncInterval, setSyncInterval] = useState('15')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [pullStep, setPullStep] = useState<'setup' | 'mapping'>('setup')
  const [pullBusy, setPullBusy] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)

  const apiBase = useMemo(
    () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
    [],
  )

  const pushCurl = `curl -X POST ${apiBase}/api/v1/push/documents \\\n  -H "Authorization: Bearer ${apiKey ?? 'sk_live_your_key'}" \\\n  -H "Content-Type: application/json" \\\n  -d '${pushBody.replace(/\n/g, '\n')}'`

  const webhookCurl = `curl -X POST ${apiBase}/api/v1/push/webhook \\\n  -H "Authorization: Bearer ${apiKey ?? 'sk_live_your_key'}" \\\n  -H "Content-Type: application/json" \\\n  -d '${webhookBody.replace(/\n/g, '\n')}'`

  function handleModeChange(mode: SyncMode) {
    setPushMode(mode)
    if (DEFAULT_PUSH_SAMPLES.has(pushBody)) {
      setPushBody(buildPushSample(mode))
    }
  }

  const loadPage = useCallback(async () => {
    const token = await getToken()
    if (!token) return

    try {
      const [keys, liveCatalog, livePull] = await Promise.all([
        getApiKeys(token),
        getCatalog(token),
        getApiSyncStatus(token).catch(() => ({ connected: false } as ApiSyncStatus)),
      ])

      const activeKey = keys.find((item: ApiKeyItem) => item.is_active && item.raw_key)?.raw_key ?? null

      setApiKey(activeKey)
      setCatalog(liveCatalog)
      setPullStatus(livePull)

      if (livePull.connected) {
        setSourceUrl(livePull.source_url ?? '')
        setItemsPath(livePull.items_path ?? '')
        setSyncInterval(String(livePull.sync_interval_mins ?? 15))
        setMapping(livePull.field_mapping ?? {})
        setColumns((livePull.source_columns ?? []).map((name) => ({ name, type: 'remote' })))
        setPullStep('mapping')
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load sync settings.'
      setPageError(message)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  useEffect(() => {
    const jobId = pushResult?.job_id ?? null
    if (!jobId) return

    let timer: ReturnType<typeof setInterval> | null = null

    async function poll() {
      const token = await getToken()
      if (!token) return
      if (!jobId) return
      const job = await getIngestJob(token, jobId)
      setPushJob(job)
      if (job.status === 'done' || job.status === 'failed') {
        await loadPage()
        if (timer) clearInterval(timer)
      }
    }

    void poll()
    timer = setInterval(() => {
      void poll()
    }, 2500)

    return () => {
      if (timer) clearInterval(timer)
    }
  }, [getToken, loadPage, pushResult?.job_id])

  useEffect(() => {
    const jobId = webhookResult?.job_id ?? null
    if (!jobId) return

    let timer: ReturnType<typeof setInterval> | null = null

    async function poll() {
      const token = await getToken()
      if (!token) return
      if (!jobId) return
      const job = await getIngestJob(token, jobId)
      setWebhookJob(job)
      if (job.status === 'done' || job.status === 'failed') {
        await loadPage()
        if (timer) clearInterval(timer)
      }
    }

    void poll()
    timer = setInterval(() => {
      void poll()
    }, 2500)

    return () => {
      if (timer) clearInterval(timer)
    }
  }, [getToken, loadPage, webhookResult?.job_id])

  useEffect(() => {
    if (!pullStatus?.connected) return
    if (pullStatus.sync_status !== 'pending' && pullStatus.sync_status !== 'syncing') return

    const timer = setInterval(() => {
      void loadPage()
    }, 3000)

    return () => clearInterval(timer)
  }, [loadPage, pullStatus?.connected, pullStatus?.sync_status])

  async function handlePushSubmit() {
    if (!apiKey) {
      setPushError('Create an active API key first from Settings.')
      return
    }

    setPushBusy(true)
    setPushError(null)

    try {
      const parsed = JSON.parse(pushBody) as { documents: SyncDocument[]; mode?: SyncMode }
      const result = await pushDocuments(apiKey, parsed.documents, parsed.mode ?? pushMode)
      setPushResult(result)
      setPushJob(null)
      await loadPage()
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Could not queue REST sync.')
    } finally {
      setPushBusy(false)
    }
  }

  async function handleWebhookSubmit() {
    if (!apiKey) {
      setWebhookError('Create an active API key first from Settings.')
      return
    }

    setWebhookBusy(true)
    setWebhookError(null)

    try {
      const parsed = JSON.parse(webhookBody) as {
        documents?: SyncDocument[]
        document?: SyncDocument
        mode?: SyncMode
        event?: string
      }
      const result = await sendSyncWebhook(apiKey, parsed)
      setWebhookResult(result)
      setWebhookJob(null)
      await loadPage()
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : 'Could not queue webhook sync.')
    } finally {
      setWebhookBusy(false)
    }
  }

  async function handlePreviewPull() {
    const token = await getToken()
    if (!token) return

    setPullBusy(true)
    setPullError(null)

    try {
      const headers = parseJsonObject(headersText)
      const preview = await previewApiSyncSource(
        token,
        sourceUrl.trim(),
        headers,
        itemsPath.trim() || undefined,
      )

      const auto: Record<string, string> = {}
      for (const field of SCUBA_FIELDS) {
        const match = preview.find((column) => {
          const normalizedName = column.name.toLowerCase().replace(/[._ ]/g, '')
          const normalizedField = field.key.replace(/_/g, '')
          return normalizedName === normalizedField || normalizedName.endsWith(normalizedField)
        })
        if (match) auto[field.key] = match.name
      }

      setColumns(preview)
      setMapping(auto)
      setPullStep('mapping')
    } catch (err) {
      setPullError(err instanceof Error ? err.message : 'Could not preview the API payload.')
    } finally {
      setPullBusy(false)
    }
  }

  async function handleConnectPull() {
    const token = await getToken()
    if (!token) return

    setPullBusy(true)
    setPullError(null)

    try {
      const headers = parseJsonObject(headersText)
      await connectApiSyncSource(
        token,
        sourceUrl.trim(),
        mapping,
        Math.max(1, Number(syncInterval) || 15),
        headers,
        itemsPath.trim() || undefined,
      )
      await loadPage()
    } catch (err) {
      setPullError(err instanceof Error ? err.message : 'Could not connect the pull API.')
    } finally {
      setPullBusy(false)
    }
  }

  async function handlePullResync() {
    const token = await getToken()
    if (!token) return

    setPullBusy(true)
    setPullError(null)

    try {
      await triggerApiSync(token)
      await loadPage()
    } catch (err) {
      setPullError(err instanceof Error ? err.message : 'Could not trigger pull sync.')
    } finally {
      setPullBusy(false)
    }
  }

  async function handlePullDisconnect() {
    const token = await getToken()
    if (!token) return

    setPullBusy(true)
    setPullError(null)

    try {
      await disconnectApiSync(token)
      setPullStatus({ connected: false } as ApiSyncStatus)
      setColumns([])
      setMapping({})
      setPullStep('setup')
      await loadPage()
    } catch (err) {
      setPullError(err instanceof Error ? err.message : 'Could not disconnect pull sync.')
    } finally {
      setPullBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#4338ca]" />
      </div>
    )
  }

  const latestJobSummary = formatJobSummary(catalog?.last_job ?? null)
  const restStatus = catalog?.last_job?.trigger === 'rest_api_push' ? catalog.last_job.status : null
  const webhookStatus = catalog?.last_job?.trigger === 'webhook_sync' ? catalog.last_job.status : null
  const restSummary = pushResult ? `${pushResult.total} document${pushResult.total === 1 ? '' : 's'} queued - ${pushResult.mode} mode` : 'Send a JSON batch directly'
  const webhookSummary = webhookResult ? `${webhookResult.total} document${webhookResult.total === 1 ? '' : 's'} queued - ${webhookResult.mode} mode` : 'Fire publish and metadata events'
  const pullSummary = pullStatus?.connected
    ? `${pullStatus.product_count ?? 0} synced`
    : 'Preview and map a JSON API'

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#242843]">Sync Methods</h1>
            <p className="mt-1 text-sm text-[#64748b]">
              Upload CSV/JSON files, use API push, webhooks, or scheduled pull sync. For Postgres
              table sync, use the{' '}
              <Link href="/dashboard/database" className="text-[#4338ca] hover:underline">
                Database
              </Link>{' '}
              page.
            </p>
          </div>
          <Link
            href="/dashboard/sync/guide"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-[#242843] hover:border-slate-300 hover:bg-slate-50"
          >
            Open guide
          </Link>
        </div>

        {catalog && (
          <div className="mt-3 inline-flex items-center gap-5 rounded-lg border border-zinc-200 bg-white px-5 py-3">
            <div>
              <div className="text-2xl font-semibold leading-none text-[#242843]">
                {catalog.product_count.toLocaleString()}
              </div>
              <div className="mt-0.5 text-xs text-[#64748b]">documents indexed</div>
            </div>
            <div className="h-8 w-px bg-zinc-200" />
            <div>
              <div className="text-xs font-medium text-[#64748b]">Source</div>
              <div className="mt-0.5 text-xs text-[#242843]">{catalog.active_source_label}</div>
            </div>
            {catalog.last_job && (
              <>
                <div className="h-8 w-px bg-zinc-200" />
                <div>
                  <div className="text-xs font-medium text-[#64748b]">Last job</div>
                  <div className="mt-0.5 text-xs text-[#64748b]">
                    {new Date(catalog.last_job.created_at).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    ·{' '}
                    <span
                      className={
                        catalog.last_job.status === 'done'
                          ? 'text-green-600'
                          : catalog.last_job.status === 'failed'
                            ? 'text-red-600'
                            : 'text-[#64748b]'
                      }
                    >
                      {catalog.last_job.status}
                    </span>
                    {latestJobSummary && <span className="text-[#94a3b8]"> · {latestJobSummary}</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {pageError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-[#64748b]">
        <div className="mb-1 font-medium text-[#242843]">Before you start</div>
        <div className="space-y-1">
          <div>Use <span className="font-mono text-xs">replace</span> for a fresh catalog, <span className="font-mono text-xs">append</span> for new or changed IDs, and <span className="font-mono text-xs">update</span> for partial patches.</div>
          <div>REST push and webhook sync use your active API key. Scheduled pull sync uses your dashboard session plus Celery Beat.</div>
        </div>
      </div>

      <SyncSectionRow
        title="File upload (CSV / JSON / NDJSON)"
        subtitle="Upload via the dashboard or API key. Accepts .csv, .json, and .ndjson files up to 100 MB."
        summary="API key or browser session"
        open={openSection === 'csv'}
        onToggle={() => setOpenSection((current) => (current === 'csv' ? null : 'csv'))}
      >
        <CsvUploadSection apiKey={apiKey} apiBase={apiBase} />
      </SyncSectionRow>

      <SyncSectionRow
        title="REST API push"
        subtitle="Send a JSON batch directly from your CMS, backend, or admin tooling."
        summary={restSummary}
        status={pushJob?.status ?? pushResult?.status ?? restStatus}
        open={openSection === 'rest'}
        onToggle={() => setOpenSection((current) => (current === 'rest' ? null : 'rest'))}
      >
        <RestPushSection
          apiKey={apiKey}
          pushMode={pushMode}
          pushBody={pushBody}
          pushBusy={pushBusy}
          pushError={pushError}
          pushSummary={pushResult ? `Queued ${pushResult.total} documents in ${pushResult.mode} mode.` : null}
          pushJob={pushJob}
          pushCurl={pushCurl}
          onModeChange={handleModeChange}
          onBodyChange={setPushBody}
          onSubmit={() => void handlePushSubmit()}
        />
      </SyncSectionRow>

      <SyncSectionRow
        title="Auto-sync pull"
        subtitle="Preview a JSON API, map fields once, and keep the catalog updated on a schedule."
        summary={pullSummary}
        status={pullStatus?.sync_status}
        open={openSection === 'pull'}
        onToggle={() => setOpenSection((current) => (current === 'pull' ? null : 'pull'))}
      >
        <PullSyncSection
          pullStatus={pullStatus}
          sourceUrl={sourceUrl}
          headersText={headersText}
          itemsPath={itemsPath}
          syncInterval={syncInterval}
          columns={columns}
          mapping={mapping}
          pullStep={pullStep}
          pullBusy={pullBusy}
          pullError={pullError}
          onSourceUrlChange={setSourceUrl}
          onHeadersChange={setHeadersText}
          onItemsPathChange={setItemsPath}
          onSyncIntervalChange={setSyncInterval}
          onMappingChange={(key, value) => setMapping((current) => ({ ...current, [key]: value }))}
          onPreview={() => void handlePreviewPull()}
          onConnect={() => void handleConnectPull()}
          onResync={() => void handlePullResync()}
          onDisconnect={() => void handlePullDisconnect()}
        />
      </SyncSectionRow>

      <SyncSectionRow
        title="Webhook sync"
        subtitle="Fire publish or metadata correction events in real time from your platform."
        summary={webhookSummary}
        status={webhookJob?.status ?? webhookResult?.status ?? webhookStatus}
        open={openSection === 'webhook'}
        onToggle={() => setOpenSection((current) => (current === 'webhook' ? null : 'webhook'))}
      >
        <WebhookSyncSection
          apiKey={apiKey}
          webhookBody={webhookBody}
          webhookBusy={webhookBusy}
          webhookError={webhookError}
          webhookSummary={webhookResult ? `Queued ${webhookResult.total} documents in ${webhookResult.mode} mode.` : null}
          webhookJob={webhookJob}
          webhookCurl={webhookCurl}
          onBodyChange={setWebhookBody}
          onSubmit={() => void handleWebhookSubmit()}
        />
      </SyncSectionRow>

      {catalog?.last_job && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-[#64748b]">
          <span className="font-medium text-[#242843]">Mode guide</span>
          <div className="mt-2 space-y-1">
            <div><span className="font-mono text-xs">replace</span> - rebuild the catalog from this payload</div>
            <div><span className="font-mono text-xs">append</span> - add new IDs and fully overwrite matching IDs</div>
            <div><span className="font-mono text-xs">update</span> - patch only the fields you send</div>
          </div>
        </div>
      )}
    </div>
  )
}
