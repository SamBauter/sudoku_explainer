import { useRef, useState } from "react"
import { Loader2, Play, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  clearFlagForAssignment,
  streamClearFlagForCourse,
} from "@/lib/canvas"
import type {
  CanvasSession,
  ClearStats,
  PolicyKind,
  ProgressEvent,
} from "@/types"

import { ProgressList } from "./ProgressList"
import { TotalsCard } from "./TotalsCard"

type Scope = "single" | "course"

interface ClearPanelProps {
  session: CanvasSession
  kind: PolicyKind
}

interface KindCopy {
  title: string
  description: React.ReactNode
  verb: string
  flagNoun: string
}

const COPY: Record<PolicyKind, KindCopy> = {
  missing: {
    title: "Clear \u201cMissing\u201d status",
    flagNoun: "missing",
    verb: "Clear missing",
    description: (
      <>
        Canvas flags submissions as{" "}
        <span className="font-medium">missing</span> even after a student turns
        in late work with a non-zero score. This tool clears the missing flag
        on submissions whose score is anything other than exactly{" "}
        <span className="font-medium">0</span>. True zeros are left alone.
      </>
    ),
  },
  late: {
    title: "Clear \u201cLate\u201d status",
    flagNoun: "late",
    verb: "Clear late",
    description: (
      <>
        Canvas keeps a <span className="font-medium">late</span> flag on
        submissions turned in after the due date. This tool clears the late
        flag on submissions whose score is anything other than exactly{" "}
        <span className="font-medium">0</span>, so a teacher can retroactively
        accept late work without wiping genuine zeros.
      </>
    ),
  },
}

function parseIntOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function ClearPanel({ session, kind }: ClearPanelProps) {
  const copy = COPY[kind]

  const [scope, setScope] = useState<Scope>("single")
  const [courseId, setCourseId] = useState("")
  const [assignmentId, setAssignmentId] = useState("")
  const [dryRun, setDryRun] = useState(true)

  const [busy, setBusy] = useState(false)
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [singleStats, setSingleStats] = useState<ClearStats | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cid = parseIntOrNull(courseId)
  const aid = parseIntOrNull(assignmentId)
  const canRun =
    cid !== null && (scope === "course" || aid !== null) && !busy

  const courseTotals =
    events.find((e): e is Extract<ProgressEvent, { kind: "done" }> =>
      e.kind === "done",
    )?.totals ?? null

  function reset() {
    setEvents([])
    setSingleStats(null)
  }

  async function handleRun() {
    if (!cid) return
    reset()
    setBusy(true)

    try {
      if (scope === "single") {
        if (!aid) return
        const stats = await clearFlagForAssignment(session, kind, cid, aid, {
          dryRun,
        })
        setSingleStats(stats)
        toast.success(
          dryRun
            ? `Dry run: would clear ${stats.cleared} ${copy.flagNoun} submission(s).`
            : `Cleared ${copy.flagNoun} on ${stats.cleared} submission(s).`,
        )
      } else {
        const ctrl = new AbortController()
        abortRef.current = ctrl
        for await (const ev of streamClearFlagForCourse(session, kind, cid, {
          dryRun,
          signal: ctrl.signal,
        })) {
          setEvents((prev) => [...prev, ev])
          if (ev.kind === "done") {
            toast.success(
              dryRun
                ? `Dry run complete. Would clear ${ev.totals.cleared} ${copy.flagNoun} submission(s).`
                : `Course complete. Cleared ${ev.totals.cleared} ${copy.flagNoun} submission(s).`,
            )
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.toLowerCase().includes("abort")) {
        toast.error(message)
      }
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
  }

  const runLabel = scope === "single"
    ? (dryRun ? "Preview" : copy.verb)
    : (dryRun ? "Preview course" : `Run on course`)

  return (
    <Card className="glass-strong border-0">
      <CardHeader>
        <CardTitle className="text-lg">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="glass-subtle inline-flex rounded-lg p-1 text-sm">
          <ScopeButton
            active={scope === "single"}
            onClick={() => setScope("single")}
          >
            Single assignment
          </ScopeButton>
          <ScopeButton
            active={scope === "course"}
            onClick={() => setScope("course")}
          >
            Whole course
          </ScopeButton>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-course-id`}>Course ID</Label>
            <Input
              id={`${kind}-course-id`}
              inputMode="numeric"
              placeholder="e.g. 123456"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              disabled={busy}
            />
          </div>
          {scope === "single" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${kind}-assignment-id`}>Assignment ID</Label>
              <Input
                id={`${kind}-assignment-id`}
                inputMode="numeric"
                placeholder="e.g. 7890123"
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
                disabled={busy}
              />
            </div>
          ) : null}
        </div>

        <div className="glass-subtle flex items-start justify-between gap-4 rounded-lg px-3 py-3">
          <div>
            <Label
              htmlFor={`${kind}-dry-run`}
              className="cursor-pointer text-sm font-medium"
            >
              Dry run
            </Label>
            <p className="text-muted-foreground mt-1 text-xs">
              Scan and report what would change, without touching Canvas. Turn
              off only when you&apos;re ready to commit.
            </p>
          </div>
          <Switch
            id={`${kind}-dry-run`}
            checked={dryRun}
            onCheckedChange={setDryRun}
            disabled={busy}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleRun} disabled={!canRun}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {busy ? "Running\u2026" : runLabel}
          </Button>
          {busy && scope === "course" ? (
            <Button variant="outline" onClick={handleCancel}>
              <Square className="size-4" />
              Stop
            </Button>
          ) : null}
        </div>

        {singleStats ? (
          <TotalsCard
            title="Assignment result"
            totals={singleStats}
            dryRun={dryRun}
          />
        ) : null}

        {scope === "course" && events.length > 0 ? (
          <div className="space-y-4">
            {courseTotals ? (
              <TotalsCard
                title="Course totals"
                totals={courseTotals}
                dryRun={dryRun}
              />
            ) : null}
            <ProgressList events={events} kind={kind} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ScopeButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium shadow-xs"
          : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 font-medium"
      }
    >
      {children}
    </button>
  )
}
