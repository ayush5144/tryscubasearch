import type { Metadata } from 'next'
import NavBar from '@/components/NavBar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'How Billing Works',
  description: 'ScubaSearch bills by search sessions, not queries. One customer using search once = one session. Clear explanation of plans and limits.',
}

export default function HowBillingWorksPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <NavBar />

      <main className="flex-grow mx-auto w-full max-w-2xl px-6 pt-32 pb-12">
        <h1 className="text-2xl font-bold text-[#242843]">How billing works</h1>
        <p className="mt-2 text-sm text-[#64748b]">
          A clear explanation of how we count usage and what your plan includes.
        </p>

        {/* Sessions vs Queries */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-[#242843]">Sessions vs queries</h2>

          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-[#242843]">Query</h3>
              <p className="mt-1 text-sm text-[#64748b]">
                Every search API call counts as one query. As a customer types in your search bar,
                each keystroke (after 2 characters) triggers a search. Typing &quot;nike shoes&quot;
                fires roughly 4 queries: &quot;ni&quot;, &quot;nik&quot;, &quot;nike&quot;, &quot;nike shoes&quot;.
              </p>
              <p className="mt-2 text-xs text-[#94a3b8]">
                Queries are tracked internally for our cost monitoring. They are not used for billing.
              </p>
            </div>

            <div className="rounded-lg border-2 border-[#4338ca] bg-[#4338ca]/5 p-5">
              <h3 className="text-sm font-semibold text-[#4338ca]">Session</h3>
              <p className="mt-1 text-sm text-[#64748b]">
                One customer using your search bar once. A session starts when the customer begins typing
                and ends when any of these happens:
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[#64748b]">
                <li className="flex gap-2">
                  <span className="shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-[#4338ca]" />
                  <span><span className="font-medium text-[#242843]">Click</span> - customer clicks a product in the results</span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-[#4338ca]" />
                  <span><span className="font-medium text-[#242843]">Enter</span> - customer presses Enter to confirm their search</span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-[#4338ca]" />
                  <span><span className="font-medium text-[#242843]">Idle</span> - 3 seconds of no typing (customer is reading the results)</span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-[#4338ca]" />
                  <span><span className="font-medium text-[#242843]">Leave</span> - customer switches tabs or navigates away</span>
                </li>
              </ul>
              <p className="mt-3 text-sm text-[#64748b]">
                Once a session ends, no more events are counted from it. If the customer searches again,
                a new session starts.
              </p>
              <p className="mt-2 text-xs font-medium text-[#4338ca]">
                Your plan limit is based on sessions - not queries.
              </p>
            </div>
          </div>
        </section>

        {/* Why sessions */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-[#242843]">Why we bill by sessions</h2>
          <p className="mt-2 text-sm text-[#64748b]">
            Billing by query would mean a single customer typing &quot;comfortable running shoes&quot; uses
            15+ queries just from normal typing. That is not fair to you.
          </p>
          <p className="mt-2 text-sm text-[#64748b]">
            With session-based billing, that same customer counts as 1 session regardless of how much they
            typed, refined, or reworded their search. You pay for real customer interactions, not keystrokes.
          </p>
        </section>

        {/* Example */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-[#242843]">Example</h2>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-[#64748b] space-y-3">
            <p>A customer visits your store and searches for sneakers:</p>
            <div className="font-mono text-xs bg-white rounded border border-slate-200 p-3 space-y-1">
              <p className="text-[#94a3b8]">Types: n, ni, nik, nike, nike s, nike sh, nike shoes</p>
              <p className="text-[#94a3b8]">Queries fired: 6</p>
              <p className="text-[#94a3b8]">Hovers over a result, clicks it</p>
              <p className="text-[#4338ca] font-medium">Session settles on click - 1 session counted</p>
            </div>
            <p>
              Later the same customer searches again for &quot;blue running shoes&quot;. That is a second session.
            </p>
            <p className="font-medium text-[#242843]">
              Total: 2 sessions billed (not 12+ queries).
            </p>
          </div>
        </section>

        {/* Plans */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-[#242843]">Plan limits</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left font-medium text-[#242843]">Plan</th>
                  <th className="px-4 py-3 text-left font-medium text-[#242843]">Sessions / month</th>
                  <th className="px-4 py-3 text-left font-medium text-[#242843]">Products</th>
                </tr>
              </thead>
              <tbody className="text-[#64748b]">
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-[#242843]">Growth - $39/mo</td>
                  <td className="px-4 py-3">10,000</td>
                  <td className="px-4 py-3">1,000</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-[#242843]">Scale - $199/mo</td>
                  <td className="px-4 py-3">100,000</td>
                  <td className="px-4 py-3">10,000</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[#94a3b8]">
            Session and query counters reset on the first day of each calendar month.
          </p>
        </section>

        {/* What happens at limit */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-[#242843]">What happens when you hit your limit</h2>
          <p className="mt-2 text-sm text-[#64748b]">
            When your monthly session limit is reached, the search widget stops returning results and
            shows a fallback message. Your store continues to work normally - only the search feature
            pauses until the counter resets next month or you upgrade your plan.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  )
}
