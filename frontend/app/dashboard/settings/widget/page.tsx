'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Check, Copy, ChevronDown, Sparkles, ArrowRight, ArrowLeft, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { getApiKeys, type ApiKeyItem } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
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
      className="ml-1 rounded p-0.5 text-[#94a3b8] hover:text-[#242843] transition-colors"
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Option button group
// ---------------------------------------------------------------------------

function OptionGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-white text-[#242843] shadow-sm border border-zinc-200'
              : 'text-[#64748b] hover:text-[#242843]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout preview thumbnails
// ---------------------------------------------------------------------------

function LayoutPreview({ layout }: { layout: 'dropdown' | 'grid' }) {
  if (layout === 'dropdown') {
    return (
      <div className="w-full rounded-lg border border-zinc-200 bg-white shadow-sm overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 last:border-0">
            <div className="h-8 w-8 rounded bg-zinc-100 shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-2.5 w-full rounded bg-zinc-200" />
              <div className="h-2 w-12 rounded bg-zinc-100" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white shadow-sm p-2">
      <div className="grid grid-cols-3 gap-1.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded border border-zinc-100 overflow-hidden">
            <div className="aspect-square bg-zinc-100" />
            <div className="p-1 space-y-1">
              <div className="h-2 w-full rounded bg-zinc-200" />
              <div className="h-1.5 w-8 rounded bg-zinc-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Semantic ratio labels
// ---------------------------------------------------------------------------

const RATIO_LABELS = [
  { pct: 0,   label: 'Exact',     desc: 'Pure keyword matching - best for model numbers, SKUs, exact names' },
  { pct: 25,  label: 'Leaning keyword', desc: 'Mostly keywords, some semantic understanding' },
  { pct: 50,  label: 'Balanced',  desc: 'Equal keyword + semantic - best for most catalogs' },
  { pct: 75,  label: 'Leaning semantic', desc: 'Understands intent, less strict on exact words' },
  { pct: 100, label: 'Full semantic', desc: 'Pure meaning-based - best for natural language searches' },
]

function getRatioMeta(pct: number) {
  let closest = RATIO_LABELS[0]
  let minDiff = Math.abs(pct - RATIO_LABELS[0].pct)
  for (const r of RATIO_LABELS) {
    const diff = Math.abs(pct - r.pct)
    if (diff < minDiff) { minDiff = diff; closest = r }
  }
  return closest
}

// ---------------------------------------------------------------------------
// Question card wrapper (used in manual config)
// ---------------------------------------------------------------------------

function QuestionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white border-l-[3px] border-l-[#4338ca]">
      <div className="px-5 py-4">
        <h3 className="text-sm font-semibold text-[#242843]">{title}</h3>
        <p className="mt-0.5 text-xs text-[#64748b]">{description}</p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wizard step indicator (matches onboarding style)
// ---------------------------------------------------------------------------

function WizardStepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div key={n} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all ${
              n < current
                ? 'bg-[#4338ca] text-white'
                : n === current
                ? 'bg-[#4338ca] text-white ring-4 ring-[#4338ca]/20'
                : 'bg-slate-100 text-[#94a3b8]'
            }`}
          >
            {n < current ? <Check className="h-3.5 w-3.5" /> : n}
          </div>
          {n < total && (
            <div
              className={`h-px w-6 transition-colors ${
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
// Shared control components (used by both wizard and manual config)
// ---------------------------------------------------------------------------

function LayoutControl({
  layout,
  setLayout,
}: {
  layout: 'dropdown' | 'grid'
  setLayout: (v: 'dropdown' | 'grid') => void
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {(['dropdown', 'grid'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLayout(l)}
          className={`flex flex-col items-center gap-2.5 rounded-xl p-3 border-2 transition-colors ${
            layout === l
              ? 'border-[#4338ca] bg-[#4338ca]/5'
              : 'border-zinc-200 hover:border-zinc-300'
          }`}
        >
          <LayoutPreview layout={l} />
          <span className="text-xs font-medium text-[#242843] capitalize">{l}</span>
        </button>
      ))}
    </div>
  )
}

function ThemeControl({
  theme,
  setTheme,
}: {
  theme: 'light' | 'dark'
  setTheme: (v: 'light' | 'dark') => void
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {(['light', 'dark'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={`flex flex-col items-center gap-2 rounded-xl p-4 border-2 transition-colors ${
            theme === t
              ? 'border-[#4338ca] bg-[#4338ca]/5'
              : 'border-zinc-200 hover:border-zinc-300'
          }`}
        >
          <div
            className={`w-full h-12 rounded-lg border ${
              t === 'light'
                ? 'bg-white border-zinc-200'
                : 'bg-zinc-900 border-zinc-700'
            }`}
          />
          <span className="text-xs font-medium text-[#242843] capitalize">{t}</span>
        </button>
      ))}
    </div>
  )
}

function AttachedControl({
  attached,
  setAttached,
}: {
  attached: boolean
  setAttached: (v: boolean) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {([true, false] as const).map((val) => (
        <button
          key={String(val)}
          onClick={() => setAttached(val)}
          className={`flex flex-col items-center gap-2 rounded-xl p-3 border-2 transition-colors ${
            attached === val
              ? 'border-[#4338ca] bg-[#4338ca]/5'
              : 'border-zinc-200 hover:border-zinc-300'
          }`}
        >
          <div className="w-32 space-y-0.5">
            <div className={`h-6 w-full rounded-md border border-zinc-300 bg-white ${val ? 'rounded-b-none' : ''}`} />
            <div className={`w-full border border-zinc-200 bg-zinc-50 ${val ? 'rounded-b-md -mt-px' : 'rounded-md mt-1'}`}>
              {[1, 2].map(i => <div key={i} className="h-4 mx-2 my-1 rounded bg-zinc-200" />)}
            </div>
          </div>
          <span className="text-xs font-medium text-[#242843]">{val ? 'Attached' : 'Floating'}</span>
        </button>
      ))}
    </div>
  )
}

function RadiusControl({
  radius,
  radiusInput,
  setRadius,
  setRadiusInput,
}: {
  radius: number
  radiusInput: string
  setRadius: (v: number) => void
  setRadiusInput: (v: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-xs text-[#94a3b8] w-10 text-right shrink-0">Sharp</span>
        <input
          type="range"
          min={0}
          max={24}
          step={1}
          value={radius}
          onChange={(e) => {
            const n = Number(e.target.value)
            setRadius(n)
            setRadiusInput(String(n))
          }}
          className="flex-1 h-2 accent-zinc-900 cursor-pointer"
        />
        <span className="text-xs text-[#94a3b8] w-8 shrink-0">Pill</span>
        <Input
          type="text"
          inputMode="numeric"
          value={radiusInput}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '' || /^\d{1,2}$/.test(raw)) {
              setRadiusInput(raw)
              const n = parseInt(raw, 10)
              if (!isNaN(n) && n >= 0 && n <= 24) setRadius(n)
            }
          }}
          onBlur={() => {
            const n = parseInt(radiusInput, 10)
            if (isNaN(n) || n < 0) { setRadiusInput('0'); setRadius(0) }
          }}
          className="w-14 text-sm text-center"
        />
        <span className="text-xs text-[#94a3b8] shrink-0">px</span>
      </div>

      <div className="flex items-center gap-4 rounded-lg bg-zinc-50 border border-zinc-200 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <div className="text-xs text-[#94a3b8] mb-1">Dropdown</div>
          <div
            className="w-24 border border-zinc-300 bg-white overflow-hidden"
            style={{ borderRadius: radius === 0 ? '0' : `0 0 ${radius}px ${radius}px` }}
          >
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 border-b border-zinc-100 last:border-0">
                <div className="h-4 w-4 rounded bg-zinc-200 shrink-0" style={{ borderRadius: Math.round(radius * 0.67) }} />
                <div className="h-2 flex-1 rounded bg-zinc-200" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="text-xs text-[#94a3b8] mb-1">Card</div>
          <div
            className="w-16 border border-zinc-300 bg-white overflow-hidden"
            style={{ borderRadius: radius }}
          >
            <div className="h-12 bg-zinc-100" />
            <div className="p-1.5 space-y-1">
              <div className="h-2 w-full rounded bg-zinc-200" />
              <div className="h-1.5 w-8 rounded bg-zinc-100" />
            </div>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-[#242843]">
            {radius === 0 ? 'Sharp' : radius <= 4 ? 'Subtle' : radius <= 8 ? 'Soft' : radius <= 14 ? 'Rounded' : radius <= 20 ? 'Very rounded' : 'Pill'}
          </p>
          <p className="text-xs text-[#64748b] mt-0.5">
            {radius === 0 ? 'Square corners - clean, structured look' :
             radius <= 4 ? 'Barely there rounding - barely noticeable' :
             radius <= 8 ? 'Gentle curve - suits most platforms (default)' :
             radius <= 14 ? 'Noticeably rounded - modern, friendly feel' :
             radius <= 20 ? 'Strong curves - bold, contemporary style' :
             'Maximum rounding - playful, bubbly aesthetic'}
          </p>
        </div>
      </div>
    </div>
  )
}

function MaxResultsControl({
  maxResults,
  maxResultsInput,
  setMaxResults,
  setMaxResultsInput,
}: {
  maxResults: number
  maxResultsInput: string
  setMaxResults: (v: number) => void
  setMaxResultsInput: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        inputMode="numeric"
        value={maxResultsInput}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '' || /^\d{1,2}$/.test(raw)) {
            setMaxResultsInput(raw)
            const n = parseInt(raw, 10)
            if (!isNaN(n) && n >= 1 && n <= 50) setMaxResults(n)
          }
        }}
        onBlur={() => {
          const n = parseInt(maxResultsInput, 10)
          if (!n || n < 1) setMaxResultsInput(String(maxResults))
        }}
        className="w-20 text-sm text-center"
      />
      <span className="text-xs text-[#94a3b8]">results (1-50)</span>
    </div>
  )
}

function PlaceholderControl({
  placeholder,
  setPlaceholder,
}: {
  placeholder: string
  setPlaceholder: (v: string) => void
}) {
  return (
    <Input
      value={placeholder}
      onChange={(e) => setPlaceholder(e.target.value)}
      className="max-w-sm text-sm"
      placeholder="Search titles..."
    />
  )
}

function SemanticControl({
  semanticPct,
  setSemanticPct,
}: {
  semanticPct: number
  setSemanticPct: (v: number) => void
}) {
  const ratioMeta = getRatioMeta(semanticPct)
  const semanticRatio = (semanticPct / 100).toFixed(2)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-xs text-[#94a3b8] w-12 text-right shrink-0">Exact</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={semanticPct}
          onChange={(e) => setSemanticPct(Number(e.target.value))}
          className="flex-1 h-2 accent-zinc-900 cursor-pointer"
        />
        <span className="text-xs text-[#94a3b8] w-16 shrink-0">Semantic</span>
      </div>

      <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[#242843]">{ratioMeta.label}</span>
          <span className="text-xs font-mono text-[#94a3b8]">{semanticRatio}</span>
        </div>
        <p className="mt-0.5 text-xs text-[#64748b]">{ratioMeta.desc}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-[#94a3b8]">
        <div className="rounded bg-zinc-50 px-2 py-1.5">
          <span className="inline-flex items-center gap-1 font-medium text-[#64748b]">Lower <ArrowRight className="h-3 w-3" /></span> spare parts, electronics, exact SKUs
        </div>
        <div className="rounded bg-zinc-50 px-2 py-1.5">
          <span className="inline-flex items-center gap-1 font-medium text-[#64748b]">Higher <ArrowRight className="h-3 w-3" /></span> fashion, lifestyle, natural language
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wizard step data
// ---------------------------------------------------------------------------

const WIZARD_STEPS = [
  { title: 'How should results appear?', description: 'Choose how titles show up when viewers search.' },
  { title: 'What theme matches your platform?', description: 'Pick the background style for the search results.' },
  { title: 'How should results connect to the search bar?', description: 'Controls whether results attach flush to the input or float below it.' },
  { title: 'How round should the corners be?', description: 'Sets the roundness for dropdown and product cards.' },
  { title: 'How many results to show?', description: 'Number of titles shown per search.' },
  { title: 'What should the placeholder say?', description: 'Text shown in the empty search input.' },
  { title: 'How smart should the search be?', description: 'Balance between exact keyword matching and understanding viewer intent.' },
]

// ---------------------------------------------------------------------------
// Wizard modal
// ---------------------------------------------------------------------------

function WizardModal({
  step,
  setStep,
  onClose,
  layout, setLayout,
  theme, setTheme,
  attached, setAttached,
  radius, radiusInput, setRadius, setRadiusInput,
  maxResults, maxResultsInput, setMaxResults, setMaxResultsInput,
  placeholder, setPlaceholder,
  semanticPct, setSemanticPct,
}: {
  step: number
  setStep: (s: number) => void
  onClose: () => void
  layout: 'dropdown' | 'grid'
  setLayout: (v: 'dropdown' | 'grid') => void
  theme: 'light' | 'dark'
  setTheme: (v: 'light' | 'dark') => void
  attached: boolean
  setAttached: (v: boolean) => void
  radius: number
  radiusInput: string
  setRadius: (v: number) => void
  setRadiusInput: (v: string) => void
  maxResults: number
  maxResultsInput: string
  setMaxResults: (v: number) => void
  setMaxResultsInput: (v: string) => void
  placeholder: string
  setPlaceholder: (v: string) => void
  semanticPct: number
  setSemanticPct: (v: number) => void
}) {
  const total = WIZARD_STEPS.length
  const currentStep = WIZARD_STEPS[step - 1]
  const isLast = step === total

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-xl border border-zinc-200 overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 flex h-7 w-7 items-center justify-center rounded-full text-[#94a3b8] hover:bg-zinc-100 hover:text-[#242843] transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="px-6 pt-6 pb-2">
          <WizardStepIndicator current={step} total={total} />
        </div>

        <div className="px-6 pb-6">
          {/* Step card */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h3 className="text-base font-semibold text-[#242843]">{currentStep.title}</h3>
            <p className="mt-1 text-sm text-[#64748b]">{currentStep.description}</p>

            <div className="mt-5">
              {step === 1 && <LayoutControl layout={layout} setLayout={setLayout} />}
              {step === 2 && <ThemeControl theme={theme} setTheme={setTheme} />}
              {step === 3 && <AttachedControl attached={attached} setAttached={setAttached} />}
              {step === 4 && <RadiusControl radius={radius} radiusInput={radiusInput} setRadius={setRadius} setRadiusInput={setRadiusInput} />}
              {step === 5 && <MaxResultsControl maxResults={maxResults} maxResultsInput={maxResultsInput} setMaxResults={setMaxResults} setMaxResultsInput={setMaxResultsInput} />}
              {step === 6 && <PlaceholderControl placeholder={placeholder} setPlaceholder={setPlaceholder} />}
              {step === 7 && <SemanticControl semanticPct={semanticPct} setSemanticPct={setSemanticPct} />}
            </div>
          </div>

          {/* Navigation */}
          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={() => {
                if (step === 1) onClose()
                else setStep(step - 1)
              }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#64748b] hover:text-[#242843] transition-colors"
            >
              {step === 1 ? 'Cancel' : <><ArrowLeft className="h-3.5 w-3.5" /> Back</>}
            </button>
            <button
              onClick={() => {
                if (isLast) onClose()
                else setStep(step + 1)
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#3730a3]"
            >
              {isLast ? 'Done' : <>Continue <ArrowRight className="h-3.5 w-3.5" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function WidgetSettingsPage() {
  const { getToken } = useAuth()

  const [apiKey, setApiKey] = useState<string | null>(null)

  // Widget config state
  const [layout, setLayout] = useState<'dropdown' | 'grid'>('dropdown')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [maxResults, setMaxResults] = useState<number>(8)
  const [maxResultsInput, setMaxResultsInput] = useState<string>('8')
  const [placeholder, setPlaceholder] = useState('Search titles...')
  const [semanticPct, setSemanticPct] = useState(50) // 0–100 maps to 0.0–1.0
  const [attached, setAttached] = useState(true) // true = flush to input, false = floating gap
  const [radius, setRadius] = useState(6)
  const [radiusInput, setRadiusInput] = useState('6')
  const [headless, setHeadless] = useState(false)

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)

  // Manual config collapsible
  const [manualOpen, setManualOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const keys: ApiKeyItem[] = await getApiKeys(token)
        const active = keys.find((k) => k.is_active)
        if (active?.raw_key) setApiKey(active.raw_key)
      } catch {}
    }
    load()
  }, [getToken])

  const semanticRatio = (semanticPct / 100).toFixed(2)

  // Build the snippet
  const keyDisplay = apiKey ?? 'YOUR_FULL_API_KEY'
  const snippet = [
    `<script`,
    `  src="https://cdn.scubasearch.io/widget.js"`,
    `  data-api-key="${keyDisplay}"`,
    placeholder !== 'Search titles...' ? `  data-placeholder="${placeholder}"` : null,
    layout !== 'dropdown' ? `  data-layout="${layout}"` : null,
    theme !== 'light' ? `  data-theme="${theme}"` : null,
    maxResults !== 8 ? `  data-max-results="${maxResults}"` : null,
    semanticPct !== 50 ? `  data-semantic-ratio="${semanticRatio}"` : null,
    !attached ? `  data-attached="false"` : null,
    radius !== 6 ? `  data-radius="${radius}"` : null,
    headless ? `  data-headless="true"` : null,
    `></script>`,
  ].filter(Boolean).join('\n')

  function openWizard() {
    setWizardStep(1)
    setWizardOpen(true)
  }

  return (
    <div className="max-w-2xl">
      {/* ------------------------------------------------------------------ */}
      {/* 1. Header */}
      {/* ------------------------------------------------------------------ */}
      <h1 className="text-xl font-semibold text-[#242843]">Widget Settings</h1>
      <p className="mt-1 text-sm text-[#64748b]">
        Configure your widget and copy the snippet into your platform.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Wizard CTA Button */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-6">
        <button
          onClick={openWizard}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#3730a3] shadow-sm"
        >
          <Sparkles className="h-4 w-4" />
          Configure your widget in 30 seconds
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Wizard Modal */}
      {/* ------------------------------------------------------------------ */}
      {wizardOpen && (
        <WizardModal
          step={wizardStep}
          setStep={setWizardStep}
          onClose={() => setWizardOpen(false)}
          layout={layout}
          setLayout={setLayout}
          theme={theme}
          setTheme={setTheme}
          attached={attached}
          setAttached={setAttached}
          radius={radius}
          radiusInput={radiusInput}
          setRadius={setRadius}
          setRadiusInput={setRadiusInput}
          maxResults={maxResults}
          maxResultsInput={maxResultsInput}
          setMaxResults={setMaxResults}
          setMaxResultsInput={setMaxResultsInput}
          placeholder={placeholder}
          setPlaceholder={setPlaceholder}
          semanticPct={semanticPct}
          setSemanticPct={setSemanticPct}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 4. Live Snippet (always visible) */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">Your snippet</span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-[#242843]">Installation code</p>
            <CopyButton text={snippet} />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-xs text-green-400 font-mono leading-relaxed">
            <code>{snippet}</code>
          </pre>
          <p className="mt-3 text-xs text-[#94a3b8]">
            Only changed attributes are included. Defaults are omitted to keep the snippet clean.
          </p>
        </div>

        {/* Setup guide */}
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5 space-y-4">
          <p className="text-sm font-semibold text-[#242843]">How to install</p>
          <div className="space-y-3 text-xs text-[#64748b]">
            <div className="flex gap-3">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#4338ca] text-[10px] font-bold text-white">1</span>
              <p>Copy the snippet above and paste it into your platform&apos;s HTML - just before the closing <code className="font-mono bg-zinc-200/60 px-1 rounded">&lt;/body&gt;</code> tag. That&apos;s it.</p>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#4338ca] text-[10px] font-bold text-white">2</span>
              <p>Add a search input anywhere on your page: <code className="font-mono bg-zinc-200/60 px-1 rounded">&lt;input type=&quot;search&quot; placeholder=&quot;Search...&quot; /&gt;</code>. The widget finds it automatically.</p>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#4338ca] text-[10px] font-bold text-white">3</span>
              <p>Done. Search results appear as your viewers type. Analytics, caching, and tracking are handled for you.</p>
            </div>
          </div>

          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="font-medium">CSP note:</span> If your platform uses a Content Security Policy, add <code className="font-mono bg-amber-100 px-1 rounded">connect-src https://api.scubasearch.io</code> to your headers. Without this, the widget&apos;s API requests may be silently blocked.
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Manual Configuration (collapsible) */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-8">
        <button
          onClick={() => setManualOpen(!manualOpen)}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-5 py-3.5 text-left transition-colors hover:bg-zinc-50"
        >
          <span className="text-sm font-semibold text-[#242843]">Manual configuration</span>
          <ChevronDown
            className={`h-4 w-4 text-[#94a3b8] transition-transform ${manualOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {manualOpen && (
          <div className="mt-3 space-y-4">
            <QuestionCard
              title="How should results appear?"
              description="Choose how titles show up when viewers search."
            >
              <LayoutControl layout={layout} setLayout={setLayout} />
            </QuestionCard>

            <QuestionCard
              title="What theme matches your platform?"
              description="Pick the background style."
            >
              <OptionGroup
                value={theme}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                onChange={setTheme}
              />
            </QuestionCard>

            <QuestionCard
              title="How should results connect to the search bar?"
              description="Controls whether results attach flush to the input or float below it."
            >
              <AttachedControl attached={attached} setAttached={setAttached} />
            </QuestionCard>

            <QuestionCard
              title="How round should the corners be?"
              description="Sets the roundness for dropdown and product cards."
            >
              <RadiusControl
                radius={radius}
                radiusInput={radiusInput}
                setRadius={setRadius}
                setRadiusInput={setRadiusInput}
              />
            </QuestionCard>

            <QuestionCard
              title="How many results should we show?"
              description="Number of titles shown per search."
            >
              <MaxResultsControl
                maxResults={maxResults}
                maxResultsInput={maxResultsInput}
                setMaxResults={setMaxResults}
                setMaxResultsInput={setMaxResultsInput}
              />
            </QuestionCard>

            <QuestionCard
              title="What should the placeholder say?"
              description="Text shown in the empty search input."
            >
              <PlaceholderControl placeholder={placeholder} setPlaceholder={setPlaceholder} />
            </QuestionCard>

            <QuestionCard
              title="How smart should the search be?"
              description="Balance between exact keyword matching and understanding viewer intent."
            >
              <SemanticControl semanticPct={semanticPct} setSemanticPct={setSemanticPct} />
            </QuestionCard>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 6. Headless Mode (Advanced, always visible) */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-8 mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">Advanced</span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#242843]">Headless mode</p>
              <p className="mt-0.5 text-xs text-[#64748b] max-w-md">
                By default, the widget shows its own results dropdown. Turn this on if you want to design your own results - the widget fires a JavaScript event with the data for you to render.
              </p>
            </div>
            <button
              onClick={() => setHeadless(!headless)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-4 ${headless ? 'bg-[#4338ca]' : 'bg-zinc-200'}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${headless ? 'translate-x-4' : 'translate-x-1'}`}
              />
            </button>
          </div>
          {headless && (
            <div className="mt-4 space-y-4">
              {/* How it works */}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
                <p className="text-xs font-medium text-[#242843]">How it works</p>
                <p className="text-xs text-[#64748b]">
                  The widget still handles search requests, debouncing, caching, and analytics - but it won&apos;t show any dropdown. Instead, it fires a <code className="font-mono bg-zinc-200/60 px-1 rounded">scubasearch:results</code> event after every search. You listen to it and render results your way.
                </p>
              </div>

              {/* Step-by-step guide */}
              <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-4">
                <p className="text-xs font-medium text-[#242843]">Setup guide</p>

                <div className="space-y-3 text-xs text-[#64748b]">
                  <div className="flex gap-3">
                    <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#4338ca] text-[10px] font-bold text-white">1</span>
                    <div>
                      <p className="font-medium text-[#242843]">Paste the snippet</p>
                      <p>Copy your snippet above (headless is already enabled) and paste before <code className="font-mono bg-zinc-100 px-1 rounded">&lt;/body&gt;</code>.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#4338ca] text-[10px] font-bold text-white">2</span>
                    <div>
                      <p className="font-medium text-[#242843]">Listen for results</p>
                    <p>Add your own results container and render titles from the event.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#4338ca] text-[10px] font-bold text-white">3</span>
                    <div>
                      <p className="font-medium text-[#242843]">Track engagement + clicks</p>
                      <p>Call <code className="font-mono bg-zinc-100 px-1 rounded">ScubaSearch.engage()</code> on hover and <code className="font-mono bg-zinc-100 px-1 rounded">ScubaSearch.click(productId)</code> on click. This powers your analytics.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Code example */}
              <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
                <p className="text-xs font-medium text-[#242843]">Complete example</p>
                <pre className="overflow-x-auto rounded border border-zinc-200 bg-zinc-950 p-3 text-[11px] text-green-400 font-mono leading-relaxed">{`<!-- Your results container -->
<div id="my-results"></div>

<script>
window.addEventListener('scubasearch:results', function(e) {
  var results = e.detail.results
  var container = document.getElementById('my-results')

  if (!results.length) {
    container.innerHTML = ''
    return
  }

  // Render your own cards - your HTML, your CSS
  container.innerHTML = results.map(function(p) {
    return '<a href="' + p.product_url + '" class="card"' +
           ' data-id="' + p.id + '">' +
           '<img src="' + p.image_url + '" />' +
           '<p>' + p.title + '</p></a>'
  }).join('')

  // Engagement: tell the widget when users hover results
  container.querySelectorAll('.card').forEach(function(card) {
    card.addEventListener('mouseenter', function() {
      ScubaSearch.engage()
    })
  })
})

// Click tracking: one line - handles API call + analytics
document.addEventListener('click', function(e) {
  var card = e.target.closest('[data-id]')
  if (card) ScubaSearch.click(card.getAttribute('data-id'))
})
</script>`}</pre>
              </div>

              {/* What's automatic */}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-medium text-[#242843] mb-2">What the widget still handles for you</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#64748b]">
                  <p>Debounced search (100ms)</p>
                  <p>Result caching</p>
                  <p>API key auth</p>
                  <p>Search analytics logging</p>
                  <p>Session tracking</p>
                  <p>Idle / tab-switch settle</p>
                </div>
                <p className="mt-2 text-xs text-[#94a3b8]">You only handle: rendering cards + calling <code className="font-mono bg-zinc-100 px-1 rounded">engage()</code> and <code className="font-mono bg-zinc-100 px-1 rounded">click()</code>.</p>
              </div>

              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span className="font-medium">CSP note:</span> If your platform uses a Content Security Policy, add <code className="font-mono bg-amber-100 px-1 rounded">connect-src https://api.scubasearch.io</code> to your headers. Without this, the widget&apos;s API requests will be silently blocked.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
