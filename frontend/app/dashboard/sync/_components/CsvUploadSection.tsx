'use client'

import { ArrowRight, Check, Copy } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

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

const CSV_EXAMPLE = `id,title,description,category,tags,actors,director,writer,content_type,year,language,image_url,product_url
cms_1001,Signal Ridge,"A rescue crew chases a fading transmission across frozen cliffs.",Thriller,"rescue,mountain","Asha Bell,Rohan Seth",Tia Noor,Tia Noor,movie,2026,English,https://cdn.example/signal-ridge.jpg,https://platform.example/titles/signal-ridge
cms_1002,Blue Horizon,"Three siblings uncover a family secret.",Drama,"family,mystery","Kai Rao,Mia Chen",Lena Park,Lena Park,series,2025,English,https://cdn.example/blue-horizon.jpg,https://platform.example/titles/blue-horizon`

interface CsvUploadSectionProps {
  apiKey: string | null
  apiBase: string
}

export function CsvUploadSection({ apiKey, apiBase }: CsvUploadSectionProps) {
  const key = apiKey ?? 'sk_live_your_key'

  const apiCurl = `# CSV (replace - rebuild catalog)
curl -X POST "${apiBase}/api/v1/push/file?mode=replace" \\
  -H "Authorization: Bearer ${key}" \\
  -F "file=@catalog.csv"

# NDJSON (append - add new titles on top of existing catalog)
curl -X POST "${apiBase}/api/v1/push/file?mode=append" \\
  -H "Authorization: Bearer ${key}" \\
  -F "file=@delta.ndjson"

# JSON (update - patch only the fields you send)
curl -X POST "${apiBase}/api/v1/push/file?mode=update" \\
  -H "Authorization: Bearer ${key}" \\
  -F "file=@patches.json"`

  return (
    <div className="space-y-4">
      {!apiKey && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Create an active API key in Settings to use the file upload API.
        </div>
      )}

      <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-[#64748b] space-y-1">
        <div>
          Accepts <span className="font-mono text-xs">.csv</span>,{' '}
          <span className="font-mono text-xs">.json</span>, and{' '}
          <span className="font-mono text-xs">.ndjson</span> files up to 100 MB. Format is detected automatically from the file extension.
        </div>
        <div>
          Use <span className="font-mono text-xs">replace</span> to rebuild the catalog,{' '}
          <span className="font-mono text-xs">append</span> to add or overwrite matching IDs, or{' '}
          <span className="font-mono text-xs">update</span> to patch only the fields you send.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/documents"
          className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3]"
        >
          Upload from browser <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <span className="text-xs text-[#94a3b8]">Opens the Documents page (uses dashboard session)</span>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#242843]">API upload (API key)</p>
          <CopyButton text={apiCurl} />
        </div>
        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-xs text-green-400 font-mono leading-relaxed">{apiCurl}</pre>
        <p className="mt-2 text-xs text-[#94a3b8]">
          Uses your active API key - no browser session needed. Poll{' '}
          <span className="font-mono">/api/v1/ingest/jobs/:id</span> for job status.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#242843]">Example CSV</p>
          <CopyButton text={CSV_EXAMPLE} />
        </div>
        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-xs text-green-400 font-mono leading-relaxed">{CSV_EXAMPLE}</pre>
        <p className="mt-2 text-xs text-[#94a3b8]">
          <span className="font-medium text-[#64748b]">Required:</span> title.{' '}
          <span className="font-medium text-[#64748b]">Optional:</span> id, description, category,
          actors, director, writer, tags, content_type, year, language, image_url, product_url.
        </p>
      </div>
    </div>
  )
}
