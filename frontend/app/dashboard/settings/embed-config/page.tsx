'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@clerk/nextjs'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X, Plus, RotateCcw, Info } from 'lucide-react'
import { getMe, updateMe, getDatabaseStatus, reindexProducts } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EMBED_FIELDS = ['title', 'category', 'tags', 'description']
const KNOWN_FIELDS = new Set([
  'title',
  'description',
  'category',
  'tags',
  'image_url',
  'product_url',
  'actors',
  'director',
  'writer',
  'content_type',
  'year',
  'language',
  'duration_mins',
])

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  category: 'Genre',
  tags: 'Tags',
  image_url: 'Thumbnail URL',
  product_url: 'Content URL',
  actors: 'Actors',
  director: 'Director',
  writer: 'Writer',
  content_type: 'Content Type',
  year: 'Year',
  language: 'Language',
  duration_mins: 'Duration (mins)',
}

// ---------------------------------------------------------------------------
// Sortable chip
// ---------------------------------------------------------------------------

function SortableChip({
  id,
  onRemove,
  isCustom,
}: {
  id: string
  onRemove: (id: string) => void
  isCustom: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
    >
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab touch-none text-slate-400 hover:text-slate-600 active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm font-medium text-[#242843]">
        {FIELD_LABELS[id] ?? id}
        {isCustom && (
          <span className="ml-2 rounded-full bg-[#4338ca]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#4338ca]">
            custom
          </span>
        )}
      </span>
      <button
        onClick={() => onRemove(id)}
        className="text-slate-300 hover:text-red-400 transition-colors"
        aria-label={`Remove ${id}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EmbedConfigPage() {
  const { getToken } = useAuth()

  const [activeFields, setActiveFields] = useState<string[]>(DEFAULT_EMBED_FIELDS)
  const [catalogFields, setCatalogFields] = useState<string[]>([])
  const [sourceColumns, setSourceColumns] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reindexQueued, setReindexQueued] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Load current config on mount
  useEffect(() => {
    async function load() {
      const token = await getToken()
      if (!token) return
      try {
        const [profile, dbStatus] = await Promise.all([
          getMe(token),
          getDatabaseStatus(token).catch(() => null),
        ])
        if (profile.embed_config?.length) {
          setActiveFields(profile.embed_config)
        }
        setCatalogFields(profile.available_embed_fields ?? [])
        if (dbStatus?.source_columns?.length) {
          setSourceColumns(dbStatus.source_columns)
        } else {
          setSourceColumns([])
        }
      } catch {
        setError('Failed to load config')
      }
    }
    load()
  }, [getToken])

  // Fields available to add (not already in active list)
  const availableFields = Array.from(new Set([...catalogFields, ...sourceColumns])).filter(
    (field) => !activeFields.includes(field),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setActiveFields((prev) => {
        const oldIndex = prev.indexOf(String(active.id))
        const newIndex = prev.indexOf(String(over.id))
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }, [])

  const removeField = useCallback((field: string) => {
    setActiveFields((prev) => prev.filter((f) => f !== field))
  }, [])

  const addField = useCallback((field: string) => {
    setActiveFields((prev) => [...prev, field])
  }, [])

  const resetToDefault = useCallback(() => {
    setActiveFields([...DEFAULT_EMBED_FIELDS])
  }, [])

  const handleSave = async () => {
    if (activeFields.length === 0) {
      setError('At least one field is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      await updateMe(token, { embed_config: activeFields })
      // Trigger reindex so existing products re-embed with new config
      await reindexProducts(token)
      setSaved(true)
      setReindexQueued(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save - please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#242843]">Embed Config</h1>
        <p className="mt-1 text-sm text-slate-500">
          Control which fields are included in the search embedding and their order. Fields higher in the list have more influence on search results.
        </p>
      </div>

      {/* Info banner */}
      <div className="mb-6 flex gap-3 rounded-lg border border-[#4338ca]/20 bg-[#4338ca]/5 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#4338ca]" />
        <p className="text-sm text-[#4338ca]">
          Changes apply after a reindex. Saving triggers an automatic reindex - existing products will re-embed with the new field order.
          {availableFields.length === 0 && (
            <> Available fields appear after your catalog has data or after a database sync.</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto_1fr]">
        {/* Active fields - sortable */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#242843]">In embedding</h2>
            <span className="text-xs text-slate-400">drag to reorder</span>
          </div>

          {activeFields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
              No fields selected
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={activeFields} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {activeFields.map((field) => (
                    <SortableChip
                      key={field}
                      id={field}
                      onRemove={removeField}
                      isCustom={!KNOWN_FIELDS.has(field)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Divider */}
        <div className="hidden sm:flex items-center justify-center">
          <div className="h-full w-px bg-slate-100" />
        </div>

        {/* Available fields */}
        <div>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[#242843]">Available fields</h2>
          </div>

          {availableFields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
              All fields added
            </div>
          ) : (
            <div
              className={`flex flex-col gap-2 ${
                availableFields.length > 10
                  ? 'max-h-[33rem] overflow-y-auto pr-1'
                  : ''
              }`}
            >
              {availableFields.map((field) => (
                <button
                  key={field}
                  onClick={() => addField(field)}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm hover:border-[#4338ca]/40 hover:bg-[#4338ca]/5 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0 text-[#4338ca]" />
                  <span className="flex-1 text-sm font-medium text-[#242843]">
                    {FIELD_LABELS[field] ?? field}
                    {!KNOWN_FIELDS.has(field) && (
                      <span className="ml-2 rounded-full bg-[#4338ca]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#4338ca]">
                        custom
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3 border-t border-slate-100 pt-6">
        <button
          onClick={handleSave}
          disabled={saving || activeFields.length === 0}
          className="rounded-lg bg-[#4338ca] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3730a3] disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save & reindex'}
        </button>
        <button
          onClick={resetToDefault}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to default
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-500">{error}</p>
      )}
      {reindexQueued && (
        <p className="mt-3 text-sm text-emerald-600">
          Reindex queued - products will re-embed in the background.
        </p>
      )}
    </div>
  )
}
