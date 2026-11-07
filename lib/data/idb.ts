// Tiny IndexedDB wrapper for the fake data layer: JSON records and Blobs, keyed by string.
// Replaced by Supabase (records) and R2 (blobs) in /replica-backend.

const DB_NAME = "cleanup";
const DB_VERSION = 1;
export const RECORDS = "records";
export const BLOBS = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS);
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store: string, key: string, value: unknown): Promise<void> {
  const db = await open();
  await done(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}

export async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  return done(db.transaction(store, "readonly").objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function del(store: string, key: string): Promise<void> {
  const db = await open();
  await done(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

export async function entries<T>(store: string): Promise<[string, T][]> {
  const db = await open();
  const os = db.transaction(store, "readonly").objectStore(store);
  const [keys, values] = await Promise.all([done(os.getAllKeys()), done(os.getAll())]);
  return keys.map((k, i) => [String(k), values[i] as T]);
}

export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDS, BLOBS], "readwrite");
  tx.objectStore(RECORDS).clear();
  tx.objectStore(BLOBS).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
