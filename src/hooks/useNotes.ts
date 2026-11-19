import { useCallback, useEffect, useRef, useState } from 'react';
import { createId } from '../lib/strokes';
import { collectFolderIds, uniqueFolderName } from '../lib/folders';
import {
  loadFolders,
  loadNotes,
  removeFolders,
  removeNote,
  removeNotes,
  saveFolders,
  saveNote,
  saveNotes,
} from '../lib/storage';
import { generateThumbnail } from '../lib/thumbnail';
import type { Note, NoteFolder } from '../lib/types';
import { createWelcomeNote } from '../lib/welcome';
import type { ResolvedTheme } from '../lib/renderer';

type Translate = (key: string, values?: Record<string, string | number>) => string;
export type SaveStatus = 'saved' | 'saving' | 'error';

const ACTIVE_NOTE_KEY = 'paligraph-active-note';
const SAVE_DELAY = 650;

interface UpdateOptions {
  /** Skip reordering for ephemeral metadata or background changes? Kept for API clarity. */
  touch?: boolean;
  delay?: number;
}

export interface NewNoteOptions {
  title?: string;
  markdown?: string;
  sourcePath?: string;
  assets?: Record<string, string>;
  background?: Note['background'];
  folderId?: string | null;
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Owns the note collection, active selection and debounced persistence.
 * Ink gestures never write to IndexedDB directly: the editor commits a vector
 * snapshot, this hook coalesces saves and only refreshes the small thumbnail
 * after the user pauses, keeping drawing interactive.
 */
export function useNotes(t: Translate, theme: ResolvedTheme) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const notesRef = useRef<Note[]>([]);
  const foldersRef = useRef<NoteFolder[]>([]);
  const tRef = useRef(t);
  const themeRef = useRef(theme);
  const timers = useRef(new Map<string, number>());
  const saveGeneration = useRef(new Map<string, number>());
  const activeIdRef = useRef<string | null>(null);

  tRef.current = t;
  themeRef.current = theme;

  const commit = useCallback((next: Note[]) => {
    notesRef.current = next;
    setNotes(next);
  }, []);

  const commitFolders = useCallback((next: NoteFolder[]) => {
    foldersRef.current = next;
    setFolders(next);
  }, []);

  const updateActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_NOTE_KEY, id);
      else localStorage.removeItem(ACTIVE_NOTE_KEY);
    } catch {
      // Private mode can deny localStorage; the session still works.
    }
  }, []);

  const refreshThumbnail = useCallback(async (note: Note): Promise<Note> => {
    try {
      const thumbnail = await generateThumbnail(note, themeRef.current);
      return thumbnail ? { ...note, thumbnail } : note;
    } catch {
      return note;
    }
  }, []);

  const persist = useCallback(
    async (id: string): Promise<void> => {
      const note = notesRef.current.find((item) => item.id === id);
      if (!note) return;
      const generation = (saveGeneration.current.get(id) ?? 0) + 1;
      saveGeneration.current.set(id, generation);
      const enriched = await refreshThumbnail(note);
      if (enriched !== note) {
        const next = notesRef.current.map((item) => (item.id === id ? enriched : item));
        notesRef.current = next;
        setNotes(next);
      }
      try {
        await saveNote(enriched);
        if (saveGeneration.current.get(id) === generation && activeIdRef.current === id) setSaveStatus('saved');
      } catch (error) {
        if (activeIdRef.current === id) setSaveStatus('error');
        console.error('Could not save note', error);
      }
    },
    [refreshThumbnail],
  );

  const schedulePersist = useCallback(
    (id: string, delay = SAVE_DELAY) => {
      const pending = timers.current.get(id);
      if (pending) window.clearTimeout(pending);
      setSaveStatus('saving');
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          void persist(id);
        }, delay),
      );
    },
    [persist],
  );

  const flush = useCallback(
    (id?: string) => {
      const ids = id ? [id] : [...timers.current.keys()];
      for (const noteId of ids) {
        const timer = timers.current.get(noteId);
        if (!timer) continue;
        window.clearTimeout(timer);
        timers.current.delete(noteId);
        void persist(noteId);
      }
    },
    [persist],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [loadedNotes, loadedFolders] = await Promise.all([loadNotes(), loadFolders()]);
        let stored = loadedNotes;
        if (!stored.length) {
          const welcome = await refreshThumbnail(createWelcomeNote(tRef.current('welcome.title')));
          await saveNote(welcome);
          stored = [welcome];
        } else if (stored.length <= 8) {
          // Backfill content previews for small libraries, including imported
          // Markdown notes saved before thumbnails were introduced.
          stored = await Promise.all(
            stored.map(async (note) => {
              if (note.thumbnail && !note.markdown) return note;
              if (note.markdown || !note.thumbnail) return refreshThumbnail(note);
              return note;
            }),
          );
          await saveNotes(stored.filter((note) => note.thumbnail));
        }
        if (cancelled) return;
        commitFolders(loadedFolders);
        commit(sortNotes(stored));
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(ACTIVE_NOTE_KEY);
        } catch {
          remembered = null;
        }
        updateActive(stored.some((note) => note.id === remembered) ? remembered : stored[0]?.id ?? null);
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        setFatalError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [commit, commitFolders, refreshThumbnail, updateActive]);

  // Persist pending edits when the tab is hidden or closed. IndexedDB writes
  // are asynchronous, so this is best-effort by design; normal edits are
  // already flushed after a short pause.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onVisibility);
      for (const timer of timers.current.values()) window.clearTimeout(timer);
    };
  }, [flush]);

  const updateNote = useCallback(
    (id: string, updater: (note: Note) => Note, options?: UpdateOptions) => {
      const current = notesRef.current.find((note) => note.id === id);
      if (!current) return;
      const updated = updater(current);
      const next = { ...updated, updatedAt: options?.touch === false ? updated.updatedAt : Date.now() };
      commit(sortNotes(notesRef.current.map((note) => (note.id === id ? next : note))));
      schedulePersist(id, options?.delay ?? SAVE_DELAY);
    },
    [commit, schedulePersist],
  );

  const patchNote = useCallback(
    (id: string, patch: Partial<Note>, options?: UpdateOptions) => {
      updateNote(id, (note) => ({ ...note, ...patch }), options);
    },
    [updateNote],
  );

  const selectNote = useCallback(
    (id: string) => {
      if (activeIdRef.current === id) return;
      flush(activeIdRef.current ?? undefined);
      updateActive(id);
      setSaveStatus('saved');
    },
    [flush, updateActive],
  );

  const createNote = useCallback(
    (options: NewNoteOptions = {}): Note => {
      const now = Date.now();
      const note: Note = {
        id: createId('note'),
        title: options.title ?? tRef.current('note.untitled'),
        markdown: options.markdown ?? '',
        sourcePath: options.sourcePath,
        assets: options.assets,
        folderId: options.folderId ?? null,
        strokes: [],
        images: [],
        background: options.background ?? {
          pattern: 'grid',
          lineStyle: 'solid',
          spacing: 32,
          opacity: 0.14,
          color: '',
        },
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      };
      flush(activeIdRef.current ?? undefined);
      commit(sortNotes([note, ...notesRef.current]));
      updateActive(note.id);
      setSaveStatus('saved');
      void saveNote(note);
      return note;
    },
    [commit, flush, updateActive],
  );

  const createFolder = useCallback(
    (name: string, parentId: string | null = null): NoteFolder => {
      const now = Date.now();
      const parent = parentId && foldersRef.current.some((folder) => folder.id === parentId) ? parentId : null;
      const folder: NoteFolder = {
        id: createId('folder'),
        name: uniqueFolderName(foldersRef.current, parent, name),
        parentId: parent,
        createdAt: now,
        updatedAt: now,
      };
      commitFolders([...foldersRef.current, folder]);
      void saveFolders([folder]).catch((error) => console.error('Could not save folder', error));
      return folder;
    },
    [commitFolders],
  );

  const renameFolder = useCallback(
    (id: string, name: string): void => {
      const folder = foldersRef.current.find((item) => item.id === id);
      if (!folder) return;
      const updated: NoteFolder = {
        ...folder,
        name: uniqueFolderName(foldersRef.current, folder.parentId, name, folder.id),
        updatedAt: Date.now(),
      };
      commitFolders(foldersRef.current.map((item) => (item.id === id ? updated : item)));
      void saveFolders([updated]).catch((error) => console.error('Could not save folder', error));
    },
    [commitFolders],
  );

  const deleteFolder = useCallback(
    async (id: string): Promise<string | null> => {
      const folder = foldersRef.current.find((item) => item.id === id);
      if (!folder) return null;
      const ids = collectFolderIds(foldersRef.current, id);
      const parentExists = folder.parentId && foldersRef.current.some((item) => item.id === folder.parentId);
      const parentId = parentExists ? folder.parentId : null;
      const affected = notesRef.current.filter((note) => note.folderId && ids.has(note.folderId));
      if (affected.length) {
        const next = notesRef.current.map((note) =>
          note.folderId && ids.has(note.folderId) ? { ...note, folderId: parentId } : note,
        );
        commit(next);
        void saveNotes(affected.map((note) => ({ ...note, folderId: parentId }))).catch((error) => {
          console.error('Could not move notes out of folder', error);
          setSaveStatus('error');
        });
      }
      commitFolders(foldersRef.current.filter((item) => !ids.has(item.id)));
      try {
        await removeFolders([...ids]);
      } catch (error) {
        console.error('Could not delete folder', error);
        setSaveStatus('error');
      }
      return parentId;
    },
    [commit, commitFolders],
  );

  /**
   * Converts Obsidian's `A/B/C` paths into nested folders. Existing names are
   * reused case-insensitively under the same parent, so re-importing a vault
   * does not create duplicate trees.
   */
  const ensureFolders = useCallback(
    (paths: readonly string[]): Map<string, string | null> => {
      const result = new Map<string, string | null>();
      const byParent = new Map<string, Map<string, string>>();
      for (const folder of foldersRef.current) {
        const key = folder.parentId ?? '';
        const names = byParent.get(key) ?? new Map<string, string>();
        names.set(folder.name.toLocaleLowerCase(), folder.id);
        byParent.set(key, names);
      }
      const created: NoteFolder[] = [];
      const ensurePath = (raw: string): string | null => {
        const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
        let parentId: string | null = null;
        for (const part of parts) {
          const key: string = parentId ?? '';
          const names: Map<string, string> = byParent.get(key) ?? new Map<string, string>();
          const existing: string | undefined = names.get(part.toLocaleLowerCase());
          if (existing) {
            parentId = existing;
            continue;
          }
          const now = Date.now();
          const folder: NoteFolder = {
            id: createId('folder'),
            name: uniqueFolderName(foldersRef.current, parentId, part),
            parentId,
            createdAt: now,
            updatedAt: now,
          };
          foldersRef.current = [...foldersRef.current, folder];
          created.push(folder);
          names.set(folder.name.toLocaleLowerCase(), folder.id);
          byParent.set(key, names);
          parentId = folder.id;
        }
        return parentId;
      };
      for (const path of paths) {
        const key = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!result.has(key)) result.set(key, ensurePath(key));
      }
      if (created.length) {
        setFolders(foldersRef.current);
        void saveFolders(created).catch((error) => {
          console.error('Could not save imported folders', error);
          setSaveStatus('error');
        });
      }
      return result;
    },
    [],
  );

  const moveNotes = useCallback(
    (ids: readonly string[], folderId: string | null): number => {
      const target = folderId && foldersRef.current.some((folder) => folder.id === folderId) ? folderId : null;
      const selected = new Set(ids);
      const changed = notesRef.current.filter((note) => selected.has(note.id) && (note.folderId ?? null) !== target);
      if (!changed.length) return 0;
      const next = notesRef.current.map((note) =>
        selected.has(note.id) ? { ...note, folderId: target } : note,
      );
      commit(next);
      void saveNotes(changed.map((note) => ({ ...note, folderId: target }))).catch((error) => {
        console.error('Could not move notes', error);
        setSaveStatus('error');
      });
      return changed.length;
    },
    [commit],
  );

  const deleteNotes = useCallback(
    async (ids: readonly string[]): Promise<number> => {
      const selected = new Set(ids);
      if (!selected.size) return 0;
      for (const id of selected) {
        const timer = timers.current.get(id);
        if (timer) window.clearTimeout(timer);
        timers.current.delete(id);
      }
      const remaining = notesRef.current.filter((note) => !selected.has(note.id));
      commit(remaining);
      if (activeIdRef.current && selected.has(activeIdRef.current)) {
        updateActive(remaining[0]?.id ?? null);
      }
      try {
        await removeNotes([...selected]);
      } catch (error) {
        console.error('Could not delete notes', error);
        setSaveStatus('error');
      }
      return selected.size;
    },
    [commit, updateActive],
  );

  const importNotes = useCallback(
    (incoming: Array<Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>>): Note[] => {
      const now = Date.now();
      const created = incoming.map((note, index) => ({
        ...note,
        id: createId('note'),
        createdAt: now - index,
        updatedAt: now - index,
        schemaVersion: 1,
      })) satisfies Note[];
      if (!created.length) return [];
      commit(sortNotes([...created, ...notesRef.current]));
      updateActive(created[0].id);
      setSaveStatus('saved');
      void saveNotes(created).catch((error) => {
        console.error('Could not import notes', error);
        setSaveStatus('error');
      });

      // Render content previews in the background. A bounded worker pool keeps
      // a 200-note vault from allocating 200 canvases at once.
      const queue = created.map((note) => note.id);
      const worker = async (): Promise<void> => {
        while (queue.length) {
          const id = queue.shift();
          if (!id) return;
          const note = notesRef.current.find((item) => item.id === id);
          if (!note) continue;
          try {
            const thumbnail = await generateThumbnail(note, themeRef.current);
            if (!thumbnail) continue;
            const latest = notesRef.current.find((item) => item.id === id);
            if (!latest) continue;
            const enriched = { ...latest, thumbnail };
            notesRef.current = notesRef.current.map((item) => (item.id === id ? enriched : item));
            setNotes(notesRef.current);
            await saveNote(enriched);
          } catch (error) {
            console.error('Could not create note preview', error);
          }
        }
      };
      void Promise.all(Array.from({ length: Math.min(4, created.length) }, () => worker()));
      return created;
    },
    [commit, updateActive],
  );

  const deleteNote = useCallback(
    async (id: string): Promise<void> => {
      const timer = timers.current.get(id);
      if (timer) window.clearTimeout(timer);
      timers.current.delete(id);
      const remaining = notesRef.current.filter((note) => note.id !== id);
      commit(remaining);
      if (activeIdRef.current === id) updateActive(remaining[0]?.id ?? null);
      try {
        await removeNote(id);
      } catch (error) {
        console.error('Could not delete note', error);
        setSaveStatus('error');
      }
    },
    [commit, updateActive],
  );

  const replaceAll = useCallback(
    (next: Note[]) => {
      flush();
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
      const sorted = sortNotes(next);
      commit(sorted);
      updateActive(sorted[0]?.id ?? null);
      setSaveStatus('saved');
    },
    [commit, flush, updateActive],
  );

  const activeNote = notes.find((note) => note.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && notes.length) updateActive(notes[0].id);
    if (activeId && !notes.some((note) => note.id === activeId) && notes.length) updateActive(notes[0].id);
  }, [activeId, notes, updateActive]);

  return {
    notes,
    folders,
    activeNote,
    activeId,
    loading,
    fatalError,
    saveStatus,
    selectNote,
    createNote,
    createFolder,
    renameFolder,
    deleteFolder,
    ensureFolders,
    moveNotes,
    deleteNotes,
    importNotes,
    updateNote,
    patchNote,
    deleteNote,
    flush,
    replaceAll,
  };
}
