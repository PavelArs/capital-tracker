// Where the answers of the read cache survive a reload: the browser's own IndexedDB, one row per
// read. Nothing leaves the browser. Every call can fail (a private window, blocked site data,
// no quota) and then the cache simply stays in memory, as before.

export interface StoredRead {
  key: string;
  /** The owner the answer belongs to; another owner never gets it back. */
  owner: string;
  at: number;
  value: unknown;
  /** The last refresh of this answer failed; absent in a row saved before this. */
  failed?: boolean;
}

export interface ReadStore {
  load(): Promise<StoredRead[]>;
  save(row: StoredRead): Promise<void>;
  clear(): Promise<void>;
}

const DATABASE = 'capital-tracker-reads';
const TABLE = 'reads';

function request<T>(action: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    action.onsuccess = () => resolve(action.result);
    action.onerror = () => reject(action.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** The browser's IndexedDB as a store, or null where there is none. */
export function indexedDbStore(): ReadStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(DATABASE, 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore(TABLE, { keyPath: 'key' });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => reject(new Error('blocked'));
    });
    // A failed open is tried again by the next call.
    opened.catch(() => {
      opened = null;
    });
    return opened;
  };
  return {
    async load() {
      const database = await open();
      return request<StoredRead[]>(database.transaction(TABLE).objectStore(TABLE).getAll());
    },
    async save(row) {
      const database = await open();
      const transaction = database.transaction(TABLE, 'readwrite');
      transaction.objectStore(TABLE).put(row);
      await done(transaction);
    },
    async clear() {
      const database = await open();
      const transaction = database.transaction(TABLE, 'readwrite');
      transaction.objectStore(TABLE).clear();
      await done(transaction);
    },
  };
}
