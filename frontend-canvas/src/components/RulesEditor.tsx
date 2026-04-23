import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { newRule } from "@/lib/rename"
import type { RenameRule } from "@/types"

interface RulesEditorProps {
  rules: RenameRule[]
  onChange: (rules: RenameRule[]) => void
}

export function RulesEditor({ rules, onChange }: RulesEditorProps) {
  function updateRule(id: string, patch: Partial<RenameRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeRule(id: string) {
    onChange(rules.filter((r) => r.id !== id))
  }

  function addRule() {
    onChange([...rules, newRule()])
  }

  function move(id: string, delta: -1 | 1) {
    const i = rules.findIndex((r) => r.id === id)
    if (i < 0) return
    const j = i + delta
    if (j < 0 || j >= rules.length) return
    const next = rules.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Rules</Label>
        <Button size="sm" variant="outline" onClick={addRule}>
          <Plus className="size-4" />
          Add rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="text-muted-foreground glass-subtle rounded-lg px-3 py-4 text-sm">
          No rules yet. Add one above, or edit proposed names directly in the
          table below.
        </p>
      ) : null}

      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div
            key={rule.id}
            className="glass-subtle grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 rounded-lg px-2 py-2"
          >
            <Checkbox
              checked={rule.enabled}
              onCheckedChange={(v) =>
                updateRule(rule.id, { enabled: v === true })
              }
              aria-label="Enable rule"
            />
            <Input
              placeholder="Find"
              value={rule.find}
              onChange={(e) => updateRule(rule.id, { find: e.target.value })}
              spellCheck={false}
              className="font-mono text-sm"
            />
            <span className="text-muted-foreground text-xs select-none">
              &rarr;
            </span>
            <Input
              placeholder="Replace with (blank = remove)"
              value={rule.replace}
              onChange={(e) =>
                updateRule(rule.id, { replace: e.target.value })
              }
              spellCheck={false}
              className="font-mono text-sm"
            />
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => move(rule.id, -1)}
                disabled={i === 0}
                aria-label="Move rule up"
                className="size-8"
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => move(rule.id, 1)}
                disabled={i === rules.length - 1}
                aria-label="Move rule down"
                className="size-8"
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeRule(rule.id)}
                aria-label="Remove rule"
                className="text-muted-foreground hover:text-destructive size-8"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
