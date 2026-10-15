import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined

export const isConfigured = Boolean(url && key)

// With no config the app shows setup instructions instead of using this client.
export const supabase = createClient(url || 'http://localhost', key || 'not-configured')

/** Unwraps a Supabase response, throwing its error so callers can toast it. */
export async function must<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as T
}
