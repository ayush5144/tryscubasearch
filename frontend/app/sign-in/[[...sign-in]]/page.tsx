import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

export const runtime = 'edge'

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-6">
      {/* Teal gradient top-center */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(114,246,252,0.22)_0%,transparent_70%)]"
      />
      {/* Bottom-left accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[400px] bg-[radial-gradient(ellipse_80%_80%_at_0%_100%,rgba(114,246,252,0.12)_0%,transparent_70%)]"
      />

      <div className="relative flex w-full flex-col items-center">
        <Link
          href="/"
          className="font-display mb-8 text-2xl font-bold text-[#242843] tracking-tight hover:opacity-70 transition-opacity"
        >
          ScubaSearch
        </Link>

        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          appearance={{
            variables: {
              colorPrimary: '#4338ca',
              colorText: '#242843',
              colorTextSecondary: '#64748b',
              colorBackground: '#ffffff',
              colorInputBackground: '#ffffff',
              colorInputText: '#242843',
              borderRadius: '0.75rem',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.9rem',
            },
            elements: {
              card: 'shadow-none border border-slate-200 rounded-2xl p-8 w-full',
              headerTitle: 'text-xl font-bold text-[#242843]',
              headerSubtitle: 'text-[#64748b]',
              socialButtonsBlockButton: 'border border-slate-200 bg-white text-[#242843] hover:bg-slate-50 rounded-xl font-medium',
              dividerLine: 'bg-slate-100',
              dividerText: 'text-[#94a3b8] text-xs',
              formFieldLabel: 'text-sm font-medium text-[#242843]',
              formFieldInput: 'rounded-xl border-slate-200 bg-white text-[#242843] focus:border-[#4338ca] focus:ring-[#4338ca]/20',
              formButtonPrimary: 'bg-[#4338ca] hover:bg-[#3730a3] rounded-xl text-sm font-semibold',
              footerActionLink: 'text-[#4338ca] hover:text-[#3730a3] font-medium',
              footerActionText: 'text-[#64748b]',
              identityPreviewText: 'text-[#242843]',
              identityPreviewEditButton: 'text-[#4338ca]',
              formResendCodeLink: 'text-[#4338ca]',
              alertText: 'text-sm',
              internal: 'hidden',
            },
          }}
        />
      </div>
    </div>
  )
}
