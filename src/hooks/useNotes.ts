import { useCallback, useEffect, useRef, useState } from 'react';
import { createId } from '../lib/strokes';
import { loadNotes, removeNote, saveNote, saveNotes } from '../lib/storage';
import { generateThumbnail } from '../lib/thumbnail';
import type { Note } from '../lib/types';
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
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const notesRef = useRef<Note[]>([]);
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
        let stored = await loadNotes();
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
  }, [commit, refreshThumbnail, updateActive]);

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
    activeNote,
    activeId,
    loading,
    fatalError,
    saveStatus,
    selectNote,
    createNote,
    importNotes,
    updateNote,
    patchNote,
    deleteNote,
    flush,
    replaceAll,
  };
}
