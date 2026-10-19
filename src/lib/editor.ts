import {
  ADJUSTMENT_PARAMS,
  adjustImageData,
  computeHistogram,
  curveToPath,
  defaultCurves,
  defaultParams,
  histogramPath,
} from './adjustments';
import {
  PLUGINS,
  PLUGINS_EVENT,
  activePlugins,
  findEffect,
  findPlugin,
  loadPluginState,
  savePluginState,
  type PluginEffect,
  type SuperPhotoPlugin,
} from './plugins';
import {
  compositeCanvas,
  createDocument,
  createLayer,
  cropDocument,
  duplicateLayer,
  pathToSvg,
  renderDocument,
  renderLayer,
  resizeDocumentCanvas,
  resizeDocumentImage,
  restoreGeometry,
  snapshotGeometry,
  type DocGeometrySnapshot,
} from './document';
import { History } from './history';
import {
  extensionForMime,
  isTauri,
  mimeForFormat,
  openImages,
  readNativeImage,
  sanitizeFilename,
  saveExport,
} from './io';
import { createMask, drawMaskThumb, flattenMask } from './mask';
import {
  brushColorForMask,
  cloneStamp,
  meanColorAround,
  colorShift,
  paintStamp,
  patchRegion,
  strokePencil,
  walkStroke,
} from './painting';
import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  loadPreferences,
  onPreferencesChange,
  preferencesEqual,
  resolveTheme,
  savePreferences,
  watchSystemTheme,
  type Preferences,
  type RenderQuality,
  type ThemeMode,
} from './preferences';
import {
  LANGUAGE_EVENT,
  applyStaticTranslations,
  currentLanguage,
  initLanguage,
  saveLanguage,
  setLanguage,
  t,
  tValue,
  type Lang,
} from './i18n';
import { decodeMedia, isSupportedMedia } from './media';
import { looksLikeProject, parseProject, serializeProject, SPS_MIME } from './project';
import { initRangePaint, paintRange, paintRanges } from './ranges';
import { magicWandSelection } from './selection';
import {
  clearSession,
  formatSessionTime,
  loadSession,
  restoreDocument,
  saveSession,
} from './session';
import type {
  AdjustmentId,
  AdjustmentState,
  Anchor,
  BlendMode,
  BrushSettings,
  CurveChannel,
  CurvePoint,
  GradientOptions,
  Layer,
  PatchSettings,
  PathData,
  PhotoDoc,
  Point,
  Rect,
  Selection,
  ShapeOptions,
  TextData,
  ToolId,
  WandSettings,
} from './types';
import {
  alphaBounds,
  canvasContext,
  canvasToBlob,
  blendThroughMask,
  buildSelectionMask,
  clamp,
  cloneCanvas,
  createCanvas,
  deepClone,
  normalizeRect,
  pointInRect,
  pointsBounds,
  rgbToHex,
  selectionBounds,
  selectionContains,
  selectionFeather,
  selectionPath,
  selectionRings,
  withAlpha,
  type SelectionMask,
} from './utils';

/** Poignées de la boîte de transformation, dans le sens horaire. */
type ScaleHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_CURSORS: Record<ScaleHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

type DragState =
  | { kind: 'pan'; clientX: number; clientY: number; scrollLeft: number; scrollTop: number }
  | { kind: 'marquee'; mode: 'rect' | 'ellipse' | 'lasso'; start: Point; current: Point; points: Point[] }
  | { kind: 'crop'; start: Point; current: Point; ratio: number | null }
  | { kind: 'shape'; start: Point; current: Point }
  | { kind: 'gradient'; start: Point; current: Point }
  | {
      kind: 'paint';
      layerId: string;
      target: 'layer' | 'mask';
      last: Point;
      carry: number;
      before: HTMLCanvasElement;
      source: HTMLCanvasElement | null;
      offset: Point | null;
      label: string;
      erase: boolean;
      shift: { r: number; g: number; b: number } | null;
    }
  | { kind: 'patch-region'; start: Point; current: Point }
  | { kind: 'patch-move'; start: Point; current: Point }
  | { kind: 'spotlight'; start: Point; current: Point }
  | {
      kind: 'move';
      layerId: string;
      start: Point;
      moved: boolean;
      /** Boîte de départ, pour que le repère suive le contenu sans re-scanner. */
      baseRect?: Rect | null;
      liveRect?: Rect | null;
      beforeCanvas?: HTMLCanvasElement;
      beforeText?: TextData;
      beforePath?: PathData;
    }
  | {
      kind: 'scale';
      layerId: string;
      handle: ScaleHandle;
      start: Point;
      startRect: Rect;
      liveRect: Rect;
      moved: boolean;
      beforeCanvas?: HTMLCanvasElement;
      beforeText?: TextData;
      beforePath?: PathData;
    }
  | { kind: 'eyedropper' }
  | { kind: 'pen-anchor'; layerId: string; index: number; before: PathData; beforePoint: Point }
  | { kind: 'pen-handle'; layerId: string; index: number; which: 'in' | 'out'; before: PathData }
  | {
      kind: 'pen-new-anchor';
      layerId: string;
      index: number;
      before: PathData;
      start: Point;
      moved: boolean;
    };

interface ToolInfo {
  shortcut: string;
  cursor: string;
}

type ExportFormat = 'png' | 'jpeg' | 'webp' | 'sps';

/**
 * Session d'un effet de greffon : comme pour les réglages, l'aperçu travaille
 * sur une copie réduite du calque et « Appliquer » recalcule en pleine
 * résolution. Le hasard des effets étant ensemencé, les deux images sont
 * identiques au grain près.
 */
interface PluginSession {
  pluginId: string;
  effectId: string;
  layerId: string;
  params: Record<string, number>;
  original: ImageData;
  preview: ImageData;
  previewScale: number;
  previewCanvas: HTMLCanvasElement;
}

const TOOLS: Record<ToolId, ToolInfo> = {
  select: { shortcut: 'V', cursor: 'default' },
  marquee: { shortcut: 'M', cursor: 'crosshair' },
  'magic-wand': { shortcut: 'W', cursor: 'crosshair' },
  pencil: { shortcut: 'N', cursor: 'crosshair' },
  brush: { shortcut: 'B', cursor: 'crosshair' },
  eraser: { shortcut: 'E', cursor: 'crosshair' },
  stamp: { shortcut: 'S', cursor: 'crosshair' },
  patch: { shortcut: 'J', cursor: 'crosshair' },
  heal: { shortcut: 'K', cursor: 'crosshair' },
  spotlight: { shortcut: 'L', cursor: 'crosshair' },
  crop: { shortcut: 'C', cursor: 'crosshair' },
  shapes: { shortcut: 'U', cursor: 'crosshair' },
  pen: { shortcut: 'P', cursor: 'crosshair' },
  text: { shortcut: 'T', cursor: 'text' },
  eyedropper: { shortcut: 'I', cursor: 'crosshair' },
  gradient: { shortcut: 'G', cursor: 'crosshair' },
  zoom: { shortcut: 'Z', cursor: 'zoom-in' },
  hand: { shortcut: 'H', cursor: 'grab' },
};

/** Libellé et aide de l'outil, dans la langue courante. */
function toolLabel(id: ToolId): string {
  return t(`tool.${id}.label`);
}

function toolHint(id: ToolId): string {
  return t(`tool.${id}.hint`);
}

const BLEND_MODES: BlendMode[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

function kindLabel(kind: Layer['kind']): string {
  return tValue('kind', kind);
}

function blendLabel(value: BlendMode): string {
  return tValue('blend', value);
}

const SMOOTHING_QUALITY: Record<RenderQuality, ImageSmoothingQuality> = {
  fast: 'low',
  balanced: 'medium',
  precise: 'high',
};

const FONT_FAMILIES = [
  'Inter',
  'Segoe UI',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Impact',
];

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(t('err.missingElement', { id }));
  return node as T;
}

function icon(name: string, className = ''): string {
  return `<svg class="ico ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function scaleSelection(selection: Selection, scale: number): Selection {
  const feather = selection.feather ? Math.max(0, selection.feather * scale) : undefined;
  if (selection.type === 'poly') {
    return {
      ...selection,
      points: selection.points.map((point) => ({ x: point.x * scale, y: point.y * scale })),
      feather,
    };
  }
  return {
    ...selection,
    rect: {
      x: selection.rect.x * scale,
      y: selection.rect.y * scale,
      w: selection.rect.w * scale,
      h: selection.rect.h * scale,
    },
    feather,
  };
}

const MAX_PREVIEW_EDGE = 1800;
const PREVIEW_MIN_INTERVAL = 42;

/**
 * Un onglet de document. Chaque onglet garde son historique, sa sélection et
 * son cadrage : passer de l'un à l'autre ne casse rien et ne redessine que la
 * toile visible.
 */
interface DocTab {
  id: string;
  doc: PhotoDoc;
  history: History;
  selection: Selection | null;
  zoom: number;
  fitMode: boolean;
  scroll: { left: number; top: number } | null;
  maskCache: { key: string; mask: SelectionMask } | null;
  coverageCache: { key: string; data: Uint8ClampedArray } | null;
}

export class SuperPhotoEditor {
  private tabs: DocTab[] = [];
  private activeTabId = '';
  private fallbackHistory = new History(() => {});
  private fallbackSelection: Selection | null = null;
  private fallbackZoom = 1;
  private fallbackFit = true;
  private activeTool: ToolId = 'select';
  private pendingCrop: Rect | null = null;
  private drag: DragState | null = null;
  private adjustment: AdjustmentState | null = null;
  private adjustmentFrame = 0;
  private adjustmentTimer = 0;
  private lastPreviewAt = 0;
  private pointer: Point = { x: 0, y: 0 };
  private pointerInside = false;
  private spaceDown = false;
  private frame = 0;
  private layersDirty = true;
  private moveFrame = 0;
  private pendingMove: PointerEvent | null = null;
  /** Boîtes de contenu par calque, recalculées à la demande (analyse réduite). */
  private boundsCache = new Map<string, { rect: Rect | null; at: number }>();
  /** Poignée survolée : sert à changer le curseur au-dessus de la boîte. */
  private hoverHandle: ScaleHandle | null = null;
  /** Regroupement des déplacements au clavier en une seule étape d'historique. */
  private nudge: {
    layerId: string;
    dx: number;
    dy: number;
    canvas?: HTMLCanvasElement;
    text?: TextData;
    path?: PathData;
    timer: number;
  } | null = null;

  private preferences: Preferences = loadPreferences();
  private preferencesSnapshot: Preferences | null = null;

  // ── Onglets ──────────────────────────────────────────────────────────────

  private get tab(): DocTab | null {
    return this.tabs.find((item) => item.id === this.activeTabId) ?? null;
  }

  private get doc(): PhotoDoc | null {
    return this.tab?.doc ?? null;
  }

  private get history(): History {
    return this.tab?.history ?? this.fallbackHistory;
  }

  private get zoom(): number {
    return this.tab?.zoom ?? this.fallbackZoom;
  }

  private set zoom(value: number) {
    const tab = this.tab;
    if (tab) tab.zoom = value;
    else this.fallbackZoom = value;
  }

  private get fitMode(): boolean {
    return this.tab?.fitMode ?? this.fallbackFit;
  }

  private set fitMode(value: boolean) {
    const tab = this.tab;
    if (tab) tab.fitMode = value;
    else this.fallbackFit = value;
  }

  /**
   * La sélection invalide les caches de contour progressif de son onglet dès
   * qu'elle change : le masque flou n'est calculé qu'une fois par sélection.
   */
  private get selection(): Selection | null {
    return this.tab ? this.tab.selection : this.fallbackSelection;
  }

  private set selection(value: Selection | null) {
    const tab = this.tab;
    if (!tab) {
      this.fallbackSelection = value;
      return;
    }
    if (value !== tab.selection) {
      tab.selection = value;
      tab.maskCache = null;
      tab.coverageCache = null;
    }
  }

  /** Cache des nœuds chauds : zéro getElementById pendant les gestes. */
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly statusCache = new Map<string, string>();
  private readonly layerRows = new Map<string, HTMLElement>();
  private layerOrderSignature = '';
  /** Sélection multiple (Maj / Ctrl + clic), comme dans Photoshop. */
  private selectedLayerIds = new Set<string>();
  /** Glissement d'une ligne de calque en cours, pour réordonner. */
  private layerDrag: {
    ids: string[];
    startY: number;
    active: boolean;
    target: number;
    indicator: HTMLElement;
  } | null = null;
  /** Un glissement vient de se terminer : le clic qui suit ne doit rien faire. */
  private layerDragJustEnded = false;

  private primaryColor = '#111114';
  private secondaryColor = '#ffffff';

  private shapeOptions: ShapeOptions = {
    type: 'rectangle',
    fill: '#111114',
    stroke: '#ffffff',
    strokeWidth: 0,
    radius: 16,
    newLayer: true,
  };

  private gradientOptions: GradientOptions = {
    type: 'linear',
    colors: 'fg-bg',
    opacity: 100,
    newLayer: true,
  };

  private pathOptions = {
    fill: 'none',
    stroke: '#111114',
    strokeWidth: 3,
  };

  /** Curseur courant pour le tracé d'aperçu de la plume (espace document). */
  private penHover: Point | null = null;
  /** Le curseur est sur le premier point : un clic fermera le tracé. */
  private penCloseHover = false;
  /** Ancre survolée, pour l'aperçu de déplacement. */
  private penHoverAnchor = -1;
  /** Dernier clic sur une ancre, pour détecter le double-clic. */
  private penLastClick = { at: 0, index: -1 };

  private textOptions = {
    fontFamily: 'Inter',
    fontSize: 72,
    fontWeight: 600,
    align: 'left' as TextData['align'],
    lineHeight: 1.15,
  };

  private cropRatio: number | null = null;
  private marqueeMode: 'rect' | 'ellipse' | 'lasso' = 'rect';
  private brush: BrushSettings = { size: 56, hardness: 0.75, opacity: 1, spacing: 0.12 };
  private pencilOptions = { size: 3, opacity: 1 };
  private wand: WandSettings = { tolerance: 32, contiguous: true, merged: false };
  private patchOptions: PatchSettings = { corrector: true };
  private selectionFeather = 0;
  private spotlight = { diameter: 420, intensity: 55, softness: 60 };
  private canvasMenu: HTMLElement | null = null;
  private refreshBlendOptions: (() => void) | null = null;
  private stampSource: Point | null = null;
  private patchSourceRect: Rect | null = null;
  private autosaveTimer = 0;
  private autosaveVersion = 0;
  private autosaveSavedVersion = 0;
  private autosaveState: 'off' | 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  private autosaveAt = 0;
  private lastSessionAt = 0;
  private curveChannel: CurveChannel = 'rgb';
  private textEditBefore = new Map<string, TextData>();
  private layerPropBefore: number | null = null;
  private layerPropBeforeAll: Map<string, number> | null = null;
  private newDocRatioLock = false;
  private newDocRatio = 16 / 9;
  private resizeMode: 'image' | 'canvas' = 'image';
  private resizeRatioLock = true;
  private resizeRatio = 1;
  private resizeAnchor = { x: 0.5, y: 0.5 };
  private exportFormat: ExportFormat = 'png';
  private saving = false;

  // ── Greffons ─────────────────────────────────────────────────────────────
  private pluginState = loadPluginState();
  private pluginSession: PluginSession | null = null;
  private pluginFrame = 0;
  private pluginTimer = 0;
  private pluginLastPreviewAt = 0;

  private readonly app: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly canvasStack: HTMLElement;
  private readonly display: HTMLCanvasElement;
  private readonly overlay: SVGSVGElement;
  private readonly emptyState: HTMLElement;
  private readonly layersList: HTMLElement;
  private readonly toolOptions: HTMLElement;
  private readonly newDocModal: HTMLElement;
  private readonly resizeModal: HTMLElement;
  private readonly exportModal: HTMLElement;
  private readonly preferencesModal: HTMLElement;
  private readonly pluginPanel: HTMLElement;
  private readonly toastHost: HTMLElement;

  constructor() {
    this.app = byId('app-shell');
    this.viewport = byId('viewport');
    this.canvasStack = byId('canvas-stack');
    this.display = byId<HTMLCanvasElement>('display-canvas');
    this.overlay = document.getElementById('overlay') as unknown as SVGSVGElement;
    this.emptyState = byId('empty-state');
    this.layersList = byId('layers-list');
    this.toolOptions = byId('tool-options');
    this.newDocModal = byId('new-document-modal');
    this.resizeModal = byId('resize-modal');
    this.exportModal = byId('export-modal');
    this.preferencesModal = byId('preferences-modal');
    this.pluginPanel = byId('plugin-sidebar');
    this.toastHost = byId('toast-host');

    initLanguage();
    applyStaticTranslations(document);
    applyPreferences(this.preferences);
    watchSystemTheme();
    initRangePaint();
    window.addEventListener('resize', () => this.invalidateDisplayRect(), { passive: true });
    // Les panneaux, la barre d'onglets et le plein écran déplacent la toile sans
    // provoquer d'événement `resize` : sans observateur, le rectangle mémorisé
    // restait périmé et chaque clic tombait quelques pixels à côté.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.invalidateDisplayRect());
      observer.observe(this.display);
      observer.observe(this.viewport);
    }
    this.viewport.addEventListener('scroll', () => {
      this.invalidateDisplayRect();
      const tab = this.tab;
      if (tab) tab.scroll = { left: this.viewport.scrollLeft, top: this.viewport.scrollTop };
    }, { passive: true });

    this.bindTopbar();
    this.bindTabs();
    this.bindLanguage();
    this.bindToolRail();
    this.bindLayersPanel();
    this.bindCanvas();
    this.bindCanvasMenu();
    this.bindNewDocumentDialog();
    this.bindResizeDialog();
    this.bindExportDialog();
    this.bindPreferences();
    this.bindPluginDialog();
    this.bindKeyboard();
    this.bindDragAndDrop();
    this.bindGlobalButtons();

    this.syncColors();
    this.setTool('select');
    this.renderAll();
    this.bindSession();
    void this.boot();
  }

  /**
   * Au démarrage : on restaure la session si elle existe, sinon on propose la
   * fenêtre « Nouveau document ». Rien n'est perdu en fermant l'onglet.
   */
  private async boot(): Promise<void> {
    const restored = await this.restoreSession();
    if (restored) {
      // La fenêtre d'ouverture est présente dans le HTML : sans cela elle
      // resterait par-dessus un document restauré.
      this.closeNewDocumentDialog();
      return;
    }
    window.setTimeout(() => {
      // Un document a pu être créé entre-temps (Ctrl+N, glisser-déposer) :
      // on n'écrase pas son travail avec la fenêtre d'ouverture.
      if (!this.doc) this.openNewDocumentDialog(true);
    }, 120);
  }

  private node<T extends HTMLElement>(id: string): T {
    let element = this.nodes.get(id) as T | undefined;
    if (!element) {
      element = byId<T>(id);
      this.nodes.set(id, element);
    }
    return element;
  }

  private setText(id: string, value: string): void {
    if (this.statusCache.get(id) === value) return;
    this.statusCache.set(id, value);
    this.node<HTMLElement>(id).textContent = value;
  }

  private invalidateDisplayRect(): void {
    /* Conservé pour les appelants existants : la mesure n'est plus mémorisée. */
  }

  /**
   * Rectangle de la toile à l'écran.
   *
   * Volontairement **non mémorisé** : la toile se déplace dès qu'un panneau,
   * un onglet ou le plein écran change la mise en page, et un rectangle périmé
   * faisait tomber chaque clic quelques pixels à côté. Une mesure par événement
   * pointeur coûte quelques microsecondes, une erreur de position coûte le clic.
   */
  private currentDisplayRect(): DOMRect {
    return this.display.getBoundingClientRect();
  }

  private get activeLayer(): Layer | null {
    return this.doc?.layers.find((layer) => layer.id === this.doc?.activeLayerId) ?? null;
  }

  private get activePathLayer(): Layer | null {
    const layer = this.activeLayer;
    return layer && layer.kind === 'path' && layer.path ? layer : null;
  }

  private get activeTextLayer(): Layer | null {
    const layer = this.activeLayer;
    return layer && layer.kind === 'text' && layer.text ? layer : null;
  }

  private docPoint(event: PointerEvent | MouseEvent): Point {
    if (!this.doc) return { x: 0, y: 0 };
    const rect = this.currentDisplayRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * this.doc.width, 0, this.doc.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * this.doc.height, 0, this.doc.height),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Boîte de transformation du calque
  // ───────────────────────────────────────────────────────────────────────────

  private invalidateBounds(layerId?: string): void {
    if (layerId) this.boundsCache.delete(layerId);
    else this.boundsCache.clear();
  }

  /** Contenu visible du calque : texte et tracé ont une boîte exacte, le reste est scanné. */
  private layerBounds(layer: Layer): Rect | null {
    if (layer.text?.bounds) return { ...layer.text.bounds };
    if (layer.path && layer.path.anchors.length > 0) {
      const points: Point[] = [];
      for (const anchor of layer.path.anchors) {
        points.push({ x: anchor.x, y: anchor.y });
        points.push({ x: anchor.x + anchor.inX, y: anchor.y + anchor.inY });
        points.push({ x: anchor.x + anchor.outX, y: anchor.y + anchor.outY });
      }
      return pointsBounds(points);
    }
    const now = performance.now();
    const cached = this.boundsCache.get(layer.id);
    if (cached && now - cached.at < 120) return cached.rect;
    const rect = alphaBounds(layer.canvas);
    this.boundsCache.set(layer.id, { rect, at: now });
    return rect;
  }

  /** Outils pour lesquels la boîte de transformation est affichée. */
  private get gizmoVisible(): boolean {
    return this.activeTool === 'select' || this.activeTool === 'shapes';
  }

  private handlePositions(box: Rect): [ScaleHandle, number, number][] {
    const x1 = box.x;
    const y1 = box.y;
    const x2 = box.x + box.w;
    const y2 = box.y + box.h;
    const cx = x1 + box.w / 2;
    const cy = y1 + box.h / 2;
    return [
      ['nw', x1, y1],
      ['n', cx, y1],
      ['ne', x2, y1],
      ['e', x2, cy],
      ['se', x2, y2],
      ['s', cx, y2],
      ['sw', x1, y2],
      ['w', x1, cy],
    ];
  }

  /** Poignée sous le curseur, avec une tolérance constante à l'écran. */
  private handleAt(point: Point, box: Rect): ScaleHandle | null {
    const tolerance = 10 / this.zoom;
    for (const [handle, x, y] of this.handlePositions(box)) {
      if (Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance) return handle;
    }
    return null;
  }

  /** Boîte affichée : la boîte du contenu, décalée pendant un déplacement. */
  private gizmoRect(): Rect | null {
    const drag = this.drag;
    if (drag?.kind === 'scale') return drag.liveRect;
    if (drag?.kind === 'move') return drag.liveRect ?? null;
    const layer = this.activeLayer;
    if (!layer || !layer.visible) return null;
    return this.layerBounds(layer);
  }

  private updateCanvasCursor(): void {
    if (this.spaceDown) {
      this.display.style.cursor = 'grab';
      return;
    }
    if (this.activeTool !== 'select' || this.drag) return;
    if (this.activeLayer?.locked) {
      this.hoverHandle = null;
      this.display.style.cursor = TOOLS[this.activeTool].cursor;
      return;
    }
    const box = this.gizmoRect();
    const handle = box ? this.handleAt(this.pointer, box) : null;
    if (handle !== this.hoverHandle) this.hoverHandle = handle;
    if (handle) {
      this.display.style.cursor = HANDLE_CURSORS[handle];
      return;
    }
    this.display.style.cursor = box && pointInRect(this.pointer.x, this.pointer.y, box)
      ? 'move'
      : TOOLS[this.activeTool].cursor;
  }

  /**
   * Nouveau rectangle après un glissement de poignée.
   * `keepRatio` (Maj) conserve les proportions, `fromCenter` (Alt) symétrise.
   */
  private scaleRect(
    base: Rect,
    handle: ScaleHandle,
    dx: number,
    dy: number,
    keepRatio: boolean,
    fromCenter: boolean,
  ): Rect {
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.includes('n');
    const south = handle.includes('s');
    let x1 = base.x;
    let y1 = base.y;
    let x2 = base.x + base.w;
    let y2 = base.y + base.h;
    const cx = base.x + base.w / 2;
    const cy = base.y + base.h / 2;

    if (west) x1 = base.x + dx;
    if (east) x2 = base.x + base.w + dx;
    if (north) y1 = base.y + dy;
    if (south) y2 = base.y + base.h + dy;

    if (keepRatio && base.h > 0 && base.w > 0 && (west || east) && (north || south)) {
      const ratio = base.w / base.h;
      const width = x2 - x1;
      const height = y2 - y1;
      if (Math.abs(width) / (Math.abs(height) || 1) > ratio) {
        const target = Math.sign(height || 1) * (Math.abs(width) / ratio);
        if (north) y1 = y2 - target;
        else y2 = y1 + target;
      } else {
        const target = Math.sign(width || 1) * (Math.abs(height) * ratio);
        if (west) x1 = x2 - target;
        else x2 = x1 + target;
      }
    }

    if (fromCenter) {
      if (west) x2 = 2 * cx - x1;
      if (east) x1 = 2 * cx - x2;
      if (north) y2 = 2 * cy - y1;
      if (south) y1 = 2 * cy - y2;
    }

    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.max(1, Math.abs(x2 - x1)),
      h: Math.max(1, Math.abs(y2 - y1)),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Document lifecycle / onglets
  // ───────────────────────────────────────────────────────────────────────────

  private createNewDocument(width: number, height: number, dpi: number, background: PhotoDoc['background']): void {
    const doc = createDocument(
      Math.round(width),
      Math.round(height),
      Math.round(dpi),
      background,
      t('new.untitled'),
    );
    this.openTab(doc);
    this.closeNewDocumentDialog();
    this.setTool('select');
    this.setMessage(t('msg.newDocument', { w: doc.width, h: doc.height }));
  }

  /** Crée un onglet pour un document et l'active. */
  private openTab(doc: PhotoDoc, activate = true): DocTab {
    const tab: DocTab = {
      id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      doc,
      history: new History(() => {
        if (this.activeTabId === tab.id) this.syncChrome();
      }),
      selection: null,
      zoom: 1,
      fitMode: true,
      scroll: null,
      maskCache: null,
      coverageCache: null,
    };
    this.tabs.push(tab);
    this.renderTabs();
    if (activate) this.activateTab(tab.id, { skipSave: true });
    return tab;
  }

  /**
   * Bascule d'onglet : on mémorise le défilement de celui qu'on quitte, on
   * remet en place le décor du nouveau, puis on redessine. Aucun calque n'est
   * copié : chaque onglet possède déjà ses canvas.
   */
  private activateTab(tabId: string, options: { skipSave?: boolean } = {}): void {
    const next = this.tabs.find((item) => item.id === tabId);
    if (!next) return;
    const previous = this.tab;
    if (previous && !options.skipSave) {
      previous.scroll = { left: this.viewport.scrollLeft, top: this.viewport.scrollTop };
    }
    if (previous?.id === next.id && options.skipSave !== true) {
      /* Réactivation du même onglet : rien à reconstruire. */
    }
    this.cancelAdjustment();
    this.closeCanvasMenu();
    this.activeTabId = next.id;
    this.drag = null;
    this.pendingCrop = null;
    this.patchSourceRect = null;
    this.stampSource = null;
    this.pointerInside = false;
    this.adjustment = null;
    this.textEditBefore.clear();
    this.layersDirty = true;
    this.layerOrderSignature = '';
    this.statusCache.clear();
    this.invalidateDisplayRect();

    const doc = next.doc;
    this.display.width = doc.width;
    this.display.height = doc.height;
    this.overlay.setAttribute('viewBox', `0 0 ${doc.width} ${doc.height}`);
    this.overlay.setAttribute('width', String(doc.width));
    this.overlay.setAttribute('height', String(doc.height));
    this.canvasStack.style.display = 'block';
    this.emptyState.hidden = true;
    if (next.scroll) this.applyZoom();
    else this.fitToView();
    this.renderTabs();
    this.renderAll();
    this.renderToolOptions();
    this.syncChrome();
    if (next.scroll) {
      window.requestAnimationFrame(() => {
        this.viewport.scrollLeft = next.scroll?.left ?? 0;
        this.viewport.scrollTop = next.scroll?.top ?? 0;
      });
    }
  }

  private closeTab(tabId: string): void {
    const index = this.tabs.findIndex((item) => item.id === tabId);
    if (index < 0) return;
    if (this.adjustment && this.tab?.id === tabId) this.cancelAdjustment();
    this.tabs.splice(index, 1);
    if (this.tabs.length === 0) {
      this.activeTabId = '';
      this.drag = null;
      this.pendingCrop = null;
      this.patchSourceRect = null;
      this.stampSource = null;
      this.selection = null;
      this.history.clear();
      this.canvasStack.style.display = 'none';
      this.emptyState.hidden = false;
      this.overlay.innerHTML = '';
      this.statusCache.clear();
      this.renderTabs();
      this.renderLayers();
      this.renderToolOptions();
      this.syncChrome();
      this.scheduleAutosave(200);
      if (this.tabs.length === 0) {
        // Plus aucun onglet : la session doit disparaître, sinon un
        // rechargement ressusciterait des documents fermés.
        window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = 0;
        this.lastSessionAt = 0;
        this.autosaveState = 'idle';
        void clearSession();
        this.syncAutosaveBadge();
      }
      return;
    }
    if (this.activeTabId === tabId) {
      const neighbour = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeTabId = '';
      if (neighbour) this.activateTab(neighbour.id, { skipSave: true });
    }
    this.renderTabs();
    this.scheduleAutosave(200);
  }



  private renderTabs(): void {
    const host = document.getElementById('doc-tabs');
    if (!host) return;
    host.textContent = '';
    if (this.tabs.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'doc-tabs-empty';
      empty.dataset.i18n = 'tabs.none';
      empty.textContent = t('tabs.none');
      host.appendChild(empty);
      return;
    }
    for (const tab of this.tabs) {
      const active = tab.id === this.activeTabId;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `doc-tab${active ? ' is-active' : ''}`;
      button.dataset.tabId = tab.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(active));
      button.title = `${tab.doc.name} · ${tab.doc.width} × ${tab.doc.height} px`;

      const label = document.createElement('span');
      label.className = 'doc-tab-name';
      label.textContent = tab.doc.name;
      button.appendChild(label);

      const meta = document.createElement('span');
      meta.className = 'doc-tab-meta';
      meta.textContent = `${tab.doc.width}×${tab.doc.height}`;
      button.appendChild(meta);

      const close = document.createElement('span');
      close.className = 'doc-tab-close';
      close.dataset.tabClose = tab.id;
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', t('tabs.close', { name: tab.doc.name }));
      close.title = t('tabs.close', { name: tab.doc.name });
      close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-close"></use></svg>';
      button.appendChild(close);

      host.appendChild(button);
    }
  }


  // ───────────────────────────────────────────────────────────────────────────
  // Session / sauvegarde automatique
  // ───────────────────────────────────────────────────────────────────────────

  private bindSession(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.flushAutosave();
    });
    window.addEventListener('pagehide', () => {
      void this.flushAutosave();
    });
  }

  private scheduleAutosave(delay = 1500): void {
    if (!this.preferences.autosave || this.tabs.length === 0) return;
    // Chaque changement incrémente la version : une sauvegarde qui se termine
    // alors que d'autres modifications sont arrivées se reprogramme, sinon la
    // session resterait figée sur un état intermédiaire (fermeture d'onglet,
    // création rapide de plusieurs documents…).
    this.autosaveVersion += 1;
    this.armAutosave(delay);
  }

  private armAutosave(delay: number): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = 0;
      void this.runAutosave();
    }, delay);
  }

  private async flushAutosave(): Promise<void> {
    if (!this.autosaveTimer) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = 0;
    await this.runAutosave();
  }

  private async runAutosave(): Promise<void> {
    if (!this.preferences.autosave || this.tabs.length === 0) return;
    if (this.autosaveState === 'saving') {
      this.armAutosave(400);
      return;
    }
    const version = this.autosaveVersion;
    this.autosaveState = 'saving';
    this.syncAutosaveBadge();
    try {
      const activeIndex = Math.max(0, this.tabs.findIndex((item) => item.id === this.activeTabId));
      await saveSession(this.tabs.map((item) => item.doc), activeIndex);
      this.autosaveState = 'saved';
      this.autosaveAt = Date.now();
      this.lastSessionAt = this.autosaveAt;
      this.autosaveSavedVersion = version;
    } catch (error) {
      this.autosaveState = 'error';
      console.warn('Automatic save unavailable', error);
    }
    this.syncAutosaveBadge();
    if (this.tabs.length > 0 && this.autosaveVersion !== this.autosaveSavedVersion) {
      this.armAutosave(350);
    }
  }

  private syncAutosaveBadge(): void {
    const host = document.getElementById('status-autosave');
    const state = this.preferences.autosave ? this.autosaveState : 'off';
    if (host) {
      host.dataset.state = state;
      const text = document.getElementById('status-autosave-text');
      if (text) {
        text.textContent =
          state === 'off'
            ? t('status.autoOff')
            : state === 'saving'
              ? t('status.saving')
              : state === 'error'
                ? t('status.unavailable')
                : state === 'saved'
                  ? t('status.saved', { time: formatSessionTime(this.autosaveAt) })
                  : t('status.auto');
      }
      host.title =
        state === 'off'
          ? t('status.autosaveOff')
          : state === 'saved'
            ? t('status.autosaveOn')
            : t('status.autosaveTitle');
    }
    const sessionHint = document.getElementById('prefs-session-state');
    if (sessionHint) {
      sessionHint.textContent = this.lastSessionAt
        ? t('prefs.lastSave', { time: formatSessionTime(this.lastSessionAt) })
        : t('prefs.none');
    }
  }

  private async restoreSession(): Promise<boolean> {
    try {
      const snapshot = await loadSession();
      if (!snapshot) {
        this.syncAutosaveBadge();
        return false;
      }
      const docs: PhotoDoc[] = [];
      for (const stored of snapshot.documents) docs.push(await restoreDocument(stored));
      if (docs.length === 0) {
        this.syncAutosaveBadge();
        return false;
      }
      this.lastSessionAt = snapshot.savedAt;
      docs.forEach((doc, index) => this.openTab(doc, index === snapshot.activeIndex));
      if (snapshot.activeIndex !== this.tabs.length - 1) this.activateTab(this.tabs[snapshot.activeIndex]?.id ?? '');
      this.autosaveState = 'saved';
      this.autosaveAt = snapshot.savedAt;
      this.syncAutosaveBadge();
      const time = formatSessionTime(snapshot.savedAt);
      this.setMessage(t('msg.sessionRestored', { time }));
      this.toast(t('msg.sessionRestored', { time }), 'success');
      return true;
    } catch {
      this.syncAutosaveBadge();
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rendering
  // ───────────────────────────────────────────────────────────────────────────

  private renderAll(): void {
    this.invalidateBounds();
    this.syncCanvasGeometry();
    this.renderCanvas();
    this.renderOverlay();
    this.renderLayers();
    this.syncChrome();
    this.scheduleAutosave();
  }

  private syncCanvasGeometry(): void {
    const doc = this.doc;
    if (!doc) return;
    if (this.display.width !== doc.width) this.display.width = doc.width;
    if (this.display.height !== doc.height) this.display.height = doc.height;
    this.overlay.setAttribute('viewBox', `0 0 ${doc.width} ${doc.height}`);
    this.overlay.setAttribute('width', String(doc.width));
    this.overlay.setAttribute('height', String(doc.height));
    this.canvasStack.style.width = `${doc.width * this.zoom}px`;
    this.canvasStack.style.height = `${doc.height * this.zoom}px`;
    this.invalidateDisplayRect();
  }

  private renderCanvas(): void {
    if (!this.doc) return;
    renderDocument(this.doc, this.display);
  }

  private requestFrame(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.renderCanvas();
      this.renderOverlay();
      if (this.layersDirty) {
        this.layersDirty = false;
        this.renderLayers();
      }
      this.updateStatus();
    });
  }

  private renderOverlay(): void {
    const doc = this.doc;
    if (!doc) {
      this.overlay.innerHTML = '';
      return;
    }
    const activePath = this.activePathLayer;
    const activeText = this.activeTextLayer;
    const hasOverlay =
      Boolean(this.selection) ||
      Boolean(this.drag) ||
      Boolean(this.pendingCrop) ||
      Boolean(this.patchSourceRect) ||
      (this.gizmoVisible && Boolean(this.activeLayer)) ||
      (this.activeTool === 'spotlight' && this.pointerInside) ||
      (this.activeTool === 'pen' && Boolean(activePath?.path?.anchors.length)) ||
      (this.activeTool === 'text' && Boolean(activeText?.text?.bounds));
    if (!hasOverlay && this.overlay.childElementCount === 0) return;
    const ns = 'http://www.w3.org/2000/svg';
    this.overlay.innerHTML = '';
    this.overlay.setAttribute('viewBox', `0 0 ${doc.width} ${doc.height}`);

    const add = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number>,
    ): SVGElementTagNameMap[K] => {
      const node = document.createElementNS(ns, tag) as SVGElementTagNameMap[K];
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      this.overlay.appendChild(node);
      return node;
    };

    const selection = this.selection;
    if (selection) {
      const drawOutline = (className: string, attrs: Record<string, string | number> = {}) => {
        if (selection.type === 'rect') {
          add('rect', {
            x: selection.rect.x,
            y: selection.rect.y,
            width: selection.rect.w,
            height: selection.rect.h,
            class: className,
            ...attrs,
          });
        } else if (selection.type === 'ellipse') {
          add('ellipse', {
            cx: selection.rect.x + selection.rect.w / 2,
            cy: selection.rect.y + selection.rect.h / 2,
            rx: selection.rect.w / 2,
            ry: selection.rect.h / 2,
            class: className,
            ...attrs,
          });
        } else {
          const rings = selectionRings(selection);
          if (rings.length > 1) {
            add('path', {
              d: rings
                .map((ring) => `M ${ring.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`)
                .join(' '),
              class: className,
              'fill-rule': 'evenodd',
              ...attrs,
            });
          } else {
            const ring = rings[0] ?? selection.points;
            add('polygon', {
              points: ring.map((p) => `${p.x},${p.y}`).join(' '),
              class: className,
              ...attrs,
            });
          }
        }
      };
      const feather = selectionFeather(selection);
      if (feather > 0) {
        // Bande translucide : montre l'étendue exacte du dégradé.
        drawOutline('selection-feather', { 'stroke-width': feather * 2 });
      }
      drawOutline('selection-outline', { 'vector-effect': 'non-scaling-stroke' });
    }

    const patchDrag = this.drag?.kind === 'patch-move' ? this.drag : null;
    const patchRectRaw =
      this.drag?.kind === 'patch-region'
        ? normalizeRect(this.drag.start, this.drag.current)
        : this.patchSourceRect;
    if (patchRectRaw) {
      const dx = patchDrag ? patchDrag.current.x - patchDrag.start.x : 0;
      const dy = patchDrag ? patchDrag.current.y - patchDrag.start.y : 0;
      add('rect', {
        x: patchRectRaw.x + dx,
        y: patchRectRaw.y + dy,
        width: patchRectRaw.w,
        height: patchRectRaw.h,
        class: 'patch-outline',
        'vector-effect': 'non-scaling-stroke',
      });
    }

    const drag = this.drag;
    if (drag?.kind === 'marquee') {
      if (drag.mode === 'lasso') {
        add('polyline', {
          points: drag.points.map((p) => `${p.x},${p.y}`).join(' '),
          class: 'selection-preview',
          'vector-effect': 'non-scaling-stroke',
        });
      } else {
        const rect = normalizeRect(drag.start, drag.current);
        if (drag.mode === 'rect') {
          add('rect', {
            x: rect.x,
            y: rect.y,
            width: rect.w,
            height: rect.h,
            class: 'selection-preview',
            'vector-effect': 'non-scaling-stroke',
          });
        } else {
          add('ellipse', {
            cx: rect.x + rect.w / 2,
            cy: rect.y + rect.h / 2,
            rx: rect.w / 2,
            ry: rect.h / 2,
            class: 'selection-preview',
            'vector-effect': 'non-scaling-stroke',
          });
        }
      }
    }

    const cropRect = drag?.kind === 'crop'
      ? this.constrainCropRect(drag.start, drag.current, drag.ratio)
      : this.pendingCrop;
    if (cropRect && cropRect.w > 1 && cropRect.h > 1) {
      const inverse = `M 0 0 H ${doc.width} V ${doc.height} H 0 Z M ${cropRect.x} ${cropRect.y} H ${cropRect.x + cropRect.w} V ${cropRect.y + cropRect.h} H ${cropRect.x} Z`;
      add('path', {
        d: inverse,
        fill: 'rgba(0,0,0,0.55)',
        'fill-rule': 'evenodd',
        'pointer-events': 'none',
      });
      add('rect', {
        x: cropRect.x,
        y: cropRect.y,
        width: cropRect.w,
        height: cropRect.h,
        class: 'crop-outline',
        'vector-effect': 'non-scaling-stroke',
      });
      for (let i = 1; i < 3; i += 1) {
        add('line', {
          x1: cropRect.x + (cropRect.w * i) / 3,
          y1: cropRect.y,
          x2: cropRect.x + (cropRect.w * i) / 3,
          y2: cropRect.y + cropRect.h,
          class: 'crop-grid',
          'vector-effect': 'non-scaling-stroke',
        });
        add('line', {
          x1: cropRect.x,
          y1: cropRect.y + (cropRect.h * i) / 3,
          x2: cropRect.x + cropRect.w,
          y2: cropRect.y + (cropRect.h * i) / 3,
          class: 'crop-grid',
          'vector-effect': 'non-scaling-stroke',
        });
      }
    }

    if (drag?.kind === 'shape') {
      this.drawShapePreview(add, drag.start, drag.current);
    }

    if (drag?.kind === 'gradient') {
      add('line', {
        x1: drag.start.x,
        y1: drag.start.y,
        x2: drag.current.x,
        y2: drag.current.y,
        class: 'gradient-line',
        'vector-effect': 'non-scaling-stroke',
      });
      add('circle', {
        cx: drag.start.x,
        cy: drag.start.y,
        r: 5 / this.zoom,
        class: 'gradient-handle',
        'vector-effect': 'non-scaling-stroke',
      });
      add('circle', {
        cx: drag.current.x,
        cy: drag.current.y,
        r: 5 / this.zoom,
        class: 'gradient-handle',
        'vector-effect': 'non-scaling-stroke',
      });
    }

    const spot = drag?.kind === 'spotlight'
      ? {
          center: drag.start,
          radius: Math.max(8, Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y)),
        }
      : this.activeTool === 'spotlight' && this.pointerInside
        ? { center: this.pointer, radius: Math.max(8, this.spotlight.diameter / 2) }
        : null;
    if (spot) {
      const amount = clamp(this.spotlight.intensity / 100, 0, 1);
      const inner = 1 - clamp(this.spotlight.softness / 100, 0, 1);
      const gradientId = 'spot-preview-gradient';
      const defs = add('defs', {});
      const gradient = document.createElementNS(ns, 'radialGradient');
      gradient.setAttribute('id', gradientId);
      for (const [offset, opacity] of [
        [0, 0.85],
        [inner, 0.6],
        [1, 0],
      ] as const) {
        const stop = document.createElementNS(ns, 'stop');
        stop.setAttribute('offset', String(offset));
        stop.setAttribute('stop-color', '#ffffff');
        stop.setAttribute('stop-opacity', String(opacity * amount));
        gradient.appendChild(stop);
      }
      defs.appendChild(gradient);
      add('circle', {
        cx: spot.center.x,
        cy: spot.center.y,
        r: spot.radius,
        fill: `url(#${gradientId})`,
        class: 'spot-preview',
        'pointer-events': 'none',
      });
      add('circle', {
        cx: spot.center.x,
        cy: spot.center.y,
        r: spot.radius,
        class: 'spot-outline',
        'vector-effect': 'non-scaling-stroke',
      });
    }

    const pathLayer = this.activePathLayer;
    if (pathLayer?.path && this.activeTool === 'pen') {
      const path = pathLayer.path;
      const d = pathToSvg(path);
      if (d) {
        add('path', {
          d,
          fill: 'none',
          class: 'path-outline',
          'vector-effect': 'non-scaling-stroke',
        });
      }
      const radius = 5 / this.zoom;
      const draggingAnchor = drag?.kind === 'pen-anchor';
      const draggingNew = drag?.kind === 'pen-new-anchor';
      const last = path.anchors[path.anchors.length - 1];

      // Tracé élastique : on voit la courbe se dessiner avant de cliquer.
      if (this.penDrawing && !path.closed && this.penHover && last && !draggingAnchor && !draggingNew) {
        const ghost = `M ${last.x} ${last.y} C ${last.x + last.outX} ${last.y + last.outY}, ${this.penHover.x} ${this.penHover.y}, ${this.penHover.x} ${this.penHover.y}`;
        add('path', {
          d: ghost,
          fill: 'none',
          class: 'path-rubber',
          'vector-effect': 'non-scaling-stroke',
        });
        add('rect', {
          x: this.penHover.x - radius * 0.8,
          y: this.penHover.y - radius * 0.8,
          width: radius * 1.6,
          height: radius * 1.6,
          class: 'path-anchor is-ghost',
          'vector-effect': 'non-scaling-stroke',
        });
      }

      // Anneau de fermeture : le premier point s'entoure quand le clic fermera.
      const first = path.anchors[0];
      if (this.penCloseHover && first) {
        add('circle', {
          cx: first.x,
          cy: first.y,
          r: radius * 1.9,
          class: 'path-close-ring',
          'vector-effect': 'non-scaling-stroke',
        });
      }

      path.anchors.forEach((anchor, index) => {
        const selected = draggingAnchor && drag.index === index;
        const hovered = this.penHoverAnchor === index;
        add('line', {
          x1: anchor.x,
          y1: anchor.y,
          x2: anchor.x + anchor.outX,
          y2: anchor.y + anchor.outY,
          class: 'path-handle-line',
          'vector-effect': 'non-scaling-stroke',
        });
        add('line', {
          x1: anchor.x,
          y1: anchor.y,
          x2: anchor.x + anchor.inX,
          y2: anchor.y + anchor.inY,
          class: 'path-handle-line',
          'vector-effect': 'non-scaling-stroke',
        });
        add('circle', {
          cx: anchor.x + anchor.outX,
          cy: anchor.y + anchor.outY,
          r: radius * 0.7,
          class: 'path-handle',
          'vector-effect': 'non-scaling-stroke',
        });
        add('circle', {
          cx: anchor.x + anchor.inX,
          cy: anchor.y + anchor.inY,
          r: radius * 0.7,
          class: 'path-handle',
          'vector-effect': 'non-scaling-stroke',
        });
        const classes = ['path-anchor'];
        if (selected) classes.push('is-selected');
        if (hovered) classes.push('is-hovered');
        // Le premier point est plein : c'est la cible de fermeture.
        if (index === 0 && !path.closed) classes.push('is-first');
        add('rect', {
          x: anchor.x - radius,
          y: anchor.y - radius,
          width: radius * 2,
          height: radius * 2,
          class: classes.join(' '),
          'vector-effect': 'non-scaling-stroke',
        });
      });
    }

    const textLayer = this.activeTextLayer;
    if (textLayer?.text?.bounds && this.activeTool === 'text') {
      const bounds = textLayer.text.bounds;
      add('rect', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h,
        class: 'text-bounds',
        'vector-effect': 'non-scaling-stroke',
      });
    }

    // Boîte de transformation : contour + 8 poignées autour du contenu du
    // calque actif. C'est le repère qui manquait pour voir ce que l'on
    // sélectionne et pour le redimensionner à la souris.
    if (this.gizmoVisible && !this.adjustment && !this.pendingCrop) {
      const box = this.gizmoRect();
      if (box && box.w > 0 && box.h > 0) {
        const locked = Boolean(this.activeLayer?.locked);
        add('rect', {
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
          class: locked ? 'layer-box is-locked' : 'layer-box',
          'vector-effect': 'non-scaling-stroke',
        });
        // Un calque verrouillé garde son cadre mais perd ses poignées.
        if (locked) {
          // rien à dessiner de plus : le cadre suffit à montrer la sélection
        } else {
          const size = 8 / this.zoom;
          const active = this.drag?.kind === 'scale' ? this.drag.handle : null;
          for (const [handle, x, y] of this.handlePositions(box)) {
            add('rect', {
              x: x - size / 2,
              y: y - size / 2,
              width: size,
              height: size,
              class: `layer-handle${handle === active ? ' is-active' : ''}`,
              'vector-effect': 'non-scaling-stroke',
            });
          }
        }
      }
    }
  }

  private drawShapePreview(
    add: <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number>,
    ) => SVGElementTagNameMap[K],
    start: Point,
    current: Point,
  ): void {
    const rect = normalizeRect(start, current);
    const cls = 'shape-preview';
    if (this.shapeOptions.type === 'line') {
      add('line', {
        x1: start.x,
        y1: start.y,
        x2: current.x,
        y2: current.y,
        class: cls,
        'vector-effect': 'non-scaling-stroke',
      });
      return;
    }
    if (this.shapeOptions.type === 'ellipse') {
      add('ellipse', {
        cx: rect.x + rect.w / 2,
        cy: rect.y + rect.h / 2,
        rx: rect.w / 2,
        ry: rect.h / 2,
        class: cls,
        'vector-effect': 'non-scaling-stroke',
      });
      return;
    }
    if (this.shapeOptions.type === 'triangle') {
      add('polygon', {
        points: `${rect.x + rect.w / 2},${rect.y} ${rect.x + rect.w},${rect.y + rect.h} ${rect.x},${rect.y + rect.h}`,
        class: cls,
        'vector-effect': 'non-scaling-stroke',
      });
      return;
    }
    if (this.shapeOptions.type === 'star') {
      const points = this.starPoints(rect);
      add('polygon', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        class: cls,
        'vector-effect': 'non-scaling-stroke',
      });
      return;
    }
    add('rect', {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      rx: this.shapeOptions.radius,
      class: cls,
      'vector-effect': 'non-scaling-stroke',
    });
  }

  private applyZoom(): void {
    if (!this.doc) return;
    this.canvasStack.style.width = `${this.doc.width * this.zoom}px`;
    this.canvasStack.style.height = `${this.doc.height * this.zoom}px`;
    this.display.style.width = '100%';
    this.display.style.height = '100%';
    const pixelate = !this.preferences.smoothZoom || this.zoom >= 4;
    this.display.style.imageRendering = pixelate ? 'pixelated' : 'auto';
    this.overlay.style.width = '100%';
    this.overlay.style.height = '100%';
    this.invalidateDisplayRect();
    const zoomText = `${Math.round(this.zoom * 100)} %`;
    this.setText('zoom-value', zoomText);
    this.setText('status-zoom', zoomText);
    const zoomSlider = this.toolOptions.querySelector<HTMLInputElement>('[data-zoom-slider]');
    if (zoomSlider) {
      zoomSlider.value = String(Math.round(this.zoom * 100));
      const output = zoomSlider.closest('.range-field')?.querySelector('output');
      if (output) output.textContent = zoomText;
      this.syncRangeFills();
    }
    this.renderOverlay();
  }

  private setZoom(value: number, anchorClient?: { x: number; y: number }): void {
    if (!this.doc) return;
    this.fitMode = false;
    const next = clamp(value, 0.02, 16);
    if (Math.abs(next - this.zoom) < 0.0001) return;
    const viewportRect = this.viewport.getBoundingClientRect();
    const anchor = anchorClient ?? {
      x: viewportRect.left + this.viewport.clientWidth / 2,
      y: viewportRect.top + this.viewport.clientHeight / 2,
    };
    const before = this.display.getBoundingClientRect();
    const px = before.width > 0 ? (anchor.x - before.left) / before.width : 0.5;
    const py = before.height > 0 ? (anchor.y - before.top) / before.height : 0.5;
    this.zoom = next;
    this.applyZoom();
    const after = this.display.getBoundingClientRect();
    this.viewport.scrollLeft += after.left + px * after.width - anchor.x;
    this.viewport.scrollTop += after.top + py * after.height - anchor.y;
    this.invalidateDisplayRect();
  }

  private fitToView(): void {
    if (!this.doc) return;
    this.fitMode = true;
    const availableW = Math.max(80, this.viewport.clientWidth - 128);
    const availableH = Math.max(80, this.viewport.clientHeight - 128);
    const fit = Math.min(availableW / this.doc.width, availableH / this.doc.height);
    this.zoom = clamp(fit, 0.02, 8);
    this.applyZoom();
    this.viewport.scrollLeft = 0;
    this.viewport.scrollTop = 0;
    this.invalidateDisplayRect();
  }

  private zoomAtPoint(factor: number, clientX: number, clientY: number): void {
    this.setZoom(this.zoom * factor, { x: clientX, y: clientY });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Chrome / UI sync
  // ───────────────────────────────────────────────────────────────────────────

  private syncChrome(): void {
    const doc = this.doc;
    this.setText('doc-name', doc?.name ?? t('tabs.none'));
    this.setText(
      'doc-meta',
      doc ? `${doc.width} × ${doc.height} px · ${Math.round(doc.dpi)} ppp` : '—',
    );
    this.setText('doc-size', doc ? `${doc.width} × ${doc.height} px` : '—');
    this.setText('doc-dpi', doc ? `${Math.round(doc.dpi)} ppp` : '—');
    this.setText('doc-layers', doc ? String(doc.layers.length) : '—');

    const undo = this.node<HTMLButtonElement>('btn-undo');
    const redo = this.node<HTMLButtonElement>('btn-redo');
    undo.disabled = !this.history.canUndo;
    redo.disabled = !this.history.canRedo;
    undo.title = this.history.canUndo ? t('topbar.undoNamed', { name: this.history.undoLabel }) : t('topbar.undoTitle');
    redo.title = this.history.canRedo ? t('topbar.redoNamed', { name: this.history.redoLabel }) : t('topbar.redoTitle');

    this.node<HTMLButtonElement>('btn-export').disabled = !doc;
    this.node<HTMLButtonElement>('btn-open').disabled = false;

    const hasDoc = Boolean(doc);
    for (const id of ['layer-add', 'layer-duplicate', 'layer-delete', 'layer-up', 'layer-down', 'layer-mask']) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = !hasDoc;
    }
    const opacity = this.node<HTMLInputElement>('layer-opacity');
    opacity.disabled = !hasDoc || !this.activeLayer;
    this.node<HTMLSelectElement>('layer-blend').disabled = !hasDoc || !this.activeLayer;
    this.node<HTMLInputElement>('layer-name').disabled = !hasDoc || !this.activeLayer;

    this.syncLayerProps();
    this.updateStatus();
  }

  private syncLayerProps(): void {
    const layer = this.activeLayer;
    const nameInput = this.node<HTMLInputElement>('layer-name');
    const name = layer?.name ?? '';
    if (document.activeElement !== nameInput && nameInput.value !== name) nameInput.value = name;
    const opacity = this.node<HTMLInputElement>('layer-opacity');
    const percent = Math.round((layer?.opacity ?? 1) * 100);
    if (document.activeElement !== opacity && opacity.value !== String(percent)) {
      opacity.value = String(percent);
    }
    paintRange(opacity);
    const opacityLabel = `${percent} %`;
    if (this.statusCache.get('layer-opacity-value') !== opacityLabel) {
      this.statusCache.set('layer-opacity-value', opacityLabel);
      this.node<HTMLElement>('layer-opacity-value').textContent = opacityLabel;
    }
    const blend = this.node<HTMLSelectElement>('layer-blend');
    const blendValue = layer?.blend ?? 'source-over';
    if (blend.value !== blendValue) blend.value = blendValue;
    this.node<HTMLButtonElement>('layer-delete').disabled =
      !layer || (this.doc?.layers.length ?? 0) <= 1;
    this.syncMaskControls();
  }

  private syncMaskControls(): void {
    const layer = this.activeLayer;
    const controls = document.getElementById('mask-controls');
    if (controls) controls.hidden = !layer?.mask;
    const enabled = document.getElementById('layer-mask-enabled') as HTMLInputElement | null;
    if (enabled) {
      enabled.checked = layer?.maskEnabled !== false;
      enabled.disabled = !layer?.mask;
    }
    const edit = document.getElementById('layer-mask-edit') as HTMLButtonElement | null;
    if (edit) {
      edit.disabled = !layer?.mask;
      edit.textContent = layer?.maskEditing ? t('layers.backToPixels') : t('layers.paintMask');
    }
    const add = document.getElementById('layer-mask') as HTMLButtonElement | null;
    if (add) {
      add.disabled = !layer;
      add.title = layer?.mask ? t('layers.maskActiveHint') : t('layers.addMask');
    }
    const apply = document.getElementById('layer-mask-apply') as HTMLButtonElement | null;
    if (apply) apply.disabled = !layer?.mask;
    const remove = document.getElementById('layer-mask-delete') as HTMLButtonElement | null;
    if (remove) remove.disabled = !layer?.mask;
    this.display.classList.toggle('is-mask-editing', Boolean(layer?.mask && layer.maskEditing));
  }

  private createLayerRow(layer: Layer): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.dataset.layerId = layer.id;
    // La pile se pilote au clavier : une ligne porte le focus, donc Suppr,
    // Alt+flèches et les raccourcis de calque agissent sur elle.
    row.tabIndex = 0;
    row.setAttribute('role', 'option');
    const eye = document.createElement('button');
    eye.className = 'layer-eye';
    eye.dataset.layerAction = 'visibility';
    eye.dataset.state = 'hidden';

    // Vignette des pixels : cliquer dessus revient aux pixels quand on peignait
    // le masque (geste Photoshop).
    const pixelSlot = document.createElement('button');
    pixelSlot.className = 'layer-thumb-slot';
    pixelSlot.dataset.layerAction = 'pixels';
    const thumb = document.createElement('canvas');
    thumb.className = 'layer-thumb';
    thumb.width = 48;
    thumb.height = 48;
    pixelSlot.append(thumb);

    const maskSlot = document.createElement('button');
    maskSlot.className = 'layer-mask-slot';
    maskSlot.dataset.layerAction = 'mask';
    maskSlot.hidden = true;
    const maskThumb = document.createElement('canvas');
    maskThumb.className = 'layer-mask-thumb';
    maskThumb.width = 48;
    maskThumb.height = 48;
    maskSlot.append(maskThumb);

    const meta = document.createElement('div');
    meta.className = 'layer-meta';
    const name = document.createElement('span');
    name.className = 'layer-name';
    const kind = document.createElement('span');
    kind.className = 'layer-kind';
    meta.append(name, kind);

    const lock = document.createElement('button');
    lock.className = 'layer-lock';
    lock.dataset.layerAction = 'lock';

    row.append(eye, pixelSlot, maskSlot, meta, lock);
    return row;
  }

  /**
   * Mise à jour incrémentale : les lignes existantes sont réutilisées, seuls
   * les textes qui changent sont réécrits. Aucun innerHTML global pendant les
   * gestes — c'est ce qui garde le défilement et le dessin fluides.
   */
  private renderLayers(): void {
    const doc = this.doc;
    if (!doc) {
      if (this.layerRows.size > 0 || !this.layersList.querySelector('.empty-hint')) {
        this.layersList.innerHTML = `<div class="empty-hint">${escapeHtml(t('layers.empty'))}</div>`;
        this.layerRows.clear();
        this.layerOrderSignature = '';
      }
      return;
    }
    const empty = this.layersList.querySelector('.empty-hint');
    if (empty) empty.remove();

    const ordered = [...doc.layers].reverse();
    const alive = new Set(ordered.map((layer) => layer.id));
    for (const [id, row] of this.layerRows) {
      if (!alive.has(id)) {
        row.remove();
        this.layerRows.delete(id);
      }
    }
    // La sélection multiple ne peut pas référencer un calque disparu, et le
    // calque actif en fait toujours partie.
    for (const id of [...this.selectedLayerIds]) {
      if (!alive.has(id)) this.selectedLayerIds.delete(id);
    }
    if (doc.activeLayerId && alive.has(doc.activeLayerId)) this.selectedLayerIds.add(doc.activeLayerId);

    for (const layer of ordered) {
      let row = this.layerRows.get(layer.id);
      if (!row) {
        row = this.createLayerRow(layer);
        this.layerRows.set(layer.id, row);
      }
      row.classList.toggle('is-active', layer.id === doc.activeLayerId);
      row.classList.toggle('is-selected', this.selectedLayerIds.has(layer.id));
      row.classList.toggle('is-locked', Boolean(layer.locked));
      row.classList.toggle('is-hidden-layer', !layer.visible);
      row.setAttribute('aria-selected', String(this.selectedLayerIds.has(layer.id)));

      const eye = row.querySelector<HTMLButtonElement>('.layer-eye');
      if (eye) {
        const state = layer.visible ? 'visible' : 'hidden';
        if (eye.dataset.state !== state) {
          eye.dataset.state = state;
          eye.classList.toggle('is-off', !layer.visible);
          eye.innerHTML = icon(layer.visible ? 'eye' : 'eye-off');
          eye.title = layer.visible ? t('layers.hide') : t('layers.show');
          eye.setAttribute('aria-label', eye.title);
        }
      }

      const lock = row.querySelector<HTMLButtonElement>('.layer-lock');
      if (lock) {
        const state = layer.locked ? 'locked' : 'unlocked';
        if (lock.dataset.state !== state) {
          lock.dataset.state = state;
          lock.innerHTML = icon(layer.locked ? 'lock' : 'unlock');
          lock.title = layer.locked ? t('layers.unlock') : t('layers.lock');
          lock.setAttribute('aria-label', lock.title);
        }
      }

      const name = row.querySelector<HTMLElement>('.layer-name');
      if (name && name.textContent !== layer.name) {
        name.textContent = layer.name;
        name.title = layer.name;
      }
      const kind = row.querySelector<HTMLElement>('.layer-kind');
      const kindText = `${kindLabel(layer.kind)} · ${Math.round(layer.opacity * 100)} %`;
      if (kind && kind.textContent !== kindText) kind.textContent = kindText;

      const pixelSlot = row.querySelector<HTMLElement>('.layer-thumb-slot');
      if (pixelSlot) {
        pixelSlot.classList.toggle('is-editing', !(layer.mask && layer.maskEditing));
        pixelSlot.title = layer.mask && layer.maskEditing
          ? t('layers.pixelsHint')
          : `${layer.name} · ${t('layers.pixelsActive')}`;
        pixelSlot.setAttribute('aria-label', pixelSlot.title);
      }

      const slot = row.querySelector<HTMLElement>('.layer-mask-slot');
      const maskThumb = row.querySelector<HTMLCanvasElement>('.layer-mask-thumb');
      row.classList.toggle('is-mask', Boolean(layer.mask && layer.maskEditing));
      if (slot && maskThumb) {
        slot.hidden = !layer.mask;
        if (layer.mask) {
          drawMaskThumb(maskThumb, layer.mask);
          slot.classList.toggle('is-editing', Boolean(layer.maskEditing));
          slot.classList.toggle('is-disabled', layer.maskEnabled === false);
          slot.title =
            layer.maskEnabled === false
              ? t('layers.maskOffHint')
              : layer.maskEditing
                ? t('layers.maskEditingHint')
                : t('layers.maskHintShort');
          slot.setAttribute('aria-label', slot.title);
        }
      }
    }

    const signature = ordered.map((layer) => layer.id).join('|');
    if (signature !== this.layerOrderSignature) {
      const fragment = document.createDocumentFragment();
      for (const layer of ordered) {
        const row = this.layerRows.get(layer.id);
        if (row) fragment.appendChild(row);
      }
      this.layersList.appendChild(fragment);
      this.layerOrderSignature = signature;
    }

    const scale = Math.min(48 / doc.width, 48 / doc.height);
    const width = Math.max(1, doc.width * scale);
    const height = Math.max(1, doc.height * scale);
    for (const layer of ordered) {
      const thumb = this.layerRows.get(layer.id)?.querySelector<HTMLCanvasElement>('.layer-thumb');
      if (!thumb) continue;
      const ctx = thumb.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, thumb.width, thumb.height);
      ctx.drawImage(layer.canvas, (thumb.width - width) / 2, (thumb.height - height) / 2, width, height);
    }
    this.syncLayerProps();
  }

  private syncColors(): void {
    const primary = document.getElementById('primary-swatch');
    const secondary = document.getElementById('secondary-swatch');
    if (primary) primary.style.background = this.primaryColor;
    if (secondary) secondary.style.background = this.secondaryColor;
    const input = document.getElementById('primary-color-input') as HTMLInputElement | null;
    if (input) input.value = this.primaryColor;
    const input2 = document.getElementById('secondary-color-input') as HTMLInputElement | null;
    if (input2) input2.value = this.secondaryColor;
  }

  private updateStatus(): void {
    this.setText('status-tool', toolLabel(this.activeTool));
    this.setText(
      'status-pos',
      this.preferences.coordinates && this.pointerInside
        ? `x ${Math.round(this.pointer.x)} · y ${Math.round(this.pointer.y)}`
        : 'x — · y —',
    );
    this.setText('status-zoom', `${Math.round(this.zoom * 100)} %`);
    if (this.selection) {
      const bounds = selectionBounds(this.selection);
      const feather = selectionFeather(this.selection);
      const points =
        this.selection.type === 'poly'
          ? selectionRings(this.selection).reduce((total, ring) => total + ring.length, 0)
          : 0;
      const rounded = { w: Math.round(bounds.w), h: Math.round(bounds.h) };
      this.setText(
        'status-selection',
        feather
          ? points
            ? t('status.featherPoints', { ...rounded, n: points, f: feather })
            : t('status.feather', { ...rounded, f: feather })
          : points
            ? t('status.selectionPoints', { ...rounded, n: points })
            : t('status.selection', rounded),
      );
    } else {
      this.setText('status-selection', t('status.noSelection'));
    }
    this.setText('tool-hint', toolHint(this.activeTool));
    const layer = this.activeLayer;
    this.setText('status-layer', layer ? t('status.layer', { name: layer.name }) : t('status.noLayer'));
  }

  private syncCoordinatesVisibility(): void {
    const show = this.preferences.coordinates;
    const position = document.getElementById('status-pos');
    if (position) position.hidden = !show;
    const dot = document.getElementById('status-pos-dot');
    if (dot) dot.hidden = !show;
  }

  private setMessage(message: string, timeout = 2600): void {
    const node = byId('status-message');
    node.textContent = message;
    window.clearTimeout((this as unknown as { messageTimer?: number }).messageTimer);
    (this as unknown as { messageTimer?: number }).messageTimer = window.setTimeout(() => {
      node.textContent = t('status.ready');
    }, timeout);
  }

  private toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    const node = document.createElement('div');
    node.className = `toast toast-${kind}`;
    node.innerHTML = `${icon(kind === 'success' ? 'check' : kind === 'error' ? 'alert' : 'info')}<span>${escapeHtml(message)}</span>`;
    this.toastHost.appendChild(node);
    window.setTimeout(() => node.classList.add('is-leaving'), 2800);
    window.setTimeout(() => node.remove(), 3200);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tools / options
  // ───────────────────────────────────────────────────────────────────────────

  private setTool(tool: ToolId): void {
    this.closeCanvasMenu();
    if (this.adjustment) this.cancelAdjustment();
    if (tool !== 'crop' && this.pendingCrop) {
      this.pendingCrop = null;
    }
    if (this.activeTool === tool) {
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
        button.classList.toggle('is-active', button.dataset.tool === tool);
      }
      this.display.style.cursor = TOOLS[tool].cursor;
      this.renderToolOptions();
      this.renderOverlay();
      this.updateStatus();
      return;
    }
    // Quitter la plume termine proprement le tracé en cours.
    if (this.activeTool === 'pen' && tool !== 'pen' && this.penDrawing) this.commitPenPath();
    this.penDrawing = false;
    this.penHover = null;
    this.penCloseHover = false;
    this.penHoverAnchor = -1;
    this.activeTool = tool;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.classList.toggle('is-active', button.dataset.tool === tool);
    }
    this.display.style.cursor = TOOLS[tool].cursor;
    this.renderOverlay();
    this.renderToolOptions();
    this.updateStatus();
  }

  private renderToolOptions(): void {
    window.requestAnimationFrame(() => this.syncRangeFills());
    const body = byId('tool-options-body');
    const title = byId('tool-options-title');
    if (this.adjustment) {
      title.textContent = t("adjust." + this.adjustment.id);
      body.innerHTML = this.adjustmentOptionsHtml();
      if (this.adjustment.id === 'curves') this.wireCurveEditor();
      return;
    }
    title.textContent = toolLabel(this.activeTool);
    if (!this.doc) {
      body.innerHTML = `<div class="options-empty">
        <p>${t('opt.noDocument')}</p>
        <button class="btn primary sm" data-action="new-document">${t('opt.createDocument')}</button>
      </div>`;
      return;
    }
    switch (this.activeTool) {
      case 'select':
        body.innerHTML = this.selectOptionsHtml();
        break;
      case 'marquee':
        body.innerHTML = this.marqueeOptionsHtml();
        break;
      case 'magic-wand':
        body.innerHTML = this.wandOptionsHtml();
        break;
      case 'crop':
        body.innerHTML = this.cropOptionsHtml();
        break;
      case 'shapes':
        body.innerHTML = this.shapesOptionsHtml();
        break;
      case 'pen':
        body.innerHTML = this.penOptionsHtml();
        break;
      case 'text':
        body.innerHTML = this.textOptionsHtml();
        break;
      case 'pencil':
      case 'brush':
      case 'eraser':
        body.innerHTML = this.paintOptionsHtml();
        break;
      case 'stamp':
        body.innerHTML = this.stampOptionsHtml();
        break;
      case 'patch':
        body.innerHTML = this.patchOptionsHtml();
        break;
      case 'heal':
        body.innerHTML = this.healOptionsHtml();
        break;
      case 'spotlight':
        body.innerHTML = this.spotlightOptionsHtml();
        break;
      case 'eyedropper':
        body.innerHTML = this.eyedropperOptionsHtml();
        break;
      case 'gradient':
        body.innerHTML = this.gradientOptionsHtml();
        break;
      case 'zoom':
        body.innerHTML = this.zoomOptionsHtml();
        break;
      case 'hand':
        body.innerHTML = `<p class="options-hint">${escapeHtml(t('tool.hand.options'))}</p>`;
        break;
    }
  }

  private selectOptionsHtml(): string {
    const layer = this.activeLayer;
    return `
      <p class="options-hint">${escapeHtml(toolHint('select'))}</p>
      <div class="option-card">
        <span class="option-card-label">${escapeHtml(t('opt.activeLayer'))}</span>
        <strong>${layer ? escapeHtml(layer.name) : '—'}</strong>
        <span class="option-card-sub">${layer ? kindLabel(layer.kind) : escapeHtml(t('opt.pickLayer'))}</span>
      </div>
      ${this.featherFieldHtml()}
      <div class="button-row">
        <button class="btn ghost sm" data-action="fill-selection" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.fill'))}</button>
        <button class="btn ghost sm" data-action="deselect" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.deselect'))}</button>
      </div>
      <p class="options-hint">${escapeHtml(t('opt.featherScope'))}</p>`;
  }

  private marqueeOptionsHtml(): string {
    const mode = this.marqueeMode;
    return `
      <div class="segmented" data-marquee-mode>
        <button data-marquee="rect" class="${mode === 'rect' ? 'is-active' : ''}">${escapeHtml(t('opt.rect'))}</button>
        <button data-marquee="ellipse" class="${mode === 'ellipse' ? 'is-active' : ''}">${escapeHtml(t('opt.ellipse'))}</button>
        <button data-marquee="lasso" class="${mode === 'lasso' ? 'is-active' : ''}">${escapeHtml(t('opt.lasso'))}</button>
      </div>
      ${this.featherFieldHtml()}
      <div class="button-row">
        <button class="btn ghost sm" data-action="select-all">${escapeHtml(t('opt.selectAll'))}</button>
        <button class="btn ghost sm" data-action="deselect" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.deselect'))}</button>
        <button class="btn ghost sm" data-action="invert-selection" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.invert'))}</button>
        <button class="btn ghost sm" data-action="fill-selection" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.fill'))}</button>
      </div>
      <p class="options-hint">${escapeHtml(this.selection ? t('opt.selectionHint') : t('opt.noSelection'))}</p>`;
  }

  /** Feather radius, shared by the marquee and the magic wand. */
  private featherFieldHtml(): string {
    const feather = Math.round(this.selectionFeather);
    return `
      <label class="range-field">${escapeHtml(t('opt.feather'))} <output data-feather-output>${feather} px</output>
        <input type="range" min="0" max="120" step="1" data-feather-field value="${feather}">
      </label>`;
  }

  private wandOptionsHtml(): string {
    const wand = this.wand;
    return `
      <label class="range-field">${escapeHtml(t('opt.tolerance'))} <output data-wand-output="tolerance">${wand.tolerance}</output>
        <input type="range" min="0" max="128" step="1" data-wand-field="tolerance" value="${wand.tolerance}">
      </label>
      <label class="check-field"><input type="checkbox" data-wand-field="contiguous" ${wand.contiguous ? 'checked' : ''}> ${escapeHtml(t('opt.contiguous'))}</label>
      <label class="check-field"><input type="checkbox" data-wand-field="merged" ${wand.merged ? 'checked' : ''}> ${escapeHtml(t('opt.sampleMerged'))}</label>
      ${this.featherFieldHtml()}
      <div class="button-row">
        <button class="btn ghost sm" data-action="deselect" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.deselect'))}</button>
        <button class="btn ghost sm" data-action="invert-selection" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.invert'))}</button>
        <button class="btn ghost sm" data-action="fill-selection" ${this.selection ? '' : 'disabled'}>${escapeHtml(t('opt.fill'))}</button>
      </div>
      <p class="options-hint">${escapeHtml(toolHint('magic-wand'))}</p>`;
  }

  private spotlightOptionsHtml(): string {
    const spot = this.spotlight;
    return `
      <label class="range-field">${escapeHtml(t('opt.diameter'))} <output data-spot-output="diameter">${Math.round(spot.diameter)} px</output>
        <input type="range" min="20" max="2400" step="10" data-spot-field="diameter" value="${spot.diameter}">
      </label>
      <label class="range-field">${escapeHtml(t('opt.intensity'))} <output data-spot-output="intensity">${spot.intensity} %</output>
        <input type="range" min="1" max="100" step="1" data-spot-field="intensity" value="${spot.intensity}">
      </label>
      <label class="range-field">${escapeHtml(t('opt.softness'))} <output data-spot-output="softness">${spot.softness} %</output>
        <input type="range" min="0" max="100" step="1" data-spot-field="softness" value="${spot.softness}">
      </label>
      <p class="options-hint">${escapeHtml(t('opt.spotHint'))}</p>`;
  }

  private paintTargetHtml(): string {
    const layer = this.activeLayer;
    if (!layer) return '';
    const label = escapeHtml(t('opt.target'));
    return layer.mask && layer.maskEditing
      ? `<div class="option-card"><span class="option-card-label">${label}</span><strong>${escapeHtml(t('opt.maskTarget', { name: layer.name }))}</strong><span class="option-card-sub">${escapeHtml(t('opt.maskTargetHint'))}</span></div>`
      : `<div class="option-card"><span class="option-card-label">${label}</span><strong>${escapeHtml(t('opt.pixelsTarget', { name: layer.name }))}</strong><span class="option-card-sub">${kindLabel(layer.kind)}</span></div>`;
  }

  private brushSlidersHtml(brush: BrushSettings, { min = 1, max = 600 } = {}): string {
    return `
      <label class="range-field">${escapeHtml(t('opt.size'))} <output data-paint-output="size">${brush.size} px</output>
        <input type="range" min="${min}" max="${max}" step="1" data-paint-field="size" value="${Math.min(max, brush.size)}">
      </label>
      <label class="range-field">${escapeHtml(t('opt.hardness'))} <output data-paint-output="hardness">${Math.round(brush.hardness * 100)} %</output>
        <input type="range" min="0" max="100" step="1" data-paint-field="hardness" value="${Math.round(brush.hardness * 100)}">
      </label>
      <label class="range-field">${escapeHtml(t('opt.opacity'))} <output data-paint-output="opacity">${Math.round(brush.opacity * 100)} %</output>
        <input type="range" min="1" max="100" step="1" data-paint-field="opacity" value="${Math.round(brush.opacity * 100)}">
      </label>`;
  }

  private paintOptionsHtml(): string {
    const brush = this.brush;
    if (this.activeTool === 'pencil') {
      return `
        <label class="range-field">${escapeHtml(t('opt.thickness'))} <output data-paint-output="pencilSize">${this.pencilOptions.size} px</output>
          <input type="range" min="1" max="48" step="1" data-paint-field="pencilSize" value="${this.pencilOptions.size}">
        </label>
        <label class="range-field">${escapeHtml(t('opt.opacity'))} <output data-paint-output="pencilOpacity">${this.pencilOptions.opacity} %</output>
          <input type="range" min="1" max="100" step="1" data-paint-field="pencilOpacity" value="${this.pencilOptions.opacity}">
        </label>
        ${this.paintTargetHtml()}
        <p class="options-hint">${escapeHtml(toolHint('pencil'))}</p>`;
    }
    const erase = this.activeTool === 'eraser';
    return `
      ${this.brushSlidersHtml(brush)}
      <div class="segmented" data-brush-presets>
        <button data-brush-size="8">8</button>
        <button data-brush-size="24">24</button>
        <button data-brush-size="56">56</button>
        <button data-brush-size="120">120</button>
        <button data-brush-size="280">280</button>
      </div>
      <label class="range-field">${escapeHtml(t('opt.spacing'))} <output data-paint-output="spacing">${Math.round(brush.spacing * 100)} %</output>
        <input type="range" min="2" max="80" step="1" data-paint-field="spacing" value="${Math.round(brush.spacing * 100)}">
      </label>
      ${this.paintTargetHtml()}
      <p class="options-hint">${escapeHtml(erase ? toolHint('eraser') : t('opt.brushHint'))}</p>`;
  }

  private stampOptionsHtml(): string {
    const brush = this.brush;
    const source = this.stampSource;
    return `
      ${this.brushSlidersHtml(brush)}
      <label class="check-field"><input type="checkbox" data-patch-field="corrector" ${this.patchOptions.corrector ? 'checked' : ''}> ${escapeHtml(t('opt.correctorHint'))}</label>
      <div class="option-card">
        <span class="option-card-label">${escapeHtml(t('opt.source'))}</span>
        <strong>${source ? escapeHtml(t('opt.sourceSet', { x: Math.round(source.x), y: Math.round(source.y) })) : escapeHtml(t('common.undefined'))}</strong>
        <span class="option-card-sub">${escapeHtml(t('opt.sourceUnset'))}</span>
      </div>
      ${this.paintTargetHtml()}
      <p class="options-hint">${escapeHtml(toolHint('stamp'))}</p>`;
  }

  private patchOptionsHtml(): string {
    const rect = this.patchSourceRect;
    return `
      <label class="check-field"><input type="checkbox" data-patch-field="corrector" ${this.patchOptions.corrector ? 'checked' : ''}> ${escapeHtml(t('opt.correctorHint'))}</label>
      <div class="option-card">
        <span class="option-card-label">${escapeHtml(t('opt.patchArea'))}</span>
        <strong>${rect ? `${Math.round(rect.w)} × ${Math.round(rect.h)} px` : escapeHtml(t('common.noneF'))}</strong>
        <span class="option-card-sub">${escapeHtml(rect ? t('opt.patchReadyText') : t('opt.patchEmpty'))}</span>
      </div>
      <div class="button-row">
        <button class="btn ghost sm" data-action="clear-patch" ${rect ? '' : 'disabled'}>${escapeHtml(t('opt.clear'))}</button>
      </div>
      <p class="options-hint">${escapeHtml(t('opt.patchHint'))}</p>`;
  }

  private healOptionsHtml(): string {
    const brush = this.brush;
    return `
      ${this.brushSlidersHtml(brush, { min: 4, max: 300 })}
      ${this.paintTargetHtml()}
      <p class="options-hint">${escapeHtml(toolHint('heal'))}</p>`;
  }

  private cropOptionsHtml(): string {
    const ratios = [
      { value: '', label: t('opt.free') },
      { value: '1', label: t('opt.square11') },
      { value: '1.333333', label: '4:3' },
      { value: '1.777778', label: '16:9' },
      { value: '1.5', label: '3:2' },
      { value: '0.8', label: '4:5' },
    ];
    const current = this.cropRatio === null ? '' : String(this.cropRatio);
    return `
      <label class="field-label">${escapeHtml(t('opt.ratio'))}
        <select data-crop-ratio>
          ${ratios.map((ratio) => `<option value="${ratio.value}" ${ratio.value === current ? 'selected' : ''}>${escapeHtml(ratio.label)}</option>`).join('')}
        </select>
      </label>
      <div class="button-row">
        <button class="btn primary sm" data-action="apply-crop" ${this.pendingCrop ? '' : 'disabled'}>${escapeHtml(t('common.apply'))}</button>
        <button class="btn ghost sm" data-action="cancel-crop" ${this.pendingCrop ? '' : 'disabled'}>${escapeHtml(t('common.cancel'))}</button>
      </div>
      <p class="options-hint">${escapeHtml(toolHint('crop'))}</p>`;
  }

  private shapesOptionsHtml(): string {
    const options = this.shapeOptions;
    return `
      <label class="field-label">${escapeHtml(t('opt.shapeType'))}
        <select data-shape-field="type">
          ${[
            { value: 'rectangle', label: t('opt.rect') },
            { value: 'ellipse', label: t('opt.ellipse') },
            { value: 'triangle', label: t('opt.triangle') },
            { value: 'star', label: t('opt.star') },
            { value: 'line', label: t('opt.line') },
          ]
            .map((item) => `<option value="${item.value}" ${options.type === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`)
            .join('')}
        </select>
      </label>
      <div class="dual-colors">
        <label class="color-field"><span>${escapeHtml(t('opt.fillColor'))}</span><input type="color" data-shape-field="fill" value="${options.fill}"></label>
        <label class="color-field"><span>${escapeHtml(t('opt.strokeColor'))}</span><input type="color" data-shape-field="stroke" value="${options.stroke}"></label>
      </div>
      <label class="range-field">${escapeHtml(t('opt.strokeWidth'))} <output data-shape-output="strokeWidth">${options.strokeWidth} px</output>
        <input type="range" min="0" max="40" step="1" data-shape-field="strokeWidth" value="${options.strokeWidth}">
      </label>
      <label class="range-field">${escapeHtml(t('opt.radius'))} <output data-shape-output="radius">${options.radius} px</output>
        <input type="range" min="0" max="120" step="1" data-shape-field="radius" value="${options.radius}">
      </label>
      <label class="check-field"><input type="checkbox" data-shape-field="newLayer" ${options.newLayer ? 'checked' : ''}> ${escapeHtml(t('opt.newLayer'))}</label>`;
  }

  private penOptionsHtml(): string {
    const layer = this.activePathLayer;
    const path = layer?.path;
    return `
      <div class="button-row">
        <button class="btn primary sm" data-action="new-path">${escapeHtml(t('opt.newPath'))}</button>
        <button class="btn ghost sm" data-action="finish-path" ${path && path.anchors.length > 0 ? '' : 'disabled'}>${escapeHtml(t('opt.finishPath'))}</button>
        <button class="btn ghost sm" data-action="close-path" ${path && path.anchors.length > 1 && !path.closed ? '' : 'disabled'}>${escapeHtml(t('opt.closePath'))}</button>
        <button class="btn ghost sm" data-action="delete-anchor" ${path && path.anchors.length > 0 ? '' : 'disabled'}>${escapeHtml(t('opt.deleteAnchor'))}</button>
      </div>
      <div class="dual-colors">
        <label class="check-field"><input type="checkbox" data-path-field="fillEnabled" ${path?.fill ? 'checked' : ''}> ${escapeHtml(t('opt.fillColor'))}</label>
        <label class="color-field"><span>${escapeHtml(t('adjust.color'))}</span><input type="color" data-path-field="fill" value="${path?.fill ?? this.primaryColor}"></label>
      </div>
      <div class="dual-colors">
        <label class="check-field"><input type="checkbox" data-path-field="strokeEnabled" ${path?.stroke ? 'checked' : ''}> ${escapeHtml(t('opt.strokeColor'))}</label>
        <label class="color-field"><span>${escapeHtml(t('adjust.color'))}</span><input type="color" data-path-field="stroke" value="${path?.stroke ?? this.primaryColor}"></label>
      </div>
      <label class="range-field">${escapeHtml(t('opt.thickness'))} <output>${Math.round(path?.strokeWidth ?? this.pathOptions.strokeWidth)} px</output>
        <input type="range" min="1" max="40" step="1" data-path-field="strokeWidth" value="${Math.round(path?.strokeWidth ?? this.pathOptions.strokeWidth)}">
      </label>
      <p class="options-hint">${escapeHtml(path ? t('opt.pathHint', { n: path.anchors.length }) : t('tool.pen.hint'))}</p>`;
  }

  private textOptionsHtml(): string {
    const layer = this.activeTextLayer;
    const text = layer?.text;
    const family = text?.fontFamily ?? this.textOptions.fontFamily;
    const size = text?.fontSize ?? this.textOptions.fontSize;
    const weight = text?.fontWeight ?? this.textOptions.fontWeight;
    const align = text?.align ?? this.textOptions.align;
    return `
      <label class="field-label">${escapeHtml(t('opt.content'))}
        <textarea data-text-field="content" rows="4" placeholder="${escapeHtml(t('opt.placeholder'))}">${escapeHtml(text?.content ?? '')}</textarea>
      </label>
      <div class="inline-fields">
        <label class="field-label">${escapeHtml(t('opt.font'))}
          <select data-text-field="fontFamily">
            ${FONT_FAMILIES.map((font) => `<option value="${font}" ${font === family ? 'selected' : ''}>${font}</option>`).join('')}
          </select>
        </label>
        <label class="field-label">${escapeHtml(t('opt.size'))}
          <input type="number" min="4" max="800" step="1" data-text-field="fontSize" value="${Math.round(size)}">
        </label>
      </div>
      <div class="inline-fields">
        <label class="field-label">${escapeHtml(t('opt.weight'))}
          <select data-text-field="fontWeight">
            ${[300, 400, 500, 600, 700, 800, 900].map((value) => `<option value="${value}" ${value === weight ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
        </label>
        <label class="field-label">${escapeHtml(t('adjust.color'))}
          <input type="color" data-text-field="color" value="${text?.color ?? this.primaryColor}">
        </label>
      </div>
      <div class="segmented" data-text-align>
        ${(['left', 'center', 'right'] as const)
          .map((value) => `<button data-align="${value}" class="${align === value ? 'is-active' : ''}">${escapeHtml(t(`opt.${value}`))}</button>`)
          .join('')}
      </div>
      <p class="options-hint">${escapeHtml(toolHint('text'))}</p>`;
  }

  private eyedropperOptionsHtml(): string {
    return `
      <div class="swatch-preview">
        <span class="big-swatch" style="background:${this.primaryColor}"></span>
        <div><strong>${this.primaryColor.toUpperCase()}</strong><span>${escapeHtml(t('topbar.primary'))}</span></div>
      </div>
      <p class="options-hint">${escapeHtml(toolHint('eyedropper'))}</p>`;
  }

  private gradientOptionsHtml(): string {
    const options = this.gradientOptions;
    return `
      <div class="segmented" data-gradient-type>
        <button data-gradient="linear" class="${options.type === 'linear' ? 'is-active' : ''}">${escapeHtml(t('opt.linear'))}</button>
        <button data-gradient="radial" class="${options.type === 'radial' ? 'is-active' : ''}">${escapeHtml(t('opt.radial'))}</button>
      </div>
      <label class="field-label">${escapeHtml(t('opt.colors'))}
        <select data-gradient-field="colors">
          <option value="fg-transparent" ${options.colors === 'fg-transparent' ? 'selected' : ''}>${escapeHtml(t('opt.fgTransparent'))}</option>
          <option value="fg-bg" ${options.colors === 'fg-bg' ? 'selected' : ''}>${escapeHtml(t('opt.fgBg'))}</option>
          <option value="bg-transparent" ${options.colors === 'bg-transparent' ? 'selected' : ''}>${escapeHtml(t('opt.bgTransparent'))}</option>
        </select>
      </label>
      <div class="gradient-preview" style="--fg:${this.primaryColor};--bg:${this.secondaryColor}"></div>
      <label class="range-field">${escapeHtml(t('opt.opacity'))} <output data-gradient-output>${options.opacity} %</output>
        <input type="range" min="0" max="100" step="1" data-gradient-field="opacity" value="${options.opacity}">
      </label>
      <label class="check-field"><input type="checkbox" data-gradient-field="newLayer" ${options.newLayer ? 'checked' : ''}> ${escapeHtml(t('opt.newLayer'))}</label>
      <p class="options-hint">${escapeHtml(toolHint('gradient'))}</p>`;
  }

  private zoomOptionsHtml(): string {
    return `
      <div class="button-grid">
        <button class="btn ghost sm" data-action="zoom-fit">${escapeHtml(t('stage.zoomFitShort'))}</button>
        <button class="btn ghost sm" data-action="zoom-100">100 %</button>
        <button class="btn ghost sm" data-action="zoom-200">200 %</button>
        <button class="btn ghost sm" data-action="zoom-400">400 %</button>
      </div>
      <label class="range-field">${escapeHtml(t('opt.zoomLevel'))} <output>${Math.round(this.zoom * 100)} %</output>
        <input type="range" min="2" max="1600" step="1" data-zoom-slider value="${Math.round(this.zoom * 100)}">
      </label>
      <p class="options-hint">${escapeHtml(t('opt.zoomHint'))}</p>`;
  }

  private adjustmentOptionsHtml(): string {
    const adjustment = this.adjustment;
    if (!adjustment) return '';
    const params = ADJUSTMENT_PARAMS[adjustment.id];
    let controls = '';
    if (adjustment.id === 'curves') {
      controls = `
        <div class="segmented channel-tabs" data-curve-channel>
          ${(['rgb', 'r', 'g', 'b'] as const)
            .map((channel) => `<button data-channel="${channel}" class="${this.curveChannel === channel ? 'is-active' : ''}">${channel.toUpperCase()}</button>`)
            .join('')}
        </div>
        <div class="curve-shell">
          <svg class="curve-editor" id="curve-editor" viewBox="0 0 256 256" preserveAspectRatio="none" aria-label="${escapeHtml(t('adjust.curves'))}">
            <rect x="0" y="0" width="256" height="256" class="curve-bg"></rect>
            <path id="curve-histogram" class="curve-histogram" d="${histogramPath(adjustment.histogram[this.curveChannel === 'rgb' ? 'rgb' : this.curveChannel])}"></path>
            ${[1, 2, 3].map((i) => `<line x1="${i * 64}" y1="0" x2="${i * 64}" y2="256" class="curve-grid"/>`).join('')}
            ${[1, 2, 3].map((i) => `<line x1="0" y1="${i * 64}" x2="256" y2="${i * 64}" class="curve-grid"/>`).join('')}
            <line x1="0" y1="256" x2="256" y2="0" class="curve-diagonal"></line>
            <path id="curve-path" class="curve-path" d=""></path>
            <g id="curve-points"></g>
          </svg>
        </div>
        <div class="button-grid">
          <button class="btn ghost sm" data-action="curve-linear">${escapeHtml(t('opt.curveLinear'))}</button>
          <button class="btn ghost sm" data-action="curve-contrast">${escapeHtml(t('opt.curveContrast'))}</button>
          <button class="btn ghost sm" data-action="curve-bright">${escapeHtml(t('opt.curveBright'))}</button>
        </div>
        <p class="options-hint">${escapeHtml(t('opt.curveHint'))}</p>`;
    } else {
      const levelHistogram = adjustment.id === 'levels'
        ? `<div class="levels-histogram">
             <svg viewBox="0 0 256 64" preserveAspectRatio="none" aria-hidden="true">
               <path class="hist-r" d="${histogramPath(adjustment.histogram.r, 256, 64)}"></path>
               <path class="hist-g" d="${histogramPath(adjustment.histogram.g, 256, 64)}"></path>
               <path class="hist-b" d="${histogramPath(adjustment.histogram.b, 256, 64)}"></path>
             </svg>
           </div>`
        : '';
      controls = levelHistogram + params
        .map((param) => {
          const value = adjustment.params[param.key] ?? param.default;
          return `
            <label class="range-field">
              <span>${escapeHtml(t(`adjust.${param.key}`))}</span>
              <output data-adjust-output="${param.key}">${this.formatParam(value, param)}</output>
              <input type="range" min="${param.min}" max="${param.max}" step="${param.step}" data-adjust-param="${param.key}" value="${value}">
            </label>`;
        })
        .join('');
    }
    return `
      <div class="adjust-head">
        <span class="live-badge"><span class="live-dot"></span>${escapeHtml(t('adjust.liveShort'))}</span>
        <div class="button-row compact">
          <button class="btn primary sm" data-action="apply-adjustment">${escapeHtml(t('common.apply'))}</button>
          <button class="btn ghost sm" data-action="cancel-adjustment">${escapeHtml(t('common.cancel'))}</button>
          <button class="btn ghost sm" data-action="reset-adjustment" title="${escapeHtml(t('common.reset'))}">↺</button>
        </div>
      </div>
      ${controls}`;
  }

  private formatParam(value: number, param: { step: number; unit?: string }): string {
    const decimals = param.step < 0.1 ? 2 : param.step < 1 ? 1 : 0;
    return `${value.toFixed(decimals)}${param.unit ? ` ${param.unit}` : ''}`;
  }

  private syncRangeFills(): void {
    paintRanges(document);
  }

  private bindTopbar(): void {
    byId<HTMLButtonElement>('btn-new').addEventListener('click', () => this.openNewDocumentDialog());
    byId<HTMLButtonElement>('btn-open').addEventListener('click', () => void this.openImageFlow());
    byId<HTMLButtonElement>('btn-export').addEventListener('click', () => this.openExportDialog());
    byId<HTMLButtonElement>('btn-undo').addEventListener('click', () => this.undo());
    byId<HTMLButtonElement>('btn-redo').addEventListener('click', () => this.redo());
    byId<HTMLButtonElement>('zoom-in').addEventListener('click', () => this.setZoom(this.zoom * 1.25));
    byId<HTMLButtonElement>('zoom-out').addEventListener('click', () => this.setZoom(this.zoom / 1.25));
    byId<HTMLButtonElement>('zoom-fit').addEventListener('click', () => this.fitToView());
    byId<HTMLButtonElement>('zoom-value').addEventListener('click', () => this.setZoom(1));
    this.bindFullscreen();

    byId<HTMLButtonElement>('primary-swatch').addEventListener('click', () => {
      byId<HTMLInputElement>('primary-color-input').click();
    });
    byId<HTMLButtonElement>('secondary-swatch').addEventListener('click', () => {
      byId<HTMLInputElement>('secondary-color-input').click();
    });
    byId<HTMLInputElement>('primary-color-input').addEventListener('input', (event) => {
      this.primaryColor = (event.target as HTMLInputElement).value;
      this.syncColors();
      if (this.activeTool === 'gradient' || this.activeTool === 'eyedropper') this.renderToolOptions();
    });
    byId<HTMLInputElement>('secondary-color-input').addEventListener('input', (event) => {
      this.secondaryColor = (event.target as HTMLInputElement).value;
      this.syncColors();
      if (this.activeTool === 'gradient') this.renderToolOptions();
    });
    byId<HTMLButtonElement>('swap-colors').addEventListener('click', () => {
      const swap = this.primaryColor;
      this.primaryColor = this.secondaryColor;
      this.secondaryColor = swap;
      this.syncColors();
      this.renderToolOptions();
    });

    byId<HTMLButtonElement>('btn-preferences').addEventListener('click', () => this.openPreferences());
    byId<HTMLButtonElement>('btn-theme-toggle').addEventListener('click', () => this.toggleTheme());

    byId<HTMLButtonElement>('btn-toggle-left').addEventListener('click', () => {
      this.app.classList.toggle('hide-left');
      this.invalidateDisplayRect();
      window.setTimeout(() => {
        if (this.fitMode) this.fitToView();
      }, 80);
    });
    byId<HTMLButtonElement>('btn-toggle-right').addEventListener('click', () => {
      this.app.classList.toggle('hide-right');
      this.invalidateDisplayRect();
      window.setTimeout(() => {
        if (this.fitMode) this.fitToView();
      }, 80);
    });

    let resizeFrame = 0;
    window.addEventListener(
      'resize',
      () => {
        this.invalidateDisplayRect();
        if (!this.preferences.autoFit || !this.fitMode) return;
        if (resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          this.fitToView();
        });
      },
      { passive: true },
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Preferences
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // Greffons
  // ───────────────────────────────────────────────────────────────────────────

  /** L'icône de la barre supérieure n'existe que si un greffon est actif. */
  private syncPluginChrome(): void {
    const button = document.getElementById('btn-plugins') as HTMLButtonElement | null;
    const separator = document.getElementById('plugins-sep') as HTMLElement | null;
    const enabled = activePlugins(this.pluginState);
    const visible = enabled.length > 0;
    if (button) {
      button.hidden = !visible;
      button.classList.toggle('is-enabled', visible);
      button.title = visible
        ? `${enabled.map((plugin) => plugin.name).join(' · ')} (Ctrl+Alt+E)`
        : t('topbar.plugins');
      button.setAttribute('aria-label', button.title);
    }
    // Le trait sépare visuellement le greffon du groupe Export / Préférences.
    if (separator) separator.hidden = !visible;
    if (!visible && this.pluginSession) this.cancelPlugin();
    this.renderPreferencesPlugins();
  }

  private bindPluginDialog(): void {
    this.node<HTMLButtonElement>('btn-plugins').addEventListener('click', () => {
      if (this.pluginSession) this.cancelPlugin();
      else this.openPluginPanel();
    });
    this.node<HTMLButtonElement>('plugin-close').addEventListener('click', () => this.cancelPlugin());
    this.node<HTMLButtonElement>('plugin-cancel').addEventListener('click', () => this.cancelPlugin());
    this.node<HTMLButtonElement>('plugin-apply').addEventListener('click', () => this.applyPluginEffect());
    this.node<HTMLButtonElement>('plugin-reset').addEventListener('click', () => this.resetPluginEffect());
    this.node<HTMLElement>('plugin-effects').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-effect]');
      if (!button?.dataset.effect) return;
      this.selectPluginEffect(button.dataset.effect);
    });
    this.node<HTMLElement>('plugin-params').addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement | null;
      const key = input?.dataset.pluginParam;
      if (!key || !this.pluginSession) return;
      this.pluginSession.params[key] = Number(input.value);
      const output = input.closest('.range-field')?.querySelector('output');
      if (output) output.textContent = `${input.value}${this.pluginParamUnit(key)}`;
      this.syncRangeFills();
      this.schedulePluginPreview();
    });
    window.addEventListener(PLUGINS_EVENT, () => this.syncPluginChrome());
    this.syncPluginChrome();
  }

  private pluginParamUnit(key: string): string {
    const session = this.pluginSession;
    if (!session) return '';
    const effect = findEffect(session.pluginId, session.effectId);
    const param = effect?.params.find((item) => item.key === key);
    return param?.unit ?? '';
  }

  private pluginForChrome(): SuperPhotoPlugin | null {
    const enabled = activePlugins(this.pluginState);
    return enabled[0] ?? findPlugin(PLUGINS[0]?.id ?? '') ?? null;
  }

  /**
   * Ouvre la trappe des greffons à droite. Elle prend la place d'une colonne du
   * plan de travail : la toile rétrécit au lieu d'être recouverte, et le zoom /
   * plein écran ancrés en bas à droite suivent automatiquement.
   */
  private openPluginPanel(): void {
    const plugin = this.pluginForChrome();
    if (!plugin) {
      this.toast(t('plugin.none'), 'info');
      return;
    }
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) {
      this.toast(t('msg.openFirst'), 'error');
      return;
    }
    if (this.adjustment) this.cancelAdjustment();
    if (layer.mask && layer.maskEditing) {
      layer.maskEditing = false;
      this.layersDirty = true;
    }
    const ctx = canvasContext(layer.canvas);
    const original = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    const previewScale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(layer.canvas.width, layer.canvas.height));
    const previewCanvas = createCanvas(
      Math.max(1, Math.round(layer.canvas.width * previewScale)),
      Math.max(1, Math.round(layer.canvas.height * previewScale)),
    );
    let preview = original;
    if (previewScale < 1) {
      const previewContext = canvasContext(previewCanvas);
      previewContext.imageSmoothingQuality = 'medium';
      previewContext.drawImage(layer.canvas, 0, 0, previewCanvas.width, previewCanvas.height);
      preview = previewContext.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    }
    const effect = plugin.effects[0];
    if (!effect) return;
    this.pluginSession = {
      pluginId: plugin.id,
      effectId: effect.id,
      layerId: layer.id,
      params: this.effectDefaults(plugin, effect),
      original,
      preview,
      previewScale,
      previewCanvas,
    };
    this.pluginLastPreviewAt = 0;
    this.node('plugin-kicker').textContent = `${plugin.name.toUpperCase()} · v${plugin.version}`;
    this.node('plugin-title').textContent = plugin.name;
    this.pluginPanel.hidden = false;
    this.app.classList.add('plugins-open');
    this.node<HTMLButtonElement>('btn-plugins').classList.add('is-active');
    this.renderPluginEffects();
    this.selectPluginEffect(effect.id);
    // La colonne fait rétrécir la toile : on recadre si l'ajustement automatique
    // est actif, pour ne pas laisser l'image sortir du cadre.
    this.invalidateDisplayRect();
    window.setTimeout(() => {
      if (this.fitMode) this.fitToView();
    }, 80);
  }

  private effectDefaults(plugin: SuperPhotoPlugin, effect: PluginEffect): Record<string, number> {
    const params: Record<string, number> = {};
    for (const param of effect.params) params[param.key] = param.default;
    void plugin;
    return params;
  }

  private renderPluginEffects(): void {
    const session = this.pluginSession;
    const plugin = session ? findPlugin(session.pluginId) : null;
    const host = this.node<HTMLElement>('plugin-effects');
    if (!plugin || !host) return;
    host.innerHTML = plugin.effects
      .map(
        (effect) => `
          <button class="plugin-effect${effect.id === session?.effectId ? ' is-active' : ''}"
                  role="option" aria-selected="${effect.id === session?.effectId}"
                  data-effect="${effect.id}">
            <span class="plugin-effect-name">${escapeHtml(t(effect.nameKey))}</span>
            <span class="plugin-effect-desc">${escapeHtml(t(effect.descKey))}</span>
          </button>`,
      )
      .join('');
  }

  private selectPluginEffect(effectId: string): void {
    const session = this.pluginSession;
    if (!session) return;
    const effect = findEffect(session.pluginId, effectId);
    if (!effect) return;
    session.effectId = effect.id;
    session.params = this.effectDefaults(findPlugin(session.pluginId)!, effect);
    this.renderPluginEffects();
    this.node('plugin-effect-name').textContent = t(effect.nameKey);
    this.node('plugin-effect-desc').textContent = t(effect.descKey);
    const layer = this.doc?.layers.find((item) => item.id === session.layerId);
    this.node('plugin-target').textContent = t('plugin.target', { name: layer?.name ?? '—' });
    this.renderPluginParams(effect);
    this.schedulePluginPreview();
  }

  private renderPluginParams(effect: PluginEffect): void {
    const host = this.node<HTMLElement>('plugin-params');
    const session = this.pluginSession;
    if (!host || !session) return;
    host.innerHTML = effect.params
      .map((param) => {
        const value = session.params[param.key] ?? param.default;
        return `
          <label class="range-field">
            <span>${escapeHtml(t(param.labelKey))}</span>
            <output>${value}${param.unit ?? ''}</output>
            <input type="range" min="${param.min}" max="${param.max}" step="${param.step}"
                   data-plugin-param="${param.key}" value="${value}">
          </label>`;
      })
      .join('');
    this.syncRangeFills();
  }

  private resetPluginEffect(): void {
    const session = this.pluginSession;
    if (!session) return;
    const plugin = findPlugin(session.pluginId);
    const effect = findEffect(session.pluginId, session.effectId);
    if (!plugin || !effect) return;
    session.params = this.effectDefaults(plugin, effect);
    this.renderPluginParams(effect);
    this.schedulePluginPreview();
  }

  private schedulePluginPreview(): void {
    if (this.pluginFrame || this.pluginTimer) return;
    const elapsed = performance.now() - this.pluginLastPreviewAt;
    if (elapsed < PREVIEW_MIN_INTERVAL) {
      this.pluginTimer = window.setTimeout(() => {
        this.pluginTimer = 0;
        this.schedulePluginPreview();
      }, PREVIEW_MIN_INTERVAL - elapsed);
      return;
    }
    this.pluginFrame = window.requestAnimationFrame(() => {
      this.pluginFrame = 0;
      this.previewPlugin();
    });
  }

  private previewPlugin(): void {
    const session = this.pluginSession;
    const doc = this.doc;
    if (!session || !doc) return;
    const layer = doc.layers.find((item) => item.id === session.layerId);
    const effect = findEffect(session.pluginId, session.effectId);
    if (!layer || !effect) return;
    this.pluginLastPreviewAt = performance.now();
    const copy = new ImageData(
      new Uint8ClampedArray(session.preview.data),
      session.preview.width,
      session.preview.height,
    );
    // `_scale` = taille de l'aperçu / taille réelle : les effets qui travaillent
    // en pixels gardent ainsi la même échelle visuelle dans les deux rendus.
    effect.apply(copy, { ...session.params, _scale: session.previewScale });
    const ctx = canvasContext(layer.canvas);
    if (session.previewScale >= 1) {
      ctx.putImageData(copy, 0, 0);
    } else {
      const previewContext = canvasContext(session.previewCanvas);
      previewContext.clearRect(0, 0, session.previewCanvas.width, session.previewCanvas.height);
      previewContext.putImageData(copy, 0, 0);
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(session.previewCanvas, 0, 0, layer.canvas.width, layer.canvas.height);
    }
    this.renderCanvas();
    this.renderOverlay();
  }

  private applyPluginEffect(): void {
    const session = this.pluginSession;
    const doc = this.doc;
    if (!session || !doc) return;
    const layer = doc.layers.find((item) => item.id === session.layerId);
    const effect = findEffect(session.pluginId, session.effectId);
    if (!layer || !effect) {
      this.cancelPlugin();
      return;
    }
    if (this.pluginFrame) cancelAnimationFrame(this.pluginFrame);
    if (this.pluginTimer) window.clearTimeout(this.pluginTimer);
    this.pluginFrame = 0;
    this.pluginTimer = 0;
    // Le « avant » vient de la copie d'origine, pas de la toile : celle-ci
    // contient déjà l'aperçu de l'effet, et l'annulation aurait restauré
    // l'aperçu au lieu des pixels d'origine.
    const before = createCanvas(session.original.width, session.original.height);
    canvasContext(before).putImageData(session.original, 0, 0);
    const result = new ImageData(
      new Uint8ClampedArray(session.original.data),
      session.original.width,
      session.original.height,
    );
    effect.apply(result, { ...session.params, _scale: 1 });
    const ctx = canvasContext(layer.canvas);
    ctx.putImageData(result, 0, 0);
    const after = cloneCanvas(layer.canvas);
    const label = t(effect.nameKey);
    this.history.push({
      label: t('plugin.history', { name: label }),
      undo: () => {
        const context = canvasContext(layer.canvas);
        context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        context.drawImage(before, 0, 0);
        this.invalidateBounds(layer.id);
        this.renderAll();
      },
      redo: () => {
        const context = canvasContext(layer.canvas);
        context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        context.drawImage(after, 0, 0);
        this.invalidateBounds(layer.id);
        this.renderAll();
      },
    });
    this.pluginSession = null;
    this.closePluginPanel();
    this.layersDirty = true;
    this.invalidateBounds(layer.id);
    this.renderAll();
    this.setMessage(t('plugin.applied', { name: label }));
  }

  private closePluginPanel(): void {
    this.pluginPanel.hidden = true;
    this.app.classList.remove('plugins-open');
    this.node<HTMLButtonElement>('btn-plugins').classList.remove('is-active');
    this.invalidateDisplayRect();
    window.setTimeout(() => {
      if (this.fitMode) this.fitToView();
    }, 80);
  }

  private cancelPlugin(): void {
    const session = this.pluginSession;
    if (!session) {
      this.closePluginPanel();
      return;
    }
    if (this.pluginFrame) cancelAnimationFrame(this.pluginFrame);
    if (this.pluginTimer) window.clearTimeout(this.pluginTimer);
    this.pluginFrame = 0;
    this.pluginTimer = 0;
    const layer = this.doc?.layers.find((item) => item.id === session.layerId);
    if (layer) {
      const ctx = canvasContext(layer.canvas);
      ctx.putImageData(session.original, 0, 0);
      this.invalidateBounds(layer.id);
      this.renderAll();
    }
    this.pluginSession = null;
    this.closePluginPanel();
  }

  private renderPreferencesPlugins(): void {
    const host = document.getElementById('prefs-plugin-list');
    if (!host) return;
    host.innerHTML = PLUGINS.map((plugin) => {
      const enabled = this.pluginState[plugin.id] === true;
      return `
        <div class="plugin-card${enabled ? ' is-enabled' : ''}" data-plugin-card="${plugin.id}">
          <span class="plugin-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#${plugin.icon}"></use></svg></span>
          <div class="plugin-card-copy">
            <strong>${escapeHtml(plugin.name)} <em>v${escapeHtml(plugin.version)}</em></strong>
            <span>${escapeHtml(t(plugin.descriptionKey))}</span>
            <span class="plugin-card-meta">${plugin.effects.length} ${escapeHtml(t('plugin.effectsCount'))} · ${escapeHtml(plugin.author)}</span>
          </div>
          <button class="plugin-toggle-btn${enabled ? ' is-on' : ''}" data-plugin-toggle="${plugin.id}"
                  role="switch" aria-checked="${enabled}">
            <span></span>
          </button>
        </div>`;
    }).join('');
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-plugin-toggle]')) {
      button.addEventListener('click', () => {
        const id = button.dataset.pluginToggle;
        if (!id) return;
        this.pluginState = { ...this.pluginState, [id]: !this.pluginState[id] };
        savePluginState(this.pluginState);
        this.syncPluginChrome();
        this.setMessage(
          this.pluginState[id] ? t('plugin.enabled', { name: findPlugin(id)?.name ?? id }) : t('plugin.disabled', { name: findPlugin(id)?.name ?? id }),
        );
      });
    }
  }

  private bindPreferences(): void {
    this.node<HTMLButtonElement>('prefs-close').addEventListener('click', () => this.closePreferences(true));
    this.node<HTMLButtonElement>('prefs-cancel').addEventListener('click', () => this.closePreferences(true));
    this.node<HTMLButtonElement>('prefs-apply').addEventListener('click', () => this.commitPreferences());
    this.node<HTMLButtonElement>('prefs-reset').addEventListener('click', () => this.resetPreferences());
    this.preferencesModal.addEventListener('click', (event) => {
      if (event.target === this.preferencesModal) this.closePreferences(true);
    });

    for (const tab of this.preferencesModal.querySelectorAll<HTMLButtonElement>('[data-prefs-tab]')) {
      tab.addEventListener('click', () => this.showPreferencesTab(tab.dataset.prefsTab ?? 'appearance'));
    }

    for (const group of this.preferencesModal.querySelectorAll<HTMLElement>('[data-pref]')) {
      const key = group.dataset.pref as keyof Preferences | undefined;
      if (!key) continue;
      group.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-value]');
        if (!button) return;
        this.updatePreference(key, button.dataset.value as Preferences[typeof key]);
      });
    }

    for (const input of this.preferencesModal.querySelectorAll<HTMLInputElement>('[data-pref-toggle]')) {
      const key = input.dataset.prefToggle as keyof Preferences | undefined;
      if (!key) continue;
      input.addEventListener('change', () => {
        this.updatePreference(key, input.checked as Preferences[typeof key]);
      });
    }

    const forget = document.getElementById('prefs-forget-session');
    forget?.addEventListener('click', () => {
      void clearSession().then(() => {
        this.lastSessionAt = 0;
        this.autosaveState = 'idle';
        this.syncAutosaveBadge();
        this.toast(t('msg.sessionCleared'), 'success');
      });
    });

    onPreferencesChange((preferences) => {
      if (preferencesEqual(this.preferences, preferences)) return;
      this.preferences = preferences;
      this.applyRuntimePreferences();
      this.syncPreferencesUI();
    });

    this.applyRuntimePreferences();
    this.syncPreferencesUI();
  }

  private showPreferencesTab(name: string): void {
    for (const tab of this.preferencesModal.querySelectorAll<HTMLElement>('[data-prefs-tab]')) {
      const active = tab.dataset.prefsTab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const panel of this.preferencesModal.querySelectorAll<HTMLElement>('[data-prefs-panel]')) {
      panel.hidden = panel.dataset.prefsPanel !== name;
    }
  }

  private openPreferences(tab = 'appearance'): void {
    if (this.adjustment) {
      this.cancelAdjustment();
      this.renderToolOptions();
    }
    this.preferencesSnapshot = { ...this.preferences };
    this.showPreferencesTab(tab);
    this.syncPreferencesUI();
    this.closeCanvasMenu();
    this.preferencesModal.classList.add('is-open');
  }

  private closePreferences(revert: boolean): void {
    if (revert && this.preferencesSnapshot) {
      this.preferences = { ...this.preferencesSnapshot };
      applyPreferences(this.preferences);
      this.applyRuntimePreferences();
    }
    this.preferencesSnapshot = null;
    this.preferencesModal.classList.remove('is-open');
    this.syncPreferencesUI();
  }

  private commitPreferences(): void {
    savePreferences(this.preferences);
    this.preferencesSnapshot = null;
    this.preferencesModal.classList.remove('is-open');
    this.setMessage(t('prefs.saved'));
    this.toast(t('prefs.saved'), 'success');
  }

  private resetPreferences(): void {
    this.preferences = { ...DEFAULT_PREFERENCES };
    applyPreferences(this.preferences);
    this.applyRuntimePreferences();
    this.syncPreferencesUI();
    this.setMessage(t('prefs.resetDone'));
  }

  private updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    if (this.preferences[key] === value) return;
    this.preferences = { ...this.preferences, [key]: value };
    applyPreferences(this.preferences);
    this.applyRuntimePreferences(key);
    this.syncPreferencesUI();
  }

  private toggleTheme(): void {
    const next: ThemeMode = resolveTheme(this.preferences.theme) === 'dark' ? 'light' : 'dark';
    this.preferences = { ...this.preferences, theme: next };
    savePreferences(this.preferences);
    applyPreferences(this.preferences);
    this.applyRuntimePreferences('theme');
    this.syncPreferencesUI();
    this.setMessage(next === 'dark' ? t('prefs.dark') : t('prefs.light'));
  }

  private applyRuntimePreferences(changed?: keyof Preferences): void {
    if (!changed || changed === 'coordinates') this.syncCoordinatesVisibility();
    if (!changed || changed === 'smoothZoom') this.applyZoom();
    if (changed === 'autoFit' && this.preferences.autoFit && this.fitMode) this.fitToView();
    if (changed === 'autosave') {
      if (this.preferences.autosave) this.scheduleAutosave(200);
      else {
        window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = 0;
      }
      this.syncAutosaveBadge();
    }
    this.updateStatus();
  }

  private syncPreferencesUI(): void {
    const preferences = this.preferences;
    const toggle = document.getElementById('btn-theme-toggle');
    if (toggle) {
      const label = resolveTheme(preferences.theme) === 'dark'
        ? t('topbar.themeLight')
        : t('topbar.themeDark');
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
    }
    for (const group of this.preferencesModal.querySelectorAll<HTMLElement>('[data-pref]')) {
      const key = group.dataset.pref as keyof Preferences | undefined;
      if (!key) continue;
      const current = String(preferences[key]);
      for (const button of group.querySelectorAll<HTMLElement>('[data-value]')) {
        const active = button.dataset.value === current;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
    for (const input of this.preferencesModal.querySelectorAll<HTMLInputElement>('[data-pref-toggle]')) {
      const key = input.dataset.prefToggle as keyof Preferences | undefined;
      if (!key) continue;
      input.checked = Boolean(preferences[key]);
    }
    for (const button of this.preferencesModal.querySelectorAll<HTMLElement>('[data-lang]')) {
      const active = button.dataset.lang === currentLanguage();
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private bindToolRail(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.addEventListener('click', () => {
        const tool = button.dataset.tool as ToolId | undefined;
        if (tool && tool in TOOLS) this.setTool(tool);
      });
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      if (!button.closest('#tool-options')) {
        button.addEventListener('click', () => this.handleAction(button.dataset.action ?? ''));
      }
    }
    this.toolOptions.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (target) {
        this.handleAction(target.dataset.action ?? '');
        return;
      }
      const marquee = (event.target as HTMLElement).closest<HTMLElement>('[data-marquee]');
      if (marquee) {
        this.marqueeMode = (marquee.dataset.marquee as 'rect' | 'ellipse' | 'lasso') ?? 'rect';
        this.renderToolOptions();
        return;
      }
      const gradient = (event.target as HTMLElement).closest<HTMLElement>('[data-gradient]');
      if (gradient) {
        this.gradientOptions.type = (gradient.dataset.gradient as 'linear' | 'radial') ?? 'linear';
        this.renderToolOptions();
        return;
      }
      const brushPreset = (event.target as HTMLElement).closest<HTMLElement>('[data-brush-size]');
      if (brushPreset) {
        const size = Number(brushPreset.dataset.brushSize);
        if (Number.isFinite(size) && size > 0) {
          this.brush.size = size;
          this.renderToolOptions();
        }
        return;
      }
      const channel = (event.target as HTMLElement).closest<HTMLElement>('[data-channel]');
      if (channel) {
        this.curveChannel = (channel.dataset.channel as CurveChannel) ?? 'rgb';
        this.renderToolOptions();
        return;
      }
      const align = (event.target as HTMLElement).closest<HTMLElement>('[data-align]');
      if (align) {
        const layer = this.activeTextLayer;
        if (layer?.text) {
          const before = deepClone(layer.text);
          layer.text.align = (align.dataset.align as TextData['align']) ?? 'left';
          renderLayer(layer);
          this.history.push({
            label: t('msg.textAlign'),
            undo: () => {
              if (!layer.text) return;
              layer.text = deepClone(before);
              renderLayer(layer);
              this.renderAll();
            },
            redo: () => {
              if (!layer.text) return;
              layer.text.align = (align.dataset.align as TextData['align']) ?? 'left';
              renderLayer(layer);
              this.renderAll();
            },
          });
          this.textOptions.align = layer.text.align;
          this.renderAll();
        }
      }
    });

    this.toolOptions.addEventListener('input', (event) => this.onOptionInput(event));
    this.toolOptions.addEventListener('change', (event) => this.onOptionChange(event));
  }

  private onOptionInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (target instanceof HTMLInputElement && target.type === 'range') this.syncRangeFills();
    if (target.matches('[data-adjust-param]')) {
      const key = target.dataset.adjustParam;
      if (!key || !this.adjustment) return;
      this.adjustment.params[key] = Number(target.value);
      const output = this.toolOptions.querySelector<HTMLElement>(`[data-adjust-output="${key}"]`);
      if (output) {
        const param = ADJUSTMENT_PARAMS[this.adjustment.id].find((item) => item.key === key);
        if (param) output.textContent = this.formatParam(Number(target.value), param);
      }
      this.syncRangeFills();
      this.scheduleAdjustmentPreview();
      return;
    }
    if (target.matches('[data-zoom-slider]')) {
      this.setZoom(Number(target.value) / 100);
      return;
    }
    if (target.matches('[data-text-field]')) {
      this.onTextFieldInput(target);
      return;
    }
    if (target.matches('[data-shape-field]')) {
      this.onShapeFieldInput(target);
      return;
    }
    if (target.matches('[data-gradient-field]')) {
      this.onGradientFieldInput(target);
      return;
    }
    if (target.matches('[data-paint-field]')) {
      this.onPaintFieldInput(target);
      return;
    }
    if (target.matches('[data-wand-field]')) {
      this.onWandFieldInput(target);
      return;
    }
    if (target.matches('[data-patch-field]')) {
      this.onPatchFieldInput(target);
    }
    if (target.matches('[data-feather-field]')) {
      this.onFeatherInput(Number(target.value));
      return;
    }
    if (target.matches('[data-spot-field]')) {
      this.onSpotlightInput(target as HTMLInputElement);
    }
  }

  private onFeatherInput(value: number): void {
    this.selectionFeather = clamp(Math.round(value), 0, 120);
    const output = this.toolOptions.querySelector<HTMLElement>('[data-feather-output]');
    if (output) output.textContent = `${this.selectionFeather} px`;
    if (this.selection) {
      this.selection = { ...this.selection, feather: this.selectionFeather };
      this.renderOverlay();
      this.updateStatus();
    }
    this.syncRangeFills();
  }

  private onSpotlightInput(target: HTMLInputElement): void {
    const key = target.dataset.spotField as 'diameter' | 'intensity' | 'softness' | undefined;
    if (!key) return;
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;
    this.spotlight[key] = value;
    const output = this.toolOptions.querySelector<HTMLElement>(`[data-spot-output="${key}"]`);
    if (output) {
      output.textContent = key === 'diameter' ? `${Math.round(value)} px` : `${Math.round(value)} %`;
    }
    this.syncRangeFills();
    this.renderOverlay();
  }

  private onOptionChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (target.matches('[data-crop-ratio]')) {
      const value = target.value;
      this.cropRatio = value ? Number(value) : null;
      return;
    }
    if (target.matches('[data-text-field]')) {
      this.onTextCommit();
      return;
    }
    if (target.matches('[data-shape-field]')) {
      this.onShapeFieldInput(target, true);
      return;
    }
    if (target.matches('[data-gradient-field]')) {
      this.onGradientFieldInput(target);
      return;
    }
    if (target.matches('[data-path-field]')) {
      this.onPathFieldInput(target);
    }
    if (target.matches('[data-wand-field]')) {
      this.onWandFieldInput(target);
    }
    if (target.matches('[data-patch-field]')) {
      this.onPatchFieldInput(target);
    }
  }

  private onTextFieldInput(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
    const layer = this.activeTextLayer;
    if (!layer?.text) return;
    if (!this.textEditBefore.has(layer.id)) {
      this.textEditBefore.set(layer.id, deepClone(layer.text));
    }
    const key = target.dataset.textField;
    if (!key) return;
    if (key === 'content') layer.text.content = target.value;
    else if (key === 'fontFamily') layer.text.fontFamily = target.value;
    else if (key === 'fontSize') layer.text.fontSize = clamp(Number(target.value) || 4, 4, 800);
    else if (key === 'fontWeight') layer.text.fontWeight = Number(target.value) || 400;
    else if (key === 'color') layer.text.color = target.value;
    renderLayer(layer);
    this.requestFrame();
  }

  private onTextCommit(): void {
    const layer = this.activeTextLayer;
    if (!layer?.text) return;
    const before = this.textEditBefore.get(layer.id);
    if (!before) return;
    const after = deepClone(layer.text);
    this.textEditBefore.delete(layer.id);
    this.textOptions.fontFamily = after.fontFamily;
    this.textOptions.fontSize = after.fontSize;
    this.textOptions.fontWeight = after.fontWeight;
    this.history.push({
      label: t('msg.textEditLabel'),
      undo: () => {
        layer.text = deepClone(before);
        layer.kind = 'text';
        renderLayer(layer);
        this.renderAll();
      },
      redo: () => {
        layer.text = deepClone(after);
        layer.kind = 'text';
        renderLayer(layer);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.requestFrame();
  }

  private onShapeFieldInput(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    commit = false,
  ): void {
    const key = target.dataset.shapeField;
    if (!key) return;
    if (key === 'type') this.shapeOptions.type = target.value as ShapeOptions['type'];
    else if (key === 'fill') this.shapeOptions.fill = target.value;
    else if (key === 'stroke') this.shapeOptions.stroke = target.value;
    else if (key === 'strokeWidth') {
      this.shapeOptions.strokeWidth = Number(target.value);
      const output = this.toolOptions.querySelector('[data-shape-output="strokeWidth"]');
      if (output) output.textContent = `${this.shapeOptions.strokeWidth} px`;
    } else if (key === 'radius') {
      this.shapeOptions.radius = Number(target.value);
      const output = this.toolOptions.querySelector('[data-shape-output="radius"]');
      if (output) output.textContent = `${this.shapeOptions.radius} px`;
    } else if (key === 'newLayer') {
      this.shapeOptions.newLayer = (target as HTMLInputElement).checked;
    }
    if (commit && key === 'type') this.renderToolOptions();
  }

  private onGradientFieldInput(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): void {
    const key = target.dataset.gradientField;
    if (!key) return;
    if (key === 'colors') this.gradientOptions.colors = target.value as GradientOptions['colors'];
    else if (key === 'opacity') {
      this.gradientOptions.opacity = Number(target.value);
      const output = this.toolOptions.querySelector('[data-gradient-output]');
      if (output) output.textContent = `${this.gradientOptions.opacity} %`;
    } else if (key === 'newLayer') {
      this.gradientOptions.newLayer = (target as HTMLInputElement).checked;
    }
  }

  private onPaintFieldInput(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): void {
    const key = target.dataset.paintField;
    if (!key) return;
    const value = Number(target.value);
    let label = '';
    if (key === 'size') {
      this.brush.size = clamp(value, 1, 600);
      label = `${this.brush.size} px`;
    } else if (key === 'hardness') {
      this.brush.hardness = clamp(value / 100, 0, 1);
      label = `${Math.round(this.brush.hardness * 100)} %`;
    } else if (key === 'opacity') {
      this.brush.opacity = clamp(value / 100, 0.01, 1);
      label = `${Math.round(this.brush.opacity * 100)} %`;
    } else if (key === 'spacing') {
      this.brush.spacing = clamp(value / 100, 0.02, 1);
      label = `${Math.round(this.brush.spacing * 100)} %`;
    } else if (key === 'pencilSize') {
      this.pencilOptions.size = clamp(value, 1, 48);
      label = `${this.pencilOptions.size} px`;
    } else if (key === 'pencilOpacity') {
      this.pencilOptions.opacity = clamp(value, 1, 100);
      label = `${this.pencilOptions.opacity} %`;
    }
    const output = this.toolOptions.querySelector(`[data-paint-output="${key}"]`);
    if (output && label) output.textContent = label;
    this.syncRangeFills();
  }

  private onWandFieldInput(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): void {
    const key = target.dataset.wandField;
    if (!key) return;
    if (key === 'tolerance') {
      this.wand.tolerance = clamp(Number(target.value), 0, 128);
      const output = this.toolOptions.querySelector('[data-wand-output="tolerance"]');
      if (output) output.textContent = String(this.wand.tolerance);
      this.syncRangeFills();
    } else if (key === 'contiguous') {
      this.wand.contiguous = (target as HTMLInputElement).checked;
    } else if (key === 'merged') {
      this.wand.merged = (target as HTMLInputElement).checked;
    }
  }

  private onPatchFieldInput(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): void {
    if (target.dataset.patchField !== 'corrector') return;
    this.patchOptions.corrector = (target as HTMLInputElement).checked;
  }

  private onPathFieldInput(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): void {
    const layer = this.activePathLayer;
    if (!layer?.path) return;
    const key = target.dataset.pathField;
    if (!key) return;
    const before = deepClone(layer.path);
    if (key === 'fillEnabled') {
      layer.path.fill = (target as HTMLInputElement).checked ? this.primaryColor : null;
    } else if (key === 'strokeEnabled') {
      layer.path.stroke = (target as HTMLInputElement).checked ? this.primaryColor : null;
    } else if (key === 'fill') {
      layer.path.fill = target.value;
      this.primaryColor = target.value;
      this.syncColors();
    } else if (key === 'stroke') {
      layer.path.stroke = target.value;
    } else if (key === 'strokeWidth') {
      layer.path.strokeWidth = Number(target.value);
    }
    const after = deepClone(layer.path);
    renderLayer(layer);
    this.history.push({
      label: t('msg.pathStyle'),
      undo: () => {
        layer.path = deepClone(before);
        renderLayer(layer);
        this.renderAll();
      },
      redo: () => {
        layer.path = deepClone(after);
        renderLayer(layer);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.requestFrame();
    this.renderToolOptions();
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'new-document':
        this.openNewDocumentDialog();
        break;
      case 'apply-crop':
        this.applyCrop();
        break;
      case 'cancel-crop':
        this.pendingCrop = null;
        this.renderOverlay();
        this.renderToolOptions();
        break;
      case 'select-all':
        if (this.doc) {
          this.selection = {
            type: 'rect',
            rect: { x: 0, y: 0, w: this.doc.width, h: this.doc.height },
            invert: false,
            feather: this.selectionFeather,
          };
          this.renderOverlay();
          this.renderToolOptions();
          this.updateStatus();
        }
        break;
      case 'fill-selection':
        this.fillSelection(this.primaryColor);
        break;
      case 'deselect':
        this.selection = null;
        this.renderOverlay();
        this.renderToolOptions();
        break;
      case 'invert-selection':
        if (this.selection) {
          this.selection = { ...this.selection, invert: !this.selection.invert };
          this.renderOverlay();
        }
        break;
      case 'new-path':
        this.penDrawing = false;
        this.penHover = null;
        this.createPathLayer();
        this.penDrawing = true;
        break;
      case 'finish-path':
        this.commitPenPath();
        break;
      case 'clear-patch':
        this.patchSourceRect = null;
        this.renderOverlay();
        this.renderToolOptions();
        this.setMessage(t('msg.patchCleared'));
        break;
      case 'close-path':
        this.closeActivePath();
        break;
      case 'delete-anchor':
        this.deleteLastAnchor();
        break;
      case 'apply-adjustment':
        this.applyAdjustment();
        break;
      case 'cancel-adjustment':
        this.cancelAdjustment();
        this.renderToolOptions();
        break;
      case 'reset-adjustment':
        this.resetAdjustment();
        break;
      case 'curve-linear':
        this.applyCurvePreset('linear');
        break;
      case 'curve-contrast':
        this.applyCurvePreset('contrast');
        break;
      case 'curve-bright':
        this.applyCurvePreset('bright');
        break;
      case 'zoom-fit':
        this.fitToView();
        break;
      case 'zoom-100':
        this.setZoom(1);
        break;
      case 'zoom-200':
        this.setZoom(2);
        break;
      case 'zoom-400':
        this.setZoom(4);
        break;
      case 'open-image':
        void this.openImageFlow();
        break;
      case 'export':
        this.openExportDialog();
        break;
      case 'image-size':
        this.openResizeDialog('image');
        break;
      case 'canvas-size':
        this.openResizeDialog('canvas');
        break;
      case 'adjust-tonality':
        this.openAdjustment('tonality');
        break;
      case 'adjust-contrast':
        this.openAdjustment('contrast');
        break;
      case 'adjust-color':
        this.openAdjustment('color');
        break;
      case 'adjust-levels':
        this.openAdjustment('levels');
        break;
      case 'adjust-curves':
        this.openAdjustment('curves');
        break;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Layers
  // ───────────────────────────────────────────────────────────────────────────

  private bindLayersPanel(): void {
    this.layersList.addEventListener('click', (event) => {
      if (this.layerDragJustEnded) {
        this.layerDragJustEnded = false;
        return;
      }
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[data-layer-id]');
      if (!row) return;
      const layerId = row.dataset.layerId;
      if (!layerId || !this.doc) return;
      const action = target.closest<HTMLElement>('[data-layer-action]')?.dataset.layerAction;

      if (action === 'visibility') {
        const layer = this.doc.layers.find((item) => item.id === layerId);
        if (!layer) return;
        if (this.adjustment) this.cancelAdjustment();
        const before = layer.visible;
        layer.visible = !layer.visible;
        this.history.push({
          label: before ? t('layers.hide') : t('layers.show'),
          undo: () => {
            layer.visible = before;
            this.renderAll();
          },
          redo: () => {
            layer.visible = !before;
            this.renderAll();
          },
        });
        this.renderAll();
        return;
      }

      if (action === 'lock') {
        const layer = this.doc.layers.find((item) => item.id === layerId);
        if (!layer) return;
        this.toggleLayerLock(layer);
        return;
      }

      if (action === 'pixels') {
        const layer = this.doc.layers.find((item) => item.id === layerId);
        if (!layer) return;
        if (this.doc.activeLayerId !== layerId) this.selectLayer(layerId);
        if (!layer.maskEditing) return;
        layer.maskEditing = false;
        this.layersDirty = true;
        this.renderAll();
        this.renderToolOptions();
        this.setMessage(t('msg.pixelsEditing'));
        return;
      }

      if (action === 'mask') {
        const layer = this.doc.layers.find((item) => item.id === layerId);
        if (!layer) return;
        if (this.doc.activeLayerId !== layerId) this.selectLayer(layerId);
        // Maj + clic sur la vignette du masque : active / désactive le masque
        // sans le supprimer (geste Photoshop).
        if (event.shiftKey) {
          const before = layer.maskEnabled !== false;
          layer.maskEnabled = !before;
          this.history.push({
            label: before ? t('msg.maskDisable') : t('msg.maskEnable'),
            undo: () => {
              layer.maskEnabled = before;
              this.renderAll();
            },
            redo: () => {
              layer.maskEnabled = !before;
              this.renderAll();
            },
          });
          this.layersDirty = true;
          this.renderAll();
          this.setMessage(layer.maskEnabled ? t('msg.maskOn') : t('msg.maskOff'));
          return;
        }
        if (layer.maskEnabled === false) {
          layer.maskEnabled = true;
          this.layersDirty = true;
          this.renderAll();
          this.setMessage(t('msg.maskOn'));
          return;
        }
        layer.maskEditing = !layer.maskEditing;
        this.layersDirty = true;
        this.renderAll();
        this.renderToolOptions();
        this.setMessage(layer.maskEditing ? t('msg.maskEditing') : t('msg.pixelsEditing'));
        return;
      }

      this.selectLayer(layerId, event.shiftKey || event.metaKey || event.ctrlKey);
      row.focus({ preventScroll: true });
    });

    this.bindLayerDrag();

    this.layersList.addEventListener('dblclick', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-layer-id]');
      if (!row) return;
      byId<HTMLInputElement>('layer-name').focus();
      byId<HTMLInputElement>('layer-name').select();
    });

    byId<HTMLButtonElement>('layer-add').addEventListener('click', () => this.addNewLayer());
    byId<HTMLButtonElement>('layer-mask').addEventListener('click', () => this.toggleMaskForActiveLayer());
    byId<HTMLButtonElement>('layer-duplicate').addEventListener('click', () => this.duplicateActiveLayer());
    byId<HTMLButtonElement>('layer-delete').addEventListener('click', () => this.deleteActiveLayer());
    byId<HTMLButtonElement>('layer-up').addEventListener('click', () => this.moveActiveLayer(1));
    byId<HTMLButtonElement>('layer-down').addEventListener('click', () => this.moveActiveLayer(-1));

    const opacity = byId<HTMLInputElement>('layer-opacity');
    const rememberOpacity = () => {
      const layers = this.selectedLayers();
      if (layers.length === 0 && this.activeLayer) layers.push(this.activeLayer);
      this.layerPropBefore = layers.length > 0 ? layers[0]!.opacity : null;
      this.layerPropBeforeAll = new Map(layers.map((item) => [item.id, item.opacity]));
    };
    opacity.addEventListener('pointerdown', rememberOpacity);
    opacity.addEventListener('focus', rememberOpacity);
    opacity.addEventListener('input', () => {
      const value = clamp(Number(opacity.value) / 100, 0, 1);
      const primary = this.activeLayer;
      if (!primary) return;
      // L'opacité s'applique à toute la sélection, comme dans Photoshop.
      const selected = this.selectedLayers();
      const targets = selected.length > 0 ? selected : [primary];
      for (const item of targets) item.opacity = value;
      this.setText('layer-opacity-value', `${Math.round(value * 100)} %`);
      paintRange(opacity);
      this.renderCanvas();
      this.layersDirty = true;
      this.requestFrame();
    });
    opacity.addEventListener('change', () => {
      const primary = this.activeLayer;
      if (!primary || this.layerPropBefore === null) return;
      const before = this.layerPropBefore;
      const after = primary.opacity;
      const snapshot = this.layerPropBeforeAll ?? new Map([[primary.id, before]]);
      this.layerPropBefore = null;
      this.layerPropBeforeAll = null;
      if (Math.abs(before - after) < 0.001) return;
      this.history.push({
        label: t('msg.layerOpacity'),
        undo: () => {
          for (const [id, value] of snapshot) {
            const item = this.doc?.layers.find((entry) => entry.id === id);
            if (item) item.opacity = value;
          }
          this.renderAll();
        },
        redo: () => {
          for (const id of snapshot.keys()) {
            const item = this.doc?.layers.find((entry) => entry.id === id);
            if (item) item.opacity = after;
          }
          this.renderAll();
        },
      });
      this.layersDirty = true;
      this.requestFrame();
    });

    const blend = byId<HTMLSelectElement>('layer-blend');
    const fillBlendOptions = (): void => {
      const current = blend.value;
      blend.innerHTML = BLEND_MODES
        .map((mode) => `<option value="${mode}">${escapeHtml(blendLabel(mode))}</option>`)
        .join('');
      if (current) blend.value = current;
    };
    fillBlendOptions();
    this.refreshBlendOptions = fillBlendOptions;
    blend.dataset.i18nOptions = 'blend';
    blend.addEventListener('change', () => {
      const layer = this.activeLayer;
      if (!layer) return;
      const before = layer.blend;
      const after = blend.value as BlendMode;
      layer.blend = after;
      this.history.push({
        label: t('msg.blendMode'),
        undo: () => {
          layer.blend = before;
          this.renderAll();
        },
        redo: () => {
          layer.blend = after;
          this.renderAll();
        },
      });
      this.renderCanvas();
      this.layersDirty = true;
      this.requestFrame();
    });

    const nameInput = byId<HTMLInputElement>('layer-name');
    let nameBefore = '';
    nameInput.addEventListener('focus', () => {
      nameBefore = this.activeLayer?.name ?? '';
    });
    nameInput.addEventListener('change', () => {
      const layer = this.activeLayer;
      if (!layer) return;
      const after = nameInput.value.trim() || t('layers.placeholder');
      const before = nameBefore || layer.name;
      if (after === before) return;
      layer.name = after;
      this.history.push({
        label: t('msg.layerRename'),
        undo: () => {
          layer.name = before;
          this.renderAll();
        },
        redo: () => {
          layer.name = after;
          this.renderAll();
        },
      });
      this.renderLayers();
    });

    const maskEnabled = byId<HTMLInputElement>('layer-mask-enabled');
    maskEnabled.addEventListener('change', () => {
      const layer = this.activeLayer;
      if (!layer?.mask) return;
      if (this.adjustment) this.cancelAdjustment();
      const before = layer.maskEnabled !== false;
      const after = maskEnabled.checked;
      layer.maskEnabled = after;
      this.history.push({
        label: after ? t('msg.maskEnable') : t('msg.maskDisable'),
        undo: () => {
          layer.maskEnabled = before;
          this.renderAll();
        },
        redo: () => {
          layer.maskEnabled = after;
          this.renderAll();
        },
      });
      this.layersDirty = true;
      this.renderAll();
    });

    byId<HTMLButtonElement>('layer-mask-edit').addEventListener('click', () => {
      const layer = this.activeLayer;
      if (!layer?.mask) return;
      layer.maskEditing = !layer.maskEditing;
      this.layersDirty = true;
      this.renderAll();
      this.renderToolOptions();
    });

    byId<HTMLButtonElement>('layer-mask-apply').addEventListener('click', () => this.applyActiveMask());
    byId<HTMLButtonElement>('layer-mask-delete').addEventListener('click', () => this.deleteActiveMask());
  }

  /**
   * Réordonnancement à la souris. Le glissement est piloté au pointeur (et non
   * par le glisser-déposer HTML) : on obtient un indicateur d'insertion net, un
   * rendu immédiat et un seul pas d'historique.
   */
  private bindLayerDrag(): void {
    const indicator = document.createElement('div');
    indicator.className = 'layer-drop-indicator';
    indicator.hidden = true;

    const rowIndexAt = (clientY: number): number => {
      const rows = [...this.layersList.querySelectorAll<HTMLElement>('[data-layer-id]')];
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i]!.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return i;
      }
      return rows.length;
    };

    const showIndicator = (index: number): void => {
      const rows = [...this.layersList.querySelectorAll<HTMLElement>('[data-layer-id]')];
      if (rows.length === 0) return;
      if (!indicator.isConnected) this.layersList.appendChild(indicator);
      indicator.hidden = false;
      const listRect = this.layersList.getBoundingClientRect();
      let top: number;
      if (index >= rows.length) {
        const last = rows[rows.length - 1]!.getBoundingClientRect();
        top = last.bottom - listRect.top + this.layersList.scrollTop;
      } else {
        const rect = rows[index]!.getBoundingClientRect();
        top = rect.top - listRect.top + this.layersList.scrollTop;
      }
      indicator.style.top = `${Math.round(top)}px`;
    };

    const stop = (): void => {
      indicator.hidden = true;
      for (const row of this.layersList.querySelectorAll('.is-dragging')) row.classList.remove('is-dragging');
      this.layersList.classList.remove('is-dragging-layers');
      this.layerDrag = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    const onMove = (event: PointerEvent): void => {
      const drag = this.layerDrag;
      if (!drag || drag.ids.length === 0) return;
      if (!drag.active) {
        if (Math.abs(event.clientY - drag.startY) < 5) return;
        drag.active = true;
        this.layersList.classList.add('is-dragging-layers');
        for (const id of drag.ids) this.layerRows.get(id)?.classList.add('is-dragging');
      }
      drag.target = rowIndexAt(event.clientY);
      showIndicator(drag.target);
    };

    const onCancel = (): void => {
      stop();
    };

    const onUp = (): void => {
      const drag = this.layerDrag;
      if (!drag) return;
      const wasActive = drag.active;
      const ids = drag.ids;
      const targetIndex = drag.target;
      stop();
      if (!wasActive || targetIndex < 0 || ids.length === 0) return;
      // Le clic qui suit le relâchement ne doit pas changer la sélection.
      this.layerDragJustEnded = true;
      window.setTimeout(() => {
        this.layerDragJustEnded = false;
      }, 60);
      this.reorderLayersTo(ids, targetIndex);
    };

    this.layersList.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !this.doc) return;
      const target = event.target as HTMLElement;
      if (target.closest('[data-layer-action]')) return;
      const row = target.closest<HTMLElement>('[data-layer-id]');
      const id = row?.dataset.layerId;
      if (!row || !id) return;
      const layer = this.doc.layers.find((item) => item.id === id);
      if (!layer) return;
      // Un calque verrouillé ne bouge pas, mais reste sélectionnable.
      const group = this.selectedLayerIds.has(id) && this.selectedLayerIds.size > 1
        ? this.selectedLayers()
        : [layer];
      this.layerDrag = {
        ids: layer.locked ? [] : group.map((item) => item.id),
        startY: event.clientY,
        active: false,
        target: -1,
        indicator,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });
  }

  /**
   * Place les calques `ids` à la position visuelle `visualIndex` (0 = tout en
   * haut de la pile, comme à l'écran).
   */
  private reorderLayersTo(ids: string[], visualIndex: number): void {
    const doc = this.doc;
    if (!doc) return;
    const before = doc.layers.map((item) => item.id);
    const moving = new Set(ids);
    const visual = [...doc.layers].reverse();
    const block = visual.filter((item) => moving.has(item.id));
    if (block.length === 0) return;
    const rest = visual.filter((item) => !moving.has(item.id));
    // L'indicateur est dessiné avant la ligne `visualIndex` : on retire donc du
    // décompte les calques déplacés qui se trouvaient déjà au-dessus.
    const above = visual
      .map((item, index) => (moving.has(item.id) ? index : -1))
      .filter((index) => index >= 0 && index < visualIndex).length;
    const insertAt = clamp(visualIndex - above, 0, rest.length);
    const nextVisual = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
    const next = [...nextVisual].reverse();
    doc.layers = next;
    const after = next.map((item) => item.id);
    if (before.join('|') === after.join('|')) return;
    this.history.push({
      label: t('msg.layerReorder'),
      undo: () => {
        this.reorderTo(before);
        this.renderAll();
      },
      redo: () => {
        this.reorderTo(after);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
  }

  private toggleLayerLock(layer: Layer): void {
    const before = Boolean(layer.locked);
    layer.locked = !before;
    this.history.push({
      label: before ? t('layers.unlock') : t('layers.lock'),
      undo: () => {
        layer.locked = before;
        this.renderAll();
      },
      redo: () => {
        layer.locked = !before;
        this.renderAll();
      },
    });
    this.renderAll();
    this.setMessage(layer.locked ? t('msg.layerLocked', { name: layer.name }) : t('msg.layerUnlocked', { name: layer.name }));
  }

  private toggleMaskForActiveLayer(): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (layer.mask) {
      layer.maskEditing = !layer.maskEditing;
      this.layersDirty = true;
      this.renderAll();
      this.renderToolOptions();
      this.setMessage(layer.maskEditing ? t('msg.maskEditing') : t('msg.pixelsEditing'));
      return;
    }
    if (this.adjustment) this.cancelAdjustment();
    const mask = createMask(doc.width, doc.height);
    layer.mask = mask;
    layer.maskEnabled = true;
    layer.maskEditing = true;
    this.history.push({
      label: t('msg.maskAddLabel'),
      undo: () => {
        layer.mask = undefined;
        layer.maskEnabled = undefined;
        layer.maskEditing = false;
        this.renderAll();
      },
      redo: () => {
        layer.mask = mask;
        layer.maskEnabled = true;
        layer.maskEditing = true;
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.maskAdded'));
  }

  private applyActiveMask(): void {
    const layer = this.activeLayer;
    if (!layer?.mask) return;
    const mask = layer.mask;
    const before = cloneCanvas(layer.canvas);
    const beforeEnabled = layer.maskEnabled;
    flattenMask(layer);
    const after = cloneCanvas(layer.canvas);
    this.history.push({
      label: t('layers.applyMaskLabel'),
      undo: () => {
        layer.canvas = before;
        layer.mask = mask;
        layer.maskEnabled = beforeEnabled;
        this.renderAll();
      },
      redo: () => {
        layer.canvas = after;
        layer.mask = undefined;
        layer.maskEnabled = undefined;
        layer.maskEditing = false;
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.maskApplied'));
  }

  private deleteActiveMask(): void {
    const layer = this.activeLayer;
    if (!layer?.mask) return;
    const mask = layer.mask;
    const wasEnabled = layer.maskEnabled;
    const wasEditing = layer.maskEditing;
    layer.mask = undefined;
    layer.maskEnabled = undefined;
    layer.maskEditing = false;
    this.history.push({
      label: t('msg.maskDeleteLabel'),
      undo: () => {
        layer.mask = mask;
        layer.maskEnabled = wasEnabled;
        layer.maskEditing = wasEditing;
        this.renderAll();
      },
      redo: () => {
        layer.mask = undefined;
        layer.maskEnabled = undefined;
        layer.maskEditing = false;
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.maskDeleted'));
  }

  private selectLayer(layerId: string, additive = false): void {
    if (!this.doc) return;
    if (this.adjustment) this.cancelAdjustment();
    // Maj / Ctrl + clic : on ajoute ou on retire de la sélection multiple.
    if (additive) {
      if (this.selectedLayerIds.has(layerId)) {
        // On ne retire pas le dernier calque sélectionné : il faut toujours une
        // cible aux outils.
        if (this.selectedLayerIds.size > 1) {
          this.selectedLayerIds.delete(layerId);
          const next = [...this.selectedLayerIds].pop();
          if (this.doc.activeLayerId === layerId && next) this.doc.activeLayerId = next;
        }
      } else {
        this.selectedLayerIds.add(layerId);
        this.doc.activeLayerId = layerId;
      }
      this.renderLayers();
      this.renderToolOptions();
      this.renderOverlay();
      this.updateStatus();
      return;
    }
    this.selectedLayerIds = new Set([layerId]);
    if (this.doc.activeLayerId === layerId) {
      this.renderLayers();
      this.renderOverlay();
      this.updateStatus();
      return;
    }
    this.doc.activeLayerId = layerId;
    this.renderLayers();
    this.renderToolOptions();
    this.renderOverlay();
    this.updateStatus();
  }

  /** Calques sélectionnés, dans l'ordre du document (bas → haut). */
  private selectedLayers(): Layer[] {
    const doc = this.doc;
    if (!doc) return [];
    return doc.layers.filter((layer) => this.selectedLayerIds.has(layer.id));
  }

  /** Un calque verrouillé refuse les modifications de pixels et de position. */
  private layerLocked(layer: Layer | null | undefined): boolean {
    if (!layer?.locked) return false;
    this.toast(t('msg.layerIsLocked', { name: layer.name }), 'info');
    return true;
  }

  private addNewLayer(): void {
    const doc = this.doc;
    if (!doc) return;
    if (this.adjustment) this.cancelAdjustment();
    const index = doc.layers.findIndex((layer) => layer.id === doc.activeLayerId);
    const insertAt = index >= 0 ? index + 1 : doc.layers.length;
    const previousActive = doc.activeLayerId;
    const layer = createLayer(`${t('layers.placeholder')} ${doc.layers.length + 1}`, doc.width, doc.height);
    doc.layers.splice(insertAt, 0, layer);
    doc.activeLayerId = layer.id;
    this.history.push({
      label: t('msg.addLayer'),
      undo: () => {
        const current = doc.layers.findIndex((item) => item.id === layer.id);
        if (current >= 0) doc.layers.splice(current, 1);
        doc.activeLayerId = previousActive;
        this.renderAll();
      },
      redo: () => {
        doc.layers.splice(Math.min(insertAt, doc.layers.length), 0, layer);
        doc.activeLayerId = layer.id;
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.setMessage(t('msg.layerAdded'));
  }

  private duplicateActiveLayer(): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (this.adjustment) this.cancelAdjustment();
    const targets = this.selectedLayers().length > 1 ? this.selectedLayers() : [layer];
    // On duplique de haut en bas pour que les copies gardent leur ordre relatif.
    const ordered = [...targets].reverse();
    const copies: Array<{ copy: Layer; at: number }> = [];
    for (const source of ordered) {
      const index = doc.layers.findIndex((item) => item.id === source.id);
      if (index < 0) continue;
      const copy = duplicateLayer(source);
      doc.layers.splice(index + 1, 0, copy);
      copies.push({ copy, at: index + 1 });
    }
    if (copies.length === 0) return;
    const newActive = [...copies].reverse()[0]?.copy.id ?? layer.id;
    doc.activeLayerId = newActive;
    this.selectedLayerIds = new Set(copies.map((item) => item.copy.id));
    this.history.push({
      label: t('layers.duplicate'),
      undo: () => {
        for (const { copy } of [...copies].reverse()) {
          const current = doc.layers.findIndex((item) => item.id === copy.id);
          if (current >= 0) doc.layers.splice(current, 1);
        }
        doc.activeLayerId = layer.id;
        this.selectedLayerIds = new Set([layer.id]);
        this.renderAll();
      },
      redo: () => {
        for (const { copy, at } of copies) {
          doc.layers.splice(Math.min(at, doc.layers.length), 0, copy);
        }
        doc.activeLayerId = newActive;
        this.selectedLayerIds = new Set(copies.map((item) => item.copy.id));
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.setMessage(copies.length > 1 ? t('msg.layersDuplicated', { n: copies.length }) : t('msg.layerDuplicated'));
  }

  private deleteActiveLayer(): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (this.adjustment) this.cancelAdjustment();
    const targets = this.selectedLayers().length > 1 ? this.selectedLayers() : [layer];
    if (targets.length >= doc.layers.length) {
      this.toast(t('msg.lastLayer'), 'error');
      return;
    }
    const locked = targets.filter((item) => item.locked);
    if (locked.length > 0) {
      this.toast(t('msg.layerIsLocked', { name: locked[0]?.name ?? '' }), 'info');
      return;
    }
    const removed = targets.map((item) => ({
      layer: item,
      at: doc.layers.findIndex((entry) => entry.id === item.id),
    })).filter((item) => item.at >= 0).sort((a, b) => b.at - a.at);
    if (removed.length === 0) return;
    const firstIndex = Math.min(...removed.map((item) => item.at));
    const previousActive = doc.activeLayerId;
    const previousSelection = new Set(this.selectedLayerIds);
    for (const { layer: item } of removed) {
      const current = doc.layers.findIndex((entry) => entry.id === item.id);
      if (current >= 0) doc.layers.splice(current, 1);
    }
    const next = doc.layers[Math.min(firstIndex, doc.layers.length - 1)];
    doc.activeLayerId = next?.id ?? '';
    this.selectedLayerIds = new Set(next ? [next.id] : []);
    this.history.push({
      label: removed.length > 1 ? t('msg.layersDeleteLabel', { n: removed.length }) : t('msg.layerDeleteLabel'),
      undo: () => {
        for (const { layer: item, at } of [...removed].reverse()) {
          doc.layers.splice(Math.min(at, doc.layers.length), 0, item);
        }
        doc.activeLayerId = previousActive;
        this.selectedLayerIds = previousSelection;
        this.renderAll();
      },
      redo: () => {
        for (const { layer: item } of removed) {
          const current = doc.layers.findIndex((entry) => entry.id === item.id);
          if (current >= 0) doc.layers.splice(current, 1);
        }
        const fallback = doc.layers[Math.min(firstIndex, doc.layers.length - 1)];
        doc.activeLayerId = fallback?.id ?? '';
        this.selectedLayerIds = new Set(fallback ? [fallback.id] : []);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.setMessage(t('msg.layerDeleted'));
  }

  private moveActiveLayer(delta: number): void {
    const doc = this.doc;
    if (!doc) return;
    const targets = this.selectedLayers().length > 0 ? this.selectedLayers() : [this.activeLayer].filter(Boolean) as Layer[];
    if (targets.length === 0) return;
    if (this.adjustment) this.cancelAdjustment();
    if (targets.some((item) => item.locked)) {
      this.toast(t('msg.lockedNoMove'), 'info');
      return;
    }
    // On part du haut quand on monte, du bas quand on descend : les calques
    // sélectionnés ne se chevauchent jamais en cours de route.
    const list = delta > 0 ? [...targets].reverse() : targets;
    const before = doc.layers.map((item) => item.id);
    let moved = false;
    for (const layer of list) {
      const index = doc.layers.findIndex((item) => item.id === layer.id);
      const nextIndex = clamp(index + delta, 0, doc.layers.length - 1);
      if (index < 0 || nextIndex === index) continue;
      doc.layers.splice(index, 1);
      doc.layers.splice(nextIndex, 0, layer);
      moved = true;
    }
    if (!moved) return;
    const after = doc.layers.map((item) => item.id);
    this.history.push({
      label: t('msg.layerReorder'),
      undo: () => {
        this.reorderTo(before);
        this.renderAll();
      },
      redo: () => {
        this.reorderTo(after);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
  }

  /** Réapplique un ordre mémorisé (identifiants) au document. */
  private reorderTo(order: string[]): void {
    const doc = this.doc;
    if (!doc) return;
    const byId = new Map(doc.layers.map((layer) => [layer.id, layer]));
    const next: Layer[] = [];
    for (const id of order) {
      const layer = byId.get(id);
      if (layer) {
        next.push(layer);
        byId.delete(id);
      }
    }
    // Les calques apparus entre-temps restent en haut.
    for (const layer of byId.values()) next.push(layer);
    doc.layers = next;
  }

  /** Sélectionne le calque voisin (Alt + [ / Alt + ]). */
  private selectAdjacentLayer(delta: number): void {
    const doc = this.doc;
    if (!doc || doc.layers.length === 0) return;
    const index = doc.layers.findIndex((item) => item.id === doc.activeLayerId);
    const next = doc.layers[clamp(index + delta, 0, doc.layers.length - 1)];
    if (next) this.selectLayer(next.id);
  }

  /** Vide le calque actif sans le supprimer (Maj + Suppr). */
  private clearActiveLayerContent(): void {
    const layer = this.activeLayer;
    if (!layer) return;
    if (this.layerLocked(layer)) return;
    const before = cloneCanvas(layer.canvas);
    const ctx = canvasContext(layer.canvas);
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    const after = cloneCanvas(layer.canvas);
    layer.kind = 'raster';
    layer.text = undefined;
    layer.path = undefined;
    this.history.push({
      label: t('msg.layerCleared'),
      undo: () => {
        layer.canvas = before;
        this.invalidateBounds(layer.id);
        this.renderAll();
      },
      redo: () => {
        layer.canvas = after;
        this.invalidateBounds(layer.id);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.invalidateBounds(layer.id);
    this.renderAll();
    this.setMessage(t('msg.layerCleared'));
  }

  /** Fusionne le calque actif dans celui du dessous (Ctrl + E). */
  private mergeDown(): void {
    const doc = this.doc;
    if (!doc) return;
    const index = doc.layers.findIndex((item) => item.id === doc.activeLayerId);
    const layer = doc.layers[index];
    const below = doc.layers[index - 1];
    if (!layer || !below) {
      this.toast(t('msg.mergeNeedsTwo'), 'info');
      return;
    }
    if (this.layerLocked(layer) || this.layerLocked(below)) return;
    const belowBefore = cloneCanvas(below.canvas);
    const belowProps = { opacity: below.opacity, blend: below.blend, kind: below.kind, text: below.text, path: below.path };
    const ctx = canvasContext(below.canvas);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    if (layer.mask && layer.maskEnabled !== false) {
      const blended = blendThroughMask(below.canvas, layer.canvas, layer.mask);
      ctx.clearRect(0, 0, below.canvas.width, below.canvas.height);
      ctx.drawImage(blended, 0, 0);
    } else {
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.restore();
    below.kind = 'raster';
    below.text = undefined;
    below.path = undefined;
    below.opacity = 1;
    below.blend = 'source-over';
    doc.layers.splice(index, 1);
    doc.activeLayerId = below.id;
    this.history.push({
      label: t('msg.merged'),
      undo: () => {
        below.canvas = belowBefore;
        below.opacity = belowProps.opacity;
        below.blend = belowProps.blend;
        below.kind = belowProps.kind;
        below.text = belowProps.text;
        below.path = belowProps.path;
        doc.layers.splice(index, 0, layer);
        doc.activeLayerId = layer.id;
        this.invalidateBounds();
        this.renderAll();
      },
      redo: () => {
        const current = doc.layers.findIndex((item) => item.id === layer.id);
        if (current >= 0) doc.layers.splice(current, 1);
        const context = canvasContext(below.canvas);
        context.clearRect(0, 0, below.canvas.width, below.canvas.height);
        context.save();
        context.globalAlpha = layer.opacity;
        context.globalCompositeOperation = layer.blend;
        context.drawImage(layer.canvas, 0, 0);
        context.restore();
        below.kind = 'raster';
        below.text = undefined;
        below.path = undefined;
        below.opacity = 1;
        below.blend = 'source-over';
        doc.activeLayerId = below.id;
        this.invalidateBounds();
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.invalidateBounds();
    this.renderAll();
    this.setMessage(t('msg.merged'));
  }

  /**
   * Déplacement au clavier (flèches). Les appuis rapprochés sont regroupés en
   * une seule étape d'historique : sinon Ctrl+Z annulerait pixel par pixel.
   */
  private nudgeActiveLayer(dx: number, dy: number): void {
    const layer = this.activeLayer;
    if (!layer) return;
    if (this.layerLocked(layer)) return;
    if (this.nudge && this.nudge.layerId !== layer.id) this.commitNudge();
    if (!this.nudge) {
      const raster = layer.kind !== 'text' && layer.kind !== 'path';
      this.nudge = {
        layerId: layer.id,
        dx: 0,
        dy: 0,
        canvas: raster ? cloneCanvas(layer.canvas) : undefined,
        text: layer.text ? deepClone(layer.text) : undefined,
        path: layer.path ? deepClone(layer.path) : undefined,
        timer: 0,
      };
    }
    const session = this.nudge;
    session.dx += dx;
    session.dy += dy;
    const totalX = session.dx;
    const totalY = session.dy;
    if (layer.kind === 'text' && layer.text && session.text) {
      layer.text.x = session.text.x + totalX;
      layer.text.y = session.text.y + totalY;
      renderLayer(layer);
    } else if (layer.kind === 'path' && layer.path && session.path) {
      layer.path.anchors = session.path.anchors.map((anchor) => ({
        ...anchor,
        x: anchor.x + totalX,
        y: anchor.y + totalY,
      }));
      renderLayer(layer);
    } else if (session.canvas) {
      const ctx = canvasContext(layer.canvas);
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.drawImage(session.canvas, Math.round(totalX), Math.round(totalY));
    }
    this.invalidateBounds(layer.id);
    this.renderCanvas();
    this.renderOverlay();
    this.setMessage(`Δx ${Math.round(totalX)} · Δy ${Math.round(totalY)}`);
    window.clearTimeout(session.timer);
    session.timer = window.setTimeout(() => this.commitNudge(), 500);
  }

  private commitNudge(): void {
    const session = this.nudge;
    this.nudge = null;
    if (!session) return;
    const doc = this.doc;
    const layer = doc?.layers.find((item) => item.id === session.layerId);
    if (!layer) return;
    window.clearTimeout(session.timer);
    if (session.dx === 0 && session.dy === 0) return;
    const dx = session.dx;
    const dy = session.dy;
    const before = session.canvas;
    const beforeText = session.text;
    const beforePath = session.path;
    const after = cloneCanvas(layer.canvas);
    const afterText = layer.text ? deepClone(layer.text) : undefined;
    const afterPath = layer.path ? deepClone(layer.path) : undefined;
    this.history.push({
      label: t('msg.nudge'),
      undo: () => {
        if (beforeText && afterText) {
          layer.text = deepClone(beforeText);
          renderLayer(layer);
        } else if (beforePath && afterPath) {
          layer.path = deepClone(beforePath);
          renderLayer(layer);
        } else if (before) {
          const ctx = canvasContext(layer.canvas);
          ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          ctx.drawImage(before, 0, 0);
        }
        this.invalidateBounds(layer.id);
        this.renderAll();
      },
      redo: () => {
        if (beforeText && afterText) {
          layer.text = deepClone(afterText);
          renderLayer(layer);
        } else if (beforePath && afterPath) {
          layer.path = deepClone(afterPath);
          renderLayer(layer);
        } else if (before) {
          const ctx = canvasContext(layer.canvas);
          ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          ctx.drawImage(after, 0, 0);
        }
        this.invalidateBounds(layer.id);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.setMessage(`Δx ${Math.round(dx)} · Δy ${Math.round(dy)}`);
  }

  private swapColors(): void {
    const primary = this.primaryColor;
    this.primaryColor = this.secondaryColor;
    this.secondaryColor = primary;
    this.syncColors();
    this.renderToolOptions();
  }

  private resetColors(): void {
    this.primaryColor = '#111114';
    this.secondaryColor = '#ffffff';
    this.syncColors();
    this.renderToolOptions();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Adjustments
  // ───────────────────────────────────────────────────────────────────────────

  private openAdjustment(id: AdjustmentId): void {
    if (!this.doc) {
      this.toast(t('msg.openBeforeAdjust'), 'error');
      return;
    }
    const layer = this.activeLayer;
    if (!layer) {
      this.toast(t('msg.selectLayer'), 'error');
      return;
    }
    if (this.layerLocked(layer)) return;
    if (this.adjustment) this.cancelAdjustment();
    this.pendingCrop = null;
    this.renderOverlay();
    if (layer.mask && layer.maskEditing) {
      layer.maskEditing = false;
      this.layersDirty = true;
    }
    const ctx = canvasContext(layer.canvas);
    const original = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);

    // Aperçu réduit : sur une image 6000 × 4000, calculer 24 M de pixels à
    // chaque mouvement de glissière bloquerait l'interface. L'aperçu travaille
    // sur 1800 px de côté au maximum ; « Appliquer » recalcule en pleine résolution.
    const previewScale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(layer.canvas.width, layer.canvas.height));
    let preview = original;
    const previewCanvas = createCanvas(
      Math.max(1, Math.round(layer.canvas.width * previewScale)),
      Math.max(1, Math.round(layer.canvas.height * previewScale)),
    );
    if (previewScale < 1) {
      const previewContext = canvasContext(previewCanvas);
      previewContext.imageSmoothingQuality = 'medium';
      previewContext.drawImage(layer.canvas, 0, 0, previewCanvas.width, previewCanvas.height);
      preview = previewContext.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    }

    this.curveChannel = 'rgb';
    this.lastPreviewAt = 0;
    this.adjustment = {
      id,
      layerId: layer.id,
      original,
      preview,
      previewScale,
      previewCanvas,
      params: defaultParams(id),
      channel: 'rgb',
      curves: defaultCurves(),
      histogram: computeHistogram(preview),
    };
    this.renderToolOptions();
    window.setTimeout(() => {
      this.toolOptions.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 30);
    this.setMessage(t('adjust.live', { name: t(`adjust.${id}`) }));
  }

  private scheduleAdjustmentPreview(): void {
    if (this.adjustmentFrame || this.adjustmentTimer) return;
    const elapsed = performance.now() - this.lastPreviewAt;
    if (elapsed < PREVIEW_MIN_INTERVAL) {
      this.adjustmentTimer = window.setTimeout(() => {
        this.adjustmentTimer = 0;
        this.scheduleAdjustmentPreview();
      }, PREVIEW_MIN_INTERVAL - elapsed);
      return;
    }
    this.adjustmentFrame = window.requestAnimationFrame(() => {
      this.adjustmentFrame = 0;
      this.previewAdjustment();
    });
  }

  private previewAdjustment(): void {
    const adjustment = this.adjustment;
    const doc = this.doc;
    if (!adjustment || !doc) return;
    const layer = doc.layers.find((item) => item.id === adjustment.layerId);
    if (!layer) return;
    this.lastPreviewAt = performance.now();
    adjustment.channel = this.curveChannel;
    const scale = adjustment.previewScale;
    const selection = scale < 1 && this.selection
      ? scaleSelection(this.selection, scale)
      : this.selection;
    const result = adjustImageData(adjustment.preview, {
      id: adjustment.id,
      params: adjustment.params,
      selection,
      mask: this.adjustmentCoverage(selection, adjustment.preview.width, adjustment.preview.height),
      curves: adjustment.curves,
      channel: adjustment.channel,
    });
    const ctx = canvasContext(layer.canvas);
    if (scale >= 1) {
      ctx.putImageData(result, 0, 0);
    } else {
      const previewContext = canvasContext(adjustment.previewCanvas);
      previewContext.putImageData(result, 0, 0);
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(adjustment.previewCanvas, 0, 0, layer.canvas.width, layer.canvas.height);
    }
    this.renderCanvas();
    this.renderOverlay();
    this.updateStatus();
  }

  private applyAdjustment(): void {
    const adjustment = this.adjustment;
    const doc = this.doc;
    if (!adjustment || !doc) return;
    if (this.adjustmentFrame) {
      cancelAnimationFrame(this.adjustmentFrame);
      this.adjustmentFrame = 0;
    }
    if (this.adjustmentTimer) {
      window.clearTimeout(this.adjustmentTimer);
      this.adjustmentTimer = 0;
    }
    const layer = doc.layers.find((item) => item.id === adjustment.layerId);
    if (!layer) return;
    const ctx = canvasContext(layer.canvas);
    adjustment.channel = this.curveChannel;
    const finalData = adjustImageData(adjustment.original, {
      id: adjustment.id,
      params: adjustment.params,
      selection: this.selection,
      mask: this.adjustmentCoverage(
        this.selection,
        adjustment.original.width,
        adjustment.original.height,
      ),
      curves: adjustment.curves,
      channel: adjustment.channel,
    });
    ctx.putImageData(finalData, 0, 0);
    const beforeMeta = {
      kind: layer.kind,
      text: layer.text ? deepClone(layer.text) : undefined,
      path: layer.path ? deepClone(layer.path) : undefined,
    };
    layer.kind = 'raster';
    layer.text = undefined;
    layer.path = undefined;
    const afterMeta = { kind: layer.kind, text: undefined, path: undefined };
    const label = t(`adjust.${adjustment.id}`);
    this.history.push({
      label,
      undo: () => {
        ctx.putImageData(adjustment.original, 0, 0);
        layer.kind = beforeMeta.kind;
        layer.text = beforeMeta.text ? deepClone(beforeMeta.text) : undefined;
        layer.path = beforeMeta.path ? deepClone(beforeMeta.path) : undefined;
        this.renderAll();
      },
      redo: () => {
        ctx.putImageData(finalData, 0, 0);
        layer.kind = afterMeta.kind;
        layer.text = undefined;
        layer.path = undefined;
        this.renderAll();
      },
    });
    this.adjustment = null;
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('adjust.applied', { name: label }));
    this.toast(t('adjust.applied', { name: label }), 'success');
  }

  private cancelAdjustment(): void {
    if (this.adjustmentFrame) {
      cancelAnimationFrame(this.adjustmentFrame);
      this.adjustmentFrame = 0;
    }
    if (this.adjustmentTimer) {
      window.clearTimeout(this.adjustmentTimer);
      this.adjustmentTimer = 0;
    }
    const adjustment = this.adjustment;
    if (!adjustment || !this.doc) {
      this.adjustment = null;
      return;
    }
    const layer = this.doc.layers.find((item) => item.id === adjustment.layerId);
    if (layer) {
      const ctx = canvasContext(layer.canvas);
      ctx.putImageData(adjustment.original, 0, 0);
      this.renderCanvas();
      this.renderOverlay();
      this.layersDirty = true;
      this.requestFrame();
    }
    this.adjustment = null;
  }

  private resetAdjustment(): void {
    if (!this.adjustment) return;
    this.adjustment.params = defaultParams(this.adjustment.id);
    this.adjustment.curves = defaultCurves();
    this.adjustment.channel = 'rgb';
    this.curveChannel = 'rgb';
    this.renderToolOptions();
    this.scheduleAdjustmentPreview();
  }

  /** Courbes prêtes à l'emploi : droite, contraste en S, éclaircissement. */
  private applyCurvePreset(preset: 'linear' | 'contrast' | 'bright'): void {
    if (!this.adjustment) return;
    const channel = this.curveChannel;
    const points: CurvePoint[] = preset === 'linear'
      ? [{ x: 0, y: 0 }, { x: 255, y: 255 }]
      : preset === 'contrast'
        ? [
            { x: 0, y: 0 },
            { x: 64, y: 48 },
            { x: 128, y: 128 },
            { x: 192, y: 208 },
            { x: 255, y: 255 },
          ]
        : [
            { x: 0, y: 0 },
            { x: 64, y: 84 },
            { x: 128, y: 158 },
            { x: 192, y: 212 },
            { x: 255, y: 255 },
          ];
    this.adjustment.curves = {
      ...this.adjustment.curves,
      [channel]: points,
    };
    this.renderToolOptions();
    this.scheduleAdjustmentPreview();
  }

  private wireCurveEditor(): void {
    const adjustment = this.adjustment;
    if (!adjustment) return;
    const svg = document.getElementById('curve-editor') as SVGSVGElement | null;
    if (!svg) return;
    const points = adjustment.curves[this.curveChannel] ?? defaultCurves().rgb;
    const toValue = (event: PointerEvent): Point => {
      const rect = svg.getBoundingClientRect();
      return {
        x: clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 256, 0, 255),
        y: clamp(255 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 256, 0, 255),
      };
    };
    const nearest = (value: Point): number => {
      let best = -1;
      let bestDistance = Infinity;
      points.forEach((point, index) => {
        const distance = Math.hypot(point.x - value.x, point.y - value.y);
        if (distance < bestDistance && distance < 16) {
          best = index;
          bestDistance = distance;
        }
      });
      return best;
    };
    let dragging: number | null = null;

    const redraw = () => {
      this.drawCurveEditor(points);
      this.scheduleAdjustmentPreview();
    };

    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const value = toValue(event);
      let index = nearest(value);
      if (index < 0) {
        points.push({ x: clamp(Math.round(value.x), 1, 254), y: Math.round(value.y) });
        points.sort((a, b) => a.x - b.x);
        index = points.findIndex(
          (point) => point.x === clamp(Math.round(value.x), 1, 254) && point.y === Math.round(value.y),
        );
      }
      dragging = index >= 0 ? index : null;
      if (dragging !== null) {
        svg.setPointerCapture(event.pointerId);
        redraw();
      }
    });

    svg.addEventListener('pointermove', (event) => {
      if (dragging === null) return;
      const point = points[dragging];
      if (!point) return;
      const value = toValue(event);
      if (dragging === 0) point.x = 0;
      else if (dragging === points.length - 1) point.x = 255;
      else {
        const prev = points[dragging - 1]?.x ?? 0;
        const next = points[dragging + 1]?.x ?? 255;
        point.x = clamp(value.x, prev + 1, next - 1);
      }
      point.y = clamp(value.y, 0, 255);
      redraw();
    });

    svg.addEventListener('pointerup', () => {
      dragging = null;
    });

    svg.addEventListener('dblclick', (event) => {
      const value = toValue(event as unknown as PointerEvent);
      const index = nearest(value);
      if (index > 0 && index < points.length - 1) {
        points.splice(index, 1);
        redraw();
      }
    });

    this.drawCurveEditor(points);
  }

  private drawCurveEditor(points: CurvePoint[]): void {
    const svg = document.getElementById('curve-editor') as SVGSVGElement | null;
    if (!svg) return;
    const path = svg.querySelector<SVGPathElement>('#curve-path');
    if (path) {
      // Même courbe lissée (PCHIP) que le rendu : l'écran ne ment pas.
      path.setAttribute('d', curveToPath(points));
    }
    const group = svg.querySelector<SVGGElement>('#curve-points');
    if (!group) return;
    group.innerHTML = points
      .map(
        (point) =>
          `<circle cx="${point.x}" cy="${255 - point.y}" r="5" class="curve-point" vector-effect="non-scaling-stroke"></circle>`,
      )
      .join('');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // New document dialog
  // ───────────────────────────────────────────────────────────────────────────

  private bindNewDocumentDialog(): void {
    const width = byId<HTMLInputElement>('new-width');
    const height = byId<HTMLInputElement>('new-height');
    const dpi = byId<HTMLInputElement>('new-dpi');
    const lock = byId<HTMLButtonElement>('new-ratio-lock');
    const preview = byId('new-preview-box');

    const sync = () => {
      const w = Math.max(1, Number(width.value) || 1);
      const h = Math.max(1, Number(height.value) || 1);
      const scale = Math.min(220 / w, 150 / h, 1);
      preview.style.width = `${Math.max(24, w * scale)}px`;
      preview.style.height = `${Math.max(24, h * scale)}px`;
      const background = this.newDocModal.querySelector<HTMLElement>('[data-bg].is-active')?.dataset.bg;
      preview.style.background = background === 'black'
        ? '#000000'
        : background === 'transparent'
          ? 'repeating-conic-gradient(#d6d6da 0% 25%, #f4f4f6 0% 50%) 0 0 / 12px 12px'
          : '#f2f2f4';
      byId('new-preview-label').textContent =
        `${Math.round(w)} × ${Math.round(h)} px · ${Math.max(1, Math.round(Number(dpi.value) || 72))} ${t('common.dpi')}`;
    };

    const setPreset = (button: HTMLElement) => {
      const w = Number(button.dataset.width) || 1920;
      const h = Number(button.dataset.height) || 1080;
      const resolution = Number(button.dataset.dpi) || 72;
      width.value = String(w);
      height.value = String(h);
      dpi.value = String(resolution);
      this.newDocRatio = w / h;
      for (const node of this.newDocModal.querySelectorAll('[data-preset]')) {
        node.classList.toggle('is-active', node === button);
      }
      sync();
    };

    for (const button of this.newDocModal.querySelectorAll<HTMLElement>('[data-preset]')) {
      button.addEventListener('click', () => setPreset(button));
    }

    width.addEventListener('input', () => {
      if (this.newDocRatioLock) {
        const w = Math.max(1, Number(width.value) || 1);
        height.value = String(Math.max(1, Math.round(w / this.newDocRatio)));
      }
      for (const node of this.newDocModal.querySelectorAll('[data-preset]')) node.classList.remove('is-active');
      sync();
    });
    height.addEventListener('input', () => {
      if (this.newDocRatioLock) {
        const h = Math.max(1, Number(height.value) || 1);
        width.value = String(Math.max(1, Math.round(h * this.newDocRatio)));
      }
      for (const node of this.newDocModal.querySelectorAll('[data-preset]')) node.classList.remove('is-active');
      sync();
    });
    dpi.addEventListener('input', sync);

    lock.addEventListener('click', () => {
      this.newDocRatioLock = !this.newDocRatioLock;
      lock.classList.toggle('is-active', this.newDocRatioLock);
      lock.setAttribute('aria-pressed', String(this.newDocRatioLock));
      if (this.newDocRatioLock) {
        const w = Math.max(1, Number(width.value) || 1);
        const h = Math.max(1, Number(height.value) || 1);
        this.newDocRatio = w / h;
      }
    });

    for (const button of this.newDocModal.querySelectorAll<HTMLElement>('[data-bg]')) {
      button.addEventListener('click', () => {
        for (const node of this.newDocModal.querySelectorAll('[data-bg]')) node.classList.remove('is-active');
        button.classList.add('is-active');
        sync();
      });
    }

    byId<HTMLButtonElement>('new-create').addEventListener('click', () => {
      const w = clamp(Number(width.value) || 0, 1, 16384);
      const h = clamp(Number(height.value) || 0, 1, 16384);
      const resolution = clamp(Number(dpi.value) || 72, 1, 1200);
      const activeBg = this.newDocModal.querySelector<HTMLElement>('[data-bg].is-active');
      const background = (activeBg?.dataset.bg as PhotoDoc['background']) ?? 'white';
      this.createNewDocument(w, h, resolution, background);
    });
    byId<HTMLButtonElement>('new-cancel').addEventListener('click', () => this.closeNewDocumentDialog());
    byId<HTMLButtonElement>('new-open-computer').addEventListener('click', () => {
      this.closeNewDocumentDialog();
      void this.openImageFlow();
    });
    byId<HTMLButtonElement>('new-close').addEventListener('click', () => this.closeNewDocumentDialog());
    this.newDocModal.addEventListener('click', (event) => {
      if (event.target === this.newDocModal) this.closeNewDocumentDialog();
    });

    this.syncNewDocPreview = sync;

    // Le premier preset est actif par défaut.
    const firstPreset = this.newDocModal.querySelector<HTMLElement>('[data-preset]');
    if (firstPreset) {
      this.newDocRatio = (Number(firstPreset.dataset.width) || 1920) / (Number(firstPreset.dataset.height) || 1080);
      firstPreset.classList.add('is-active');
    }
    sync();
  }

  private syncNewDocPreview: () => void = () => {};

  private openNewDocumentDialog(reset = false): void {
    if (this.adjustment) {
      this.cancelAdjustment();
      this.renderToolOptions();
    }
    const width = byId<HTMLInputElement>('new-width');
    const height = byId<HTMLInputElement>('new-height');
    const dpi = byId<HTMLInputElement>('new-dpi');
    if (reset || !width.value) {
      width.value = '1920';
      height.value = '1080';
      dpi.value = '72';
      this.newDocRatio = 16 / 9;
    }
    const lock = byId<HTMLButtonElement>('new-ratio-lock');
    lock.classList.toggle('is-active', this.newDocRatioLock);
    lock.setAttribute('aria-pressed', String(this.newDocRatioLock));
    this.closeCanvasMenu();
    this.newDocModal.classList.add('is-open');
    this.syncNewDocPreview();
    window.setTimeout(() => {
      width.focus();
      width.select();
    }, 60);
  }

  private closeNewDocumentDialog(): void {
    this.newDocModal.classList.remove('is-open');
    // Le champ de saisie gardait le focus après la fermeture : les raccourcis
    // clavier (V, M, B…) étaient alors ignorés.
    (document.activeElement as HTMLElement | null)?.blur();
    if (!this.doc) this.emptyState.hidden = false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Image / canvas resize dialog
  // ───────────────────────────────────────────────────────────────────────────

  private bindResizeDialog(): void {
    const width = byId<HTMLInputElement>('resize-width');
    const height = byId<HTMLInputElement>('resize-height');
    const lock = byId<HTMLButtonElement>('resize-ratio-lock');

    const syncLock = () => {
      lock.classList.toggle('is-active', this.resizeRatioLock);
      lock.setAttribute('aria-pressed', String(this.resizeRatioLock));
    };

    width.addEventListener('input', () => {
      if (!this.resizeRatioLock) return;
      const w = Math.max(1, Number(width.value) || 1);
      height.value = String(Math.max(1, Math.round(w / this.resizeRatio)));
    });
    height.addEventListener('input', () => {
      if (!this.resizeRatioLock) return;
      const h = Math.max(1, Number(height.value) || 1);
      width.value = String(Math.max(1, Math.round(h * this.resizeRatio)));
    });
    lock.addEventListener('click', () => {
      this.resizeRatioLock = !this.resizeRatioLock;
      if (this.resizeRatioLock) {
        const w = Math.max(1, Number(width.value) || 1);
        const h = Math.max(1, Number(height.value) || 1);
        this.resizeRatio = w / h;
      }
      syncLock();
    });

    for (const button of this.resizeModal.querySelectorAll<HTMLElement>('[data-anchor]')) {
      button.addEventListener('click', () => {
        this.resizeAnchor = {
          x: Number(button.dataset.anchorX) || 0.5,
          y: Number(button.dataset.anchorY) || 0.5,
        };
        this.updateResizeAnchorUI();
      });
    }

    byId<HTMLButtonElement>('resize-apply').addEventListener('click', () => this.applyResize());
    byId<HTMLButtonElement>('resize-cancel').addEventListener('click', () => this.closeResizeDialog());
    byId<HTMLButtonElement>('resize-close').addEventListener('click', () => this.closeResizeDialog());
    this.resizeModal.addEventListener('click', (event) => {
      if (event.target === this.resizeModal) this.closeResizeDialog();
    });
  }

  private openResizeDialog(mode: 'image' | 'canvas'): void {
    if (!this.doc) {
      this.toast('Ouvrez un document.', 'error');
      return;
    }
    if (this.adjustment) {
      this.cancelAdjustment();
      this.renderToolOptions();
    }
    this.resizeMode = mode;
    this.closeCanvasMenu();
    const width = byId<HTMLInputElement>('resize-width');
    const height = byId<HTMLInputElement>('resize-height');
    const dpi = byId<HTMLInputElement>('resize-dpi');
    width.value = String(this.doc.width);
    height.value = String(this.doc.height);
    dpi.value = String(Math.round(this.doc.dpi));
    this.resizeRatio = this.doc.width / this.doc.height;
    this.resizeRatioLock = mode === 'image';
    this.resizeAnchor = { x: 0.5, y: 0.5 };
    byId('resize-title').textContent = mode === 'image' ? t('resize.imageTitle') : t('resize.canvasTitle');
    byId('resize-subtitle').textContent = mode === 'image'
      ? t('resize.imageSubtitle')
      : t('resize.canvasSubtitle');
    byId('resize-dpi-row').hidden = mode !== 'image';
    byId('resize-anchor-row').hidden = mode !== 'canvas';
    byId('resize-note').textContent = mode === 'image'
      ? t('resize.quality')
      : t('resize.anchorHint');
    const lock = byId<HTMLButtonElement>('resize-ratio-lock');
    lock.hidden = mode !== 'image';
    lock.classList.toggle('is-active', this.resizeRatioLock);
    lock.setAttribute('aria-pressed', String(this.resizeRatioLock));
    this.updateResizeAnchorUI();
    this.resizeModal.classList.add('is-open');
    window.setTimeout(() => {
      width.focus();
      width.select();
    }, 60);
  }

  private closeResizeDialog(): void {
    this.resizeModal.classList.remove('is-open');
  }

  private updateResizeAnchorUI(): void {
    for (const button of this.resizeModal.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const x = Number(button.dataset.anchorX);
      const y = Number(button.dataset.anchorY);
      button.classList.toggle(
        'is-active',
        Math.abs(x - this.resizeAnchor.x) < 0.01 && Math.abs(y - this.resizeAnchor.y) < 0.01,
      );
    }
  }

  private applyResize(): void {
    const doc = this.doc;
    if (!doc) return;
    const width = clamp(Math.round(Number(byId<HTMLInputElement>('resize-width').value) || 0), 1, 16384);
    const height = clamp(Math.round(Number(byId<HTMLInputElement>('resize-height').value) || 0), 1, 16384);
    const dpi = clamp(Math.round(Number(byId<HTMLInputElement>('resize-dpi').value) || 72), 1, 1200);
    if (this.resizeMode === 'image' && width === doc.width && height === doc.height && dpi === doc.dpi) {
      this.closeResizeDialog();
      return;
    }
    if (this.resizeMode === 'canvas' && width === doc.width && height === doc.height) {
      this.closeResizeDialog();
      return;
    }
    const before = snapshotGeometry(doc);
    let after: DocGeometrySnapshot;
    if (this.resizeMode === 'image') {
      after = resizeDocumentImage(doc, width, height, dpi, SMOOTHING_QUALITY[this.preferences.quality]);
    } else {
      after = resizeDocumentCanvas(doc, width, height, this.resizeAnchor.x, this.resizeAnchor.y);
    }
    const label = this.resizeMode === 'image' ? t('resize.imageTitle') : t('resize.canvasTitle');
    this.history.push({
      label,
      undo: () => {
        restoreGeometry(doc, before);
        this.selection = null;
        this.fitToView();
        this.renderAll();
      },
      redo: () => {
        restoreGeometry(doc, after);
        this.selection = null;
        this.fitToView();
        this.renderAll();
      },
    });
    this.closeResizeDialog();
    this.selection = null;
    this.pendingCrop = null;
    this.fitToView();
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(`${label} · ${doc.width} × ${doc.height} px`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Export dialog
  // ───────────────────────────────────────────────────────────────────────────

  private bindExportDialog(): void {
    for (const button of this.exportModal.querySelectorAll<HTMLElement>('[data-format]')) {
      button.addEventListener('click', () => {
        this.exportFormat = (button.dataset.format as ExportFormat) ?? 'png';
        this.updateExportFormatUI();
      });
    }
    const quality = byId<HTMLInputElement>('export-quality');
    quality.addEventListener('input', () => {
      byId('export-quality-value').textContent = `${quality.value} %`;
    });
    byId<HTMLButtonElement>('export-run').addEventListener('click', () => void this.doExport());
    byId<HTMLButtonElement>('export-cancel').addEventListener('click', () => this.closeExportDialog());
    byId<HTMLButtonElement>('export-close').addEventListener('click', () => this.closeExportDialog());
    this.exportModal.addEventListener('click', (event) => {
      if (event.target === this.exportModal) this.closeExportDialog();
    });
  }

  private openExportDialog(): void {
    if (!this.doc) {
      this.toast(t('export.noDocument'), 'error');
      return;
    }
    if (this.adjustment) {
      this.cancelAdjustment();
      this.renderToolOptions();
    }
    this.exportFormat = 'png';
    this.closeCanvasMenu();
    const filename = byId<HTMLInputElement>('export-filename');
    filename.value = `${sanitizeFilename(this.doc.name)}.png`;
    byId('export-dimensions').textContent =
      `${this.doc.width} × ${this.doc.height} px · ${Math.round(this.doc.dpi)} ${t('common.dpi')}`;
    this.updateExportFormatUI();
    this.exportModal.classList.add('is-open');
    window.setTimeout(() => {
      filename.focus();
      filename.select();
    }, 60);
  }

  private closeExportDialog(): void {
    this.exportModal.classList.remove('is-open');
  }

  private updateExportFormatUI(): void {
    for (const button of this.exportModal.querySelectorAll<HTMLElement>('[data-format]')) {
      button.classList.toggle('is-active', button.dataset.format === this.exportFormat);
    }
    byId('export-quality-row').hidden = this.exportFormat === 'png' || this.exportFormat === 'sps';
    const filename = byId<HTMLInputElement>('export-filename');
    const base = stripExtension(filename.value.trim() || 'superphoto');
    const extension = this.exportFormat === 'jpeg' ? 'jpg' : this.exportFormat;
    filename.value = `${base}.${extension}`;
    const hint = byId('export-hint');
    const key =
      this.exportFormat === 'sps'
        ? 'export.hintSps'
        : this.exportFormat === 'png'
          ? 'export.hintPng'
          : 'export.hintFlat';
    hint.textContent = t(key);
    hint.dataset.i18n = key;
  }

  private async doExport(): Promise<void> {
    const doc = this.doc;
    if (!doc || this.saving) return;
    this.saving = true;
    const button = byId<HTMLButtonElement>('export-run');
    const label = button.querySelector('span');
    const original = label?.textContent ?? button.textContent ?? '';
    button.disabled = true;
    if (label) label.textContent = t('export.busy');
    try {
      const mime = mimeForFormat(this.exportFormat);
      const quality = Number(byId<HTMLInputElement>('export-quality').value) / 100;
      const blob = this.exportFormat === 'sps'
        ? await serializeProject(doc)
        : await canvasToBlob(
            compositeCanvas(doc, this.exportFormat === 'png' ? null : '#ffffff'),
            mime,
            quality,
          );
      let filename = byId<HTMLInputElement>('export-filename').value.trim() || 'superphoto';
      const expectedExt = extensionForMime(mime);
      if (!filename.toLowerCase().endsWith(`.${expectedExt}`)) {
        filename = `${stripExtension(filename)}.${expectedExt}`;
      }
      const saved = await saveExport(blob, filename, mime);
      if (saved) {
        this.closeExportDialog();
        this.toast(
          this.exportFormat === 'sps'
            ? t('export.projectDone', { name: filename })
            : t('export.done', { name: filename }),
          'success',
        );
      }
    } catch (error) {
      console.error(error);
      this.toast(t('export.failed', { error: this.errorText(error) }), 'error');
    } finally {
      this.saving = false;
      button.disabled = false;
      if (label) label.textContent = original;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Canvas interaction
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Plein écran : la même bascule que SuperPrint, mais qui ne dépend pas de
   * l'API Fullscreen — dans une webview Tauri la touche F11 est aussi gérée
   * par le système, on évite donc de dupliquer l'appel.
   */
  private bindFullscreen(): void {
    const button = byId<HTMLButtonElement>('btn-fullscreen');
    const apply = (): void => {
      const active = Boolean(document.fullscreenElement);
      button.setAttribute('aria-pressed', String(active));
      button.title = active ? t('stage.fullscreenExit') : t('stage.fullscreen');
      button.setAttribute('aria-label', button.title);
    };
    const toggle = (): void => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void document.documentElement.requestFullscreen().catch(() => {
          this.toast(t('msg.fullscreenDenied'), 'error');
        });
      }
    };
    button.addEventListener('click', toggle);
    document.addEventListener('fullscreenchange', () => {
      apply();
      this.invalidateDisplayRect();
      // Le viewport change de taille : on garde le même cadrage.
      window.setTimeout(() => {
        this.invalidateDisplayRect();
        if (this.fitMode) this.fitToView();
      }, 60);
    });
    apply();
  }

  private bindCanvas(): void {
    this.display.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    window.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.viewport.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.pointerInside = false;
        this.updateStatus();
      }
    });
    let wheelFrame = 0;
    let wheelFactor = 1;
    let wheelX = 0;
    let wheelY = 0;
    this.viewport.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        wheelFactor *= event.deltaY < 0 ? 1.12 : 0.89;
        wheelX = event.clientX;
        wheelY = event.clientY;
        if (wheelFrame) return;
        wheelFrame = window.requestAnimationFrame(() => {
          wheelFrame = 0;
          const factor = wheelFactor;
          wheelFactor = 1;
          this.zoomAtPoint(factor, wheelX, wheelY);
        });
      },
      { passive: false },
    );
    this.display.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openCanvasMenu(event);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Menu contextuel de la toile
  // ───────────────────────────────────────────────────────────────────────────

  private bindCanvasMenu(): void {
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (this.canvasMenu && !this.canvasMenu.contains(event.target as Node)) {
          this.closeCanvasMenu();
        }
      },
      true,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !this.canvasMenu) return;
        event.preventDefault();
        event.stopPropagation();
        this.closeCanvasMenu();
      },
      true,
    );
    this.viewport.addEventListener('scroll', () => this.closeCanvasMenu(), { passive: true });
    window.addEventListener('resize', () => this.closeCanvasMenu(), { passive: true });
  }

  private closeCanvasMenu(): void {
    this.canvasMenu?.remove();
    this.canvasMenu = null;
  }

  /**
   * Clic droit dans la toile : les actions de sélection à portée de main, dont
   * « Remplir la sélection ». Le menu reste sobre et se ferme au premier clic
   * extérieur, à Échap ou au défilement.
   */
  private openCanvasMenu(event: MouseEvent): void {
    const doc = this.doc;
    if (!doc || this.adjustment) return;
    this.closeCanvasMenu();
    const selection = this.selection;
    const bounds = selection ? selectionBounds(selection) : null;
    const feather = selection ? selectionFeather(selection) : 0;

    const menu = document.createElement('div');
    menu.className = 'canvas-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('menu.label'));

    const head = document.createElement('div');
    head.className = 'canvas-menu-head';
    head.textContent = selection && bounds
      ? t(feather ? 'status.feather' : 'status.selection', { w: Math.round(bounds.w), h: Math.round(bounds.h), f: feather })
      : t('menu.noSelection');
    menu.appendChild(head);

    const items: Array<
      { label: string; hint?: string; disabled?: boolean; run: () => void } | null
    > = [
      {
        label: t('menu.fill'),
        hint: 'Alt+Retour',
        disabled: !selection,
        run: () => this.fillSelection(this.primaryColor),
      },
      {
        label: t('msg.eraseContent'),
        hint: 'Suppr',
        disabled: !selection,
        run: () => this.clearSelectionContent(),
      },
      null,
      {
        label: t('menu.invert'),
        disabled: !selection,
        run: () => {
          if (!this.selection) return;
          this.selection = { ...this.selection, invert: !this.selection.invert };
          this.renderOverlay();
          this.updateStatus();
        },
      },
      {
        label: t('menu.deselect'),
        hint: 'Esc',
        disabled: !selection,
        run: () => {
          this.selection = null;
          this.renderOverlay();
          this.renderToolOptions();
          this.updateStatus();
        },
      },
      {
        label: t('menu.selectAll'),
        hint: 'Ctrl+A',
        run: () => this.handleAction('select-all'),
      },
    ];

    for (const item of items) {
      if (!item) {
        const separator = document.createElement('div');
        separator.className = 'canvas-menu-sep';
        separator.setAttribute('role', 'separator');
        menu.appendChild(separator);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'canvas-menu-item';
      button.setAttribute('role', 'menuitem');
      button.disabled = Boolean(item.disabled);
      const label = document.createElement('span');
      label.textContent = item.label;
      button.appendChild(label);
      if (item.hint) {
        const hint = document.createElement('kbd');
        hint.textContent = item.hint;
        button.appendChild(hint);
      }
      button.addEventListener('click', () => {
        this.closeCanvasMenu();
        item.run();
      });
      menu.appendChild(button);
    }

    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);
    this.canvasMenu = menu;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const left = clamp(event.clientX, margin, Math.max(margin, window.innerWidth - rect.width - margin));
    const top = clamp(event.clientY, margin, Math.max(margin, window.innerHeight - rect.height - margin));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = 'visible';
    menu.querySelector<HTMLButtonElement>('.canvas-menu-item:not(:disabled)')?.focus();
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.doc) return;
    if (this.adjustment) {
      this.toast(t('msg.finishAdjustment'), 'info');
      return;
    }
    if (event.button === 2) return;
    if (this.spaceDown || this.activeTool === 'hand' || event.button === 1) {
      event.preventDefault();
      this.drag = {
        kind: 'pan',
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: this.viewport.scrollLeft,
        scrollTop: this.viewport.scrollTop,
      };
      this.display.style.cursor = 'grabbing';
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    // Mesure fraîche au début du geste : un panneau refermé ou un onglet
    // ouvert entre-temps a pu déplacer la toile.
    this.invalidateDisplayRect();
    const point = this.docPoint(event);
    this.pointer = point;
    this.pointerInside = true;

    switch (this.activeTool) {
      case 'select': {
        const layer = this.activeLayer;
        const box = this.gizmoRect();
        // 1. Une poignée : on redimensionne le contenu du calque actif.
        const handle = layer && !layer.locked && box ? this.handleAt(point, box) : null;
        if (layer && box && handle) {
          this.drag = {
            kind: 'scale',
            layerId: layer.id,
            handle,
            start: point,
            startRect: { ...box },
            liveRect: { ...box },
            moved: false,
            beforeCanvas: layer.kind === 'raster' || layer.kind === 'shape' ? cloneCanvas(layer.canvas) : undefined,
            beforeText: layer.text ? deepClone(layer.text) : undefined,
            beforePath: layer.path ? deepClone(layer.path) : undefined,
          };
          break;
        }
        // 2. À l'intérieur de la boîte : on déplace le calque affiché.
        // 3. Ailleurs : on déplace ce qui est réellement sous le curseur, sinon
        //    un clic sur un autre objet déplaçait le calque précédent.
        const hit = this.hitTestLayer(point);
        const target = hit ?? (layer && box && pointInRect(point.x, point.y, box) ? layer : null);
        if (!target) break;
        if (this.doc && this.doc.activeLayerId !== target.id) this.selectLayer(target.id);
        // Un calque verrouillé reste sélectionnable mais ne bouge pas.
        if (target.locked) {
          this.setMessage(t('msg.layerIsLocked', { name: target.name }));
          break;
        }
        const bounds = this.layerBounds(target);
        this.drag = {
          kind: 'move',
          layerId: target.id,
          start: point,
          moved: false,
          baseRect: bounds ? { ...bounds } : null,
          liveRect: bounds ? { ...bounds } : null,
          // Cloné au premier vrai déplacement : un simple clic ne copie plus
          // le calque entier (64 Mo sur une image 4000 × 4000).
          beforeCanvas: undefined,
          beforeText: target.text ? deepClone(target.text) : undefined,
          beforePath: target.path ? deepClone(target.path) : undefined,
        };
        break;
      }
      case 'marquee':
        this.drag = {
          kind: 'marquee',
          mode: this.marqueeMode,
          start: point,
          current: point,
          points: [point],
        };
        break;
      case 'magic-wand':
        this.applyMagicWand(point, event.shiftKey);
        break;
      case 'pencil':
      case 'brush':
      case 'eraser':
        this.beginPaint(point, event.altKey && this.activeTool !== 'eraser');
        break;
      case 'heal':
        this.beginPaint(point, false);
        break;
      case 'stamp':
        if (event.altKey) {
          this.stampSource = { ...point };
          this.setMessage(`Source du tampon · x ${Math.round(point.x)} · y ${Math.round(point.y)}`);
          this.renderToolOptions();
        } else {
          this.beginPaint(point, false);
        }
        break;
      case 'patch':
        this.onPatchDown(point);
        break;
      case 'crop':
        this.drag = { kind: 'crop', start: point, current: point, ratio: this.cropRatio };
        break;
      case 'shapes':
        this.drag = { kind: 'shape', start: point, current: point };
        break;
      case 'gradient':
        this.drag = { kind: 'gradient', start: point, current: point };
        break;
      case 'spotlight':
        this.drag = { kind: 'spotlight', start: point, current: point };
        break;
      case 'eyedropper':
        this.sampleColor(event.clientX, event.clientY, event.altKey);
        this.drag = { kind: 'eyedropper' };
        break;
      case 'zoom':
        this.zoomAtPoint(event.altKey ? 0.8 : 1.25, event.clientX, event.clientY);
        break;
      case 'pen':
        this.onPenDown(point, event.shiftKey, event.altKey);
        break;
      case 'text':
        this.onTextDown(point);
        break;
    }
    this.renderOverlay();
    this.updateStatus();
  }

  /**
   * Une seule mise à jour par frame : les événements pointeur peuvent arriver à
   * 240 Hz, l'écran n'en affiche que 60 à 165. On garde le dernier événement et
   * on le traite au prochain rAF (flush immédiat au relâchement).
   */
  private onPointerMove(event: PointerEvent): void {
    this.pendingMove = event;
    if (this.moveFrame) return;
    this.moveFrame = window.requestAnimationFrame(() => {
      this.moveFrame = 0;
      const pending = this.pendingMove;
      this.pendingMove = null;
      if (pending) this.processPointerMove(pending);
    });
  }

  private flushPointerMove(): void {
    if (!this.moveFrame) return;
    window.cancelAnimationFrame(this.moveFrame);
    this.moveFrame = 0;
    const pending = this.pendingMove;
    this.pendingMove = null;
    if (pending) this.processPointerMove(pending);
  }

  private processPointerMove(event: PointerEvent): void {
    if (!this.doc) return;
    const rect = this.currentDisplayRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (inside || this.drag) this.pointer = this.docPoint(event);
    this.pointerInside = inside;
    const drag = this.drag;
    if (!drag) {
      if (this.activeTool === 'spotlight') this.renderOverlay();
      if (this.activeTool === 'pen') this.updatePenHover(event);
      this.updateCanvasCursor();
      this.updateStatus();
      return;
    }
    switch (drag.kind) {
      case 'pan':
        this.viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.clientX);
        this.viewport.scrollTop = drag.scrollTop - (event.clientY - drag.clientY);
        break;
      case 'marquee': {
        const point = this.docPoint(event);
        drag.current = point;
        if (drag.mode === 'lasso') {
          const last = drag.points[drag.points.length - 1];
          if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 2 / this.zoom) {
            drag.points.push(point);
          }
        }
        this.renderOverlay();
        this.updateStatus();
        break;
      }
      case 'crop':
        drag.current = this.constrainPoint(drag.start, this.docPoint(event), event.shiftKey && drag.ratio === null);
        this.renderOverlay();
        break;
      case 'shape':
      case 'gradient':
        drag.current = this.constrainPoint(drag.start, this.docPoint(event), event.shiftKey);
        this.renderOverlay();
        break;
      case 'spotlight':
        drag.current = this.docPoint(event);
        this.renderOverlay();
        break;
      case 'eyedropper':
        this.sampleColor(event.clientX, event.clientY, event.altKey);
        break;
      case 'move':
        this.onMoveDrag(drag, this.docPoint(event));
        break;
      case 'scale':
        this.onScaleDrag(drag, this.docPoint(event), event.shiftKey, event.altKey);
        break;
      case 'paint':
        this.onPaintDrag(drag, this.docPoint(event));
        break;
      case 'patch-region':
      case 'patch-move':
        drag.current = this.docPoint(event);
        this.renderOverlay();
        break;
      case 'pen-anchor':
      case 'pen-handle':
      case 'pen-new-anchor':
        this.onPenMove(event);
        break;
    }
    this.updateStatus();
  }

  private onPointerUp(event: PointerEvent): void {
    this.flushPointerMove();
    const drag = this.drag;
    if (!drag) {
      this.updateStatus();
      return;
    }
    this.drag = null;
    switch (drag.kind) {
      case 'pan':
        break;
      case 'marquee':
        this.finishMarquee(drag);
        break;
      case 'paint':
        this.finishPaint(drag);
        break;
      case 'patch-region': {
        const rect = normalizeRect(drag.start, drag.current);
        this.patchSourceRect =
          rect.w >= 4 && rect.h >= 4
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.w),
                h: Math.round(rect.h),
              }
            : null;
        this.renderOverlay();
        this.renderToolOptions();
        break;
      }
      case 'patch-move':
        this.applyPatchMove(drag);
        break;
      case 'crop':
        this.finishCrop(drag);
        break;
      case 'shape':
        this.finishShape(drag);
        break;
      case 'gradient':
        this.finishGradient(drag);
        break;
      case 'spotlight':
        this.finishSpotlight(drag);
        break;
      case 'move':
        this.finishMove(drag);
        break;
      case 'scale':
        this.finishScale(drag);
        break;
      case 'eyedropper':
        break;
      case 'pen-anchor':
      case 'pen-handle':
      case 'pen-new-anchor':
        this.finishPen(drag);
        break;
    }
    this.display.style.cursor = this.spaceDown ? 'grab' : TOOLS[this.activeTool].cursor;
    this.hoverHandle = null;
    this.updateCanvasCursor();
    this.renderOverlay();
    this.updateStatus();
    void event;
  }

  private onMoveDrag(
    drag: Extract<DragState, { kind: 'move' }>,
    point: Point,
  ): void {
    if (!this.doc) return;
    const layer = this.doc.layers.find((item) => item.id === drag.layerId);
    if (!layer) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    // Seuil exprimé à l'écran : au zoom 25 %, 2 px de document ne font rien,
    // 2 px d'écran suffisent à déplacer par mégarde.
    if (!drag.moved && Math.hypot(dx, dy) * this.zoom <= 3) return;
    if (
      !drag.beforeCanvas &&
      layer.kind !== 'text' &&
      layer.kind !== 'path'
    ) {
      drag.beforeCanvas = cloneCanvas(layer.canvas);
    }
    drag.moved = true;
    if (layer.kind === 'text' && drag.beforeText && layer.text) {
      layer.text.x = drag.beforeText.x + dx;
      layer.text.y = drag.beforeText.y + dy;
      renderLayer(layer);
    } else if (layer.kind === 'path' && drag.beforePath && layer.path) {
      layer.path.anchors = drag.beforePath.anchors.map((anchor) => ({
        ...anchor,
        x: anchor.x + dx,
        y: anchor.y + dy,
      }));
      renderLayer(layer);
    } else if (drag.beforeCanvas) {
      const ctx = canvasContext(layer.canvas);
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.drawImage(drag.beforeCanvas, Math.round(dx), Math.round(dy));
    }
    if (drag.baseRect) {
      drag.liveRect = {
        x: drag.baseRect.x + Math.round(dx),
        y: drag.baseRect.y + Math.round(dy),
        w: drag.baseRect.w,
        h: drag.baseRect.h,
      };
    }
    this.renderCanvas();
    this.renderOverlay();
  }

  private onScaleDrag(
    drag: Extract<DragState, { kind: 'scale' }>,
    point: Point,
    keepRatio: boolean,
    fromCenter: boolean,
  ): void {
    if (!this.doc) return;
    const layer = this.doc.layers.find((item) => item.id === drag.layerId);
    if (!layer) return;
    const next = this.scaleRect(
      drag.startRect,
      drag.handle,
      point.x - drag.start.x,
      point.y - drag.start.y,
      keepRatio,
      fromCenter,
    );
    drag.liveRect = next;
    if (
      Math.abs(next.w - drag.startRect.w) < 0.01 &&
      Math.abs(next.h - drag.startRect.h) < 0.01 &&
      Math.abs(next.x - drag.startRect.x) < 0.01 &&
      Math.abs(next.y - drag.startRect.y) < 0.01
    ) {
      return;
    }
    drag.moved = true;
    this.applyScale(layer, drag.startRect, next, drag);
    this.renderCanvas();
    this.renderOverlay();
  }

  /** Reporte le contenu du calque dans `target` en partant de l'état d'origine. */
  private applyScale(
    layer: Layer,
    base: Rect,
    target: Rect,
    source: { beforeCanvas?: HTMLCanvasElement; beforeText?: TextData; beforePath?: PathData },
  ): void {
    const sx = target.w / Math.max(1, base.w);
    const sy = target.h / Math.max(1, base.h);
    if (layer.kind === 'text' && layer.text && source.beforeText) {
      layer.text.x = target.x + (source.beforeText.x - base.x) * sx;
      layer.text.y = target.y + (source.beforeText.y - base.y) * sy;
      layer.text.fontSize = Math.max(2, source.beforeText.fontSize * sy);
      renderLayer(layer);
      return;
    }
    if (layer.kind === 'path' && layer.path && source.beforePath) {
      layer.path.anchors = source.beforePath.anchors.map((anchor) => ({
        ...anchor,
        x: target.x + (anchor.x - base.x) * sx,
        y: target.y + (anchor.y - base.y) * sy,
        inX: anchor.inX * sx,
        inY: anchor.inY * sy,
        outX: anchor.outX * sx,
        outY: anchor.outY * sy,
      }));
      layer.path.strokeWidth = source.beforePath.strokeWidth * sy;
      renderLayer(layer);
      return;
    }
    if (!source.beforeCanvas) return;
    const ctx = canvasContext(layer.canvas);
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source.beforeCanvas, 0, 0);
    // La zone d'origine est effacée puis redessinée à sa nouvelle place : sans
    // cela, un rétrécissement laisserait l'ancien contour visible.
    ctx.clearRect(base.x, base.y, base.w, base.h);
    ctx.drawImage(
      source.beforeCanvas,
      base.x,
      base.y,
      Math.max(1, base.w),
      Math.max(1, base.h),
      target.x,
      target.y,
      Math.max(1, target.w),
      Math.max(1, target.h),
    );
  }

  private finishMove(drag: Extract<DragState, { kind: 'move' }>): void {
    if (!this.doc) return;
    const layer = this.doc.layers.find((item) => item.id === drag.layerId);
    if (!layer) return;
    if (!drag.moved) {
      const hit = this.hitTestLayer(drag.start);
      if (hit) this.selectLayer(hit.id);
      return;
    }
    if (layer.kind === 'text' && layer.text && drag.beforeText) {
      const before = deepClone(drag.beforeText);
      const after = deepClone(layer.text);
      this.history.push({
        label: t('msg.moveText'),
        undo: () => {
          layer.text = deepClone(before);
          layer.kind = 'text';
          renderLayer(layer);
          this.renderAll();
        },
        redo: () => {
          layer.text = deepClone(after);
          layer.kind = 'text';
          renderLayer(layer);
          this.renderAll();
        },
      });
    } else if (layer.kind === 'path' && layer.path && drag.beforePath) {
      const before = deepClone(drag.beforePath);
      const after = deepClone(layer.path);
      this.history.push({
        label: t('msg.movePath'),
        undo: () => {
          layer.path = deepClone(before);
          layer.kind = 'path';
          renderLayer(layer);
          this.renderAll();
        },
        redo: () => {
          layer.path = deepClone(after);
          layer.kind = 'path';
          renderLayer(layer);
          this.renderAll();
        },
      });
    } else if (drag.beforeCanvas) {
      const before = drag.beforeCanvas;
      const after = cloneCanvas(layer.canvas);
      this.history.push({
        label: t('msg.moveLayer'),
        undo: () => {
          const ctx = canvasContext(layer.canvas);
          ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          ctx.drawImage(before, 0, 0);
          this.renderAll();
        },
        redo: () => {
          const ctx = canvasContext(layer.canvas);
          ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          ctx.drawImage(after, 0, 0);
          this.renderAll();
        },
      });
    }
    this.layersDirty = true;
    this.invalidateBounds(layer.id);
    this.renderAll();
  }

  private finishScale(drag: Extract<DragState, { kind: 'scale' }>): void {
    if (!this.doc) return;
    const layer = this.doc.layers.find((item) => item.id === drag.layerId);
    if (!layer || !drag.moved) {
      if (layer) this.invalidateBounds(layer.id);
      return;
    }
    if (layer.kind === 'text' && layer.text && drag.beforeText) {
      const before = deepClone(drag.beforeText);
      const after = deepClone(layer.text);
      this.history.push({
        label: t('msg.scaleLayer'),
        undo: () => {
          layer.text = deepClone(before);
          renderLayer(layer);
          this.invalidateBounds(layer.id);
          this.renderAll();
        },
        redo: () => {
          layer.text = deepClone(after);
          renderLayer(layer);
          this.invalidateBounds(layer.id);
          this.renderAll();
        },
      });
    } else if (layer.kind === 'path' && layer.path && drag.beforePath) {
      const before = deepClone(drag.beforePath);
      const after = deepClone(layer.path);
      this.history.push({
        label: t('msg.scaleLayer'),
        undo: () => {
          layer.path = deepClone(before);
          renderLayer(layer);
          this.invalidateBounds(layer.id);
          this.renderAll();
        },
        redo: () => {
          layer.path = deepClone(after);
          renderLayer(layer);
          this.invalidateBounds(layer.id);
          this.renderAll();
        },
      });
    } else if (drag.beforeCanvas) {
      const before = drag.beforeCanvas;
      const after = cloneCanvas(layer.canvas);
      this.history.push({
        label: t('msg.scaleLayer'),
        undo: () => {
          const ctx = canvasContext(layer.canvas);
          ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          ctx.drawImage(before, 0, 0);
          this.invalidateBounds(layer.id);
          this.renderAll();
        },
        redo: () => {
          const ctx = canvasContext(layer.canvas);
          ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          ctx.drawImage(after, 0, 0);
          this.invalidateBounds(layer.id);
          this.renderAll();
        },
      });
    }
    this.layersDirty = true;
    this.invalidateBounds(layer.id);
    this.renderAll();
    this.setMessage(
      t('msg.scaleDone', {
        w: Math.round(drag.liveRect.w),
        h: Math.round(drag.liveRect.h),
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Peinture (crayon, pinceau, gomme, tampon, correcteur)
  // ───────────────────────────────────────────────────────────────────────────

  private paintTargetCanvas(): {
    layer: Layer;
    canvas: HTMLCanvasElement;
    isMask: boolean;
  } | null {
    const layer = this.activeLayer;
    if (!layer) return null;
    if (this.layerLocked(layer)) return null;
    if (layer.mask && layer.maskEditing) return { layer, canvas: layer.mask, isMask: true };
    if (layer.kind !== 'raster') {
      // Peindre un texte ou un tracé le rasterise : les métadonnées éditables
      // ne décrivent plus les pixels, on les retire.
      layer.kind = 'raster';
      layer.text = undefined;
      layer.path = undefined;
    }
    return { layer, canvas: layer.canvas, isMask: false };
  }

  private strokeAppearance(    isMask: boolean,
    erase: boolean,
  ): { composite: GlobalCompositeOperation; color: string } {
    if (erase) return { composite: 'destination-out', color: '#000000' };
    if (isMask) {
      return brushColorForMask(this.primaryColor) === 'reveal'
        ? { composite: 'source-over', color: '#ffffff' }
        : { composite: 'destination-out', color: '#000000' };
    }
    return { composite: 'source-over', color: this.primaryColor };
  }

  private beginPaint(point: Point, erase: boolean): void {
    const target = this.paintTargetCanvas();
    if (!target) return;
    const tool = this.activeTool;
    const before = cloneCanvas(target.canvas);
    let source: HTMLCanvasElement | null = null;
    let offset: Point | null = null;
    let shift: { r: number; g: number; b: number } | null = null;
    if (tool === 'stamp' || tool === 'heal') {
      // On échantillonne l'image composée : c'est ce que l'utilisateur voit,
      // et cela évite de cloner la transparence d'un calque isolé.
      source = cloneCanvas(this.display);
      if (!source) return;
      const radius = Math.max(2, this.brush.size / 2);
      if (tool === 'stamp') {
        if (!this.stampSource) {
          this.toast(t('msg.stampFirst'), 'info');
          return;
        }
        offset = { x: this.stampSource.x - point.x, y: this.stampSource.y - point.y };
      } else {
        offset = this.healOffset(source, point, radius);
      }
      if (this.patchOptions.corrector) {
        const sample = { x: point.x + offset.x, y: point.y + offset.y };
        shift = colorShift(
          meanColorAround(source, sample, radius),
          meanColorAround(source, point, radius),
        );
      }
    }
    const label = toolLabel(tool);
    const drag: DragState = {
      kind: 'paint',
      layerId: target.layer.id,
      target: target.isMask ? 'mask' : 'layer',
      last: { ...point },
      carry: 0,
      before,
      source,
      offset,
      label,
      // La gomme efface toujours ; ailleurs Alt transforme le pinceau en gomme.
      erase: erase || tool === 'eraser',
      shift,
    };
    this.drag = drag;
    this.paintAt(drag, point, true);
    this.updateStatus();
  }

  /**
   * Correcteur : on cherche, parmi quatre zones voisines, celle qui ressemble le
   * plus aux autres (consensus). C'est un rejet de valeur aberrante : la tache
   * qu'on veut effacer n'est jamais retenue comme source.
   */
  private healOffset(source: HTMLCanvasElement, point: Point, radius: number): Point {
    const distance = radius * 2.1;
    const candidates = [
      { x: point.x + distance, y: point.y },
      { x: point.x - distance, y: point.y },
      { x: point.x, y: point.y + distance },
      { x: point.x, y: point.y - distance },
    ].filter(
      (candidate) =>
        candidate.x >= radius &&
        candidate.y >= radius &&
        candidate.x <= source.width - radius &&
        candidate.y <= source.height - radius,
    );
    if (candidates.length === 0) return { x: 0, y: 0 };
    const means = candidates.map((candidate) => meanColorAround(source, candidate, radius));
    const consensus = means.reduce(
      (total, mean) => ({
        r: total.r + mean.r / means.length,
        g: total.g + mean.g / means.length,
        b: total.b + mean.b / means.length,
      }),
      { r: 0, g: 0, b: 0 },
    );
    let best = 0;
    let bestDistance = Infinity;
    means.forEach((mean, index) => {
      const delta =
        Math.abs(mean.r - consensus.r) +
        Math.abs(mean.g - consensus.g) +
        Math.abs(mean.b - consensus.b);
      if (delta < bestDistance) {
        bestDistance = delta;
        best = index;
      }
    });
    const chosen = candidates[best];
    if (!chosen) return { x: 0, y: 0 };
    return { x: chosen.x - point.x, y: chosen.y - point.y };
  }

  private paintAt(drag: Extract<DragState, { kind: 'paint' }>, to: Point, force = false): void {
    const doc = this.doc;
    const layer = doc?.layers.find((item) => item.id === drag.layerId);
    if (!doc || !layer) return;
    const canvas = drag.target === 'mask' ? layer.mask : layer.canvas;
    if (!canvas) return;
    const tool = this.activeTool;
    const { composite, color } = this.strokeAppearance(drag.target === 'mask', drag.erase);
    const brush = { ...this.brush };
    const alpha = clamp(brush.opacity, 0.02, 1);
    const ctx = canvasContext(canvas);
    ctx.save();
    this.applySelectionClip(ctx);

    const stampAt = (point: Point): void => {
      if (tool === 'stamp' || tool === 'heal') {
        if (!drag.source) return;
        const src = {
          x: point.x + (drag.offset?.x ?? 0),
          y: point.y + (drag.offset?.y ?? 0),
        };
        cloneStamp(ctx, drag.source, src, point, {
          size: brush.size,
          hardness: brush.hardness,
          alpha,
          shift: drag.shift ?? undefined,
        });
        return;
      }
      paintStamp(ctx, point, brush, color, composite, alpha);
    };

    if (tool === 'pencil') {
      strokePencil(
        ctx,
        drag.last,
        to,
        this.pencilOptions.size,
        color,
        composite,
        clamp(this.pencilOptions.opacity / 100, 0.02, 1),
      );
    } else if (force) {
      // Premier contact : on tamponne toujours, même si le geste est plus court
      // que l'espacement entre deux tampons.
      stampAt(drag.last);
      drag.carry = 0;
    } else {
      drag.carry = walkStroke(drag.last, to, brush.size, brush.spacing, drag.carry, stampAt);
    }
    ctx.restore();
    drag.last = { ...to };
    this.renderCanvas();
    this.renderOverlay();
  }

  private onPaintDrag(drag: Extract<DragState, { kind: 'paint' }>, point: Point): void {
    this.paintAt(drag, point);
  }

  private finishPaint(drag: Extract<DragState, { kind: 'paint' }>): void {
    const doc = this.doc;
    const layer = doc?.layers.find((item) => item.id === drag.layerId);
    if (!doc || !layer) return;
    const canvas = drag.target === 'mask' ? layer.mask : layer.canvas;
    if (!canvas) return;
    const before = drag.before;
    const mask = this.getSelectionMask();
    if (mask && mask.width === canvas.width && mask.height === canvas.height) {
      const blended = blendThroughMask(before, canvas, mask.canvas);
      const ctx = canvasContext(canvas);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(blended, 0, 0);
    }
    const after = cloneCanvas(canvas);
    this.history.push({
      label: drag.label,
      undo: () => {
        const ctx = canvasContext(canvas);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(before, 0, 0);
        this.renderAll();
      },
      redo: () => {
        const ctx = canvasContext(canvas);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(after, 0, 0);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Baguette magique
  // ───────────────────────────────────────────────────────────────────────────

  private applyMagicWand(point: Point, add: boolean): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    const source = this.wand.merged ? this.display : layer.canvas;
    const found = magicWandSelection(
      source,
      Math.floor(point.x),
      Math.floor(point.y),
      this.wand.tolerance,
      this.wand.contiguous,
    );
    if (!found) {
      this.selection = null;
      this.setMessage(t('msg.noPixels'));
      this.renderOverlay();
      this.renderToolOptions();
      return;
    }
    if (add && this.selection && this.selection.type === 'poly' && found.type === 'poly') {
      const rings = [...selectionRings(this.selection), ...selectionRings(found)];
      const first = rings[0];
      if (first) {
        this.selection = {
          type: 'poly',
          points: first,
          rings,
          invert: this.selection.invert,
          feather: this.selectionFeather,
        };
      }
    } else {
      this.selection = { ...found, feather: this.selectionFeather };
    }
    const bounds = selectionBounds(this.selection);
    this.setMessage(
      `Baguette magique · ${Math.round(bounds.w)} × ${Math.round(bounds.h)} px`,
    );
    this.renderOverlay();
    this.renderToolOptions();
    this.updateStatus();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Outil pièce
  // ───────────────────────────────────────────────────────────────────────────

  private onPatchDown(point: Point): void {
    const rect = this.patchSourceRect;
    if (
      rect &&
      point.x >= rect.x &&
      point.x <= rect.x + rect.w &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.h
    ) {
      this.drag = { kind: 'patch-move', start: point, current: point };
    } else {
      this.patchSourceRect = null;
      this.drag = { kind: 'patch-region', start: point, current: point };
    }
    this.renderOverlay();
  }

  private applyPatchMove(drag: Extract<DragState, { kind: 'patch-move' }>): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    const rect = this.patchSourceRect;
    if (!doc || !layer || !rect) return;
    const dx = drag.current.x - drag.start.x;
    const dy = drag.current.y - drag.start.y;
    if (Math.hypot(dx, dy) < 2) {
      this.setMessage(t('opt.patchReadyText'));
      return;
    }
    if (layer.mask && layer.maskEditing) {
      this.toast(t('msg.patchExitMask'), 'info');
      return;
    }
    if (layer.kind !== 'raster') {
      layer.kind = 'raster';
      layer.text = undefined;
      layer.path = undefined;
    }
    const before = cloneCanvas(layer.canvas);
    const composite = cloneCanvas(this.display);
    const width = rect.w;
    const height = rect.h;
    const dst = { x: rect.x + dx, y: rect.y + dy };
    const shift = this.patchOptions.corrector
      ? colorShift(
          meanColorAround(composite, { x: dst.x + width / 2, y: dst.y + height / 2 },
            Math.max(width, height) / 2),
          meanColorAround(composite, { x: rect.x + width / 2, y: rect.y + height / 2 },
            Math.max(width, height) / 2),
        )
      : null;
    patchRegion(layer.canvas, composite, rect, dst, shift);
    const after = cloneCanvas(layer.canvas);
    this.history.push({
      label: this.patchOptions.corrector ? `${t('tool.patch.label')} (${t('opt.corrector').toLowerCase()})` : t('tool.patch.label'),
      undo: () => {
        const ctx = canvasContext(layer.canvas);
        ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        ctx.drawImage(before, 0, 0);
        this.renderAll();
      },
      redo: () => {
        const ctx = canvasContext(layer.canvas);
        ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        ctx.drawImage(after, 0, 0);
        this.renderAll();
      },
    });
    this.patchSourceRect = null;
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.patchFixed'));
  }

  private finishMarquee(drag: Extract<DragState, { kind: 'marquee' }>): void {
    if (drag.mode === 'lasso') {
      if (drag.points.length >= 3) {
        this.selection = {
          type: 'poly',
          points: drag.points.map((point) => ({ ...point })),
          invert: false,
          feather: this.selectionFeather,
        };
      } else {
        this.selection = null;
      }
    } else {
      const rect = normalizeRect(drag.start, drag.current);
      if (rect.w < 2 || rect.h < 2) this.selection = null;
      else {
        this.selection = {
          type: drag.mode === 'rect' ? 'rect' : 'ellipse',
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.w),
            h: Math.round(rect.h),
          },
          invert: false,
          feather: this.selectionFeather,
        };
      }
    }
    this.renderOverlay();
    this.renderToolOptions();
    this.updateStatus();
  }

  private finishCrop(drag: Extract<DragState, { kind: 'crop' }>): void {
    const rect = this.constrainCropRect(drag.start, drag.current, drag.ratio);
    if (rect.w < 8 || rect.h < 8) {
      this.pendingCrop = null;
    } else {
      this.pendingCrop = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h),
      };
    }
    this.renderOverlay();
    this.renderToolOptions();
  }

  private applyCrop(): void {
    const doc = this.doc;
    const rect = this.pendingCrop;
    if (!doc || !rect) return;
    const before = snapshotGeometry(doc);
    const after = cropDocument(doc, rect);
    const width = doc.width;
    const height = doc.height;
    this.history.push({
      label: t('msg.cropLabel'),
      undo: () => {
        restoreGeometry(doc, before);
        this.fitToView();
        this.renderAll();
      },
      redo: () => {
        restoreGeometry(doc, after);
        this.fitToView();
        this.renderAll();
      },
    });
    this.pendingCrop = null;
    this.selection = null;
    this.fitToView();
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.cropped', { w: width, h: height }));
  }

  private finishShape(drag: Extract<DragState, { kind: 'shape' }>): void {
    const doc = this.doc;
    if (!doc) return;
    const rect = normalizeRect(drag.start, drag.current);
    const isLine = this.shapeOptions.type === 'line';
    if (!isLine && (rect.w < 3 || rect.h < 3)) return;
    if (isLine && Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) < 3) return;
    const options = this.shapeOptions;
    const label = t(options.type === 'rectangle' ? 'opt.rect' : `opt.${options.type}`);
    const active = this.activeLayer;
    const useNewLayer =
      options.newLayer ||
      !active ||
      active.kind === 'text' ||
      active.kind === 'path';
    let target: Layer;
    let previousActive = doc.activeLayerId;
    let beforeCanvas: HTMLCanvasElement | null = null;
    if (useNewLayer) {
      target = createLayer(label, doc.width, doc.height, 'shape');
      const index = doc.layers.findIndex((layer) => layer.id === doc.activeLayerId);
      const insertAt = index >= 0 ? index + 1 : doc.layers.length;
      doc.layers.splice(insertAt, 0, target);
      doc.activeLayerId = target.id;
    } else {
      target = active;
      beforeCanvas = cloneCanvas(target.canvas);
    }
    const ctx = canvasContext(target.canvas);
    const featherMask = this.getSelectionMask();
    const featherBase = beforeCanvas ?? createCanvas(target.canvas.width, target.canvas.height);
    ctx.save();
    if (!featherMask) this.applySelectionClip(ctx);
    this.drawShape(ctx, drag.start, drag.current);
    ctx.restore();
    if (featherMask) this.composeFeathered(featherBase, target.canvas);
    if (useNewLayer) {
      const insertAt = doc.layers.findIndex((layer) => layer.id === target.id);
      this.history.push({
        label: t('msg.addShape', { label }),
        undo: () => {
          const index = doc.layers.findIndex((layer) => layer.id === target.id);
          if (index >= 0) doc.layers.splice(index, 1);
          doc.activeLayerId = previousActive;
          this.renderAll();
        },
        redo: () => {
          doc.layers.splice(Math.min(insertAt, doc.layers.length), 0, target);
          doc.activeLayerId = target.id;
          this.renderAll();
        },
      });
    } else if (beforeCanvas) {
      const before = beforeCanvas;
      const after = cloneCanvas(target.canvas);
      this.history.push({
        label: t('msg.drawShape'),
        undo: () => {
          const context = canvasContext(target.canvas);
          context.clearRect(0, 0, target.canvas.width, target.canvas.height);
          context.drawImage(before, 0, 0);
          this.renderAll();
        },
        redo: () => {
          const context = canvasContext(target.canvas);
          context.clearRect(0, 0, target.canvas.width, target.canvas.height);
          context.drawImage(after, 0, 0);
          this.renderAll();
        },
      });
    }
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.shapeDrawn', { label }));
  }

  private finishGradient(drag: Extract<DragState, { kind: 'gradient' }>): void {
    const doc = this.doc;
    if (!doc) return;
    if (Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) < 3) return;
    const options = this.gradientOptions;
    const active = this.activeLayer;
    const useNewLayer =
      options.newLayer ||
      !active ||
      active.kind === 'text' ||
      active.kind === 'path';
    let target: Layer;
    let previousActive = doc.activeLayerId;
    let beforeCanvas: HTMLCanvasElement | null = null;
    if (useNewLayer) {
      target = createLayer(t('tool.gradient.label'), doc.width, doc.height, 'shape');
      const index = doc.layers.findIndex((layer) => layer.id === doc.activeLayerId);
      const insertAt = index >= 0 ? index + 1 : doc.layers.length;
      doc.layers.splice(insertAt, 0, target);
      doc.activeLayerId = target.id;
    } else {
      target = active;
      beforeCanvas = cloneCanvas(target.canvas);
    }
    const ctx = canvasContext(target.canvas);
    const featherMask = this.getSelectionMask();
    const featherBase = beforeCanvas ?? createCanvas(target.canvas.width, target.canvas.height);
    ctx.save();
    if (!featherMask) this.applySelectionClip(ctx);
    this.drawGradient(ctx, drag.start, drag.current);
    ctx.restore();
    if (featherMask) this.composeFeathered(featherBase, target.canvas);
    if (useNewLayer) {
      const insertAt = doc.layers.findIndex((layer) => layer.id === target.id);
      this.history.push({
        label: t('msg.addGradient'),
        undo: () => {
          const index = doc.layers.findIndex((layer) => layer.id === target.id);
          if (index >= 0) doc.layers.splice(index, 1);
          doc.activeLayerId = previousActive;
          this.renderAll();
        },
        redo: () => {
          doc.layers.splice(Math.min(insertAt, doc.layers.length), 0, target);
          doc.activeLayerId = target.id;
          this.renderAll();
        },
      });
    } else if (beforeCanvas) {
      const before = beforeCanvas;
      const after = cloneCanvas(target.canvas);
      this.history.push({
        label: t('msg.drawGradient'),
        undo: () => {
          const context = canvasContext(target.canvas);
          context.clearRect(0, 0, target.canvas.width, target.canvas.height);
          context.drawImage(before, 0, 0);
          this.renderAll();
        },
        redo: () => {
          const context = canvasContext(target.canvas);
          context.clearRect(0, 0, target.canvas.width, target.canvas.height);
          context.drawImage(after, 0, 0);
          this.renderAll();
        },
      });
    }
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.gradientApplied'));
  }

  private finishSpotlight(drag: Extract<DragState, { kind: 'spotlight' }>): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (layer.mask && layer.maskEditing) {
      this.toast(t('msg.maskExit'), 'info');
      return;
    }
    const distance = Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y);
    const radius = Math.max(
      4,
      distance > 6 ? distance : this.spotlight.diameter / 2,
    );
    this.applySpotlight(drag.start, radius, this.spotlight.intensity, this.spotlight.softness);
  }

  /**
   * Éclaircit une zone circulaire au bord progressif. Le calcul se limite à la
   * boîte du point lumineux : sur une image 6000 × 4000, seule une fraction des
   * pixels est touchée. La sélection (nette ou floue) sert de limite.
   */
  private applySpotlight(center: Point, radius: number, intensity: number, softness: number): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (layer.kind !== 'raster') {
      layer.kind = 'raster';
      layer.text = undefined;
      layer.path = undefined;
    }
    const canvas = layer.canvas;
    const before = cloneCanvas(canvas);
    const x0 = clamp(Math.floor(center.x - radius), 0, canvas.width);
    const y0 = clamp(Math.floor(center.y - radius), 0, canvas.height);
    const x1 = clamp(Math.ceil(center.x + radius), 0, canvas.width);
    const y1 = clamp(Math.ceil(center.y + radius), 0, canvas.height);
    const width = x1 - x0;
    const height = y1 - y0;
    if (width <= 0 || height <= 0) return;

    const ctx = canvasContext(canvas);
    const image = ctx.getImageData(x0, y0, width, height);
    const data = image.data;
    const amount = clamp(intensity / 100, 0, 1);
    const inner = 1 - clamp(softness / 100, 0, 1);
    const ramp = Math.max(0.0001, 1 - inner);
    const mask = this.getSelectionMask();
    const selection = this.selection;

    for (let py = 0; py < height; py += 1) {
      const gy = y0 + py + 0.5;
      for (let px = 0; px < width; px += 1) {
        const dx = (x0 + px + 0.5 - center.x) / radius;
        const dy = (gy - center.y) / radius;
        const distance = Math.hypot(dx, dy);
        if (distance >= 1) continue;
        let falloff = distance <= inner ? 1 : 1 - (distance - inner) / ramp;
        falloff = clamp(falloff, 0, 1);
        falloff = falloff * falloff * (3 - 2 * falloff);
        let coverage = 1;
        if (mask) coverage = (mask.data[(y0 + py) * mask.width + (x0 + px)] ?? 0) / 255;
        else if (selection) coverage = selectionContains(selection, x0 + px + 0.5, gy) ? 1 : 0;
        const alpha = falloff * amount * coverage;
        if (alpha <= 0.001) continue;
        const index = (py * width + px) * 4;
        data[index] = (data[index] ?? 0) + (255 - (data[index] ?? 0)) * alpha;
        data[index + 1] = (data[index + 1] ?? 0) + (255 - (data[index + 1] ?? 0)) * alpha;
        data[index + 2] = (data[index + 2] ?? 0) + (255 - (data[index + 2] ?? 0)) * alpha;
      }
    }
    ctx.putImageData(image, x0, y0);

    const after = cloneCanvas(canvas);
    this.history.push({
      label: t('msg.spotlightLabel'),
      undo: () => {
        const context = canvasContext(canvas);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(before, 0, 0);
        this.renderAll();
      },
      redo: () => {
        const context = canvasContext(canvas);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(after, 0, 0);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(`Point lumineux · ${Math.round(radius * 2)} px · ${Math.round(intensity)} %`);
  }

  private drawShape(ctx: CanvasRenderingContext2D, start: Point, current: Point): void {
    const options = this.shapeOptions;
    const rect = normalizeRect(start, current);
    ctx.beginPath();
    if (options.type === 'line') {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(current.x, current.y);
      ctx.strokeStyle = options.stroke;
      ctx.lineWidth = Math.max(1, options.strokeWidth);
      ctx.lineCap = 'round';
      ctx.stroke();
      return;
    }
    if (options.type === 'ellipse') {
      ctx.ellipse(
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        Math.max(0.1, rect.w / 2),
        Math.max(0.1, rect.h / 2),
        0,
        0,
        Math.PI * 2,
      );
    } else if (options.type === 'triangle') {
      ctx.moveTo(rect.x + rect.w / 2, rect.y);
      ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
      ctx.lineTo(rect.x, rect.y + rect.h);
      ctx.closePath();
    } else if (options.type === 'star') {
      const points = this.starPoints(rect);
      const first = points[0];
      if (first) ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        if (point) ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
    } else {
      const radius = Math.min(options.radius, rect.w / 2, rect.h / 2);
      this.roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    }
    if (options.fill) {
      ctx.fillStyle = options.fill;
      ctx.fill();
    }
    if (options.strokeWidth > 0 && options.stroke) {
      ctx.strokeStyle = options.stroke;
      ctx.lineWidth = options.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  private roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private starPoints(rect: Rect): Point[] {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const outer = Math.min(rect.w, rect.h) / 2;
    const inner = outer * 0.48;
    const points: Point[] = [];
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
    return points;
  }

  private drawGradient(ctx: CanvasRenderingContext2D, start: Point, current: Point): void {
    const doc = this.doc;
    if (!doc) return;
    const options = this.gradientOptions;
    const radius = Math.max(1, Math.hypot(current.x - start.x, current.y - start.y));
    const gradient = options.type === 'linear'
      ? ctx.createLinearGradient(start.x, start.y, current.x, current.y)
      : ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, radius);
    if (options.colors === 'fg-transparent') {
      gradient.addColorStop(0, withAlpha(this.primaryColor, 1));
      gradient.addColorStop(1, withAlpha(this.primaryColor, 0));
    } else if (options.colors === 'bg-transparent') {
      gradient.addColorStop(0, withAlpha(this.secondaryColor, 1));
      gradient.addColorStop(1, withAlpha(this.secondaryColor, 0));
    } else {
      gradient.addColorStop(0, this.primaryColor);
      gradient.addColorStop(1, this.secondaryColor);
    }
    ctx.save();
    ctx.globalAlpha = clamp(options.opacity / 100, 0, 1);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();
  }

  private sampleColor(clientX: number, clientY: number, secondary: boolean): void {
    const doc = this.doc;
    if (!doc) return;
    const rect = this.currentDisplayRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
    const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * doc.width), 0, doc.width - 1);
    const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * doc.height), 0, doc.height - 1);
    const ctx = this.display.getContext('2d');
    if (!ctx) return;
    const data = ctx.getImageData(x, y, 1, 1).data;
    let hex: string;
    if ((data[3] ?? 0) === 0) {
      hex = doc.background === 'black' ? '#000000' : '#ffffff';
    } else {
      hex = rgbToHex(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0);
    }
    if (secondary) this.secondaryColor = hex;
    else this.primaryColor = hex;
    this.syncColors();
    const swatch = this.toolOptions.querySelector<HTMLElement>('.big-swatch');
    if (swatch) swatch.style.background = this.primaryColor;
    const value = this.toolOptions.querySelector<HTMLElement>('.swatch-preview strong');
    if (value) value.textContent = this.primaryColor.toUpperCase();
    const gradientPreview = this.toolOptions.querySelector<HTMLElement>('.gradient-preview');
    if (gradientPreview) {
      gradientPreview.style.setProperty('--fg', this.primaryColor);
      gradientPreview.style.setProperty('--bg', this.secondaryColor);
    }
  }

  private applySelectionClip(ctx: CanvasRenderingContext2D): void {
    const doc = this.doc;
    const selection = this.selection;
    if (!doc || !selection) return;
    const geometry = selectionPath(selection, doc.width, doc.height);
    ctx.clip(geometry.path, geometry.rule);
  }

  /** Masque flou de la sélection courante, à la résolution du document. */
  private getSelectionMask(): SelectionMask | null {
    const doc = this.doc;
    const tab = this.tab;
    const selection = this.selection;
    if (!doc || !tab || !selection) return null;
    if (selectionFeather(selection) <= 0) return null;
    const key = `${doc.width}x${doc.height}:${selectionFeather(selection)}:${JSON.stringify(selection)}`;
    if (tab.maskCache?.key === key) return tab.maskCache.mask;
    const mask = buildSelectionMask(selection, doc.width, doc.height);
    tab.maskCache = mask ? { key, mask } : null;
    return mask;
  }

  /**
   * Couverture 0 → 255 pour les réglages : ils lisent des ImageData et n'ont
   * besoin que du canal alpha, éventuellement à l'échelle de l'aperçu.
   */
  private adjustmentCoverage(
    selection: Selection | null,
    width: number,
    height: number,
  ): Uint8ClampedArray | null {
    const tab = this.tab;
    if (!tab || !selection || selectionFeather(selection) <= 0) return null;
    const key = `${width}x${height}:${selectionFeather(selection)}:${JSON.stringify(selection)}`;
    if (tab.coverageCache?.key === key) return tab.coverageCache.data;
    const mask = buildSelectionMask(selection, width, height);
    if (!mask) return null;
    tab.coverageCache = { key, data: mask.data };
    return mask.data;
  }

  private constrainCropRect(start: Point, current: Point, ratio: number | null): Rect {
    const doc = this.doc;
    if (!doc) return normalizeRect(start, current);
    let rect = normalizeRect(start, current);
    if (ratio && ratio > 0) {
      let width = rect.w;
      let height = rect.h;
      if (width / Math.max(1, height) > ratio) width = height * ratio;
      else height = width / ratio;
      const dirX = current.x >= start.x ? 1 : -1;
      const dirY = current.y >= start.y ? 1 : -1;
      const x = dirX > 0 ? start.x : start.x - width;
      const y = dirY > 0 ? start.y : start.y - height;
      rect = { x, y, w: width, h: height };
    }
    const width = Math.min(rect.w, doc.width);
    const height = Math.min(rect.h, doc.height);
    return {
      x: clamp(rect.x, 0, doc.width - width),
      y: clamp(rect.y, 0, doc.height - height),
      w: width,
      h: height,
    };
  }

  private constrainPoint(start: Point, point: Point, constrain: boolean): Point {
    if (!constrain || !this.doc) return point;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const distance = Math.hypot(dx, dy);
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return {
      x: clamp(start.x + Math.cos(angle) * distance, 0, this.doc.width),
      y: clamp(start.y + Math.sin(angle) * distance, 0, this.doc.height),
    };
  }

  private hitTestLayer(point: Point): Layer | null {
    const doc = this.doc;
    if (!doc) return null;
    const x = clamp(Math.floor(point.x), 0, doc.width - 1);
    const y = clamp(Math.floor(point.y), 0, doc.height - 1);
    for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
      const layer = doc.layers[i];
      if (!layer || !layer.visible) continue;
      if (layer.text?.bounds) {
        const bounds = layer.text.bounds;
        if (point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h) {
          return layer;
        }
      }
      const ctx = canvasContext(layer.canvas);
      const data = ctx.getImageData(x, y, 1, 1).data;
      if ((data[3] ?? 0) > 8) return layer;
    }
    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Pen tool
  // ───────────────────────────────────────────────────────────────────────────

  private createPathLayer(): Layer | null {
    const doc = this.doc;
    if (!doc) return null;
    const layer = createLayer(`${t('kind.path')} ${doc.layers.length + 1}`, doc.width, doc.height, 'path');
    layer.path = {
      anchors: [],
      closed: false,
      fill: this.pathOptions.fill === 'none' ? null : this.pathOptions.fill,
      stroke: this.pathOptions.stroke,
      strokeWidth: this.pathOptions.strokeWidth,
    };
    const index = doc.layers.findIndex((item) => item.id === doc.activeLayerId);
    const insertAt = index >= 0 ? index + 1 : doc.layers.length;
    const previousActive = doc.activeLayerId;
    doc.layers.splice(insertAt, 0, layer);
    doc.activeLayerId = layer.id;
    this.history.push({
      label: t('msg.newPath'),
      undo: () => {
        const current = doc.layers.findIndex((item) => item.id === layer.id);
        if (current >= 0) doc.layers.splice(current, 1);
        doc.activeLayerId = previousActive;
        this.renderAll();
      },
      redo: () => {
        doc.layers.splice(Math.min(insertAt, doc.layers.length), 0, layer);
        doc.activeLayerId = layer.id;
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.newPathBezier'));
    return layer;
  }

  /** Un tracé est en cours de dessin (entre le premier clic et Entrée / Échap). */
  private penDrawing = false;

  /** Tolérance de saisie, constante à l'écran quel que soit le zoom. */
  private penTolerance(): number {
    return 9 / this.zoom;
  }

  /** Ancre ou poignée sous le curseur (les poignées sont prioritaires). */
  private penHit(point: Point): { kind: 'anchor' | 'hIn' | 'hOut'; index: number } | null {
    const path = this.activePathLayer?.path;
    if (!path) return null;
    const tolerance = this.penTolerance();
    let bestKind: 'anchor' | 'hIn' | 'hOut' | null = null;
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < path.anchors.length; index += 1) {
      const anchor = path.anchors[index];
      if (!anchor) continue;
      const candidates: Array<{ kind: 'anchor' | 'hIn' | 'hOut'; x: number; y: number; skip: boolean }> = [
        { kind: 'hIn', x: anchor.x + anchor.inX, y: anchor.y + anchor.inY, skip: !anchor.inX && !anchor.inY },
        { kind: 'hOut', x: anchor.x + anchor.outX, y: anchor.y + anchor.outY, skip: !anchor.outX && !anchor.outY },
        { kind: 'anchor', x: anchor.x, y: anchor.y, skip: false },
      ];
      for (const candidate of candidates) {
        if (candidate.skip) continue;
        const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
        if (distance > tolerance || distance >= bestDistance) continue;
        bestDistance = distance;
        bestKind = candidate.kind;
        bestIndex = index;
      }
    }
    return bestKind ? { kind: bestKind, index: bestIndex } : null;
  }

  /** Point d'un segment de Bézier (t ∈ [0,1]), dans l'espace du document. */
  private bezierPoint(a: Anchor, b: Anchor, t: number): Point {
    const p0 = { x: a.x, y: a.y };
    const p1 = { x: a.x + a.outX, y: a.y + a.outY };
    const p2 = { x: b.x + b.inX, y: b.y + b.inY };
    const p3 = { x: b.x, y: b.y };
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }

  /** Segment sous le curseur, uniquement sur un tracé fermé (insertion de point). */
  private penSegmentHit(point: Point): { index: number; t: number } | null {
    const path = this.activePathLayer?.path;
    if (!path || !path.closed || path.anchors.length < 2) return null;
    const tolerance = 8 / this.zoom;
    const count = path.anchors.length;
    let best: { index: number; t: number; distance: number } | null = null;
    for (let index = 0; index < count; index += 1) {
      const a = path.anchors[index];
      const b = path.anchors[(index + 1) % count];
      if (!a || !b) continue;
      for (let step = 1; step < 24; step += 1) {
        const t = step / 24;
        const p = this.bezierPoint(a, b, t);
        const distance = Math.hypot(point.x - p.x, point.y - p.y);
        if (distance > tolerance) continue;
        if (best && distance >= best.distance) continue;
        best = { index, t, distance };
      }
    }
    return best ? { index: best.index, t: best.t } : null;
  }

  private onPenDown(point: Point, shift: boolean, alt: boolean): void {
    const hit = this.penHit(point);
    const path = this.activePathLayer?.path;
    const now = performance.now();
    const doubleClick = now - this.penLastClick.at < 320;

    // 1. Une poignée : on la tire (Alt détache les deux poignées).
    if (hit && hit.kind !== 'anchor' && path) {
      this.drag = {
        kind: 'pen-handle',
        layerId: this.activeLayer?.id ?? '',
        index: hit.index,
        which: hit.kind === 'hIn' ? 'in' : 'out',
        before: deepClone(path),
      };
      return;
    }

    // 2. Une ancre : on la déplace, on ferme le tracé si c'est la première, et
    //    un double-clic la transforme en angle ou en courbe lissée.
    if (hit && hit.kind === 'anchor' && path) {
      const anchor = path.anchors[hit.index];
      if (!anchor) return;
      const isFirst = hit.index === 0;
      if (isFirst && !path.closed && path.anchors.length >= 2 && this.penDrawing) {
        this.closeActivePath();
        return;
      }
      if (doubleClick && this.penLastClick.index === hit.index) {
        this.penLastClick = { at: 0, index: -1 };
        this.toggleAnchorSmooth(hit.index);
        return;
      }
      if (alt) {
        this.penLastClick = { at: 0, index: -1 };
        this.toggleAnchorSmooth(hit.index);
        return;
      }
      this.penLastClick = { at: now, index: hit.index };
      // Toucher une ancre d'un tracé terminé le rouvre pour édition.
      this.penDrawing = true;
      this.drag = {
        kind: 'pen-anchor',
        layerId: this.activeLayer?.id ?? '',
        index: hit.index,
        before: deepClone(path),
        beforePoint: { x: anchor.x, y: anchor.y },
      };
      return;
    }

    // 3. Sur un segment d'un tracé fermé : on insère un point (Figma).
    if (path?.closed) {
      const segment = this.penSegmentHit(point);
      if (segment) {
        this.insertAnchor(segment.index, segment.t);
        return;
      }
    }

    // 4. Sinon : nouveau point. On démarre un calque de tracé si nécessaire.
    let layer = this.penDrawing ? this.activePathLayer : null;
    if (!layer) layer = this.createPathLayer();
    if (!layer?.path) return;
    this.penDrawing = true;
    const activePath = layer.path;

    // Un clic dans une zone vide d'un tracé déjà fermé commence un nouveau
    // tracé, comme dans Illustrator.
    if (activePath.closed) {
      layer = this.createPathLayer();
      if (!layer?.path) return;
      this.penDrawing = true;
    }
    const target = layer.path;
    const previous = target.anchors[target.anchors.length - 1];
    const before = deepClone(target);
    // Maj aligne le nouveau point à 45° du précédent.
    const placed = previous ? this.constrainPoint(previous, point, shift) : point;
    target.anchors.push({ x: placed.x, y: placed.y, inX: 0, inY: 0, outX: 0, outY: 0 });
    this.drag = {
      kind: 'pen-new-anchor',
      layerId: layer.id,
      index: target.anchors.length - 1,
      before,
      start: placed,
      moved: false,
    };
    this.penHover = placed;
    renderLayer(layer);
    this.renderCanvas();
    this.renderOverlay();
  }

  /**
   * Insère une ancre sur un segment sans déformer la courbe : on coupe le
   * cubic au paramètre `t` (de Casteljau) et on recalcule les poignées des
   * deux moitiés.
   */
  private insertAnchor(segmentIndex: number, split: number): void {
    const layer = this.activePathLayer;
    const path = layer?.path;
    if (!layer || !path) return;
    const count = path.anchors.length;
    const a = path.anchors[segmentIndex];
    const b = path.anchors[(segmentIndex + 1) % count];
    if (!a || !b) return;
    const before = deepClone(path);

    const u = split;
    const p1 = { x: a.x + a.outX, y: a.y + a.outY };
    const p2 = { x: b.x + b.inX, y: b.y + b.inY };
    const q0 = { x: a.x + (p1.x - a.x) * u, y: a.y + (p1.y - a.y) * u };
    const q1 = { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u };
    const q2 = { x: p2.x + (b.x - p2.x) * u, y: p2.y + (b.y - p2.y) * u };
    const r0 = { x: q0.x + (q1.x - q0.x) * u, y: q0.y + (q1.y - q0.y) * u };
    const r1 = { x: q1.x + (q2.x - q1.x) * u, y: q1.y + (q2.y - q1.y) * u };
    const middle = { x: r0.x + (r1.x - r0.x) * u, y: r0.y + (r1.y - r0.y) * u };

    a.outX = q0.x - a.x;
    a.outY = q0.y - a.y;
    b.inX = q2.x - b.x;
    b.inY = q2.y - b.y;
    // Segment droit : le point inséré reste un angle net, sans poignées
    // fantômes (leur somme est nulle mais elles s'affichent).
    const straight = !a.outX && !a.outY && !b.inX && !b.inY;
    const inserted: Anchor = straight
      ? { x: middle.x, y: middle.y, inX: 0, inY: 0, outX: 0, outY: 0 }
      : {
          x: middle.x,
          y: middle.y,
          inX: r0.x - middle.x,
          inY: r0.y - middle.y,
          outX: r1.x - middle.x,
          outY: r1.y - middle.y,
        };
    path.anchors.splice(segmentIndex + 1, 0, inserted);

    const after = deepClone(path);
    renderLayer(layer);
    this.history.push({
      label: t('msg.pointAdd'),
      undo: () => {
        layer.path = deepClone(before);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
      redo: () => {
        layer.path = deepClone(after);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.pointAdded'));
  }

  /**
   * Bascule une ancre entre angle et courbe lissée. Les poignées d'une courbe
   * sont alignées sur la corde des deux voisines, comme dans Illustrator.
   */
  private toggleAnchorSmooth(index: number): void {
    const layer = this.activePathLayer;
    const path = layer?.path;
    if (!layer || !path) return;
    const anchor = path.anchors[index];
    if (!anchor) return;
    const before = deepClone(path);
    const hasHandles = Boolean(anchor.inX || anchor.inY || anchor.outX || anchor.outY);
    if (hasHandles) {
      anchor.inX = 0;
      anchor.inY = 0;
      anchor.outX = 0;
      anchor.outY = 0;
    } else {
      const count = path.anchors.length;
      const hasPrev = path.closed || index > 0;
      const hasNext = path.closed || index < count - 1;
      const prev = path.anchors[(index - 1 + count) % count];
      const next = path.anchors[(index + 1) % count];
      let dx = 1;
      let dy = 0;
      if (hasPrev && hasNext && prev && next) {
        dx = next.x - prev.x;
        dy = next.y - prev.y;
      } else if (hasNext && next) {
        dx = next.x - anchor.x;
        dy = next.y - anchor.y;
      } else if (hasPrev && prev) {
        dx = anchor.x - prev.x;
        dy = anchor.y - prev.y;
      }
      const length = Math.hypot(dx, dy) || 1;
      const reach = Math.max(16, Math.min(120, Math.hypot(dx, dy) / 3));
      const ux = (dx / length) * reach;
      const uy = (dy / length) * reach;
      anchor.outX = ux;
      anchor.outY = uy;
      anchor.inX = -ux;
      anchor.inY = -uy;
    }
    renderLayer(layer);
    const after = deepClone(path);
    this.history.push({
      label: t('msg.pointSmooth'),
      undo: () => {
        layer.path = deepClone(before);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
      redo: () => {
        layer.path = deepClone(after);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
  }

  private onPenMove(event: PointerEvent): void {
    const drag = this.drag;
    const doc = this.doc;
    if (!doc) return;
    if (!drag || (drag.kind !== 'pen-anchor' && drag.kind !== 'pen-handle' && drag.kind !== 'pen-new-anchor')) {
      return;
    }
    const layer = doc.layers.find((item) => item.id === drag.layerId);
    if (!layer?.path) return;
    const current = this.docPoint(event);
    const origin = drag.kind === 'pen-anchor'
      ? drag.beforePoint
      : drag.kind === 'pen-new-anchor'
        ? drag.start
        : current;
    const point = this.constrainPoint(origin, current, event.shiftKey);
    const anchor = layer.path.anchors[drag.index];
    if (!anchor) return;
    if (drag.kind === 'pen-anchor') {
      anchor.x = clamp(point.x, 0, doc.width);
      anchor.y = clamp(point.y, 0, doc.height);
    } else if (drag.kind === 'pen-new-anchor') {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      if (Math.hypot(dx, dy) > 2 / this.zoom) drag.moved = true;
      if (drag.moved) {
        // Le point de sortie suit la souris, le point d'entrée est son miroir :
        // c'est le geste « tirer pour courber » de Figma.
        anchor.outX = dx;
        anchor.outY = dy;
        anchor.inX = -dx;
        anchor.inY = -dy;
      }
    } else {
      const dx = point.x - anchor.x;
      const dy = point.y - anchor.y;
      if (drag.which === 'out') {
        anchor.outX = dx;
        anchor.outY = dy;
        if (!event.altKey) {
          anchor.inX = -dx;
          anchor.inY = -dy;
        }
      } else {
        anchor.inX = dx;
        anchor.inY = dy;
        if (!event.altKey) {
          anchor.outX = -dx;
          anchor.outY = -dy;
        }
      }
    }
    this.penHover = drag.kind === 'pen-new-anchor' ? point : null;
    renderLayer(layer);
    this.renderCanvas();
    this.renderOverlay();
    this.updateCanvasCursor();
  }

  /** Survol : tracé élastique, anneau de fermeture, curseur contextuel. */
  private updatePenHover(event: PointerEvent): void {
    const inside = this.pointerInside;
    if (!inside) {
      if (this.penHover || this.penCloseHover) {
        this.penHover = null;
        this.penCloseHover = false;
        this.penHoverAnchor = -1;
        this.renderOverlay();
      }
      return;
    }
    const point = this.docPoint(event);
    this.penHover = point;
    const hit = this.penHit(point);
    this.penHoverAnchor = hit?.kind === 'anchor' ? hit.index : -1;
    const path = this.activePathLayer?.path;
    const first = path?.anchors[0];
    const canClose = Boolean(
      this.penDrawing &&
      path &&
      !path.closed &&
      path.anchors.length >= 2 &&
      first &&
      Math.hypot(point.x - first.x, point.y - first.y) < this.penTolerance() * 1.4,
    );
    this.penCloseHover = canClose;
    const segment = path?.closed ? this.penSegmentHit(point) : null;

    // Curseur : fermeture prioritaire, puis poignée (main), puis ancre.
    if (this.display) {
      if (canClose) this.display.style.cursor = 'pointer';
      else if (hit) this.display.style.cursor = hit.kind === 'anchor' ? 'move' : 'grab';
      else if (segment) this.display.style.cursor = 'copy';
      else this.display.style.cursor = TOOLS.pen.cursor;
    }
    this.renderOverlay();
  }

  /** Termine le tracé en cours (Entrée) : le calque reste, la plume reste active. */
  private commitPenPath(): void {
    const layer = this.activePathLayer;
    this.penDrawing = false;
    this.penHover = null;
    this.penCloseHover = false;
    this.penHoverAnchor = -1;
    if (!layer?.path) {
      this.renderOverlay();
      return;
    }
    if (layer.path.anchors.length < 2) {
      // Un point isolé n'est pas un tracé : on retire le calque vide.
      const doc = this.doc;
      if (doc) {
        const index = doc.layers.findIndex((item) => item.id === layer.id);
        if (index >= 0 && doc.layers.length > 1) {
          doc.layers.splice(index, 1);
          const next = doc.layers[Math.min(index, doc.layers.length - 1)];
          doc.activeLayerId = next?.id ?? '';
        }
      }
      this.layersDirty = true;
      this.renderAll();
      return;
    }
    renderLayer(layer);
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.pathCommitted'));
  }

  private finishPen(drag: Extract<DragState, { kind: 'pen-anchor' | 'pen-handle' | 'pen-new-anchor' }>): void {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.layers.find((item) => item.id === drag.layerId);
    if (!layer?.path) return;
    const after = deepClone(layer.path);
    if (JSON.stringify(after) === JSON.stringify(drag.before)) {
      this.renderOverlay();
      return;
    }
    const before = deepClone(drag.before);
    this.history.push({
      label: t('msg.editPath'),
      undo: () => {
        layer.path = deepClone(before);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
      redo: () => {
        layer.path = deepClone(after);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
  }

  private closeActivePath(): void {
    const layer = this.activePathLayer;
    if (!layer?.path || layer.path.anchors.length < 2) return;
    const before = deepClone(layer.path);
    layer.path.closed = true;
    const after = deepClone(layer.path);
    renderLayer(layer);
    this.history.push({
      label: t('msg.closePathLabel'),
      undo: () => {
        layer.path = deepClone(before);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
      redo: () => {
        layer.path = deepClone(after);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
    });
    // Le tracé est fini : le prochain clic dessine ailleurs, mais on reste avec
    // la plume en main (pas de retour forcé à l'outil de sélection).
    this.penDrawing = false;
    this.penHover = null;
    this.penCloseHover = false;
    this.penHoverAnchor = -1;
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.pathClosed'));
  }

  private deleteLastAnchor(index?: number): void {
    const layer = this.activePathLayer;
    if (!layer?.path || layer.path.anchors.length === 0) return;
    const target = index ?? (this.penHoverAnchor >= 0 ? this.penHoverAnchor : layer.path.anchors.length - 1);
    if (target < 0 || target >= layer.path.anchors.length) return;
    const before = deepClone(layer.path);
    layer.path.anchors.splice(target, 1);
    if (layer.path.anchors.length < 3) layer.path.closed = false;
    const after = deepClone(layer.path);
    if (layer.path.anchors.length === 0) {
      // Plus rien à dessiner : on retire le calque vide pour ne pas laisser de
      // « Tracé 3 » fantôme dans la pile.
      const doc = this.doc;
      if (doc && doc.layers.length > 1) {
        const at = doc.layers.findIndex((item) => item.id === layer.id);
        if (at >= 0) {
          doc.layers.splice(at, 1);
          const next = doc.layers[Math.min(at, doc.layers.length - 1)];
          doc.activeLayerId = next?.id ?? '';
        }
        this.penDrawing = false;
        this.penHoverAnchor = -1;
        this.history.push({
          label: t('msg.pointDelete'),
          undo: () => {
            doc.layers.splice(Math.min(at, doc.layers.length), 0, layer);
            doc.activeLayerId = layer.id;
            this.renderAll();
          },
          redo: () => {
            const current = doc.layers.findIndex((item) => item.id === layer.id);
            if (current >= 0) doc.layers.splice(current, 1);
            const fallback = doc.layers[Math.min(at, doc.layers.length - 1)];
            doc.activeLayerId = fallback?.id ?? '';
            this.renderAll();
          },
        });
        this.layersDirty = true;
        this.renderAll();
        return;
      }
    }
    renderLayer(layer);
    this.history.push({
      label: t('msg.pointDelete'),
      undo: () => {
        layer.path = deepClone(before);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
      redo: () => {
        layer.path = deepClone(after);
        layer.kind = 'path';
        renderLayer(layer);
        this.renderAll();
      },
    });
    this.penHoverAnchor = -1;
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(t('msg.pointDeleted'));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Text tool
  // ───────────────────────────────────────────────────────────────────────────

  private onTextDown(point: Point): void {
    const doc = this.doc;
    if (!doc) return;
    for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
      const layer = doc.layers[i];
      if (!layer?.visible) continue;
      const bounds = layer.text?.bounds;
      if (!bounds) continue;
      if (point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h) {
        this.selectLayer(layer.id);
        window.setTimeout(() => {
          const textarea = this.toolOptions.querySelector<HTMLTextAreaElement>('[data-text-field="content"]');
          textarea?.focus();
          textarea?.select();
        }, 40);
        return;
      }
    }
    const layer = createLayer(`Texte ${doc.layers.length + 1}`, doc.width, doc.height, 'text');
    layer.text = {
      content: 'Votre texte',
      x: point.x,
      y: point.y,
      fontFamily: this.textOptions.fontFamily,
      fontSize: this.textOptions.fontSize,
      fontWeight: this.textOptions.fontWeight,
      color: this.primaryColor,
      align: this.textOptions.align,
      lineHeight: this.textOptions.lineHeight,
    };
    renderLayer(layer);
    const index = doc.layers.findIndex((item) => item.id === doc.activeLayerId);
    const insertAt = index >= 0 ? index + 1 : doc.layers.length;
    const previousActive = doc.activeLayerId;
    doc.layers.splice(insertAt, 0, layer);
    doc.activeLayerId = layer.id;
    this.history.push({
      label: t('msg.textCreate'),
      undo: () => {
        const current = doc.layers.findIndex((item) => item.id === layer.id);
        if (current >= 0) doc.layers.splice(current, 1);
        doc.activeLayerId = previousActive;
        this.renderAll();
      },
      redo: () => {
        doc.layers.splice(Math.min(insertAt, doc.layers.length), 0, layer);
        doc.activeLayerId = layer.id;
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    window.setTimeout(() => {
      const textarea = this.toolOptions.querySelector<HTMLTextAreaElement>('[data-text-field="content"]');
      textarea?.focus();
      textarea?.select();
    }, 40);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Keyboard / drag-and-drop / utilities
  // ───────────────────────────────────────────────────────────────────────────

  private bindKeyboard(): void {
    const isEditable = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      return Boolean(
        element &&
          (element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.tagName === 'SELECT' ||
            element.isContentEditable),
      );
    };

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.newDocModal.classList.contains('is-open')) {
          this.closeNewDocumentDialog();
          event.preventDefault();
          return;
        }
        if (this.resizeModal.classList.contains('is-open')) {
          this.closeResizeDialog();
          event.preventDefault();
          return;
        }
        if (this.exportModal.classList.contains('is-open')) {
          this.closeExportDialog();
          event.preventDefault();
          return;
        }
        if (this.preferencesModal.classList.contains('is-open')) {
          this.closePreferences(true);
          event.preventDefault();
          return;
        }
        if (this.pluginSession) {
          this.cancelPlugin();
          event.preventDefault();
          return;
        }
        if (this.adjustment) {
          this.cancelAdjustment();
          this.renderToolOptions();
          event.preventDefault();
          return;
        }
        if (this.pendingCrop) {
          this.pendingCrop = null;
          this.renderOverlay();
          this.renderToolOptions();
          event.preventDefault();
          return;
        }
        if (this.patchSourceRect) {
          this.patchSourceRect = null;
          this.renderOverlay();
          this.renderToolOptions();
          event.preventDefault();
          return;
        }
        // Plume : Échap termine le tracé et rend la main à la sélection, le
        // geste « j'ai fini » de Figma.
        if (this.activeTool === 'pen') {
          if (this.penDrawing) this.commitPenPath();
          this.setTool('select');
          event.preventDefault();
          return;
        }
        this.selection = null;
        this.renderOverlay();
        event.preventDefault();
        return;
      }
      if (isEditable(event.target)) return;

      const key = event.key.toLowerCase();
      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier) {
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) this.redo();
          else this.undo();
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          this.redo();
          return;
        }
        if (key === 'n') {
          event.preventDefault();
          // Ctrl+Maj+N : nouveau calque, comme dans Photoshop.
          if (event.shiftKey) this.addNewLayer();
          else this.openNewDocumentDialog();
          return;
        }
        if (key === 'o') {
          event.preventDefault();
          void this.openImageFlow();
          return;
        }
        if (key === 's') {
          event.preventDefault();
          this.openExportDialog();
          return;
        }
        if (key === ',') {
          event.preventDefault();
          this.openPreferences();
          return;
        }
        if (key === '0') {
          event.preventDefault();
          this.fitToView();
          return;
        }
        if (key === 'a') {
          event.preventDefault();
          if (this.doc) this.handleAction('select-all');
          return;
        }
        if (key === 'd') {
          event.preventDefault();
          if (this.selection) this.handleAction('deselect');
          return;
        }
        if (key === 'i' && event.shiftKey) {
          event.preventDefault();
          if (this.doc) this.handleAction('invert-selection');
          return;
        }
        if (key === 'j') {
          event.preventDefault();
          this.duplicateActiveLayer();
          return;
        }
        if (key === 'e' && event.altKey) {
          event.preventDefault();
          if (this.pluginSession) this.cancelPlugin();
          else this.openPluginPanel();
          return;
        }
        if (key === 'e') {
          event.preventDefault();
          this.mergeDown();
          return;
        }
        if (key === 't') {
          // Transformation libre : l'outil de sélection affiche la boîte et ses
          // poignées, prêtes à être tirées.
          event.preventDefault();
          if (!this.doc) return;
          this.setTool('select');
          this.setMessage(t('msg.transformReady'));
          return;
        }
        if (key === 'w') {
          event.preventDefault();
          if (this.activeTabId) this.closeTab(this.activeTabId);
          return;
        }
        if (event.key === 'Tab' && this.tabs.length > 1) {
          event.preventDefault();
          const index = this.tabs.findIndex((item) => item.id === this.activeTabId);
          const step = event.shiftKey ? -1 : 1;
          const next = this.tabs[(index + step + this.tabs.length) % this.tabs.length];
          if (next) this.activateTab(next.id);
          return;
        }
        if (key === '1') {
          event.preventDefault();
          this.setZoom(1);
          return;
        }
        if (key === '=' || key === '+') {
          event.preventDefault();
          this.setZoom(this.zoom * 1.25);
          return;
        }
        if (key === '-') {
          event.preventDefault();
          this.setZoom(this.zoom / 1.25);
          return;
        }
        if (event.key === '[') {
          event.preventDefault();
          this.moveActiveLayer(-1);
          return;
        }
        if (event.key === ']') {
          event.preventDefault();
          this.moveActiveLayer(1);
          return;
        }
        if (event.key === '/' || event.key === ':') {
          // Ctrl+/ : verrouille ou déverrouille la sélection (Photoshop).
          event.preventDefault();
          const layers = this.selectedLayers();
          const primary = this.activeLayer;
          const targets = layers.length > 0 ? layers : primary ? [primary] : [];
          if (targets.length === 0) return;
          const lock = !targets.every((item) => item.locked);
          const snapshot = targets.map((item) => ({ layer: item, locked: Boolean(item.locked) }));
          for (const item of targets) item.locked = lock;
          this.history.push({
            label: lock ? t('layers.lock') : t('layers.unlock'),
            undo: () => {
              for (const entry of snapshot) entry.layer.locked = entry.locked;
              this.renderAll();
            },
            redo: () => {
              for (const entry of snapshot) entry.layer.locked = lock;
              this.renderAll();
            },
          });
          this.renderAll();
          this.setMessage(lock ? t('msg.layersLocked', { n: targets.length }) : t('msg.layersUnlocked', { n: targets.length }));
          return;
        }
      }
      if (event.key === 'F11') {
        event.preventDefault();
        byId<HTMLButtonElement>('btn-fullscreen').click();
        return;
      }
      if (event.key === 'F1' || (event.key === '?' && !withModifier)) {
        event.preventDefault();
        this.openPreferences('shortcuts');
        return;
      }
      if (event.code === 'Space' && !this.spaceDown) {
        event.preventDefault();
        this.spaceDown = true;
        this.display.style.cursor = 'grab';
        return;
      }
      if (event.key === 'Enter') {
        if (this.pendingCrop) {
          event.preventDefault();
          this.applyCrop();
          return;
        }
        // Entrée termine le tracé mais laisse la plume en main : on enchaîne
        // directement sur le tracé suivant.
        if (this.activeTool === 'pen' && this.penDrawing) {
          event.preventDefault();
          this.commitPenPath();
          return;
        }
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!this.doc) return;
        // Plume : Suppr retire le point survolé, sinon le dernier.
        if (this.activeTool === 'pen' && this.penDrawing) {
          event.preventDefault();
          this.deleteLastAnchor();
          return;
        }
        event.preventDefault();
        if (event.altKey) {
          if (this.selection) this.fillSelection(this.primaryColor);
          return;
        }
        if (withModifier) {
          if (this.selection) this.fillSelection(this.secondaryColor);
          return;
        }
        if (event.shiftKey) {
          this.clearActiveLayerContent();
          return;
        }
        if (this.selection) {
          this.clearSelectionContent();
          return;
        }
        // Sans sélection, Suppr agit sur le calque lui-même : c'est ce que l'on
        // attend en le désignant dans la pile.
        this.deleteActiveLayer();
        return;
      }
      if (event.key.startsWith('Arrow')) {
        if (!this.activeLayer) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        this.nudgeActiveLayer(dx, dy);
        return;
      }
      if (event.altKey && (event.key === '[' || event.key === ']')) {
        event.preventDefault();
        this.selectAdjacentLayer(event.key === ']' ? 1 : -1);
        return;
      }
      const shortcuts: Record<string, ToolId> = {
        v: 'select',
        m: 'marquee',
        w: 'magic-wand',
        c: 'crop',
        u: 'shapes',
        p: 'pen',
        t: 'text',
        n: 'pencil',
        b: 'brush',
        e: 'eraser',
        s: 'stamp',
        j: 'patch',
        k: 'heal',
        l: 'spotlight',
        i: 'eyedropper',
        g: 'gradient',
        z: 'zoom',
        h: 'hand',
      };
      const tool = shortcuts[key];
      if (tool) {
        event.preventDefault();
        this.setTool(tool);
        return;
      }
      if (key === 'x') {
        event.preventDefault();
        this.swapColors();
        this.setMessage(t('msg.colorsSwapped'));
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        this.resetColors();
        this.setMessage(t('msg.colorsReset'));
        return;
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const factor = event.key === '[' ? 1 / 1.25 : 1.25;
        this.brush.size = clamp(Math.round(this.brush.size * factor), 1, 600);
        this.pencilOptions.size = clamp(Math.round(this.pencilOptions.size * factor), 1, 48);
        if (this.activeTool === 'pencil' || this.activeTool === 'brush' || this.activeTool === 'eraser' || this.activeTool === 'stamp' || this.activeTool === 'heal') {
          this.renderToolOptions();
        }
        this.setMessage(`Taille ${this.brush.size} px`);
      }
    });

    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        this.spaceDown = false;
        if (!this.drag) this.display.style.cursor = TOOLS[this.activeTool].cursor;
      }
    });
  }

  private clearSelectionContent(): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer || !this.selection) return;
    if (layer.kind === 'text' || layer.kind === 'path') {
      this.toast(t('msg.flattenFirst'), 'info');
      return;
    }
    const before = cloneCanvas(layer.canvas);
    const ctx = canvasContext(layer.canvas);
    ctx.save();
    this.applySelectionClip(ctx);
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.restore();
    this.composeFeathered(before, layer.canvas);
    const after = cloneCanvas(layer.canvas);
    this.history.push({
      label: t('msg.clearSelection'),
      undo: () => {
        const context = canvasContext(layer.canvas);
        context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        context.drawImage(before, 0, 0);
        this.renderAll();
      },
      redo: () => {
        const context = canvasContext(layer.canvas);
        context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        context.drawImage(after, 0, 0);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.invalidateBounds(layer.id);
    this.renderAll();
    this.setMessage(t('msg.clearSelection'));
  }

  /**
   * Recombine le calque à travers le masque de contour progressif. Sans
   * sélection floue, la fonction ne fait rien : les opérations restent au bord
   * net, sans coût supplémentaire.
   */
  private composeFeathered(before: HTMLCanvasElement, canvas: HTMLCanvasElement): void {
    const mask = this.getSelectionMask();
    if (!mask || mask.width !== canvas.width || mask.height !== canvas.height) return;
    const blended = blendThroughMask(before, canvas, mask.canvas);
    const ctx = canvasContext(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(blended, 0, 0);
  }

  private fillSelection(color: string): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    const selection = this.selection;
    if (!doc || !layer) return;
    if (!selection) {
      this.toast(t('msg.selectionFirst'), 'info');
      return;
    }
    if (layer.kind === 'text' || layer.kind === 'path') {
      this.toast(t('msg.flattenBeforeFill'), 'info');
      return;
    }
    if (this.layerLocked(layer)) return;
    const isMask = Boolean(layer.mask && layer.maskEditing);
    const canvas = isMask ? layer.mask : layer.canvas;
    if (!canvas) return;
    const before = cloneCanvas(canvas);
    const fill = isMask ? '#ffffff' : color;
    const ctx = canvasContext(canvas);
    const featherMask = this.getSelectionMask();
    if (featherMask) {
      // Avec un contour progressif, on remplit toute la surface : c'est le
      // masque qui décide de l'opacité, sinon le bord resterait net.
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      this.composeFeathered(before, canvas);
    } else {
      ctx.save();
      this.applySelectionClip(ctx);
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    const after = cloneCanvas(canvas);
    const label = isMask ? t('msg.maskFilled', { color: '' }).replace(' · ', '') : t('menu.fill');
    this.history.push({
      label,
      undo: () => {
        const context = canvasContext(canvas);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(before, 0, 0);
        this.renderAll();
      },
      redo: () => {
        const context = canvasContext(canvas);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(after, 0, 0);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.renderToolOptions();
    this.setMessage(`${label} · ${fill.toUpperCase()}`);
  }

  private bindDragAndDrop(): void {
    const overlay = document.getElementById('drop-overlay');
    let depth = 0;

    const show = (visible: boolean): void => {
      if (overlay) overlay.hidden = !visible;
    };

    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      show(true);
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      show(true);
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) show(false);
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      depth = 0;
      show(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      void this.openDroppedFiles(files);
    });

    if (!isTauri()) return;
    void import('@tauri-apps/api/webviewWindow')
      .then(({ getCurrentWebviewWindow }) => {
        void getCurrentWebviewWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'enter' || payload.type === 'over') {
            show(true);
            return;
          }
          if (payload.type === 'leave') {
            show(false);
            return;
          }
          if (payload.type !== 'drop') return;
          show(false);
          if (payload.paths.length === 0) return;
          void this.openNativePaths(payload.paths);
        });
      })
      .catch(() => {
        /* La version web reste utilisable sans le pont Tauri. */
      });
  }

  /** Ouvre une liste de fichiers venus du bureau (web ou webview). */
  private async openDroppedFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (!isSupportedMedia(file) && !looksLikeProject(file.name)) {
        this.toast(t('drop.unsupported', { name: file.name }), 'error');
        continue;
      }
      try {
        await this.openFileBlob(file.name, file);
      } catch (error) {
        this.toast(t('msg.imageUnreadable', { error: this.errorText(error) }), 'error');
        console.warn(error);
      }
    }
  }

  private async openNativePaths(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        const opened = await readNativeImage(path);
        await this.openFileBlob(opened.name, opened.blob);
      } catch (error) {
        this.toast(t('msg.imageUnreadable', { error: this.errorText(error) }), 'error');
        console.warn(error);
      }
    }
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Un seul point d'entrée pour tous les médias : projet `.sps`, image de
   * n'importe quel format décodable, ou vidéo (première image).
   */
  private async openFileBlob(name: string, blob: Blob): Promise<void> {
    if (looksLikeProject(name) || blob.type === SPS_MIME) {
      const doc = await parseProject(blob);
      this.openTab(doc);
      this.closeNewDocumentDialog();
      this.toast(t('msg.projectOpened', { name: doc.name, n: doc.layers.length }), 'success');
      return;
    }
    if (!isSupportedMedia({ name, type: blob.type })) {
      throw new Error(t('drop.unsupported', { name }));
    }
    await this.loadImageBlob(blob, name);
  }

  private bindTabs(): void {
    const strip = document.getElementById('doc-tabs');
    strip?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const close = target.closest<HTMLElement>('[data-tab-close]');
      if (close) {
        event.stopPropagation();
        const id = close.dataset.tabClose;
        if (id) this.closeTab(id);
        return;
      }
      const tab = target.closest<HTMLElement>('[data-tab-id]');
      if (!tab) return;
      const id = tab.dataset.tabId;
      if (id && id !== this.activeTabId) this.activateTab(id);
    });
    strip?.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');
      const id = tab?.dataset.tabId;
      if (id) {
        event.preventDefault();
        this.closeTab(id);
      }
    });
    document.getElementById('doc-tab-add')?.addEventListener('click', () => {
      this.openNewDocumentDialog();
    });
  }

  private bindLanguage(): void {
    const applyLanguage = (lang: Lang): void => {
      setLanguage(lang);
      this.renderTabs();
      this.renderLayers();
      this.renderToolOptions();
      this.syncChrome();
      this.syncAutosaveBadge();
      this.renderTabs();
    };

    for (const button of this.preferencesModal.querySelectorAll<HTMLElement>('[data-lang]')) {
      button.addEventListener('click', () => {
        const lang = button.dataset.lang as Lang | undefined;
        if (!lang) return;
        saveLanguage(lang);
        applyLanguage(lang);
        this.syncPreferencesUI();
      });
    }

    window.addEventListener(LANGUAGE_EVENT, () => {
      this.statusCache.clear();
      this.refreshBlendOptions?.();
      this.renderTabs();
      this.renderToolOptions();
      this.renderLayers();
      this.syncChrome();
      this.syncAutosaveBadge();
      this.syncMaskControls();
      this.renderOverlay();
    });
  }

  private bindGlobalButtons(): void {
    const emptyNew = document.getElementById('empty-new');
    const emptyOpen = document.getElementById('empty-open');
    emptyNew?.addEventListener('click', () => this.openNewDocumentDialog());
    emptyOpen?.addEventListener('click', () => void this.openImageFlow());
  }

  private async openImageFlow(): Promise<void> {
    try {
      const opened = await openImages();
      if (opened.length === 0) return;
      for (const item of opened) await this.openFileBlob(item.name, item.blob);
    } catch (error) {
      console.error(error);
      this.toast(t('msg.openFailed', { error: this.errorText(error) }), 'error');
    }
  }

  private async loadImageBlob(blob: Blob, name: string): Promise<void> {
    const media = await decodeMedia(blob, name);
    try {
      let width = media.width;
      let height = media.height;
      const maxDimension = 16000;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const layer = createLayer('Image', width, height, 'raster');
      const ctx = canvasContext(layer.canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = SMOOTHING_QUALITY[this.preferences.quality];
      media.draw(ctx, width, height);
      this.invalidateDisplayRect();
      const doc: PhotoDoc = {
        name: stripExtension(name) || 'Image',
        width,
        height,
        dpi: 72,
        background: 'transparent',
        layers: [layer],
        activeLayerId: layer.id,
      };
      this.openTab(doc);
      this.closeNewDocumentDialog();
      this.toast(t('msg.opened', { name: doc.name, w: width, h: height }), 'success');
    } finally {
      media.release();
    }
  }

  private undo(): void {
    if (this.adjustment) {
      this.cancelAdjustment();
      this.renderToolOptions();
      return;
    }
    const label = this.history.undo();
    if (label) {
      this.layersDirty = true;
      this.renderAll();
      this.renderToolOptions();
      this.setMessage(t('msg.undone', { label }));
    }
  }

  private redo(): void {
    if (this.adjustment) return;
    const label = this.history.redo();
    if (label) {
      this.layersDirty = true;
      this.renderAll();
      this.renderToolOptions();
      this.setMessage(t('msg.redone', { label }));
    }
  }
}

export function startSuperPhoto(): void {
  const scope = window as unknown as { __superphotoStarted?: boolean; __superphoto?: SuperPhotoEditor };
  if (scope.__superphotoStarted) return;
  scope.__superphotoStarted = true;
  scope.__superphoto = new SuperPhotoEditor();
}
