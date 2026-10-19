import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Copy, Share2 } from 'lucide-react'
import { must, supabase } from '../lib/supabase'
import { formatCode, inviteLink, pendingInvite } from '../lib/invite'
import { Button, Field, Input, errorMessage, toast, toastError } from '../components/ui'
import { useBusy } from '../components/use-busy'
import { AuthLayout, SignOutLink } from './auth'

export async function shareInvite(code: string) {
  // The passphrase never goes in the invite: it's shared in person.
  const text = `Join me on Duo: ${inviteLink(code)}

Our passphrase isn't in the link; I'll tell you in person.`
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
          onClick={() => navigator.clipboard.writeText(inviteLink(code)).then(() => toast('Link copied'), toastError)}
        >
          Copy link
        </Button>
        <Button size="sm" icon={<Share2 />} onClick={() => shareInvite(code).catch(toastError)}>
          Send invite
        </Button>
      </div>
    </div>
  )
}

type SetupMode = 'create' | 'join'

/** Starts a space or joins one. An invite is kept only while it could still work. */
async function enterSpace(mode: SetupMode, code: string): Promise<string> {
  try {
    // Names are asked for after the passphrase, so they can be encrypted.
    const request = mode === 'create' ? supabase.rpc('create_space') : supabase.rpc('join_space', { code })
    const spaceId = await must<string>(request)
    pendingInvite.clear()
    return spaceId
  } catch (e) {
    // Matches the wording errorMessage (src/components/ui.tsx) gives a dropped connection.
    const connectionDropped = /reach the server/i.test(errorMessage(e))
    // A used-up or wrong code won't start working; a dropped connection might.
    if (!connectionDropped) pendingInvite.clear()
    throw e
  }
}

function useSpaceSetup(onReady: (spaceId: string) => void) {
  const [inviteCode] = useState(() => pendingInvite.get())
  const [mode, setMode] = useState<SetupMode>(inviteCode ? 'join' : 'create')
  const [code, setCode] = useState(inviteCode ? formatCode(inviteCode) : '')
  const { busy, error, setError, run } = useBusy()
  const enterThenOpen = (setupMode: SetupMode, joinCode: string) =>
    run(async () => {
      const spaceId = await enterSpace(setupMode, joinCode)
      onReady(spaceId)
    })
  // From an invite link: join once, without asking.
  const autoJoined = useRef(false)
  useEffect(() => {
    if (!inviteCode || autoJoined.current) return
    autoJoined.current = true
    void enterThenOpen('join', inviteCode)
  }, [inviteCode])
  function submit(e: FormEvent) {
    e.preventDefault()
    void enterThenOpen(mode, code)
  }
  function switchTo(next: SetupMode) {
    setMode(next)
    setError(null)
  }
  const joiningFromInvite = inviteCode !== null && busy && mode === 'join' && !error
  return { joiningFromInvite, mode, code, setCode, busy, error, submit, switchTo }
}

type SpaceSetupProps = {
  email: string
  onReady: (spaceId: string) => void
  /** Set when you already have a space to go back to. */
  onCancel?: () => void
}

/** Start a space, or join your person's with their code or invite link. */
export function SpaceSetup({ email, onReady, onCancel }: SpaceSetupProps) {
  const setup = useSpaceSetup(onReady)
  return (
    <AuthLayout subtitle={`Signed in as ${email}`}>
      <CreateOrJoinTabs mode={setup.mode} onChange={setup.switchTo} />
      <form onSubmit={setup.submit} className="space-y-4">
        {setup.joiningFromInvite && <p className="text-center text-sm text-muted">Joining the space you were invited to…</p>}
        {setup.mode === 'join' && <CodeField value={setup.code} onChange={setup.setCode} />}
        {setup.mode === 'create' && (
          <p className="text-sm text-muted">
            You'll pick a passphrase next, then get an invite code to send your person. Only the two of you can ever join.
          </p>
        )}
        {setup.error && <p className="text-sm text-danger">{setup.error}</p>}
        <Button type="submit" loading={setup.busy} className="w-full">
          {setup.mode === 'create' ? 'Create space' : 'Join'}
        </Button>
      </form>
      {onCancel ? (
        <button className="mx-auto mt-6 block text-sm text-muted" onClick={onCancel}>
          Back
        </button>
      ) : (
        <SignOutLink />
      )}
    </AuthLayout>
  )
}

function CreateOrJoinTabs({ mode, onChange }: { mode: SetupMode; onChange: (next: SetupMode) => void }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
      {(['create', 'join'] as const).map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={mode === option}
          onClick={() => onChange(option)}
          className={`h-9 rounded-lg text-sm font-medium transition ${mode === option ? 'bg-surface shadow-sm' : 'text-muted'}`}
        >
          {option === 'create' ? 'Start our space' : 'I have a code'}
        </button>
      ))}
    </div>
  )
}

function CodeField({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <Field label="Invite code" hint="You'll need the passphrase you two agreed on next.">
      <Input
        required
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="ABCD-EFGH"
        className="font-mono tracking-widest uppercase"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}
