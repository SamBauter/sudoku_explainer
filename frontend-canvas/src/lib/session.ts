import type { CanvasSession } from "@/types"

const STORAGE_KEY = "canvas_session_v1"

/**
 * Persisting the Canvas PAT in localStorage is a deliberate trade-off:
 * it's more convenient than re-pasting per session, and the token
 * already has to live *somewhere* in the browser's memory to be sent
 * on each request. The UI exposes a clear "forget" action so teachers
 * can wipe it when they finish a session or step away from a shared
 * machine. The backend never sees or stores the token beyond the
 * lifetime of the request it's attached to.
 */
export function loadSession(): CanvasSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CanvasSession>
    if (typeof parsed.token !== "string" || !parsed.token) return null
    if (typeof parsed.baseUrl !== "string" || !parsed.baseUrl) return null
    return { token: parsed.token, baseUrl: parsed.baseUrl }
  } catch {
    return null
  }
}

export function saveSession(session: CanvasSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed) return trimmed
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return trimmed
}
