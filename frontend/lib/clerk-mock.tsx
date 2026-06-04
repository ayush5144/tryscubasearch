'use client'

/**
 * Clerk stub — used when CLERK keys are not configured.
 * All routes are accessible; getToken() returns a fixed dev token accepted
 * by the backend when ENVIRONMENT=development.
 */

import React from 'react'

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: 'dev-user',
    getToken: async () => 'dev-token',
  }
}

export function useClerk() {
  return {
    signOut: async () => { window.location.href = '/' },
  }
}

export function UserButton() {
  return (
    <div className="h-8 w-8 rounded-full bg-[#4338ca]/20 flex items-center justify-center text-xs font-bold text-[#4338ca] select-none">
      D
    </div>
  )
}

export function SignIn() {
  if (typeof window !== 'undefined') window.location.href = '/dashboard'
  return null
}

export function SignUp() {
  if (typeof window !== 'undefined') window.location.href = '/dashboard'
  return null
}

export function useUser() {
  return {
    isLoaded: true,
    isSignedIn: true,
    user: { id: 'dev-user', primaryEmailAddress: { emailAddress: 'dev@local.dev' } },
  }
}

export function SignedIn({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function SignedOut() {
  return null
}
