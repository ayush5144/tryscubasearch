import type { Metadata } from 'next'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Cancellation Policy',
  description: 'ScubaSearch cancellation policy. Cancel anytime, no lock-in. Access continues until your next billing date.',
}

export default function CancellationPolicyPage() {
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
          <h1 className="text-3xl sm:text-4xl font-bold text-[#242843] mb-2">Cancellation Policy</h1>
          <p className="text-sm text-[#64748b]">Last updated: June 2025 &nbsp;&middot;&nbsp; Surge Minds</p>
        </section>

        {/* Content */}
        <div className="mx-auto max-w-[700px] px-6 py-12">

          {/* Summary card */}
          <div className="border-2 border-[#4338ca] rounded-2xl px-8 py-7 mb-10 bg-[rgba(67,56,202,0.03)]">
            <h2 className="text-base font-bold text-[#242843] mb-4">The short version</h2>
            <div className="space-y-3">
              {[
                { icon: '📅', text: <><strong>Cancel anytime.</strong> No lock-in, no cancellation fee.</> },
                { icon: '✅', text: <><strong>Access continues until your next payment date.</strong> You won&apos;t lose service mid-cycle.</> },
                { icon: '🔄', text: <><strong>No prorated refunds.</strong> The current billing period is not refunded once it starts.</> },
                { icon: '🚫', text: <><strong>Next charge is prevented.</strong> Cancellation stops the next renewal from being processed.</> },
              ].map(({ icon, text }, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="text-base shrink-0 mt-0.5">{icon}</span>
                  <p className="text-[#64748b]">{text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* How cancellation works */}
          <section className="mb-8">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#0e8a87] mb-1">How cancellation works</p>
            <h2 className="text-[1.05rem] font-bold text-[#242843] mb-4">Next-payment based cancellation</h2>
            <p className="text-sm text-[#64748b] mb-6">
              ScubaSearch subscriptions are billed monthly. When you cancel, your cancellation is scheduled
              against your <strong>next upcoming payment date</strong> - not the current one.
            </p>

            {/* Timeline */}
            <div className="space-y-6 mb-6">
              {[
                {
                  num: '1',
                  title: 'You request cancellation',
                  body: <>Submit a cancellation request from your dashboard or by emailing <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a>.</>,
                },
                {
                  num: '2',
                  title: 'Your access continues',
                  body: 'You retain full access to ScubaSearch - including search, analytics, and widget - until your next billing date.',
                },
                {
                  num: '3',
                  title: 'Next charge is blocked',
                  body: 'On your next scheduled renewal date, no charge is made. Your subscription ends and your plan reverts to inactive.',
                },
                {
                  num: '4',
                  title: 'Data retained for 30 days',
                  body: 'After your subscription ends, your product data and indexes are retained for 30 days. You can reactivate within this window. After 30 days, data is permanently deleted.',
                },
              ].map(({ num, title, body }) => (
                <div key={num} className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-[rgba(67,56,202,0.1)] text-[#4338ca] text-xs font-bold flex items-center justify-center mt-0.5">
                    {num}
                  </div>
                  <div>
                    <h3 className="text-[0.9rem] font-semibold text-[#242843] mb-1">{title}</h3>
                    <p className="text-[0.85rem] text-[#64748b]">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-[rgba(67,56,202,0.06)] border-l-[3px] border-[#4338ca] rounded-r-lg px-4 py-3 text-[0.85rem] text-[#242843]">
              <strong>Example:</strong> Your plan renews on the 15th of each month. You cancel on the 8th.
              You keep full access through the 14th. On the 15th, no charge is processed and your subscription ends.
            </div>
          </section>

          {/* Refunds */}
          <section className="mb-8">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#0e8a87] mb-1">Refunds</p>
            <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">Refund policy</h2>
            <p className="text-sm text-[#64748b] mb-3">
              We do not offer prorated refunds for partial billing periods already paid. However, we handle
              refunds on a case-by-case basis in the following circumstances:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-[#64748b] mb-3">
              <li>Duplicate charges due to a technical error</li>
              <li>Charge processed after a confirmed cancellation request</li>
              <li>Service was unavailable for more than 48 consecutive hours in the billing period</li>
            </ul>
            <div className="bg-[#fffbeb] border-l-[3px] border-[#d97706] rounded-r-lg px-4 py-3 text-[0.85rem] text-[#92400e] mb-3">
              Refund requests must be submitted within <strong>7 days</strong> of the disputed charge.
              Requests made after this window may not be honoured.
            </div>
            <p className="text-sm text-[#64748b]">
              To request a refund, email{' '}
              <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a>{' '}
              with your transaction ID and reason. We&apos;ll respond within 2 business days.
            </p>
          </section>

          {/* Reactivation */}
          <section className="mb-8">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#0e8a87] mb-1">Reactivation</p>
            <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">Changed your mind?</h2>
            <p className="text-sm text-[#64748b] mb-2">
              You can reactivate your subscription at any time within 30 days of cancellation. Your existing
              catalog data, API keys, and widget configuration will be restored.
            </p>
            <p className="text-sm text-[#64748b]">
              After 30 days, all data is permanently deleted and reactivation starts fresh.
            </p>
          </section>

          {/* How to cancel */}
          <section className="mb-8">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#0e8a87] mb-1">How to cancel</p>
            <h2 className="text-[1.05rem] font-bold text-[#242843] mb-3">Submitting a cancellation</h2>
            <p className="text-sm text-[#64748b] mb-2">
              You can cancel your subscription in any of the following ways:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-[#64748b] mb-3">
              <li><strong>Dashboard:</strong> Go to Dashboard &gt; Billing &gt; Cancel subscription</li>
              <li>
                <strong>Email:</strong> Send a cancellation request to{' '}
                <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a>{' '}
                with your account email and reason
              </li>
            </ul>
            <p className="text-sm text-[#64748b]">
              You will receive an email confirmation once your cancellation is processed. Please keep this
              for your records.
            </p>
          </section>

          {/* CTA box */}
          <div
            className="border border-[#e2e8f0] rounded-2xl p-8 text-center mt-10"
            style={{ background: 'radial-gradient(ellipse 60% 80% at 50% 50%, rgba(114,246,252,0.12) 0%, transparent 70%)' }}
          >
            <h3 className="text-[1.1rem] font-bold text-[#242843] mb-2">Need help with your cancellation?</h3>
            <p className="text-sm text-[#64748b] mb-5">Our team will sort it out quickly - usually within a few hours.</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <a
                href="mailto:ayushpatil9977@gmail.com"
                className="inline-block bg-[#4338ca] hover:bg-[#3730a3] text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
              >
                Email us
              </a>
              <Link
                href="/contact"
                className="inline-block bg-white border border-[#e2e8f0] text-[#242843] text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Contact details
              </Link>
            </div>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}
