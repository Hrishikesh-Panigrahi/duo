// This device's key for a space: null while locked. It's saved on the device
// (non-extractable, see keystore.ts) so the passphrase is needed only once.
import { useCallback, useEffect, useRef, useState } from 'react'
import { keyMatches } from '../e2e'
import { keystore } from '../keystore'

export function useDeviceKey(spaceId: string, check: string | null | undefined) {
  const [key, setKeyState] = useState<CryptoKey | null>(null)
  const [loaded, setLoaded] = useState(false)
  // The latest key, for code that runs outside a render.
  const keyRef = useRef(key)
  keyRef.current = key

  /** Sets the key now, so an action straight after can already use it. */
  const setKey = useCallback((k: CryptoKey | null) => {
    keyRef.current = k
    setKeyState(k)
  }, [])

  useEffect(() => {
    let alive = true
    keystore
      .get(spaceId)
      .then((k) => {
        if (alive && k) setKey(k)
      })
      .catch(() => {}) // no IndexedDB: the passphrase is asked for each session
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [spaceId, setKey])

  // A key saved on this device that no longer matches the space is useless; forget it.
  useEffect(() => {
    if (!key || !check) return
    void keyMatches(key, spaceId, check).then((ok) => {
      if (ok) return
      setKey(null)
      void keystore.remove(spaceId).catch(() => {})
    })
  }, [key, check, spaceId, setKey])

  return { key, keyRef, setKey, loaded }
}
