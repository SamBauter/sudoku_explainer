import { Eraser, FlaskConical, Lightbulb, Play, SkipForward } from "lucide-react"

import { Button } from "@/components/ui/button"

interface ToolbarProps {
  onLoadExample: () => void
  onSolve: () => void
  onClear: () => void
  onToggleCandidates: () => void
  showCandidates: boolean
  solving: boolean
  hasSolution: boolean
}

export function Toolbar({
  onLoadExample,
  onSolve,
  onClear,
  onToggleCandidates,
  showCandidates,
  solving,
  hasSolution,
}: ToolbarProps) {
  const glassOutline =
    "border border-white/70 bg-white/40 text-slate-800 shadow-sm backdrop-blur-md hover:bg-white/60 hover:text-slate-900"
  const glassSecondary =
    "border border-white/70 bg-white/70 text-slate-900 shadow-sm backdrop-blur-md hover:bg-white/85"
  const glassGhost =
    "text-slate-700 hover:bg-white/50 hover:text-slate-900"
  const glassPrimary =
    "border border-slate-900/15 bg-slate-900/85 text-white shadow-md backdrop-blur-md hover:bg-slate-900"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onLoadExample}
        className={glassOutline}
      >
        <FlaskConical className="size-4" />
        Load example
      </Button>
      <Button
        variant={showCandidates ? "secondary" : "outline"}
        size="sm"
        onClick={onToggleCandidates}
        className={showCandidates ? glassSecondary : glassOutline}
      >
        <Lightbulb className="size-4" />
        {showCandidates ? "Hide candidates" : "Show candidates"}
      </Button>
      <Button
        size="sm"
        onClick={onSolve}
        disabled={solving}
        className={glassPrimary}
      >
        {hasSolution ? (
          <SkipForward className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
        {solving
          ? "Solving..."
          : hasSolution
            ? "Find next solution"
            : "Solve"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className={glassGhost}
      >
        <Eraser className="size-4" />
        Clear
      </Button>
    </div>
  )
}
