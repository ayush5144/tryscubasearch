import type { MetadataRoute } from 'next'

const BASE = 'https://scubasearch.io'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, priority: 1.0, changeFrequency: 'weekly' },
    { url: `${BASE}/how-billing-works`, priority: 0.6, changeFrequency: 'monthly' },
    { url: `${BASE}/contact`, priority: 0.7, changeFrequency: 'monthly' },
    { url: `${BASE}/terms`, priority: 0.5, changeFrequency: 'monthly' },
    { url: `${BASE}/cancellation-policy`, priority: 0.5, changeFrequency: 'monthly' },
    { url: `${BASE}/cashfree-problems`, priority: 0.5, changeFrequency: 'monthly' },
    { url: `${BASE}/privacy`, priority: 0.5, changeFrequency: 'monthly' },
  ]
}
