import { Hono } from 'hono'
import { db } from '../db/index.js'
import { benchmarks } from '../db/schema.js'
import { asc } from 'drizzle-orm'

const router = new Hono()

// GET / — public — list benchmark reference values (Gmail/Yahoo lines, vertical norms).
// Ordered by category then label for a stable, groupable reference table.
router.get('/', async (c) => {
  const all = await db
    .select()
    .from(benchmarks)
    .orderBy(asc(benchmarks.category), asc(benchmarks.label))
  return c.json(all)
})

export default router
