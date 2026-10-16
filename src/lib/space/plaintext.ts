// Decrypts whatever this device can read, as rows arrive, into a cache keyed by
// context + ciphertext (see view.ts). Each ciphertext is decrypted once.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { StoredMember, StoredSpace } from '../types'
import type { Rows } from './rows'
import { FAILED, pendingDecryptions } from './view'

export type Remember = (entries: (readonly [string, unknown])[]) => void

export function usePlaintext(
  key: CryptoKey | null,
  /** The latest key: results for a key that's since changed are dropped. */
  keyRef: RefObject<CryptoKey | null>,
  input: { spaceId: string; rows: Rows; space: StoredSpace | null; members: StoredMember[] },
) {
  const [plain, setPlain] = useState<Map<string, unknown>>(() => new Map())
  const inflight = useRef(new Set<string>())

  /** Adds plaintext this device already knows (it just encrypted it), so it shows straight away. */
  const remember = useCallback<Remember>(
    (entries) =>
      setPlain((prev) => {
        const next = new Map(prev)
        for (const [k, v] of entries) next.set(k, v)
        return next
      }),
    [],
  )
  /** Drops every plaintext, as when the device is locked. */
  const forget = useCallback(() => setPlain(new Map()), [])

  const { spaceId, rows, space, members } = input
  useEffect(() => {
    if (!key) return
    const jobs = pendingDecryptions(key, { spaceId, rows, space, members }, (k) => plain.has(k) || inflight.current.has(k))
    if (!jobs.length) return
    jobs.forEach((j) => inflight.current.add(j.key))
    void Promise.all(
      jobs.map(async (j) => {
        try {
          return [j.key, await j.run()] as const
        } catch {
          return [j.key, FAILED] as const
        }
      }),
    ).then((entries) => {
      entries.forEach(([k]) => inflight.current.delete(k))
      if (keyRef.current === key) remember(entries)
    })
  }, [key, keyRef, rows, space, members, plain, spaceId, remember])

  return { plain, remember, forget }
}
