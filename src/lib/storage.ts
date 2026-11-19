import type { Note, NoteFolder } from './types';

/**
 * IndexedDB is used rather than localStorage because a single ink document can
 * easily exceed the 5 MB string quota. The schema is a single object store, so
 * notes remain portable and the app can be reset by clearing site data.
 */
const DB_NAME = 'paligraph-canvas';
const DB_VERSION = 2;
const STORE = 'notes';
const FOLDER_STORE = 'folders';

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
      if (!database.objectStoreNames.contains(FOLDER_STORE)) {
        const folders = database.createObjectStore(FOLDER_STORE, { keyPath: 'id' });
        folders.createIndex('parentId', 'parentId');
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

export async function loadFolders(): Promise<NoteFolder[]> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(FOLDER_STORE, 'readonly');
    return await requestToPromise(transaction.objectStore(FOLDER_STORE).getAll() as IDBRequest<NoteFolder[]>);
  } catch {
    // A transient folder-store failure should not make the whole library
    // unreadable; flat notes still work without folders.
    return [];
  }
}

export async function saveFolders(folders: readonly NoteFolder[]): Promise<void> {
  if (!folders.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(FOLDER_STORE, 'readwrite');
  const store = transaction.objectStore(FOLDER_STORE);
  for (const folder of folders) store.put(folder);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save folders.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The folder save was aborted.'));
  });
}

export async function removeFolders(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(FOLDER_STORE, 'readwrite');
  const store = transaction.objectStore(FOLDER_STORE);
  for (const id of ids) store.delete(id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove folders.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The folder removal was aborted.'));
  });
}

export async function removeNotes(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  for (const id of ids) store.delete(id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete notes.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The note delete was aborted.'));
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
