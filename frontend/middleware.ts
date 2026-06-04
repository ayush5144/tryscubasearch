import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth is handled at the component level via clerk-mock when Clerk is not configured.
export function middleware(_req: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
