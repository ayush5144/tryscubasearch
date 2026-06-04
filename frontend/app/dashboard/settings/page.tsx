'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Check, Copy } from 'lucide-react'
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeyItem,
  type CreateApiKeyResponse,
  ApiError,
} from '@/lib/api-client'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: ignore
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-1 rounded p-0.5 text-[#94a3b8] hover:text-[#242843] transition-colors"
      title={copied ? 'Copied!' : 'Copy key'}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative group">
      <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-[#242843]">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} />
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { getToken } = useAuth()
  const [keys, setKeys] = useState<ApiKeyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create key dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newKeyResult, setNewKeyResult] = useState<CreateApiKeyResponse | null>(null)

  // Warning shown before creating a new key when active keys exist
  const [revokeWarningOpen, setRevokeWarningOpen] = useState(false)

  // Revoke confirmation
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null)
  const [revoking, setRevoking] = useState(false)

  async function loadKeys() {
    try {
      const token = await getToken()
      if (!token) return
      const data = await getApiKeys(token)
      setKeys(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load API keys.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadKeys()
  }, [getToken]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!newLabel.trim()) return
    setCreating(true)
    setCreateError(null)

    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const result = await createApiKey(token, newLabel.trim())
      setNewKeyResult(result)
      setNewLabel('')
      await loadKeys()
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create key.')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    setRevoking(true)

    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      await revokeApiKey(token, revokeTarget.id)
      setRevokeTarget(null)
      await loadKeys()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke key.')
    } finally {
      setRevoking(false)
    }
  }

  function handleCreateDialogClose() {
    setCreateOpen(false)
    setNewKeyResult(null)
    setNewLabel('')
    setCreateError(null)
  }

  // Use first active key for widget snippet, or placeholder
  const firstActiveKey = keys.find((k) => k.is_active)
  const widgetApiKey = firstActiveKey ? `${firstActiveKey.key_prefix}...` : 'YOUR_API_KEY'

  const widgetSnippet = `<script
  src="https://cdn.scubasearch.io/widget.js"
  data-api-key="${firstActiveKey ? 'YOUR_FULL_API_KEY' : 'YOUR_API_KEY'}"
  data-placeholder="Search titles..."
></script>`

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#242843]">Settings</h1>
      <p className="mt-1 text-sm text-[#64748b]">
        Manage your API keys and widget installation.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* API Keys section */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#242843]">API Keys</h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Keys authenticate your widget and ingest calls.
            </p>
          </div>
          <Button
            size="sm"
            className="bg-[#4338ca] hover:bg-[#3730a3] text-white"
            onClick={() => {
              const hasActive = keys.some((k) => k.is_active)
              if (hasActive) {
                setRevokeWarningOpen(true)
              } else {
                setCreateOpen(true)
              }
            }}
          >
            Create new key
          </Button>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-100">
          {loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#94a3b8]">
              No API keys yet. Create one to use the widget.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">
                      {key.label ?? '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#64748b]">
                      {key.raw_key ? (
                        <div className="flex items-center">
                          <span>{key.raw_key.slice(0, 9)}...</span>
                          <CopyButton text={key.raw_key} />
                        </div>
                      ) : (
                        <span className="text-[#94a3b8]">{key.key_prefix}...</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-[#64748b]">
                      {new Date(key.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={key.is_active ? 'outline' : 'secondary'}
                      >
                        {key.is_active ? 'Active' : 'Revoked'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {key.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setRevokeTarget(key)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <Separator className="my-8" />

      {/* Widget Installation section */}
      <section>
        <h2 className="text-base font-semibold text-[#242843]">Widget Installation</h2>
        <p className="mt-1 text-sm text-[#64748b]">
          Add this script tag to your platform&apos;s HTML, just before{' '}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">&lt;/body&gt;</code>.
          Replace <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">YOUR_FULL_API_KEY</code> with
          your actual API key (shown once when created).
        </p>

        <div className="mt-4">
          <CodeBlock code={widgetSnippet} />
        </div>

        <div className="mt-6 rounded-md border border-amber-100 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">
            Content Security Policy (CSP)
          </h3>
          <p className="mt-1 text-sm text-amber-800">
            If your platform sets a{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
              Content-Security-Policy
            </code>{' '}
            header, add the following directive to allow the widget to reach the ScubaSearch API:
          </p>
          <div className="mt-3">
            <CodeBlock code="connect-src https://api.scubasearch.io" />
          </div>
          <p className="mt-2 text-xs text-amber-700">
            Without this, the widget will silently fail to load results on platforms with strict CSP.
          </p>
        </div>
      </section>

      {/* Revoke warning - shown before create when active keys exist */}
      <Dialog open={revokeWarningOpen} onOpenChange={setRevokeWarningOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your existing API key will be revoked</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#64748b]">
            Creating a new key will <span className="font-semibold text-[#242843]">immediately revoke</span> your
            current API key. Any widget or integration using it will stop working until you update it with the new key.
          </p>
          <p className="text-sm text-[#64748b]">
            Make sure you&apos;re ready to update your widget snippet after this.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeWarningOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRevokeWarningOpen(false)
                setCreateOpen(true)
              }}
            >
              Revoke & create new key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={handleCreateDialogClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
          </DialogHeader>

          {newKeyResult ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
                This key will not be shown again. Copy it now and store it securely.
              </div>
              <div>
                <Label className="text-xs text-[#64748b]">Your new API key</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-mono text-[#242843] break-all">
                    {newKeyResult.raw_key}
                  </code>
                  <CopyButton text={newKeyResult.raw_key} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateDialogClose}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="key-label">Label</Label>
                <Input
                  id="key-label"
                  className="mt-1.5"
                  placeholder="e.g. Production, Staging"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>

              {createError && (
                <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                  {createError}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={handleCreateDialogClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newLabel.trim() || creating}
                >
                  {creating ? 'Creating...' : 'Create key'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation dialog */}
      <Dialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke API key?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#64748b]">
            Revoking{' '}
            <span className="font-medium">{revokeTarget?.label ?? 'this key'}</span> will
            immediately stop all requests using it. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? 'Revoking...' : 'Revoke key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
