export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-stone-700 border-t-rose-400 ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function PageLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-stone-400">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export default Spinner
