// Photos and videos delivered straight from the other phone wait here until they're opened,
// exactly as they arrived: still end-to-end encrypted.

const DB_NAME = 'duo-inbox'
const STORE_NAME = 'media'
const BY_TIME = 'receivedAt'

export type InboxEntry = { messageId: string; bytes: ArrayBuffer; receivedAt: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'messageId' })
      store.createIndex(BY_TIME, BY_TIME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** `makeRequest` returns the request whose result is the answer, or calls `resolveWith` itself (for cursors). */
async function inTransaction<T>(
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore, resolveWith: (value: T) => void) => IDBRequest | void,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
      const request = makeRequest(transaction.objectStore(STORE_NAME), resolve)
      // A write only counts once it's committed to disk.
      if (mode === 'readwrite') transaction.oncomplete = () => resolve(request?.result as T)
      else if (request) request.onsuccess = () => resolve(request.result as T)
    })
  } finally {
    db.close()
  }
}

export const inbox = {
  put: (messageId: string, bytes: ArrayBuffer) =>
    inTransaction<void>('readwrite', (store) => store.put({ messageId, bytes, receivedAt: Date.now() } satisfies InboxEntry)),
  get: async (messageId: string) => {
    const entry = await inTransaction<InboxEntry | undefined>('readonly', (store) => store.get(messageId))
    return entry?.bytes
  },
  remove: (messageId: string) => inTransaction<void>('readwrite', (store) => store.delete(messageId)),
  /** What's waiting, without loading the files themselves. */
  list: () =>
    inTransaction<{ messageId: string; receivedAt: number }[]>('readonly', (store, resolveWith) => {
      const waiting: { messageId: string; receivedAt: number }[] = []
      const request = store.index(BY_TIME).openKeyCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return resolveWith(waiting)
        waiting.push({ messageId: String(cursor.primaryKey), receivedAt: Number(cursor.key) })
        cursor.continue()
      }
    }),
  clear: () => inTransaction<void>('readwrite', (store) => store.clear()),
}
