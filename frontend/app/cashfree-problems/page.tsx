import type { Metadata } from 'next'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Payment Issues - Cashfree Help',
  description: 'Help with ScubaSearch payment issues via Cashfree - failed payments, pending transactions, refunds, and UPI problems.',
}

const problems = [
  {
    tag: 'Payment failed',
    tagClass: 'bg-[#fef2f2] text-[#dc2626]',
    title: 'Transaction declined at checkout',
    body: 'Your card or UPI was declined during payment. This usually happens due to bank-side limits, 3D Secure failure, or an expired card.',
    fix: 'Try a different payment method (UPI, net banking, or another card). Check with your bank if international/online transactions are enabled.',
  },
  {
    tag: 'Payment pending',
    tagClass: 'bg-[#fffbeb] text-[#d97706]',
    title: 'Money deducted but subscription not activated',
    body: "Cashfree sometimes marks payments as \"pending\" while the bank confirms settlement. This can take up to 24 hours in rare cases.",
    fix: 'Wait 2-4 hours and refresh your dashboard. If still unresolved, email us with your transaction ID and we\'ll manually verify.',
  },
  {
    tag: 'Refund',
    tagClass: 'bg-[#eff6ff] text-[#2563eb]',
    title: 'Refund not received after cancellation',
    body: "Refunds via Cashfree take 5-7 business days to reflect in your account depending on your bank's processing speed.",
    fix: "Check your bank statement after 7 working days. If not received, send us the refund reference ID and we'll follow up with Cashfree.",
  },
  {
    tag: 'KYC / Verification',
    tagClass: 'bg-[#f5f3ff] text-[#7c3aed]',
    title: 'Payment blocked due to KYC mismatch',
    body: "Cashfree may block transactions if the billing name doesn't match KYC records, or if your account flags an AML check.",
    fix: 'Ensure the name on your payment method matches your account. Contact us and we can process an alternative payment link.',
  },
  {
    tag: 'Webhook / API',
    tagClass: 'bg-[#ecfdf5] text-[#059669]',
    title: 'Subscription activated then immediately deactivated',
    body: "A race condition between our webhook handler and Cashfree's retry logic can cause a brief deactivation loop.",
    fix: 'This resolves automatically within 10 minutes. If your account still shows inactive after that, contact us with your order ID.',
  },
  {
    tag: 'UPI',
    tagClass: 'bg-[#fef2f2] text-[#dc2626]',
    title: 'UPI payment times out or shows "pending" forever',
    body: 'UPI requests expire after 5 minutes if not approved in the payer app. Network issues can also cause the status to get stuck.',
    fix: 'Check your UPI app for a pending request and approve it. If the timer expired, try the payment again - the previous attempt will auto-void.',
  },
]

const steps = [
  {
    num: 'Step 1',
    title: 'Find your transaction ID',
    body: 'Check your email confirmation or Cashfree payment receipt for the order/transaction ID.',
  },
  {
    num: 'Step 2',
    title: 'Email us',
    body: (
      <>
        Send the transaction ID and a screenshot of the error to{' '}
        <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a>.
      </>
    ),
  },
  {
    num: 'Step 3',
    title: 'We resolve it',
    body: "We'll verify with Cashfree and fix your account status or process a manual refund within 1 business day.",
  },
]

export default function CashfreeProblemsPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <NavBar />

      <main className="flex-grow">
        {/* Hero */}
        <section
          className="pt-36 pb-12 px-6 text-center"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(114,246,252,0.2) 0%, transparent 70%)' }}
        >
          <span className="inline-block bg-[rgba(71,230,225,0.12)] border border-[rgba(71,230,225,0.3)] text-[#0e8a87] text-xs font-semibold tracking-[0.05em] px-4 py-1.5 rounded-full mb-5">
            Payment Help
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#242843] max-w-xl mx-auto mb-4 leading-tight">
            Common Cashfree Payment Issues &amp; Fixes
          </h1>
          <p className="text-base text-[#64748b] max-w-lg mx-auto">
            Running into a problem with your payment? Here are the most common issues and how to resolve
            them quickly.
          </p>
        </section>

        {/* Problem cards */}
        <div className="mx-auto max-w-[900px] px-6 py-12">
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#0e8a87] mb-2">Known Issues</p>
          <h2 className="text-xl font-bold text-[#242843] mb-8">What might be going wrong</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-12">
            {problems.map((p) => (
              <div
                key={p.title}
                className="border border-[#e2e8f0] rounded-2xl p-6 bg-white hover:shadow-md transition-shadow"
              >
                <span className={`inline-block text-[0.7rem] font-semibold uppercase tracking-[0.05em] px-2.5 py-1 rounded-full mb-3 ${p.tagClass}`}>
                  {p.tag}
                </span>
                <h3 className="text-[0.95rem] font-semibold text-[#242843] mb-2">{p.title}</h3>
                <p className="text-sm text-[#64748b] leading-relaxed mb-3">{p.body}</p>
                <div className="bg-[rgba(67,56,202,0.06)] rounded-lg px-4 py-3 text-[0.8rem] text-[#4338ca]">
                  <strong className="block mb-0.5 text-[#242843]">Fix</strong>
                  {p.fix}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Steps section */}
        <section
          className="border-t border-b border-[#e2e8f0] py-12 px-6"
          style={{ background: 'radial-gradient(ellipse 60% 80% at 50% 50%, rgba(114,246,252,0.1) 0%, transparent 70%)' }}
        >
          <div className="mx-auto max-w-[900px]">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#0e8a87] mb-2">What to do</p>
            <h2 className="text-xl font-bold text-[#242843] mb-8">Raise a payment issue in 3 steps</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {steps.map((s) => (
                <div key={s.num} className="bg-white border border-[#e2e8f0] rounded-2xl p-5">
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#4338ca] mb-2">{s.num}</p>
                  <h4 className="text-[0.9rem] font-semibold text-[#242843] mb-1">{s.title}</h4>
                  <p className="text-[0.8rem] text-[#64748b] leading-relaxed">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact Now */}
        <section
          className="border-t border-b border-[#e2e8f0] py-14 px-6 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(67,56,202,0.04) 0%, rgba(71,230,225,0.08) 100%)' }}
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-[#242843] mb-3">Still stuck? Contact us now.</h2>
          <p className="text-base text-[#64748b] max-w-md mx-auto mb-8">
            Our team responds within a few hours on business days. Don&apos;t wait - reach out and we&apos;ll sort it.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mb-8">
            <a
              href="mailto:ayushpatil9977@gmail.com"
              className="bg-[#4338ca] hover:bg-[#3730a3] text-white text-[0.9rem] font-semibold px-7 py-3 rounded-xl transition-colors"
            >
              Email us
            </a>
            <Link
              href="/contact"
              className="bg-white border border-[#e2e8f0] text-[#242843] text-[0.9rem] font-semibold px-7 py-3 rounded-xl hover:bg-slate-50 transition-colors"
            >
              View all contact details
            </Link>
          </div>
          <div className="flex flex-wrap gap-6 justify-center text-sm text-[#64748b]">
            <span className="flex items-center gap-2">
              📧{' '}
              <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] font-medium hover:underline">
                ayushpatil9977@gmail.com
              </a>
            </span>
            <span className="flex items-center gap-2">
              📱{' '}
              <a href="tel:+919699095770" className="text-[#4338ca] font-medium hover:underline">
                +91 96990 95770
              </a>
            </span>
          </div>
        </section>

        {/* Legal notice */}
        <div className="mx-auto max-w-[900px] px-6 py-10">
          <div className="border border-[#e2e8f0] rounded-2xl p-6 bg-[#fafafa]">
            <h4 className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-[#242843] mb-3">Legal Information</h4>
            <p className="text-[0.8rem] text-[#64748b] leading-7">
              ScubaSearch is a product of <strong>Surge Minds</strong>, founded and operated by{' '}
              <strong>Ayush Patil</strong>. All payment transactions are processed by Cashfree Payments India
              Pvt. Ltd. on behalf of Surge Minds. For billing disputes, cancellations, or refund requests,
              refer to our{' '}
              <Link href="/cancellation-policy" className="text-[#4338ca] hover:underline">Cancellation Policy</Link>{' '}
              and{' '}
              <Link href="/terms" className="text-[#4338ca] hover:underline">Terms &amp; Conditions</Link>.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
