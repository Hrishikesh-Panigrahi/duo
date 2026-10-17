import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined

export const isConfigured = Boolean(supabaseUrl && publishableKey)

// With no config the app shows setup instructions instead of using this client.
export const supabase = createClient(supabaseUrl || 'http://localhost', publishableKey || 'not-configured')

type ServerError = { message: string; code?: string }

/** Raised on purpose by our own database functions, with a message written to be shown. */
const OUR_FUNCTION_ERROR = 'P0001'
/** PostgREST: one row was asked for, but none (or several) came back. */
const NO_ROW_RETURNED = 'PGRST116'
const PERMISSION_DENIED = '42501'
const NETWORK_FAILURE = /failed to fetch|load failed|networkerror|network request failed/i
const TOO_LARGE = /maximum allowed size|payload too large/i

/** Something safe to show: only our own functions' messages (P0001) pass through, never table or rule names. */
export function serverError(error: ServerError): Error {
  if (import.meta.env.DEV) console.warn('Server error', error)
  if (error.code === OUR_FUNCTION_ERROR) return new Error(error.message)
  if (NETWORK_FAILURE.test(error.message)) return new Error(error.message)
  if (TOO_LARGE.test(error.message)) return new Error('That file is too big to send.')
  if (error.code === NO_ROW_RETURNED) return new Error('That was deleted, or you no longer have access to it.')
  if (error.code === PERMISSION_DENIED) return new Error("You don't have access to that.")
  return new Error("That didn't go through. Try again in a moment.")
}

/** Unwraps a Supabase response, throwing a safe-to-show error so callers can toast it. */
export async function must<T>(query: PromiseLike<{ data: T | null; error: ServerError | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw serverError(error)
  return data as T
}
