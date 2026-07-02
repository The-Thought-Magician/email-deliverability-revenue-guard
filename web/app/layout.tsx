import type { Metadata } from 'next'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'EmailDeliverabilityRevenueGuard',
  description: 'Dollarize email deliverability decay and list rot. Turn Gmail/Yahoo enforcement thresholds into a revenue-at-risk early-warning system.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="bg-stone-950 text-stone-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
