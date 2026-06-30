import { CronExpressionParser } from 'cron-parser'

// ---------------------------------------------------------------------------
// Cron / schedule engine — pure deterministic functions, no external services.
//
// Schedule "kinds":
//   - 'cron'   : a standard 5-field (or 6-field) cron expression, evaluated in
//                a given IANA timezone via cron-parser.
//   - 'rate'   : a natural-language rate, "every N minutes|hours|days",
//                computed arithmetically from `fromISO`.
//   - 'oneoff' : a single ISO instant; fires once if it is in the future.
//
// All emitted instants are ISO-8601 UTC strings (…Z). Timezone only affects
// how a cron/rate expression maps onto the wall clock; the returned instants
// are always absolute UTC.
// ---------------------------------------------------------------------------

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  /** Optional shared resource (e.g. a sender id / ESP endpoint). */
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

export interface CoverageWindow {
  /** ISO instants bounding a window that SHOULD be covered by a firing. */
  start: string
  end: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_TZ = 'UTC'

function isFiniteDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

/** Parse "every N minutes|hours|days" → milliseconds. Returns null if not a rate. */
function parseRate(expr: string): { ms: number; n: number; unit: string } | null {
  const m = /^\s*every\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s*$/i.exec(
    expr,
  )
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  let ms: number
  let canonical: string
  if (unit.startsWith('min')) {
    ms = n * 60_000
    canonical = 'minutes'
  } else if (unit.startsWith('h')) {
    ms = n * 3_600_000
    canonical = 'hours'
  } else {
    ms = n * 86_400_000
    canonical = 'days'
  }
  return { ms, n, unit: canonical }
}

/** Offset (minutes east of UTC) of a given instant in an IANA timezone. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Use Intl to read the wall-clock components in the target zone, then diff
  // against the same components interpreted as UTC.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
  }
  // hour can come back as 24 at midnight in some environments; normalise.
  const hour = map.hour === 24 ? 0 : map.hour
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second)
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/** Local wall-clock label "YYYY-MM-DD HH:mm" of an instant in a timezone. */
function localLabel(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  const hour = map.hour === '24' ? '00' : map.hour
  return `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}`
}

/** Truncate an instant to the minute and return its ISO-UTC string. */
function minuteKey(date: Date): string {
  const d = new Date(date.getTime())
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (typeof expr !== 'string' || expr.trim() === '') {
    return { valid: false, error: 'Expression is empty' }
  }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr, { tz: DEFAULT_TZ })
      return { valid: true }
    } catch (e: unknown) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const d = new Date(expr)
    if (!isFiniteDate(d)) return { valid: false, error: 'Invalid ISO timestamp' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown kind "${kind}"` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid schedule: ${v.error}`

  if (kind === 'rate') {
    const r = parseRate(expr)!
    const singular = r.n === 1
    const unitLabel = singular ? r.unit.replace(/s$/, '') : r.unit
    return singular ? `Every ${unitLabel}` : `Every ${r.n} ${unitLabel}`
  }

  if (kind === 'oneoff') {
    const d = new Date(expr)
    return `Once at ${localLabel(d, timezone)} (${timezone})`
  }

  // cron
  const fields = expr.trim().split(/\s+/)
  const [min, hour, dom, mon, dow] = fields
  const parts: string[] = []

  if (min === '*' && hour === '*') {
    parts.push('every minute')
  } else if (hour === '*' && min !== '*') {
    parts.push(`at minute ${min} of every hour`)
  } else if (/^\*\/\d+$/.test(min)) {
    parts.push(`every ${min.slice(2)} minutes`)
  } else if (min !== '*' && hour !== '*') {
    parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  } else {
    parts.push(`minute=${min} hour=${hour}`)
  }

  if (dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon !== '*') parts.push(`in month ${mon}`)
  if (dow !== '*') {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const labeled = /^\d$/.test(dow) ? names[parseInt(dow, 10) % 7] : dow
    parts.push(`on ${labeled}`)
  }
  return `${parts.join(', ')} (${timezone})`
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  count: number = 10,
): string[] {
  const from = new Date(fromISO)
  if (!isFiniteDate(from) || count <= 0) return []

  if (kind === 'oneoff') {
    const d = new Date(expr)
    if (!isFiniteDate(d)) return []
    return d.getTime() > from.getTime() ? [d.toISOString()] : []
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime() + r.ms
    for (let i = 0; i < count; i++) {
      out.push(new Date(t).toISOString())
      t += r.ms
    }
    return out
  }

  // cron
  try {
    const it = CronExpressionParser.parse(expr, { tz: timezone, currentDate: from })
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const next = it.next()
      out.push(new Date(next.getTime()).toISOString())
    }
    return out
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays?: number; threshold?: number } = {},
): CollisionWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = opts.threshold ?? 2
  const fromISO = new Date().toISOString()
  const horizonMs = horizonDays * 86_400_000
  const cutoff = Date.now() + horizonMs

  // Bucket firings by minute → { jobIds set, resource counts }.
  interface Bucket {
    jobIds: Set<string>
    resourceCounts: Map<string, Set<string>>
  }
  const buckets = new Map<string, Bucket>()

  for (const job of jobs) {
    // Generate enough firings to cover the horizon. Cap to avoid runaway.
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 5000)
    for (const iso of firings) {
      const t = new Date(iso).getTime()
      if (t > cutoff) break
      const key = minuteKey(new Date(t))
      let b = buckets.get(key)
      if (!b) {
        b = { jobIds: new Set(), resourceCounts: new Map() }
        buckets.set(key, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let s = b.resourceCounts.get(job.resourceId)
        if (!s) {
          s = new Set()
          b.resourceCounts.set(job.resourceId, s)
        }
        s.add(job.id)
      }
    }
  }

  const out: CollisionWindow[] = []
  for (const [key, b] of buckets) {
    const concurrency = b.jobIds.size
    // Resource contention: >=2 distinct jobs sharing one resource in this minute.
    let contendedResource: string | undefined
    for (const [res, jids] of b.resourceCounts) {
      if (jids.size >= 2) {
        contendedResource = res
        break
      }
    }
    const flagged = concurrency >= threshold || contendedResource !== undefined
    if (!flagged) continue

    const start = new Date(key)
    const end = new Date(start.getTime() + 60_000)
    let severity: CollisionWindow['severity'] = 'low'
    if (concurrency >= threshold * 2) severity = 'high'
    else if (concurrency >= threshold) severity = 'medium'
    if (contendedResource && severity === 'low') severity = 'medium'

    out.push({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      jobIds: Array.from(b.jobIds).sort(),
      severity,
      resourceId: contendedResource,
    })
  }

  out.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return out
}

// ---------------------------------------------------------------------------
// loadHeatmap — firings bucketed per hour across the horizon
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: Job[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromISO = new Date().toISOString()
  const cutoff = Date.now() + horizonDays * 86_400_000
  const counts = new Map<string, number>()

  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 5000)
    for (const iso of firings) {
      const t = new Date(iso).getTime()
      if (t > cutoff) break
      const d = new Date(t)
      d.setUTCMinutes(0, 0, 0)
      const key = d.toISOString()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps — detect DST-related anomalies in the window
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  days: number = 30,
): DstTrap[] {
  const traps: DstTrap[] = []
  if (timezone === 'UTC' || timezone === 'Etc/UTC') return traps

  const v = validateExpression(kind, expr)
  if (!v.valid) return traps

  const from = new Date(fromISO)
  if (!isFiniteDate(from)) return traps
  const end = new Date(from.getTime() + days * 86_400_000)

  // 1. Find DST transition instants by scanning the window for offset changes.
  const transitions: Array<{ at: Date; before: number; after: number }> = []
  const step = 3_600_000 // hourly probe is fine; DST shifts on the hour
  let prevOffset = tzOffsetMinutes(from, timezone)
  for (let t = from.getTime() + step; t <= end.getTime(); t += step) {
    const cur = tzOffsetMinutes(new Date(t), timezone)
    if (cur !== prevOffset) {
      transitions.push({ at: new Date(t), before: prevOffset, after: cur })
      prevOffset = cur
    }
  }
  if (transitions.length === 0) return traps

  // 2. For each transition, derive the local wall-clock range that is skipped
  //    (spring forward) or repeated (fall back), and flag firings landing in it.
  const firings = nextFirings(kind, expr, timezone, fromISO, 5000).map((iso) => new Date(iso))

  for (const tr of transitions) {
    const delta = tr.after - tr.before // +60 spring? sign depends on hemisphere convention
    const gained = tr.after > tr.before // clocks moved forward → skip
    const lost = tr.after < tr.before // clocks moved back → repeat/ambiguous
    const transMs = tr.at.getTime()
    const windowMs = Math.abs(delta) * 60_000

    if (gained) {
      // Spring forward: a band of local wall-clock times never occurs.
      // Firings scheduled for that local time get pushed; flag as 'skip'.
      for (const f of firings) {
        const ft = f.getTime()
        if (ft >= transMs - windowMs && ft < transMs + windowMs) {
          traps.push({
            type: 'skip',
            atLocal: localLabel(f, timezone),
            atUtc: f.toISOString(),
          })
        }
      }
    } else if (lost) {
      // Fall back: a band of local wall-clock times occurs twice.
      for (const f of firings) {
        const ft = f.getTime()
        if (ft >= transMs - windowMs && ft < transMs + windowMs) {
          traps.push({
            type: ft < transMs ? 'ambiguous' : 'double_fire',
            atLocal: localLabel(f, timezone),
            atUtc: f.toISOString(),
          })
        }
      }
    }
  }

  // De-dup identical entries.
  const seen = new Set<string>()
  return traps.filter((t) => {
    const k = `${t.type}|${t.atUtc}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------------------------------------------------------------------------
// coverageGaps — windows that should be covered but have no firing
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: Job[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromISO = new Date().toISOString()
  const cutoff = Date.now() + horizonDays * 86_400_000

  // Collect all firing instants across jobs within the horizon.
  const allFirings: number[] = []
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 5000)
    for (const iso of firings) {
      const t = new Date(iso).getTime()
      if (t > cutoff) break
      allFirings.push(t)
    }
  }
  allFirings.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const ws = new Date(w.start).getTime()
    const we = new Date(w.end).getTime()
    if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) continue
    const covered = allFirings.some((t) => t >= ws && t <= we)
    if (!covered) {
      gaps.push({
        gapStart: new Date(ws).toISOString(),
        gapEnd: new Date(we).toISOString(),
        durationMinutes: Math.round((we - ws) / 60_000),
      })
    }
  }
  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread — suggest staggered offsets to break up collisions
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: Job[],
  opts: { threshold?: number; horizonDays?: number } = {},
): SpreadSuggestion[] {
  const threshold = opts.threshold ?? 2
  const collisions = computeCollisions(jobs, {
    threshold,
    horizonDays: opts.horizonDays ?? 7,
  })
  if (collisions.length === 0) return []

  // Tally how many collision windows each job participates in.
  const participation = new Map<string, number>()
  for (const col of collisions) {
    for (const jid of col.jobIds) {
      participation.set(jid, (participation.get(jid) ?? 0) + 1)
    }
  }

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const suggestions: SpreadSuggestion[] = []

  // For each colliding window, keep the first job and nudge the rest.
  // Assign a deterministic minute offset per job to spread the load.
  const offsetForJob = new Map<string, number>()
  let cursor = 0
  const ordered = Array.from(participation.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id)

  for (const jid of ordered) {
    const job = jobById.get(jid)
    if (!job) continue
    // Leave the busiest job in place; spread the others by increasing offsets.
    if (cursor === 0) {
      cursor += 1
      continue
    }
    const offsetMin = (cursor % 59) + 1
    offsetForJob.set(jid, offsetMin)
    cursor += 1

    let suggested = job.expr
    if (job.kind === 'cron') {
      const fields = job.expr.trim().split(/\s+/)
      if (fields.length >= 5 && /^\d+$/.test(fields[0])) {
        fields[0] = String((parseInt(fields[0], 10) + offsetMin) % 60)
        suggested = fields.join(' ')
      } else if (fields.length >= 5) {
        // minute is '*' or step — pin it to the offset to de-synchronise.
        fields[0] = String(offsetMin)
        suggested = fields.join(' ')
      }
    } else if (job.kind === 'rate') {
      // Rates can't carry a phase offset in the expression; advise a delayed start.
      suggested = `${job.expr} (start +${offsetMin}m)`
    } else {
      // oneoff: shift the single instant by the offset.
      const d = new Date(job.expr)
      if (isFiniteDate(d)) suggested = new Date(d.getTime() + offsetMin * 60_000).toISOString()
    }

    suggestions.push({
      jobId: jid,
      suggestedExpr: suggested,
      reason: `Participates in ${participation.get(jid)} collision window(s); offset by ${offsetMin} minute(s) to spread load.`,
    })
  }

  return suggestions
}
