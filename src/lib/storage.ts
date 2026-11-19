import type { Note } from './types';

/**
 * IndexedDB is used rather than localStorage because a single ink document can
 * easily exceed the 5 MB string quota. The schema is a single object store, so
 * notes remain portable and the app can be reset by clearing site data.
 */
const DB_NAME = 'paligraph-canvas';
const DB_VERSION = 1;
const STORE = 'notes';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open the note database.'));
    request.onblocked = () => reject(new Error('The note database is blocked by another tab.'));
  });
  return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export async function loadNotes(): Promise<Note[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readonly');
  const notes = await requestToPromise(transaction.objectStore(STORE).getAll() as IDBRequest<Note[]>);
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveNote(note: Note): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).put(note);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the note.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The note save was aborted.'));
  });
}

export async function saveNotes(notes: readonly Note[]): Promise<void> {
  if (!notes.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  for (const note of notes) store.put(note);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save notes.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The note save was aborted.'));
  });
}

export async function removeNote(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete the note.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The note delete was aborted.'));
  });
}

export async function clearNotes(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).clear();
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear notes.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The clear operation was aborted.'));
  });
}
