import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Button, Field, Input, errorMessage, toast } from '../components/ui'

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

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: location.origin },
        })
        if (error) throw error
        if (!data.session) {
          setNotice('Check your inbox and tap the confirmation link, then sign in here.')
          setMode('signin')
        }
      } else if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
        if (error) throw error
        setNotice('If that email has an account, a reset link is on its way.')
        setMode('signin')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (m: typeof mode) => {
    setMode(m)
    setError(null)
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
            <Input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {notice && <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm">{notice}</p>}
        <Button type="submit" loading={busy} className="w-full">
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        {mode === 'signin' ? (
          <>
            <button className="font-medium text-accent" onClick={() => switchTo('signup')}>
              New here? Create an account
            </button>
            <button className="text-muted" onClick={() => switchTo('forgot')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button className="font-medium text-accent" onClick={() => switchTo('signin')}>
            Back to sign in
          </button>
        )}
      </div>
    </AuthLayout>
  )
}

export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    toast('Password updated')
    onDone()
  }

  return (
    <AuthLayout subtitle="Choose a new password.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} className="w-full">
          Save password
        </Button>
      </form>
    </AuthLayout>
  )
}
