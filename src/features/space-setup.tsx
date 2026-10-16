import { useState, type FormEvent } from 'react'
import { Copy, Share2 } from 'lucide-react'
import { must, supabase } from '../lib/supabase'
import { signOut } from '../lib/session'
import { Button, Field, Input, errorMessage, toast, toastError } from '../components/ui'
import { AuthLayout } from './auth'

export const formatCode = (code: string) => code.replace(/^(.{4})(.+)$/, '$1-$2')

export async function shareInvite(code: string) {
  const text = `Join me on Duo! Open ${location.origin}, create an account, and enter our code: ${formatCode(code)}`
  if (navigator.share) {
    try {
      await navigator.share({ text })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  await navigator.clipboard.writeText(text)
  toast('Invite copied')
}

export function InviteCode({ code }: { code: string }) {
  return (
    <div className="rounded-2xl bg-accent-soft p-4 text-center">
      <div className="font-mono text-3xl font-bold tracking-[0.2em] text-accent">{formatCode(code)}</div>
      <div className="mt-3 flex justify-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy />}
          onClick={() => navigator.clipboard.writeText(formatCode(code)).then(() => toast('Code copied'), toastError)}
        >
          Copy
        </Button>
        <Button size="sm" icon={<Share2 />} onClick={() => shareInvite(code).catch(toastError)}>
          Send invite
        </Button>
      </div>
    </div>
  )
}

/** First run after signing in: start a space, or join your person's with their code. */
export function SpaceSetup({ email, onReady }: { email: string; onReady: (spaceId: string) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Names are asked for after the passphrase, so they can be encrypted.
      onReady(await must<string>(mode === 'create' ? supabase.rpc('create_space') : supabase.rpc('join_space', { code })))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout subtitle={`Signed in as ${email}`}>
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
        {(['create', 'join'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
            className={`h-9 rounded-lg text-sm font-medium transition ${mode === m ? 'bg-surface shadow-sm' : 'text-muted'}`}
          >
            {m === 'create' ? 'Start our space' : 'I have a code'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-4">
        {mode === 'create' ? (
          <p className="text-sm text-muted">
            You'll pick a passphrase next, then get an invite code to send your person. Only the two of you can ever join.
          </p>
        ) : (
          <Field label="Invite code" hint="You'll need the passphrase you two agreed on next.">
            <Input
              required
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABCD-EFGH"
              className="font-mono tracking-widest uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} className="w-full">
          {mode === 'create' ? 'Create space' : 'Join'}
        </Button>
      </form>
      <button className="mx-auto mt-6 block text-sm text-muted" onClick={() => signOut()}>
        Sign out
      </button>
    </AuthLayout>
  )
}
