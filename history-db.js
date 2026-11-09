// Capture history in IndexedDB: the last HISTORY_LIMIT captures, each with its original image,
// a thumbnail and the (JSON) edits, so a capture can be reopened and edited after its tab is closed.
// Everything stays in this browser profile.
const HISTORY_LIMIT = 10;
const HISTORY_DB = 'website-screen-snap';
const HISTORY_STORE = 'captures';

const idbRequest = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function historyDb() {
  historyDb.promise ||= new Promise((resolve, reject) => {
    const open = indexedDB.open(HISTORY_DB, 1);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return historyDb.promise;
}

// Runs fn(store) inside one transaction and resolves with its result once the transaction commits.
async function historyTx(mode, fn) {
  const db = await historyDb();
  const tx = db.transaction(HISTORY_STORE, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('History transaction aborted'));
  });
  const result = await fn(tx.objectStore(HISTORY_STORE));
  await done;
  return result;
}

// Newest first.
async function historyList() {
  const all = await historyTx('readonly', (store) => idbRequest(store.index('createdAt').getAll()));
  return all.reverse();
}

const historyGet = (id) => historyTx('readonly', (store) => idbRequest(store.get(id)));

// Adds an entry and drops the oldest ones beyond the limit.
async function historyAdd(entry) {
  await historyTx('readwrite', async (store) => {
    await idbRequest(store.put(entry));
    const keys = await idbRequest(store.index('createdAt').getAllKeys()); // oldest first
    for (const key of keys.slice(0, Math.max(0, keys.length - HISTORY_LIMIT))) {
      await idbRequest(store.delete(key));
    }
  });
  return entry.id;
}

async function historyUpdate(id, patch) {
  await historyTx('readwrite', async (store) => {
    const current = await idbRequest(store.get(id));
    if (current) await idbRequest(store.put({ ...current, ...patch }));
  });
}

const historyDelete = (id) => historyTx('readwrite', (store) => idbRequest(store.delete(id)));
const historyClear = () => historyTx('readwrite', (store) => idbRequest(store.clear()));
