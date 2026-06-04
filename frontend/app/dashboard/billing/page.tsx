'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getBillingStatus,
  activateTestPlan,
  type BillingStatus,
  ApiError,
} from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

const PLANS: {
  key: 'starter' | 'growth' | 'scale'
  name: string
  price: number
  products: number
  sessions: number | null // null = unlimited
  productsLabel: string
  sessionsLabel: string
}[] = [
  {
    key: 'growth',
    name: 'Growth',
    price: 199,
    products: 1_000,
    sessions: 10_000,
    productsLabel: '1,000 titles',
    sessionsLabel: '10,000 sessions/mo',
  },
  {
    key: 'scale',
    name: 'Scale',
    price: 499,
    products: 10_000,
    sessions: 100_000,
    productsLabel: '10,000 titles',
    sessionsLabel: '100,000 sessions/mo',
  },
]

const PLAN_ORDER: Record<string, number> = { growth: 0, scale: 1 }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLimit(value: number): string {
  if (value >= 1_000_000) return 'Unlimited'
  return value.toLocaleString()
}

function usagePercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  // Cap at 100 for display
  return Math.min(100, Math.round((used / limit) * 100))
}

function statusBadgeVariant(
  status: string,
): 'outline' | 'secondary' | 'destructive' {
  if (status === 'active') return 'outline'
  if (status === 'past_due') return 'destructive'
  return 'secondary'
}

function statusLabel(status: string): string {
  if (status === 'active') return 'Active'
  if (status === 'past_due') return 'Past due'
  if (status === 'inactive') return 'Inactive'
  return status
}

// ---------------------------------------------------------------------------
// UsageBar sub-component
// ---------------------------------------------------------------------------

function UsageBar({
  label,
  used,
  limit,
  unlimited,
}: {
  label: string
  used: number
  limit: number
  unlimited?: boolean
}) {
  const pct = unlimited ? 0 : usagePercent(used, limit)
  const isHighUsage = pct >= 80

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-[#64748b]">{label}</span>
        <span className={`font-medium ${isHighUsage ? 'text-red-600' : 'text-[#242843]'}`}>
          {used.toLocaleString()} / {unlimited ? 'Unlimited' : formatLimit(limit)}
        </span>
      </div>
      {!unlimited && (
        <Progress
          value={pct}
          className={`mt-1.5 h-2 ${isHighUsage ? '[&>div]:bg-red-500' : ''}`}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CurrentPlanCard
// ---------------------------------------------------------------------------

function CurrentPlanCard({ billing }: { billing: BillingStatus }) {
  const isUnlimitedSessions = billing.sessions_limit >= 1_000_000

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-[#242843]">
            Current Plan
          </CardTitle>
          <Badge variant={statusBadgeVariant(billing.status)}>
            {statusLabel(billing.status)}
          </Badge>
        </div>
        <p className="text-sm text-[#64748b] capitalize">
          {billing.plan === 'none' ? 'No active plan' : `${billing.plan} plan`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <UsageBar
          label="Sessions this month"
          used={billing.sessions_used}
          limit={billing.sessions_limit}
          unlimited={isUnlimitedSessions}
        />
        <UsageBar
          label="Documents indexed"
          used={billing.products_used}
          limit={billing.products_limit}
        />
        {billing.reset_at && (
          <p className="text-xs text-[#94a3b8]">
            Usage resets on{' '}
            {new Date(billing.reset_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PlanCard
// ---------------------------------------------------------------------------

function PlanCard({
  plan,
  currentPlan,
  onActivate,
  activating,
}: {
  plan: (typeof PLANS)[number]
  currentPlan: string
  onActivate: (plan: 'starter' | 'growth' | 'scale') => void
  activating: string | null
}) {
  const currentIdx = PLAN_ORDER[currentPlan] ?? -1
  const planIdx = PLAN_ORDER[plan.key]
  const isCurrent = currentPlan === plan.key
  const isUpgrade = planIdx > currentIdx
  const isDowngrade = planIdx < currentIdx && currentIdx !== -1

  return (
    <Card
      className={`flex flex-col ${isCurrent ? 'border-[#4338ca] ring-1 ring-[#4338ca]' : ''}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-[#242843]">
              {plan.name}
            </CardTitle>
            <p className="mt-1 text-2xl font-bold text-[#242843]">
              ${plan.price}
              <span className="text-sm font-normal text-[#64748b]">/mo</span>
            </p>
          </div>
          {isCurrent && (
            <Badge variant="outline" className="text-xs">
              Current
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <ul className="space-y-1 text-sm text-[#64748b]">
          <li>{plan.productsLabel}</li>
          <li>{plan.sessionsLabel}</li>
        </ul>

        {isCurrent ? (
          <Button disabled className="w-full" variant="outline">
            Current plan
          </Button>
        ) : isDowngrade ? (
          <Button disabled className="w-full" variant="outline">
            Downgrade
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={() => onActivate(plan.key)}
            disabled={activating !== null}
          >
            {activating === plan.key ? 'Activating...' : 'Upgrade'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const { getToken } = useAuth()
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function load() {
    try {
      const token = await getToken()
      if (!token) return
      const data = await getBillingStatus(token)
      setBilling(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load billing status.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [getToken]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleActivate(plan: 'starter' | 'growth' | 'scale') {
    setActivating(plan)
    setToast(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      await activateTestPlan(token, plan)
      setToast(`Switched to ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan.`)
      await load()
    } catch (err) {
      setToast(
        err instanceof ApiError
          ? err.message
          : 'Failed to activate plan. Please try again.',
      )
    } finally {
      setActivating(null)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const noPlan =
    !billing || billing.plan === 'none' || billing.status === 'inactive'

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-[#242843]">Billing</h1>
        <p className="mt-1 text-sm text-[#64748b]">
          Manage your plan and usage.
        </p>
        <div className="mt-6 space-y-4">
          <Skeleton className="h-36 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Skeleton className="h-52 w-full rounded-xl" />
            <Skeleton className="h-52 w-full rounded-xl" />
            <Skeleton className="h-52 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------

  if (error) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-[#242843]">Billing</h1>
        <div className="mt-6 rounded-md border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#242843]">Billing</h1>
      <p className="mt-1 text-sm text-[#64748b]">
        Manage your plan and usage.
      </p>

      {/* Toast notification */}
      {toast && (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-[#242843]">
          {toast}
        </div>
      )}

      {/* No-plan banner */}
      {noPlan && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-900">
            No active plan - your platform search is paused.
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Choose a plan below to get started and re-enable search for your viewers.
          </p>
        </div>
      )}

      {/* Current plan card - only show when there is an active plan */}
      {billing && !noPlan && (
        <div className="mt-6">
          <CurrentPlanCard billing={billing} />
        </div>
      )}

      {/* Plan selection cards */}
      <section className="mt-8">
        <h2 className="text-base font-semibold text-[#242843]">
          {noPlan ? 'Choose a plan' : 'Plans'}
        </h2>
        <p className="mt-0.5 text-sm text-[#64748b]">
          {noPlan
            ? 'Pick the plan that fits your catalog.'
            : 'Upgrade or review available plans.'}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              currentPlan={billing?.plan ?? 'none'}
              onActivate={handleActivate}
              activating={activating}
            />
          ))}
        </div>

        <p className="mt-4 text-xs text-[#94a3b8]">
          Test mode: plan changes take effect immediately without a real payment.
        </p>
      </section>
    </div>
  )
}
