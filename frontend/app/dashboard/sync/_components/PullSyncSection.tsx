'use client'

import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import type { ApiSyncStatus, ColumnInfo } from '@/lib/api-client'
import { SCUBA_FIELDS, buildOptions } from './sync-shared'

interface PullSyncSectionProps {
  pullStatus: ApiSyncStatus | null
  sourceUrl: string
  headersText: string
  itemsPath: string
  syncInterval: string
  columns: ColumnInfo[]
  mapping: Record<string, string>
  pullStep: 'setup' | 'mapping'
  pullBusy: boolean
  pullError: string | null
  onSourceUrlChange: (value: string) => void
  onHeadersChange: (value: string) => void
  onItemsPathChange: (value: string) => void
  onSyncIntervalChange: (value: string) => void
  onMappingChange: (key: string, value: string) => void
  onPreview: () => void
  onConnect: () => void
  onResync: () => void
  onDisconnect: () => void
}

export function PullSyncSection({
  pullStatus,
  sourceUrl,
  headersText,
  itemsPath,
  syncInterval,
  columns,
  mapping,
  pullStep,
  pullBusy,
  pullError,
  onSourceUrlChange,
  onHeadersChange,
  onItemsPathChange,
  onSyncIntervalChange,
  onMappingChange,
  onPreview,
  onConnect,
  onResync,
  onDisconnect,
}: PullSyncSectionProps) {
  if (pullStatus?.connected) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-[#94a3b8]">Source URL</p>
            <p className="break-all text-sm font-medium text-[#242843]">{pullStatus.source_url}</p>
          </div>
          <div>
            <p className="text-xs text-[#94a3b8]">Documents synced</p>
            <p className="text-sm font-medium text-[#242843]">{pullStatus.product_count ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs text-[#94a3b8]">Last synced</p>
            <p className="text-sm font-medium text-[#242843]">
              {pullStatus.last_synced_at ? new Date(pullStatus.last_synced_at).toLocaleString() : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#94a3b8]">Next sync</p>
            <p className="text-sm font-medium text-[#242843]">
              {pullStatus.next_sync_at ? new Date(pullStatus.next_sync_at).toLocaleString() : '-'}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#64748b]">
          Scheduled pull sync runs from Celery Beat. Manual <span className="font-medium text-[#242843]">Sync now</span> uses the same source and mapping immediately.
        </div>

        {pullStatus.error_message && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {pullStatus.error_message}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={onResync}
            disabled={pullBusy || pullStatus.sync_status === 'syncing'}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pullBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            <RefreshCw className="h-4 w-4" /> Sync now
          </button>
          <button
            onClick={onDisconnect}
            disabled={pullBusy}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-[#64748b] hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-[#242843]">Source URL</label>
        <input
          value={sourceUrl}
          onChange={(e) => onSourceUrlChange(e.target.value)}
          placeholder="https://cms.example/api/catalog"
          className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-[#242843]">Items path</label>
          <input
            value={itemsPath}
            onChange={(e) => onItemsPathChange(e.target.value)}
            placeholder="items"
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[#242843]">Sync every (minutes)</label>
          <input
            value={syncInterval}
            onChange={(e) => onSyncIntervalChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-[#242843]">Headers (JSON object)</label>
        <textarea
          value={headersText}
          onChange={(e) => onHeadersChange(e.target.value)}
          className="mt-1.5 min-h-[120px] w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15"
        />
      </div>

      {pullError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pullError}
        </div>
      )}

      {pullStep === 'mapping' && columns.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-[#242843]">Map fields</p>
            <p className="text-xs text-[#94a3b8]">{columns.length} fields found</p>
          </div>

          <div className="space-y-3">
            {SCUBA_FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-4">
                <div className="w-40 shrink-0">
                  <span className="text-sm text-[#242843]">{field.label}</span>
                  {field.required && <span className="ml-1 text-xs text-red-500">*</span>}
                </div>
                <div className="relative flex-1">
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(e) => onMappingChange(field.key, e.target.value)}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15"
                  >
                    <option value="">- not mapped -</option>
                    {buildOptions(columns).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onPreview}
          disabled={pullBusy || !sourceUrl.trim()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-[#242843] hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pullBusy && <Loader2 className="h-4 w-4 animate-spin" />}
          Preview payload
        </button>
        {pullStep === 'mapping' && (
          <button
            onClick={onConnect}
            disabled={pullBusy || !mapping.title}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pullBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect and sync
          </button>
        )}
      </div>
    </div>
  )
}
