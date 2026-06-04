import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function SyncGuidePage() {
  return (
    <div className="max-w-4xl space-y-8">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-medium text-[#4338ca]">Sync Methods Guide</div>
          <h1 className="mt-1 text-2xl font-semibold text-[#242843]">How to keep your catalog updated</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748b]">
            Pick the method that fits how your platform already works. You do not need to use all of them - one is usually enough.
          </p>
        </div>
        <Link
          href="/dashboard/sync"
          className="shrink-0 inline-flex items-center gap-1.5 justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-[#242843] hover:border-slate-300 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Sync Methods
        </Link>
      </div>

      {/* Method picker */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">Which method should I use?</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: 'File upload',
              emoji: '📁',
              who: 'Anyone',
              summary: 'Upload a CSV, JSON, or NDJSON file from your browser or via the API.',
              bestFor: 'Getting started, one-time imports, scheduled exports from another tool.',
            },
            {
              title: 'REST API push',
              emoji: '🔌',
              who: 'Developers',
              summary: 'Your backend sends a JSON batch to ScubaSearch whenever you want.',
              bestFor: 'Nightly sync scripts, admin tooling, CI pipelines, full control over timing.',
            },
            {
              title: 'Webhook sync',
              emoji: '⚡',
              who: 'Developers',
              summary: 'Your CMS or platform fires an event the moment a title is published or edited.',
              bestFor: 'Real-time updates - you want the index to reflect a change within seconds.',
            },
            {
              title: 'Auto-sync pull',
              emoji: '🔄',
              who: 'Developers',
              summary: 'ScubaSearch fetches your catalog from a URL on a schedule you set.',
              bestFor: 'You already have a JSON, CSV, or NDJSON feed and want set-it-and-forget-it.',
            },
          ].map((m) => (
            <div key={m.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-2xl">{m.emoji}</div>
              <h3 className="mt-2 text-sm font-semibold text-[#242843]">{m.title}</h3>
              <div className="mt-1 inline-block rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-[#64748b]">{m.who}</div>
              <p className="mt-2 text-sm leading-5 text-[#64748b]">{m.summary}</p>
              <p className="mt-3 text-xs text-[#94a3b8]"><span className="font-medium text-[#64748b]">Best for:</span> {m.bestFor}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-[#94a3b8]">
          If your catalog lives in a Postgres or MySQL table, use the{' '}
          <Link href="/dashboard/database" className="text-[#4338ca] hover:underline">Database page</Link> instead.
        </p>
      </section>

      {/* Modes */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">Replace, Append, or Update - what's the difference?</h2>
        <p className="mt-2 text-sm text-[#64748b]">Every sync method asks you to choose a mode. Here is what each one does.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              name: 'Replace',
              colour: 'border-red-100 bg-red-50',
              badge: 'bg-red-100 text-red-700',
              meaning: 'Wipe the current catalog and use this new data as the full live catalog.',
              when: 'Sending a complete fresh export. Starting over. Switching from a different source.',
              safe: false,
            },
            {
              name: 'Append',
              colour: 'border-amber-100 bg-amber-50',
              badge: 'bg-amber-100 text-amber-700',
              meaning: 'Add new titles. For any ID that already exists, overwrite it with the new version.',
              when: 'Adding new episodes or titles. Re-sending updated metadata for a few titles. Daily delta exports.',
              safe: true,
            },
            {
              name: 'Update',
              colour: 'border-green-100 bg-green-50',
              badge: 'bg-green-100 text-green-700',
              meaning: 'Only change the specific fields you include. Everything else stays exactly as it is.',
              when: 'Fixing a description. Correcting a cast list. Updating a poster URL. Partial metadata corrections.',
              safe: true,
            },
          ].map((m) => (
            <div key={m.name} className={`rounded-xl border p-4 ${m.colour}`}>
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.badge}`}>{m.name}</span>
              <p className="mt-3 text-sm leading-5 text-[#242843]">{m.meaning}</p>
              <p className="mt-3 text-xs leading-5 text-[#64748b]"><span className="font-medium">Use when:</span> {m.when}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-[#64748b]">
          <span className="font-medium text-[#242843]">Good to know:</span> You can mix formats freely. If you uploaded CSV last time, you can still append NDJSON or update with JSON - ScubaSearch normalises all three to the same internal format. The only time a switch forces a Replace is when you're moving from a Database or Auto-sync pull connection to a file-based upload, since that's a full ownership handover.
        </div>
      </section>

      {/* Step-by-step for each method */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">Step by step</h2>

        <div className="mt-5 space-y-6">

          <div>
            <h3 className="text-sm font-semibold text-[#242843]">📁 File upload</h3>
            <p className="mt-1 text-sm text-[#64748b]">The simplest way to get your catalog in.</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[#64748b]">
              <li>Go to <Link href="/dashboard/documents" className="text-[#4338ca] hover:underline">Documents</Link> and click the upload area.</li>
              <li>Drop your file - CSV, JSON, or NDJSON, up to 100 MB.</li>
              <li>Pick Replace, Append, or Update.</li>
              <li>Hit upload. The job runs in the background; you'll see the count update when it's done.</li>
            </ol>
            <p className="mt-2 text-sm text-[#64748b]">Want to do this from a script? Use the API: <code className="rounded bg-zinc-100 px-1 text-xs">POST /api/v1/push/file?mode=replace</code> with your API key and file as multipart form data.</p>
          </div>

          <div className="border-t border-zinc-100 pt-5">
            <h3 className="text-sm font-semibold text-[#242843]">🔌 REST API push</h3>
            <p className="mt-1 text-sm text-[#64748b]">Your code sends titles to ScubaSearch. Works from any language or tool that can make an HTTP request.</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[#64748b]">
              <li>Create an API key in <Link href="/dashboard/settings" className="text-[#4338ca] hover:underline">Settings</Link>.</li>
              <li>Open the REST API push section on the Sync Methods page.</li>
              <li>Choose a mode and edit the sample payload - or just copy the cURL and run it.</li>
              <li>When you're ready to automate, wire the same <code className="rounded bg-zinc-100 px-1 text-xs">POST /api/v1/push/documents</code> call into your backend or cron job.</li>
            </ol>
          </div>

          <div className="border-t border-zinc-100 pt-5">
            <h3 className="text-sm font-semibold text-[#242843]">⚡ Webhook sync</h3>
            <p className="mt-1 text-sm text-[#64748b]">Your platform already knows when something changed - just point the event at ScubaSearch.</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[#64748b]">
              <li>Create an API key in Settings.</li>
              <li>In your CMS or backend, add a webhook that fires on publish or metadata change events.</li>
              <li>Point it at <code className="rounded bg-zinc-100 px-1 text-xs">POST /api/v1/push/webhook</code> with the API key in the Authorization header.</li>
              <li>Send a single document for single-title events, or a documents array for batch events.</li>
            </ol>
            <p className="mt-2 text-sm text-[#64748b]">Use <span className="font-medium">Update</span> mode for metadata corrections and <span className="font-medium">Append</span> for new publishes - keeps the index tight without unnecessary wipes.</p>
          </div>

          <div className="border-t border-zinc-100 pt-5">
            <h3 className="text-sm font-semibold text-[#242843]">🔄 Auto-sync pull</h3>
            <p className="mt-1 text-sm text-[#64748b]">ScubaSearch comes to you. Works with JSON APIs, CSV export URLs (e.g. Google Sheets), and NDJSON feeds.</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[#64748b]">
              <li>Open the Auto-sync pull section on the Sync Methods page.</li>
              <li>Paste the URL of your catalog endpoint or CSV feed.</li>
              <li>Add auth headers if your source requires them.</li>
              <li>If your JSON has the list nested inside an object (e.g. <code className="rounded bg-zinc-100 px-1 text-xs">{'{"items": [...]}'}</code>), set Items path to <code className="rounded bg-zinc-100 px-1 text-xs">items</code>. For CSV and NDJSON sources, leave this blank.</li>
              <li>Hit Preview - ScubaSearch fetches one row and shows you the available columns.</li>
              <li>Map each column to the right ScubaSearch field (title, description, actors, etc.).</li>
              <li>Set how often to sync (every 15 min, hourly, etc.) and connect it.</li>
            </ol>
            <p className="mt-2 text-sm text-[#64748b]">After connecting, ScubaSearch syncs automatically on the schedule you set. You can also hit Sync now any time from the dashboard.</p>
          </div>

        </div>
      </section>

      {/* Tips */}
      <section className="rounded-xl border border-[#4338ca]/15 bg-[#4338ca]/5 p-6">
        <h2 className="text-base font-semibold text-[#242843]">Quick tips</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#64748b]">
          <li>🆔 <span className="font-medium text-[#242843]">Include an ID.</span> If your source has a stable content ID, send it as <code className="rounded bg-white px-1 text-xs">id</code>. ScubaSearch uses it to match and update the right document cleanly.</li>
          <li>📝 <span className="font-medium text-[#242843]">Title is required.</span> Every other field is optional, but without a title ScubaSearch can't index the document.</li>
          <li>🧪 <span className="font-medium text-[#242843]">Test with a small batch first.</span> Send 2–3 titles, check Try Search, then scale up.</li>
          <li>🔄 <span className="font-medium text-[#242843]">Mix formats freely.</span> You can upload CSV today and append NDJSON tomorrow - no restrictions.</li>
          <li>🔑 <span className="font-medium text-[#242843]">Keep your API key safe.</span> It gives full write access to your catalog. Don't commit it to version control.</li>
        </ul>
      </section>

    </div>
  )
}
