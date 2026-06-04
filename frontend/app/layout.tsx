import type { Metadata } from 'next'
import { Inter, Merriweather } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const merriweather = Merriweather({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '700', '900'],
})

export const metadata: Metadata = {
  title: { default: 'ScubaSearch - AI-Powered Search for OTT Platforms', template: '%s | ScubaSearch' },
  description: 'AI-powered hybrid search for OTT and content streaming platforms. Upload your catalog, paste one script tag, and get semantic + keyword search in 30 minutes.',
  metadataBase: new URL('https://scubasearch.io'),
  openGraph: {
    type: 'website',
    siteName: 'ScubaSearch',
    title: 'ScubaSearch - AI-Powered Search for OTT Platforms',
    description: 'AI-powered hybrid search for OTT and content streaming platforms. Upload your catalog, paste one script tag, and get semantic + keyword search in 30 minutes.',
    url: 'https://scubasearch.io',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ScubaSearch - AI-Powered Search for OTT Platforms',
    description: 'AI-powered hybrid search for OTT and content streaming platforms. Upload your catalog, paste one script tag, and get semantic + keyword search in 30 minutes.',
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${merriweather.variable} font-sans antialiased bg-white text-zinc-900`}>
        {children}
      </body>
    </html>
  )
}
