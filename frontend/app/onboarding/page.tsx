'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { Check, Loader2, ArrowRight, ArrowLeft } from 'lucide-react'
import { ensureMe, updateMe, activateTestPlan } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Plan data
// ---------------------------------------------------------------------------

type PlanKey = 'starter' | 'growth' | 'scale'

interface Plan {
  key: PlanKey
  name: string
  price: string
  period: string
  description: string
  products: string
  sessions: string
  features: string[]
  highlighted: boolean
}

const plans: Plan[] = [
  {
    key: 'growth',
    name: 'Growth',
    price: '$199',
    period: '/month',
    description: 'For growing platforms that need intelligent content discovery.',
    products: '1,000 titles',
    sessions: '10,000 sessions/month',
    features: [
      'Hybrid search (keyword + semantic)',
      'JS embed widget',
      'Typo tolerance',
      'Full analytics dashboard',
      'Zero-result query reports',
      'API access',
      'Email support',
      'Webhook sync (real-time updates)',
      'White-label widget',
    ],
    highlighted: true,
  },
  {
    key: 'scale',
    name: 'Scale',
    price: '$499',
    period: '/month',
    description: 'For large catalogs that need maximum scale.',
    products: '10,000 titles',
    sessions: '100,000 sessions/month',
    features: [
      'Everything in Growth',
      '10,000 titles',
      '100,000 sessions',
      'Priority support',
      'Dedicated onboarding',
    ],
    highlighted: false,
  },
]

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-10">
      {[1, 2, 3].map((n) => (
        <div key={n} className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-all ${
              n < current
                ? 'bg-[#4338ca] text-white'
                : n === current
                ? 'bg-[#4338ca] text-white ring-4 ring-[#4338ca]/20'
                : 'bg-slate-100 text-[#94a3b8]'
            }`}
          >
            {n < current ? <Check className="h-4 w-4" /> : n}
          </div>
          {n < 3 && (
            <div
              className={`h-px w-10 transition-colors ${
                n < current ? 'bg-[#4338ca]' : 'bg-slate-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 - Store Details
// ---------------------------------------------------------------------------

function Step1({
  storeName,
  storeDescription,
  onStoreName,
  onStoreDescription,
  onContinue,
}: {
  storeName: string
  storeDescription: string
  onStoreName: (v: string) => void
  onStoreDescription: (v: string) => void
  onContinue: () => void
}) {
  const canContinue = storeName.trim().length > 0 && storeDescription.trim().length > 0

  return (
    <div className="w-full max-w-lg mx-auto">
      <h1 className="font-display text-3xl font-bold text-[#242843] mb-2">Tell us about your platform</h1>
      <p className="text-[#64748b] mb-8">This helps ScubaSearch understand your catalog and serve better search results.</p>

      <div className="flex flex-col gap-5">
        {/* Platform name */}
        <div>
          <label className="block text-sm font-semibold text-[#242843] mb-1.5" htmlFor="store-name">
            Platform name <span className="text-red-500">*</span>
          </label>
          <input
            id="store-name"
            type="text"
            value={storeName}
            onChange={(e) => onStoreName(e.target.value)}
            placeholder="e.g. StreamNest"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-[#242843] placeholder:text-[#94a3b8] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15 transition-all"
          />
        </div>

        {/* Platform description */}
        <div>
          <label className="block text-sm font-semibold text-[#242843] mb-1.5" htmlFor="store-desc">
            Platform description <span className="text-red-500">*</span>
          </label>
          <textarea
            id="store-desc"
            rows={4}
            value={storeDescription}
            onChange={(e) => onStoreDescription(e.target.value)}
            placeholder="Describe your catalog, audience, genres, and languages..."
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-[#242843] placeholder:text-[#94a3b8] outline-none focus:border-[#4338ca] focus:ring-2 focus:ring-[#4338ca]/15 resize-none transition-all"
          />

          {/* Tips box */}
          <div className="mt-3 flex flex-col gap-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-xs font-semibold text-emerald-700 mb-1">Good description</p>
              <p className="text-xs text-emerald-700 leading-relaxed">
                &ldquo;We stream indie films, documentaries, family comedies, and prestige dramas for English-speaking audiences.&rdquo;
              </p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
              <p className="text-xs font-semibold text-orange-700 mb-1">Bad description</p>
              <p className="text-xs text-orange-700 leading-relaxed">
                &ldquo;We have lots of videos.&rdquo;
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-[#4338ca] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#3730a3] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 - Choose a Plan
// ---------------------------------------------------------------------------

function Step2({
  selectedPlan,
  onSelectPlan,
  onContinue,
  onBack,
}: {
  selectedPlan: PlanKey | null
  onSelectPlan: (p: PlanKey) => void
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div className="w-full max-w-3xl mx-auto">
      <h1 className="font-display text-3xl font-bold text-[#242843] mb-2 text-center">Choose your plan</h1>
      <p className="text-[#64748b] mb-10 text-center">All plans include a 14-day free trial. No credit card required.</p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {plans.map((plan) => {
          const isSelected = selectedPlan === plan.key
          return (
            <button
              key={plan.key}
              onClick={() => onSelectPlan(plan.key)}
              className={`flex flex-col rounded-2xl bg-white p-6 text-left transition-all cursor-pointer ${
                isSelected
                  ? 'border-2 border-[#4338ca] ring-4 ring-[#4338ca]/10 shadow-sm'
                  : plan.highlighted
                  ? 'border-2 border-[#4338ca]/40 hover:border-[#4338ca] hover:shadow-sm'
                  : 'border border-slate-200 hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              {plan.highlighted && (
                <span className="mb-3 w-fit rounded-full border border-[#47E6E1]/30 bg-[#47E6E1]/15 px-2.5 py-0.5 text-xs font-semibold text-[#0e8a87]">
                  Most popular
                </span>
              )}
              <h3 className="text-base font-bold text-[#242843]">{plan.name}</h3>
              <p className="mt-1 text-xs text-[#64748b] leading-relaxed">{plan.description}</p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-[#242843]">{plan.price}</span>
                <span className="text-sm text-[#64748b]">{plan.period}</span>
              </div>

              <div className="mt-3 space-y-0.5 text-xs">
                <p className="font-semibold text-[#242843]">{plan.products}</p>
                <p className="text-[#64748b]">{plan.sessions}</p>
              </div>

              <div className="my-4 h-px bg-slate-100" />

              <ul className="flex flex-col gap-2 text-xs text-[#64748b]">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#4338ca]" />
                    {f}
                  </li>
                ))}
              </ul>

              {isSelected && (
                <div className="mt-4 rounded-lg bg-[#4338ca]/8 px-3 py-1.5 text-center">
                  <span className="text-xs font-semibold text-[#4338ca]">Selected</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#64748b] hover:text-[#242843] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button
          onClick={onContinue}
          disabled={!selectedPlan}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#4338ca] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#3730a3] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 - Checkout / Free trial
// ---------------------------------------------------------------------------

function Step3({
  selectedPlan,
  storeName,
  onBack,
  onStartTrial,
  loading,
  error,
}: {
  selectedPlan: PlanKey
  storeName: string
  onBack: () => void
  onStartTrial: () => void
  loading: boolean
  error: string | null
}) {
  const plan = plans.find((p) => p.key === selectedPlan)!

  return (
    <div className="w-full max-w-md mx-auto">
      <h1 className="font-display text-3xl font-bold text-[#242843] mb-2 text-center">You&apos;re almost in.</h1>
      <p className="text-[#64748b] mb-8 text-center">Review your plan and start your free trial.</p>

      {/* Plan summary card */}
      <div
        className={`rounded-2xl bg-white p-6 mb-4 ${
          plan.highlighted
            ? 'border-2 border-[#4338ca]'
            : 'border border-slate-200'
        }`}
      >
        {plan.highlighted && (
          <span className="mb-3 inline-block rounded-full border border-[#47E6E1]/30 bg-[#47E6E1]/15 px-2.5 py-0.5 text-xs font-semibold text-[#0e8a87]">
            Most popular
          </span>
        )}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#242843]">{plan.name}</h2>
            <p className="text-sm text-[#64748b] mt-0.5">{plan.description}</p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold text-[#242843]">{plan.price}</span>
            <span className="text-sm text-[#64748b]">{plan.period}</span>
          </div>
        </div>

        <div className="my-4 h-px bg-slate-100" />

        <div className="space-y-1 text-sm mb-4">
          <p className="font-semibold text-[#242843]">{plan.products}</p>
          <p className="text-[#64748b]">{plan.sessions}</p>
        </div>

        <ul className="flex flex-col gap-2 text-sm text-[#64748b]">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#4338ca]" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Free trial notice */}
      <div className="rounded-xl border border-[#47E6E1]/40 bg-[#47E6E1]/8 px-5 py-4 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-[#0e8a87] text-lg leading-none mt-0.5">&#10003;</span>
          <div>
            <p className="text-sm font-semibold text-[#0e8a87]">14-day free trial</p>
            <p className="text-sm text-[#0e8a87]/80 mt-0.5">No payment required now. Your trial starts immediately after setup.</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#64748b] hover:text-[#242843] transition-colors disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button
          onClick={onStartTrial}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#3730a3] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? 'Setting up...' : <><span>Start free trial</span> <ArrowRight className="h-3.5 w-3.5" /></>}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main onboarding page
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const router = useRouter()
  const { getToken } = useAuth()

  const [step, setStep] = useState(1)
  const [storeName, setStoreName] = useState('')
  const [storeDescription, setStoreDescription] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>('growth')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStartTrial() {
    if (!selectedPlan) return
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')

      await ensureMe(token)

      await updateMe(token, {
        store_name: storeName.trim(),
        store_description: storeDescription.trim(),
        onboarding_complete: true,
      })

      await activateTestPlan(token, selectedPlan)

      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      {/* Background gradient decorators - match homepage/sign-in style */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(114,246,252,0.18)_0%,transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] translate-x-1/4 translate-y-1/4 rounded-full bg-[#47E6E1]/7 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[400px] bg-[radial-gradient(ellipse_80%_80%_at_0%_100%,rgba(114,246,252,0.10)_0%,transparent_70%)]"
      />

      {/* Logo */}
      <div className="relative px-6 pt-6">
        <Link
          href="/"
          className="inline-block font-display font-bold text-[#242843] hover:opacity-70 transition-opacity"
        >
          ScubaSearch
        </Link>
      </div>

      {/* Centered content */}
      <div className="relative flex min-h-[calc(100vh-5rem)] items-center justify-center px-6 py-12">
        <div className="w-full">
          <StepIndicator current={step} />

          {step === 1 && (
            <Step1
              storeName={storeName}
              storeDescription={storeDescription}
              onStoreName={setStoreName}
              onStoreDescription={setStoreDescription}
              onContinue={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <Step2
              selectedPlan={selectedPlan}
              onSelectPlan={setSelectedPlan}
              onContinue={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && selectedPlan && (
            <Step3
              selectedPlan={selectedPlan}
              storeName={storeName}
              onBack={() => setStep(2)}
              onStartTrial={handleStartTrial}
              loading={loading}
              error={error}
            />
          )}
        </div>
      </div>
    </div>
  )
}
