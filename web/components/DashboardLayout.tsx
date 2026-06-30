'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const sections: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Data',
    items: [
      { label: 'Senders', href: '/dashboard/senders' },
      { label: 'Imports', href: '/dashboard/imports' },
      { label: 'Campaigns', href: '/dashboard/campaigns' },
      { label: 'Events', href: '/dashboard/events' },
      { label: 'Recipients', href: '/dashboard/recipients' },
    ],
  },
  {
    title: 'Deliverability',
    items: [
      { label: 'Placement', href: '/dashboard/placement' },
      { label: 'Reputation', href: '/dashboard/reputation' },
      { label: 'Authentication', href: '/dashboard/authentication' },
      { label: 'Fatigue', href: '/dashboard/fatigue' },
    ],
  },
  {
    title: 'List Health',
    items: [
      { label: 'List Health', href: '/dashboard/list-health' },
      { label: 'Suppression', href: '/dashboard/suppression' },
      { label: 'Cohorts', href: '/dashboard/cohorts' },
      { label: 'Sunset Planner', href: '/dashboard/sunset' },
    ],
  },
  {
    title: 'Revenue',
    items: [
      { label: 'Revenue Model', href: '/dashboard/revenue-model' },
      { label: 'Revenue at Risk', href: '/dashboard/revenue-at-risk' },
      { label: 'Scorecards', href: '/dashboard/scorecards' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { label: 'Alerts', href: '/dashboard/alerts' },
      { label: 'Alert Rules', href: '/dashboard/alert-rules' },
      { label: 'Notifications', href: '/dashboard/notifications' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Integrations', href: '/dashboard/integrations' },
      { label: 'Activity', href: '/dashboard/activity' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userName, setUserName] = useState<string>('')

  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await authClient.getSession()
      if (!active) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      setUserName(s.data.user.name ?? s.data.user.email ?? 'Account')
      setChecking(false)
    })()
    return () => { active = false }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
          <span className="text-sm">Loading workspace...</span>
        </div>
      </div>
    )
  }

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(href + '/')

  const nav = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{section.title}</div>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive(item.href)
                    ? 'bg-sky-500/15 font-medium text-sky-300'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
      <div className="border-t border-slate-800 pt-4">
        <Link
          href="/benchmarks"
          onClick={() => setMobileOpen(false)}
          className="block rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
        >
          Benchmarks
        </Link>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-800 bg-slate-900/60 lg:flex">
        <div className="flex h-16 items-center border-b border-slate-800 px-5">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-sm font-black text-slate-950">E</span>
            <span className="text-sm font-bold tracking-tight text-white">EmailDeliverabilityRevenueGuard</span>
          </Link>
        </div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/80" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-slate-800 bg-slate-900">
            <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
              <span className="text-sm font-bold text-white">EmailDeliverabilityRevenueGuard</span>
              <button onClick={() => setMobileOpen(false)} className="text-slate-500 hover:text-white" aria-label="Close menu">✕</button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-slate-300">{userName}</span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
