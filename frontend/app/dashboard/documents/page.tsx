'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table'
import { ChevronDown, ChevronUp, MoreHorizontal, AlertTriangle, CheckCircle2, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  uploadCsv,
  getIngestJob,
  getCatalog,
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
  reindexProducts,
  type IngestJobStatus,
  type CatalogStats,
  type ProductUpsertRequest,
  type ProductFormData,
  type Product,
  type ProductsResponse,
  type ProductUpdate,
  ApiError,
} from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Upload UI types + constants (preserved from previous page)
// ---------------------------------------------------------------------------

type UploadState = 'idle' | 'uploading' | 'polling' | 'done' | 'failed'
type UploadMode = 'replace' | 'append' | 'update'
type UploadPreview = {
  columns: string[]
  sampleRow: Record<string, string>
}

const OTT_IMPORT_FIELDS = [
  { key: 'title', label: 'Title', required: true, help: 'Required for every upload.' },
  { key: 'id', label: 'ID', required: false, help: 'Needed for append and update.' },
  { key: 'description', label: 'Description', required: false, help: 'Synopsis or overview text.' },
  { key: 'category', label: 'Genre', required: false, help: 'Primary genre or category.' },
  { key: 'tags', label: 'Tags', required: false, help: 'Comma-separated tags or keywords.' },
  { key: 'actors', label: 'Actors / Cast', required: false, help: 'Lead cast or starring talent.' },
  { key: 'director', label: 'Director', required: false, help: 'Director name.' },
  { key: 'writer', label: 'Writer', required: false, help: 'Writer or screenplay credit.' },
  { key: 'content_type', label: 'Content Type', required: false, help: 'Movie, series, documentary, short, and so on.' },
  { key: 'year', label: 'Release Year', required: false, help: 'Numeric year only.' },
  { key: 'language', label: 'Language', required: false, help: 'Primary language.' },
  { key: 'duration_mins', label: 'Duration (minutes)', required: false, help: 'Runtime in minutes.' },
  { key: 'image_url', label: 'Image URL', required: false, help: 'Poster or thumbnail URL.' },
  { key: 'product_url', label: 'Content URL', required: false, help: 'Watch page or content URL.' },
] as const

const IMPORT_MAPPING_STORAGE_KEY = 'scubasearch:ott-import-mapping'

const IMPORT_FIELD_ALIASES: Record<string, string[]> = {
  title: ['title', 'name'],
  id: ['id', 'content_id', 'show_id', 'movie_id', 'product_id', 'handle', 'sku', 'variant_id', 'product-id'],
  description: ['description', 'overview', 'plot', 'synopsis', 'body (html)'],
  category: ['category', 'genre', 'genres'],
  tags: ['tags'],
  actors: ['actors', 'cast', 'starring', 'stars'],
  director: ['director', 'directed by'],
  writer: ['writer', 'screenplay', 'written by'],
  content_type: ['content_type', 'type', 'show_type', 'media_type'],
  year: ['year', 'release_year', 'release year', 'released'],
  language: ['language', 'lang'],
  duration_mins: ['duration_mins', 'duration', 'runtime', 'runtime_mins'],
  image_url: ['image_url', 'poster', 'thumbnail', 'thumbnail_url', 'poster_url'],
  product_url: ['product_url', 'content_url', 'stream_url', 'watch_url'],
}

const MODES: {
  value: UploadMode
  label: string
  description: string
  detail: string
  requiresId: boolean
  destructive: boolean
}[] = [
  {
    value: 'replace',
    label: 'Replace catalog',
    description: 'Delete everything and re-index from scratch.',
    detail: 'Builds a new index in the background, embeds every document, then swaps atomically - zero downtime. Documents not in this file are permanently removed. Use for first upload or a full catalog refresh.',
    requiresId: false,
    destructive: true,
  },
  {
    value: 'append',
    label: 'Sync / add documents',
    description: 'Add new documents and update existing ones. Untouched documents stay.',
    detail: 'Upserts by ID - new IDs are added, existing IDs are fully overwritten with the uploaded data. Re-embeds every document in the file. Documents already in your catalog but not in this file are left untouched.',
    requiresId: true,
    destructive: false,
  },
  {
    value: 'update',
    label: 'Update fields only',
    description: 'Change metadata fields without re-embedding.',
    detail: 'Partial update - only fields present in your file are changed. Cast, crew, type, year, language, thumbnail, and content URL can update without touching vectors. Use for catalog metadata corrections.',
    requiresId: true,
    destructive: false,
  },
]

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'secondary',
  processing: 'default',
  done: 'outline',
  failed: 'destructive',
}

function normalizeImportKey(value: string): string {
  return value.trim().toLowerCase()
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells.map((cell) => cell.replace(/^"(.*)"$/, '$1').trim())
}

function formatPreviewValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (value === null || value === undefined) return ''
  return String(value)
}

async function inspectUploadFile(file: File): Promise<UploadPreview> {
  const text = await file.text()
  const format = detectUploadFormat(file)
  if (!format) {
    throw new Error('Please select a .csv, .json, or .ndjson file.')
  }

  if (format === 'csv') {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (!lines.length) return { columns: [], sampleRow: {} }

    const headers = parseCsvLine(lines[0])
    const sampleValues = lines[1] ? parseCsvLine(lines[1]) : []
    const sampleRow = Object.fromEntries(
      headers.map((header, index) => [header, sampleValues[index] ?? '']),
    )
    return { columns: headers, sampleRow }
  }

  if (format === 'json') {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      throw new Error('JSON uploads must contain a top-level array of objects.')
    }
    const first = parsed.find((item) => item && typeof item === 'object' && !Array.isArray(item))
    if (!first) return { columns: [], sampleRow: {} }
    const sampleRow = Object.fromEntries(
      Object.entries(first as Record<string, unknown>).map(([key, value]) => [key, formatPreviewValue(value)]),
    )
    return { columns: Object.keys(sampleRow), sampleRow }
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) return { columns: [], sampleRow: {} }
  const parsed = JSON.parse(firstLine)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('NDJSON uploads must contain one JSON object per line.')
  }
  const sampleRow = Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, formatPreviewValue(value)]),
  )
  return { columns: Object.keys(sampleRow), sampleRow }
}

function buildAutoFieldMapping(columns: string[]): Record<string, string> {
  const byNormalized = new Map(columns.map((column) => [normalizeImportKey(column), column]))
  const mapping: Record<string, string> = {}

  for (const field of OTT_IMPORT_FIELDS) {
    const candidates = IMPORT_FIELD_ALIASES[field.key] ?? [field.key]
    const match = candidates
      .map((candidate) => byNormalized.get(normalizeImportKey(candidate)))
      .find(Boolean)
    if (match) {
      mapping[field.key] = match
    }
  }

  return mapping
}

function invertFieldMapping(mapping: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping)
      .filter(([, source]) => source)
      .map(([target, source]) => [source, target]),
  )
}

function summarizeFieldMapping(mapping: Record<string, string>): string {
  return OTT_IMPORT_FIELDS
    .map((field) => {
      const source = mapping[field.key]
      if (!source) return null
      return `${source} -> ${field.key}`
    })
    .filter(Boolean)
    .join(', ')
}

function detectUploadFormat(file: File | null): 'csv' | 'json' | 'ndjson' | null {
  if (!file) return null
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.ndjson')) return 'ndjson'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv')) return 'csv'
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStale(product: Product): boolean {
  if (!product.last_indexed_at) return true
  return new Date(product.last_indexed_at) < new Date(product.updated_at)
}

function countStale(products: Product[]): number {
  return products.filter(isStale).length
}

// ---------------------------------------------------------------------------
// Expandable read-only span (click to toggle truncate)
// ---------------------------------------------------------------------------

function ExpandSpan({ text, className = 'text-sm text-[#242843]' }: { text: string | null | undefined; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <span
      onClick={() => setExpanded((v) => !v)}
      className={`block cursor-pointer px-1 py-0.5 ${expanded ? 'whitespace-normal break-words' : 'truncate'} ${className}`}
    >
      {text || <span className="text-zinc-300 italic">-</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Inline text cell
// ---------------------------------------------------------------------------

interface InlineCellProps {
  value: string | null | undefined
  placeholder?: string
  type?: 'text' | 'number'
  readonly?: boolean
  onSave: (val: string) => Promise<void>
}

function InlineCell({ value, placeholder = '-', type = 'text', readonly = false, onSave }: InlineCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    if (draft === (value ?? '')) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(draft)
    } catch {
      setDraft(value ?? '')
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(value ?? '')
            setEditing(false)
          }
        }}
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-[#242843] focus:outline-none focus:ring-2 focus:ring-zinc-400"
      />
    )
  }

  if (readonly) {
    return <ExpandSpan text={value} />
  }

  return (
    <span
      onClick={() => {
        setDraft(value ?? '')
        setEditing(true)
      }}
      title={value ?? ''}
      className="block cursor-pointer truncate rounded px-1 py-0.5 text-sm text-[#242843] ring-1 ring-transparent hover:ring-zinc-200 hover:bg-zinc-50 transition-colors"
    >
      {value ? value : <span className="text-zinc-300 italic">{placeholder}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Description / URL popover cell
// ---------------------------------------------------------------------------

interface DescPopoverProps {
  product: Product
  readonly?: boolean
  onSave: (update: ProductUpdate) => Promise<void>
}

function DescPopover({ product, readonly = false, onSave }: DescPopoverProps) {
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState(product.description ?? '')
  const [imageUrl, setImageUrl] = useState(product.image_url ?? '')
  const [productUrl, setProductUrl] = useState(product.product_url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDesc(product.description ?? '')
      setImageUrl(product.image_url ?? '')
      setProductUrl(product.product_url ?? '')
      setError(null)
    }
  }, [open, product])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        description: desc || undefined,
        image_url: imageUrl || undefined,
        product_url: productUrl || undefined,
      })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (readonly) {
    return <ExpandSpan text={product.description} className="text-sm text-[#64748b]" />
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title="Click to edit description, thumbnail URL, content URL"
        className="block w-full text-left truncate rounded px-1 py-0.5 text-sm text-[#64748b] ring-1 ring-transparent hover:ring-zinc-200 hover:bg-zinc-50 transition-colors cursor-pointer"
      >
        {product.description ? product.description.slice(0, 60) + (product.description.length > 60 ? '…' : '') : <span className="text-zinc-300 italic">-</span>}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 space-y-3" align="start">
        <div>
          <label className="block text-xs font-medium text-[#64748b] mb-1">Description</label>
          <Textarea
            rows={4}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Product description"
            className="text-sm resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748b] mb-1">Thumbnail URL</label>
          <Input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
            className="text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748b] mb-1">Content URL</label>
          <Input
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://..."
            className="text-sm"
          />
        </div>
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1">{error}</div>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Sync status badge
// ---------------------------------------------------------------------------

function SyncBadge({ product, onReindex }: { product: Product; onReindex: () => void }) {
  if (!product.last_indexed_at) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[#94a3b8]">
        <Minus className="h-3 w-3" /> Never
      </span>
    )
  }
  if (isStale(product)) {
    return (
      <button
        type="button"
        onClick={onReindex}
        title="Stale - click to reindex"
        className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Stale
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-600">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Synced
    </span>
  )
}

// ---------------------------------------------------------------------------
// Delete confirm dialog
// ---------------------------------------------------------------------------

interface DeleteDialogProps {
  productTitle: string | null
  onConfirm: () => void
  onCancel: () => void
}

function DeleteDialog({ productTitle, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <AlertDialog open onOpenChange={(v) => { if (!v) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete document?</AlertDialogTitle>
          <AlertDialogDescription>
            {productTitle
              ? `"${productTitle}" will be permanently deleted from your catalog and search index.`
              : 'This document will be permanently deleted from your catalog and search index.'}
            {' '}This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const LIMIT = 50
const columnHelper = createColumnHelper<Product>()

export default function DocumentsPage() {
  const { getToken } = useAuth()

  // ------- upload panel state (preserved) -------
  const [importOpen, setImportOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogStats | null>(null)
  const [mode, setMode] = useState<UploadMode | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [csvHasId, setCsvHasId] = useState<boolean | null>(null)
  const [sourceFields, setSourceFields] = useState<string[]>([])
  const [sourceSampleRow, setSourceSampleRow] = useState<Record<string, string>>({})
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({})
  const [savedFieldMapping, setSavedFieldMapping] = useState<Record<string, string>>({})
  const [showReplaceWarning, setShowReplaceWarning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<IngestJobStatus | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ------- add product dialog state -------
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [addProductForm, setAddProductForm] = useState<ProductFormData>({
    title: '',
    description: '',
    category: '',
    tags: '',
    image_url: '',
    product_url: '',
    actors: '',
    director: '',
    writer: '',
    content_type: '',
    year: '',
    language: '',
  })
  const [addProductSubmitting, setAddProductSubmitting] = useState(false)
  const [addProductError, setAddProductError] = useState<string | null>(null)
  const [addProductSuccess, setAddProductSuccess] = useState(false)

  // ------- table modal state -------
  const [showProductsTable, setShowProductsTable] = useState(false)

  // ------- table state -------
  const [productsData, setProductsData] = useState<ProductsResponse | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [reindexJobId, setReindexJobId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // ------- filter state -------
  const [filterCategory, setFilterCategory] = useState('')
  const [debouncedCategory, setDebouncedCategory] = useState('')
  const categoryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterStale, setFilterStale] = useState(false)

  // ------- load catalog summary -------
  async function loadCatalog() {
    try {
      const token = await getToken()
      if (!token) return
      setCatalog(await getCatalog(token))
    } catch {
      // non-fatal
    }
  }

  // ------- load products table -------
  const loadProducts = useCallback(async (
    p: number,
    q: string,
    cat: string,
    stale: boolean,
  ) => {
    setTableLoading(true)
    setTableError(null)
    try {
      const token = await getToken()
      if (!token) return
      const data = await getProducts(token, {
        page: p,
        limit: LIMIT,
        q: q || undefined,
        category: cat || undefined,
        stale_only: stale || undefined,
      })
      setProductsData(data)
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Failed to load documents.')
    } finally {
      setTableLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    loadCatalog()
  }, [getToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(IMPORT_MAPPING_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        setSavedFieldMapping(parsed as Record<string, string>)
      }
    } catch {
      // ignore malformed local mapping
    }
  }, [])

  useEffect(() => {
    loadProducts(page, debouncedQ, debouncedCategory, filterStale)
  }, [page, debouncedQ, debouncedCategory, filterStale, loadProducts])

  // Debounce search input
  function handleSearchChange(val: string) {
    setSearchQ(val)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setPage(1)
      setDebouncedQ(val)
    }, 300)
  }

  function handleCategoryChange(val: string) {
    setFilterCategory(val)
    if (categoryDebounceRef.current) clearTimeout(categoryDebounceRef.current)
    categoryDebounceRef.current = setTimeout(() => {
      setPage(1)
      setDebouncedCategory(val)
    }, 300)
  }

  function handleStaleChange(val: boolean) {
    setFilterStale(val)
    setPage(1)
  }

  // ------- toast helper -------
  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  // ------- mutation helpers -------
  async function handleUpdate(productId: string, update: ProductUpdate) {
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')
    const updated = await updateProduct(token, productId, update)
    setProductsData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? updated : p)),
      }
    })
  }

  async function handleDelete(product: Product) {
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      await deleteProduct(token, product.id)
      setProductsData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          total: prev.total - 1,
          products: prev.products.filter((p) => p.id !== product.id),
        }
      })
      loadCatalog()
      showToast(`"${product.title}" deleted.`)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Delete failed.')
    } finally {
      setDeleteTarget(null)
    }
  }

  async function handleReindex() {
    setReindexing(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const result = await reindexProducts(token)
      if (result.job_id) {
        setReindexJobId(result.job_id)
        showToast(`Reindex started - ${result.stale_count} documents queued.`)
      } else {
        showToast('Nothing to reindex - all documents are up to date.')
      }
      // Refresh table after a moment so stale counts update
      setTimeout(() => loadProducts(page, debouncedQ, debouncedCategory, filterStale), 2000)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Reindex failed.')
    } finally {
      setReindexing(false)
    }
  }

  // ------- view / edit mode -------
  const [editMode, setEditMode] = useState(false)

  // ------- stale count -------
  const staleCount = productsData ? countStale(productsData.products) : 0

  // ------- upload logic (preserved) -------
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (id: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const token = await getToken()
          if (!token) return
          const status = await getIngestJob(token, id)
          setJobStatus(status)

          if (status.status === 'done') {
            setUploadState('done')
            stopPolling()
            loadCatalog()
            loadProducts(1, debouncedQ, debouncedCategory, filterStale)
            setPage(1)
          } else if (status.status === 'failed') {
            setUploadState('failed')
            setUploadError(status.error_log ?? 'Ingest job failed.')
            stopPolling()
          }
        } catch (err) {
          stopPolling()
          setUploadState('failed')
          setUploadError(err instanceof ApiError ? err.message : 'Polling failed.')
        }
      }, 3000)
    },
    [getToken, stopPolling, debouncedQ], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => () => stopPolling(), [stopPolling])

  async function handleFileSelect(selected: File | null) {
    if (!selected) return
    const ext = selected.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'json' && ext !== 'ndjson') {
      setUploadError('Please select a .csv, .json, or .ndjson file.')
      return
    }
    setFile(selected)
    setUploadError(null)
    setCsvHasId(null)
    try {
      const preview = await inspectUploadFile(selected)
      const availableFields = preview.columns
      const remembered = Object.fromEntries(
        Object.entries(savedFieldMapping).filter(([, source]) => availableFields.includes(source)),
      )
      const nextMapping = {
        ...buildAutoFieldMapping(availableFields),
        ...remembered,
      }
      setSourceFields(availableFields)
      setSourceSampleRow(preview.sampleRow)
      setFieldMapping(nextMapping)
      setCsvHasId(Boolean(nextMapping.id))
    } catch (err) {
      setSourceFields([])
      setSourceSampleRow({})
      setFieldMapping({})
      setUploadError(err instanceof Error ? err.message : 'Could not read the selected file.')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0] ?? null
    handleFileSelect(dropped)
  }

  function getEffectiveMode(): UploadMode {
    if (showAdvanced && mode) return mode
    const selectedFormat = detectUploadFormat(file)
    const sameFormatSmartSync =
      hasExistingProducts &&
      catalog?.active_source === 'csv' &&
      !!selectedFormat &&
      catalog?.active_file_format === selectedFormat

    if (csvHasId === true && sameFormatSmartSync) return 'append'
    return 'replace'
  }

  async function startUpload(overrideMode?: UploadMode) {
    if (!file) return
    setUploadError(null)
    setUploadState('uploading')

    const uploadMode = overrideMode ?? getEffectiveMode()
    if (!fieldMapping.title) {
      setUploadState('failed')
      setUploadError('Map a source field to Title before you upload.')
      return
    }
    if (uploadMode !== 'replace' && !fieldMapping.id) {
      setUploadState('failed')
      setUploadError('Append and update need an ID mapping so we can match existing documents.')
      return
    }
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const backendFieldMapping = invertFieldMapping(fieldMapping)
      const response = await uploadCsv(token, file, uploadMode, backendFieldMapping)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(IMPORT_MAPPING_STORAGE_KEY, JSON.stringify(fieldMapping))
      }
      setSavedFieldMapping(fieldMapping)
      setJobId(response.job_id)
      setUploadState('polling')
      startPolling(response.job_id)
    } catch (err) {
      setUploadState('failed')
      setUploadError(err instanceof ApiError ? err.message : 'Upload failed. Please retry.')
    }
  }

  function handleUpload() {
    if (!file) return
    if (showAdvanced) {
      if (!mode) return  // no mode selected yet
      startUpload(mode)
      return
    }
    const hasExisting = (catalog?.product_count ?? 0) > 0
    if (hasExisting && csvHasId === false) {
      setShowReplaceWarning(true)
      return
    }
    startUpload()
  }

  function handleReset() {
    stopPolling()
    setFile(null)
    setCsvHasId(null)
    setSourceFields([])
    setSourceSampleRow({})
    setFieldMapping({})
    setJobId(null)
    setJobStatus(null)
    setUploadState('idle')
    setUploadError(null)
  }

  // ------- add product dialog -------
  function openAddProduct() {
    setAddProductForm({
      title: '',
      description: '',
      category: '',
      tags: '',
      image_url: '',
      product_url: '',
      actors: '',
      director: '',
      writer: '',
      content_type: '',
      year: '',
      language: '',
    })
    setAddProductError(null)
    setAddProductSuccess(false)
    setShowAddProduct(true)
  }

  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault()
    setAddProductError(null)
    setAddProductSubmitting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const payload: ProductUpsertRequest = { title: addProductForm.title!.trim() }
      if (addProductForm.description?.trim()) payload.description = addProductForm.description.trim()
      if (addProductForm.category?.trim()) payload.category = addProductForm.category.trim()
      if (addProductForm.tags?.trim()) payload.tags = addProductForm.tags.trim()
      if (addProductForm.image_url?.trim()) payload.image_url = addProductForm.image_url.trim()
      if (addProductForm.product_url?.trim()) payload.product_url = addProductForm.product_url.trim()
      // OTT fields
      if (addProductForm.actors?.trim()) payload.actors = addProductForm.actors.trim()
      if (addProductForm.director?.trim()) payload.director = addProductForm.director.trim()
      if (addProductForm.writer?.trim()) payload.writer = addProductForm.writer.trim()
      if (addProductForm.content_type?.trim()) payload.content_type = addProductForm.content_type.trim()
      if (addProductForm.language?.trim()) payload.language = addProductForm.language.trim()
      if (addProductForm.year?.trim()) {
        const yr = parseInt(addProductForm.year, 10)
        if (!isNaN(yr)) payload.year = yr
      }
      await addProduct(token, payload)
      setAddProductSuccess(true)
      loadCatalog()
      loadProducts(page, debouncedQ, debouncedCategory, filterStale)
      setTimeout(() => {
        setShowAddProduct(false)
        setAddProductSuccess(false)
      }, 1200)
    } catch (err) {
      setAddProductError(err instanceof ApiError ? err.message : 'Failed to add document.')
    } finally {
      setAddProductSubmitting(false)
    }
  }

  // ------- TanStack columns -------
  const columns: ColumnDef<Product, string>[] = [
    // Thumbnail
    columnHelper.display({
      id: 'thumbnail',
      header: '',
      size: 56,
      cell: ({ row }) => {
        const p = row.original
        return p.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt={p.title} className="h-10 w-10 rounded object-cover bg-zinc-100" />
        ) : (
          <div className="h-10 w-10 rounded bg-zinc-100 flex items-center justify-center text-zinc-300 text-xs">img</div>
        )
      },
    }) as ColumnDef<Product, string>,

    // External ID (read-only always)
    columnHelper.accessor((row) => row.external_id ?? '', {
      id: 'external_id',
      header: 'ID',
      size: 110,
      cell: ({ row }) => (
        <ExpandSpan text={row.original.external_id} className="text-xs text-[#94a3b8] font-mono" />
      ),
    }) as ColumnDef<Product, string>,

    // Title
    columnHelper.accessor('title', {
      header: 'Title',
      cell: ({ row }) => (
        <InlineCell
          value={row.original.title}
          placeholder="Title"
          readonly={!editMode}
          onSave={(val) => handleUpdate(row.original.id, { title: val })}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Genre (category)
    columnHelper.accessor('category', {
      header: 'Genre',
      size: 120,
      cell: ({ row }) => (
        <InlineCell
          value={row.original.category}
          placeholder="-"
          readonly={!editMode}
          onSave={(val) => handleUpdate(row.original.id, { category: val })}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Tags
    columnHelper.accessor('tags', {
      header: 'Tags',
      cell: ({ row }) => (
        <InlineCell
          value={row.original.tags}
          placeholder="-"
          readonly={!editMode}
          onSave={(val) => handleUpdate(row.original.id, { tags: val })}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Actors
    columnHelper.accessor((row) => (row as Product & { actors?: string }).actors ?? '', {
      id: 'actors',
      header: 'Actors',
      cell: ({ row }) => (
        <InlineCell
          value={(row.original as Product & { actors?: string }).actors ?? null}
          placeholder="-"
          readonly={!editMode}
          onSave={(val) => handleUpdate(row.original.id, { actors: val || undefined })}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Director
    columnHelper.accessor((row) => (row as Product & { director?: string }).director ?? '', {
      id: 'director',
      header: 'Director',
      size: 130,
      cell: ({ row }) => (
        <InlineCell
          value={(row.original as Product & { director?: string }).director ?? null}
          placeholder="-"
          readonly={!editMode}
          onSave={(val) => handleUpdate(row.original.id, { director: val || undefined })}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Content Type
    columnHelper.accessor((row) => (row as Product & { content_type?: string }).content_type ?? '', {
      id: 'content_type',
      header: 'Type',
      size: 80,
      cell: ({ row }) => (
        <InlineCell
          value={(row.original as Product & { content_type?: string }).content_type ?? null}
          placeholder="-"
          readonly={!editMode}
          onSave={(val) => handleUpdate(row.original.id, { content_type: val || undefined })}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Year
    columnHelper.accessor((row) => (row as Product & { year?: number }).year != null ? String((row as Product & { year?: number }).year) : '', {
      id: 'year',
      header: 'Year',
      size: 68,
      cell: ({ row }) => (
        <InlineCell
          value={(row.original as Product & { year?: number }).year != null ? String((row.original as Product & { year?: number }).year) : null}
          placeholder="-"
          type="number"
          readonly={!editMode}
          onSave={async (val) => {
            if (val === '') { await handleUpdate(row.original.id, { year: undefined }); return }
            const parsed = parseInt(val, 10)
            if (isNaN(parsed)) { showToast('Year must be a number'); return }
            await handleUpdate(row.original.id, { year: parsed })
          }}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Language
    columnHelper.accessor((row) => (row as Product & { language?: string }).language ?? '', {
      id: 'language',
      header: 'Language',
      size: 90,
      cell: ({ row }) => (
        <InlineCell
          value={(row.original as Product & { language?: string }).language ?? null}
          placeholder="-"
          readonly={!editMode}
          onSave={(val) => handleUpdate(row.original.id, { language: val || undefined })}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Thumbnail URL
    columnHelper.accessor('image_url', {
      header: 'Thumbnail URL',
      size: 160,
      cell: ({ row }) => {
        const url = row.original.image_url
        if (!editMode) {
          return <ExpandSpan text={url} className="text-xs text-[#64748b]" />
        }
        return (
          <InlineCell
            value={url}
            placeholder="https://..."
            readonly={false}
            onSave={(val) => handleUpdate(row.original.id, { image_url: val || undefined })}
          />
        )
      },
    }) as ColumnDef<Product, string>,

    // Description / URL popover
    columnHelper.display({
      id: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <DescPopover
          product={row.original}
          readonly={!editMode}
          onSave={(update) => handleUpdate(row.original.id, update)}
        />
      ),
    }) as ColumnDef<Product, string>,

    // Sync status
    columnHelper.display({
      id: 'sync',
      header: 'Sync',
      size: 80,
      cell: ({ row }) => (
        <SyncBadge product={row.original} onReindex={handleReindex} />
      ),
    }) as ColumnDef<Product, string>,

    // Actions - only in edit mode
    ...(editMode ? [
      columnHelper.display({
        id: 'actions',
        header: '',
        size: 48,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#64748b] hover:bg-zinc-100 hover:text-[#242843] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={() => setDeleteTarget(row.original)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      }) as ColumnDef<Product, string>,
    ] : []),
  ]

  const table = useReactTable({
    data: productsData?.products ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: productsData?.pages ?? 1,
  })

  const progressPercent =
    jobStatus && jobStatus.total > 0
      ? Math.round((jobStatus.processed / jobStatus.total) * 100)
      : 0

  const hasExistingProducts = (catalog?.product_count ?? 0) > 0
  const selectedFormat = detectUploadFormat(file)
  const formatChanged =
    hasExistingProducts &&
    catalog?.active_source === 'csv' &&
    !!selectedFormat &&
    !!catalog?.active_file_format &&
    catalog.active_file_format !== selectedFormat
  const savedMappingSummary = summarizeFieldMapping(savedFieldMapping)
  const lastJobSummary = catalog?.last_job?.status === 'done'
    ? [
        catalog.last_job.added_count ? `${catalog.last_job.added_count.toLocaleString()} added` : null,
        catalog.last_job.updated_count ? `${catalog.last_job.updated_count.toLocaleString()} updated` : null,
        catalog.last_job.skipped_count ? `${catalog.last_job.skipped_count.toLocaleString()} unchanged` : null,
      ].filter(Boolean).join(' · ')
    : ''

  function handleFieldMappingChange(fieldKey: string, sourceValue: string) {
    setFieldMapping((prev) => {
      const next = { ...prev }
      if (sourceValue) {
        for (const [existingField, existingSource] of Object.entries(next)) {
          if (existingField !== fieldKey && existingSource === sourceValue) {
            delete next[existingField]
          }
        }
        next[fieldKey] = sourceValue
      } else {
        delete next[fieldKey]
      }
      setCsvHasId(Boolean(next.id))
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-[#242843]">Documents</h1>
        <p className="mt-1 text-sm text-[#64748b]">
          View and edit your content catalog. Upload a file to bulk import.
        </p>
        {catalog && (
          <div className="mt-3 inline-flex items-center gap-5 rounded-lg border border-zinc-200 bg-white px-5 py-3">
            <div>
              <div className="text-2xl font-semibold text-[#242843] leading-none">
                {catalog.product_count.toLocaleString()}
              </div>
              <div className="text-xs text-[#64748b] mt-0.5">documents indexed</div>
            </div>
            <div className="h-8 w-px bg-zinc-200" />
            <div>
              <div className="text-xs font-medium text-[#64748b]">Source</div>
              <div className="mt-0.5 text-xs text-[#242843]">
                {catalog.active_source_label}
              </div>
            </div>
            {catalog.last_job && (
              <>
                <div className="h-8 w-px bg-zinc-200" />
                <div>
                  <div className="text-xs font-medium text-[#64748b]">Last upload</div>
                  <div className="mt-0.5 text-xs text-[#64748b]">
                    {new Date(catalog.last_job.created_at).toLocaleString('en-GB', {
                      day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                    })}{' '}·{' '}
                    <span className={
                      catalog.last_job.status === 'done' ? 'text-green-600'
                      : catalog.last_job.status === 'failed' ? 'text-red-600'
                      : 'text-[#64748b]'
                    }>
                      {catalog.last_job.status}
                    </span>
                    {lastJobSummary && (
                      <span className="text-[#94a3b8]">
                        {' '}· {lastJobSummary}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* CSV format reference */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-[#64748b]">
        <div className="font-medium text-[#242843] mb-1">Recommended CSV format</div>
        <p className="mb-2">Standard format for importing OTT content into ScubaSearch.</p>
        <div className="flex flex-col gap-1">
          <div><span className="font-medium text-[#242843]">Required</span> &nbsp; title</div>
          <div><span className="font-medium text-[#242843]">Optional</span> &nbsp; id, description, category, tags, thumbnail_url (-&gt; image_url), content_url (-&gt; product_url), actors, director, writer, content_type, year, language, duration_mins</div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Import panel (collapsible) */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-zinc-200 bg-white">
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[#242843] hover:bg-zinc-50 transition-colors rounded-lg"
        >
          <span>Update documents</span>
          {importOpen ? (
            <ChevronUp className="h-4 w-4 text-[#94a3b8]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#94a3b8]" />
          )}
        </button>

        {importOpen && (
          <div className="border-t border-zinc-100 px-4 pb-5 pt-4 space-y-4">
            {/* Drop zone */}
            {(uploadState === 'idle' || uploadState === 'uploading') && (
              <>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
                    dragOver
                      ? 'border-zinc-400 bg-zinc-50'
                      : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json,.ndjson"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <div className="text-center">
                      <div className="text-sm font-medium text-[#242843]">{file.name}</div>
                      <div className="mt-1 text-xs text-[#94a3b8]">
                        {(file.size / 1024).toFixed(1)} KB - click to change
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="text-sm font-medium text-[#242843]">
                        Drop your file here or click to browse
                      </div>
                      <div className="mt-1 text-xs text-[#94a3b8]">
                        Accepts .csv, .json, and .ndjson
                      </div>
                    </div>
                  )}
                </div>

                {file && sourceFields.length > 0 && (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-[#242843]">Map your upload fields</p>
                          <p className="text-xs text-[#64748b]">
                            Choose which source field should fill each ScubaSearch field. Title is required for every upload.
                          </p>
                        </div>
                        <div className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-[#64748b] border border-zinc-200">
                          {sourceFields.length} source field{sourceFields.length === 1 ? '' : 's'} detected
                        </div>
                      </div>
                      {savedMappingSummary && (
                        <div className="rounded-md border border-[#4338ca]/15 bg-white px-3 py-2 text-xs text-[#64748b]">
                          <span className="font-medium text-[#242843]">Last saved import mapping.</span>{' '}
                          We&apos;ll keep this import shape in mind: {savedMappingSummary}. If you&apos;re exporting from the same source again, keeping those column names will make uploads faster.
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {sourceFields.map((column) => (
                        <span
                          key={column}
                          className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-[#64748b]"
                        >
                          {column}
                        </span>
                      ))}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {OTT_IMPORT_FIELDS.map((field) => {
                        const selectedSource = fieldMapping[field.key] ?? ''
                        const sampleValue = selectedSource ? sourceSampleRow[selectedSource] : ''
                        return (
                          <div key={field.key} className="rounded-lg border border-zinc-200 bg-white p-3">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-[#242843]">{field.label}</div>
                              {field.required && (
                                <span className="rounded-full bg-[#4338ca]/8 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#4338ca]">
                                  Required
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-[#64748b]">{field.help}</p>
                            <select
                              value={selectedSource}
                              onChange={(e) => handleFieldMappingChange(field.key, e.target.value)}
                              className="mt-3 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-[#242843] focus:border-[#4338ca] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/15"
                            >
                              <option value="">Skip this field</option>
                              {sourceFields.map((column) => (
                                <option key={`${field.key}-${column}`} value={column}>
                                  {column}
                                </option>
                              ))}
                            </select>
                            {selectedSource && (
                              <div className="mt-2 text-xs text-[#94a3b8]">
                                Example: {sampleValue || 'No sample value on the first row'}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Smart sync / warning banners - hidden when user is in advanced mode */}
                {file && csvHasId !== null && !showAdvanced && (
                  <div>
                    {formatChanged && (
                      <div className="rounded-md border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Format changed from {catalog?.active_file_format?.toUpperCase()} to {selectedFormat?.toUpperCase()} - this upload will replace all{' '}
                        <span className="font-medium">{catalog?.product_count?.toLocaleString()}</span>{' '}
                        existing documents.
                      </div>
                    )}
                    {!formatChanged && hasExistingProducts && csvHasId === true && catalog?.active_source === 'csv' && catalog?.active_file_format === selectedFormat && (
                      <div className="rounded-md border border-[#4338ca]/15 bg-[#4338ca]/8 px-4 py-3 text-sm text-[#4338ca]">
                        Smart sync - new documents will be added, existing ones updated. Documents not in this file stay untouched.
                      </div>
                    )}
                    {!formatChanged && hasExistingProducts && csvHasId === false && (
                      <div className="rounded-md border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        No ID field mapped - uploading will replace all{' '}
                        <span className="font-medium">{catalog?.product_count?.toLocaleString()}</span>{' '}
                        existing documents.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {uploadError && (
              <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {uploadError}
              </div>
            )}

            {/* Upload button row */}
            {(uploadState === 'idle' || uploadState === 'uploading') && (
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleUpload}
                  disabled={!file || uploadState === 'uploading' || (showAdvanced && !mode)}
                  className="bg-[#4338ca] text-white hover:bg-[#3730a3]"
                >
                  {uploadState === 'uploading' ? 'Uploading...' : 'Upload'}
                </Button>
                {file && uploadState === 'idle' && (
                  <Button variant="ghost" size="sm" onClick={handleReset}>
                    Clear
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => { setShowAdvanced((v) => !v); setMode(null) }}
                  className="ml-auto text-xs text-[#94a3b8] underline underline-offset-2 hover:text-[#64748b]"
                >
                  {showAdvanced ? 'Hide advanced' : 'Advanced'}
                </button>
              </div>
            )}

            {/* Advanced mode selector */}
            {showAdvanced && (uploadState === 'idle' || uploadState === 'uploading') && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
                <p className="text-xs font-medium text-[#64748b] uppercase tracking-wide">
                  Manual mode override
                </p>
                <div className="space-y-2">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMode(m.value)}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                        mode === m.value
                          ? m.destructive ? 'border-red-300 bg-red-50' : 'border-[#4338ca] bg-white'
                          : 'border-zinc-200 bg-white hover:border-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${
                          mode === m.value
                            ? m.destructive ? 'text-red-700' : 'text-[#242843]'
                            : 'text-[#242843]'
                        }`}>
                          {m.label}
                        </span>
                        <div className="flex items-center gap-2">
                          {m.requiresId && (
                            <span className="text-xs text-[#94a3b8] bg-zinc-100 px-2 py-0.5 rounded-full">
                              requires id
                            </span>
                          )}
                          {m.destructive && (
                            <span className="text-xs text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                              destructive
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-[#64748b]">{m.description}</p>
                      {mode === m.value && (
                        <p className="mt-2 text-xs text-[#94a3b8] leading-relaxed border-t border-zinc-100 pt-2">
                          {m.detail}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Progress */}
            {(uploadState === 'polling' || uploadState === 'done' || uploadState === 'failed') && jobStatus && (
              <div className="rounded-lg border border-zinc-100 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-[#242843]">
                      Job {jobId?.slice(0, 8)}...
                    </div>
                    <div className="mt-1 text-xs text-[#94a3b8]">
                      {jobStatus.processed.toLocaleString()} / {jobStatus.total.toLocaleString()} documents
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANTS[jobStatus.status] ?? 'secondary'}>
                    {STATUS_LABELS[jobStatus.status] ?? jobStatus.status}
                  </Badge>
                </div>
                <div className="mt-4">
                  <Progress value={progressPercent} className="h-2" />
                  <div className="mt-1 text-right text-xs text-[#94a3b8]">{progressPercent}%</div>
                </div>
                {uploadState === 'done' && (
                  <div className="mt-3 text-sm text-[#64748b]">
                    {(jobStatus.added_count > 0 || jobStatus.updated_count > 0 || (jobStatus.skipped_count != null && jobStatus.skipped_count > 0)) ? (
                      <span>
                        {[
                          jobStatus.added_count > 0 ? `${jobStatus.added_count.toLocaleString()} added` : null,
                          jobStatus.updated_count > 0 ? `${jobStatus.updated_count.toLocaleString()} updated` : null,
                          jobStatus.skipped_count != null && jobStatus.skipped_count > 0 ? `${jobStatus.skipped_count.toLocaleString()} unchanged` : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    ) : (
                      'All documents have been indexed.'
                    )}
                  </div>
                )}
                {uploadState === 'failed' && jobStatus.error_log && (
                  <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-3 text-xs text-red-700">
                    {jobStatus.error_log}
                  </div>
                )}
                {(uploadState === 'done' || uploadState === 'failed') && (
                  <div className="mt-4">
                    <Button variant="outline" size="sm" onClick={handleReset}>
                      Upload another file
                    </Button>
                  </div>
                )}
              </div>
            )}

            {uploadState === 'polling' && !jobStatus && (
              <div className="rounded-lg border border-zinc-100 p-5 text-sm text-[#64748b]">
                Waiting for job to start...
              </div>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Database connect shortcut */}
      {/* ------------------------------------------------------------------ */}
      <a
        href="/dashboard/database"
        className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-[#242843] hover:bg-zinc-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[#4338ca]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          Connect a database
        </span>
        <span className="text-xs text-[#94a3b8]">Pull content from Postgres →</span>
      </a>

      {/* ------------------------------------------------------------------ */}
      {/* View products button */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-zinc-200 bg-white">
        <button
          type="button"
          onClick={() => setShowProductsTable(true)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[#242843] hover:bg-zinc-50 transition-colors rounded-lg"
        >
          <span>View documents</span>
          {catalog?.product_count != null && (
            <span className="text-xs text-[#94a3b8]">{catalog.product_count.toLocaleString()} indexed</span>
          )}
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Products table - full-screen overlay */}
      {/* ------------------------------------------------------------------ */}
      {showProductsTable && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowProductsTable(false)}
          />
          {/* Panel */}
          <div
            className="fixed z-50 flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
            style={{ inset: '2rem' }}
          >
          {/* Modal header - 3-column: left | center | right */}
          <div className="grid grid-cols-3 items-center border-b border-zinc-100 px-5 py-3 shrink-0">
            {/* Left: title + search + stale */}
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-sm font-semibold text-[#242843] shrink-0">Documents</h2>
              <Input
                type="search"
                placeholder="Search documents..."
                value={searchQ}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-48 h-8 text-sm"
              />
              {staleCount > 0 && (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Some documents need reindexing</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReindex}
                    disabled={reindexing}
                    className="ml-1 border-amber-300 bg-white text-amber-700 hover:bg-amber-50 h-7 text-xs"
                  >
                    {reindexing ? 'Reindexing...' : 'Reindex now'}
                  </Button>
                </div>
              )}
              {reindexJobId && (
                <span className="text-xs text-[#94a3b8] whitespace-nowrap">Job {reindexJobId.slice(0, 8)}... queued</span>
              )}
            </div>

            {/* Center: View / Edit toggle + Add content */}
            <div className="inline-flex flex-col gap-1.5">
              <div className="flex items-center rounded-md border border-zinc-200 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  className={`flex-1 px-3 py-1.5 transition-colors ${!editMode ? 'bg-[#4338ca] text-white' : 'bg-white text-[#64748b] hover:bg-zinc-50'}`}
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className={`flex-1 px-3 py-1.5 border-l border-zinc-200 transition-colors ${editMode ? 'bg-[#4338ca] text-white' : 'bg-white text-[#64748b] hover:bg-zinc-50'}`}
                >
                  Edit
                </button>
              </div>
              {editMode && (
                <button
                  type="button"
                  onClick={() => openAddProduct()}
                  className="w-full py-1.5 rounded-md border border-zinc-200 bg-white text-sm text-[#64748b] hover:bg-zinc-50 transition-colors"
                >
                  + Add
                </button>
              )}
            </div>

            {/* Right: add button (edit mode) + count + close */}
            <div className="flex items-center justify-end gap-3">
              {productsData && (
                <span className="text-sm text-[#94a3b8]">
                  {productsData.total.toLocaleString()} documents
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowProductsTable(false)}
                className="shrink-0 rounded-md p-1.5 text-[#94a3b8] hover:bg-zinc-100 hover:text-[#64748b] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-50/60 px-5 py-2 shrink-0 flex-wrap">
            {/* Category filter */}
            <input
              type="text"
              placeholder="Genre..."
              value={filterCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="h-7 w-36 rounded-md border border-zinc-200 bg-white px-2.5 text-xs text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />

            {/* Sync status filter */}
            <div className="flex items-center rounded-md border border-zinc-200 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => handleStaleChange(false)}
                className={`px-2.5 py-1 border-r border-zinc-200 transition-colors ${!filterStale ? 'bg-[#4338ca] text-white' : 'bg-white text-[#64748b] hover:bg-zinc-50'}`}
              >
                All sync
              </button>
              <button
                type="button"
                onClick={() => handleStaleChange(true)}
                className={`px-2.5 py-1 transition-colors ${filterStale ? 'bg-[#4338ca] text-white' : 'bg-white text-[#64748b] hover:bg-zinc-50'}`}
              >
                Stale only
              </button>
            </div>

            {/* Clear filters */}
            {(filterCategory || filterStale) && (
              <button
                type="button"
                onClick={() => {
                  setFilterCategory('')
                  setDebouncedCategory('')
                  setFilterStale(false)
                  setPage(1)
                }}
                className="text-xs text-[#94a3b8] underline underline-offset-2 hover:text-[#64748b]"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Table body - scrollable */}
          <div className="flex-1 overflow-auto">
            {tableError && (
              <div className="m-4 rounded-md border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                {tableError}
              </div>
            )}

            {tableLoading && !productsData && (
              <div className="p-8 text-center text-sm text-[#94a3b8]">Loading documents...</div>
            )}

            {!tableLoading && productsData && productsData.products.length === 0 && (
              <div className="p-8 text-center text-sm text-[#94a3b8]">
                {(debouncedQ || debouncedCategory || filterStale)
                  ? 'No documents match the current filters.'
                  : 'No documents yet. Upload a catalog or add a document above.'}
              </div>
            )}

            {productsData && productsData.products.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50 border-b border-zinc-200 z-10">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                          className="px-3 py-2.5 text-left text-xs font-medium text-[#64748b] uppercase tracking-wide"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-50 transition-colors">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2.5 max-w-[220px]">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination footer */}
          {productsData && productsData.products.length > 0 && (
            <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-3 shrink-0">
              <span className="text-xs text-[#64748b]">
                Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, productsData.total)} of {productsData.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || tableLoading}
                  className="h-7 text-xs"
                >
                  Previous
                </Button>
                {Array.from({ length: Math.min(productsData.pages, 7) }, (_, i) => {
                  const totalPages = productsData.pages
                  let pageNum: number
                  if (totalPages <= 7) {
                    pageNum = i + 1
                  } else if (page <= 4) {
                    pageNum = i + 1
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i
                  } else {
                    pageNum = page - 3 + i
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === page ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      disabled={tableLoading}
                      className={
                        pageNum === page
                          ? 'h-7 w-7 p-0 text-xs bg-[#4338ca] text-white hover:bg-[#3730a3] border-[#4338ca]'
                          : 'h-7 w-7 p-0 text-xs border-zinc-200 text-[#64748b] hover:border-[#4338ca]/40 hover:text-[#4338ca]'
                      }
                    >
                      {pageNum}
                    </Button>
                  )
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(productsData.pages, p + 1))}
                  disabled={page >= productsData.pages || tableLoading}
                  className="h-7 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Add product dialog */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={showAddProduct} onOpenChange={setShowAddProduct}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a document</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddProduct} className="mt-2 space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={addProductForm.title}
                onChange={(e) => setAddProductForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="e.g. Stranger Things"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">Description</label>
              <textarea
                rows={3}
                value={addProductForm.description}
                onChange={(e) => setAddProductForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
                placeholder="Short synopsis or description"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">Genre</label>
              <input
                type="text"
                value={addProductForm.category}
                onChange={(e) => setAddProductForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="e.g. Thriller"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">Tags</label>
              <input
                type="text"
                value={addProductForm.tags}
                onChange={(e) => setAddProductForm((f) => ({ ...f, tags: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="sci-fi, supernatural, coming-of-age"
              />
              <p className="mt-1 text-xs text-[#94a3b8]">Comma separated</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#242843] mb-1">Content Type</label>
                <input
                  type="text"
                  value={addProductForm.content_type}
                  onChange={(e) => setAddProductForm((f) => ({ ...f, content_type: e.target.value }))}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  placeholder="movie / series"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#242843] mb-1">Year</label>
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  value={addProductForm.year}
                  onChange={(e) => setAddProductForm((f) => ({ ...f, year: e.target.value }))}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  placeholder="e.g. 2024"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">Actors</label>
              <input
                type="text"
                value={addProductForm.actors}
                onChange={(e) => setAddProductForm((f) => ({ ...f, actors: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="e.g. Millie Bobby Brown, Finn Wolfhard"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#242843] mb-1">Director</label>
                <input
                  type="text"
                  value={addProductForm.director}
                  onChange={(e) => setAddProductForm((f) => ({ ...f, director: e.target.value }))}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  placeholder="e.g. The Duffer Brothers"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#242843] mb-1">Writer</label>
                <input
                  type="text"
                  value={addProductForm.writer}
                  onChange={(e) => setAddProductForm((f) => ({ ...f, writer: e.target.value }))}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  placeholder="e.g. Matt Duffer"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">Language</label>
              <input
                type="text"
                value={addProductForm.language}
                onChange={(e) => setAddProductForm((f) => ({ ...f, language: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="e.g. English"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">Thumbnail URL</label>
              <input
                type="url"
                value={addProductForm.image_url}
                onChange={(e) => setAddProductForm((f) => ({ ...f, image_url: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#242843] mb-1">Content URL</label>
              <input
                type="url"
                value={addProductForm.product_url}
                onChange={(e) => setAddProductForm((f) => ({ ...f, product_url: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-[#242843] placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="https://..."
              />
            </div>
            {addProductError && (
              <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {addProductError}
              </div>
            )}
            {addProductSuccess && (
              <div className="rounded-md border border-green-100 bg-green-50 p-3 text-sm text-green-700">
                Document added
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={addProductSubmitting || addProductSuccess}>
                {addProductSubmitting ? 'Saving...' : 'Save document'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAddProduct(false)}
                disabled={addProductSubmitting}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Replace-all confirmation dialog */}
      <Dialog open={showReplaceWarning} onOpenChange={setShowReplaceWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace entire catalog?</DialogTitle>
            <DialogDescription>
              No ID field is mapped for this upload. Uploading will delete all{' '}
              {catalog?.product_count?.toLocaleString()} existing documents and replace them with this file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReplaceWarning(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowReplaceWarning(false)
                startUpload('replace')
              }}
            >
              Replace all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteDialog
          productTitle={deleteTarget.title}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-[#242843] shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
