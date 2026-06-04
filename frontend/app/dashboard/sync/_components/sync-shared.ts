import type { CatalogStats, ColumnInfo } from '@/lib/api-client'

export const SCUBA_FIELDS = [
  { key: 'title', label: 'Title', required: true },
  { key: 'description', label: 'Description', required: false },
  { key: 'category', label: 'Genre', required: false },
  { key: 'tags', label: 'Tags', required: false },
  { key: 'actors', label: 'Actors / Cast', required: false },
  { key: 'director', label: 'Director', required: false },
  { key: 'writer', label: 'Writer', required: false },
  { key: 'content_type', label: 'Content Type', required: false },
  { key: 'year', label: 'Release Year', required: false },
  { key: 'language', label: 'Language', required: false },
  { key: 'duration_mins', label: 'Duration (minutes)', required: false },
  { key: 'image_url', label: 'Thumbnail URL', required: false },
  { key: 'product_url', label: 'Content URL', required: false },
  { key: 'external_id', label: 'External ID', required: false },
] as const

export function buildPushSample(mode: string): string {
  return JSON.stringify(
    {
      documents: [
        {
          id: 'cms_1001',
          title: 'Signal Ridge',
          description: 'A rescue crew chases a fading transmission across frozen cliffs.',
          category: 'Thriller',
          tags: ['rescue', 'mountain'],
          actors: ['Asha Bell', 'Rohan Seth'],
          director: 'Tia Noor',
          writer: 'Tia Noor',
          content_type: 'movie',
          year: 2026,
          language: 'English',
          product_url: 'https://platform.example/titles/signal-ridge',
        },
      ],
      mode,
    },
    null,
    2,
  )
}

// Used to detect whether textarea still holds an unedited default
export const DEFAULT_PUSH_SAMPLES = new Set(['replace', 'append', 'update'].map(buildPushSample))

export const PUSH_SAMPLE = buildPushSample('append')

export const WEBHOOK_SAMPLE = JSON.stringify(
  {
    event: 'content.published',
    mode: 'update',
    document: {
      id: 'cms_1001',
      description: 'A rescue crew chases a fading transmission after a new avalanche warning.',
      actors: ['Asha Bell', 'Rohan Seth', 'Nila Verma'],
    },
  },
  null,
  2,
)

export function buildOptions(columns: ColumnInfo[]): { value: string; label: string }[] {
  return columns.map((column) => ({
    value: column.name,
    label: `${column.name} (${column.type})`,
  }))
}

export function formatJobSummary(job: CatalogStats['last_job']) {
  if (!job || job.status !== 'done') return null
  return [
    job.added_count ? `${job.added_count.toLocaleString()} added` : null,
    job.updated_count ? `${job.updated_count.toLocaleString()} updated` : null,
    job.skipped_count ? `${job.skipped_count.toLocaleString()} unchanged` : null,
  ]
    .filter(Boolean)
    .join(' - ')
}

export function parseJsonObject(input: string): Record<string, string> {
  if (!input.trim()) return {}
  const parsed = JSON.parse(input)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object.')
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  )
}
