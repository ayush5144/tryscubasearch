'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, UserButton } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import {
  getAdminStats,
  getAdminClients,
  adminActivateClient,
  adminCancelClient,
  type AdminStats,
  type AdminClientRow,
} from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function PlanBadge({ plan }: { plan: string }) {
  if (plan === 'growth')
    return <span className="inline-flex items-center rounded-full bg-[#4338ca]/10 px-2.5 py-0.5 text-xs font-medium text-[#4338ca]">Growth · $39</span>
  if (plan === 'scale')
    return <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">Scale · $199</span>
  return <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-400">No plan</span>
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active')
    return <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">Active</span>
  if (status === 'past_due')
    return <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">Past due</span>
  return <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-400">Inactive</span>
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-3xl font-bold text-[#242843]">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="mt-1 text-sm font-medium text-[#64748b]">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-[#94a3b8]">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------------

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm mx-4 bg-white rounded-2xl shadow-xl border border-slate-200 p-6">
        <h3 className="text-base font-semibold text-[#242843]">{title}</h3>
        <p className="mt-2 text-sm text-[#64748b]">{message}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-[#64748b] hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 transition-colors ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#4338ca] hover:bg-[#3730a3]'
            }`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Actions cell
// ---------------------------------------------------------------------------

function ActionsCell({
  row,
  getToken,
  onDone,
}: {
  row: AdminClientRow
  getToken: () => Promise<string | null>
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState(false)
  const [pending, setPending] = useState<{ title: string; message: string; confirmLabel: string; danger?: boolean; fn: () => Promise<void> } | null>(null)

  async function execute() {
    if (!pending) return
    setBusy(true)
    setErr(false)
    try {
      const token = await getToken()
      if (!token) return
      await pending.fn()
      setPending(null)
      setDone(true)
      setTimeout(() => { setDone(false); onDone() }, 1200)
    } catch {
      setPending(null)
      setErr(true)
      setTimeout(() => setErr(false), 2000)
    } finally {
      setBusy(false)
    }
  }

  function ask(opts: typeof pending) {
    setPending(opts)
  }

  return (
    <>
      {pending && (
        <ConfirmModal
          title={pending.title}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          danger={pending.danger}
          busy={busy}
          onConfirm={execute}
          onCancel={() => setPending(null)}
        />
      )}

      {done ? (
        <span className="text-xs font-semibold text-green-600">✓ Done</span>
      ) : err ? (
        <span className="text-xs font-semibold text-red-500">Failed</span>
      ) : row.sub_status === 'active' ? (
        <button
          disabled={busy}
          onClick={() => ask({
            title: 'Cancel plan',
            message: `This will deactivate ${row.store_name ?? row.email}'s subscription immediately. They will lose access to search.`,
            confirmLabel: 'Yes, cancel',
            danger: true,
            fn: async () => { const t = await getToken(); if (t) await adminCancelClient(t, row.id) },
          })}
          className="text-xs px-3 py-1.5 rounded-lg border border-red-200 font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          Cancel plan
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            disabled={busy}
            onClick={() => ask({
              title: 'Activate Growth plan',
              message: `Activate the Growth plan ($199/mo) for ${row.store_name ?? row.email}?`,
              confirmLabel: 'Activate Growth',
              fn: async () => { const t = await getToken(); if (t) await adminActivateClient(t, row.id, 'growth') },
            })}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-[#4338ca]/40 font-medium text-[#4338ca] hover:bg-[#4338ca]/5 disabled:opacity-40 transition-colors"
          >
            Growth
          </button>
          <button
            disabled={busy}
            onClick={() => ask({
              title: 'Activate Scale plan',
              message: `Activate the Scale plan ($499/mo) for ${row.store_name ?? row.email}?`,
              confirmLabel: 'Activate Scale',
              fn: async () => { const t = await getToken(); if (t) await adminActivateClient(t, row.id, 'scale') },
            })}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-purple-300 font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-40 transition-colors"
          >
            Scale
          </button>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer (expanded row)
// ---------------------------------------------------------------------------

function DetailPanel({ row, onClose }: { row: AdminClientRow; onClose: () => void }) {
  const planLimit = row.sub_plan === 'growth' ? 10_000 : row.sub_plan === 'scale' ? 100_000 : 0
  const sessionPct = planLimit > 0 ? Math.min(100, Math.round((row.sessions_this_month / planLimit) * 100)) : 0

  return (
    <tr className="bg-slate-50/80">
      <td colSpan={9} className="px-6 py-4">
        <div className="flex items-start justify-between gap-8">
          <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Email</div>
              <div className="mt-0.5 text-[#242843]">{row.email}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Store</div>
              <div className="mt-0.5 text-[#242843]">{row.store_name ?? '-'}</div>
              {row.store_url && (
                <a href={row.store_url} target="_blank" rel="noopener" className="text-xs text-[#4338ca] hover:underline">
                  {row.store_url}
                </a>
              )}
            </div>
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Signed up</div>
              <div className="mt-0.5 text-[#242843]">{formatDate(row.created_at)}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Onboarding</div>
              <div className="mt-0.5 text-[#242843]">{row.onboarding_complete ? '✓ Complete' : '⚠ Incomplete'}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Sessions this month</div>
              <div className="mt-0.5 text-[#242843]">{row.sessions_this_month.toLocaleString()} / {planLimit > 0 ? planLimit.toLocaleString() : '-'}</div>
              {planLimit > 0 && (
                <div className="mt-1 h-1.5 w-32 rounded-full bg-slate-200">
                  <div
                    className={`h-1.5 rounded-full ${sessionPct >= 90 ? 'bg-red-400' : sessionPct >= 70 ? 'bg-amber-400' : 'bg-[#4338ca]'}`}
                    style={{ width: `${sessionPct}%` }}
                  />
                </div>
              )}
            </div>
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Queries this month</div>
              <div className="mt-0.5 text-[#242843]">{row.queries_this_month.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Products indexed</div>
              <div className="mt-0.5 text-[#242843]">{row.product_count.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Integrations</div>
              <div className="mt-0.5 text-[#242843]">-</div>
            </div>
          </div>
          <button onClick={onClose} className="mt-0.5 text-[#94a3b8] hover:text-[#242843] text-lg leading-none">×</button>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const { getToken } = useAuth()
  const router = useRouter()

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [clients, setClients] = useState<AdminClientRow[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const [s, c] = await Promise.all([getAdminStats(token), getAdminClients(token, 0)])
    setStats(s)
    setClients(c)
    setOffset(0)
  }, [getToken])

  useEffect(() => {
    async function init() {
      try {
        const token = await getToken()
        if (!token) {
          // Not signed in - go to sign-in and come back here (not to /dashboard)
          router.push('/sign-in?redirect_url=/admin2026')
          return
        }
        const [s, c] = await Promise.all([getAdminStats(token), getAdminClients(token, 0)])
        setStats(s)
        setClients(c)
      } catch (e) {
        if (e instanceof Error && e.message === 'forbidden') {
          setError('forbidden')
        } else {
          setError('Cannot reach backend. Make sure it is running and ADMIN_CLERK_USER_IDS is set in .env, then restart the server.')
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [getToken, router])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const token = await getToken()
      if (!token) return
      const newOffset = offset + 50
      const more = await getAdminClients(token, newOffset)
      setClients(prev => [...prev, ...more])
      setOffset(newOffset)
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#4338ca]" />
      </div>
    )
  }

  if (error === 'forbidden') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center">
        <div className="text-3xl">🔒</div>
        <p className="text-base font-semibold text-[#242843]">Access denied</p>
        <p className="text-sm text-[#64748b] max-w-sm">
          Your Clerk user ID is not in <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">ADMIN_CLERK_USER_IDS</code>.
          Add it to <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env</code> and restart the backend.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <div className="text-2xl">⚠️</div>
        <p className="text-sm text-[#64748b] max-w-sm">{error}</p>
        <button
          onClick={() => { setError(null); setLoading(true); window.location.reload() }}
          className="rounded-lg bg-[#4338ca] px-4 py-2 text-sm font-medium text-white hover:bg-[#3730a3]"
        >
          Retry
        </button>
      </div>
    )
  }

  const showLoadMore = clients.length > 0 && clients.length % 50 === 0

  return (
    <div className="min-h-screen bg-slate-50 text-[#242843]">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <span className="font-bold text-[#242843]">ScubaSearch</span>
          <span className="rounded-md bg-[#4338ca]/10 px-2 py-0.5 text-xs font-semibold text-[#4338ca]">Admin</span>
        </div>
        <UserButton />
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 pt-[4.5rem]">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#242843]">Users & Billing</h1>
          <button
            onClick={fetchAll}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-[#64748b] hover:bg-slate-50 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total users" value={stats.total_clients} />
            <StatCard label="Active plans" value={stats.active_subscriptions} sub={`${stats.total_clients > 0 ? Math.round((stats.active_subscriptions / stats.total_clients) * 100) : 0}% conversion`} />
            <StatCard label="Searches today" value={stats.searches_today} />
            <StatCard label="Sessions this month" value={stats.sessions_this_month} />
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Store</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#64748b]">Sessions</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#64748b]">Searches</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#64748b]">Products</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Last active</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#64748b]">
                    No users yet.
                  </td>
                </tr>
              )}
              {clients.map(row => (
                <React.Fragment key={row.id}>
                  <tr
                    className="border-b border-slate-100 transition-colors hover:bg-slate-50/60 last:border-0 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[200px] truncate font-medium text-[#242843]">{row.email}</span>
                      </div>
                      <div className="text-xs text-[#94a3b8]">Joined {formatDate(row.created_at)}</div>
                    </td>

                    {/* Store */}
                    <td className="px-4 py-3">
                      <div className="max-w-[160px] truncate text-[#242843]">
                        {row.store_name ?? <span className="text-[#94a3b8] italic">Not set</span>}
                      </div>
                      {row.store_url && (
                        <div className="max-w-[160px] truncate text-xs text-[#94a3b8]">{row.store_url}</div>
                      )}
                    </td>

                    {/* Plan */}
                    <td className="px-4 py-3"><PlanBadge plan={row.sub_plan} /></td>

                    {/* Status */}
                    <td className="px-4 py-3"><StatusBadge status={row.sub_status} /></td>

                    {/* Sessions */}
                    <td className="px-4 py-3 text-right tabular-nums text-[#242843]">
                      {row.sessions_this_month.toLocaleString()}
                    </td>

                    {/* Searches (queries) */}
                    <td className="px-4 py-3 text-right tabular-nums text-[#242843]">
                      {row.queries_this_month.toLocaleString()}
                    </td>

                    {/* Products */}
                    <td className="px-4 py-3 text-right tabular-nums text-[#242843]">
                      {row.product_count.toLocaleString()}
                    </td>

                    {/* Last active */}
                    <td className="px-4 py-3 text-[#64748b]">{timeAgo(row.last_active)}</td>

                    {/* Actions - stop row click propagation */}
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <ActionsCell row={row} getToken={getToken} onDone={fetchAll} />
                    </td>
                  </tr>

                  {/* Expanded detail panel */}
                  {expandedId === row.id && (
                    <DetailPanel row={row} onClose={() => setExpandedId(null)} />
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {showLoadMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-[#64748b] hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
