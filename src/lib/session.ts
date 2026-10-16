import { supabase } from './supabase'
import { keystore } from './keystore'

/** Signs out and forgets this device's encryption keys, so the next person to sign in can't read messages. */
export async function signOut() {
  await keystore.clear().catch(() => {})
  await supabase.auth.signOut()
}
