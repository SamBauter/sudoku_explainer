import { useState, type FormEvent } from "react"
import { KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { normaliseBaseUrl } from "@/lib/session"
import type { CanvasSession } from "@/types"

interface TokenFormProps {
  onConnect: (session: CanvasSession) => void
  defaultBaseUrl?: string
}

export function TokenForm({ onConnect, defaultBaseUrl }: TokenFormProps) {
  const [token, setToken] = useState("")
  const [baseUrl, setBaseUrl] = useState(
    defaultBaseUrl ?? "https://canvas.instructure.com",
  )
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const cleanedToken = token.trim()
    const cleanedUrl = normaliseBaseUrl(baseUrl)
    if (!cleanedToken) {
      setError("Paste your Canvas personal access token.")
      return
    }
    if (!cleanedUrl) {
      setError("Enter your institution's Canvas URL.")
      return
    }
    setError(null)
    onConnect({ token: cleanedToken, baseUrl: cleanedUrl })
  }

  return (
    <Card className="glass border-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="size-4" />
          Connect to Canvas
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="canvas-host">Canvas URL</Label>
            <Input
              id="canvas-host"
              type="url"
              placeholder="https://myschool.instructure.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoComplete="url"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              The base address of your Canvas tenant.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="canvas-token">Personal access token</Label>
            <Input
              id="canvas-token"
              type="password"
              placeholder="Paste your token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              Generate one under{" "}
              <span className="font-medium">
                Account → Settings → Approved Integrations → New Access Token
              </span>
              . Stored only in this browser; sent to our backend on each
              request and never persisted server-side.
            </p>
          </div>

          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}

          <Button type="submit" className="w-full">
            Connect
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
