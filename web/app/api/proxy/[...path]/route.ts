import { auth } from '@/lib/auth/server'
import { NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

function withTimeout<T>(promise: Promise<T> | undefined | null, ms: number): Promise<T | null> {
  if (!promise) return Promise.resolve(null)
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

async function getUserId(req: NextRequest): Promise<string | null> {
  const primary = (auth as any).api?.getSession?.({ headers: req.headers })
  const fallback = (auth as any).getSession?.()

  const [primaryResult, fallbackResult] = await Promise.all([
    withTimeout(primary, 5000),
    withTimeout(fallback, 5000),
  ])

  const session = primaryResult ?? fallbackResult
  return (session as any)?.user?.id ?? (session as any)?.data?.user?.id ?? null
}

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path } = await params
  const url = `${BACKEND}/api/v1/${path.join('/')}${req.nextUrl.search}`
  const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined
  const res = await fetch(url, {
    method: req.method,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body,
  })
  return new NextResponse(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
