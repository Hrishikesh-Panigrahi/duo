// localStorage that never throws. It's missing or blocked in some private modes, and nothing kept here
// is essential: without it the app just forgets these small things.
export const deviceStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },

  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // not kept
    }
  },

  remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      // nothing was kept
    }
  },
}
