import { useState } from "react"

import { ClearPanel } from "@/components/ClearPanel"
import { DatesPanel } from "@/components/DatesPanel"
import { SessionBadge } from "@/components/SessionBadge"
import { ShortenNamesPanel } from "@/components/ShortenNamesPanel"
import { TokenForm } from "@/components/TokenForm"
import { Toaster } from "@/components/ui/sonner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { clearSession, loadSession, saveSession } from "@/lib/session"
import type { CanvasSession } from "@/types"

export default function App() {
  // Lazy initializer reads localStorage once on mount without an effect,
  // so there's no flash-of-login-screen for returning users.
  const [session, setSession] = useState<CanvasSession | null>(() =>
    loadSession(),
  )

  function handleConnect(next: CanvasSession) {
    saveSession(next)
    setSession(next)
  }

  function handleForget() {
    clearSession()
    setSession(null)
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-6 pt-10 pb-6">
        <div className="mx-auto max-w-4xl">
          <div className="text-white/80 text-xs uppercase tracking-[0.2em]">
            Canvas teacher tools
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-white">
            Batch-fix gradebook plumbing in Canvas
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/80">
            Clear over-eager late-policy flags, shorten assignment names for
            downstream SIS exports, and shift due dates across a unit in one
            pass. Runs against your Canvas tenant using your own personal
            access token.
          </p>
        </div>
      </header>

      <main className="flex-1 px-6 pb-16">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          {session ? (
            <>
              <SessionBadge session={session} onForget={handleForget} />
              <Tabs defaultValue="missing" className="gap-4">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="missing">Clear missing</TabsTrigger>
                  <TabsTrigger value="late">Clear late</TabsTrigger>
                  <TabsTrigger value="rename">Shorten names</TabsTrigger>
                  <TabsTrigger value="dates">Edit dates</TabsTrigger>
                </TabsList>
                <TabsContent value="missing">
                  <ClearPanel session={session} kind="missing" />
                </TabsContent>
                <TabsContent value="late">
                  <ClearPanel session={session} kind="late" />
                </TabsContent>
                <TabsContent value="rename">
                  <ShortenNamesPanel session={session} />
                </TabsContent>
                <TabsContent value="dates">
                  <DatesPanel session={session} />
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <div className="mx-auto max-w-2xl">
              <TokenForm onConnect={handleConnect} />
            </div>
          )}
        </div>
      </main>

      <footer className="px-6 pb-6 text-center text-xs text-white/60">
        Your token never leaves your browser except as an{" "}
        <code className="font-mono">Authorization</code> header on each API
        call.
      </footer>

      <Toaster position="top-right" richColors />
    </div>
  )
}
