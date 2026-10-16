// Decrypts whatever this device can read, as rows arrive, into a cache keyed by context + ciphertext.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { StoredMember, StoredSpace } from '../types'
import type { Rows } from './rows'
import { FAILED, pendingDecryptions, type PlainCache } from './view'

export type Remember = (entries: (readonly [string, unknown])[]) => void
export type Plaintext = ReturnType<typeof usePlaintext>
type StoredState = { spaceId: string; rows: Rows; space: StoredSpace | null; members: StoredMember[] }

/** `keyRef` is the latest key: results for a key that's since changed are dropped. */
export function usePlaintext(key: CryptoKey | null, keyRef: RefObject<CryptoKey | null>, stored: StoredState) {
  const [plain, setPlain] = useState<PlainCache>(() => new Map())
  /** Adds plaintext this device already knows (it just encrypted it), so it shows straight away. */
  const remember = useCallback<Remember>((entries) => setPlain((prev) => new Map([...prev, ...entries])), [])
  /** Drops every plaintext, as when the device is locked. */
  const forget = useCallback(() => setPlain(new Map()), [])
  useDecryptNew(key, keyRef, stored, plain, remember)
  return { plain, remember, forget }
}

/** Decrypts each ciphertext once. */
function useDecryptNew(key: CryptoKey | null, keyRef: RefObject<CryptoKey | null>, stored: StoredState, plain: PlainCache, remember: Remember) {
  const inFlight = useRef(new Set<string>())
  const { spaceId, rows, space, members } = stored
  useEffect(() => {
    if (!key) return
    const isDoneOrInFlight = (entryKey: string) => plain.has(entryKey) || inFlight.current.has(entryKey)
    const jobs = pendingDecryptions(key, { spaceId, rows, space, members }, isDoneOrInFlight)
    if (!jobs.length) return
    for (const job of jobs) inFlight.current.add(job.cacheKey)
    // All jobs start at once, and their results go into the cache in one update.
    const results = jobs.map(async (job) => {
      try {
        return [job.cacheKey, await job.decrypt()] as const
      } catch {
        return [job.cacheKey, FAILED] as const
      }
    })
    void Promise.all(results).then((entries) => {
      for (const [entryKey] of entries) inFlight.current.delete(entryKey)
      if (keyRef.current === key) remember(entries)
    })
  }, [key, keyRef, rows, space, members, plain, spaceId, remember])
}
