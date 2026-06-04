'use client'

import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

function SyncBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    syncing: { label: 'Syncing', className: 'bg-[#4338ca]/8 text-[#4338ca] border-[#4338ca]/15' },
    queued: { label: 'Queued', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    processing: { label: 'Processing', className: 'bg-[#4338ca]/8 text-[#4338ca] border-[#4338ca]/15' },
    done: { label: 'Done', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    failed: { label: 'Failed', className: 'bg-red-50 text-red-700 border-red-200' },
  }
  const view = map[status ?? 'pending'] ?? map.pending

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${view.className}`}>
      {view.label}
    </span>
  )
}

interface SyncSectionRowProps {
  title: string
  subtitle: string
  summary?: string | null
  status?: string | null
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export function SyncSectionRow({
  title,
  subtitle,
  summary,
  status,
  open,
  onToggle,
  children,
}: SyncSectionRowProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-zinc-50 transition-colors rounded-lg"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-[#242843]">{title}</div>
          <div className="mt-0.5 text-xs text-[#64748b]">{subtitle}</div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {summary && <span className="hidden text-xs text-[#94a3b8] sm:inline">{summary}</span>}
          {status && <SyncBadge status={status} />}
          {open ? (
            <ChevronUp className="h-4 w-4 text-[#94a3b8]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#94a3b8]" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-4 pb-5 pt-4">
          {children}
        </div>
      )}
    </div>
  )
}
