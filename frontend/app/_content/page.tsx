'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { Check, Search, Code2, Zap, Clock, BarChart2, LayoutDashboard, Menu, X } from 'lucide-react'

// ---------------------------------------------------------------------------
// Self-contained nav - does NOT use the shared NavBar component
// ---------------------------------------------------------------------------
function ContentNav() {
  const [open, setOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const close = () => setOpen(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <>
      <header className="fixed z-50 top-4 px-4 w-full transition-all duration-300 flex justify-center">
        <div
          className={`w-full transition-all duration-300 ${isScrolled
            ? 'max-w-4xl h-14 bg-white/80 backdrop-blur-md border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-full'
            : 'max-w-4xl h-14 bg-transparent border border-transparent rounded-full'
          }`}
        >
          <div className="h-full w-full flex items-center justify-between px-6">
            {/* Logo - scrolls to top, never navigates away */}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="font-display text-xl font-bold text-[#242843] tracking-tight"
            >
              ScubaSearch
            </button>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
              <a href="#features" className="hover:text-[#4338ca] transition-colors">Product</a>
              <a href="#pricing" className="hover:text-[#4338ca] transition-colors">Pricing</a>
            </nav>

            {/* Desktop CTA - no Pricing link beside button */}
            <div className="hidden md:flex items-center">
              <button
                onClick={() => (window as any).openDemoModal?.()}
                className="bg-[#4338ca] hover:bg-[#3730a3] text-white rounded-full px-4 py-2 text-sm font-medium transition-colors"
              >
                Book a Demo
              </button>
            </div>

            {/* Mobile hamburger */}
            <button
              className="md:hidden flex items-center justify-center rounded-full p-2 text-[#242843] hover:bg-slate-50 transition-colors"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {open && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm" onClick={close} />
          <div className="fixed inset-x-4 top-40 z-[70] rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-center justify-between">
              <button
                onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); close() }}
                className="font-display text-xl font-bold text-[#242843] tracking-tight"
              >
                ScubaSearch
              </button>
              <button onClick={close} className="flex items-center justify-center rounded-full w-8 h-8 text-[#64748b] hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="mt-6 flex flex-col">
              <a href="#features" onClick={close} className="py-3 text-lg font-semibold text-[#242843] hover:text-[#4338ca] transition-colors border-b border-slate-100">Product</a>
              <a href="#pricing" onClick={close} className="py-3 text-lg font-semibold text-[#242843] hover:text-[#4338ca] transition-colors border-b border-slate-100">Pricing</a>
            </nav>
            <div className="mt-6">
              <button
                onClick={() => { close(); (window as any).openDemoModal?.() }}
                className="w-full rounded-xl bg-[#4338ca] px-6 py-3.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[#3730a3]"
              >
                Book a Demo
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Demo modal
// ---------------------------------------------------------------------------
function DemoModal() {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({ name: '', company: '', website: '', email: '', phone: '' })

  const openModal = () => setOpen(true)
  const closeModal = () => {
    setOpen(false)
    setSubmitted(false)
    setForm({ name: '', company: '', website: '', email: '', phone: '' })
  }

  useEffect(() => {
    (window as any).openDemoModal = openModal
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = new FormData()
    body.append('entry.2005620554', form.name)
    body.append('entry.1045781291', form.company)
    body.append('entry.1065046570', form.website)
    body.append('entry.839337160', form.email)
    body.append('entry.314434176', form.phone)
    await fetch(
      'https://docs.google.com/forms/d/e/1FAIpQLSfIwn6nDkhMXcfE-9SHfgLn9qDLFpnLAc0GEyIf4znbSlfnrA/formResponse',
      { method: 'POST', mode: 'no-cors', body },
    ).catch(() => {})
    setSubmitted(true)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={closeModal}>
      <div className="w-full max-w-md p-6 bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        {submitted ? (
          <div className="text-center py-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#47E6E1]/20">
              <Check className="h-6 w-6 text-[#0e8a87]" />
            </div>
            <h3 className="text-lg font-semibold text-[#242843]">Demo requested!</h3>
            <p className="mt-2 text-sm text-[#64748b]">We&apos;ll be in touch within 24 hours.</p>
            <button onClick={closeModal} className="mt-6 rounded-xl bg-[#4338ca] px-6 py-2.5 text-sm font-semibold text-white">Close</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#242843]">Book a Demo</h3>
              <button onClick={closeModal} className="text-[#64748b] hover:text-[#242843]">✕</button>
            </div>
            <p className="text-sm text-[#64748b] mb-4">Fill in this quick form and we&apos;ll be in touch within 24 hours!</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#242843]">Name *</label>
                <input type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#4338ca] focus:outline-none focus:ring-1 focus:ring-[#4338ca]" placeholder="Your name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#242843]">Company Name *</label>
                <input type="text" required value={form.company} onChange={e => setForm({ ...form, company: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#4338ca] focus:outline-none focus:ring-1 focus:ring-[#4338ca]" placeholder="Your platform" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#242843]">Website *</label>
                <input type="url" required value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#4338ca] focus:outline-none focus:ring-1 focus:ring-[#4338ca]" placeholder="https://yourplatform.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#242843]">Email *</label>
                <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#4338ca] focus:outline-none focus:ring-1 focus:ring-[#4338ca]" placeholder="you@email.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#242843]">Phone</label>
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#4338ca] focus:outline-none focus:ring-1 focus:ring-[#4338ca]" placeholder="+1 (555) 123-4567" />
              </div>
              <button type="submit" className="w-full rounded-xl bg-[#4338ca] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#3730a3]">
                Request Demo
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page data
// ---------------------------------------------------------------------------
const features = [
  { icon: Search, title: 'Dives deeper than keywords.', body: 'BM25 keyword matching runs alongside vector semantic search on every query. "milf with young stud" finds "stepmom with son\'s friend" - even when words don\'t match.' },
  { icon: Code2, title: 'One script tag. Works everywhere.', body: 'Paste a single line of JavaScript on your platform. ScubaSearch attaches to your existing search input automatically. No framework. No rebuild. No developer.' },
  { icon: Zap, title: 'Mature typo tolerance.', body: '"milf wiht young stud", "stepmom wiht sonss friendd", "harccore" - all handled. Your users know what they want. ScubaSearch finds what they mean, not what they type.' },
  { icon: Clock, title: 'Search-as-you-type.', body: 'Results surface on every keystroke. Cached responses return in under 5ms. The right document appears before the user finishes typing.' },
  { icon: BarChart2, title: "See what users couldn't find.", body: 'Zero-result query reports surface exactly what users searched for and found nothing. Top queries, click-through rates, and response times included.' },
  { icon: LayoutDashboard, title: 'Control panel you actually understand.', body: 'Upload your documents, watch them index in real time. Create and revoke API keys. Copy your embed snippet. See usage against your plan limits.' },
]

const steps = [
  { step: 'Step 1', title: 'Upload your catalog', body: 'Export your documents as CSV or connect your SQL, Postgres, MySQL, or other database. Documents are embedded and indexed in the background - usually under 5 minutes.' },
  { step: 'Step 2', title: 'Paste one script tag', body: 'Copy the embed snippet from your control panel. Paste it before the closing </body> tag on your site. ScubaSearch attaches to your existing search input automatically.' },
  { step: "That's it. Really.", title: "Users find what they're looking for", body: 'Results surface as they type. Typos handled. Natural language works. "stepomm with son\'s frnd" finds "milf with young stud" - even when words don\'t match.' },
]

const plans = [
  {
    name: 'Starter', price: '$99', period: '/month',
    description: 'For mature platforms ready to go deep.',
    products: '1,000 documents', sessions: '10,000 sessions/month',
    features: ['Hybrid search (keyword + semantic)', 'JS embed widget', 'Typo tolerance', 'API access', 'Email support', 'Full analytics dashboard', 'Zero-result query reports', 'Search performance metrics', 'Click-through rate tracking'],
    cta: 'Start with Starter', highlighted: true,
  },
  {
    name: 'Scale', price: '$199', period: '/month',
    description: 'For large catalogs that need maximum scale and dedicated support.',
    products: '10,000+ documents', sessions: 'Custom sessions',
    features: ['Everything in Starter', '10,000+ documents', 'Custom sessions', 'Priority support', 'Dedicated onboarding'],
    cta: 'Start with Scale', highlighted: false,
  },
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ContentPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <ContentNav />

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden px-6 pt-36 pb-32 text-center lg:pt-44 lg:pb-40">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[700px] bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(114,246,252,0.22)_0%,transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] translate-x-1/4 translate-y-1/4 rounded-full bg-[#47E6E1]/7 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[400px] bg-[radial-gradient(ellipse_80%_80%_at_0%_100%,rgba(114,246,252,0.12)_0%,transparent_70%)]" />
          <div className="relative mx-auto max-w-4xl">
            <span className="inline-flex items-center rounded-full border border-[#47E6E1]/30 bg-[#47E6E1]/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-[#0e8a87]">
              AI-Powered Search
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-bold tracking-tight text-[#242843] sm:text-6xl lg:text-7xl">
              Your users can&apos;t find what they&apos;re looking for.
              <br />
              <span className="bg-gradient-to-r from-[#4338ca] to-[#47E6E1] bg-clip-text text-transparent">
                Fix it in 30 minutes.
              </span>
            </h1>
            <p className="mx-auto mt-7 max-w-xl text-lg leading-8 text-[#64748b]">
              Most search only skims the surface. ScubaSearch dives into the intent behind every query - understanding what users actually want, not just the words they type.
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => (window as any).openDemoModal?.()}
                className="rounded-xl bg-[#4338ca] px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-all hover:bg-[#3730a3] hover:shadow-md"
              >
                Book a Demo
              </button>
              <a href="#pricing" className="rounded-xl border border-slate-200 bg-white px-8 py-3.5 text-base font-semibold text-[#242843] transition-colors hover:bg-slate-50">
                See pricing
              </a>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="relative overflow-hidden border-t border-slate-100 bg-white px-6 py-24 lg:py-32">
          <div aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_0%_0%,rgba(114,246,252,0.16)_0%,transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(114,246,252,0.10)_0%,transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_100%_100%,rgba(114,246,252,0.16)_0%,transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl">
            <div className="text-center">
              <span className="text-xs font-semibold tracking-widest uppercase text-[#0e8a87]">Under the surface</span>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#242843] sm:text-4xl">Built to go deep.</h2>
            </div>
            <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => {
                const Icon = f.icon
                return (
                  <div key={f.title} className="rounded-2xl border border-slate-100 bg-white p-6 transition-shadow hover:shadow-sm">
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#4338ca]/8 text-[#4338ca]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-semibold text-[#4338ca]">{f.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#64748b]">{f.body}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="relative overflow-hidden border-t border-slate-100 bg-white px-6 py-24 lg:py-32">
          <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_100%_0%,rgba(114,246,252,0.16)_0%,transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_0%_100%,rgba(114,246,252,0.16)_0%,transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-[#242843] sm:text-4xl">Ready to go deep in 30 minutes</h2>
            </div>
            <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {steps.map((item) => (
                <div key={item.step} className="rounded-2xl border border-slate-100 bg-white p-7">
                  <span className="text-xs font-semibold tracking-widest uppercase text-[#4338ca]">{item.step}</span>
                  <h3 className="mt-3 text-base font-semibold text-[#242843]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#64748b]">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="relative overflow-hidden border-t border-slate-100 bg-white px-6 py-24 lg:py-32">
          <div aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_0%_0%,rgba(114,246,252,0.16)_0%,transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(114,246,252,0.10)_0%,transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_100%_100%,rgba(114,246,252,0.16)_0%,transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-[#242843] sm:text-4xl">Simple pricing</h2>
              <p className="mx-auto mt-4 max-w-lg text-base text-[#64748b]">High-touch support and setup included.</p>
            </div>
            <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:max-w-4xl mx-auto">
              {plans.map((plan) => (
                <div key={plan.name} className={`flex flex-col rounded-2xl bg-white p-8 ${plan.highlighted ? 'border-2 border-[#4338ca] shadow-sm' : 'border border-slate-200'}`}>
                  {plan.highlighted && (
                    <span className="mb-4 w-fit rounded-full border border-[#47E6E1]/30 bg-[#47E6E1]/15 px-3 py-1 text-xs font-semibold text-[#0e8a87]">Most popular</span>
                  )}
                  <h3 className="text-lg font-bold text-[#242843]">{plan.name}</h3>
                  <p className="mt-1 text-sm text-[#64748b]">{plan.description}</p>
                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-[#242843]">{plan.price}</span>
                    <span className="text-[#64748b]">{plan.period}</span>
                  </div>
                  <div className="mt-4 space-y-1 text-sm">
                    <p className="font-semibold text-[#242843]">{plan.products}</p>
                    <p className="text-[#64748b]">{plan.sessions}</p>
                  </div>
                  <div className="my-6 h-px bg-slate-100" />
                  <ul className="flex flex-col gap-3 text-sm text-[#64748b]">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#4338ca]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-8">
                    <button
                      onClick={() => (window as any).openDemoModal?.()}
                      className={`block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all ${plan.highlighted ? 'bg-[#4338ca] text-white shadow-sm hover:bg-[#3730a3]' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                      {plan.cta}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA BANNER */}
        <section className="relative overflow-hidden border-t border-slate-100 bg-white px-6 py-24 lg:py-32">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(ellipse_60%_80%_at_50%_50%,rgba(114,246,252,0.18)_0%,transparent_70%)]" />
          <div className="relative mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[#242843] sm:text-4xl">Ready to dive in?</h2>
            <p className="mt-4 text-base text-[#64748b]">See how ScubaSearch can transform your search.</p>
            <div className="mt-8">
              <button
                onClick={() => (window as any).openDemoModal?.()}
                className="inline-block rounded-xl bg-[#4338ca] px-8 py-4 text-base font-semibold text-white shadow-sm transition-all hover:bg-[#3730a3] hover:shadow-md"
              >
                Book a Demo
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className="text-sm font-bold text-[#242843]">ScubaSearch</span>
              <p className="mt-1 text-sm text-[#64748b]">A product by SearchMinds</p>
              <p className="mt-0.5 text-xs text-[#94a3b8]">by Ayush Patil</p>
            </div>
            <nav className="flex gap-6 text-sm text-[#64748b]">
              <a href="#pricing" className="transition-colors hover:text-[#4338ca]">Pricing</a>
              <a href="/contact.html" className="transition-colors hover:text-[#4338ca]">Contact</a>
              <a href="/cashfree_problems" className="transition-colors hover:text-[#4338ca]">Payment help</a>
            </nav>
            <nav className="flex gap-6 text-sm text-[#64748b]">
              <a href="/terms.html" className="transition-colors hover:text-[#4338ca]">Terms</a>
              <a href="/cancellation-policy.html" className="transition-colors hover:text-[#4338ca]">Cancellation</a>
              <a href="/privacy" className="transition-colors hover:text-[#4338ca]">Privacy</a>
            </nav>
          </div>
          <p className="mt-8 text-center text-xs text-[#94A3B8]">&copy; {new Date().getFullYear()} ScubaSearchMinds. ScubaSearch is a product by SearchMinds, by Ayush Patil. All rights reserved.</p>
        </div>
      </footer>

      <DemoModal />
    </div>
  )
}
