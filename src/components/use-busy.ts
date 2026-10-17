import { useState } from 'react'
import { errorMessage, toastError } from './ui'

/** Runs a screen's save or send with a busy flag, and reports a failure inline or (with `toast`) as a toast. */
export function useBusy({ toast = false } = {}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** After success it stays busy, since the screen is moving on, unless `idleAfterSuccess` is set. */
  async function run(task: () => Promise<unknown>, { idleAfterSuccess = false } = {}) {
    setBusy(true)
    setError(null)
    try {
      await task()
      if (idleAfterSuccess) setBusy(false)
    } catch (e) {
      if (toast) toastError(e)
      else setError(errorMessage(e))
      setBusy(false)
    }
  }

  return { busy, error, setError, run }
}
