// Photos and videos delivered straight from the other phone wait here until they're opened,
// exactly as they arrived: still end-to-end encrypted.

const DB_NAME = 'duo-inbox'
const STORE = 'media'
const BY_TIME = 'receivedAt'

export type InboxEntry = { messageId: string; bytes: ArrayBuffer; receivedAt: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'messageId' })
      store.createIndex(BY_TIME, BY_TIME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore, done: (v: T) => void) => IDBRequest | void): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      const req = op(tx.objectStore(STORE), resolve)
      // A write only counts once it's committed to disk.
      if (mode === 'readwrite') tx.oncomplete = () => resolve(req?.result as T)
      else if (req) req.onsuccess = () => resolve(req.result as T)
    })
  } finally {
    db.close()
  }
}

export const inbox = {
  put: (messageId: string, bytes: ArrayBuffer) =>
    run<void>('readwrite', (s) => s.put({ messageId, bytes, receivedAt: Date.now() } satisfies InboxEntry)),
  get: async (messageId: string) => (await run<InboxEntry | undefined>('readonly', (s) => s.get(messageId)))?.bytes,
  remove: (messageId: string) => run<void>('readwrite', (s) => s.delete(messageId)),
  /** What's waiting, without loading the files themselves. */
  list: () =>
    run<{ messageId: string; receivedAt: number }[]>('readonly', (s, done) => {
      const out: { messageId: string; receivedAt: number }[] = []
      const req = s.index(BY_TIME).openKeyCursor()
      req.onsuccess = () => {
        const c = req.result
        if (!c) return done(out)
        out.push({ messageId: String(c.primaryKey), receivedAt: Number(c.key) })
        c.continue()
      }
    }),
  clear: () => run<void>('readwrite', (s) => s.clear()),
}
