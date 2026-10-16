import { supabase } from './supabase'
import { keystore } from './keystore'
import { inbox } from './inbox'

/**
 * Signs out and forgets this device's encryption keys and any photos or
 * videos waiting here, so the next person to sign in can't read anything.
 */
export async function signOut() {
  await Promise.all([keystore.clear().catch(() => {}), inbox.clear().catch(() => {})])
  await supabase.auth.signOut()
}
