import { createContext, useContext } from 'react'

export type Tab = 'chat' | 'contacts' | 'lists' | 'notes'

export type Nav = {
  tab: Tab
  setTab: (t: Tab) => void
  /** Switches to Contacts and opens this contact. */
  openContact: (id: string) => void
  contactIdToOpen: string | null
  clearContactIdToOpen: () => void
}

export const NavContext = createContext<Nav | null>(null)

export function useNav(): Nav {
  const nav = useContext(NavContext)
  if (!nav) throw new Error('useNav must be used inside <Shell>')
  return nav
}
