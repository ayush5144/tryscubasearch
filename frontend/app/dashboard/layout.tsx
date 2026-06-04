'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { UserButton, useAuth } from '@clerk/nextjs'
import { CreditCard, Database, LayoutDashboard, Package, Settings, BarChart2, Search, Sliders, Layers, Webhook, BookOpen } from 'lucide-react'
import { ensureMe } from '@/lib/api-client'

const navItems: { href: string; label: string; icon: React.ElementType; sub?: boolean; section?: 'settings' | 'guide' }[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/documents', label: 'Documents', icon: Package },
  { href: '/dashboard/testscuba', label: 'Try Search', icon: Search },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/dashboard/sync', label: 'Sync Methods', icon: Webhook },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/settings/widget', label: 'Widget Settings', icon: Sliders, sub: true, section: 'settings' },
  { href: '/dashboard/settings/embed-config', label: 'Embed Config', icon: Layers, sub: true, section: 'settings' },
  { href: '/dashboard/database', label: 'Database', icon: Database },
  { href: '/dashboard/guide', label: 'Guide', icon: BookOpen },
  { href: '/dashboard/guide/api', label: 'API Guide', icon: BookOpen, sub: true, section: 'guide' },
  { href: '/dashboard/guide/api/example', label: 'API Example', icon: BookOpen, sub: true, section: 'guide' },
  { href: '/dashboard/sync/guide', label: 'Sync Guide', icon: BookOpen, sub: true, section: 'guide' },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const [checked, setChecked] = React.useState(false)

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    async function provision() {
      try {
        const token = await getToken()
        if (!token) { router.push('/sign-in'); return }
        const profile = await ensureMe(token)
        if (!profile.onboarding_complete) {
          router.push('/onboarding')
          return
        }
        setChecked(true)
      } catch {
        router.push('/onboarding')
      }
    }

    provision()
  }, [isLoaded, isSignedIn, getToken, router])

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#4338ca] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-[#242843]">
      {/* Fixed top header - full width */}
      <header className="fixed top-0 left-0 right-0 h-14 z-40 flex">
        {/* Sidebar section of header - dark bg matching sidebar */}
        <div className="flex w-56 shrink-0 items-center px-6 border-r border-slate-100/60 bg-white/60 backdrop-blur-md">
          <Link href="/" className="font-display font-bold text-[#242843] hover:opacity-70 transition-opacity">
            ScubaSearch
          </Link>
        </div>
        {/* Content section of header - solid white */}
        <div className="flex flex-1 items-center justify-end border-b border-slate-100 px-6 bg-white">
          <UserButton />
        </div>
      </header>

      {/* Fixed sidebar - below header */}
      <aside className="fixed top-14 left-0 h-[calc(100vh-3.5rem)] w-56 flex flex-col border-r border-slate-100 bg-white z-30 overflow-y-auto">
        <nav className="flex flex-1 flex-col gap-1 p-3 pt-4">
          {navItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : item.href === '/dashboard/guide'
                ? pathname.startsWith('/dashboard/guide') || pathname.startsWith('/dashboard/sync/guide')
                : pathname === item.href
            const Icon = item.icon

            // Sub-items only visible when parent section is active
            if (item.sub) {
              if (item.section === 'settings' && !pathname.startsWith('/dashboard/settings')) return null
              if (item.section === 'guide' && !pathname.startsWith('/dashboard/guide') && !pathname.startsWith('/dashboard/sync/guide')) return null
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-md py-2 text-sm font-medium transition-colors ${
                  item.sub ? 'pl-8 pr-3' : 'px-3'
                } ${
                  isActive
                    ? 'bg-[#4338ca]/8 text-[#4338ca]'
                    : item.sub
                    ? 'text-[#94a3b8] hover:bg-slate-50 hover:text-[#64748b]'
                    : 'text-[#64748b] hover:bg-slate-50 hover:text-[#242843]'
                }`}
              >
                <Icon className={`shrink-0 ${item.sub ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main content - offset for fixed sidebar + header */}
      <div className="pl-56 pt-14">
        <main className="p-8">{children}</main>
      </div>
    </div>
  )
}
