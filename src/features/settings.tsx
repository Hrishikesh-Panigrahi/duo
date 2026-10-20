import { useState, type ReactNode } from 'react'
import { Download, Lock, LogOut, Share } from 'lucide-react'
import { useSpace } from '../lib/store'
import { signOut } from '../lib/session'
import type { Member } from '../lib/types'
import { formatDay, toLocalYMD } from '../lib/dates'
import { isIOS, isStandalone, useInstallPrompt } from '../lib/device'
import { Avatar, Button, Field, Input, Sheet, Switch, toast, toastError } from '../components/ui'
import { useBusy } from '../components/use-busy'
import { InviteCode } from './space-setup'

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <SettingsBody />
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** Either of you can turn it on or off; it applies to messages sent from then on. */
function VanishModeSection() {
  const { space, actions } = useSpace()
  const { busy, error, run } = useBusy()
  const on = Boolean(space?.vanish_mode)
  const turn = (next: boolean) => void run(() => actions.chat.setVanishMode(next), { idleAfterSuccess: true })
  return (
    <Section title="Chat">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">Vanish mode</p>
          <p className="text-xs text-muted">New messages disappear once they've been seen and the chat is closed, for both of you.</p>
        </div>
        <Switch checked={on} onChange={turn} label="Vanish mode" disabled={busy} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Section>
  )
}

function SettingsBody() {
  const { space, me, actions } = useSpace()
  return (
    <div className="space-y-7">
      <Section title="Your space">
        <NameField label="Space name" maxLength={60} savedName={space?.name} onSave={(name) => actions.names.renameSpace(name)} />
        <NameField label="Your name" maxLength={40} savedName={me?.display_name} onSave={(name) => actions.names.renameMe(name)} />
      </Section>
      <PartnerSection />
      <VanishModeSection />
      <EncryptionSection />
      {!isStandalone() && <InstallSection />}
      <AccountSection />
    </div>
  )
}

type NameFieldProps = { label: string; maxLength: number; savedName: string | null | undefined; onSave: (name: string) => Promise<void> }

/** Saves when you leave the field; emptying it puts the saved name back. */
function NameField({ label, maxLength, savedName, onSave }: NameFieldProps) {
  const [value, setValue] = useState(savedName ?? '')
  const commit = () => {
    const name = value.trim()
    if (!name) {
      setValue(savedName ?? '')
    } else if (name !== savedName) {
      onSave(name).then(() => toast('Saved'), toastError)
    }
  }
  return (
    <Field label={label}>
      <Input
        value={value}
        maxLength={maxLength}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        onBlur={commit}
      />
    </Field>
  )
}

function PartnerSection() {
  const { space, partner } = useSpace()
  return (
    <Section title="Your person">
      {partner && <PartnerCard partner={partner} />}
      {!partner && space?.invite_code && (
        <>
          <p className="text-sm">They haven't joined yet. Send them the invite link (or the code); it stops working once they're in.</p>
          <InviteCode code={space.invite_code} />
        </>
      )}
    </Section>
  )
}

function PartnerCard({ partner }: { partner: Member }) {
  const joinedOn = toLocalYMD(new Date(partner.joined_at))
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
      <Avatar name={partner.display_name ?? '?'} size={44} />
      <div>
        <div className="font-semibold">{partner.display_name ?? 'Your person'}</div>
        <div className="text-sm text-muted">Joined {formatDay(joinedOn)}</div>
      </div>
    </div>
  )
}

function EncryptionSection() {
  const { actions, e2e } = useSpace()
  const lock = () => actions.encryption.lock().then(() => toast('Locked on this device'), toastError)
  return (
    <Section title="Encryption">
      {!e2e.enabled && <p className="text-sm">Messages aren't encrypted yet. Turn it on from the Chat tab.</p>}
      {e2e.enabled && !e2e.unlocked && (
        <p className="text-sm">Messages are end-to-end encrypted. This device is locked: unlock it from the Chat tab.</p>
      )}
      {e2e.enabled && e2e.unlocked && (
        <>
          <p className="text-sm">Messages are end-to-end encrypted, and this device is unlocked.</p>
          <Button variant="secondary" className="w-full" icon={<Lock />} onClick={lock}>
            Lock this device
          </Button>
          <p className="text-xs text-muted">
            Forgets the key here. You'll need the passphrase again to read or send messages on this device. Signing out does this
            too.
          </p>
        </>
      )}
    </Section>
  )
}

function InstallSection() {
  return (
    <Section title="Put it on your home screen">
      <InstallInstructions />
    </Section>
  )
}

function InstallInstructions() {
  const promptInstall = useInstallPrompt()
  if (promptInstall) {
    return (
      <Button className="w-full" icon={<Download />} onClick={() => promptInstall().catch(toastError)}>
        Install Duo
      </Button>
    )
  }
  if (isIOS()) {
    return (
      <p className="text-sm">
        In Safari, tap <Share className="inline size-4 align-text-bottom" /> Share, then <strong>Add to Home Screen</strong>. It opens
        full-screen like a normal app.
      </p>
    )
  }
  return (
    <p className="text-sm">
      Open your browser's menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
    </p>
  )
}

function AccountSection() {
  const { user } = useSpace()
  return (
    <Section title="Account">
      <p className="text-sm">
        Signed in as <span className="font-medium">{user.email}</span>
      </p>
      <Button variant="secondary" className="w-full" icon={<LogOut />} onClick={() => signOut()}>
        Sign out
      </Button>
    </Section>
  )
}
