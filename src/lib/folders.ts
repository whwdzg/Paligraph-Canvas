import type { Note, NoteFolder } from './types';

export interface FolderNode extends NoteFolder {
  children: FolderNode[];
  depth: number;
  /** Notes directly inside this folder. */
  directCount: number;
  /** Notes in this folder and all descendants. */
  totalCount: number;
  path: string;
}

function noteFolderId(note: Note): string | null {
  return note.folderId ?? null;
}

/** Builds a stable, name-sorted tree and tolerates orphaned folders. */
export function buildFolderTree(folders: readonly NoteFolder[], notes: readonly Note[]): FolderNode[] {
  const direct = new Map<string | null, number>();
  for (const note of notes) {
    const id = noteFolderId(note);
    direct.set(id, (direct.get(id) ?? 0) + 1);
  }
  const nodes = new Map<string, FolderNode>();
  for (const folder of folders) {
    nodes.set(folder.id, {
      ...folder,
      children: [],
      depth: 0,
      directCount: direct.get(folder.id) ?? 0,
      totalCount: 0,
      path: folder.name,
    });
  }
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: FolderNode[]): void => {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  const walk = (node: FolderNode, depth: number, parentPath: string): number => {
    node.depth = depth;
    node.path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    node.totalCount = node.directCount;
    for (const child of node.children) node.totalCount += walk(child, depth + 1, node.path);
    return node.totalCount;
  };
  for (const root of roots) walk(root, 0, '');
  return roots;
}

export function flattenFolderTree(nodes: readonly FolderNode[]): FolderNode[] {
  const result: FolderNode[] = [];
  const walk = (list: readonly FolderNode[]): void => {
    for (const node of list) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

export function folderPathName(folders: readonly NoteFolder[], id: string | null | undefined): string {
  if (!id) return '';
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(' / ');
}

/** Folder ids including the folder itself, used for safe folder deletion. */
export function collectFolderIds(folders: readonly NoteFolder[], id: string): Set<string> {
  const children = new Map<string | null, NoteFolder[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const result = new Set<string>();
  const walk = (folderId: string): void => {
    if (result.has(folderId)) return;
    result.add(folderId);
    for (const child of children.get(folderId) ?? []) walk(child.id);
  };
  walk(id);
  return result;
}

export function uniqueFolderName(
  folders: readonly NoteFolder[],
  parentId: string | null,
  name: string,
  excludeId?: string,
): string {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Folder';
  const siblings = new Set(
    folders
      .filter((folder) => folder.parentId === parentId && folder.id !== excludeId)
      .map((folder) => folder.name.toLocaleLowerCase()),
  );
  if (!siblings.has(clean.toLocaleLowerCase())) return clean;
  let index = 2;
  while (siblings.has(`${clean} ${index}`.toLocaleLowerCase())) index += 1;
  return `${clean} ${index}`;
}
