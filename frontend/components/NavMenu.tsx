'use client'

import Link from 'next/link'
import { Menu } from 'lucide-react'
import { useAuth, useClerk } from '@clerk/nextjs'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'

export default function NavMenu() {
  const { isSignedIn } = useAuth()
  const { signOut } = useClerk()

  return (
    <Sheet>
      <SheetTrigger className="flex items-center justify-center rounded-md p-2 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors">
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-64 p-8">
        <nav className="mt-8 flex flex-col gap-1">
          <Link href="/" className="py-2 text-lg font-medium text-zinc-900 hover:text-zinc-600 transition-colors">
            Home
          </Link>
          <Link href="/#pricing" className="py-2 text-lg font-medium text-zinc-900 hover:text-zinc-600 transition-colors">
            Pricing
          </Link>
          {isSignedIn && (
            <Link href="/dashboard" className="py-2 text-lg font-medium text-zinc-900 hover:text-zinc-600 transition-colors">
              Dashboard
            </Link>
          )}
        </nav>

        <Separator className="my-6" />

        <nav className="flex flex-col gap-1">
          {isSignedIn ? (
            <button
              onClick={() => signOut({ redirectUrl: '/' })}
              className="py-2 text-left text-lg font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
            >
              Sign out
            </button>
          ) : (
            <>
              <Link href="/sign-in" className="py-2 text-lg font-medium text-zinc-500 hover:text-zinc-900 transition-colors">
                Sign in
              </Link>
              <Link href="/sign-up" className="py-2 text-lg font-medium text-zinc-500 hover:text-zinc-900 transition-colors">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
