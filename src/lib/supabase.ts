import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined

export const isConfigured = Boolean(url && key)

// With no config the app shows setup instructions instead of using this client.
export const supabase = createClient(url || 'http://localhost', key || 'not-configured')

type ServerError = { message: string; code?: string }

/**
 * Turns a server error into something safe to show. Only messages our own
 * database functions raise on purpose (code P0001, like "That invite code
 * doesn't match any space") are shown as they are; anything else would name
 * tables, columns or rules, so people see a plain message instead.
 */
export function serverError(error: ServerError): Error {
  if (import.meta.env.DEV) console.warn('Server error', error)
  if (error.code === 'P0001') return new Error(error.message)
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(error.message)) return new Error(error.message)
  if (/maximum allowed size|payload too large/i.test(error.message)) return new Error('That file is too big to send.')
  if (error.code === 'PGRST116') return new Error('That was deleted, or you no longer have access to it.')
  if (error.code === '42501') return new Error("You don't have access to that.")
  return new Error("That didn't go through. Try again in a moment.")
}

/** Unwraps a Supabase response, throwing a safe-to-show error so callers can toast it. */
export async function must<T>(query: PromiseLike<{ data: T | null; error: ServerError | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw serverError(error)
  return data as T
}
