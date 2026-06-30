import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EmailDeliverabilityRevenueGuard',
  description: 'Dollarize email deliverability decay and list rot. Turn Gmail/Yahoo enforcement thresholds into a revenue-at-risk early-warning system.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
