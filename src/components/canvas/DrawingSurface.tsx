import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Sparkle24Filled } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import {
  applyView,
  drawStroke,
  fitView,
  prepareCanvas,
  renderBackgroundLayer,
  renderInk,
  renderOverlay,
  selectionScreenGeometry,
  type ResolvedTheme,
  type SelectionPreview,
} from '../../lib/renderer';
import {
  boundsCenter,
  boundsIntersect,
  clamp,
  distance,
  expandBounds,
  pointsBounds,
  rotatePoint,
  simplifyPoints,
  unionBounds,
} from '../../lib/geometry';
import {
  cloneStrokes,
  finishStroke,
  hitTestStroke,
  makeSelection,
  strokeIntersectsEraser,
  strokeBounds,
  strokesInLasso,
} from '../../lib/strokes';
import { previewShapeStroke, recognizeShape, snapStrokeToShape, type ShapeFit } from '../../lib/shapes';
import type {
  Bounds,
  HighlighterMode,
  InkPoint,
  InkTool,
  Note,
  PenVariant,
  Selection,
  Settings,
  ShapeKind,
  Stroke,
  ViewTransform,
} from '../../lib/types';

const CARD_X = -390;
const CARD_Y = -240;
const CARD_WIDTH = 780;
const MAX_HISTORY = 80;
const LONG_PRESS_MS = 260;

const PASTEL_TOOLS: Record<PenVariant, { opacity: number }> = {
  pen: { opacity: 1 },
  pencil: { opacity: 0.9 },
  crayon: { opacity: 0.82 },
  brush: { opacity: 0.96 },
};

interface HistoryEntry {
  before: Stroke[];
  after: Stroke[];
}

interface DirtyFlags {
  background: boolean;
  ink: boolean;
  live: boolean;
  overlay: boolean;
}

interface DrawInteraction {
  pointerId: number;
  points: InkPoint[];
  variant: PenVariant | 'highlighter';
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  opacity: number;
  mode?: HighlighterMode;
  firstPoint: InkPoint;
}

interface EraseInteraction {
  pointerId: number;
  points: InkPoint[];
  modal: 'stroke' | 'pixel';
  removed: Set<string>;
  size: number;
}

interface LassoInteraction {
  pointerId: number;
  points: InkPoint[];
}

interface PanInteraction {
  pointerId: number;
  startX: number;
  startY: number;
  startView: ViewTransform;
}

interface SelectionInteraction {
  pointerId: number;
  mode: 'move' | 'rotate';
  startWorld: InkPoint;
  center: { x: number; y: number };
  startAngle: number;
  startSelection: Selection;
  preview: SelectionPreview;
}

interface GestureCandidate {
  timer: number;
  startedAt: number;
  startMid: { x: number; y: number };
  startDistance: number;
}

interface GestureState {
  startMid: { x: number; y: number };
  startDistance: number;
  startView: ViewTransform;
}

interface LivePreview {
  kind: 'draft';
  stroke: Stroke;
}

interface SelectionPreviewLive {
  kind: 'selection';
  strokes: Stroke[];
  preview: SelectionPreview;
  center: { x: number; y: number };
}

interface ShapeCandidate {
  fit: ShapeFit;
  interaction: DrawInteraction;
}

interface MathPress {
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
  strokes: Stroke[];
}

interface ShapeHint {
  kind: ShapeKind;
  x: number;
  y: number;
}

export interface DrawingSurfaceHandle {
  undo: () => void;
  redo: () => void;
  copySelection: () => void;
  paste: () => void;
  deleteSelection: () => void;
  deselect: () => void;
  duplicateSelection: () => void;
  rotateSelection: (degrees: number) => void;
  clearCanvas: () => void;
  fitToContent: () => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface DrawingSurfaceProps {
  note: Note;
  tool: InkTool;
  theme: ResolvedTheme;
  settings: Settings;
  markdownHtml: string;
  markdownMeta: { title: string; sourcePath?: string; readingMinutes: number };
  gestureHint: string;
  hasInk: boolean;
  onStrokesChange: (strokes: Stroke[]) => void;
  onSelectionChange: (selection: Selection | null) => void;
  onHistoryChange: (state: { undo: boolean; redo: boolean }) => void;
  onViewScaleChange: (scale: number) => void;
  onToast: (message: string) => void;
  onToolChange: (tool: InkTool) => void;
  onMathRequest: (strokes: Stroke[]) => void;
  onImagePreview: (src: string, alt: string) => void;
}

/** Session clipboard shared across note switches, following the user's intent. */
let selectionClipboard: Stroke[] = [];

/** Keeps four full-screen layers inside a sensible GPU/CPU memory budget. */
function renderDpr(width: number, height: number): number {
  const device = Math.min(window.devicePixelRatio || 1, 2);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const memoryCap = memory !== undefined && memory <= 4 ? 1.25 : 2;
  const pixelBudget = Math.sqrt(3_600_000 / Math.max(1, width * height));
  return Math.max(0.75, Math.min(device, memoryCap, pixelBudget));
}

function initialView(note: Note, width: number, height: number): ViewTransform {
  if (note.markdown) {
    const scale = clamp((width - 132) / (CARD_WIDTH + 50), 0.36, 1.05);
    return { scale, x: width / 2, y: 72 + Math.abs(CARD_Y) * scale };
  }
  const inkBounds = inkBoundsOf(note.strokes);
  if (inkBounds) return fitView(inkBounds, width, height, Math.min(104, width * 0.12), 1.2, 0.12);
  return { scale: 1, x: width / 2, y: height / 2 };
}

function inkBoundsOf(strokes: readonly Stroke[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const stroke of strokes) {
    if (stroke.tool === 'eraser' || !stroke.points.length) continue;
    bounds = unionBounds(bounds, strokeBounds(stroke));
  }
  return bounds;
}

function pointInRotatedBounds(point: InkPoint, selection: Selection, slop: number): boolean {
  const center = boundsCenter(selection.bounds);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(-selection.rotation);
  const sin = Math.sin(-selection.rotation);
  const x = center.x + dx * cos - dy * sin;
  const y = center.y + dx * sin + dy * cos;
  return (
    x >= selection.bounds.minX - slop &&
    x <= selection.bounds.maxX + slop &&
    y >= selection.bounds.minY - slop &&
    y <= selection.bounds.maxY + slop
  );
}

function strokeFromInteraction(interaction: DrawInteraction, points: InkPoint[]): Stroke {
  const isStraight = interaction.mode === 'straight';
  const finalPoints = isStraight && points.length > 1 ? [points[0], points[points.length - 1]] : points;
  return {
    id: 'draft',
    tool: interaction.tool,
    variant: interaction.variant,
    color: interaction.color,
    size: interaction.size,
    opacity: interaction.opacity,
    points: finalPoints,
    seed: 1,
    mode: interaction.mode,
    createdAt: Date.now(),
  };
}

/**
 * The ink surface.
 *
 * Layering (background → ink → live stroke → selection chrome) means a live
 * stroke or a moved selection only repaints one small transparent canvas. The
 * background pattern and committed ink are cached until the viewport or
 * document changes.
 */
export const DrawingSurface = forwardRef<DrawingSurfaceHandle, DrawingSurfaceProps>(function DrawingSurface(
  {
    note,
    tool,
    theme,
    settings,
    markdownHtml,
    markdownMeta,
    gestureHint,
    hasInk,
    onStrokesChange,
    onSelectionChange,
    onHistoryChange,
    onViewScaleChange,
    onToast,
    onToolChange,
    onMathRequest,
    onImagePreview,
  },
  ref,
) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  const strokesRef = useRef<Stroke[]>([...note.strokes]);
  const viewRef = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const initializedRef = useRef(false);
  const selectionRef = useRef<Selection | null>(null);
  const hiddenRef = useRef<Set<string>>(new Set());
  const lassoRef = useRef<InkPoint[] | null>(null);
  const livePreviewRef = useRef<LivePreview | SelectionPreviewLive | null>(null);
  const selectionPreviewRef = useRef<SelectionPreview | null>(null);
  const panRef = useRef<PanInteraction | null>(null);
  const drawRef = useRef<DrawInteraction | null>(null);
  const eraseRef = useRef<EraseInteraction | null>(null);
  const lassoInteractionRef = useRef<LassoInteraction | null>(null);
  const selectionInteractionRef = useRef<SelectionInteraction | null>(null);
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const ignoredTouchesRef = useRef(new Set<number>());
  const gestureCandidateRef = useRef<GestureCandidate | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const gestureLockRef = useRef(false);
  const lastPenAtRef = useRef(0);
  const spaceRef = useRef(false);
  const pointerScreenRef = useRef({ x: 0, y: 0 });
  const historyRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const rafRef = useRef<number | null>(null);
  const lastReportedPercentRef = useRef(-1);
  const dirtyRef = useRef<DirtyFlags>({ background: true, ink: true, live: true, overlay: true });
  const backgroundRef = useRef(note.background);
  const themeRef = useRef(theme);
  const toolRef = useRef(tool);
  const settingsRef = useRef(settings);
  const callbacksRef = useRef({
    onStrokesChange,
    onSelectionChange,
    onHistoryChange,
    onViewScaleChange,
    onToast,
    onToolChange,
    onMathRequest,
    onImagePreview,
  });
  const [gesturing, setGesturing] = useState(false);
  const [shapeHint, setShapeHint] = useState<ShapeHint | null>(null);
  const [mathHoldAt, setMathHoldAt] = useState<{ x: number; y: number } | null>(null);
  const shapeCandidateRef = useRef<ShapeCandidate | null>(null);
  const shapeTimerRef = useRef<number | null>(null);
  const mathPressRef = useRef<MathPress | null>(null);

  backgroundRef.current = note.background;
  themeRef.current = theme;
  toolRef.current = tool;
  settingsRef.current = settings;
  callbacksRef.current = {
    onStrokesChange,
    onSelectionChange,
    onHistoryChange,
    onViewScaleChange,
    onToast,
    onToolChange,
    onMathRequest,
    onImagePreview,
  };

  const schedulePaintRef = useRef<() => void>(() => {});
  const paintRef = useRef<() => void>(() => {});

  const syncCard = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const view = viewRef.current;
    card.style.transform = `translate3d(${view.x + CARD_X * view.scale}px, ${view.y + CARD_Y * view.scale}px, 0) scale(${view.scale})`;
  }, []);

  const reportScale = useCallback(() => {
    const percent = Math.round(viewRef.current.scale * 100);
    if (percent === lastReportedPercentRef.current) return;
    lastReportedPercentRef.current = percent;
    callbacksRef.current.onViewScaleChange(viewRef.current.scale);
  }, []);

  const setView = useCallback(
    (next: ViewTransform, options: { card?: boolean } = {}) => {
      viewRef.current = next;
      if (options.card !== false) syncCard();
      reportScale();
      dirtyRef.current.background = true;
      dirtyRef.current.ink = true;
      dirtyRef.current.overlay = true;
      schedulePaintRef.current();
    },
    [reportScale, syncCard],
  );

  // Keep the scheduler stable while allowing paint to use the latest props.
  schedulePaintRef.current = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paintRef.current();
    });
  };

  paintRef.current = () => {
    const size = sizeRef.current;
    if (!size.width || !size.height) return;
    const dirty = dirtyRef.current;
    const options = {
      width: size.width,
      height: size.height,
      dpr: size.dpr,
      view: viewRef.current,
      background: backgroundRef.current,
      theme: themeRef.current,
      strokes: strokesRef.current,
      hiddenIds: hiddenRef.current,
    };

    if (dirty.background && backgroundCanvasRef.current) {
      renderBackgroundLayer(backgroundCanvasRef.current, options);
    }
    if (dirty.ink && inkCanvasRef.current) {
      renderInk(inkCanvasRef.current, options);
    }
    if (dirty.live && liveCanvasRef.current) {
      const live = livePreviewRef.current;
      const ctx = prepareCanvas(liveCanvasRef.current, size.width, size.height, size.dpr);
      if (live) {
        ctx.save();
        applyView(ctx, viewRef.current);
        if (live.kind === 'draft') {
          drawStroke(ctx, live.stroke);
        } else {
          const { preview, center } = live;
          ctx.translate(preview.dx, preview.dy);
          ctx.translate(center.x, center.y);
          ctx.rotate(preview.rotation);
          ctx.translate(-center.x, -center.y);
          for (const stroke of live.strokes) drawStroke(ctx, stroke);
        }
        ctx.restore();
      }
    }
    if (dirty.overlay && overlayCanvasRef.current) {
      renderOverlay(overlayCanvasRef.current, size.width, size.height, size.dpr, viewRef.current, {
        selection: selectionRef.current,
        preview: selectionPreviewRef.current,
        lasso: lassoRef.current,
      });
    }
    dirtyRef.current = { background: false, ink: false, live: false, overlay: false };
  };

  const markDirty = useCallback((flags: Partial<DirtyFlags>) => {
    if (flags.background) dirtyRef.current.background = true;
    if (flags.ink) dirtyRef.current.ink = true;
    if (flags.live) dirtyRef.current.live = true;
    if (flags.overlay) dirtyRef.current.overlay = true;
    schedulePaintRef.current();
  }, []);

  const notifyHistory = useCallback(() => {
    callbacksRef.current.onHistoryChange({
      undo: historyRef.current.past.length > 0,
      redo: historyRef.current.future.length > 0,
    });
  }, []);

  const setSelection = useCallback(
    (selection: Selection | null) => {
      selectionRef.current = selection;
      selectionPreviewRef.current = null;
      callbacksRef.current.onSelectionChange(selection);
      markDirty({ overlay: true });
    },
    [markDirty],
  );

  const pushHistory = useCallback(
    (before: Stroke[], after: Stroke[]) => {
      if (before === after) return;
      historyRef.current.past.push({ before, after });
      if (historyRef.current.past.length > MAX_HISTORY) historyRef.current.past.shift();
      historyRef.current.future = [];
      notifyHistory();
    },
    [notifyHistory],
  );

  const commitStrokes = useCallback(
    (next: Stroke[], before = strokesRef.current) => {
      strokesRef.current = next;
      pushHistory(before, next);
      callbacksRef.current.onStrokesChange(next);
      markDirty({ ink: true, overlay: true });
    },
    [markDirty, pushHistory],
  );

  const restoreStrokes = useCallback(
    (next: Stroke[]) => {
      strokesRef.current = next;
      hiddenRef.current = new Set();
      selectionRef.current = null;
      selectionPreviewRef.current = null;
      livePreviewRef.current = null;
      lassoRef.current = null;
      callbacksRef.current.onStrokesChange(next);
      callbacksRef.current.onSelectionChange(null);
      markDirty({ ink: true, live: true, overlay: true });
    },
    [markDirty],
  );

  const undo = useCallback(() => {
    const entry = historyRef.current.past.pop();
    if (!entry) return;
    historyRef.current.future.push(entry);
    restoreStrokes(entry.before);
    notifyHistory();
  }, [notifyHistory, restoreStrokes]);

  const redo = useCallback(() => {
    const entry = historyRef.current.future.pop();
    if (!entry) return;
    historyRef.current.past.push(entry);
    restoreStrokes(entry.after);
    notifyHistory();
  }, [notifyHistory, restoreStrokes]);

  const commitSelectionTransformSafe = useCallback(
    (preview: SelectionPreview) => {
      const selection = selectionRef.current;
      if (!selection) return;
      const before = strokesRef.current;
      const center = boundsCenter(selection.bounds);
      const ids = new Set(selection.ids);
      const transformPoint = (point: InkPoint): InkPoint => {
        const rotated = rotatePoint(point.x, point.y, center.x, center.y, preview.rotation);
        return { ...point, x: rotated.x + preview.dx, y: rotated.y + preview.dy };
      };
      const next = before.map((stroke) =>
        ids.has(stroke.id) ? { ...stroke, points: stroke.points.map(transformPoint) } : stroke,
      );
      hiddenRef.current = new Set();
      selectionInteractionRef.current = null;
      selectionPreviewRef.current = null;
      livePreviewRef.current = null;
      strokesRef.current = next;
      pushHistory(before, next);
      callbacksRef.current.onStrokesChange(next);
      const nextSelection = makeSelection(next, selection.ids);
      selectionRef.current = nextSelection;
      callbacksRef.current.onSelectionChange(nextSelection);
      markDirty({ ink: true, live: true, overlay: true });
    },
    [markDirty, pushHistory],
  );

  const rotateSelection = useCallback(
    (degrees: number) => {
      const selection = selectionRef.current;
      if (!selection) return;
      commitSelectionTransformSafe({ dx: 0, dy: 0, rotation: (degrees * Math.PI) / 180 });
    },
    [commitSelectionTransformSafe],
  );

  const deleteSelection = useCallback(() => {
    const selection = selectionRef.current;
    if (!selection) return;
    const before = strokesRef.current;
    const ids = new Set(selection.ids);
    const next = before.filter((stroke) => !ids.has(stroke.id));
    selectionRef.current = null;
    callbacksRef.current.onSelectionChange(null);
    commitStrokes(next, before);
    markDirty({ ink: true, overlay: true });
  }, [commitStrokes, markDirty]);

  const copySelection = useCallback(() => {
    const selection = selectionRef.current;
    if (!selection) return;
    const ids = new Set(selection.ids);
    selectionClipboard = strokesRef.current.filter((stroke) => ids.has(stroke.id));
    callbacksRef.current.onToast('toast.selectionCopied');
  }, []);

  const paste = useCallback(() => {
    if (!selectionClipboard.length) return;
    const before = strokesRef.current;
    const pasted = cloneStrokes(selectionClipboard, new Set(selectionClipboard.map((stroke) => stroke.id)), 28, 28);
    if (!pasted.length) return;
    const next = [...before, ...pasted];
    commitStrokes(next, before);
    const selection = makeSelection(next, pasted.map((stroke) => stroke.id));
    selectionRef.current = selection;
    callbacksRef.current.onSelectionChange(selection);
    markDirty({ overlay: true });
    callbacksRef.current.onToast('toast.selectionPasted');
  }, [commitStrokes, markDirty]);

  const duplicateSelection = useCallback(() => {
    copySelection();
    paste();
  }, [copySelection, paste]);

  const clearCanvas = useCallback(() => {
    if (!strokesRef.current.length) return;
    const before = strokesRef.current;
    setSelection(null);
    hiddenRef.current = new Set();
    commitStrokes([], before);
    livePreviewRef.current = null;
    markDirty({ ink: true, live: true, overlay: true });
  }, [commitStrokes, markDirty, setSelection]);

  const resetView = useCallback(() => {
    const size = sizeRef.current;
    if (!size.width) return;
    setView(initialView(note, size.width, size.height));
  }, [note, setView]);

  const fitToContent = useCallback(() => {
    const size = sizeRef.current;
    const bounds = inkBoundsOf(strokesRef.current);
    if (!size.width) return;
    if (bounds) setView(fitView(bounds, size.width, size.height, 96, 2.2, 0.08));
    else resetView();
  }, [resetView, setView]);

  const zoomAt = useCallback(
    (factor: number, screenX: number, screenY: number) => {
      const current = viewRef.current;
      const nextScale = clamp(current.scale * factor, 0.1, 6);
      if (Math.abs(nextScale - current.scale) < 0.0001) return;
      const anchorX = (screenX - current.x) / current.scale;
      const anchorY = (screenY - current.y) / current.scale;
      setView({
        scale: nextScale,
        x: screenX - anchorX * nextScale,
        y: screenY - anchorY * nextScale,
      });
    },
    [setView],
  );

  const zoomIn = useCallback(() => {
    const size = sizeRef.current;
    zoomAt(1.25, size.width / 2, size.height / 2);
  }, [zoomAt]);

  const zoomOut = useCallback(() => {
    const size = sizeRef.current;
    zoomAt(0.8, size.width / 2, size.height / 2);
  }, [zoomAt]);

  useImperativeHandle(
    ref,
    () => ({
      undo,
      redo,
      copySelection,
      paste,
      deleteSelection,
      deselect: () => setSelection(null),
      duplicateSelection,
      rotateSelection,
      clearCanvas,
      fitToContent,
      resetView,
      zoomIn,
      zoomOut,
    }),
    [
      undo,
      redo,
      copySelection,
      paste,
      deleteSelection,
      duplicateSelection,
      rotateSelection,
      clearCanvas,
      fitToContent,
      resetView,
      setSelection,
      zoomIn,
      zoomOut,
    ],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = (): void => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      if (!width || !height) return;
      const previous = sizeRef.current;
      const dpr = renderDpr(width, height);
      if (initializedRef.current && previous.width) {
        viewRef.current = {
          ...viewRef.current,
          x: viewRef.current.x + (width - previous.width) / 2,
          y: viewRef.current.y + (height - previous.height) / 2,
        };
      } else {
        viewRef.current = initialView(note, width, height);
        initializedRef.current = true;
      }
      sizeRef.current = { width, height, dpr };
      if (viewRef.current.x === 0 && viewRef.current.y === 0) viewRef.current = initialView(note, width, height);
      syncCard();
      reportScale();
      markDirty({ background: true, ink: true, live: true, overlay: true });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
    // The note is keyed by the parent; refs are intentionally initialised once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    notifyHistory();
    callbacksRef.current.onSelectionChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    backgroundRef.current = note.background;
    markDirty({ background: true });
  }, [markDirty, note.background]);

  useEffect(() => {
    themeRef.current = theme;
    markDirty({ background: true });
  }, [markDirty, theme]);

  // The reading card mounts after the lazily-loaded Markdown chunk resolves,
  // which can be later than the initial measure. Re-apply the view transform
  // when it appears so the card and ink stay in the same coordinate space.
  useEffect(() => {
    if (!markdownHtml) return;
    syncCard();
  }, [markdownHtml, syncCard]);

  // Wheel is bound natively to allow preventDefault on trackpad pinch.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(-event.deltaY * 0.012), x, y);
        return;
      }
      const scale = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? sizeRef.current.height : 1;
      setView({
        ...viewRef.current,
        x: viewRef.current.x - event.deltaX * scale,
        y: viewRef.current.y - event.deltaY * scale,
      });
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [setView, zoomAt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .modal-backdrop, .source-panel')) return;
      if (document.querySelector('.modal-backdrop')) return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.code === 'Space' && !event.repeat) {
        spaceRef.current = true;
        rootRef.current?.classList.add('is-pan-ready');
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        if (selectionRef.current) setSelection(null);
        else {
          livePreviewRef.current = null;
          drawRef.current = null;
          markDirty({ live: true });
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        if (selectionRef.current) {
          event.preventDefault();
          copySelection();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        paste();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        if (selectionRef.current) {
          event.preventDefault();
          duplicateSelection();
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectionRef.current) {
          event.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (event.key === '0') {
        resetView();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        zoomIn();
        return;
      }
      if (event.key === '-') {
        zoomOut();
        return;
      }
      if (!mod && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'p') onToolChange('pen');
        else if (key === 'h') onToolChange('highlighter');
        else if (key === 'e') onToolChange('eraser');
        else if (key === 'l') onToolChange('lasso');
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        spaceRef.current = false;
        rootRef.current?.classList.remove('is-pan-ready');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    copySelection,
    deleteSelection,
    duplicateSelection,
    markDirty,
    onToolChange,
    paste,
    redo,
    resetView,
    setSelection,
    undo,
    zoomIn,
    zoomOut,
  ]);

  const pressureFor = useCallback((event: PointerEvent | ReactPointerEvent): number => {
    const raw = event.pointerType === 'pen' ? (event.pressure > 0 ? event.pressure : 0.5) : 0.5;
    return clamp(0.5 + (raw - 0.5) * settingsRef.current.pressureSensitivity, 0, 1);
  }, []);

  const localPoint = useCallback((event: PointerEvent | ReactPointerEvent): { x: number; y: number } => {
    const root = rootRef.current;
    if (!root) return { x: 0, y: 0 };
    const rect = root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const worldPoint = useCallback((screenX: number, screenY: number): InkPoint => {
    const view = viewRef.current;
    return {
      x: (screenX - view.x) / view.scale,
      y: (screenY - view.y) / view.scale,
      p: 0.5,
    };
  }, []);

  const updateCursor = useCallback((screenX: number, screenY: number, pointerType: string, visible: boolean) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const currentTool = toolRef.current;
    if (!visible || pointerType !== 'mouse' || currentTool === 'lasso') {
      cursor.dataset.visible = 'false';
      return;
    }
    const settingsNow = settingsRef.current;
    const rawSize = currentTool === 'eraser' ? settingsNow.eraserSize : currentTool === 'highlighter' ? settingsNow.highlighterSize : settingsNow.penSize;
    const diameter = clamp(rawSize * viewRef.current.scale, 5, 64);
    cursor.dataset.visible = 'true';
    cursor.dataset.tool = currentTool;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate3d(${screenX - diameter / 2}px, ${screenY - diameter / 2}px, 0)`;
  }, []);

  const clearShapeTimer = useCallback(() => {
    if (shapeTimerRef.current !== null) {
      window.clearTimeout(shapeTimerRef.current);
      shapeTimerRef.current = null;
    }
  }, []);

  const cancelShapeRecognition = useCallback((redrawLive = false) => {
    clearShapeTimer();
    const hadCandidate = shapeCandidateRef.current !== null;
    shapeCandidateRef.current = null;
    setShapeHint(null);
    if (hadCandidate && redrawLive) markDirty({ live: true });
  }, [clearShapeTimer, markDirty]);

  const cancelMathPress = useCallback(() => {
    const press = mathPressRef.current;
    if (press) window.clearTimeout(press.timer);
    mathPressRef.current = null;
    setMathHoldAt(null);
  }, []);

  const abortTransientInteraction = useCallback(() => {
    drawRef.current = null;
    eraseRef.current = null;
    lassoInteractionRef.current = null;
    lassoRef.current = null;
    selectionInteractionRef.current = null;
    selectionPreviewRef.current = null;
    livePreviewRef.current = null;
    hiddenRef.current = new Set();
    panRef.current = null;
    rootRef.current?.classList.remove('is-panning');
    shapeCandidateRef.current = null;
    clearShapeTimer();
    setShapeHint(null);
    rootRef.current?.removeAttribute('data-drawing');
    markDirty({ ink: true, live: true, overlay: true });
  }, [clearShapeTimer, markDirty]);

  const findMathCluster = useCallback((world: InkPoint): Stroke[] | null => {
    const slop = 14 / viewRef.current.scale;
    const hit = strokesRef.current.find((stroke) => hitTestStroke(stroke, world.x, world.y, { slop }));
    if (!hit) return null;
    const cluster: Stroke[] = [hit];
    let area = strokeBounds(hit);
    const gap = Math.max(30, hit.size * 5);
    let changed = true;
    while (changed && cluster.length < 180) {
      changed = false;
      const searchArea = expandBounds(area, gap);
      for (const stroke of strokesRef.current) {
        if (stroke.tool === 'eraser' || cluster.includes(stroke)) continue;
        if (!boundsIntersect(searchArea, strokeBounds(stroke))) continue;
        cluster.push(stroke);
        area = unionBounds(area, strokeBounds(stroke)) ?? area;
        changed = true;
        if (cluster.length >= 180) break;
      }
    }
    return cluster;
  }, []);

  const scheduleMathPress = useCallback(
    (pointerId: number, screenX: number, screenY: number, world: InkPoint) => {
      cancelMathPress();
      if (!settingsRef.current.mathRecognition) return;
      const cluster = findMathCluster(world);
      if (!cluster) return;
      const press: MathPress = {
        pointerId,
        startX: screenX,
        startY: screenY,
        timer: 0,
        strokes: cluster,
      };
      setMathHoldAt({ x: screenX, y: screenY });
      press.timer = window.setTimeout(() => {
        if (mathPressRef.current !== press) return;
        mathPressRef.current = null;
        setMathHoldAt(null);
        abortTransientInteraction();
        callbacksRef.current.onMathRequest(cluster);
      }, 560);
      mathPressRef.current = press;
    },
    [abortTransientInteraction, cancelMathPress, findMathCluster],
  );

  const scheduleShapeRecognition = useCallback(
    (interaction: DrawInteraction) => {
      clearShapeTimer();
      if (!settingsRef.current.shapeRecognition || interaction.tool !== 'pen' || interaction.points.length < 5) return;
      shapeTimerRef.current = window.setTimeout(() => {
        shapeTimerRef.current = null;
        if (drawRef.current !== interaction || shapeCandidateRef.current) return;
        const fit = recognizeShape(interaction.points);
        if (!fit || fit.confidence < 0.58) return;
        shapeCandidateRef.current = { fit, interaction };
        const preview = previewShapeStroke(strokeFromInteraction(interaction, interaction.points), fit);
        livePreviewRef.current = { kind: 'draft', stroke: preview };
        const bounds = pointsBounds(fit.points);
        const view = viewRef.current;
        setShapeHint({
          kind: fit.kind,
          x: (bounds.minX + bounds.maxX) / 2 * view.scale + view.x,
          y: bounds.minY * view.scale + view.y - 18,
        });
        markDirty({ live: true });
      }, 620);
    },
    [clearShapeTimer, markDirty],
  );

  const beginDraw = useCallback(
    (pointerId: number, screenX: number, screenY: number, pressure: number) => {
      const settingsNow = settingsRef.current;
      const currentTool = toolRef.current;
      if (currentTool !== 'pen' && currentTool !== 'highlighter') return;
      cancelShapeRecognition();
      const isHighlighter = currentTool === 'highlighter';
      const point = worldPoint(screenX, screenY);
      point.p = pressure;
      const variant: PenVariant | 'highlighter' = isHighlighter ? 'highlighter' : settingsNow.penVariant;
      const interaction: DrawInteraction = {
        pointerId,
        points: [point],
        tool: isHighlighter ? 'highlighter' : 'pen',
        variant,
        color: isHighlighter ? settingsNow.highlighterColor : settingsNow.penColor,
        size: isHighlighter ? settingsNow.highlighterSize : settingsNow.penSize,
        opacity: isHighlighter ? 0.32 : PASTEL_TOOLS[settingsNow.penVariant].opacity,
        mode: isHighlighter ? settingsNow.highlighterMode : 'free',
        firstPoint: point,
      };
      drawRef.current = interaction;
      livePreviewRef.current = { kind: 'draft', stroke: strokeFromInteraction(interaction, interaction.points) };
      markDirty({ live: true });
    },
    [cancelShapeRecognition, markDirty, worldPoint],
  );

  const appendDrawPoint = useCallback(
    (interaction: DrawInteraction, screenX: number, screenY: number, pressure: number) => {
      if (interaction.points.length > 6000) return;
      if (shapeCandidateRef.current) cancelShapeRecognition();
      const point = worldPoint(screenX, screenY);
      point.p = pressure;
      const last = interaction.points[interaction.points.length - 1];
      if (interaction.mode === 'straight') {
        interaction.points = [interaction.firstPoint, point];
      } else {
        const minDistance = 0.35 / viewRef.current.scale;
        if (distance(last.x, last.y, point.x, point.y) < minDistance) return;
        interaction.points.push(point);
      }
      livePreviewRef.current = { kind: 'draft', stroke: strokeFromInteraction(interaction, interaction.points) };
      markDirty({ live: true });
      scheduleShapeRecognition(interaction);
    },
    [cancelShapeRecognition, markDirty, scheduleShapeRecognition, worldPoint],
  );

  const finishDraw = useCallback(() => {
    const interaction = drawRef.current;
    const candidate = shapeCandidateRef.current;
    drawRef.current = null;
    livePreviewRef.current = null;
    shapeCandidateRef.current = null;
    clearShapeTimer();
    setShapeHint(null);
    if (!interaction || !interaction.points.length) {
      markDirty({ live: true });
      return;
    }
    const finished =
      candidate && candidate.interaction === interaction
        ? snapStrokeToShape(strokeFromInteraction(interaction, interaction.points), candidate.fit)
        : finishStroke(interaction.points, {
            tool: interaction.tool,
            variant: interaction.variant,
            color: interaction.color,
            size: interaction.size,
            opacity: interaction.opacity,
            mode: interaction.mode,
          });
    if (!finished) {
      markDirty({ live: true });
      return;
    }
    const before = strokesRef.current;
    const next = [...before, finished];
    strokesRef.current = next;
    pushHistory(before, next);
    callbacksRef.current.onStrokesChange(next);
    markDirty({ ink: true, live: true });
  }, [clearShapeTimer, markDirty, pushHistory]);

  const drawEraseSegment = useCallback(
    (from: InkPoint, to: InkPoint, size: number) => {
      const canvas = inkCanvasRef.current;
      const dimensions = sizeRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dimensions.dpr, 0, 0, dimensions.dpr, 0, 0);
      ctx.translate(viewRef.current.x, viewRef.current.y);
      ctx.scale(viewRef.current.scale, viewRef.current.scale);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    },
    [],
  );

  const beginErase = useCallback(
    (pointerId: number, screenX: number, screenY: number, modal: 'stroke' | 'pixel') => {
      const settingsNow = settingsRef.current;
      const point = worldPoint(screenX, screenY);
      point.p = 0.5;
      const erase: EraseInteraction = {
        pointerId,
        points: [point],
        modal,
        removed: new Set(),
        size: settingsNow.eraserSize,
      };
      eraseRef.current = erase;
      if (modal === 'pixel') {
        const canvas = inkCanvasRef.current;
        const dimensions = sizeRef.current;
        const ctx = canvas?.getContext('2d', { alpha: true });
        if (ctx && canvas) {
          ctx.save();
          ctx.setTransform(dimensions.dpr, 0, 0, dimensions.dpr, 0, 0);
          ctx.translate(viewRef.current.x, viewRef.current.y);
          ctx.scale(viewRef.current.scale, viewRef.current.scale);
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(point.x, point.y, erase.size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        return;
      }
      // A tap with the object eraser should remove the line under the tap,
      // even before a pointermove is delivered.
      let removed = false;
      for (const stroke of strokesRef.current) {
        if (stroke.tool === 'eraser' || hiddenRef.current.has(stroke.id)) continue;
        if (strokeIntersectsEraser(stroke, [point], erase.size / 2)) {
          erase.removed.add(stroke.id);
          hiddenRef.current.add(stroke.id);
          removed = true;
        }
      }
      if (removed) markDirty({ ink: true });
    },
    [markDirty, worldPoint],
  );

  const appendErasePoint = useCallback(
    (interaction: EraseInteraction, screenX: number, screenY: number) => {
      const point = worldPoint(screenX, screenY);
      point.p = 0.5;
      if (interaction.modal === 'pixel') {
        const previous = interaction.points[interaction.points.length - 1];
        interaction.points.push(point);
        drawEraseSegment(previous, point, interaction.size);
        return;
      }
      const previous = interaction.points[interaction.points.length - 1];
      interaction.points.push(point);
      if (interaction.points.length > 400) interaction.points.shift();
      if (distance(previous.x, previous.y, point.x, point.y) < 1.2 / viewRef.current.scale) return;
      const removedNow = new Set<string>();
      for (const stroke of strokesRef.current) {
        if (stroke.tool === 'eraser' || hiddenRef.current.has(stroke.id)) continue;
        if (strokeIntersectsEraser(stroke, [point, previous], interaction.size / 2)) {
          interaction.removed.add(stroke.id);
          hiddenRef.current.add(stroke.id);
          removedNow.add(stroke.id);
        }
      }
      if (removedNow.size) markDirty({ ink: true });
    },
    [drawEraseSegment, markDirty, worldPoint],
  );

  const finishErase = useCallback(() => {
    const interaction = eraseRef.current;
    eraseRef.current = null;
    if (!interaction) return;
    if (interaction.modal === 'pixel') {
      const finished = finishStroke(interaction.points, {
        tool: 'eraser',
        variant: 'pixel',
        color: '#000000',
        size: interaction.size,
        opacity: 1,
      });
      if (finished) {
        const before = strokesRef.current;
        const next = [...before, finished];
        strokesRef.current = next;
        pushHistory(before, next);
        callbacksRef.current.onStrokesChange(next);
      }
      markDirty({ ink: true });
      return;
    }
    const removed = interaction.removed;
    hiddenRef.current = new Set();
    if (removed.size) {
      const before = strokesRef.current;
      const next = before.filter((stroke) => !removed.has(stroke.id));
      const selection = selectionRef.current;
      if (selection && selection.ids.some((id) => removed.has(id))) setSelection(null);
      strokesRef.current = next;
      pushHistory(before, next);
      callbacksRef.current.onStrokesChange(next);
    }
    markDirty({ ink: true, overlay: true });
  }, [markDirty, pushHistory, setSelection]);

  const beginLasso = useCallback(
    (pointerId: number, screenX: number, screenY: number) => {
      const point = worldPoint(screenX, screenY);
      point.p = 0.5;
      lassoInteractionRef.current = { pointerId, points: [point] };
      lassoRef.current = [point];
      setSelection(null);
      markDirty({ overlay: true });
    },
    [markDirty, setSelection, worldPoint],
  );

  const appendLassoPoint = useCallback(
    (pointerId: number, screenX: number, screenY: number) => {
      const interaction = lassoInteractionRef.current;
      if (!interaction || interaction.pointerId !== pointerId) return;
      const point = worldPoint(screenX, screenY);
      point.p = 0.5;
      const last = interaction.points[interaction.points.length - 1];
      if (distance(last.x, last.y, point.x, point.y) < 0.8 / viewRef.current.scale) return;
      interaction.points.push(point);
      lassoRef.current = interaction.points;
      markDirty({ overlay: true });
    },
    [markDirty, worldPoint],
  );

  const finishLasso = useCallback(() => {
    const interaction = lassoInteractionRef.current;
    lassoInteractionRef.current = null;
    lassoRef.current = null;
    if (!interaction) return;
    const points = interaction.points.length > 2 ? simplifyPoints(interaction.points, 1.2) : interaction.points;
    if (points.length < 3) {
      markDirty({ overlay: true });
      return;
    }
    const ids = strokesInLasso(strokesRef.current, points);
    const selection = makeSelection(strokesRef.current, ids);
    selectionRef.current = selection;
    callbacksRef.current.onSelectionChange(selection);
    markDirty({ overlay: true });
  }, [markDirty]);

  const beginSelectionInteraction = useCallback(
    (pointerId: number, world: InkPoint, mode: 'move' | 'rotate', selection: Selection) => {
      const center = boundsCenter(selection.bounds);
      const startAngle = Math.atan2(world.y - center.y, world.x - center.x);
      selectionInteractionRef.current = {
        pointerId,
        mode,
        startWorld: world,
        center,
        startAngle,
        startSelection: selection,
        preview: { dx: 0, dy: 0, rotation: selection.rotation },
      };
      hiddenRef.current = new Set(selection.ids);
      const selected = strokesRef.current.filter((stroke) => selection.ids.includes(stroke.id));
      livePreviewRef.current = null;
      selectionPreviewRef.current = { dx: 0, dy: 0, rotation: selection.rotation };
      livePreviewRef.current = {
        kind: 'selection',
        strokes: selected,
        preview: { dx: 0, dy: 0, rotation: selection.rotation },
        center,
      };
      markDirty({ ink: true, live: true, overlay: true });
    },
    [markDirty],
  );

  const updateSelectionInteraction = useCallback(
    (pointerId: number, world: InkPoint) => {
      const interaction = selectionInteractionRef.current;
      if (!interaction || interaction.pointerId !== pointerId) return;
      if (interaction.mode === 'move') {
        const preview = {
          dx: world.x - interaction.startWorld.x,
          dy: world.y - interaction.startWorld.y,
          rotation: interaction.startSelection.rotation,
        };
        interaction.preview = preview;
        selectionPreviewRef.current = preview;
        const selected = strokesRef.current.filter((stroke) => interaction.startSelection.ids.includes(stroke.id));
        livePreviewRef.current = {
          kind: 'selection',
          strokes: selected,
          preview,
          center: interaction.center,
        };
      } else {
        let delta = Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x) - interaction.startAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const preview = { dx: 0, dy: 0, rotation: delta };
        interaction.preview = preview;
        selectionPreviewRef.current = preview;
        const selected = strokesRef.current.filter((stroke) => interaction.startSelection.ids.includes(stroke.id));
        livePreviewRef.current = {
          kind: 'selection',
          strokes: selected,
          preview,
          center: interaction.center,
        };
      }
      markDirty({ live: true, overlay: true });
    },
    [markDirty],
  );

  const finishSelectionInteraction = useCallback(() => {
    const interaction = selectionInteractionRef.current;
    if (!interaction) return;
    const { preview } = interaction;
    if (Math.abs(preview.dx) < 0.01 && Math.abs(preview.dy) < 0.01 && Math.abs(preview.rotation) < 0.0005) {
      hiddenRef.current = new Set();
      selectionInteractionRef.current = null;
      selectionPreviewRef.current = null;
      livePreviewRef.current = null;
      markDirty({ ink: true, live: true, overlay: true });
      return;
    }
    commitSelectionTransformSafe(preview);
  }, [commitSelectionTransformSafe, markDirty]);

  const beginPan = useCallback(
    (pointerId: number, screenX: number, screenY: number) => {
      panRef.current = { pointerId, startX: screenX, startY: screenY, startView: { ...viewRef.current } };
      rootRef.current?.classList.add('is-panning');
    },
    [],
  );

  const endPan = useCallback(() => {
    panRef.current = null;
    rootRef.current?.classList.remove('is-panning');
  }, []);

  const cancelInteractions = useCallback(() => {
    cancelMathPress();
    abortTransientInteraction();
  }, [abortTransientInteraction, cancelMathPress]);

  const cancelGestureCandidate = useCallback(() => {
    const candidate = gestureCandidateRef.current;
    if (candidate) window.clearTimeout(candidate.timer);
    gestureCandidateRef.current = null;
  }, []);

  const beginGestureCandidate = useCallback(() => {
    cancelGestureCandidate();
    cancelMathPress();
    cancelInteractions();
    const points = [...touchPointersRef.current.values()];
    if (points.length < 2) return;
    const a = points[0];
    const b = points[1];
    const candidate: GestureCandidate = {
      timer: window.setTimeout(() => {
        const live = [...touchPointersRef.current.values()];
        if (live.length < 2) {
          gestureCandidateRef.current = null;
          return;
        }
        gestureRef.current = {
          startMid: { x: (live[0].x + live[1].x) / 2, y: (live[0].y + live[1].y) / 2 },
          startDistance: Math.max(12, distance(live[0].x, live[0].y, live[1].x, live[1].y)),
          startView: { ...viewRef.current },
        };
        gestureCandidateRef.current = null;
        setGesturing(true);
        navigator.vibrate?.(8);
      }, LONG_PRESS_MS),
      startedAt: performance.now(),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startDistance: Math.max(12, distance(a.x, a.y, b.x, b.y)),
    };
    gestureCandidateRef.current = candidate;
    gestureLockRef.current = true;
  }, [cancelGestureCandidate, cancelInteractions]);

  const updateGesture = useCallback(
    (points: Array<{ x: number; y: number }>) => {
      const gesture = gestureRef.current;
      if (!gesture || points.length < 2) return;
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const currentDistance = Math.max(12, distance(points[0].x, points[0].y, points[1].x, points[1].y));
      const scale = clamp(gesture.startView.scale * (currentDistance / gesture.startDistance), 0.1, 6);
      const anchorX = (gesture.startMid.x - gesture.startView.x) / gesture.startView.scale;
      const anchorY = (gesture.startMid.y - gesture.startView.y) / gesture.startView.scale;
      setView({
        scale,
        x: mid.x - anchorX * scale,
        y: mid.y - anchorY * scale,
      });
    },
    [setView],
  );

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    gestureCandidateRef.current = null;
    setGesturing(false);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root) return;
      const screen = localPoint(event);
      pointerScreenRef.current = screen;
      const pointerType = event.pointerType || 'mouse';

      if (pointerType === 'pen') {
        lastPenAtRef.current = performance.now();
        if (drawRef.current && drawRef.current.pointerId !== event.pointerId) {
          cancelInteractions();
        }
      }

      if (pointerType === 'touch') {
        if (settingsRef.current.palmRejection && performance.now() - lastPenAtRef.current < 1400) {
          ignoredTouchesRef.current.add(event.pointerId);
          return;
        }
        touchPointersRef.current.set(event.pointerId, screen);
        if (touchPointersRef.current.size === 2) {
          beginGestureCandidate();
          try {
            root.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture can be unavailable for synthetic events.
          }
          return;
        }
        if (gestureLockRef.current || gestureCandidateRef.current || gestureRef.current) return;
      }

      if (pointerType === 'mouse' && event.button === 2) {
        // Let the native context menu feel intentional and don't start ink.
        return;
      }

      const shouldPan = event.button === 1 || (spaceRef.current && event.button === 0);
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures; pointer events still arrive in most browsers.
      }

      if (shouldPan) {
        event.preventDefault();
        beginPan(event.pointerId, screen.x, screen.y);
        return;
      }

      const penBarrelEraser = pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0);
      if (event.button !== 0 && !penBarrelEraser) return;
      updateCursor(screen.x, screen.y, pointerType, true);
      const world = worldPoint(screen.x, screen.y);
      world.p = pressureFor(event);

      root.dataset.drawing = 'true';
      const currentTool = toolRef.current;
      const selection = selectionRef.current;
      if (penBarrelEraser) {
        event.preventDefault();
        if (selection) setSelection(null);
        beginErase(event.pointerId, screen.x, screen.y, 'stroke');
        return;
      }
      if (currentTool !== 'eraser') scheduleMathPress(event.pointerId, screen.x, screen.y, world);
      if (selection) {
        if (currentTool === 'lasso') {
          const geometry = selectionScreenGeometry(selection, viewRef.current);
          if (distance(screen.x, screen.y, geometry.rotateHandle.x, geometry.rotateHandle.y) <= 18) {
            event.preventDefault();
            cancelMathPress();
            beginSelectionInteraction(event.pointerId, world, 'rotate', selection);
            return;
          }
          if (pointInRotatedBounds(world, selection, 8 / viewRef.current.scale)) {
            event.preventDefault();
            beginSelectionInteraction(event.pointerId, world, 'move', selection);
            return;
          }
          setSelection(null);
        } else {
          setSelection(null);
        }
      }

      event.preventDefault();

      if (currentTool === 'eraser') {
        beginErase(event.pointerId, screen.x, screen.y, settingsRef.current.eraserMode);
        return;
      }
      if (currentTool === 'lasso') {
        beginLasso(event.pointerId, screen.x, screen.y);
        return;
      }
      beginDraw(event.pointerId, screen.x, screen.y, pressureFor(event));
    },
    [
      beginDraw,
      beginErase,
      beginGestureCandidate,
      beginLasso,
      beginPan,
      beginSelectionInteraction,
      cancelInteractions,
      cancelMathPress,
      localPoint,
      pressureFor,
      scheduleMathPress,
      setSelection,
      updateCursor,
      worldPoint,
    ],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const screen = localPoint(event);
      pointerScreenRef.current = screen;
      updateCursor(screen.x, screen.y, event.pointerType || 'mouse', true);
      const pointerType = event.pointerType || 'mouse';
      const mathPress = mathPressRef.current;
      if (
        mathPress &&
        mathPress.pointerId === event.pointerId &&
        distance(screen.x, screen.y, mathPress.startX, mathPress.startY) > 7
      ) {
        cancelMathPress();
      }

      if (pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
        touchPointersRef.current.set(event.pointerId, screen);
        const candidate = gestureCandidateRef.current;
        if (candidate && !gestureRef.current) {
          const points = [...touchPointersRef.current.values()];
          const mid = points.length >= 2
            ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
            : screen;
          const drift = distance(mid.x, mid.y, candidate.startMid.x, candidate.startMid.y);
          if (drift > 24 || performance.now() - candidate.startedAt > 850) {
            cancelGestureCandidate();
            gestureLockRef.current = true;
          }
        }
        if (gestureRef.current) {
          const points = [...touchPointersRef.current.values()];
          updateGesture(points);
          return;
        }
        if (gestureCandidateRef.current) return;
      }

      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) {
        setView({
          scale: pan.startView.scale,
          x: pan.startView.x + (screen.x - pan.startX),
          y: pan.startView.y + (screen.y - pan.startY),
        });
        return;
      }

      const draw = drawRef.current;
      if (draw && draw.pointerId === event.pointerId) {
        event.preventDefault();
        const events = typeof event.nativeEvent.getCoalescedEvents === 'function'
          ? event.nativeEvent.getCoalescedEvents()
          : [event.nativeEvent];
        for (const sampled of events.length ? events : [event.nativeEvent]) {
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect) continue;
          appendDrawPoint(draw, sampled.clientX - rect.left, sampled.clientY - rect.top, pressureFor(sampled));
        }
        return;
      }

      const erase = eraseRef.current;
      if (erase && erase.pointerId === event.pointerId) {
        event.preventDefault();
        appendErasePoint(erase, screen.x, screen.y);
        return;
      }

      const lasso = lassoInteractionRef.current;
      if (lasso && lasso.pointerId === event.pointerId) {
        event.preventDefault();
        appendLassoPoint(event.pointerId, screen.x, screen.y);
        return;
      }

      const selectionInteraction = selectionInteractionRef.current;
      if (selectionInteraction && selectionInteraction.pointerId === event.pointerId) {
        event.preventDefault();
        updateSelectionInteraction(event.pointerId, worldPoint(screen.x, screen.y));
      }
    },
    [
      appendDrawPoint,
      appendErasePoint,
      appendLassoPoint,
      cancelGestureCandidate,
      cancelMathPress,
      localPoint,
      pressureFor,
      setView,
      updateCursor,
      updateGesture,
      updateSelectionInteraction,
      worldPoint,
    ],
  );

  const releasePointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      cancelMathPress();
      const pointerType = event.pointerType || 'mouse';
      if (pointerType === 'touch') {
        if (ignoredTouchesRef.current.delete(event.pointerId)) return;
        touchPointersRef.current.delete(event.pointerId);
        if (gestureRef.current) {
          if (touchPointersRef.current.size < 2) {
            endGesture();
            gestureLockRef.current = true;
          }
        } else if (gestureCandidateRef.current) {
          cancelGestureCandidate();
          gestureLockRef.current = true;
        }
        if (!touchPointersRef.current.size) gestureLockRef.current = false;
      }

      if (cancelled) {
        cancelInteractions();
        try {
          rootRef.current?.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore.
        }
        return;
      }

      rootRef.current?.removeAttribute('data-drawing');
      if (drawRef.current?.pointerId === event.pointerId) finishDraw();
      else if (eraseRef.current?.pointerId === event.pointerId) finishErase();
      else if (lassoInteractionRef.current?.pointerId === event.pointerId) finishLasso();
      else if (selectionInteractionRef.current?.pointerId === event.pointerId) finishSelectionInteraction();
      else if (panRef.current?.pointerId === event.pointerId) endPan();

      try {
        rootRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore.
      }
      updateCursor(pointerScreenRef.current.x, pointerScreenRef.current.y, pointerType, false);
    },
    [
      cancelGestureCandidate,
      cancelInteractions,
      cancelMathPress,
      endGesture,
      endPan,
      finishDraw,
      finishErase,
      finishLasso,
      finishSelectionInteraction,
      updateCursor,
    ],
  );

  const onPointerLeave = useCallback(() => {
    updateCursor(0, 0, 'mouse', false);
  }, [updateCursor]);

  const onPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const screen = localPoint(event);
      pointerScreenRef.current = screen;
      updateCursor(screen.x, screen.y, event.pointerType || 'mouse', true);
    },
    [localPoint, updateCursor],
  );

  useEffect(() => {
    const resize = (): void => {
      if (!rootRef.current) return;
      const width = rootRef.current.clientWidth;
      const height = rootRef.current.clientHeight;
      if (!width || !height) return;
      // ResizeObserver on the root handles this; kept for orientation changes
      // that occur while the observer is suspended.
      sizeRef.current = { width, height, dpr: renderDpr(width, height) };
      markDirty({ background: true, ink: true, live: true, overlay: true });
    };
    window.addEventListener('orientationchange', resize);
    return () => window.removeEventListener('orientationchange', resize);
  }, [markDirty]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (shapeTimerRef.current !== null) window.clearTimeout(shapeTimerRef.current);
      const press = mathPressRef.current;
      if (press) window.clearTimeout(press.timer);
      cancelGestureCandidate();
    },
    [cancelGestureCandidate],
  );

  const cursorClass = `drawing-surface${spaceRef.current ? ' is-pan-ready' : ''}${gesturing ? ' is-gesturing' : ''}`;

  return (
    <div
      ref={rootRef}
      className={cursorClass}
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => releasePointer(event, false)}
      onPointerCancel={(event) => releasePointer(event, true)}
      onPointerLeave={onPointerLeave}
      onPointerEnter={onPointerEnter}
      onContextMenu={(event) => event.preventDefault()}
      role="application"
      aria-label={markdownMeta.title}
    >
      <canvas ref={backgroundCanvasRef} className="canvas-layer canvas-background" aria-hidden="true" />
      {markdownHtml ? (
        <div
          ref={cardRef}
          className="markdown-card-anchor"
          onPointerDown={(event) => {
            if (event.target instanceof HTMLImageElement) event.stopPropagation();
          }}
          onClick={(event) => {
            if (!(event.target instanceof HTMLImageElement)) return;
            event.stopPropagation();
            callbacksRef.current.onImagePreview(event.target.currentSrc || event.target.src, event.target.alt);
          }}
        >
          <article
            className="markdown-card"
            aria-label={markdownMeta.title}
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
          />
        </div>
      ) : null}
      <canvas ref={inkCanvasRef} className="canvas-layer canvas-ink" aria-hidden="true" />
      <canvas ref={liveCanvasRef} className="canvas-layer canvas-live" aria-hidden="true" />
      <canvas ref={overlayCanvasRef} className="canvas-layer canvas-overlay" aria-hidden="true" />
      <div ref={cursorRef} className="brush-cursor" data-visible="false" aria-hidden="true" />
      {mathHoldAt ? (
        <div className="math-hold-indicator" style={{ left: mathHoldAt.x, top: mathHoldAt.y }}>
          <span className="math-hold-pulse" aria-hidden="true" />
          {t('math.hold')}
        </div>
      ) : null}
      {shapeHint ? (
        <div className="shape-hint" style={{ left: shapeHint.x, top: shapeHint.y }}>
          <Sparkle24Filled />
          {t('shape.recognized', { shape: t(`shape.${shapeHint.kind}`) })}
        </div>
      ) : null}
      {gesturing ? <div className="gesture-pill">{gestureHint}</div> : null}
      {!hasInk && !markdownHtml ? <span className="visually-hidden">Empty canvas</span> : null}
    </div>
  );
});
