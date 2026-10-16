import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { pendingInvite } from '../lib/invite'
import { signOut } from '../lib/session'
import { Button, Field, Input, toast } from '../components/ui'
import { useBusy } from '../components/use-busy'

/** undefined while restoring the saved session, null when signed out. */
export function useAuth() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [recovering, setRecovering] = useState(false)
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  return { session, recovering, doneRecovering: () => setRecovering(false) }
}

export function AuthLayout({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="app-height overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6 py-[calc(env(safe-area-inset-top)+2rem)]">
        <div className="mb-8 text-center">
          <img src="/logo.svg" alt="" className="mx-auto mb-4 size-16 rounded-2xl shadow-sm" />
          <h1 className="text-2xl font-bold tracking-tight">Duo</h1>
          <p className="mt-1 text-muted">{subtitle ?? 'Contacts, chat, lists and notes for the two of you.'}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export function SignOutLink() {
  return (
    <button className="mx-auto mt-6 block text-sm text-muted" onClick={() => signOut()}>
      Sign out
    </button>
  )
}

type Mode = 'signin' | 'signup' | 'forgot'

/** Does what the form is for. Returns a notice to show (then it's back to signing in), or null. */
async function submitAuth(mode: Mode, email: string, password: string): Promise<string | null> {
  if (mode === 'signin') {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return null
  }
  if (mode === 'forgot') {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
    if (error) throw error
    return 'If that email has an account, a reset link is on its way.'
  }
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
  if (error) throw error
  return data.session ? null : 'Check your inbox and tap the confirmation link, then sign in here.'
}

function useAuthForm(initial: Mode) {
  const [mode, setMode] = useState<Mode>(initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const { busy, error, setError, run } = useBusy()
  function submit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    void run(async () => {
      const said = await submitAuth(mode, email, password)
      if (!said) return
      setNotice(said)
      setMode('signin')
    }, { settle: true })
  }
  function switchTo(m: Mode) {
    setMode(m)
    setError(null)
  }
  return { mode, email, setEmail, password, setPassword, notice, busy, error, submit, switchTo }
}

export function AuthScreen() {
  const [invited] = useState(() => pendingInvite.get() !== null)
  const form = useAuthForm(invited ? 'signup' : 'signin')
  return (
    <AuthLayout subtitle={invited ? "You've been invited to a space." : undefined}>
      {invited && (
        <p className="mb-5 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm">
          Create an account (or sign in) and you'll join it straight away. You'll need the passphrase your person tells you.
        </p>
      )}
      <form onSubmit={form.submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={form.email} onChange={(e) => form.setEmail(e.target.value)} />
        </Field>
        {form.mode !== 'forgot' && <PasswordField mode={form.mode} value={form.password} onChange={form.setPassword} />}
        {form.error && <p className="text-sm text-danger">{form.error}</p>}
        {form.notice && <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm">{form.notice}</p>}
        <Button type="submit" loading={form.busy} className="w-full">
          {form.mode === 'signin' ? 'Sign in' : form.mode === 'signup' ? 'Create account' : 'Send reset link'}
        </Button>
      </form>
      <ModeLinks mode={form.mode} onSwitch={form.switchTo} />
    </AuthLayout>
  )
}

function PasswordField({ mode, value, onChange }: { mode: Mode; value: string; onChange: (password: string) => void }) {
  return (
    <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
      <Input
        type="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        minLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

function ModeLinks({ mode, onSwitch }: { mode: Mode; onSwitch: (m: Mode) => void }) {
  if (mode !== 'signin') {
    return (
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <button className="font-medium text-accent" onClick={() => onSwitch('signin')}>
          Back to sign in
        </button>
      </div>
    )
  }
  return (
    <div className="mt-6 flex flex-col items-center gap-2 text-sm">
      <button className="font-medium text-accent" onClick={() => onSwitch('signup')}>
        New here? Create an account
      </button>
      <button className="text-muted" onClick={() => onSwitch('forgot')}>
        Forgot password?
      </button>
    </div>
  )
}

export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useBusy()
  async function save() {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    toast('Password updated')
    onDone()
  }
  return (
    <AuthLayout subtitle="Choose a new password.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(save, { settle: true })
        }}
        className="space-y-4"
      >
        <Field label="New password">
          <Input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} className="w-full">
          Save password
        </Button>
      </form>
    </AuthLayout>
  )
}
