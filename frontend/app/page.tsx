import type { Metadata } from 'next'
import Link from 'next/link'
import { Search, Code2, Zap, Clock, BarChart2, LayoutDashboard } from 'lucide-react'
import NavBar from '@/components/NavBar'

export const metadata: Metadata = {
  title: 'ScubaSearch - AI-Powered Search for OTT & Streaming Platforms',
  description: 'Fix your content search in 30 minutes. ScubaSearch combines keyword and semantic AI search for OTT and streaming catalogs.',
  openGraph: {
    title: 'ScubaSearch - AI-Powered Search for OTT & Streaming Platforms',
    description: 'Fix your content search in 30 minutes. ScubaSearch combines keyword and semantic AI search for OTT and streaming catalogs.',
    url: 'https://scubasearch.io',
  },
}
import Footer from '@/components/Footer'

const features = [
  {
    icon: Search,
    title: 'Dives deeper than keywords.',
    body: 'BM25 keyword matching runs alongside vector semantic search on every query. "mind-bending thriller with a twist ending" surfaces Inception or Shutter Island - even when no words match.',
  },
  {
    icon: Code2,
    title: 'One script tag. Works everywhere.',
    body: 'Paste a single line of JavaScript on your platform. ScubaSearch attaches to your existing search input automatically. No framework. No rebuild. No developer.',
  },
  {
    icon: Zap,
    title: 'Typo tolerance built in.',
    body: '"christofer nolan", "leonrado dicaprio", "avengrs" - all handled. Your viewers type like humans. ScubaSearch finds what they mean, not what they typed.',
  },
  {
    icon: Clock,
    title: 'Search-as-you-type.',
    body: 'Results surface on every keystroke. Cached responses return in under 5ms. The right title appears before the viewer finishes typing.',
  },
  {
    icon: BarChart2,
    title: 'See what viewers couldn\'t find.',
    body: 'Zero-result query reports surface exactly what viewers searched for and found nothing. That list is your next content licensing decision. Top queries, click-through rates, and response times included.',
  },
  {
    icon: LayoutDashboard,
    title: 'Dashboard you actually understand.',
    body: 'Upload your content catalog CSV, watch it index in real time. Create and revoke API keys. Copy your embed snippet. See usage against your plan limits. No technical knowledge needed.',
  },
]

const steps = [
  {
    step: 'Step 1',
    title: 'Upload your content catalog',
    body: 'Export your content catalog as a CSV or JSON - titles, cast, directors, genres. Upload it to your ScubaSearch dashboard. Content is embedded and indexed in the background - usually under 5 minutes.',
  },
  {
    step: 'Step 2',
    title: 'Paste one script tag',
    body: 'Copy the embed snippet from your dashboard. Paste it before the closing </body> tag on your site. ScubaSearch attaches to your existing search input automatically.',
  },
  {
    step: "That's it. Really.",
    title: 'Viewers find what they want to watch',
    body: 'Results surface as they type. Typos are handled. Natural language works. "mind-bending thriller with a twist" finds the right titles even when the words do not match.',
  },
]


export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <NavBar />

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden px-6 pt-36 pb-32 text-center lg:pt-44 lg:pb-40">
          {/* Supademo-style gradient mesh -soft lavender top-center, teal bottom-right */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[700px] bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(114,246,252,0.22)_0%,transparent_70%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] translate-x-1/4 translate-y-1/4 rounded-full bg-[#47E6E1]/7 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[400px] bg-[radial-gradient(ellipse_80%_80%_at_0%_100%,rgba(114,246,252,0.12)_0%,transparent_70%)]"
          />

          <div className="relative mx-auto max-w-4xl">
            {/* Teal badge */}
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

            {/* Subtitle */}
            <p className="mx-auto mt-7 max-w-xl text-lg leading-8 text-[#64748b]">
              Most search only skims the surface. ScubaSearch dives into the intent behind every
              query - understanding what customers actually want, not just the words they type.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="https://github.com/ayush5144/tryscubasearch"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-[#4338ca] px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-all hover:bg-[#3730a3] hover:shadow-md"
              >
                GitHub
              </a>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="relative overflow-hidden border-t border-slate-100 bg-white px-6 py-24 lg:py-32">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_0%_0%,rgba(114,246,252,0.16)_0%,transparent_70%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(114,246,252,0.10)_0%,transparent_70%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_100%_100%,rgba(114,246,252,0.16)_0%,transparent_70%)]"
          />
          <div className="relative mx-auto max-w-6xl">
            <div className="text-center">
              <span className="text-xs font-semibold tracking-widest uppercase text-[#0e8a87]">
                Under the surface
              </span>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#242843] sm:text-4xl">
                Built to go deep.
              </h2>
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
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_100%_0%,rgba(114,246,252,0.16)_0%,transparent_70%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-[500px] w-[500px] bg-[radial-gradient(ellipse_80%_80%_at_0%_100%,rgba(114,246,252,0.16)_0%,transparent_70%)]"
          />
          <div className="relative mx-auto max-w-6xl">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-[#242843] sm:text-4xl">
                Up and running in 30 minutes
              </h2>
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


        {/* CTA BANNER */}
        <section className="relative overflow-hidden border-t border-slate-100 bg-white px-6 py-24 lg:py-32">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(ellipse_60%_80%_at_50%_50%,rgba(114,246,252,0.18)_0%,transparent_70%)]"
          />
          <div className="relative mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[#242843] sm:text-4xl">
              Ready to dive in?
            </h2>
            <p className="mt-4 text-base text-[#64748b]">
              Go live in 30 minutes. No lock-in.
            </p>
            <div className="mt-8">
              <a
                href="https://github.com/ayush5144/tryscubasearch"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-xl bg-[#4338ca] px-8 py-4 text-base font-semibold text-white shadow-sm transition-all hover:bg-[#3730a3] hover:shadow-md"
              >
                GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
