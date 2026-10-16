import { useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { useSpace } from '../lib/store'
import { MIN_PASSPHRASE_LENGTH, cryptoAvailable } from '../lib/e2e'
import { signOut } from '../lib/session'
import { Button, Field, Input, errorMessage } from '../components/ui'
import { AuthLayout } from './auth'

// Everything in a space is end-to-end encrypted, so nothing opens until this
// device has the key. These screens stand in front of the app until then.

const MAX_NAME = 40
const MAX_SPACE_NAME = 60

function PassphraseInputs({
  passphrase,
  setPassphrase,
  again,
  setAgain,
}: {
  passphrase: string
  setPassphrase: (v: string) => void
  again?: string
  setAgain?: (v: string) => void
}) {
  const [show, setShow] = useState(false)
  const type = show ? 'text' : 'password'
  const common = { type, autoComplete: 'off', autoCapitalize: 'off', spellCheck: false } as const
  return (
    <div className="space-y-3">
      <Field label="Shared passphrase">
        <Input {...common} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </Field>
      {setAgain && (
        <Field label="Type it again">
          <Input {...common} value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        Show passphrase
      </label>
    </div>
  )
}

function Insecure() {
  return (
    <AuthLayout subtitle="Duo needs a secure connection.">
      <p className="text-center text-sm text-muted">Open it from its https:// address to unlock your space.</p>
    </AuthLayout>
  )
}

function SignOutLink() {
  return (
    <button className="mx-auto mt-6 block text-sm text-muted" onClick={() => signOut()}>
      Sign out
    </button>
  )
}

/** First time for the space: pick the passphrase, and the names it protects. */
export function SetUpScreen() {
  const { space, me, actions } = useSpace()
  const [spaceName, setSpaceName] = useState(space?.name ?? '')
  const [name, setName] = useState(me?.display_name ?? '')
  const [passphrase, setPassphrase] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!cryptoAvailable()) return <Insecure />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Add your name.')
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters. A short sentence only you two know works well.`)
    }
    if (passphrase !== again) return setError("The two passphrases don't match.")
    setBusy(true)
    try {
      await actions.setUpEncryption(passphrase)
      await actions.renameSpace(spaceName.trim() || 'Us')
      await actions.renameMe(name.trim())
    } catch (err) {
      const msg = errorMessage(err)
      setError(/already set up/i.test(msg) ? 'Your person just set a passphrase. Enter the one you agreed on.' : msg)
      setBusy(false)
    }
  }

  return (
    <AuthLayout subtitle="Lock your space">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">
          Everything you two share here is encrypted on your phones with a passphrase you choose together, in person. Nobody
          else can read it, not even whoever runs the servers.
        </p>
        <Field label="Name this space" hint="Optional. Encrypted too.">
          <Input placeholder="e.g. Asha & Rohan" maxLength={MAX_SPACE_NAME} value={spaceName} onChange={(e) => setSpaceName(e.target.value)} />
        </Field>
        <Field label="Your name" hint="What your person sees.">
          <Input maxLength={MAX_NAME} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <PassphraseInputs passphrase={passphrase} setPassphrase={setPassphrase} again={again} setAgain={setAgain} />
        <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-xs">
          There's no way to recover it. If you both forget it, everything in the space is gone for good, so keep it in a
          password manager. Don't send it to each other here.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} icon={<Lock />} className="w-full">
          Lock our space
        </Button>
      </form>
      <SignOutLink />
    </AuthLayout>
  )
}

/** Each new device: enter the passphrase once. */
export function UnlockScreen() {
  const { actions } = useSpace()
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!cryptoAvailable()) return <Insecure />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await actions.unlockEncryption(passphrase)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout subtitle="Unlock your space">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Enter the passphrase you two agreed on. You only need to do this once on each device.</p>
        <PassphraseInputs passphrase={passphrase} setPassphrase={setPassphrase} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} icon={<Lock />} className="w-full" disabled={!passphrase}>
          Unlock
        </Button>
      </form>
      <SignOutLink />
    </AuthLayout>
  )
}

/** After joining: names are encrypted, so they're set once the space is unlocked. */
export function NameScreen() {
  const { partner, actions } = useSpace()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await actions.renameMe(name.trim())
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout subtitle="Unlocked">
      <form onSubmit={submit} className="space-y-4">
        <Field label={`What should ${partner?.display_name ?? 'your person'} call you?`}>
          <Input required autoFocus maxLength={MAX_NAME} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} className="w-full" disabled={!name.trim()}>
          Continue
        </Button>
      </form>
    </AuthLayout>
  )
}
