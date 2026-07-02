'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export type CommandRoute = { label: string; href: string; group: string }

function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export default function CommandPalette({
  routes,
  open: controlledOpen,
  onOpenChange,
}: {
  routes: CommandRoute[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? (v as (prev: boolean) => boolean)(open) : v
    setInternalOpen(next)
    onOpenChange?.(next)
  }
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const results = useMemo(
    () => routes.filter((r) => fuzzyMatch(query, `${r.group} ${r.label}`)),
    [routes, query]
  )

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[activeIndex]
      if (r) go(r.href)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-stone-950/70 px-4 pt-24 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-stone-800 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-3">
          <span className="font-mono text-xs text-stone-600">$</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKey}
            placeholder="jump to..."
            className="w-full bg-transparent font-mono text-sm text-stone-100 outline-none placeholder:text-stone-600"
          />
          <kbd className="rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-500">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-stone-600">no route matches &ldquo;{query}&rdquo;</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.href}
              onClick={() => go(r.href)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                i === activeIndex ? 'bg-rose-500/15 text-rose-200' : 'text-stone-300'
              }`}
            >
              <span>{r.label}</span>
              <span className="font-mono text-[11px] text-stone-600">{r.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
