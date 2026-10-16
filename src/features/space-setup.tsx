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

type Way = 'create' | 'join'

/** Starts a space or joins one. An invite is kept only while it could still work. */
async function enterSpace(how: Way, code: string): Promise<string> {
  try {
    // Names are asked for after the passphrase, so they can be encrypted.
    const id = await must<string>(how === 'create' ? supabase.rpc('create_space') : supabase.rpc('join_space', { code }))
    pendingInvite.clear()
    return id
  } catch (e) {
    // A used-up or wrong code won't start working; a dropped connection might.
    if (!/reach the server/i.test(errorMessage(e))) pendingInvite.clear()
    throw e
  }
}

function useSpaceSetup(onReady: (spaceId: string) => void) {
  const [invited] = useState(() => pendingInvite.get())
  const [mode, setMode] = useState<Way>(invited ? 'join' : 'create')
  const [code, setCode] = useState(invited ? formatCode(invited) : '')
  const { busy, error, setError, run } = useBusy()
  const go = (how: Way, joinCode: string) => run(async () => onReady(await enterSpace(how, joinCode)))
  // From an invite link: join once, without asking.
  const autoJoined = useRef(false)
  useEffect(() => {
    if (!invited || autoJoined.current) return
    autoJoined.current = true
    void go('join', invited)
  }, [invited])
  function submit(e: FormEvent) {
    e.preventDefault()
    void go(mode, code)
  }
  function switchTo(m: Way) {
    setMode(m)
    setError(null)
  }
  return { invited, mode, code, setCode, busy, error, submit, switchTo }
}

/** First run after signing in: start a space, or join your person's with their code or invite link. */
export function SpaceSetup({ email, onReady }: { email: string; onReady: (spaceId: string) => void }) {
  const s = useSpaceSetup(onReady)
  return (
    <AuthLayout subtitle={`Signed in as ${email}`}>
      <WayTabs mode={s.mode} onChange={s.switchTo} />
      <form onSubmit={s.submit} className="space-y-4">
        {s.invited && s.busy && s.mode === 'join' && !s.error && <p className="text-center text-sm text-muted">Joining the space you were invited to…</p>}
        {s.mode === 'join' && <CodeField value={s.code} onChange={s.setCode} />}
        {s.mode === 'create' && (
          <p className="text-sm text-muted">
            You'll pick a passphrase next, then get an invite code to send your person. Only the two of you can ever join.
          </p>
        )}
        {s.error && <p className="text-sm text-danger">{s.error}</p>}
        <Button type="submit" loading={s.busy} className="w-full">
          {s.mode === 'create' ? 'Create space' : 'Join'}
        </Button>
      </form>
      <SignOutLink />
    </AuthLayout>
  )
}

function WayTabs({ mode, onChange }: { mode: Way; onChange: (m: Way) => void }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
      {(['create', 'join'] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={`h-9 rounded-lg text-sm font-medium transition ${mode === m ? 'bg-surface shadow-sm' : 'text-muted'}`}
        >
          {m === 'create' ? 'Start our space' : 'I have a code'}
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
