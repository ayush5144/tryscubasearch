import type { Metadata } from 'next'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'Terms and conditions for using ScubaSearch. Covers acceptable use, billing, data, intellectual property, and governing law.',
}

const tocItems = [
  { href: '#acceptance', label: '1. Acceptance' },
  { href: '#service', label: '2. The Service' },
  { href: '#account', label: '3. Your Account' },
  { href: '#usage', label: '4. Acceptable Use' },
  { href: '#billing', label: '5. Billing & Payments' },
  { href: '#data', label: '6. Your Data' },
  { href: '#ip', label: '7. Intellectual Property' },
  { href: '#sla', label: '8. Uptime & SLA' },
  { href: '#liability', label: '9. Liability' },
  { href: '#termination', label: '10. Termination' },
  { href: '#governing', label: '11. Governing Law' },
  { href: '#contact-t', label: '12. Contact' },
]

export default function TermsPage() {
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
          <h1 className="text-3xl sm:text-4xl font-bold text-[#242843] mb-2">Terms &amp; Conditions</h1>
          <p className="text-sm text-[#64748b]">Last updated: June 2025 &nbsp;&middot;&nbsp; Surge Minds</p>
        </section>

        {/* Doc layout */}
        <div className="mx-auto max-w-[860px] px-6 py-12 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-12 items-start">

          {/* TOC - hidden on mobile */}
          <aside className="hidden md:block sticky top-24">
            <h4 className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#64748b] mb-3">On this page</h4>
            <nav className="flex flex-col">
              {tocItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="text-[0.8rem] text-[#64748b] py-1 pl-3 border-l-2 border-transparent hover:text-[#4338ca] hover:border-[#4338ca] transition-all"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </aside>

          {/* Body */}
          <div className="space-y-10 text-sm">

            <section id="acceptance">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">1. Acceptance of Terms</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">
                By accessing or using ScubaSearch (the &quot;Service&quot;), operated by{' '}
                <strong>Surge Minds</strong> (founded by <strong>Ayush Patil</strong>), you agree to be bound by these
                Terms &amp; Conditions. If you do not agree, do not use the Service.
              </p>
              <p className="text-[#64748b] leading-relaxed">
                These Terms apply to all visitors, users, and customers of ScubaSearch.
                &quot;We,&quot; &quot;us,&quot; and &quot;our&quot; refer to Surge Minds.
              </p>
            </section>

            <section id="service">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">2. The Service</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">
                ScubaSearch provides AI-powered hybrid search infrastructure for OTT and content streaming platforms.
                The Service includes:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-[#64748b]">
                <li>A hosted Meilisearch-based search engine with vector embedding</li>
                <li>An embeddable JavaScript search widget</li>
                <li>A dashboard for catalog management, analytics, and API key management</li>
                <li>Integrations with external databases and CSV imports</li>
                <li>An optional AI shopping assistant</li>
              </ul>
              <p className="text-[#64748b] leading-relaxed mt-2">
                We reserve the right to modify, suspend, or discontinue any part of the Service at any time,
                with reasonable notice where possible.
              </p>
            </section>

            <section id="account">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">3. Your Account</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">You must create an account to use the Service. You are responsible for:</p>
              <ul className="list-disc pl-5 space-y-1 text-[#64748b]">
                <li>Maintaining the confidentiality of your API keys and login credentials</li>
                <li>All activity that occurs under your account</li>
                <li>Ensuring your account information is accurate and up to date</li>
              </ul>
              <p className="text-[#64748b] leading-relaxed mt-2">
                You must be at least 18 years old and have the legal authority to enter into this agreement
                on behalf of your business.
              </p>
            </section>

            <section id="usage">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">4. Acceptable Use</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">You agree not to use the Service to:</p>
              <ul className="list-disc pl-5 space-y-1 text-[#64748b]">
                <li>Violate any applicable law or regulation</li>
                <li>Upload or transmit malicious code, spam, or content that infringes third-party rights</li>
                <li>Attempt to reverse-engineer, scrape, or resell the Service without written consent</li>
                <li>Abuse API rate limits or attempt to circumvent plan-based restrictions</li>
                <li>Use the search widget on domains you do not own or have authority over</li>
              </ul>
              <div className="mt-3 bg-[rgba(67,56,202,0.06)] border-l-[3px] border-[#4338ca] rounded-r-lg px-4 py-3 text-[0.85rem] text-[#242843]">
                Violation of acceptable use may result in immediate suspension without refund.
              </div>
            </section>

            <section id="billing">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">5. Billing &amp; Payments</h2>
              <h3 className="text-[0.9rem] font-semibold text-[#242843] mt-4 mb-1">Subscription Plans</h3>
              <p className="text-[#64748b] leading-relaxed">
                ScubaSearch operates on a monthly subscription model. Your chosen plan (Growth or Scale) renews
                automatically on the same date each month unless cancelled.
              </p>
              <h3 className="text-[0.9rem] font-semibold text-[#242843] mt-4 mb-1">Payment Processing</h3>
              <p className="text-[#64748b] leading-relaxed">
                All payments are processed by <strong>Cashfree Payments India Pvt. Ltd.</strong> on behalf of
                Surge Minds. By subscribing, you authorise us to charge your payment method on each renewal date.
              </p>
              <h3 className="text-[0.9rem] font-semibold text-[#242843] mt-4 mb-1">Plan Limits</h3>
              <p className="text-[#64748b] leading-relaxed">
                Each plan includes limits on the number of titles indexed and monthly search sessions.
                Exceeding limits may result in throttling or a prompt to upgrade your plan.
              </p>
              <h3 className="text-[0.9rem] font-semibold text-[#242843] mt-4 mb-1">Cancellation &amp; Refunds</h3>
              <p className="text-[#64748b] leading-relaxed">
                You may cancel your subscription at any time. Cancellation takes effect at the end of the current
                billing period - you retain full access until then. See our{' '}
                <Link href="/cancellation-policy" className="text-[#4338ca] hover:underline">Cancellation Policy</Link>{' '}
                for full details. We do not offer prorated refunds for partial months.
              </p>
            </section>

            <section id="data">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">6. Your Data</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">
                You retain ownership of all catalog content and viewer search logs you upload
                to ScubaSearch.
              </p>
              <p className="text-[#64748b] leading-relaxed mb-2">
                By using the Service, you grant us a limited licence to store, process, and transmit your data
                solely to provide the Service. We do not sell your data to third parties.
              </p>
              <p className="text-[#64748b] leading-relaxed">
                You are responsible for ensuring you have the right to upload and index the content you provide.
                We may remove content that violates applicable law.
              </p>
            </section>

            <section id="ip">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">7. Intellectual Property</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">
                ScubaSearch, its software, branding, and documentation are the intellectual property of Surge Minds.
                You may not copy, redistribute, or create derivative works without our written consent.
              </p>
              <p className="text-[#64748b] leading-relaxed">
                The embeddable widget code is provided for use on your own properties only. Any other use requires
                a separate licence agreement.
              </p>
            </section>

            <section id="sla">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">8. Uptime &amp; Service Levels</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">
                We target 99.5% monthly uptime for the search API. Planned maintenance will be communicated in
                advance where possible.
              </p>
              <p className="text-[#64748b] leading-relaxed">
                We are not liable for downtime caused by third-party services (Meilisearch, OpenAI, Cashfree,
                Cloudflare, or hosting providers) or force majeure events.
              </p>
            </section>

            <section id="liability">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">9. Limitation of Liability</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">
                To the maximum extent permitted by law, Surge Minds shall not be liable for any indirect,
                incidental, special, or consequential damages arising from your use of the Service.
              </p>
              <p className="text-[#64748b] leading-relaxed">
                Our total liability to you for any claim arising under these Terms shall not exceed the total
                fees paid by you in the three months preceding the claim.
              </p>
            </section>

            <section id="termination">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">10. Termination</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">
                We may suspend or terminate your account if you breach these Terms, fail to pay subscription
                fees, or if we determine your use poses a risk to other users or the platform.
              </p>
              <p className="text-[#64748b] leading-relaxed">
                Upon termination, your access to the Service ceases. You may request an export of your product
                data within 30 days of termination, after which it will be deleted.
              </p>
            </section>

            <section id="governing">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">11. Governing Law</h2>
              <p className="text-[#64748b] leading-relaxed">
                These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive
                jurisdiction of the courts of Pune, Maharashtra, India.
              </p>
            </section>

            <section id="contact-t">
              <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">12. Contact</h2>
              <p className="text-[#64748b] leading-relaxed mb-2">For questions about these Terms, contact us at:</p>
              <ul className="list-disc pl-5 space-y-1 text-[#64748b]">
                <li>Email: <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a></li>
                <li>Legal entity: Surge Minds, by Ayush Patil</li>
                <li>Address: Pune, Maharashtra, India - 411001</li>
              </ul>
            </section>

          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
