// This device's key for a space: null while locked. It's saved on the device (non-extractable),
// so the passphrase is needed only once.
import { useCallback, useEffect, useRef, useState } from 'react'
import { keyMatches } from '../e2e'
import { keystore } from '../keystore'

export type DeviceKey = ReturnType<typeof useDeviceKey>

export function useDeviceKey(spaceId: string, e2eCheck: string | null | undefined) {
  const [key, setKeyState] = useState<CryptoKey | null>(null)
  // The latest key, for code that runs outside a render.
  const keyRef = useRef(key)
  keyRef.current = key
  /** Sets the key now, so an action straight after can already use it. */
  const setKey = useCallback((k: CryptoKey | null) => {
    keyRef.current = k
    setKeyState(k)
  }, [])
  const loaded = useLoadSavedKey(spaceId, setKey)
  useForgetMismatchedKey(key, spaceId, e2eCheck, setKey)
  return { key, keyRef, setKey, loaded }
}

/** True once this device has been checked for a saved key. */
function useLoadSavedKey(spaceId: string, setKey: (k: CryptoKey) => void): boolean {
  const [loaded, setLoaded] = useState(false)
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
  return loaded
}

/** A key saved on this device that no longer matches the space is useless; forget it. */
function useForgetMismatchedKey(key: CryptoKey | null, spaceId: string, e2eCheck: string | null | undefined, setKey: (k: null) => void) {
  useEffect(() => {
    if (!key || !e2eCheck) return
    void keyMatches(key, spaceId, e2eCheck).then((ok) => {
      if (ok) return
      setKey(null)
      void keystore.remove(spaceId).catch(() => {})
    })
  }, [key, e2eCheck, spaceId, setKey])
}
