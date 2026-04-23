import type {
  Assignment,
  CanvasSession,
  ClearStats,
  DateUpdateEvent,
  DateUpdateItem,
  PolicyKind,
  ProgressEvent,
  RenameEvent,
} from "@/types"

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8001"

function headers(session: CanvasSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.token}`,
  }
}

function buildUrl(
  path: string,
  session: CanvasSession,
  extra: Record<string, string | number | boolean> = {},
): string {
  const url = new URL(API_BASE.replace(/\/+$/, "") + path)
  url.searchParams.set("canvas_base_url", session.baseUrl)
  for (const [k, v] of Object.entries(extra)) {
    url.searchParams.set(k, String(v))
  }
  return url.toString()
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body?.detail === "string") return body.detail
  } catch {
    /* fall through */
  }
  return `${res.status} ${res.statusText}`
}

/**
 * Incrementally parse a `text/event-stream` body into a typed async
 * generator. We use fetch + ReadableStream instead of EventSource
 * because EventSource can't send an Authorization header.
 */
async function* readSse<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T, void, unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep = buffer.indexOf("\n\n")
    while (sep >= 0) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of chunk.split("\n")) {
        const m = line.match(/^data:\s?(.*)$/)
        if (!m) continue
        const payload = m[1]
        if (!payload) continue
        try {
          yield JSON.parse(payload) as T
        } catch {
          /* ignore malformed line */
        }
      }
      sep = buffer.indexOf("\n\n")
    }
  }
}

// ---------------------------------------------------------------------------
// Clear missing / clear late
// ---------------------------------------------------------------------------

export async function clearFlagForAssignment(
  session: CanvasSession,
  kind: PolicyKind,
  courseId: number,
  assignmentId: number,
  opts: { dryRun: boolean },
): Promise<ClearStats> {
  const url = buildUrl(
    `/api/courses/${courseId}/assignments/${assignmentId}/clear-${kind}`,
    session,
    { dry_run: opts.dryRun },
  )
  const res = await fetch(url, { method: "POST", headers: headers(session) })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as ClearStats
}

export async function* streamClearFlagForCourse(
  session: CanvasSession,
  kind: PolicyKind,
  courseId: number,
  opts: { dryRun: boolean; signal?: AbortSignal },
): AsyncGenerator<ProgressEvent, void, unknown> {
  const url = buildUrl(
    `/api/courses/${courseId}/clear-${kind}/stream`,
    session,
    { dry_run: opts.dryRun },
  )
  const res = await fetch(url, {
    method: "POST",
    headers: headers(session),
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(await parseError(res))
  if (!res.body) throw new Error("Missing response body for SSE stream")
  yield* readSse<ProgressEvent>(res.body)
}

// ---------------------------------------------------------------------------
// Assignment listing + rename
// ---------------------------------------------------------------------------

export async function listAssignments(
  session: CanvasSession,
  courseId: number,
): Promise<Assignment[]> {
  const url = buildUrl(`/api/courses/${courseId}/assignments`, session)
  const res = await fetch(url, { method: "GET", headers: headers(session) })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as Assignment[]
}

export async function* streamRenameAssignments(
  session: CanvasSession,
  courseId: number,
  renames: { id: number; new_name: string }[],
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<RenameEvent, void, unknown> {
  const url = buildUrl(`/api/courses/${courseId}/rename/stream`, session)
  const res = await fetch(url, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ renames }),
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(await parseError(res))
  if (!res.body) throw new Error("Missing response body for SSE stream")
  yield* readSse<RenameEvent>(res.body)
}

// ---------------------------------------------------------------------------
// Assignment dates bulk update
// ---------------------------------------------------------------------------

export async function* streamDateUpdates(
  session: CanvasSession,
  courseId: number,
  updates: DateUpdateItem[],
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<DateUpdateEvent, void, unknown> {
  const url = buildUrl(`/api/courses/${courseId}/dates/stream`, session)
  const res = await fetch(url, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ updates }),
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(await parseError(res))
  if (!res.body) throw new Error("Missing response body for SSE stream")
  yield* readSse<DateUpdateEvent>(res.body)
}
