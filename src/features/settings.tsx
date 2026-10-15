import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Download, LogOut, Share } from 'lucide-react'
import { useSpace } from '../lib/store'
import { supabase } from '../lib/supabase'
import { formatDay, todayYMD } from '../lib/dates'
import { isIOS, isStandalone, useInstallPrompt } from '../lib/device'
import { Avatar, Button, Field, Input, Sheet, toast, toastError } from '../components/ui'
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

function SettingsBody() {
  const { space, me, partner, user, actions } = useSpace()
  const [spaceName, setSpaceName] = useState(space!.name)
  const [myName, setMyName] = useState(me?.display_name ?? '')
  const install = useInstallPrompt()

  const commit = (value: string, current: string | undefined, save: (v: string) => Promise<void>, reset: (v: string) => void) => {
    const v = value.trim()
    if (!v) return reset(current ?? '')
    if (v !== current) save(v).then(() => toast('Saved'), toastError)
  }
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()

  return (
    <div className="space-y-7">
      <Section title="Your space">
        <Field label="Space name">
          <Input
            value={spaceName}
            maxLength={60}
            onChange={(e) => setSpaceName(e.target.value)}
            onKeyDown={blurOnEnter}
            onBlur={() => commit(spaceName, space?.name, actions.renameSpace, setSpaceName)}
          />
        </Field>
        <Field label="Your name">
          <Input
            value={myName}
            maxLength={40}
            onChange={(e) => setMyName(e.target.value)}
            onKeyDown={blurOnEnter}
            onBlur={() => commit(myName, me?.display_name, actions.renameMe, setMyName)}
          />
        </Field>
      </Section>

      <Section title="Your person">
        {partner ? (
          <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
            <Avatar name={partner.display_name} size={44} />
            <div>
              <div className="font-semibold">{partner.display_name}</div>
              <div className="text-sm text-muted">Joined {formatDay(todayYMD(new Date(partner.joined_at)))}</div>
            </div>
          </div>
        ) : space?.invite_code ? (
          <>
            <p className="text-sm">They haven't joined yet. Send them this code; it stops working once they're in.</p>
            <InviteCode code={space.invite_code} />
          </>
        ) : null}
      </Section>

      {!isStandalone() && (
        <Section title="Put it on your home screen">
          {install ? (
            <Button className="w-full" icon={<Download />} onClick={() => install().catch(toastError)}>
              Install Duo
            </Button>
          ) : isIOS() ? (
            <p className="text-sm">
              In Safari, tap <Share className="inline size-4 align-text-bottom" /> Share, then <strong>Add to Home Screen</strong>. It
              opens full-screen like a normal app.
            </p>
          ) : (
            <p className="text-sm">
              Open your browser's menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </p>
          )}
        </Section>
      )}

      <Section title="Account">
        <p className="text-sm">
          Signed in as <span className="font-medium">{user.email}</span>
        </p>
        <Button variant="secondary" className="w-full" icon={<LogOut />} onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </Section>
    </div>
  )
}
