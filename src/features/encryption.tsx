import { useState, type FormEvent } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { useSpace } from '../lib/store'
import { cryptoAvailable } from '../lib/e2e'
import { passphraseProblem, suggestPassphrase } from '../lib/passphrase'
import { Button, Field, Input, errorMessage } from '../components/ui'
import { useBusy } from '../components/use-busy'
import { AuthLayout, SignOutLink } from './auth'

// Nothing in a space opens until this device has the key; these screens stand in front of the app until then.

const MAX_NAME = 40
const MAX_SPACE_NAME = 60

type PassphraseProps = { passphrase: string; setPassphrase: (v: string) => void; again?: string; setAgain?: (v: string) => void }

/** With `setAgain`, it's a new passphrase: typed twice, with a suggestion on offer. */
function PassphraseInputs({ passphrase, setPassphrase, again, setAgain }: PassphraseProps) {
  const [show, setShow] = useState(false)
  const common = { type: show ? 'text' : 'password', autoComplete: 'off', autoCapitalize: 'off', spellCheck: false } as const
  const suggest = () => {
    const p = suggestPassphrase()
    setPassphrase(p)
    setAgain?.(p)
    setShow(true)
  }
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
      <PassphraseOptions show={show} onShow={setShow} onSuggest={setAgain && suggest} />
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

function Insecure() {
  return (
    <AuthLayout subtitle="Duo needs a secure connection.">
      <p className="text-center text-sm text-muted">Open it from its https:// address to unlock your space.</p>
    </AuthLayout>
  )
}

function useSetUpForm() {
  const { space, me, actions } = useSpace()
  const [spaceName, setSpaceName] = useState(space?.name ?? '')
  const [name, setName] = useState(me?.display_name ?? '')
  const [passphrase, setPassphrase] = useState('')
  const [again, setAgain] = useState('')
  const { busy, error, setError, run } = useBusy()
  async function lock() {
    await actions.encryption.setUp(passphrase).catch((e) => {
      throw /already set up/i.test(errorMessage(e)) ? new Error('Your person just set a passphrase. Enter the one you agreed on.') : e
    })
    await actions.names.renameSpace(spaceName.trim() || 'Us')
    await actions.names.renameMe(name.trim())
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Add your name.')
    const weak = passphraseProblem(passphrase)
    if (weak) return setError(weak)
    if (passphrase !== again) return setError("The two passphrases don't match.")
    void run(lock)
  }
  return { spaceName, setSpaceName, name, setName, passphrase, setPassphrase, again, setAgain, busy, error, submit }
}

/** First time for the space: pick the passphrase, and the names it protects. */
export function SetUpScreen() {
  const f = useSetUpForm()
  if (!cryptoAvailable()) return <Insecure />
  return (
    <AuthLayout subtitle="Lock your space">
      <form onSubmit={f.submit} className="space-y-4">
        <p className="text-sm text-muted">
          Everything you two share here is encrypted on your phones with a passphrase you choose together, in person. Nobody else can
          read it, not even whoever runs the servers.
        </p>
        <NameFields form={f} />
        <PassphraseInputs passphrase={f.passphrase} setPassphrase={f.setPassphrase} again={f.again} setAgain={f.setAgain} />
        <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-xs">
          There's no way to recover it. If you both forget it, everything in the space is gone for good, so keep it in a password
          manager. Don't send it to each other here.
        </p>
        {f.error && <p className="text-sm text-danger">{f.error}</p>}
        <Button type="submit" loading={f.busy} icon={<Lock />} className="w-full">
          Lock our space
        </Button>
      </form>
      <SignOutLink />
    </AuthLayout>
  )
}

function NameFields({ form: f }: { form: ReturnType<typeof useSetUpForm> }) {
  return (
    <>
      <Field label="Name this space" hint="Optional. Encrypted too.">
        <Input placeholder="e.g. Asha & Rohan" maxLength={MAX_SPACE_NAME} value={f.spaceName} onChange={(e) => f.setSpaceName(e.target.value)} />
      </Field>
      <Field label="Your name" hint="What your person sees.">
        <Input maxLength={MAX_NAME} autoComplete="given-name" value={f.name} onChange={(e) => f.setName(e.target.value)} />
      </Field>
    </>
  )
}

/** Each new device: enter the passphrase once. */
export function UnlockScreen() {
  const { actions } = useSpace()
  const [passphrase, setPassphrase] = useState('')
  const { busy, error, run } = useBusy()
  if (!cryptoAvailable()) return <Insecure />
  return (
    <AuthLayout subtitle="Unlock your space">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => actions.encryption.unlock(passphrase))
        }}
        className="space-y-4"
      >
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
