interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

// Contact Picker API (Chrome on Android). Not in TypeScript's DOM lib yet.
interface ContactsManager {
  select(
    properties: ('name' | 'tel' | 'email' | 'address')[],
    options?: { multiple?: boolean },
  ): Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>
}
interface Navigator {
  readonly contacts?: ContactsManager
  /** iOS Safari: true when launched from the home screen. */
  readonly standalone?: boolean
  setAppBadge?(count?: number): Promise<void>
  clearAppBadge?(): Promise<void>
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}
