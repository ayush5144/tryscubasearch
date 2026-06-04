'use client'

import type { IngestJobStatus } from '@/lib/api-client'

interface SyncJobStatusCardProps {
  title: string
  job: IngestJobStatus | null
}

function statusTone(status: IngestJobStatus['status']) {
  if (status === 'done') return 'text-emerald-700'
  if (status === 'failed') return 'text-red-700'
  if (status === 'processing') return 'text-[#4338ca]'
  return 'text-amber-700'
}

export function SyncJobStatusCard({ title, job }: SyncJobStatusCardProps) {
  if (!job) return null

  const total = Math.max(job.total || 0, 0)
  const processed = Math.max(job.processed || 0, 0)
  const progress = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#242843]">{title}</p>
          <p className={`mt-1 text-sm capitalize ${statusTone(job.status)}`}>{job.status}</p>
        </div>
        <div className="text-right text-xs text-[#64748b]">
          <div>{processed.toLocaleString()} processed</div>
          {total > 0 && <div>{total.toLocaleString()} total</div>}
        </div>
      </div>

      {progress !== null && job.status !== 'failed' && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-[#4338ca] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-[#64748b]">{progress}% complete</div>
        </div>
      )}

      {(job.added_count || job.updated_count || job.skipped_count) ? (
        <div className="mt-3 text-xs text-[#64748b]">
          {[
            job.added_count ? `${job.added_count.toLocaleString()} added` : null,
            job.updated_count ? `${job.updated_count.toLocaleString()} updated` : null,
            job.skipped_count ? `${job.skipped_count.toLocaleString()} unchanged` : null,
          ]
            .filter(Boolean)
            .join(' - ')}
        </div>
      ) : null}

      {job.error_log && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {job.error_log}
        </div>
      )}
    </div>
  )
}
