import { supabase } from './supabase'
import { keystore } from './keystore'
import { inbox } from './inbox'

/** Also forgets this device's keys and waiting photos, so the next person to sign in can't read anything. */
export async function signOut() {
  await Promise.all([keystore.clear().catch(() => {}), inbox.clear().catch(() => {})])
  await supabase.auth.signOut()
}
