// Decrypts whatever this device can read, as rows arrive, into a cache keyed by context + ciphertext.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { StoredMember, StoredSpace } from '../types'
import type { Rows } from './rows'
import { FAILED, pendingDecryptions, type PlainCache } from './view'

export type Remember = (entries: (readonly [string, unknown])[]) => void
export type Plaintext = ReturnType<typeof usePlaintext>
type Encrypted = { spaceId: string; rows: Rows; space: StoredSpace | null; members: StoredMember[] }

/** `keyRef` is the latest key: results for a key that's since changed are dropped. */
export function usePlaintext(key: CryptoKey | null, keyRef: RefObject<CryptoKey | null>, encrypted: Encrypted) {
  const [plain, setPlain] = useState<PlainCache>(() => new Map())
  /** Adds plaintext this device already knows (it just encrypted it), so it shows straight away. */
  const remember = useCallback<Remember>((entries) => setPlain((prev) => new Map([...prev, ...entries])), [])
  /** Drops every plaintext, as when the device is locked. */
  const forget = useCallback(() => setPlain(new Map()), [])
  useDecryptNew(key, keyRef, encrypted, plain, remember)
  return { plain, remember, forget }
}

/** Decrypts each ciphertext once. */
function useDecryptNew(key: CryptoKey | null, keyRef: RefObject<CryptoKey | null>, encrypted: Encrypted, plain: PlainCache, remember: Remember) {
  const inflight = useRef(new Set<string>())
  const { spaceId, rows, space, members } = encrypted
  useEffect(() => {
    if (!key) return
    const jobs = pendingDecryptions(key, { spaceId, rows, space, members }, (k) => plain.has(k) || inflight.current.has(k))
    if (!jobs.length) return
    jobs.forEach((j) => inflight.current.add(j.key))
    const results = jobs.map((j) => j.run().then((v) => [j.key, v] as const, () => [j.key, FAILED] as const))
    void Promise.all(results).then((entries) => {
      entries.forEach(([k]) => inflight.current.delete(k))
      if (keyRef.current === key) remember(entries)
    })
  }, [key, keyRef, rows, space, members, plain, spaceId, remember])
}
