import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isConfigured, serverError, supabase } from './lib/supabase'
import { SpaceProvider } from './lib/store'
import { Button, Splash, Toaster, errorMessage, toast } from './components/ui'
import { pendingInvite } from './lib/invite'
import { AuthLayout, AuthScreen, NewPasswordScreen, useAuth } from './features/auth'
import { SpaceSetup } from './features/space-setup'
import { Shell } from './features/shell'

export default function App() {
  return (
    <>
      {isConfigured ? <Root /> : <NotConfigured />}
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
  const [spaceId, setSpaceId] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    supabase
      .from('members')
      .select('space_id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) return setError(errorMessage(serverError(error)))
        // Each account belongs to one space, so an invite opened after
        // joining one has nothing to do.
        if (data?.space_id && pendingInvite.get()) {
          pendingInvite.clear()
          toast("You're already in a space, so that invite wasn't used")
        }
        setSpaceId(data?.space_id ?? null)
      })
    return () => {
      alive = false
    }
  }, [user.id, attempt])

  if (error) {
    return (
      <AuthLayout subtitle="Couldn't reach the server.">
        <p className="mb-6 text-center text-sm text-muted">{error}</p>
        <Button
          className="w-full"
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </Button>
      </AuthLayout>
    )
  }
  if (spaceId === undefined) return <Splash />
  if (spaceId === null) return <SpaceSetup email={user.email ?? ''} onReady={setSpaceId} />
  return (
    <SpaceProvider spaceId={spaceId} user={user}>
      <Shell />
    </SpaceProvider>
  )
}

function NotConfigured() {
  return (
    <AuthLayout subtitle="Almost there: connect your Supabase project.">
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          Run <code className="rounded bg-surface-2 px-1">supabase/migrations/…_init.sql</code> in your project's SQL editor.
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
