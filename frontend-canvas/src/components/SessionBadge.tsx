import { CheckCircle2, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { CanvasSession } from "@/types"

interface SessionBadgeProps {
  session: CanvasSession
  onForget: () => void
}

export function SessionBadge({ session, onForget }: SessionBadgeProps) {
  const host = session.baseUrl.replace(/^https?:\/\//, "")
  const tokenPreview =
    session.token.length > 10
      ? `${session.token.slice(0, 4)}\u2026${session.token.slice(-4)}`
      : "\u2022\u2022\u2022\u2022"

  return (
    <div className="glass-subtle flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="text-emerald-600 size-4" />
        <div className="min-w-0">
          <div className="truncate font-medium">{host}</div>
          <div className="text-muted-foreground font-mono text-xs">
            {tokenPreview}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onForget}
        className="text-muted-foreground hover:text-destructive"
      >
        <LogOut className="size-4" />
        Forget
      </Button>
    </div>
  )
}
