import type { Metadata } from 'next'
import NavBar from '@/components/NavBar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'ScubaSearch privacy policy. How we collect, store, and use your data. We never sell your data to third parties.',
}

const sections = [
  {
    id: 'overview',
    title: '1. Overview',
    body: (
      <>
        <p className="text-[#64748b] leading-relaxed mb-2">
          ScubaSearch is a product of <strong>Surge Minds</strong>, founded by <strong>Ayush Patil</strong>.
          This Privacy Policy explains what data we collect, how we use it, and your rights as a user.
        </p>
        <p className="text-[#64748b] leading-relaxed">
          By using ScubaSearch, you agree to the practices described in this policy. If you have questions,
          contact us at{' '}
          <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a>.
        </p>
      </>
    ),
  },
  {
    id: 'data-collected',
    title: '2. Data We Collect',
    body: (
      <>
        <p className="text-[#64748b] leading-relaxed mb-2">We collect the following categories of data:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm text-[#64748b]">
          <li><strong className="text-[#242843]">Account data</strong> - name, email address, and platform details provided during sign-up.</li>
          <li><strong className="text-[#242843]">Content catalog</strong> - title metadata, descriptions, posters, and watch URLs you upload or sync.</li>
          <li><strong className="text-[#242843]">Search logs</strong> - anonymised search queries, session signals (click, idle, enter), result counts, and response times from your platform&apos;s viewers.</li>
          <li><strong className="text-[#242843]">Usage data</strong> - API call counts, session counts, and plan usage for billing and rate-limiting purposes.</li>
          <li><strong className="text-[#242843]">Integration credentials</strong> - External database connection strings, stored encrypted and used only to sync your catalog.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'how-used',
    title: '3. How We Use Your Data',
    body: (
      <>
        <p className="text-[#64748b] leading-relaxed mb-2">We use collected data to:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-[#64748b]">
          <li>Provide, operate, and improve the ScubaSearch service</li>
          <li>Index your content catalog in Meilisearch and generate vector embeddings via OpenAI</li>
          <li>Display analytics (top queries, zero-result reports, click-through rates) in your dashboard</li>
          <li>Enforce plan limits and prevent abuse</li>
          <li>Send transactional emails (account, billing, security alerts)</li>
        </ul>
        <p className="text-[#64748b] leading-relaxed mt-3">
          We do <strong>not</strong> use your data for advertising, and we do not sell it to any third party.
        </p>
      </>
    ),
  },
  {
    id: 'storage',
    title: '4. Data Storage',
    body: (
      <>
        <p className="text-[#64748b] leading-relaxed mb-2">
          Your data is stored on servers hosted on DigitalOcean (Mumbai region) and Cloudflare Pages
          (global CDN for the dashboard). Content vectors are stored in Meilisearch on the same VPS.
        </p>
        <p className="text-[#64748b] leading-relaxed">
          Search query snapshots are temporarily held in Redis (in-memory) before being settled and written
          to PostgreSQL. Redis data is not persisted to disk for session buffers.
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: '5. Data Sharing',
    body: (
      <>
        <p className="text-[#64748b] leading-relaxed mb-2">
          We do not sell, rent, or trade your personal data. We share data only with the following
          sub-processors, strictly to provide the service:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-[#64748b]">
          <li><strong className="text-[#242843]">OpenAI</strong> - title, genre, tags, and description text is sent to generate vector embeddings. No viewer personal data is included.</li>
          <li><strong className="text-[#242843]">Cashfree Payments</strong> - payment processing; governed by Cashfree&apos;s own privacy policy.</li>
          <li><strong className="text-[#242843]">Clerk</strong> - authentication provider; stores your login credentials securely.</li>
          <li><strong className="text-[#242843]">Cloudflare</strong> - CDN and DNS; may log IP addresses per their privacy policy.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    title: '6. Data Retention',
    body: (
      <>
        <ul className="list-disc pl-5 space-y-2 text-sm text-[#64748b]">
          <li><strong className="text-[#242843]">Active accounts</strong> - data is retained for as long as your subscription is active.</li>
          <li><strong className="text-[#242843]">After cancellation</strong> - product data and search indexes are retained for 30 days, then permanently deleted.</li>
          <li><strong className="text-[#242843]">Search logs</strong> - anonymised query logs are retained for up to 90 days for analytics, then purged.</li>
          <li><strong className="text-[#242843]">Billing records</strong> - kept for 7 years as required by Indian financial regulations.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'rights',
    title: '7. Your Rights',
    body: (
      <>
        <p className="text-[#64748b] leading-relaxed mb-2">You have the right to:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-[#64748b]">
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Export your product catalog from the dashboard at any time</li>
        </ul>
        <p className="text-[#64748b] leading-relaxed mt-3">
          To exercise these rights, email{' '}
          <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a>.
          We will respond within 5 business days.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: '8. Cookies',
    body: (
      <p className="text-[#64748b] leading-relaxed">
        The ScubaSearch dashboard uses only essential cookies required for authentication (managed by Clerk).
        We do not use tracking, advertising, or analytics cookies. The embeddable widget does not set any
        cookies on your viewers&apos; browsers.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '9. Contact',
    body: (
      <>
        <p className="text-[#64748b] leading-relaxed mb-2">For privacy-related questions or data requests, contact us at:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-[#64748b]">
          <li>Email: <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a></li>
          <li>Legal entity: Surge Minds, by Ayush Patil</li>
          <li>Address: Pune, Maharashtra, India - 411001</li>
        </ul>
      </>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <NavBar />

      <main className="flex-grow">
        {/* Hero */}
        <section
          className="pt-36 pb-10 px-6 text-center"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(114,246,252,0.2) 0%, transparent 70%)' }}
        >
          <span className="inline-block bg-[rgba(71,230,225,0.12)] border border-[rgba(71,230,225,0.3)] text-[#0e8a87] text-xs font-semibold tracking-[0.05em] px-4 py-1.5 rounded-full mb-4">
            Legal
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#242843] mb-2">Privacy Policy</h1>
          <p className="text-sm text-[#64748b]">Last updated: June 2025 &nbsp;&middot;&nbsp; Surge Minds</p>
        </section>

        {/* Doc layout */}
        <div className="mx-auto max-w-[860px] px-6 py-12 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-12 items-start">

          {/* TOC */}
          <aside className="hidden md:block sticky top-24">
            <h4 className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#64748b] mb-3">On this page</h4>
            <nav className="flex flex-col">
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="text-[0.8rem] text-[#64748b] py-1 pl-3 border-l-2 border-transparent hover:text-[#4338ca] hover:border-[#4338ca] transition-all"
                >
                  {s.title}
                </a>
              ))}
            </nav>
          </aside>

          {/* Body */}
          <div className="space-y-10 text-sm">
            {sections.map((s) => (
              <section key={s.id} id={s.id}>
                <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">{s.title}</h2>
                {s.body}
              </section>
            ))}
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}
