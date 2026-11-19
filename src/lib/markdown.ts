import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import 'katex/dist/katex.min.css';

/**
 * Markdown is imported from arbitrary Obsidian vaults, so rendering goes
 * through two explicit stages: Obsidian syntax normalisation, then DOMPurify.
 * The raw source is always preserved on the note for lossless Markdown export.
 */

marked.setOptions({ gfm: true, breaks: false });

export interface ParsedMarkdown {
  title: string;
  source: string;
  excerpt: string;
}

function stripFrontmatter(source: string): { frontmatter: string; body: string } {
  const normalised = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalised.startsWith('---\n')) return { frontmatter: '', body: normalised };
  const end = normalised.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: '', body: normalised };
  return { frontmatter: normalised.slice(4, end), body: normalised.slice(end + 4).replace(/^\n+/, '') };
}

function frontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'im'));
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

/** Replaces Obsidian embeds/links with standard Markdown or readable text. */
export function normalizeObsidianMarkdown(source: string, assets: ReadonlyMap<string, string> = new Map()): string {
  let text = stripFrontmatter(source).body;

  text = text.replace(/!\[\[([^\]]+)\]\]/g, (_match, raw: string) => {
    const [targetRaw, ...aliasParts] = raw.split('|');
    const target = targetRaw.split('#')[0].trim();
    const alias = (aliasParts.join('|') || target.split('/').pop() || target).trim();
    const asset = assets.get(target.toLowerCase()) ??
      assets.get(target.split('/').pop()?.toLowerCase() ?? '') ??
      assets.get(target.replace(/\.[^.]+$/, '').toLowerCase());
    return asset ? `![${alias}](${asset})` : alias;
  });

  text = text.replace(/\[\[([^\]]+)\]\]/g, (_match, raw: string) => {
    const [target, ...aliasParts] = raw.split('|');
    const label = (aliasParts.join('|') || target.split('#').pop() || target).trim();
    return label;
  });

  // Obsidian callout marker: keep the quote but turn `[!tip] Title` into a
  // readable bold title. Full callout colouring is intentionally out of scope.
  text = text.replace(/^>\s*\[!([A-Za-z]+)\][+-]?\s*(.*)$/gm, (_match, type: string, title: string) => {
    const fallback = `${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()}`;
    return `> **${title.trim() || fallback}**`;
  });

  // Obsidian's ==highlight== syntax maps naturally to HTML <mark>, which
  // DOMPurify permits; markdown inside it still needs parsing, so use a span
  // marker instead and replace the wrapper after rendering.
  text = text.replace(/==([^=\n]+)==/g, '<span class="md-highlight">$1</span>');

  // Collapse excessive blank lines in very long vault notes; it makes the
  // reading card much calmer without touching the stored source.
  return text.replace(/\n{4,}/g, '\n\n\n');
}

const MATH_SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);
const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\$)\$(?![\s$])([^\n$]*?[^\s$])\$(?!\$)/g;

/** KaTeX's trusted, script-free output (user macros are not enabled). */
export function renderLatexToHtml(expression: string, displayMode = false): string {
  return katex.renderToString(expression.trim(), {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
  });
}

function sanitizeMathHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ['style', 'aria-hidden'],
    FORBID_TAGS: ['style', 'iframe', 'form', 'button', 'textarea', 'select', 'video', 'audio', 'script'],
  });
}

function replaceMathInText(documentFragment: Document, text: string): DocumentFragment | null {
  const regex = new RegExp(MATH_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  let last = 0;
  const fragment = documentFragment.createDocumentFragment();
  let found = false;
  while ((match = regex.exec(text))) {
    found = true;
    if (match.index > last) fragment.append(documentFragment.createTextNode(text.slice(last, match.index)));
    const display = match[1] !== undefined || match[2] !== undefined;
    const expression = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
    const wrapper = documentFragment.createElement('span');
    wrapper.className = display ? 'math-display' : 'math-inline';
    try {
      wrapper.innerHTML = sanitizeMathHtml(renderLatexToHtml(expression, display));
    } catch {
      wrapper.textContent = match[0];
    }
    fragment.append(wrapper);
    last = regex.lastIndex;
  }
  if (!found) return null;
  if (last < text.length) fragment.append(documentFragment.createTextNode(text.slice(last)));
  return fragment;
}

function renderMathInDocument(documentFragment: Document): void {
  const walker = documentFragment.createTreeWalker(documentFragment.body, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (
      node.nodeType === 3 &&
      node.nodeValue &&
      (node.nodeValue.includes('$') || node.nodeValue.includes('\\(') || node.nodeValue.includes('\\[')) &&
      !MATH_SKIP_TAGS.has(parent?.tagName ?? '') &&
      !parent?.closest('.katex')
    ) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const replacement = replaceMathInText(documentFragment, textNode.nodeValue ?? '');
    if (replacement) textNode.replaceWith(replacement);
  }
}

export function markdownToHtml(source: string, assets: ReadonlyMap<string, string> = new Map()): string {
  const normalized = normalizeObsidianMarkdown(source, assets);
  const rendered = marked.parse(normalized, { async: false }) as string;
  const clean = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'loading', 'decoding', 'disabled', 'checked'],
    // Inputs are permitted for GFM task-list checkboxes, but forms and media
    // controls remain blocked. DOMPurify strips all event-handler attributes.
    FORBID_TAGS: ['style', 'iframe', 'form', 'button', 'textarea', 'select', 'video', 'audio'],
    FORBID_ATTR: ['style', 'srcset'],
  });

  // Markdown links to vault attachments that weren't part of the selection
  // would otherwise render as broken-image glyphs. Replace them with a quiet
  // text placeholder while keeping remote images intact.
  const documentFragment = new DOMParser().parseFromString(clean, 'text/html');
  for (const checkbox of [...documentFragment.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]')]) {
    checkbox.disabled = true;
    const item = checkbox.closest('li');
    item?.classList.add('task-list-item');
    item?.parentElement?.classList.add('contains-task-list');
  }
  for (const image of [...documentFragment.images]) {
    const src = image.getAttribute('src') ?? '';
    if (src.startsWith('data:') || src.startsWith('blob:') || /^https?:\/\//i.test(src)) {
      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
      continue;
    }
    const placeholder = documentFragment.createElement('span');
    placeholder.className = 'md-image-missing';
    placeholder.textContent = image.alt ? `[Image: ${image.alt}]` : '[Image unavailable]';
    image.replaceWith(placeholder);
  }
  renderMathInDocument(documentFragment);
  // The first pass stripped all style attributes. The second pass allows them
  // only for KaTeX's generated layout markup, which was sanitised separately.
  return DOMPurify.sanitize(documentFragment.body.innerHTML, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ['target', 'rel', 'loading', 'decoding', 'disabled', 'checked', 'style'],
    FORBID_TAGS: ['style', 'iframe', 'form', 'button', 'textarea', 'select', 'video', 'audio', 'script'],
    FORBID_ATTR: ['srcset'],
  });
}

export function markdownExcerpt(source: string, length = 140): string {
  const text = stripFrontmatter(source).body
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length).trimEnd()}…`;
}

export function titleFromMarkdown(source: string, fallback: string): string {
  const { frontmatter, body } = stripFrontmatter(source);
  const metaTitle = frontmatterValue(frontmatter, 'title');
  if (metaTitle) return metaTitle;
  const heading = body.match(/^\s*#\s+(.+)$/m);
  if (heading) return heading[1].replace(/#+\s*$/, '').trim();
  const clean = fallback.replace(/\.(md|markdown)$/i, '').replace(/[_-]+/g, ' ').trim();
  return clean || 'Untitled';
}

export function parseMarkdownFile(source: string, filename: string): ParsedMarkdown {
  return {
    title: titleFromMarkdown(source, filename),
    source: source.replace(/\r\n?/g, '\n'),
    excerpt: markdownExcerpt(source),
  };
}

/** Reading-time estimate used in the source drawer. */
export function estimateReadingMinutes(source: string): number {
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
