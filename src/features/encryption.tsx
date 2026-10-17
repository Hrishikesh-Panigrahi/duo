import { useState, type FormEvent } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { useSpace, type SpaceActions } from '../lib/store'
import { cryptoAvailable } from '../lib/e2e'
import { passphraseProblem, suggestPassphrase } from '../lib/passphrase'
import { Button, Field, Input, errorMessage } from '../components/ui'
import { useBusy } from '../components/use-busy'
import { AuthLayout, SignOutLink } from './auth'

// Nothing in a space opens until this device has the key; these screens stand in front of the app until then.

const MAX_NAME = 40
const MAX_SPACE_NAME = 60

type PassphraseProps = {
  passphrase: string
  setPassphrase: (passphrase: string) => void
  confirmation?: string
  setConfirmation?: (confirmation: string) => void
}

/** With `setConfirmation`, it's a new passphrase: typed twice, with a suggestion on offer. */
function PassphraseInputs({ passphrase, setPassphrase, confirmation, setConfirmation }: PassphraseProps) {
  const [show, setShow] = useState(false)
  const isNewPassphrase = setConfirmation !== undefined
  const passphraseInputProps = { type: show ? 'text' : 'password', autoComplete: 'off', autoCapitalize: 'off', spellCheck: false } as const
  const suggest = () => {
    const suggested = suggestPassphrase()
    setPassphrase(suggested)
    setConfirmation?.(suggested)
    setShow(true)
  }
  return (
    <div className="space-y-3">
      <Field label="Shared passphrase">
        <Input {...passphraseInputProps} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </Field>
      {isNewPassphrase && (
        <Field label="Type it again">
          <Input {...passphraseInputProps} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
      )}
      <PassphraseOptions show={show} onShow={setShow} onSuggest={isNewPassphrase ? suggest : undefined} />
    </div>
  )
}

function PassphraseOptions({ show, onShow, onSuggest }: { show: boolean; onShow: (show: boolean) => void; onSuggest?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        Show passphrase
      </label>
      {onSuggest && (
        <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-accent [&_svg]:size-4" onClick={onSuggest}>
          <Sparkles />
          Suggest a strong one
        </button>
      )}
    </div>
  )
}

function NeedsHttpsScreen() {
  return (
    <AuthLayout subtitle="Duo needs a secure connection.">
      <p className="text-center text-sm text-muted">Open it from its https:// address to unlock your space.</p>
    </AuthLayout>
  )
}

type EncryptionSetup = { passphrase: string; spaceName: string; name: string }

// Matches the server's error when your person turned encryption on first.
const ALREADY_SET_UP = /already set up/i

/** Turns encryption on, then saves the names, which are now encrypted. */
async function setUpEncryption(actions: SpaceActions, { passphrase, spaceName, name }: EncryptionSetup) {
  try {
    await actions.encryption.setUp(passphrase)
  } catch (e) {
    if (ALREADY_SET_UP.test(errorMessage(e))) throw new Error('Your person just set a passphrase. Enter the one you agreed on.')
    throw e
  }
  await actions.names.renameSpace(spaceName.trim() || 'Us')
  await actions.names.renameMe(name.trim())
}

/** What to fix before the form can be sent, or null if nothing. */
function setUpProblem({ name, passphrase, confirmation }: { name: string; passphrase: string; confirmation: string }): string | null {
  if (!name.trim()) return 'Add your name.'
  const passphraseIssue = passphraseProblem(passphrase)
  if (passphraseIssue) return passphraseIssue
  if (passphrase !== confirmation) return "The two passphrases don't match."
  return null
}

function useSetUpForm() {
  const { space, me, actions } = useSpace()
  const [spaceName, setSpaceName] = useState(space?.name ?? '')
  const [name, setName] = useState(me?.display_name ?? '')
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const { busy, error, setError, run } = useBusy()
  function submit(e: FormEvent) {
    e.preventDefault()
    const problem = setUpProblem({ name, passphrase, confirmation })
    if (problem) setError(problem)
    else void run(() => setUpEncryption(actions, { passphrase, spaceName, name }))
  }
  return { spaceName, setSpaceName, name, setName, passphrase, setPassphrase, confirmation, setConfirmation, busy, error, submit }
}

/** First time for the space: pick the passphrase, and the names it protects. */
export function SetUpScreen() {
  const form = useSetUpForm()
  if (!cryptoAvailable()) return <NeedsHttpsScreen />
  return (
    <AuthLayout subtitle="Lock your space">
      <form onSubmit={form.submit} className="space-y-4">
        <p className="text-sm text-muted">
          Everything you two share here is encrypted on your phones with a passphrase you choose together, in person. Nobody else can
          read it, not even whoever runs the servers.
        </p>
        <NameFields form={form} />
        <PassphraseInputs passphrase={form.passphrase} setPassphrase={form.setPassphrase} confirmation={form.confirmation} setConfirmation={form.setConfirmation} />
        <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-xs">
          There's no way to recover it. If you both forget it, everything in the space is gone for good, so keep it in a password
          manager. Don't send it to each other here.
        </p>
        {form.error && <p className="text-sm text-danger">{form.error}</p>}
        <Button type="submit" loading={form.busy} icon={<Lock />} className="w-full">
          Lock our space
        </Button>
      </form>
      <SignOutLink />
    </AuthLayout>
  )
}

function NameFields({ form }: { form: ReturnType<typeof useSetUpForm> }) {
  return (
    <>
      <Field label="Name this space" hint="Optional. Encrypted too.">
        <Input placeholder="e.g. Asha & Rohan" maxLength={MAX_SPACE_NAME} value={form.spaceName} onChange={(e) => form.setSpaceName(e.target.value)} />
      </Field>
      <Field label="Your name" hint="What your person sees.">
        <Input maxLength={MAX_NAME} autoComplete="given-name" value={form.name} onChange={(e) => form.setName(e.target.value)} />
      </Field>
    </>
  )
}

/** Each new device: enter the passphrase once. */
export function UnlockScreen() {
  const { actions } = useSpace()
  const [passphrase, setPassphrase] = useState('')
  const { busy, error, run } = useBusy()
  function submit(e: FormEvent) {
    e.preventDefault()
    void run(() => actions.encryption.unlock(passphrase))
  }
  if (!cryptoAvailable()) return <NeedsHttpsScreen />
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
  const { busy, error, run } = useBusy()
  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) void run(() => actions.names.renameMe(name.trim()))
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
