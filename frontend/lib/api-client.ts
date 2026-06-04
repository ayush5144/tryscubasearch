/**
 * API client for ScubaSearch dashboard.
 *
 * All API calls go through this file. Never fetch directly from components.
 * Server components use auth() from @clerk/nextjs/server.
 * Client components pass the token explicitly via useAuth().getToken().
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientProfile {
  id: string
  email: string
  store_name: string | null
  store_description: string | null
  store_url: string | null
  plan: string | null
  plan_status: string | null
  onboarding_complete: boolean
  clerk_user_id: string
  embed_config: string[]
  available_embed_fields: string[]
}

export type MeResponse = ClientProfile

export interface UpdateMeRequest {
  store_name?: string
  store_description?: string
  onboarding_complete?: boolean
  embed_config?: string[]
}

export interface ApiKeyItem {
  id: string
  key_prefix: string
  raw_key: string | null
  label: string | null
  is_active: boolean
  created_at: string
}

export interface CreateApiKeyResponse {
  id: string
  label: string | null
  key_prefix: string
  raw_key: string
  is_active: boolean
  created_at: string
}

export interface AnalyticsSummary {
  total_searches: number
  zero_result_rate: number
  zero_result_count: number
  total_products: number
  ctr: number | null
  days_window: number
  clicked_count: number
  searched_count: number
  browsed_count: number
  abandoned_count: number
  total_sessions: number
}

export interface TopQueryItem {
  query: string
  count: number
  avg_results: number
}

export interface ZeroResultItem {
  query: string
  count: number
  last_seen: string
}

export interface QueryLogItem {
  query: string
  intent: 'clicked' | 'searched' | 'searched_browsed' | 'browsed' | 'abandoned'
  signal: string | null
  result_count: number | null  // null = ghost query (no result data)
  searched_at: string
  session_id: string | null
}

export interface BillingStatus {
  plan: string
  status: string
  products_used: number
  products_limit: number
  sessions_used: number
  sessions_limit: number
  reset_at: string | null
}

export interface IngestJobStatus {
  job_id: string
  client_id: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  total: number
  processed: number
  error_log: string | null
  added_count: number
  updated_count: number
  skipped_count: number | null
}

export interface UploadCsvResponse {
  job_id: string
  client_id: string
  status: string
  message: string
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

function requireAuthToken(token: string): string {
  const trimmed = token?.trim()
  if (!trimmed) {
    throw new ApiError(401, 'Not authenticated. Please refresh and sign in again.')
  }
  return trimmed
}

async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_URL}${path}`
  const authToken = requireAuthToken(token)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    ...(options.headers as Record<string, string>),
  }

  // Only set Content-Type for JSON bodies (not FormData, not empty body)
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, { ...options, headers })

  if (!res.ok) {
    let message = `Request failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail?.message) message = body.detail.message
      else if (body?.message) message = body.message
      else if (typeof body?.detail === 'string') message = body.detail
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, message)
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T

  return res.json()
}

// ---------------------------------------------------------------------------
// Client / account endpoints
// ---------------------------------------------------------------------------

export async function getMe(token: string): Promise<ClientProfile> {
  return apiFetch<ClientProfile>('/api/v1/me', token)
}

export async function ensureMe(token: string): Promise<ClientProfile> {
  return apiFetch<ClientProfile>('/api/v1/me', token, {
    method: 'POST',
  })
}

export async function updateMe(token: string, data: UpdateMeRequest): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/v1/me', token, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ---------------------------------------------------------------------------
// API key endpoints
// ---------------------------------------------------------------------------

export async function getApiKeys(token: string): Promise<ApiKeyItem[]> {
  return apiFetch<ApiKeyItem[]>('/api/v1/me/keys', token)
}

export async function createApiKey(
  token: string,
  label: string,
): Promise<CreateApiKeyResponse> {
  return apiFetch<CreateApiKeyResponse>('/api/v1/me/keys', token, {
    method: 'POST',
    body: JSON.stringify({ label }),
  })
}

export async function revokeApiKey(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/me/keys/${id}`, token, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Analytics endpoints
// ---------------------------------------------------------------------------

export async function getAnalyticsSummary(token: string): Promise<AnalyticsSummary> {
  return apiFetch<AnalyticsSummary>('/api/v1/analytics/summary', token)
}

export async function getTopQueries(
  token: string,
  limit = 10,
  fromDate?: string,
  toDate?: string,
  offset = 0,
): Promise<TopQueryItem[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (offset > 0) params.set('offset', String(offset))
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  return apiFetch<TopQueryItem[]>(`/api/v1/analytics/top-queries?${params}`, token)
}

export async function getZeroResults(
  token: string,
  limit = 20,
  fromDate?: string,
  toDate?: string,
  offset = 0,
): Promise<ZeroResultItem[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (offset > 0) params.set('offset', String(offset))
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  return apiFetch<ZeroResultItem[]>(`/api/v1/analytics/zero-results?${params}`, token)
}

export async function getQueryLog(
  token: string,
  limit = 50,
  fromDate?: string,
  toDate?: string,
  offset = 0,
): Promise<QueryLogItem[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (offset > 0) params.set('offset', String(offset))
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  return apiFetch<QueryLogItem[]>(`/api/v1/analytics/query-log?${params}`, token)
}

export interface CatalogStats {
  product_count: number
  active_source: 'none' | 'csv' | 'database' | 'api_pull'
  active_source_label: string
  active_file_format: 'csv' | 'json' | 'ndjson' | null
  last_job: {
    id: string
    status: string
    total: number
    processed: number
    error_log: string | null
    created_at: string
    added_count: number | null
    updated_count: number | null
    skipped_count: number | null
    file_format: 'csv' | 'json' | 'ndjson' | null
    trigger: 'manual_upload' | 'rest_api_push' | 'webhook_sync' | 'manual_add' | null
  } | null
}

export async function getCatalog(token: string): Promise<CatalogStats> {
  return apiFetch<CatalogStats>('/api/v1/me/catalog', token)
}

export type DatabaseType = 'postgres' | 'mysql'

export interface DatabaseRequest {
  db_type: DatabaseType
  connection_string: string
}

export interface DatabasePreviewRequest extends DatabaseRequest {
  table_name: string
}

export interface DatabaseConnectRequest extends DatabasePreviewRequest {
  field_mapping: Record<string, string>
}

// ---------------------------------------------------------------------------
// Ingest endpoints
// ---------------------------------------------------------------------------

export async function uploadCsv(
  token: string,
  file: File,
  mode: 'replace' | 'append' | 'update' = 'replace',
  fieldMapping?: Record<string, string>,
): Promise<UploadCsvResponse> {
  const formData = new FormData()
  formData.append('file', file)
  if (fieldMapping && Object.keys(fieldMapping).length > 0) {
    formData.append('field_mapping', JSON.stringify(fieldMapping))
  }
  return apiFetch<UploadCsvResponse>(`/api/v1/ingest/csv?mode=${mode}`, token, {
    method: 'POST',
    body: formData,
  })
}

export async function getIngestJob(
  token: string,
  jobId: string,
): Promise<IngestJobStatus> {
  return apiFetch<IngestJobStatus>(`/api/v1/ingest/jobs/${jobId}`, token)
}

// ---------------------------------------------------------------------------
// Search endpoint (uses raw API key, not Clerk token)
// ---------------------------------------------------------------------------

export interface SearchProduct {
  id: string
  title: string
  image_url: string | null
  product_url: string | null
  content_type?: string | null
  year?: number | null
  language?: string | null
  [key: string]: unknown
}

export interface SearchResponse {
  results: SearchProduct[]
  query: string
  total: number
  log_id?: string
}

export async function searchProducts(
  apiKey: string,
  query: string,
): Promise<SearchResponse> {
  const res = await fetch(`${API_URL}/api/v1/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, limit: 8 }),
  })
  if (!res.ok) return { results: [], query, total: 0 }
  return res.json()
}

export interface SyncDocument {
  id?: string
  title?: string
  description?: string
  category?: string
  tags?: string | string[]
  image_url?: string
  product_url?: string
  actors?: string | string[]
  director?: string | string[]
  writer?: string | string[]
  content_type?: string
  year?: number
  language?: string
  duration_mins?: number
}

export interface BulkSyncResponse {
  job_id: string
  status: string
  mode: 'replace' | 'append' | 'update'
  total: number
  trigger: 'api' | 'webhook'
}

export async function pushDocuments(
  apiKey: string,
  documents: SyncDocument[],
  mode: 'replace' | 'append' | 'update' = 'append',
): Promise<BulkSyncResponse> {
  return apiFetch<BulkSyncResponse>('/api/v1/push/documents', apiKey, {
    method: 'POST',
    body: JSON.stringify({ documents, mode }),
  })
}

export async function sendSyncWebhook(
  apiKey: string,
  payload: {
    documents?: SyncDocument[]
    document?: SyncDocument
    mode?: 'replace' | 'append' | 'update'
    event?: string
  },
): Promise<BulkSyncResponse> {
  return apiFetch<BulkSyncResponse>('/api/v1/push/webhook', apiKey, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ---------------------------------------------------------------------------
// Product CRUD - list, update, delete, reindex
// ---------------------------------------------------------------------------

export interface Product {
  id: string
  external_id: string | null
  title: string
  description: string | null
  category: string | null
  tags: string | null
  image_url: string | null
  product_url: string | null
  last_indexed_at: string | null  // ISO timestamp
  updated_at: string
  created_at: string
  // OTT content fields
  actors?: string
  director?: string
  writer?: string
  content_type?: string
  year?: number
  language?: string
  duration_mins?: number
}

export interface ProductsResponse {
  products: Product[]
  total: number
  page: number
  pages: number
}

export interface ProductUpdate {
  title?: string
  description?: string
  category?: string
  tags?: string
  image_url?: string
  product_url?: string
  // OTT content fields
  actors?: string
  director?: string
  writer?: string
  content_type?: string
  year?: number
  language?: string
  duration_mins?: number
}

export async function getProducts(
  token: string,
  {
    page = 1,
    limit = 50,
    q,
    category,
    stale_only,
  }: {
    page?: number
    limit?: number
    q?: string
    category?: string
    stale_only?: boolean
  } = {},
): Promise<ProductsResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (q) params.set('q', q)
  if (category) params.set('category', category)
  if (stale_only) params.set('stale_only', 'true')
  return apiFetch<ProductsResponse>(`/api/v1/documents?${params}`, token)
}

export async function updateProduct(
  token: string,
  productId: string,
  update: ProductUpdate,
): Promise<Product> {
  return apiFetch<Product>(`/api/v1/documents/${productId}`, token, {
    method: 'PUT',
    body: JSON.stringify(update),
  })
}

export async function deleteProduct(token: string, productId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/documents/${productId}`, token, {
    method: 'DELETE',
  })
}

export async function reindexProducts(
  token: string,
): Promise<{ job_id: string | null; stale_count: number }> {
  return apiFetch<{ job_id: string | null; stale_count: number }>(
    '/api/v1/documents/reindex',
    token,
    { method: 'POST' },
  )
}

// ---------------------------------------------------------------------------
// Product upsert endpoints
// ---------------------------------------------------------------------------

export interface ProductUpsertRequest {
  id?: string
  title: string
  description?: string
  category?: string
  tags?: string
  image_url?: string
  product_url?: string
  actors?: string
  director?: string
  writer?: string
  content_type?: string
  year?: number
  language?: string
  duration_mins?: number
}

export type ProductFormData = Omit<ProductUpsertRequest, 'year'> & { year?: string }

export interface ProductUpsertResponse {
  id: string
  title: string
  indexed: boolean
}

export async function addProduct(
  token: string,
  product: ProductUpsertRequest,
): Promise<ProductUpsertResponse> {
  return apiFetch<ProductUpsertResponse>('/api/v1/documents', token, {
    method: 'POST',
    body: JSON.stringify(product),
  })
}

// ---------------------------------------------------------------------------
// Billing endpoints
// ---------------------------------------------------------------------------

export async function getBillingStatus(token: string): Promise<BillingStatus> {
  return apiFetch<BillingStatus>('/api/v1/billing/status', token)
}

export async function activateTestPlan(
  token: string,
  plan: 'starter' | 'growth' | 'scale',
): Promise<void> {
  return apiFetch<void>('/api/v1/billing/activate-test', token, {
    method: 'POST',
    body: JSON.stringify({ plan }),
  })
}

// ---------------------------------------------------------------------------
// Database connect endpoints
// ---------------------------------------------------------------------------

export interface DatabaseStatus {
  connected: boolean
  db_type: DatabaseType | null
  table_name: string | null
  field_mapping: Record<string, string> | null
  sync_status: string | null
  product_count: number | null
  last_synced_at: string | null
  error_message: string | null
  source_columns: string[] | null
}

export interface ColumnInfo {
  name: string
  type: string
}

export async function getDatabaseStatus(token: string): Promise<DatabaseStatus> {
  return apiFetch<DatabaseStatus>('/api/v1/database/status', token)
}

export async function listDatabaseTables(
  token: string,
  request: DatabaseRequest,
): Promise<string[]> {
  return apiFetch<string[]>('/api/v1/database/tables', token, {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function previewDatabaseColumns(
  token: string,
  request: DatabasePreviewRequest,
): Promise<ColumnInfo[]> {
  return apiFetch<ColumnInfo[]>('/api/v1/database/preview-columns', token, {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function connectDatabase(
  token: string,
  request: DatabaseConnectRequest,
): Promise<DatabaseStatus> {
  return apiFetch<DatabaseStatus>('/api/v1/database/connect', token, {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function resyncDatabase(token: string): Promise<{ queued: boolean }> {
  return apiFetch<{ queued: boolean }>('/api/v1/database/sync', token, { method: 'POST' })
}

export async function disconnectDatabase(token: string): Promise<{ disconnected: boolean }> {
  return apiFetch<{ disconnected: boolean }>('/api/v1/database/disconnect', token, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// API pull sync endpoints
// ---------------------------------------------------------------------------

export interface ApiSyncStatus {
  connected: boolean
  source_url: string | null
  items_path: string | null
  field_mapping: Record<string, string> | null
  sync_status: string | null
  product_count: number | null
  last_synced_at: string | null
  next_sync_at: string | null
  sync_interval_mins: number | null
  error_message: string | null
  source_columns: string[] | null
}

export async function getApiSyncStatus(token: string): Promise<ApiSyncStatus> {
  return apiFetch<ApiSyncStatus>('/api/v1/api-sync/status', token)
}

export async function previewApiSyncSource(
  token: string,
  sourceUrl: string,
  headers?: Record<string, string>,
  itemsPath?: string,
): Promise<ColumnInfo[]> {
  return apiFetch<ColumnInfo[]>('/api/v1/api-sync/preview', token, {
    method: 'POST',
    body: JSON.stringify({
      source_url: sourceUrl,
      headers: headers ?? {},
      items_path: itemsPath || null,
    }),
  })
}

export async function connectApiSyncSource(
  token: string,
  sourceUrl: string,
  fieldMapping: Record<string, string>,
  syncIntervalMins: number,
  headers?: Record<string, string>,
  itemsPath?: string,
): Promise<ApiSyncStatus> {
  return apiFetch<ApiSyncStatus>('/api/v1/api-sync/connect', token, {
    method: 'POST',
    body: JSON.stringify({
      source_url: sourceUrl,
      headers: headers ?? {},
      items_path: itemsPath || null,
      field_mapping: fieldMapping,
      sync_interval_mins: syncIntervalMins,
    }),
  })
}

export async function triggerApiSync(token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/api/v1/api-sync/sync', token, {
    method: 'POST',
  })
}

export async function disconnectApiSync(token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/api/v1/api-sync/disconnect', token, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

export interface AdminStats {
  total_clients: number
  active_subscriptions: number
  searches_today: number
  sessions_this_month: number
}

export interface AdminClientRow {
  id: string
  email: string
  store_name: string | null
  store_url: string | null
  plan: string | null
  plan_status: string | null
  onboarding_complete: boolean
  created_at: string
  sub_plan: string
  sub_status: string
  sessions_this_month: number
  queries_this_month: number
  product_count: number
  last_active: string | null
}

export async function getAdminStats(token: string): Promise<AdminStats> {
  const authToken = requireAuthToken(token)
  const res = await fetch(`${API_URL}/api/v1/admin/stats`, {
    headers: { Authorization: `Bearer ${authToken}` },
  })
  if (res.status === 403) throw new Error('forbidden')
  if (!res.ok) throw new Error('server_error')
  return res.json()
}

export async function getAdminClients(token: string, offset = 0): Promise<AdminClientRow[]> {
  const authToken = requireAuthToken(token)
  const res = await fetch(`${API_URL}/api/v1/admin/clients?limit=50&offset=${offset}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  })
  if (res.status === 403) throw new Error('forbidden')
  if (!res.ok) throw new Error('server_error')
  return res.json()
}

export async function adminActivateClient(token: string, clientId: string, plan: string): Promise<void> {
  const authToken = requireAuthToken(token)
  const res = await fetch(`${API_URL}/api/v1/admin/clients/${clientId}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  })
  if (!res.ok) throw new Error('failed')
}

export async function adminCancelClient(token: string, clientId: string): Promise<void> {
  const authToken = requireAuthToken(token)
  const res = await fetch(`${API_URL}/api/v1/admin/clients/${clientId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  })
  if (!res.ok) throw new Error('failed')
}
