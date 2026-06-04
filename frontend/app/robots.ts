import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/onboarding/', '/admin2026/', '/sign-in/', '/sign-up/'],
      },
    ],
    sitemap: 'https://scubasearch.io/sitemap.xml',
  }
}
