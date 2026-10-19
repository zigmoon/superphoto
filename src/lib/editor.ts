import {
  ADJUSTMENT_PARAMS,
  ADJUSTMENT_TITLES,
  adjustImageData,
  defaultCurves,
  defaultParams,
} from './adjustments';
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
  openImage,
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
  canvasContext,
  canvasToBlob,
  blendThroughMask,
  buildSelectionMask,
  clamp,
  cloneCanvas,
  createCanvas,
  deepClone,
  normalizeRect,
  rgbToHex,
  selectionBounds,
  selectionContains,
  selectionFeather,
  selectionPath,
  selectionRings,
  withAlpha,
  type SelectionMask,
} from './utils';

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
  label: string;
  shortcut: string;
  cursor: string;
  hint: string;
}

const TOOLS: Record<ToolId, ToolInfo> = {
  select: {
    label: 'Sélection',
    shortcut: 'V',
    cursor: 'default',
    hint: 'Cliquez pour choisir un calque, glissez pour déplacer son contenu.',
  },
  marquee: {
    label: 'Zone de sélection',
    shortcut: 'M',
    cursor: 'crosshair',
    hint: 'Tracez une zone pour limiter les réglages et les tracés.',
  },
  'magic-wand': {
    label: 'Baguette magique',
    shortcut: 'W',
    cursor: 'crosshair',
    hint: 'Cliquez pour sélectionner les pixels de couleur proche. Maj ajoute à la sélection.',
  },
  pencil: {
    label: 'Crayon',
    shortcut: 'N',
    cursor: 'crosshair',
    hint: 'Trace net, sans lissage. Alt active la gomme.',
  },
  brush: {
    label: 'Pinceau',
    shortcut: 'B',
    cursor: 'crosshair',
    hint: 'Peignez avec le pinceau. Alt active la gomme.',
  },
  eraser: {
    label: 'Gomme',
    shortcut: 'E',
    cursor: 'crosshair',
    hint: 'Efface les pixels du calque (ou révèle le masque si vous peignez dessus).',
  },
  stamp: {
    label: 'Tampon',
    shortcut: 'S',
    cursor: 'crosshair',
    hint: 'Alt+clic définit la source, puis peignez pour cloner.',
  },
  patch: {
    label: 'Pièce',
    shortcut: 'J',
    cursor: 'crosshair',
    hint: 'Tracez la zone à réparer, puis glissez-la sur une zone propre.',
  },
  heal: {
    label: 'Correcteur',
    shortcut: 'K',
    cursor: 'crosshair',
    hint: 'Peignez sur une petite tache : le voisinage est ramené dessus.',
  },
  spotlight: {
    label: 'Point lumineux',
    shortcut: 'L',
    cursor: 'crosshair',
    hint: 'Cliquez pour éclairer une zone, glissez depuis le centre pour régler son rayon.',
  },
  crop: {
    label: 'Recadrage',
    shortcut: 'C',
    cursor: 'crosshair',
    hint: 'Tracez le nouveau cadre, puis validez avec Entrée.',
  },
  shapes: {
    label: 'Objets',
    shortcut: 'U',
    cursor: 'crosshair',
    hint: 'Glissez pour dessiner une forme. Choisissez le type dans les options.',
  },
  pen: {
    label: 'Plume',
    shortcut: 'P',
    cursor: 'crosshair',
    hint: 'Cliquez pour poser un point, glissez pour courber. Entrée termine le tracé.',
  },
  text: {
    label: 'Texte',
    shortcut: 'T',
    cursor: 'text',
    hint: 'Cliquez sur la toile pour créer un bloc de texte.',
  },
  eyedropper: {
    label: 'Pipette',
    shortcut: 'I',
    cursor: 'crosshair',
    hint: 'Cliquez pour prélever une couleur (Alt : couleur secondaire).',
  },
  gradient: {
    label: 'Dégradé',
    shortcut: 'G',
    cursor: 'crosshair',
    hint: 'Glissez pour définir la direction et l’étendue du dégradé.',
  },
  zoom: {
    label: 'Zoom',
    shortcut: 'Z',
    cursor: 'zoom-in',
    hint: 'Cliquez pour agrandir, Alt+clic pour réduire.',
  },
  hand: {
    label: 'Main',
    shortcut: 'H',
    cursor: 'grab',
    hint: 'Glissez pour déplacer la vue. Espace active la main temporairement.',
  },
};

const BLEND_OPTIONS: Array<{ value: BlendMode; label: string }> = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Produit' },
  { value: 'screen', label: 'Écran' },
  { value: 'overlay', label: 'Incrustation' },
  { value: 'darken', label: 'Obscurcir' },
  { value: 'lighten', label: 'Éclaircir' },
  { value: 'color-dodge', label: 'Densité +' },
  { value: 'color-burn', label: 'Densité −' },
  { value: 'hard-light', label: 'Lumière crue' },
  { value: 'soft-light', label: 'Lumière douce' },
  { value: 'difference', label: 'Différence' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Teinte' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Couleur' },
  { value: 'luminosity', label: 'Luminosité' },
];

const KIND_LABELS: Record<Layer['kind'], string> = {
  raster: 'Pixel',
  text: 'Texte',
  shape: 'Objet',
  path: 'Tracé',
};

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
  if (!node) throw new Error(`Élément #${id} introuvable`);
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

export class SuperPhotoEditor {
  private doc: PhotoDoc | null = null;
  private history: History;
  private activeTool: ToolId = 'select';
  private zoom = 1;
  private fitMode = true;
  private selectionState: Selection | null = null;
  private selectionMaskCache: { key: string; mask: SelectionMask } | null = null;
  private adjustmentMaskCache: { key: string; data: Uint8ClampedArray } | null = null;
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
  private displayRect: DOMRect | null = null;

  private preferences: Preferences = loadPreferences();
  private preferencesSnapshot: Preferences | null = null;

  /**
   * La sélection invalide ses caches de contour progressif dès qu'elle change :
   * le masque flou n'est calculé qu'une fois par sélection.
   */
  private get selection(): Selection | null {
    return this.selectionState;
  }

  private set selection(value: Selection | null) {
    if (value !== this.selectionState) {
      this.selectionState = value;
      this.selectionMaskCache = null;
      this.adjustmentMaskCache = null;
    }
  }

  /** Cache des nœuds chauds : zéro getElementById pendant les gestes. */
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly statusCache = new Map<string, string>();
  private readonly layerRows = new Map<string, HTMLElement>();
  private layerOrderSignature = '';

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
  private stampSource: Point | null = null;
  private patchSourceRect: Rect | null = null;
  private autosaveTimer = 0;
  private autosaveState: 'off' | 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  private autosaveAt = 0;
  private lastSessionAt = 0;
  private curveChannel: CurveChannel = 'rgb';
  private textEditBefore = new Map<string, TextData>();
  private layerPropBefore: number | null = null;
  private newDocRatioLock = false;
  private newDocRatio = 16 / 9;
  private resizeMode: 'image' | 'canvas' = 'image';
  private resizeRatioLock = true;
  private resizeRatio = 1;
  private resizeAnchor = { x: 0.5, y: 0.5 };
  private exportFormat: 'png' | 'jpeg' | 'webp' = 'png';
  private saving = false;

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
    this.toastHost = byId('toast-host');

    applyPreferences(this.preferences);
    watchSystemTheme();
    window.addEventListener('resize', () => this.invalidateDisplayRect(), { passive: true });
    this.viewport.addEventListener('scroll', () => this.invalidateDisplayRect(), { passive: true });

    this.history = new History(() => this.syncChrome());

    this.bindTopbar();
    this.bindToolRail();
    this.bindLayersPanel();
    this.bindCanvas();
    this.bindCanvasMenu();
    this.bindNewDocumentDialog();
    this.bindResizeDialog();
    this.bindExportDialog();
    this.bindPreferences();
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
    this.displayRect = null;
  }

  private currentDisplayRect(): DOMRect {
    if (!this.displayRect) this.displayRect = this.display.getBoundingClientRect();
    return this.displayRect;
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
  // Document lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  private createNewDocument(width: number, height: number, dpi: number, background: PhotoDoc['background']): void {
    const doc = createDocument(
      Math.round(width),
      Math.round(height),
      Math.round(dpi),
      background,
      'Sans titre',
    );
    this.applyDocument(doc);
    this.closeNewDocumentDialog();
    this.setTool('select');
    this.setMessage(`Nouveau document ${doc.width} × ${doc.height} px`);
  }

  private applyDocument(doc: PhotoDoc): void {
    this.cancelAdjustment();
    this.doc = doc;
    this.selection = null;
    this.pendingCrop = null;
    this.patchSourceRect = null;
    this.stampSource = null;
    this.drag = null;
    this.statusCache.clear();
    this.invalidateDisplayRect();
    this.history.clear();
    this.display.width = doc.width;
    this.display.height = doc.height;
    this.overlay.setAttribute('viewBox', `0 0 ${doc.width} ${doc.height}`);
    this.overlay.setAttribute('width', String(doc.width));
    this.overlay.setAttribute('height', String(doc.height));
    this.canvasStack.style.display = 'block';
    this.emptyState.hidden = true;
    this.fitToView();
    this.renderAll();
    this.renderToolOptions();
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
    if (!this.preferences.autosave || !this.doc) return;
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
    const doc = this.doc;
    if (!this.preferences.autosave || !doc || this.autosaveState === 'saving') return;
    this.autosaveState = 'saving';
    this.syncAutosaveBadge();
    try {
      await saveSession(doc);
      this.autosaveState = 'saved';
      this.autosaveAt = Date.now();
      this.lastSessionAt = this.autosaveAt;
    } catch (error) {
      this.autosaveState = 'error';
      console.warn('Sauvegarde automatique impossible', error);
    }
    this.syncAutosaveBadge();
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
            ? 'Auto off'
            : state === 'saving'
              ? 'Enregistrement…'
              : state === 'error'
                ? 'Auto indisponible'
                : state === 'saved'
                  ? `Enregistré ${formatSessionTime(this.autosaveAt)}`
                  : 'Auto';
      }
      host.title =
        state === 'off'
          ? 'Sauvegarde automatique désactivée (Préférences)'
          : state === 'saved'
            ? 'Session enregistrée dans le navigateur'
            : 'Sauvegarde automatique';
    }
    const sessionHint = document.getElementById('prefs-session-state');
    if (sessionHint) {
      sessionHint.textContent = this.lastSessionAt
        ? `Dernière sauvegarde : ${formatSessionTime(this.lastSessionAt)}`
        : 'Aucune session enregistrée pour l’instant.';
    }
  }

  private async restoreSession(): Promise<boolean> {
    try {
      const snapshot = await loadSession();
      if (!snapshot) {
        this.syncAutosaveBadge();
        return false;
      }
      const doc = await restoreDocument(snapshot);
      this.lastSessionAt = snapshot.savedAt;
      this.applyDocument(doc);
      this.autosaveState = 'saved';
      this.autosaveAt = snapshot.savedAt;
      this.syncAutosaveBadge();
      this.setMessage(`Session restaurée · ${formatSessionTime(snapshot.savedAt)}`);
      this.toast(`Session restaurée · ${formatSessionTime(snapshot.savedAt)}`, 'success');
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
      const d = pathToSvg(pathLayer.path);
      if (d) {
        add('path', {
          d,
          fill: 'none',
          class: 'path-outline',
          'vector-effect': 'non-scaling-stroke',
        });
      }
      const radius = 5 / this.zoom;
      pathLayer.path.anchors.forEach((anchor, index) => {
        const selected = drag?.kind === 'pen-anchor' && drag.index === index;
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
        add('rect', {
          x: anchor.x - radius,
          y: anchor.y - radius,
          width: radius * 2,
          height: radius * 2,
          class: selected ? 'path-anchor is-selected' : 'path-anchor',
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
    this.setText('doc-name', doc?.name ?? 'Aucun document');
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
    undo.title = this.history.canUndo ? `Annuler : ${this.history.undoLabel}` : 'Annuler (Ctrl+Z)';
    redo.title = this.history.canRedo ? `Rétablir : ${this.history.redoLabel}` : 'Rétablir (Ctrl+Y)';

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
      edit.textContent = layer?.maskEditing ? 'Revenir aux pixels' : 'Peindre le masque';
    }
    const add = document.getElementById('layer-mask') as HTMLButtonElement | null;
    if (add) {
      add.disabled = !layer;
      add.title = layer?.mask ? 'Peindre le masque (ou cliquer sur sa vignette)' : 'Ajouter un masque de fusion';
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
    const eye = document.createElement('button');
    eye.className = 'layer-eye';
    eye.dataset.layerAction = 'visibility';
    eye.dataset.state = 'hidden';
    const thumb = document.createElement('canvas');
    thumb.className = 'layer-thumb';
    thumb.width = 48;
    thumb.height = 48;
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
    row.append(eye, thumb, maskSlot, meta);
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
        this.layersList.innerHTML = '<div class="empty-hint">Aucun document ouvert.</div>';
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

    for (const layer of ordered) {
      let row = this.layerRows.get(layer.id);
      if (!row) {
        row = this.createLayerRow(layer);
        this.layerRows.set(layer.id, row);
      }
      row.classList.toggle('is-active', layer.id === doc.activeLayerId);

      const eye = row.querySelector<HTMLButtonElement>('.layer-eye');
      if (eye) {
        const state = layer.visible ? 'visible' : 'hidden';
        if (eye.dataset.state !== state) {
          eye.dataset.state = state;
          eye.classList.toggle('is-off', !layer.visible);
          eye.innerHTML = icon(layer.visible ? 'eye' : 'eye-off');
          eye.title = layer.visible ? 'Masquer le calque' : 'Afficher le calque';
          eye.setAttribute('aria-label', eye.title);
        }
      }

      const name = row.querySelector<HTMLElement>('.layer-name');
      if (name && name.textContent !== layer.name) {
        name.textContent = layer.name;
        name.title = layer.name;
      }
      const kind = row.querySelector<HTMLElement>('.layer-kind');
      const kindText = `${KIND_LABELS[layer.kind]} · ${Math.round(layer.opacity * 100)} %`;
      if (kind && kind.textContent !== kindText) kind.textContent = kindText;

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
              ? 'Masque désactivé — cliquer pour le réactiver'
              : layer.maskEditing
                ? 'Vous peignez le masque — cliquer pour revenir aux pixels'
                : 'Cliquer pour peindre le masque';
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
    const info = TOOLS[this.activeTool];
    this.setText('status-tool', info.label);
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
      this.setText(
        'status-selection',
        `Sélection · ${Math.round(bounds.w)} × ${Math.round(bounds.h)} px${points ? ` · ${points} pts` : ''}${feather ? ` · contour ${feather} px` : ''}`,
      );
    } else {
      this.setText('status-selection', 'Aucune sélection');
    }
    this.setText('tool-hint', info.hint);
    const layer = this.activeLayer;
    this.setText('status-layer', layer ? `Calque : ${layer.name}` : 'Aucun calque');
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
      node.textContent = 'Prêt';
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
      title.textContent = ADJUSTMENT_TITLES[this.adjustment.id];
      body.innerHTML = this.adjustmentOptionsHtml();
      if (this.adjustment.id === 'curves') this.wireCurveEditor();
      return;
    }
    title.textContent = TOOLS[this.activeTool].label;
    if (!this.doc) {
      body.innerHTML = `<div class="options-empty">
        <p>Aucun document ouvert.</p>
        <button class="btn primary sm" data-action="new-document">Créer un document</button>
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
        body.innerHTML = `<p class="options-hint">Glissez dans la toile pour vous déplacer. La barre d’espace active la main à tout moment.</p>`;
        break;
    }
  }

  private selectOptionsHtml(): string {
    const layer = this.activeLayer;
    return `
      <p class="options-hint">${escapeHtml(TOOLS.select.hint)}</p>
      <div class="option-card">
        <span class="option-card-label">Calque actif</span>
        <strong>${layer ? escapeHtml(layer.name) : '—'}</strong>
        <span class="option-card-sub">${layer ? KIND_LABELS[layer.kind] : 'Sélectionnez un calque'}</span>
      </div>
      ${this.featherFieldHtml()}
      <div class="button-row">
        <button class="btn ghost sm" data-action="fill-selection" ${this.selection ? '' : 'disabled'}>Remplir</button>
        <button class="btn ghost sm" data-action="deselect" ${this.selection ? '' : 'disabled'}>Désélectionner</button>
      </div>
      <p class="options-hint">Le contour progressif s’applique aux sélections suivantes. Clic droit dans la toile : remplir, effacer, inverser.</p>`;
  }

  private marqueeOptionsHtml(): string {
    const mode = this.marqueeMode;
    return `
      <div class="segmented" data-marquee-mode>
        <button data-marquee="rect" class="${mode === 'rect' ? 'is-active' : ''}">Rectangle</button>
        <button data-marquee="ellipse" class="${mode === 'ellipse' ? 'is-active' : ''}">Ellipse</button>
        <button data-marquee="lasso" class="${mode === 'lasso' ? 'is-active' : ''}">Lasso</button>
      </div>
      ${this.featherFieldHtml()}
      <div class="button-row">
        <button class="btn ghost sm" data-action="select-all">Tout sélectionner</button>
        <button class="btn ghost sm" data-action="deselect" ${this.selection ? '' : 'disabled'}>Désélectionner</button>
        <button class="btn ghost sm" data-action="invert-selection" ${this.selection ? '' : 'disabled'}>Inverser</button>
        <button class="btn ghost sm" data-action="fill-selection" ${this.selection ? '' : 'disabled'}>Remplir</button>
      </div>
      <p class="options-hint">${this.selection ? 'Les réglages et tracés sont limités à la sélection. Clic droit dans la toile : remplir la sélection.' : 'Aucune sélection : les outils agissent sur tout le calque.'}</p>`;
  }

  /** Contour progressif, partagé par la zone de sélection et la baguette. */
  private featherFieldHtml(): string {
    const feather = Math.round(this.selectionFeather);
    return `
      <label class="range-field">Contour progressif <output data-feather-output>${feather} px</output>
        <input type="range" min="0" max="120" step="1" data-feather-field value="${feather}">
      </label>`;
  }

  private wandOptionsHtml(): string {
    const wand = this.wand;
    return `
      <label class="range-field">Tolérance <output data-wand-output="tolerance">${wand.tolerance}</output>
        <input type="range" min="0" max="128" step="1" data-wand-field="tolerance" value="${wand.tolerance}">
      </label>
      <label class="check-field"><input type="checkbox" data-wand-field="contiguous" ${wand.contiguous ? 'checked' : ''}> Zones contiguës</label>
      <label class="check-field"><input type="checkbox" data-wand-field="merged" ${wand.merged ? 'checked' : ''}> Échantillonner l’image composée</label>
      ${this.featherFieldHtml()}
      <div class="button-row">
        <button class="btn ghost sm" data-action="deselect" ${this.selection ? '' : 'disabled'}>Désélectionner</button>
        <button class="btn ghost sm" data-action="invert-selection" ${this.selection ? '' : 'disabled'}>Inverser</button>
        <button class="btn ghost sm" data-action="fill-selection" ${this.selection ? '' : 'disabled'}>Remplir</button>
      </div>
      <p class="options-hint">${escapeHtml(TOOLS['magic-wand'].hint)}</p>`;
  }

  private spotlightOptionsHtml(): string {
    const spot = this.spotlight;
    return `
      <label class="range-field">Diamètre <output data-spot-output="diameter">${Math.round(spot.diameter)} px</output>
        <input type="range" min="20" max="2400" step="10" data-spot-field="diameter" value="${spot.diameter}">
      </label>
      <label class="range-field">Intensité <output data-spot-output="intensity">${spot.intensity} %</output>
        <input type="range" min="1" max="100" step="1" data-spot-field="intensity" value="${spot.intensity}">
      </label>
      <label class="range-field">Douceur <output data-spot-output="softness">${spot.softness} %</output>
        <input type="range" min="0" max="100" step="1" data-spot-field="softness" value="${spot.softness}">
      </label>
      <p class="options-hint">${escapeHtml(TOOLS.spotlight.hint)} La sélection, si elle existe, limite la lumière.</p>`;
  }

  private paintTargetHtml(): string {
    const layer = this.activeLayer;
    if (!layer) return '';
    return layer.mask && layer.maskEditing
      ? `<div class="option-card"><span class="option-card-label">Cible</span><strong>Masque · ${escapeHtml(layer.name)}</strong><span class="option-card-sub">Clair révèle · sombre masque</span></div>`
      : `<div class="option-card"><span class="option-card-label">Cible</span><strong>Pixels · ${escapeHtml(layer.name)}</strong><span class="option-card-sub">${KIND_LABELS[layer.kind]}</span></div>`;
  }

  private paintOptionsHtml(): string {
    const brush = this.brush;
    if (this.activeTool === 'pencil') {
      return `
        <label class="range-field">Épaisseur <output data-paint-output="pencilSize">${this.pencilOptions.size} px</output>
          <input type="range" min="1" max="48" step="1" data-paint-field="pencilSize" value="${this.pencilOptions.size}">
        </label>
        <label class="range-field">Opacité <output data-paint-output="pencilOpacity">${this.pencilOptions.opacity} %</output>
          <input type="range" min="1" max="100" step="1" data-paint-field="pencilOpacity" value="${this.pencilOptions.opacity}">
        </label>
        ${this.paintTargetHtml()}
        <p class="options-hint">Trait net, sans lissage. Alt active la gomme, Maj trace une ligne droite.</p>`;
    }
    const erase = this.activeTool === 'eraser';
    return `
      <label class="range-field">Taille <output data-paint-output="size">${brush.size} px</output>
        <input type="range" min="1" max="600" step="1" data-paint-field="size" value="${brush.size}">
      </label>
      <div class="segmented" data-brush-presets>
        <button data-brush-size="8">8</button>
        <button data-brush-size="24">24</button>
        <button data-brush-size="56">56</button>
        <button data-brush-size="120">120</button>
        <button data-brush-size="280">280</button>
      </div>
      <label class="range-field">Dureté <output data-paint-output="hardness">${Math.round(brush.hardness * 100)} %</output>
        <input type="range" min="0" max="100" step="1" data-paint-field="hardness" value="${Math.round(brush.hardness * 100)}">
      </label>
      <label class="range-field">Opacité <output data-paint-output="opacity">${Math.round(brush.opacity * 100)} %</output>
        <input type="range" min="1" max="100" step="1" data-paint-field="opacity" value="${Math.round(brush.opacity * 100)}">
      </label>
      <label class="range-field">Espacement <output data-paint-output="spacing">${Math.round(brush.spacing * 100)} %</output>
        <input type="range" min="2" max="80" step="1" data-paint-field="spacing" value="${Math.round(brush.spacing * 100)}">
      </label>
      ${this.paintTargetHtml()}
      <p class="options-hint">${erase ? 'La gomme efface les pixels ; sur un masque, elle masque la zone.' : 'Alt active la gomme. [ et ] changent la taille du pinceau.'}</p>`;
  }

  private stampOptionsHtml(): string {
    const brush = this.brush;
    const source = this.stampSource;
    return `
      <label class="range-field">Taille <output data-paint-output="size">${brush.size} px</output>
        <input type="range" min="1" max="600" step="1" data-paint-field="size" value="${brush.size}">
      </label>
      <label class="range-field">Dureté <output data-paint-output="hardness">${Math.round(brush.hardness * 100)} %</output>
        <input type="range" min="0" max="100" step="1" data-paint-field="hardness" value="${Math.round(brush.hardness * 100)}">
      </label>
      <label class="range-field">Opacité <output data-paint-output="opacity">${Math.round(brush.opacity * 100)} %</output>
        <input type="range" min="1" max="100" step="1" data-paint-field="opacity" value="${Math.round(brush.opacity * 100)}">
      </label>
      <label class="check-field"><input type="checkbox" data-patch-field="corrector" ${this.patchOptions.corrector ? 'checked' : ''}> Correcteur : harmoniser les couleurs</label>
      <div class="option-card">
        <span class="option-card-label">Source</span>
        <strong>${source ? `x ${Math.round(source.x)} · y ${Math.round(source.y)}` : 'Non définie'}</strong>
        <span class="option-card-sub">Alt+clic sur l’image pour la définir</span>
      </div>
      ${this.paintTargetHtml()}
      <p class="options-hint">${escapeHtml(TOOLS.stamp.hint)}</p>`;
  }

  private patchOptionsHtml(): string {
    const rect = this.patchSourceRect;
    return `
      <label class="check-field"><input type="checkbox" data-patch-field="corrector" ${this.patchOptions.corrector ? 'checked' : ''}> Correcteur : harmoniser les couleurs</label>
      <div class="option-card">
        <span class="option-card-label">Zone à réparer</span>
        <strong>${rect ? `${Math.round(rect.w)} × ${Math.round(rect.h)} px` : 'Aucune'}</strong>
        <span class="option-card-sub">${rect ? 'Glissez la zone sur une zone propre' : 'Tracez d’abord la zone à réparer'}</span>
      </div>
      <div class="button-row">
        <button class="btn ghost sm" data-action="clear-patch" ${rect ? '' : 'disabled'}>Annuler la zone</button>
      </div>
      <p class="options-hint">Sans correcteur, la zone propre est copiée telle quelle ; avec, sa couleur moyenne est ajustée à celle de la zone réparée.</p>`;
  }

  private healOptionsHtml(): string {
    const brush = this.brush;
    return `
      <label class="range-field">Taille <output data-paint-output="size">${brush.size} px</output>
        <input type="range" min="4" max="300" step="1" data-paint-field="size" value="${Math.min(300, brush.size)}">
      </label>
      <label class="range-field">Dureté <output data-paint-output="hardness">${Math.round(brush.hardness * 100)} %</output>
        <input type="range" min="0" max="100" step="1" data-paint-field="hardness" value="${Math.round(brush.hardness * 100)}">
      </label>
      <label class="range-field">Opacité <output data-paint-output="opacity">${Math.round(brush.opacity * 100)} %</output>
        <input type="range" min="1" max="100" step="1" data-paint-field="opacity" value="${Math.round(brush.opacity * 100)}">
      </label>
      ${this.paintTargetHtml()}
      <p class="options-hint">Le correcteur ramène le voisinage immédiat sur la tache : idéal pour un capteur sale, une poussière, un petit défaut de peau.</p>`;
  }

  private cropOptionsHtml(): string {
    const ratios = [
      { value: '', label: 'Libre' },
      { value: '1', label: 'Carré 1:1' },
      { value: '1.333333', label: '4:3' },
      { value: '1.777778', label: '16:9' },
      { value: '1.5', label: '3:2' },
      { value: '0.8', label: '4:5' },
    ];
    const current = this.cropRatio === null ? '' : String(this.cropRatio);
    return `
      <label class="field-label">Format
        <select data-crop-ratio>
          ${ratios.map((ratio) => `<option value="${ratio.value}" ${ratio.value === current ? 'selected' : ''}>${ratio.label}</option>`).join('')}
        </select>
      </label>
      <div class="button-row">
        <button class="btn primary sm" data-action="apply-crop" ${this.pendingCrop ? '' : 'disabled'}>Appliquer</button>
        <button class="btn ghost sm" data-action="cancel-crop" ${this.pendingCrop ? '' : 'disabled'}>Annuler</button>
      </div>
      <p class="options-hint">Tracez le cadre sur l’image, puis validez avec Entrée.</p>`;
  }

  private shapesOptionsHtml(): string {
    const options = this.shapeOptions;
    return `
      <label class="field-label">Objet
        <select data-shape-field="type">
          ${[
            ['rectangle', 'Rectangle'],
            ['ellipse', 'Ellipse'],
            ['triangle', 'Triangle'],
            ['star', 'Étoile'],
            ['line', 'Ligne'],
          ]
            .map(([value, label]) => `<option value="${value}" ${options.type === value ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </label>
      <div class="dual-colors">
        <label class="color-field"><span>Remplissage</span><input type="color" data-shape-field="fill" value="${options.fill}"></label>
        <label class="color-field"><span>Contour</span><input type="color" data-shape-field="stroke" value="${options.stroke}"></label>
      </div>
      <label class="range-field">Épaisseur du contour <output data-shape-output="strokeWidth">${options.strokeWidth} px</output>
        <input type="range" min="0" max="40" step="1" data-shape-field="strokeWidth" value="${options.strokeWidth}">
      </label>
      <label class="range-field">Rayon des angles <output data-shape-output="radius">${options.radius} px</output>
        <input type="range" min="0" max="120" step="1" data-shape-field="radius" value="${options.radius}">
      </label>
      <label class="check-field"><input type="checkbox" data-shape-field="newLayer" ${options.newLayer ? 'checked' : ''}> Dessiner sur un nouveau calque</label>`;
  }

  private penOptionsHtml(): string {
    const layer = this.activePathLayer;
    const path = layer?.path;
    return `
      <div class="button-row">
        <button class="btn primary sm" data-action="new-path">Nouveau tracé</button>
        <button class="btn ghost sm" data-action="close-path" ${path && path.anchors.length > 1 ? '' : 'disabled'}>Fermer</button>
        <button class="btn ghost sm" data-action="delete-anchor" ${path && path.anchors.length > 0 ? '' : 'disabled'}>Dernier point</button>
      </div>
      <div class="dual-colors">
        <label class="check-field"><input type="checkbox" data-path-field="fillEnabled" ${path?.fill ? 'checked' : ''}> Remplissage</label>
        <label class="color-field"><span>Couleur</span><input type="color" data-path-field="fill" value="${path?.fill ?? this.primaryColor}"></label>
      </div>
      <div class="dual-colors">
        <label class="check-field"><input type="checkbox" data-path-field="strokeEnabled" ${path?.stroke ? 'checked' : ''}> Contour</label>
        <label class="color-field"><span>Couleur</span><input type="color" data-path-field="stroke" value="${path?.stroke ?? this.primaryColor}"></label>
      </div>
      <label class="range-field">Épaisseur <output>${Math.round(path?.strokeWidth ?? this.pathOptions.strokeWidth)} px</output>
        <input type="range" min="1" max="40" step="1" data-path-field="strokeWidth" value="${Math.round(path?.strokeWidth ?? this.pathOptions.strokeWidth)}">
      </label>
      <p class="options-hint">${path ? `${path.anchors.length} point(s) · cliquez sur le premier point pour fermer le tracé.` : 'Cliquez sur la toile pour commencer un tracé Bézier.'}</p>`;
  }

  private textOptionsHtml(): string {
    const layer = this.activeTextLayer;
    const text = layer?.text;
    const family = text?.fontFamily ?? this.textOptions.fontFamily;
    const size = text?.fontSize ?? this.textOptions.fontSize;
    const weight = text?.fontWeight ?? this.textOptions.fontWeight;
    const align = text?.align ?? this.textOptions.align;
    return `
      <label class="field-label">Contenu
        <textarea data-text-field="content" rows="4" placeholder="Votre texte…">${escapeHtml(text?.content ?? '')}</textarea>
      </label>
      <div class="inline-fields">
        <label class="field-label">Police
          <select data-text-field="fontFamily">
            ${FONT_FAMILIES.map((font) => `<option value="${font}" ${font === family ? 'selected' : ''}>${font}</option>`).join('')}
          </select>
        </label>
        <label class="field-label">Taille
          <input type="number" min="4" max="800" step="1" data-text-field="fontSize" value="${Math.round(size)}">
        </label>
      </div>
      <div class="inline-fields">
        <label class="field-label">Graisse
          <select data-text-field="fontWeight">
            ${[300, 400, 500, 600, 700, 800, 900].map((value) => `<option value="${value}" ${value === weight ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
        </label>
        <label class="field-label">Couleur
          <input type="color" data-text-field="color" value="${text?.color ?? this.primaryColor}">
        </label>
      </div>
      <div class="segmented" data-text-align>
        ${(['left', 'center', 'right'] as const)
          .map((value) => `<button data-align="${value}" class="${align === value ? 'is-active' : ''}">${value === 'left' ? 'Gauche' : value === 'center' ? 'Centre' : 'Droite'}</button>`)
          .join('')}
      </div>
      <p class="options-hint">Cliquez sur la toile pour créer un texte, ou sur un texte existant pour le modifier.</p>`;
  }

  private eyedropperOptionsHtml(): string {
    return `
      <div class="swatch-preview">
        <span class="big-swatch" style="background:${this.primaryColor}"></span>
        <div><strong>${this.primaryColor.toUpperCase()}</strong><span>Couleur principale</span></div>
      </div>
      <p class="options-hint">Cliquez dans l’image pour prélever une couleur. Maintenez Alt pour la couleur secondaire.</p>`;
  }

  private gradientOptionsHtml(): string {
    const options = this.gradientOptions;
    return `
      <div class="segmented" data-gradient-type>
        <button data-gradient="linear" class="${options.type === 'linear' ? 'is-active' : ''}">Linéaire</button>
        <button data-gradient="radial" class="${options.type === 'radial' ? 'is-active' : ''}">Radial</button>
      </div>
      <label class="field-label">Couleurs
        <select data-gradient-field="colors">
          <option value="fg-transparent" ${options.colors === 'fg-transparent' ? 'selected' : ''}>Couleur → transparent</option>
          <option value="fg-bg" ${options.colors === 'fg-bg' ? 'selected' : ''}>Couleur → secondaire</option>
          <option value="bg-transparent" ${options.colors === 'bg-transparent' ? 'selected' : ''}>Secondaire → transparent</option>
        </select>
      </label>
      <div class="gradient-preview" style="--fg:${this.primaryColor};--bg:${this.secondaryColor}"></div>
      <label class="range-field">Opacité <output data-gradient-output>${options.opacity} %</output>
        <input type="range" min="0" max="100" step="1" data-gradient-field="opacity" value="${options.opacity}">
      </label>
      <label class="check-field"><input type="checkbox" data-gradient-field="newLayer" ${options.newLayer ? 'checked' : ''}> Dessiner sur un nouveau calque</label>
      <p class="options-hint">Glissez pour définir le point de départ et la direction du dégradé.</p>`;
  }

  private zoomOptionsHtml(): string {
    return `
      <div class="button-grid">
        <button class="btn ghost sm" data-action="zoom-fit">Ajuster</button>
        <button class="btn ghost sm" data-action="zoom-100">100 %</button>
        <button class="btn ghost sm" data-action="zoom-200">200 %</button>
        <button class="btn ghost sm" data-action="zoom-400">400 %</button>
      </div>
      <label class="range-field">Zoom <output>${Math.round(this.zoom * 100)} %</output>
        <input type="range" min="2" max="1600" step="1" data-zoom-slider value="${Math.round(this.zoom * 100)}">
      </label>
      <p class="options-hint">Cliquez pour agrandir, Alt+clic pour réduire.</p>`;
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
          <svg class="curve-editor" id="curve-editor" viewBox="0 0 256 256" preserveAspectRatio="none" aria-label="Éditeur de courbes">
            <rect x="0" y="0" width="256" height="256" class="curve-bg"></rect>
            ${[1, 2, 3].map((i) => `<line x1="${i * 64}" y1="0" x2="${i * 64}" y2="256" class="curve-grid"/>`).join('')}
            ${[1, 2, 3].map((i) => `<line x1="0" y1="${i * 64}" x2="256" y2="${i * 64}" class="curve-grid"/>`).join('')}
            <line x1="0" y1="256" x2="256" y2="0" class="curve-diagonal"/>
            <path id="curve-path" class="curve-path" d=""></path>
            <g id="curve-points"></g>
          </svg>
        </div>
        <p class="options-hint">Cliquez pour ajouter un point, glissez pour le déplacer, double-cliquez pour le supprimer.</p>`;
    } else {
      controls = params
        .map((param) => {
          const value = adjustment.params[param.key] ?? param.default;
          return `
            <label class="range-field">
              <span>${param.label}</span>
              <output data-adjust-output="${param.key}">${this.formatParam(value, param)}</output>
              <input type="range" min="${param.min}" max="${param.max}" step="${param.step}" data-adjust-param="${param.key}" value="${value}">
            </label>`;
        })
        .join('');
    }
    return `
      <div class="adjust-head">
        <span class="live-badge"><span class="live-dot"></span>Aperçu direct</span>
        <div class="button-row compact">
          <button class="btn primary sm" data-action="apply-adjustment">Appliquer</button>
          <button class="btn ghost sm" data-action="cancel-adjustment">Annuler</button>
          <button class="btn ghost sm" data-action="reset-adjustment" title="Réinitialiser">↺</button>
        </div>
      </div>
      ${controls}`;
  }

  private formatParam(value: number, param: { step: number; unit?: string }): string {
    const decimals = param.step < 0.1 ? 2 : param.step < 1 ? 1 : 0;
    return `${value.toFixed(decimals)}${param.unit ? ` ${param.unit}` : ''}`;
  }

  private syncRangeFills(): void {
    for (const input of this.toolOptions.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      const min = Number(input.min) || 0;
      const max = Number(input.max) || 100;
      const value = Number(input.value) || 0;
      const ratio = max === min ? 0 : (value - min) / (max - min);
      input.style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);
    }
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
        this.toast('Session enregistrée effacée', 'success');
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

  private openPreferences(): void {
    if (this.adjustment) {
      this.cancelAdjustment();
      this.renderToolOptions();
    }
    this.preferencesSnapshot = { ...this.preferences };
    this.showPreferencesTab('appearance');
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
    this.setMessage('Préférences enregistrées');
    this.toast('Préférences enregistrées', 'success');
  }

  private resetPreferences(): void {
    this.preferences = { ...DEFAULT_PREFERENCES };
    applyPreferences(this.preferences);
    this.applyRuntimePreferences();
    this.syncPreferencesUI();
    this.setMessage('Préférences réinitialisées');
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
    this.setMessage(next === 'dark' ? 'Thème sombre' : 'Thème clair');
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
        ? 'Passer au thème clair'
        : 'Passer au thème sombre';
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
            label: 'Alignement du texte',
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
      label: 'Modification du texte',
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
      label: 'Style du tracé',
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
        this.createPathLayer();
        break;
      case 'clear-patch':
        this.patchSourceRect = null;
        this.renderOverlay();
        this.renderToolOptions();
        this.setMessage('Zone annulée');
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
          label: before ? 'Masquer le calque' : 'Afficher le calque',
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
      if (action === 'mask') {
        const layer = this.doc.layers.find((item) => item.id === layerId);
        if (!layer) return;
        if (this.doc.activeLayerId !== layerId) this.selectLayer(layerId);
        if (layer.maskEnabled === false) {
          layer.maskEnabled = true;
          this.layersDirty = true;
          this.renderAll();
          this.setMessage('Masque réactivé');
          return;
        }
        layer.maskEditing = !layer.maskEditing;
        this.layersDirty = true;
        this.renderAll();
        this.renderToolOptions();
        this.setMessage(layer.maskEditing ? 'Vous peignez le masque' : 'Vous peignez les pixels');
        return;
      }
      this.selectLayer(layerId);
    });

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
      const layer = this.activeLayer;
      if (layer) this.layerPropBefore = layer.opacity;
    };
    opacity.addEventListener('pointerdown', rememberOpacity);
    opacity.addEventListener('focus', rememberOpacity);
    opacity.addEventListener('input', () => {
      const layer = this.activeLayer;
      if (!layer) return;
      layer.opacity = clamp(Number(opacity.value) / 100, 0, 1);
      this.setText('layer-opacity-value', `${Math.round(layer.opacity * 100)} %`);
      this.renderCanvas();
      this.layersDirty = true;
      this.requestFrame();
    });
    opacity.addEventListener('change', () => {
      const layer = this.activeLayer;
      if (!layer || this.layerPropBefore === null) return;
      const before = this.layerPropBefore;
      const after = layer.opacity;
      this.layerPropBefore = null;
      if (Math.abs(before - after) < 0.001) return;
      this.history.push({
        label: 'Opacité du calque',
        undo: () => {
          layer.opacity = before;
          this.renderAll();
        },
        redo: () => {
          layer.opacity = after;
          this.renderAll();
        },
      });
      this.layersDirty = true;
      this.requestFrame();
    });

    const blend = byId<HTMLSelectElement>('layer-blend');
    blend.innerHTML = BLEND_OPTIONS.map(
      (option) => `<option value="${option.value}">${option.label}</option>`,
    ).join('');    blend.addEventListener('change', () => {
      const layer = this.activeLayer;
      if (!layer) return;
      const before = layer.blend;
      const after = blend.value as BlendMode;
      layer.blend = after;
      this.history.push({
        label: 'Mode de fusion',
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
      const after = nameInput.value.trim() || 'Calque';
      const before = nameBefore || layer.name;
      if (after === before) return;
      layer.name = after;
      this.history.push({
        label: 'Renommer le calque',
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
        label: after ? 'Activer le masque' : 'Désactiver le masque',
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

  private toggleMaskForActiveLayer(): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (layer.mask) {
      layer.maskEditing = !layer.maskEditing;
      this.layersDirty = true;
      this.renderAll();
      this.renderToolOptions();
      this.setMessage(layer.maskEditing ? 'Vous peignez le masque' : 'Vous peignez les pixels');
      return;
    }
    if (this.adjustment) this.cancelAdjustment();
    const mask = createMask(doc.width, doc.height);
    layer.mask = mask;
    layer.maskEnabled = true;
    layer.maskEditing = true;
    this.history.push({
      label: 'Ajouter un masque',
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
    this.setMessage('Masque ajouté — peignez en sombre pour masquer');
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
      label: 'Appliquer le masque',
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
    this.setMessage('Masque appliqué aux pixels');
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
      label: 'Supprimer le masque',
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
    this.setMessage('Masque supprimé');
  }

  private selectLayer(layerId: string): void {
    if (!this.doc) return;
    if (this.doc.activeLayerId === layerId) return;
    if (this.adjustment) this.cancelAdjustment();
    this.doc.activeLayerId = layerId;
    this.renderLayers();
    this.renderToolOptions();
    this.renderOverlay();
    this.updateStatus();
  }

  private addNewLayer(): void {
    const doc = this.doc;
    if (!doc) return;
    if (this.adjustment) this.cancelAdjustment();
    const index = doc.layers.findIndex((layer) => layer.id === doc.activeLayerId);
    const insertAt = index >= 0 ? index + 1 : doc.layers.length;
    const previousActive = doc.activeLayerId;
    const layer = createLayer(`Calque ${doc.layers.length + 1}`, doc.width, doc.height);
    doc.layers.splice(insertAt, 0, layer);
    doc.activeLayerId = layer.id;
    this.history.push({
      label: 'Nouveau calque',
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
    this.setMessage('Calque ajouté');
  }

  private duplicateActiveLayer(): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (this.adjustment) this.cancelAdjustment();
    const index = doc.layers.findIndex((item) => item.id === layer.id);
    const insertAt = index + 1;
    const copy = duplicateLayer(layer);
    doc.layers.splice(insertAt, 0, copy);
    doc.activeLayerId = copy.id;
    this.history.push({
      label: 'Dupliquer le calque',
      undo: () => {
        const current = doc.layers.findIndex((item) => item.id === copy.id);
        if (current >= 0) doc.layers.splice(current, 1);
        doc.activeLayerId = layer.id;
        this.renderAll();
      },
      redo: () => {
        doc.layers.splice(Math.min(insertAt, doc.layers.length), 0, copy);
        doc.activeLayerId = copy.id;
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.setMessage('Calque dupliqué');
  }

  private deleteActiveLayer(): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (this.adjustment) this.cancelAdjustment();
    if (doc.layers.length <= 1) {
      this.toast('Impossible de supprimer le dernier calque.', 'error');
      return;
    }
    const index = doc.layers.findIndex((item) => item.id === layer.id);
    doc.layers.splice(index, 1);
    const next = doc.layers[Math.min(index, doc.layers.length - 1)];
    doc.activeLayerId = next?.id ?? '';
    this.history.push({
      label: 'Supprimer le calque',
      undo: () => {
        doc.layers.splice(Math.min(index, doc.layers.length), 0, layer);
        doc.activeLayerId = layer.id;
        this.renderAll();
      },
      redo: () => {
        const current = doc.layers.findIndex((item) => item.id === layer.id);
        if (current >= 0) doc.layers.splice(current, 1);
        const fallback = doc.layers[Math.min(index, doc.layers.length - 1)];
        doc.activeLayerId = fallback?.id ?? '';
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
    this.setMessage('Calque supprimé');
  }

  private moveActiveLayer(delta: number): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (this.adjustment) this.cancelAdjustment();
    const index = doc.layers.findIndex((item) => item.id === layer.id);
    const nextIndex = clamp(index + delta, 0, doc.layers.length - 1);
    if (nextIndex === index) return;
    doc.layers.splice(index, 1);
    doc.layers.splice(nextIndex, 0, layer);
    this.history.push({
      label: 'Réorganiser les calques',
      undo: () => {
        doc.layers.splice(nextIndex, 1);
        doc.layers.splice(index, 0, layer);
        this.renderAll();
      },
      redo: () => {
        doc.layers.splice(index, 1);
        doc.layers.splice(nextIndex, 0, layer);
        this.renderAll();
      },
    });
    this.layersDirty = true;
    this.renderAll();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Adjustments
  // ───────────────────────────────────────────────────────────────────────────

  private openAdjustment(id: AdjustmentId): void {
    if (!this.doc) {
      this.toast('Ouvrez un document avant d’utiliser un réglage.', 'error');
      return;
    }
    const layer = this.activeLayer;
    if (!layer) {
      this.toast('Sélectionnez un calque.', 'error');
      return;
    }
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
    };
    this.renderToolOptions();
    window.setTimeout(() => {
      this.toolOptions.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 30);
    this.setMessage(`${ADJUSTMENT_TITLES[id]} — aperçu direct`);
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
    const label = ADJUSTMENT_TITLES[adjustment.id];
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
    this.setMessage(`Réglage appliqué : ${label}`);
    this.toast(`Réglage appliqué : ${label}`, 'success');
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
      path.setAttribute(
        'd',
        points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${255 - point.y}`).join(' '),
      );
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
        `${Math.round(w)} × ${Math.round(h)} px · ${Math.max(1, Math.round(Number(dpi.value) || 72))} ppp`;
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
    byId('resize-title').textContent = mode === 'image' ? 'Taille de l’image' : 'Taille de la zone de travail';
    byId('resize-subtitle').textContent = mode === 'image'
      ? 'Rééchantillonne les pixels de tous les calques.'
      : 'Étend ou rogne la zone de travail sans changer l’échelle des pixels.';
    byId('resize-dpi-row').hidden = mode !== 'image';
    byId('resize-anchor-row').hidden = mode !== 'canvas';
    byId('resize-note').textContent = mode === 'image'
      ? 'Rééchantillonnage haute qualité via le navigateur.'
      : 'Les calques existants conservent leur taille ; choisissez le point d’ancrage.';
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
    const label = this.resizeMode === 'image' ? 'Taille de l’image' : 'Taille de la zone de travail';
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
        this.exportFormat = (button.dataset.format as 'png' | 'jpeg' | 'webp') ?? 'png';
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
      this.toast('Ouvrez un document avant d’exporter.', 'error');
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
    byId('export-dimensions').textContent = `${this.doc.width} × ${this.doc.height} px · ${Math.round(this.doc.dpi)} ppp`;
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
    byId('export-quality-row').hidden = this.exportFormat === 'png';
    const filename = byId<HTMLInputElement>('export-filename');
    const base = stripExtension(filename.value.trim() || 'superphoto');
    filename.value = `${base}.${this.exportFormat === 'jpeg' ? 'jpg' : this.exportFormat}`;
    byId('export-hint').textContent = this.exportFormat === 'png'
      ? 'PNG conserve la transparence et la netteté des pixels.'
      : 'Le fond transparent sera aplati sur du blanc.';
  }

  private async doExport(): Promise<void> {
    const doc = this.doc;
    if (!doc || this.saving) return;
    this.saving = true;
    const button = byId<HTMLButtonElement>('export-run');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Export…';
    try {
      const mime = mimeForFormat(this.exportFormat);
      const canvas = compositeCanvas(doc, this.exportFormat === 'png' ? null : '#ffffff');
      const quality = Number(byId<HTMLInputElement>('export-quality').value) / 100;
      const blob = await canvasToBlob(canvas, mime, quality);
      let filename = byId<HTMLInputElement>('export-filename').value.trim() || 'superphoto';
      const expectedExt = extensionForMime(mime);
      if (!filename.toLowerCase().endsWith(`.${expectedExt}`)) {
        filename = `${stripExtension(filename)}.${expectedExt}`;
      }
      const saved = await saveExport(blob, filename, mime);
      if (saved) {
        this.closeExportDialog();
        this.toast(`Image exportée · ${filename}`, 'success');
      }
    } catch (error) {
      console.error(error);
      this.toast(`Export impossible : ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      this.saving = false;
      button.disabled = false;
      button.textContent = original ?? 'Exporter';
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
      button.title = active ? 'Quitter le plein écran (F11)' : 'Plein écran (F11)';
      button.setAttribute('aria-label', button.title);
    };
    const toggle = (): void => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void document.documentElement.requestFullscreen().catch(() => {
          this.toast('Le plein écran est refusé par le système.', 'error');
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
    menu.setAttribute('aria-label', 'Actions de sélection');

    const head = document.createElement('div');
    head.className = 'canvas-menu-head';
    head.textContent = selection && bounds
      ? `Sélection · ${Math.round(bounds.w)} × ${Math.round(bounds.h)} px${feather ? ` · contour ${feather} px` : ''}`
      : 'Aucune sélection';
    menu.appendChild(head);

    const items: Array<
      { label: string; hint?: string; disabled?: boolean; run: () => void } | null
    > = [
      {
        label: 'Remplir la sélection',
        hint: 'Alt+Retour',
        disabled: !selection,
        run: () => this.fillSelection(this.primaryColor),
      },
      {
        label: 'Effacer le contenu',
        hint: 'Suppr',
        disabled: !selection,
        run: () => this.clearSelectionContent(),
      },
      null,
      {
        label: 'Inverser la sélection',
        disabled: !selection,
        run: () => {
          if (!this.selection) return;
          this.selection = { ...this.selection, invert: !this.selection.invert };
          this.renderOverlay();
          this.updateStatus();
        },
      },
      {
        label: 'Désélectionner',
        hint: 'Échap',
        disabled: !selection,
        run: () => {
          this.selection = null;
          this.renderOverlay();
          this.renderToolOptions();
          this.updateStatus();
        },
      },
      {
        label: 'Tout sélectionner',
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
      this.toast('Validez ou annulez le réglage en cours.', 'info');
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
    const point = this.docPoint(event);
    this.pointer = point;
    this.pointerInside = true;

    switch (this.activeTool) {
      case 'select': {
        const layer = this.activeLayer;
        if (layer) {
          this.drag = {
            kind: 'move',
            layerId: layer.id,
            start: point,
            moved: false,
            // Cloné au premier vrai déplacement : un simple clic ne copie plus
            // le calque entier (64 Mo sur une image 4000 × 4000).
            beforeCanvas: undefined,
            beforeText: layer.text ? deepClone(layer.text) : undefined,
            beforePath: layer.path ? deepClone(layer.path) : undefined,
          };
        }
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
        this.onPenDown(point, event.shiftKey);
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
      case 'eyedropper':
        break;
      case 'pen-anchor':
      case 'pen-handle':
      case 'pen-new-anchor':
        this.finishPen(drag);
        break;
    }
    this.display.style.cursor = this.spaceDown ? 'grab' : TOOLS[this.activeTool].cursor;
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
    if (!drag.moved && Math.hypot(dx, dy) <= 2 / this.zoom) return;
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
    this.renderCanvas();
    this.renderOverlay();
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
        label: 'Déplacer le texte',
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
        label: 'Déplacer le tracé',
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
        label: 'Déplacer le calque',
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
    this.renderAll();
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
          this.toast('Alt+clic sur l’image pour définir la source du tampon.', 'info');
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
    const label =
      tool === 'stamp'
        ? 'Tampon'
        : tool === 'heal'
          ? 'Correcteur'
          : tool === 'eraser'
            ? 'Gomme'
            : tool === 'pencil'
              ? 'Crayon'
              : 'Pinceau';
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
      this.setMessage('Aucun pixel à sélectionner à cet endroit.');
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
      this.setMessage('Glissez la zone sur une zone propre pour la réparer.');
      return;
    }
    if (layer.mask && layer.maskEditing) {
      this.toast('Revenez aux pixels du calque pour utiliser la pièce.', 'info');
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
      label: this.patchOptions.corrector ? 'Pièce (correcteur)' : 'Pièce',
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
    this.setMessage('Zone réparée');
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
      label: 'Recadrage',
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
    this.setMessage(`Recadré · ${width} × ${height} px`);
  }

  private finishShape(drag: Extract<DragState, { kind: 'shape' }>): void {
    const doc = this.doc;
    if (!doc) return;
    const rect = normalizeRect(drag.start, drag.current);
    const isLine = this.shapeOptions.type === 'line';
    if (!isLine && (rect.w < 3 || rect.h < 3)) return;
    if (isLine && Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) < 3) return;
    const options = this.shapeOptions;
    const label = {
      rectangle: 'Rectangle',
      ellipse: 'Ellipse',
      triangle: 'Triangle',
      star: 'Étoile',
      line: 'Ligne',
    }[options.type];
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
        label: `Ajouter ${label.toLowerCase()}`,
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
        label: 'Dessiner un objet',
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
    this.setMessage(`${label} dessiné`);
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
      target = createLayer('Dégradé', doc.width, doc.height, 'shape');
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
        label: 'Ajouter un dégradé',
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
        label: 'Dessiner un dégradé',
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
    this.setMessage('Dégradé appliqué');
  }

  private finishSpotlight(drag: Extract<DragState, { kind: 'spotlight' }>): void {
    const doc = this.doc;
    const layer = this.activeLayer;
    if (!doc || !layer) return;
    if (layer.mask && layer.maskEditing) {
      this.toast('Quittez l’édition du masque pour poser un point lumineux.', 'info');
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
      label: 'Point lumineux',
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
    const selection = this.selection;
    if (!doc || !selection) return null;
    if (selectionFeather(selection) <= 0) return null;
    const key = `${doc.width}x${doc.height}:${selectionFeather(selection)}:${JSON.stringify(selection)}`;
    if (this.selectionMaskCache?.key === key) return this.selectionMaskCache.mask;
    const mask = buildSelectionMask(selection, doc.width, doc.height);
    this.selectionMaskCache = mask ? { key, mask } : null;
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
    if (!selection || selectionFeather(selection) <= 0) return null;
    const key = `${width}x${height}:${selectionFeather(selection)}:${JSON.stringify(selection)}`;
    if (this.adjustmentMaskCache?.key === key) return this.adjustmentMaskCache.data;
    const mask = buildSelectionMask(selection, width, height);
    if (!mask) return null;
    this.adjustmentMaskCache = { key, data: mask.data };
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
    const layer = createLayer(`Tracé ${doc.layers.length + 1}`, doc.width, doc.height, 'path');
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
      label: 'Nouveau tracé',
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
    this.setMessage('Nouveau tracé Bézier');
    return layer;
  }

  private onPenDown(point: Point, shift: boolean): void {
    let layer = this.activePathLayer;
    if (!layer) layer = this.createPathLayer();
    if (!layer?.path) return;
    const path = layer.path;
    const threshold = 10 / this.zoom;

    for (let index = 0; index < path.anchors.length; index += 1) {
      const anchor = path.anchors[index];
      if (!anchor) continue;
      if (index === 0 && !path.closed && path.anchors.length >= 2 && Math.hypot(point.x - anchor.x, point.y - anchor.y) < threshold) {
        this.closeActivePath();
        return;
      }
      if (Math.hypot(point.x - anchor.x, point.y - anchor.y) < threshold) {
        this.drag = {
          kind: 'pen-anchor',
          layerId: layer.id,
          index,
          before: deepClone(path),
          beforePoint: { x: anchor.x, y: anchor.y },
        };
        return;
      }
      if (Math.hypot(point.x - (anchor.x + anchor.outX), point.y - (anchor.y + anchor.outY)) < threshold) {
        this.drag = { kind: 'pen-handle', layerId: layer.id, index, which: 'out', before: deepClone(path) };
        return;
      }
      if (Math.hypot(point.x - (anchor.x + anchor.inX), point.y - (anchor.y + anchor.inY)) < threshold) {
        this.drag = { kind: 'pen-handle', layerId: layer.id, index, which: 'in', before: deepClone(path) };
        return;
      }
    }

    if (path.closed) {
      layer = this.createPathLayer();
      if (!layer?.path) return;
    }
    const activePath = layer.path;
    const before = deepClone(activePath);
    activePath.anchors.push({ x: point.x, y: point.y, inX: 0, inY: 0, outX: 0, outY: 0 });
    this.drag = {
      kind: 'pen-new-anchor',
      layerId: layer.id,
      index: activePath.anchors.length - 1,
      before,
      start: point,
      moved: false,
    };
    if (shift) {
      const last = activePath.anchors[activePath.anchors.length - 1];
      if (last) {
        last.x = Math.round(last.x);
        last.y = Math.round(last.y);
      }
    }
    renderLayer(layer);
    this.renderCanvas();
    this.renderOverlay();
  }

  private onPenMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || !this.doc) return;
    if (drag.kind !== 'pen-anchor' && drag.kind !== 'pen-handle' && drag.kind !== 'pen-new-anchor') return;
    const layer = this.doc.layers.find((item) => item.id === drag.layerId);
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
      anchor.x = clamp(point.x, 0, this.doc.width);
      anchor.y = clamp(point.y, 0, this.doc.height);
    } else if (drag.kind === 'pen-new-anchor') {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      if (Math.hypot(dx, dy) > 2 / this.zoom) drag.moved = true;
      if (drag.moved) {
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
    renderLayer(layer);
    this.renderCanvas();
    this.renderOverlay();
  }

  private finishPen(drag: Extract<DragState, { kind: 'pen-anchor' | 'pen-handle' | 'pen-new-anchor' }>): void {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.layers.find((item) => item.id === drag.layerId);
    if (!layer?.path) return;
    const after = deepClone(layer.path);
    if (JSON.stringify(after) === JSON.stringify(drag.before)) return;
    const before = deepClone(drag.before);
    this.history.push({
      label: 'Modifier le tracé',
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
      label: 'Fermer le tracé',
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
    this.setMessage('Tracé fermé');
  }

  private deleteLastAnchor(): void {
    const layer = this.activePathLayer;
    if (!layer?.path || layer.path.anchors.length === 0) return;
    const before = deepClone(layer.path);
    layer.path.anchors.pop();
    const after = deepClone(layer.path);
    renderLayer(layer);
    this.history.push({
      label: 'Supprimer le dernier point',
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
      label: 'Ajouter un texte',
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
          this.openNewDocumentDialog();
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
      }
      if (event.key === 'F11') {
        event.preventDefault();
        byId<HTMLButtonElement>('btn-fullscreen').click();
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
        if (this.activeTool === 'pen') {
          event.preventDefault();
          this.setTool('select');
          return;
        }
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (event.altKey) {
          if (this.selection) {
            event.preventDefault();
            this.fillSelection(this.primaryColor);
            return;
          }
        }
        if (this.selection) {
          event.preventDefault();
          this.clearSelectionContent();
          return;
        }
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
      this.toast('Aplatissez ou dupliquez le calque avant de le vider.', 'info');
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
      label: 'Effacer la sélection',
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
    this.renderAll();
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
      this.toast('Tracez une sélection avant de la remplir.', 'info');
      return;
    }
    if (layer.kind === 'text' || layer.kind === 'path') {
      this.toast('Aplatissez ou dupliquez le calque avant de le remplir.', 'info');
      return;
    }
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
    const label = isMask ? 'Remplir le masque' : 'Remplir la sélection';
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
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      void this.loadImageBlob(file, file.name).catch((error: unknown) => {
        this.toast(`Image illisible : ${error instanceof Error ? error.message : String(error)}`, 'error');
      });
    });

    if (!isTauri()) return;
    void import('@tauri-apps/api/webviewWindow')
      .then(({ getCurrentWebviewWindow }) => {
        void getCurrentWebviewWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type !== 'drop' || payload.paths.length === 0) return;
          const path = payload.paths[0];
          if (!path) return;
          void readNativeImage(path)
            .then((opened) => this.loadImageBlob(opened.blob, opened.name))
            .catch((error: unknown) => {
              this.toast(`Image illisible : ${error instanceof Error ? error.message : String(error)}`, 'error');
            });
        });
      })
      .catch(() => {
        /* La version web reste utilisable sans le pont Tauri. */
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
      const opened = await openImage();
      if (!opened) return;
      await this.loadImageBlob(opened.blob, opened.name);
    } catch (error) {
      console.error(error);
      this.toast(`Ouverture impossible : ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  private async loadImageBlob(blob: Blob, name: string): Promise<void> {
    const bitmap = await createImageBitmap(blob);
    let width = bitmap.width;
    let height = bitmap.height;
    const maxDimension = 16000;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const layer = createLayer('Image', width, height, 'raster');
    const ctx = canvasContext(layer.canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = SMOOTHING_QUALITY[this.preferences.quality];
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
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
    this.applyDocument(doc);
    this.closeNewDocumentDialog();
    this.toast(`${doc.name} · ${width} × ${height} px`, 'success');
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
      this.setMessage(`Annulé : ${label}`);
    }
  }

  private redo(): void {
    if (this.adjustment) return;
    const label = this.history.redo();
    if (label) {
      this.layersDirty = true;
      this.renderAll();
      this.renderToolOptions();
      this.setMessage(`Rétabli : ${label}`);
    }
  }
}

export function startSuperPhoto(): void {
  const scope = window as unknown as { __superphotoStarted?: boolean; __superphoto?: SuperPhotoEditor };
  if (scope.__superphotoStarted) return;
  scope.__superphotoStarted = true;
  scope.__superphoto = new SuperPhotoEditor();
}
