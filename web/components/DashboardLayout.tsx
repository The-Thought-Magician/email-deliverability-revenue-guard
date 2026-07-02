'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import CommandPalette, { type CommandRoute } from './CommandPalette'

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
  {
    title: 'General',
    items: [{ label: 'Benchmarks', href: '/benchmarks' }],
  },
]

const routes: CommandRoute[] = sections.flatMap((s) => s.items.map((i) => ({ label: i.label, href: i.href, group: s.title })))

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
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
      <div className="flex min-h-screen items-center justify-center bg-stone-950">
        <div className="flex items-center gap-3 text-stone-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-stone-700 border-t-rose-400" />
          <span className="text-sm">Loading workspace...</span>
        </div>
      </div>
    )
  }

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(href + '/')

  return (
    <div className="min-h-screen bg-stone-950">
      <CommandPalette routes={routes} open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Slim persistent top bar — command-palette-first chrome */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-800 bg-stone-950/90 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRailOpen((v) => !v)}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-white lg:hidden"
            aria-label="Toggle routes"
          >
            ☰
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500 text-xs font-black text-stone-950">E</span>
            <span className="hidden text-sm font-bold tracking-tight text-white sm:inline">EmailDeliverabilityRevenueGuard</span>
          </Link>
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-1.5 text-sm text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200"
        >
          <span>Jump to...</span>
          <kbd className="rounded border border-stone-700 px-1.5 py-0.5 font-mono text-[10px] text-stone-500">⌘K</kbd>
        </button>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-stone-400 sm:inline">{userName}</span>
          <button
            onClick={signOut}
            className="rounded-lg border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:bg-stone-800 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Collapsible route rail (mobile / fallback nav; palette is primary) */}
      {railOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-stone-950/80" onClick={() => setRailOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-y-auto border-r border-stone-800 bg-stone-900 px-3 py-5">
            {sections.map((section) => (
              <div key={section.title} className="mb-5">
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-600">{section.title}</div>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setRailOpen(false)}
                      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive(item.href)
                          ? 'bg-rose-500/15 font-medium text-rose-300'
                          : 'text-stone-400 hover:bg-stone-800/70 hover:text-stone-100'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </aside>
        </div>
      )}

      {/* Desktop route rail — icon-minimal, always visible left strip linking into palette groups */}
      <div className="hidden border-b border-stone-900 bg-stone-950 px-6 py-2 lg:flex lg:gap-1 lg:overflow-x-auto">
        {sections.flatMap((s) => s.items).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors ${
              isActive(item.href) ? 'bg-rose-500/15 text-rose-300' : 'text-stone-500 hover:bg-stone-900 hover:text-stone-200'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
