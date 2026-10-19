export type ToolId =
  | 'select'
  | 'marquee'
  | 'crop'
  | 'shapes'
  | 'pen'
  | 'text'
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
  | { type: 'rect'; rect: Rect; invert: boolean }
  | { type: 'ellipse'; rect: Rect; invert: boolean }
  | { type: 'poly'; points: Point[]; invert: boolean };

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
