'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getAnalyticsSummary, type AnalyticsSummary, ApiError } from '@/lib/api-client'

function StatCard({
  title,
  value,
  subtitle,
  loading,
}: {
  title: string
  value: string
  subtitle?: string
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-[#64748b]">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <div className="text-2xl font-bold text-[#242843]">{value}</div>
            {subtitle && (
              <div className="mt-1 text-xs text-[#94a3b8]">{subtitle}</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default function DashboardOverview() {
  const { getToken } = useAuth()
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const data = await getAnalyticsSummary(token)
        setSummary(data)
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
        } else {
          setError('Failed to load analytics. Please refresh.')
        }
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [getToken])

  if (error) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-[#242843]">Overview</h1>
        <div className="mt-6 rounded-md border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  const zeroRateDisplay = summary
    ? `${(summary.zero_result_rate * 100).toFixed(1)}%`
    : '-'

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#242843]">Overview</h1>
      <p className="mt-1 text-sm text-[#64748b]">
        Your search performance over all time.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total sessions"
          value={summary ? summary.total_sessions.toLocaleString() : '-'}
          loading={loading}
        />
        <StatCard
          title="Total queries"
          value={summary ? summary.total_searches.toLocaleString() : '-'}
          loading={loading}
        />
        <StatCard
          title="Zero-result rate"
          value={zeroRateDisplay}
          subtitle="Lower is better"
          loading={loading}
        />
        <StatCard
          title="Documents indexed"
          value={summary ? summary.total_products.toLocaleString() : '-'}
          loading={loading}
        />
      </div>

      {!loading && summary && summary.total_searches === 0 && (
        <div className="mt-8 rounded-md border border-zinc-100 p-6 text-sm text-[#64748b]">
          No searches recorded yet. Upload your content catalog and add the widget to your
          platform to get started.
        </div>
      )}
    </div>
  )
}
