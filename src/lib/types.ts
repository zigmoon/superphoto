export type ToolId =
  | 'select'
  | 'marquee'
  | 'magic-wand'
  | 'crop'
  | 'shapes'
  | 'pen'
  | 'text'
  | 'pencil'
  | 'brush'
  | 'eraser'
  | 'stamp'
  | 'patch'
  | 'heal'
  | 'spotlight'
  | 'eyedropper'
  | 'gradient'
  | 'zoom'
  | 'hand';

export type AdjustmentId = 'tonality' | 'contrast' | 'color' | 'levels' | 'curves';

export type LayerKind = 'raster' | 'text' | 'shape' | 'path';

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextData {
  content: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  bounds?: Rect;
}

export interface Anchor {
  x: number;
  y: number;
  /** Handle offsets relative to the anchor. */
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export interface PathData {
  anchors: Anchor[];
  closed: boolean;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  canvas: HTMLCanvasElement;
  /** Masque de fusion : l'alpha du canvas sert de visibilité (blanc = visible). */
  mask?: HTMLCanvasElement;
  /** Masque actif (désactivable sans le supprimer). */
  maskEnabled?: boolean;
  /** Le calque travaille sur son masque : les outils peignent dedans. */
  maskEditing?: boolean;
  text?: TextData;
  path?: PathData;
}

export interface PhotoDoc {
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: 'white' | 'black' | 'transparent';
  layers: Layer[];
  activeLayerId: string;
}

export type Selection =
  | { type: 'rect'; rect: Rect; invert: boolean; feather?: number }
  | { type: 'ellipse'; rect: Rect; invert: boolean; feather?: number }
  | {
      type: 'poly';
      points: Point[];
      /** Contours supplémentaires (trous) : remplissage pair-impair. */
      rings?: Point[][];
      invert: boolean;
      feather?: number;
    };

export interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

export interface ShapeOptions {
  type: 'rectangle' | 'ellipse' | 'triangle' | 'star' | 'line';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  newLayer: boolean;
}

export interface GradientOptions {
  type: 'linear' | 'radial';
  colors: 'fg-transparent' | 'fg-bg' | 'bg-transparent';
  opacity: number;
  newLayer: boolean;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';

export interface BrushSettings {
  /** Diamètre en pixels du document. */
  size: number;
  /** 0 = bord très doux, 1 = bord net. */
  hardness: number;
  /** Opacité du flux, 0 → 1. */
  opacity: number;
  /** Espacement des tampons, en fraction du diamètre. */
  spacing: number;
}

export interface WandSettings {
  /** Tolérance colorimétrique, 0 → 255. */
  tolerance: number;
  /** Faux = sélection globale (toutes les zones de la même couleur). */
  contiguous: boolean;
  /** Échantillonne l'image composée plutôt que le calque actif. */
  merged: boolean;
}

export interface PatchSettings {
  /** Correcteur : harmonise la couleur copiée avec la zone d'accueil. */
  corrector: boolean;
}

export interface AdjustmentState {
  id: AdjustmentId;
  layerId: string;
  /** Pixels d'origine, pleine résolution (appliqués une seule fois). */
  original: ImageData;
  /** Aperçu réduit : les glissières restent fluides sur les grandes images. */
  preview: ImageData;
  previewScale: number;
  previewCanvas: HTMLCanvasElement;
  params: Record<string, number>;
  channel: CurveChannel;
  curves: Record<CurveChannel, CurvePoint[]>;
}
