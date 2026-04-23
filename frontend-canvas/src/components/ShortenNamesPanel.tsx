import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Download, Loader2, Play, RefreshCw, Square } from "lucide-react"
import { toast } from "sonner"

import { SearchBox } from "@/components/SearchBox"

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
import {
  listAssignments,
  streamRenameAssignments,
} from "@/lib/canvas"
import { applyRules } from "@/lib/rename"
import {
  loadMaxLength,
  loadRules,
  saveMaxLength,
  saveRules,
} from "@/lib/rulesStorage"
import type { Assignment, CanvasSession, RenameRule } from "@/types"

import {
  RenamePreviewTable,
  type PreviewRow,
} from "./RenamePreviewTable"
import { RulesEditor } from "./RulesEditor"

interface ShortenNamesPanelProps {
  session: CanvasSession
}

const DEFAULT_MAX_LENGTH = 50

function parseIntOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function ShortenNamesPanel({ session }: ShortenNamesPanelProps) {
  const [courseId, setCourseId] = useState("")
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [rules, setRules] = useState<RenameRule[]>(() => loadRules())
  const [maxLength, setMaxLength] = useState<number>(() =>
    loadMaxLength(DEFAULT_MAX_LENGTH),
  )

  useEffect(() => {
    saveRules(rules)
  }, [rules])
  useEffect(() => {
    saveMaxLength(maxLength)
  }, [maxLength])

  // Row-local UI state (manual overrides, selection, commit status).
  const [rowState, setRowState] = useState<
    Map<
      number,
      {
        override: string | null
        selected: boolean
        committedName?: string
        error?: string
      }
    >
  >(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const [filter, setFilter] = useState<"all" | "changed" | "unchanged">("all")
  const [search, setSearch] = useState("")

  const cid = parseIntOrNull(courseId)

  const rows: PreviewRow[] = useMemo(() => {
    return assignments.map((a) => {
      const ruleOutput = applyRules(a.name, rules)
      const state = rowState.get(a.id)
      const override = state?.override ?? null
      return {
        id: a.id,
        original: a.name,
        ruleOutput,
        override,
        // Selection is purely user-driven; the teacher picks rows with
        // the checkbox (or the header select-all over filtered/searched
        // results). `eligible` still filters out no-op / empty / over-
        // limit rows before anything reaches Canvas.
        selected: state?.selected ?? false,
        committedName: state?.committedName,
        error: state?.error,
      }
    })
  }, [assignments, rules, rowState])

  const selectedRows = rows.filter((r) => r.selected)
  const eligible = selectedRows.filter(
    (r) =>
      (r.override ?? r.ruleOutput) !== r.original &&
      (r.override ?? r.ruleOutput).length > 0 &&
      (r.override ?? r.ruleOutput).length <= maxLength,
  )
  const noopSelected = selectedRows.length - eligible.length

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.original.toLowerCase().includes(q))
  }, [rows, search])

  // Counts reflect the search-scoped set, so switching tabs shows what
  // you'd see staying within the current search.
  const changedCount = searchMatches.reduce(
    (n, r) => ((r.override ?? r.ruleOutput) !== r.original ? n + 1 : n),
    0,
  )
  const unchangedCount = searchMatches.length - changedCount

  const visibleRows: PreviewRow[] = useMemo(() => {
    if (filter === "all") return searchMatches
    if (filter === "changed") {
      return searchMatches.filter(
        (r) => (r.override ?? r.ruleOutput) !== r.original,
      )
    }
    return searchMatches.filter(
      (r) => (r.override ?? r.ruleOutput) === r.original,
    )
  }, [searchMatches, filter])

  async function handleLoad() {
    if (!cid) return
    setLoading(true)
    setRowState(new Map())
    try {
      const list = await listAssignments(session, cid)
      setAssignments(list)
      if (list.length === 0) {
        toast.message("No assignments found for that course.")
      } else {
        toast.success(`Loaded ${list.length} assignments.`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(message)
      setAssignments([])
    } finally {
      setLoading(false)
    }
  }

  function patchRow(id: number, patch: Partial<PreviewRow>) {
    setRowState((prev) => {
      const next = new Map(prev)
      const existing = next.get(id) ?? { override: null, selected: false }
      const base = {
        override: existing.override,
        selected: existing.selected,
        committedName: existing.committedName,
        error: existing.error,
      }
      if ("override" in patch) base.override = patch.override ?? null
      if ("selected" in patch) base.selected = patch.selected ?? false
      next.set(id, base)
      return next
    })
  }

  function toggleAll(selected: boolean) {
    setRowState((prev) => {
      const next = new Map(prev)
      // Toggle every currently visible row. Ineligible rows (no
      // change, empty, over-limit) are still filtered out at apply
      // time, so a broad select-all is safe — the worst case is a
      // no-op commit that never reaches Canvas.
      for (const row of visibleRows) {
        const existing = next.get(row.id) ?? {
          override: row.override,
          selected: false,
        }
        next.set(row.id, { ...existing, selected })
      }
      return next
    })
  }

  function handleDownloadBackup() {
    const backup = assignments.map((a) => ({ id: a.id, name: a.name }))
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `canvas-course-${cid}-assignments-backup.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleApply() {
    if (!cid) return
    if (eligible.length === 0) {
      toast.message("Nothing to rename.")
      return
    }

    const ok = window.confirm(
      `Rename ${eligible.length} ${eligible.length === 1 ? "assignment" : "assignments"} in course ${cid}? ` +
        "Students will see the new names immediately. Consider downloading a backup first.",
    )
    if (!ok) return

    setBusy(true)
    const payload = eligible.map((r) => ({
      id: r.id,
      new_name: r.override ?? r.ruleOutput,
    }))

    // Clear any stale committed/error markers so new results stand out.
    setRowState((prev) => {
      const next = new Map(prev)
      for (const { id } of eligible) {
        const existing = next.get(id) ?? { override: null, selected: true }
        next.set(id, {
          override: existing.override,
          selected: existing.selected,
          committedName: undefined,
          error: undefined,
        })
      }
      return next
    })

    try {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      for await (const ev of streamRenameAssignments(
        session,
        cid,
        payload,
        { signal: ctrl.signal },
      )) {
        if (ev.kind === "renamed") {
          const name = ev.new_name
          const id = ev.assignment_id
          setRowState((prev) => {
            const next = new Map(prev)
            const existing = next.get(id) ?? { override: null, selected: true }
            next.set(id, {
              ...existing,
              committedName: name,
              error: undefined,
            })
            return next
          })
          setAssignments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, name } : a)),
          )
        } else if (ev.kind === "error" && ev.assignment_id != null) {
          const id = ev.assignment_id
          const err = ev.error
          setRowState((prev) => {
            const next = new Map(prev)
            const existing = next.get(id) ?? { override: null, selected: true }
            next.set(id, { ...existing, error: err })
            return next
          })
        } else if (ev.kind === "done") {
          toast.success(
            `Renamed ${ev.renamed} of ${eligible.length} assignment(s).`,
          )
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

  return (
    <Card className="glass-strong border-0">
      <CardHeader>
        <CardTitle className="text-lg">Shorten assignment names</CardTitle>
        <CardDescription>
          Apply a list of literal find/replace rules, then rename assignments
          in Canvas. Names still over the character cap after rules run are
          flagged as <em>needs truncation</em>&mdash;click the scissors to
          clip the end, or edit the row by hand before committing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="rename-course-id">Course ID</Label>
            <Input
              id="rename-course-id"
              inputMode="numeric"
              placeholder="e.g. 123456"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              disabled={loading || busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-max-length">Max length</Label>
            <Input
              id="rename-max-length"
              type="number"
              inputMode="numeric"
              min={1}
              max={255}
              value={maxLength}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n > 0 && n <= 255) setMaxLength(n)
              }}
              disabled={busy}
              className="w-24"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleLoad}
              disabled={!cid || loading || busy}
              variant="secondary"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {loading ? "Loading\u2026" : "Load assignments"}
            </Button>
          </div>
        </div>

        <RulesEditor rules={rules} onChange={setRules} />

        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="glass-subtle inline-flex rounded-lg p-1 text-sm">
              <FilterButton
                active={filter === "all"}
                onClick={() => setFilter("all")}
                count={searchMatches.length}
              >
                All
              </FilterButton>
              <FilterButton
                active={filter === "changed"}
                onClick={() => setFilter("changed")}
                count={changedCount}
              >
                Would change
              </FilterButton>
              <FilterButton
                active={filter === "unchanged"}
                onClick={() => setFilter("unchanged")}
                count={unchangedCount}
              >
                Unchanged
              </FilterButton>
            </div>

            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search original name, e.g. &ldquo;Arguments and Parameters&rdquo;"
            />
          </div>
        ) : null}

        {rows.length > 0 && visibleRows.length === 0 ? (
          <div className="glass-subtle text-muted-foreground rounded-lg p-4 text-center text-sm">
            No assignments match the current filter
            {search ? ` / search for "${search}"` : ""}.
          </div>
        ) : (
          <RenamePreviewTable
            rows={visibleRows}
            maxLength={maxLength}
            onChange={patchRow}
            onToggleAll={toggleAll}
            disabled={busy}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleApply}
            disabled={busy || eligible.length === 0}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {busy
              ? "Renaming\u2026"
              : eligible.length
                ? selectedRows.length > eligible.length
                  ? `Rename ${eligible.length} of ${selectedRows.length} selected`
                  : `Rename ${eligible.length} selected`
                : selectedRows.length > 0
                  ? "Selected rows can\u2019t be renamed (empty, over limit, or unchanged)"
                  : "Nothing selected"}
          </Button>
          {busy ? (
            <Button variant="outline" onClick={handleCancel}>
              <Square className="size-4" />
              Stop
            </Button>
          ) : null}
          {noopSelected > 0 && eligible.length > 0 ? (
            <span className="text-muted-foreground text-xs">
              {noopSelected} selected row{noopSelected === 1 ? "" : "s"} will be
              skipped (unchanged, empty, or over the {maxLength}-char limit).
            </span>
          ) : null}
          <Button
            variant="ghost"
            onClick={handleDownloadBackup}
            disabled={busy || assignments.length === 0}
            className="ml-auto"
          >
            <Download className="size-4" />
            Download backup JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FilterButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium shadow-xs"
          : "text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium"
      }
    >
      {children}
      <span
        className={
          active
            ? "bg-primary-foreground/20 text-primary-foreground rounded-full px-1.5 text-xs tabular-nums"
            : "bg-foreground/10 text-muted-foreground rounded-full px-1.5 text-xs tabular-nums"
        }
      >
        {count}
      </span>
    </button>
  )
}
