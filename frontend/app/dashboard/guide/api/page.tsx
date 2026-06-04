import Link from 'next/link'
import { ArrowLeft, ArrowRight, Code2, Smartphone, Globe, Sparkles } from 'lucide-react'

const steps = [
  {
    title: '1. Create an API key',
    emoji: '🔑',
    body: 'Go to Settings and create an API key. Your app will send this key in the Authorization header on every search, click, and settle request.',
  },
  {
    title: '2. Watch the search bar',
    emoji: '⌨️',
    body: 'As the viewer types, debounce the input slightly before calling the API. A small delay like 100-300ms usually feels good.',
  },
  {
    title: '3. Call Search',
    emoji: '🔎',
    body: 'Send the current query, the number of results you want, and the semantic ratio to POST /api/v1/search.',
  },
  {
    title: '4. Render the results',
    emoji: '🎬',
    body: 'Use the response to draw your own cards, list, grid, or search screen. Keep the returned log_id in memory for tracking.',
  },
  {
    title: '5. Track taps',
    emoji: '👆',
    body: 'When the viewer taps a result, call POST /api/v1/search/click so ScubaSearch knows what was actually chosen.',
  },
  {
    title: '6. Settle the session',
    emoji: '📊',
    body: 'When the session is meaningfully over, call POST /api/v1/search/settle so analytics can classify the session correctly.',
  },
]

export default function ApiGuidePage() {
  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-medium text-[#4338ca]">API Guide</div>
          <h1 className="mt-1 text-2xl font-semibold text-[#242843]">How to use ScubaSearch in apps and custom frontends</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748b]">
            This guide is for teams who want to build the search UI themselves. That includes native mobile apps, React or Next apps, custom web apps, TV apps, and any frontend that wants full control over the experience.
          </p>
        </div>
        <Link
          href="/dashboard/guide"
          className="shrink-0 inline-flex items-center gap-1.5 justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-[#242843] hover:border-slate-300 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Guide
        </Link>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">Which integration should I use?</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            {
              title: 'Widget',
              icon: Globe,
              colour: 'bg-slate-50 border-slate-200',
              bestFor: 'Standard websites',
              summary: 'ScubaSearch gives you both the UI and the search behavior.',
            },
            {
              title: 'Headless web',
              icon: Sparkles,
              colour: 'bg-amber-50 border-amber-100',
              bestFor: 'Custom browser UIs',
              summary: 'You build the UI, but widget.js still helps with browser-side search wiring and tracking.',
            },
            {
              title: 'Direct API',
              icon: Smartphone,
              colour: 'bg-[#4338ca]/5 border-[#4338ca]/15',
              bestFor: 'Mobile apps and fully custom frontends',
              summary: 'Your app calls the backend endpoints directly and owns the whole UI experience.',
            },
          ].map((item) => {
            const Icon = item.icon
            return (
              <div key={item.title} className={`rounded-xl border p-4 ${item.colour}`}>
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-white p-2 text-[#4338ca]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-[#242843]">{item.title}</h3>
                </div>
                <div className="mt-3 inline-block rounded-full bg-white px-2 py-0.5 text-xs text-[#64748b]">{item.bestFor}</div>
                <p className="mt-3 text-sm leading-6 text-[#64748b]">{item.summary}</p>
              </div>
            )
          })}
        </div>
        <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-[#64748b]">
          <span className="font-medium text-[#242843]">Simple rule:</span> if your team is building the search bar, results UI, and app screen flow themselves, use direct API integration.
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">What your app actually needs to do</h2>
        <p className="mt-2 text-sm text-[#64748b]">The good news: your app does not need a big SDK. It just needs to do three simple things.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ['🔎 Search', 'POST /api/v1/search', 'Ask ScubaSearch for ranked results when the viewer types.'],
            ['👆 Click', 'POST /api/v1/search/click', 'Tell ScubaSearch which result the viewer actually tapped.'],
            ['📊 Settle', 'POST /api/v1/search/settle', 'Tell ScubaSearch how the session ended so analytics make sense.'],
          ].map(([title, endpoint, body]) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-[#242843]">{title}</div>
              <div className="mt-2 inline-block rounded bg-white px-2 py-1 font-mono text-xs text-[#4338ca]">{endpoint}</div>
              <p className="mt-3 text-sm leading-6 text-[#64748b]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">The real sample we already have</h2>
        <p className="mt-2 text-sm text-[#64748b]">
          We already have a working direct-API sample in the repo: <code className="rounded bg-zinc-100 px-1 text-xs">widget/testapi.html</code>.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-[#242843]">✅ Is that integration style correct?</h3>
            <p className="mt-2 text-sm leading-6 text-[#64748b]">
              Yes. That file is a pure API integration demo. It does not use the widget UI. It creates its own search bar, calls the search endpoint directly, renders its own OTT-style cards, tracks clicks, and settles sessions for analytics.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-[#242843]">What it proves</h3>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-[#64748b]">
              <li>• direct API integration works without a widget</li>
              <li>• custom UI works fine</li>
              <li>• click and settle tracking still work</li>
              <li>• this is the right mental model for mobile apps too</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <a
            href="http://localhost:8080/testapi.html"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#4338ca] px-4 py-2 text-sm font-medium text-white hover:bg-[#3730a3]"
          >
            Open local API demo <ArrowRight className="h-3.5 w-3.5" />
          </a>
          <Link
            href="/dashboard/guide/api/example"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-[#242843] hover:border-slate-300 hover:bg-slate-50"
          >
            View demo code <Code2 className="h-3.5 w-3.5" />
          </Link>
        </div>
        <p className="mt-3 text-xs text-[#94a3b8]">
          The local demo link works when the widget dev server is running.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">Step by step</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {steps.map((step) => (
            <div key={step.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <div className="text-xl">{step.emoji}</div>
                <h3 className="text-sm font-semibold text-[#242843]">{step.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#64748b]">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">What a developer actually sends</h2>

        <div className="mt-5 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-[#242843]">1. Search request</h3>
            <p className="mt-1 text-sm text-[#64748b]">
              This is the main call. Send the current query, how many results you want back, and the semantic ratio.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-xs text-slate-100"><code>{`POST /api/v1/search
Authorization: Bearer sk_live_...
Content-Type: application/json

{
  "query": "dark thriller",
  "limit": 8,
  "semantic_ratio": 0.5
}`}</code></pre>
          </div>

          <div className="border-t border-zinc-100 pt-5">
            <h3 className="text-sm font-semibold text-[#242843]">2. Search response</h3>
            <p className="mt-1 text-sm text-[#64748b]">
              The key thing to keep is <code className="rounded bg-zinc-100 px-1 text-xs">log_id</code>. You will reuse it for click tracking and settle tracking.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-xs text-slate-100"><code>{`{
  "results": [
    {
      "id": "csv_101",
      "title": "Night Signal",
      "description": "A radio host uncovers a conspiracy after a midnight call.",
      "category": "Thriller",
      "image_url": "https://cdn.example.com/night-signal.jpg",
      "product_url": "https://example.com/watch/night-signal"
    }
  ],
  "total": 1,
  "cache_hit": false,
  "processing_time_ms": 182,
  "log_id": "uuid-from-search"
}`}</code></pre>
          </div>

          <div className="border-t border-zinc-100 pt-5">
            <h3 className="text-sm font-semibold text-[#242843]">3. Click request</h3>
            <p className="mt-1 text-sm text-[#64748b]">
              When the viewer taps a result, send the selected product ID plus the latest search log ID.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-xs text-slate-100"><code>{`POST /api/v1/search/click
Authorization: Bearer sk_live_...
Content-Type: application/json

{
  "product_id": "csv_101",
  "search_log_id": "uuid-from-search"
}`}</code></pre>
          </div>

          <div className="border-t border-zinc-100 pt-5">
            <h3 className="text-sm font-semibold text-[#242843]">4. Settle request</h3>
            <p className="mt-1 text-sm text-[#64748b]">
              This tells ScubaSearch how the session ended and turns raw typing into useful analytics.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-xs text-slate-100"><code>{`POST /api/v1/search/settle
Authorization: Bearer sk_live_...
Content-Type: application/json

{
  "log_id": "uuid-from-search",
  "session_id": "sess_abc123",
  "queries": [
    { "value": "da", "timestamp": 1710000000000 },
    { "value": "dark", "timestamp": 1710000000400 },
    { "value": "dark thriller", "timestamp": 1710000001200 }
  ],
  "query_meta": {
    "dark thriller": {
      "result_count": 8,
      "cache_hit": false,
      "response_ms": 182
    }
  },
  "signal": "enter",
  "engagement": true
}`}</code></pre>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">What your app should keep during one search session</h2>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-[#64748b]">
          <li><span className="font-medium text-[#242843]">Latest log_id:</span> returned by Search, reused by Click and Settle.</li>
          <li><span className="font-medium text-[#242843]">A session_id:</span> one logical search session in your app.</li>
          <li><span className="font-medium text-[#242843]">Query snapshots:</span> the meaningful typed values over time.</li>
          <li><span className="font-medium text-[#242843]">Query meta:</span> final result count, cache hit, and response time if you want richer settle data.</li>
          <li><span className="font-medium text-[#242843]">Engagement flag:</span> whether the viewer meaningfully interacted with results.</li>
        </ul>
      </section>

      <section className="rounded-xl border border-[#4338ca]/15 bg-[#4338ca]/5 p-6">
        <h2 className="text-base font-semibold text-[#242843]">Quick tips</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#64748b]">
          <li>📱 <span className="font-medium text-[#242843]">Mobile apps can use this directly.</span> No widget required.</li>
          <li>🌐 <span className="font-medium text-[#242843]">Web apps can use this too.</span> API integration is not mobile-only.</li>
          <li>🧠 <span className="font-medium text-[#242843]">Headless is built on the same API.</span> It is a convenience layer, not a different backend.</li>
          <li>🧪 <span className="font-medium text-[#242843]">Start small.</span> Make Search work first, then add Click, then add Settle.</li>
        </ul>
      </section>
    </div>
  )
}
