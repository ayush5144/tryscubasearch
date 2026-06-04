import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'

const sampleSnippet = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>StreamFlix - ScubaSearch API Demo</title>
</head>
<body>
  <input id="searchInput" type="text" placeholder="Search titles, actors, genres, moods..." />
  <div id="grid"></div>

  <script>
    const API_KEY  = 'sk_live_...';
    const API_BASE = 'http://localhost:8000';

    const SESSION_ID = crypto.randomUUID();
    let querySnapshots = [];
    let queryMeta = {};
    let lastLogId = null;
    let lastResults = [];

    const searchInput = document.getElementById('searchInput');

    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      clearTimeout(debounceTimer);
      if (!q) return;

      querySnapshots.push({ value: q, timestamp: Date.now() });
      debounceTimer = setTimeout(() => doSearch(q), 280);
    });

    async function doSearch(query) {
      const res = await fetch(\`\${API_BASE}/api/v1/search\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${API_KEY}\`,
        },
        body: JSON.stringify({ query, limit: 20, semantic_ratio: 0.5 }),
      });

      const data = await res.json();
      lastResults = data.results || [];
      lastLogId = data.log_id || null;

      queryMeta[query] = {
        result_count: lastResults.length,
        cache_hit: data.cache_hit === true,
        response_ms: data.processing_time_ms,
      };

      renderCards(lastResults);
    }

    function renderCards(results) {
      document.getElementById('grid').innerHTML = results.map((item) => {
        return \`
          <button onclick="handleCardClick('\${item.id}')">
            \${item.title}
          </button>
        \`;
      }).join('');
    }

    function handleCardClick(productId) {
      fetch(\`\${API_BASE}/api/v1/search/click\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${API_KEY}\`,
        },
        body: JSON.stringify({
          product_id: String(productId),
          search_log_id: lastLogId,
        }),
      }).catch(() => {});

      settle('click');
    }

    async function settle(signal) {
      if (querySnapshots.length === 0) return;

      await fetch(\`\${API_BASE}/api/v1/search/settle\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${API_KEY}\`,
        },
        body: JSON.stringify({
          log_id: lastLogId,
          session_id: SESSION_ID,
          queries: querySnapshots,
          query_meta: queryMeta,
          signal,
          engagement: signal === 'click',
        }),
      });
    }
  </script>
</body>
</html>`

export default function ApiExamplePage() {
  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-medium text-[#4338ca]">API Guide</div>
          <h1 className="mt-1 text-2xl font-semibold text-[#242843]">Sample code: pure API integration</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748b]">
            This is the same integration style used in <code className="rounded bg-zinc-100 px-1 text-xs">widget/testapi.html</code>. It is a pure API demo: no widget UI, no SDK, just your own frontend calling ScubaSearch directly.
          </p>
        </div>
        <Link
          href="/dashboard/guide/api"
          className="shrink-0 inline-flex items-center gap-1.5 justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-[#242843] hover:border-slate-300 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to API Guide
        </Link>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">What this sample is showing</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-[#242843]">What it does</h3>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-[#64748b]">
              <li>• listens to a custom search input</li>
              <li>• calls <code className="rounded bg-white px-1 text-xs">/api/v1/search</code></li>
              <li>• renders custom result cards</li>
              <li>• tracks clicks with <code className="rounded bg-white px-1 text-xs">/api/v1/search/click</code></li>
              <li>• settles the session with <code className="rounded bg-white px-1 text-xs">/api/v1/search/settle</code></li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-[#242843]">Why it matters</h3>
            <p className="mt-2 text-sm leading-6 text-[#64748b]">
              This proves that ScubaSearch can work without the widget UI. That is why the same backend model can be used for mobile apps, TV apps, and custom web frontends too.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <a
            href="http://localhost:8080/testapi.html"
            className="inline-flex items-center gap-2 rounded-xl bg-[#4338ca] px-4 py-2 text-sm font-medium text-white hover:bg-[#3730a3]"
          >
            Open local API demo <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#242843]">Example code</h2>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-xs leading-6 text-slate-100"><code>{sampleSnippet}</code></pre>
      </section>
    </div>
  )
}
