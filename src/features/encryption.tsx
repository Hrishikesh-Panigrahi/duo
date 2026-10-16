import { useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { useSpace } from '../lib/store'
import { MIN_PASSPHRASE_LENGTH, cryptoAvailable } from '../lib/e2e'
import { Button, Input, errorMessage } from '../components/ui'

/**
 * Takes the composer's place until this device can encrypt: either turning
 * encryption on for the space (first time) or unlocking it on this device.
 */
export function EncryptionPanel() {
  const { e2e, partner, actions } = useSpace()
  const setup = !e2e.enabled
  const [passphrase, setPassphrase] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const them = partner?.display_name ?? 'your person'

  if (!cryptoAvailable()) {
    return (
      <p className="shrink-0 border-t border-line bg-surface px-4 py-4 text-center text-sm text-muted">
        Encrypted chat needs a secure connection. Open Duo from its https:// address.
      </p>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (setup) {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        return setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters. A short sentence only you two know works well.`)
      }
      if (passphrase !== again) return setError("The two passphrases don't match.")
    }
    setBusy(true)
    try {
      if (setup) await actions.setUpEncryption(passphrase)
      else await actions.unlockEncryption(passphrase)
    } catch (err) {
      const msg = errorMessage(err)
      setError(/already set up/i.test(msg) ? `${them} just turned it on. Enter the passphrase you agreed on.` : msg)
    } finally {
      setBusy(false)
    }
  }

  const type = show ? 'text' : 'password'

  return (
    <form onSubmit={submit} className="shrink-0 space-y-3 border-t border-line bg-surface px-4 pt-4 pb-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Lock className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{setup ? 'Turn on end-to-end encryption' : 'Unlock your messages'}</p>
          <p className="text-sm text-muted">
            {setup
              ? `Agree on a passphrase with ${them}, in person. Messages get scrambled on your phones, so nobody else can read them, not even whoever runs the database.`
              : 'Enter the passphrase you two agreed on. You only need to do this once on each device.'}
          </p>
        </div>
      </div>
      <Input
        type={type}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Shared passphrase"
        placeholder="Shared passphrase"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      {setup && (
        <Input
          type={type}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Passphrase again"
          placeholder="Type it again"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      )}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        Show passphrase
      </label>
      {setup && (
        <p className="text-xs text-muted">
          There's no way to recover it: if you both forget it, encrypted messages are gone for good. Don't send it to each other
          in this app.
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" loading={busy} icon={<Lock />} className="w-full" disabled={!passphrase}>
        {setup ? 'Turn on encryption' : 'Unlock'}
      </Button>
    </form>
  )
}
