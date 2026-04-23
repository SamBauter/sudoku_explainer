import type { RenameRule } from "@/types"

const KEY = "canvas_rename_rules_v1"
const MAX_KEY = "canvas_rename_max_length_v1"

export function loadRules(): RenameRule[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is RenameRule =>
        typeof r?.id === "string" &&
        typeof r?.enabled === "boolean" &&
        typeof r?.find === "string" &&
        typeof r?.replace === "string",
    )
  } catch {
    return []
  }
}

export function saveRules(rules: RenameRule[]): void {
  localStorage.setItem(KEY, JSON.stringify(rules))
}

export function loadMaxLength(fallback: number): number {
  try {
    const raw = localStorage.getItem(MAX_KEY)
    if (!raw) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 && n <= 255 ? n : fallback
  } catch {
    return fallback
  }
}

export function saveMaxLength(n: number): void {
  localStorage.setItem(MAX_KEY, String(n))
}
