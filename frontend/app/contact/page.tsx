import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import NavBar from '@/components/NavBar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Get in touch with the ScubaSearch team. Email, phone, and address for support, billing, and general enquiries.',
}

export default function ContactPage() {
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
            Get in touch
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#242843] mb-3">Contact Us</h1>
          <p className="text-base text-[#64748b] max-w-md mx-auto">
            We&apos;re a small team and we respond fast. Reach out through any of the channels below.
          </p>
        </section>

        {/* Content */}
        <div className="mx-auto max-w-[900px] px-6 py-12">

          {/* Contact grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            {/* Email */}
            <div className="border border-[#e2e8f0] rounded-2xl p-7 bg-white">
              <div className="text-2xl mb-3">📧</div>
              <h3 className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-2">Email</h3>
              <a href="mailto:ayushpatil9977@gmail.com" className="text-[0.95rem] font-medium text-[#242843] hover:text-[#4338ca] transition-colors">
                ayushpatil9977@gmail.com
              </a>
              <p className="text-[0.8rem] text-[#64748b] mt-1">General enquiries, billing, support</p>
            </div>

            {/* Phone */}
            <div className="border border-[#e2e8f0] rounded-2xl p-7 bg-white">
              <div className="text-2xl mb-3">📱</div>
              <h3 className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-2">Phone / WhatsApp</h3>
              <a href="tel:+919699095770" className="text-[0.95rem] font-medium text-[#242843] hover:text-[#4338ca] transition-colors">
                +91 96990 95770
              </a>
              <p className="text-[0.8rem] text-[#64748b] mt-1">Mon - Fri, 10 am - 7 pm IST</p>
            </div>

            {/* Address */}
            <div className="border border-[#e2e8f0] rounded-2xl p-7 bg-white">
              <div className="text-2xl mb-3">🏢</div>
              <h3 className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-2">Operating Address</h3>
              <p className="text-[0.95rem] font-medium text-[#242843]">Surge Minds</p>
              <p className="text-[0.8rem] text-[#64748b] mt-1">Pune, Maharashtra, India - 411001</p>
            </div>

            {/* Payment Issues */}
            <div className="border border-[#e2e8f0] rounded-2xl p-7 bg-white">
              <div className="text-2xl mb-3">💳</div>
              <h3 className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-2">Payment Issues</h3>
              <Link href="/cashfree-problems" className="text-[0.95rem] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
                Cashfree payment help <ArrowRight className="inline h-3.5 w-3.5 ml-0.5" />
              </Link>
              <p className="text-[0.8rem] text-[#64748b] mt-1">Transaction failures, pending payments, refunds</p>
            </div>
          </div>

          {/* Legal & Business Info */}
          <div className="border border-[#e2e8f0] rounded-2xl p-7 bg-[#fafafa] mb-10">
            <h2 className="text-base font-bold text-[#242843] mb-4">Legal &amp; Business Information</h2>
            <dl className="space-y-2.5">
              {[
                { label: 'Legal Name', value: 'Surge Minds' },
                { label: 'Product Name', value: 'ScubaSearch' },
                { label: 'Parent Entity', value: 'Surge Minds' },
                { label: 'Founder', value: 'Ayush Patil' },
                { label: 'Email', value: <a href="mailto:ayushpatil9977@gmail.com" className="text-[#4338ca] hover:underline">ayushpatil9977@gmail.com</a> },
                { label: 'Registered Country', value: 'India' },
                { label: 'Payment Processor', value: 'Cashfree Payments India Pvt. Ltd.' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col sm:flex-row gap-1 sm:gap-3 text-sm">
                  <dt className="font-semibold text-[#242843] sm:min-w-[160px] shrink-0">{label}</dt>
                  <dd className="text-[#64748b]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Response time banner */}
          <div className="flex gap-4 items-center bg-[rgba(67,56,202,0.06)] border border-[rgba(67,56,202,0.15)] rounded-2xl px-6 py-5 text-sm text-[#242843]">
            <span className="text-xl shrink-0">⏱</span>
            <span>
              We aim to respond to all emails within{' '}
              <strong className="text-[#4338ca]">4-8 business hours</strong>.
              For urgent payment issues, mention your transaction ID in the subject line.
            </span>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}
