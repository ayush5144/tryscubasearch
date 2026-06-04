'use client'

import { Check, Copy, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { IngestJobStatus } from '@/lib/api-client'
import { SyncJobStatusCard } from './SyncJobStatusCard'

interface WebhookSyncSectionProps {
  apiKey: string | null
  webhookBody: string
  webhookBusy: boolean
  webhookError: string | null
  webhookSummary: string | null
  webhookJob: IngestJobStatus | null
  webhookCurl: string
  onBodyChange: (value: string) => void
  onSubmit: () => void
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }
  return (
    <button
      onClick={handleCopy}
      className={
        label
          ? 'inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-[#64748b] hover:border-slate-300 hover:text-[#242843] transition-colors'
          : 'ml-1 rounded p-0.5 text-[#94a3b8] hover:text-[#242843] transition-colors'
      }
      title={copied ? 'Copied!' : label ?? 'Copy'}
    >
      {copied ? (
        <Check className={label ? 'h-4 w-4 text-green-500' : 'h-3.5 w-3.5 text-green-500'} />
      ) : (
        <Copy className={label ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      )}
      {label && <span>{copied ? 'Copied!' : label}</span>}
    </button>
  )
}

export function WebhookSyncSection({
  apiKey,
  webhookBody,
  webhookBusy,
  webhookError,
  webhookSummary,
  webhookJob,
  webhookCurl,
  onBodyChange,
  onSubmit,
}: WebhookSyncSectionProps) {
  return (
    <div className="space-y-4">
      {!apiKey && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Create an active API key in Settings before testing webhook sync.
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[#242843]">Webhook body</label>
        <CopyButton text={webhookBody} label="Copy sample" />
      </div>

      <textarea
        value={webhookBody}
        onChange={(e) => onBodyChange(e.target.value)}
        className="min-h-[220px] w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-sm text-[#242843] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15"
      />

      {webhookError && <p className="text-sm text-red-600">{webhookError}</p>}
      {webhookSummary && <p className="text-sm text-[#64748b]">{webhookSummary}</p>}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#64748b]">
        Use webhook sync when your platform already knows exactly when something changed, like a publish event or a metadata correction.
      </div>
      <SyncJobStatusCard title="Current webhook job" job={webhookJob} />

      <button
        onClick={onSubmit}
        disabled={webhookBusy}
        className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {webhookBusy && <Loader2 className="h-4 w-4 animate-spin" />}
        Queue webhook sync
      </button>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#242843]">cURL example</p>
          <CopyButton text={webhookCurl} />
        </div>
        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-xs text-green-400 font-mono leading-relaxed">{webhookCurl}</pre>
      </div>
    </div>
  )
}
