// Each space's key, kept on this device as a non-extractable CryptoKey: usable, but its bytes can't be read.
// Without IndexedDB (some private modes) the key stays in memory and the passphrase is asked for next time.

const DB_NAME = 'duo-keys'
const STORE_NAME = 'keys'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function inTransaction<T>(mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = makeRequest(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export const keystore = {
  get: (spaceId: string) => inTransaction<CryptoKey | undefined>('readonly', (store) => store.get(spaceId)),
  set: (spaceId: string, key: CryptoKey) => inTransaction<void>('readwrite', (store) => store.put(key, spaceId)),
  remove: (spaceId: string) => inTransaction<void>('readwrite', (store) => store.delete(spaceId)),
  clear: () => inTransaction<void>('readwrite', (store) => store.clear()),
}
