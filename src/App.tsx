import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isConfigured } from './lib/supabase'
import { SpaceProvider } from './lib/store'
import { Button, Splash, Toaster, errorMessage } from './components/ui'
import { ErrorBoundary } from './components/error-boundary'
import { pendingInvite } from './lib/invite'
import { lastOpenedSpace, loadMySpaceIds, spaceToOpen } from './lib/spaces'
import { AuthLayout, AuthScreen, NewPasswordScreen, useAuth } from './features/auth'
import { SpaceSetup } from './features/space-setup'
import { Shell } from './features/shell'
import { SpaceSwitchContext } from './features/space-switcher'

export default function App() {
  return (
    <>
      <ErrorBoundary>{isConfigured ? <Root /> : <NotConfigured />}</ErrorBoundary>
      <Toaster />
    </>
  )
}

function Root() {
  const { session, recovering, doneRecovering } = useAuth()
  if (session === undefined) return <Splash />
  if (recovering) return <NewPasswordScreen onDone={doneRecovering} />
  if (!session) return <AuthScreen />
  return <SpaceGate key={session.user.id} user={session.user} />
}

function SpaceGate({ user }: { user: User }) {
  const mySpaces = useMySpaces(user.id)
  const choice = useSpaceChoice()
  if (mySpaces.error) return <ConnectionProblem error={mySpaces.error} onRetry={mySpaces.retry} />
  if (mySpaces.spaceIds === undefined) return <Splash />
  const currentId = choice.chosenId ?? spaceToOpen(mySpaces.spaceIds, lastOpenedSpace.get())
  if (!currentId || choice.adding) {
    const joined = (spaceId: string) => {
      mySpaces.add(spaceId)
      choice.open(spaceId)
    }
    return <SpaceSetup email={user.email ?? ''} onReady={joined} onCancel={currentId ? choice.stopAdding : undefined} />
  }
  const spaceSwitch = { userId: user.id, spaceIds: mySpaces.spaceIds, currentId, open: choice.open, addSpace: choice.startAdding }
  return (
    <SpaceSwitchContext.Provider value={spaceSwitch}>
      {/* Keyed by space, so switching starts the store, the room and the key afresh. */}
      <SpaceProvider key={currentId} spaceId={currentId} user={user}>
        <Shell />
      </SpaceProvider>
    </SpaceSwitchContext.Provider>
  )
}

/** Which space is open, and whether the screen for starting or joining another one is showing. */
function useSpaceChoice() {
  const [chosenId, setChosenId] = useState<string | null>(null)
  // An invite link opened while signed in goes straight to joining that space.
  const [adding, setAdding] = useState(() => pendingInvite.get() !== null)
  const open = (spaceId: string) => {
    lastOpenedSpace.set(spaceId)
    setChosenId(spaceId)
    setAdding(false)
  }
  return { chosenId, adding, open, startAdding: () => setAdding(true), stopAdding: () => setAdding(false) }
}

/** The spaces this account is in, oldest first; undefined while loading. */
function useMySpaces(userId: string) {
  const [spaceIds, setSpaceIds] = useState<string[] | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    loadMySpaceIds(userId).then(
      (ids) => {
        if (alive) setSpaceIds(ids)
      },
      (e) => {
        if (alive) setError(errorMessage(e))
      },
    )
    return () => {
      alive = false
    }
  }, [userId, attempt])
  const retry = () => {
    setError(null)
    setAttempt((n) => n + 1)
  }
  const add = (spaceId: string) => setSpaceIds((ids = []) => (ids.includes(spaceId) ? ids : [...ids, spaceId]))
  return { spaceIds, error, retry, add }
}

function ConnectionProblem({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <AuthLayout subtitle="Couldn't reach the server.">
      <p className="mb-6 text-center text-sm text-muted">{error}</p>
      <Button className="w-full" onClick={onRetry}>
        Try again
      </Button>
    </AuthLayout>
  )
}

function NotConfigured() {
  return (
    <AuthLayout subtitle="Almost there: connect your Supabase project.">
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          Run every file in <code className="rounded bg-surface-2 px-1">supabase/migrations/</code>, in order, in your project's SQL editor.
        </li>
        <li>
          Copy <code className="rounded bg-surface-2 px-1">.env.example</code> to{' '}
          <code className="rounded bg-surface-2 px-1">.env.local</code> and fill in the URL and publishable key.
        </li>
        <li>Restart the dev server.</li>
      </ol>
      <p className="mt-6 text-center text-sm text-muted">The README has the full walkthrough.</p>
    </AuthLayout>
  )
}
