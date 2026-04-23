import type { RenameRule } from "@/types"

/**
 * Collapse runs of whitespace to a single space and trim the edges.
 * Rules that remove text ("Python Turtles " -> "") often leave double
 * spaces behind; this runs once at the end of the rule pipeline so
 * the user doesn't have to think about it.
 */
export function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/**
 * Apply the user's literal find/replace rules in order, then collapse
 * whitespace. Does NOT truncate — names still over the length cap are
 * surfaced as "over limit" warnings in the UI so the teacher can decide
 * whether to auto-truncate, tweak a rule, or hand-edit. Pure function,
 * safe to call in render.
 */
export function applyRules(name: string, rules: RenameRule[]): string {
  let out = name
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (!rule.find) continue
    // split+join is the simplest way to replace every occurrence of a
    // literal string without worrying about regex-escaping.
    out = out.split(rule.find).join(rule.replace)
  }
  return normaliseWhitespace(out)
}

/**
 * Hard-clip a string to `maxLength` characters from the end, trimming
 * any trailing whitespace left behind. Used by the per-row "truncate"
 * button for names that rules alone couldn't get under the cap.
 */
export function truncateEnd(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength).trimEnd()
}

export function newRule(): RenameRule {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `r-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    enabled: true,
    find: "",
    replace: "",
  }
}
