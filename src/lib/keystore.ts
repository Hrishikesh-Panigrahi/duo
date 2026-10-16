// Keeps each space's encryption key on this device, in IndexedDB. Keys are
// non-extractable CryptoKeys: stored and used, but their bytes can't be read.
// If IndexedDB is unavailable (some private modes), callers fall back to
// keeping the key in memory, and the passphrase is asked for again next time.

const DB_NAME = 'duo-keys'
const STORE = 'keys'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export const keystore = {
  get: (spaceId: string) => run<CryptoKey | undefined>('readonly', (s) => s.get(spaceId)),
  set: (spaceId: string, key: CryptoKey) => run<void>('readwrite', (s) => s.put(key, spaceId)),
  remove: (spaceId: string) => run<void>('readwrite', (s) => s.delete(spaceId)),
  clear: () => run<void>('readwrite', (s) => s.clear()),
}
