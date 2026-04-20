import type { Board, ExampleResponse, SoftConfig, SolveResponse } from "@/types"

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body?.detail === "string" ? body.detail : detail
    } catch {
      /* noop */
    }
    throw new Error(`${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

export function fetchExample(): Promise<ExampleResponse> {
  return request<ExampleResponse>("/api/example")
}

export function solveBoard(
  board: Board,
  excluded: Board[] = [],
  soft?: SoftConfig | null,
): Promise<SolveResponse> {
  return request<SolveResponse>("/api/solve", {
    method: "POST",
    body: JSON.stringify({ board, excluded, soft: soft ?? null }),
  })
}
