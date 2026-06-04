import Link from 'next/link'
import { ArrowRight, BookOpen, Webhook } from 'lucide-react'

const guides = [
  {
    href: '/dashboard/guide/api',
    title: 'API Guide',
    icon: BookOpen,
    summary: 'Learn how to connect ScubaSearch to mobile apps, custom web apps, and any frontend that wants native UI.',
    bullets: [
      'How /search, /click, and /settle work',
      'What the app needs to store during a search session',
      'How results, clicks, and analytics flow end to end',
    ],
  },
  {
    href: '/dashboard/sync/guide',
    title: 'Sync Guide',
    icon: Webhook,
    summary: 'Learn when to use file uploads, REST push, webhooks, and auto-sync pull to keep your catalog fresh.',
    bullets: [
      'Which sync method fits your platform',
      'Replace vs Append vs Update in simple terms',
      'Step-by-step setup for each sync method',
    ],
  },
]

export default function GuideHubPage() {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <div className="text-sm font-medium text-[#4338ca]">Guide</div>
        <h1 className="mt-1 text-2xl font-semibold text-[#242843]">Setup guides and integration help</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748b]">
          Everything here is meant to help you ship ScubaSearch faster, whether you are embedding the widget on a website or wiring search into your own app experience.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {guides.map((guide) => {
          const Icon = guide.icon
          return (
            <Link
              key={guide.href}
              href={guide.href}
              className="group rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="rounded-xl bg-[#4338ca]/8 p-3 text-[#4338ca]">
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="mt-1 h-4 w-4 text-[#94a3b8] transition-transform group-hover:translate-x-0.5" />
              </div>

              <h2 className="mt-4 text-lg font-semibold text-[#242843]">{guide.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#64748b]">{guide.summary}</p>

              <ul className="mt-4 space-y-2 text-sm text-[#64748b]">
                {guide.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#4338ca]" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
