import type { ClearStats } from "@/types"

interface TotalsCardProps {
  title: string
  totals: ClearStats
  dryRun: boolean
}

export function TotalsCard({ title, totals, dryRun }: TotalsCardProps) {
  return (
    <div className="glass-subtle rounded-lg px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {dryRun ? (
          <span className="bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 text-xs font-medium">
            Dry run
          </span>
        ) : null}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Scanned" value={totals.scanned} />
        <Stat label="Skipped" value={totals.skipped} />
        <Stat
          label={dryRun ? "Would clear" : "Cleared"}
          value={totals.cleared}
          accent
        />
      </dl>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div>
      <div
        className={
          accent
            ? "text-emerald-700 text-2xl font-semibold tabular-nums"
            : "text-foreground text-2xl font-semibold tabular-nums"
        }
      >
        {value}
      </div>
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
    </div>
  )
}
