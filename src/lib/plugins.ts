/**
 * Greffons SuperPhoto.
 *
 * Un greffon décrit une ou plusieurs **effets** qui transforment les pixels du
 * calque actif (ou de la sélection). Un effet est une fonction pure
 * `(ImageData, params) → void` : elle ne touche ni au document, ni à
 * l'historique, ce qui permet de l'exécuter sur un aperçu réduit puis en pleine
 * résolution avec un résultat identique — à condition que le hasard soit
 * **déterministe**, d'où le générateur ensemencé ci-dessous.
 */

export interface PluginParam {
  key: string;
  /** Clé i18n du libellé (`plugin.<effet>.<param>`). */
  labelKey: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  default: number;
}

export interface PluginEffect {
  id: string;
  nameKey: string;
  descKey: string;
  params: PluginParam[];
  apply(data: ImageData, params: Record<string, number>): void;
}

export interface SuperPhotoPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  descriptionKey: string;
  /** Nom de la classe d'icône affichée dans la barre supérieure. */
  icon: string;
  /** Effets fournis par le greffon. */
  effects: PluginEffect[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Outils internes
// ─────────────────────────────────────────────────────────────────────────────

/** Générateur mulberry32 : rapide, reproductible, même suite à chaque rendu. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defaultParams(effect: PluginEffect): Record<string, number> {
  const params: Record<string, number> = {};
  for (const param of effect.params) params[param.key] = param.default;
  return params;
}

/** Récupère un pixel en coordonnées bornées, jamais hors du tableau. */
function pick(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return data[(cy * width + cx) * 4 + channel] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Effets 2026 — glitch et pellicule abîmée
// ─────────────────────────────────────────────────────────────────────────────

const glitchRgb: PluginEffect = {
  id: 'glitch-rgb',
  nameKey: 'plugin.fx.glitchRgb',
  descKey: 'plugin.fx.glitchRgbHint',
  params: [
    { key: 'amount', labelKey: 'plugin.param.amount', min: 0, max: 64, step: 1, unit: 'px', default: 8 },
    { key: 'jitter', labelKey: 'plugin.param.jitter', min: 0, max: 40, step: 1, unit: 'px', default: 6 },
    { key: 'tear', labelKey: 'plugin.param.tear', min: 0, max: 40, step: 1, unit: '', default: 8 },
    { key: 'seed', labelKey: 'plugin.param.seed', min: 1, max: 999, step: 1, unit: '', default: 7 },
  ],
  apply(data, params) {
    const { width, height } = data;
    const src = new Uint8ClampedArray(data.data);
    const random = rng(params.seed ?? 7);
    // Décalage chromatique : le rouge part d'un côté, le bleu de l'autre.
    // L'amplitude varie par ligne, ce qui casse la régularité du glitch.
    // `_scale` vaut < 1 sur l'aperçu réduit : les distances restent exprimées en
    // pixels du document, donc l'aperçu montre le résultat final.
    const ratio = params._scale ?? 1;
    const amount = (params.amount ?? 8) * ratio;
    const jitter = (params.jitter ?? 6) * ratio;
    const tears = (params.tear ?? 8) / 100;
    for (let y = 0; y < height; y += 1) {
      const drift = (random() * 2 - 1) * jitter;
      const offsetR = Math.round(amount + drift);
      const offsetB = -Math.round(amount + drift * 0.7);
      const tear = random() < tears * 0.35 ? Math.round((random() * 2 - 1) * amount * 6) : 0;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        data.data[index] = pick(src, width, height, x + offsetR + tear, y, 0);
        data.data[index + 2] = pick(src, width, height, x + offsetB + tear, y, 2);
      }
    }
  },
};

const glitchBlocks: PluginEffect = {
  id: 'glitch-blocks',
  nameKey: 'plugin.fx.glitchBlocks',
  descKey: 'plugin.fx.glitchBlocksHint',
  params: [
    { key: 'density', labelKey: 'plugin.param.density', min: 2, max: 80, step: 1, unit: '', default: 18 },
    { key: 'shift', labelKey: 'plugin.param.shift', min: 2, max: 120, step: 1, unit: 'px', default: 24 },
    { key: 'seed', labelKey: 'plugin.param.seed', min: 1, max: 999, step: 1, unit: '', default: 11 },
  ],
  apply(data, params) {
    const { width, height } = data;
    const src = new Uint8ClampedArray(data.data);
    const random = rng(params.seed ?? 11);
    const density = Math.max(2, Math.round(params.density ?? 18));
    const shift = (params.shift ?? 24) * (params._scale ?? 1);
    for (let block = 0; block < density; block += 1) {
      const startY = Math.floor(random() * height);
      const bandHeight = 1 + Math.floor(random() * Math.max(2, height * 0.06));
      const offset = Math.round((random() * 2 - 1) * shift);
      for (let y = startY; y < Math.min(height, startY + bandHeight); y += 1) {
        for (let x = 0; x < width; x += 1) {
          const from = Math.round(x - offset);
          const index = (y * width + x) * 4;
          data.data[index] = pick(src, width, height, from, y, 0);
          data.data[index + 1] = pick(src, width, height, from, y, 1);
          data.data[index + 2] = pick(src, width, height, from, y, 2);
        }
      }
    }
  },
};

const scanlines: PluginEffect = {
  id: 'scanlines',
  nameKey: 'plugin.fx.scanlines',
  descKey: 'plugin.fx.scanlinesHint',
  params: [
    { key: 'strength', labelKey: 'plugin.param.strength', min: 0, max: 100, step: 1, unit: '%', default: 35 },
    { key: 'period', labelKey: 'plugin.param.period', min: 1, max: 8, step: 1, unit: 'px', default: 2 },
    { key: 'vignette', labelKey: 'plugin.param.vignette', min: 0, max: 100, step: 1, unit: '%', default: 25 },
  ],
  apply(data, params) {
    const { width, height } = data;
    const strength = (params.strength ?? 35) / 100;
    const period = Math.max(1, Math.round(params.period ?? 2));
    const vignette = (params.vignette ?? 25) / 100;
    const cx = width / 2;
    const cy = height / 2;
    const maxDistance = Math.hypot(cx, cy) || 1;
    for (let y = 0; y < height; y += 1) {
      const lineFactor = y % period === 0 ? 1 - strength : 1;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const distance = Math.hypot(x - cx, y - cy) / maxDistance;
        const falloff = 1 - vignette * distance * distance;
        data.data[index] = (data.data[index] ?? 0) * lineFactor * falloff;
        data.data[index + 1] = (data.data[index + 1] ?? 0) * lineFactor * falloff;
        data.data[index + 2] = (data.data[index + 2] ?? 0) * lineFactor * falloff;
      }
    }
  },
};

const scratches: PluginEffect = {
  id: 'scratches',
  nameKey: 'plugin.fx.scratches',
  descKey: 'plugin.fx.scratchesHint',
  params: [
    { key: 'count', labelKey: 'plugin.param.count', min: 1, max: 40, step: 1, unit: '', default: 8 },
    { key: 'length', labelKey: 'plugin.param.length', min: 10, max: 100, step: 1, unit: '%', default: 55 },
    { key: 'brightness', labelKey: 'plugin.param.brightness', min: 0, max: 100, step: 1, unit: '%', default: 60 },
    { key: 'seed', labelKey: 'plugin.param.seed', min: 1, max: 999, step: 1, unit: '', default: 3 },
  ],
  apply(data, params) {
    const { width, height } = data;
    const random = rng(params.seed ?? 3);
    const count = Math.max(1, Math.round(params.count ?? 8));
    const length = (params.length ?? 55) / 100;
    const brightness = (params.brightness ?? 60) / 100;
    const paint = (x: number, y: number, value: number, alpha: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const current = data.data[index + channel] ?? 0;
        data.data[index + channel] = current + (value - current) * alpha;
      }
    };
    for (let i = 0; i < count; i += 1) {
      // Une rayure est presque verticale : elle dérive légèrement, comme une
      // poussière qui accroche la pellicule pendant le défilement.
      const startX = random() * width;
      const startY = random() * height * (1 - length);
      const run = height * length * (0.4 + random() * 0.6);
      const tilt = (random() * 2 - 1) * 0.06;
      const white = random() > 0.35;
      const value = white ? 255 : 0;
      const alpha = brightness * (0.25 + random() * 0.5);
      const thickness = random() > 0.75 && (params._scale ?? 1) > 0.5 ? 2 : 1;
      for (let step = 0; step < run; step += 1) {
        const x = startX + step * tilt * width * 0.02;
        const y = startY + step;
        paint(Math.round(x), Math.round(y), value, alpha);
        if (thickness > 1) paint(Math.round(x) + 1, Math.round(y), value, alpha * 0.6);
      }
    }
  },
};

const dust: PluginEffect = {
  id: 'dust',
  nameKey: 'plugin.fx.dust',
  descKey: 'plugin.fx.dustHint',
  params: [
    { key: 'count', labelKey: 'plugin.param.count', min: 4, max: 400, step: 1, unit: '', default: 90 },
    { key: 'size', labelKey: 'plugin.param.size', min: 1, max: 12, step: 1, unit: 'px', default: 2 },
    { key: 'seed', labelKey: 'plugin.param.seed', min: 1, max: 999, step: 1, unit: '', default: 5 },
  ],
  apply(data, params) {
    const { width, height } = data;
    const random = rng(params.seed ?? 5);
    const count = Math.max(4, Math.round(params.count ?? 90));
    // La taille est saisie en pixels du document : sur l'aperçu réduit, elle
    // est multipliée par le facteur d'échelle pour rester proportionnelle.
    const base = Math.max(1, params.size ?? 2) * (params._scale ?? 1);
    for (let i = 0; i < count; i += 1) {
      const cx = random() * width;
      const cy = random() * height;
      const radius = Math.max(0.7, base * (0.4 + random()));
      const dark = random() > 0.4;
      const target = dark ? 0 : 255;
      const alpha = 0.25 + random() * 0.55;
      const minX = Math.max(0, Math.floor(cx - radius - 1));
      const maxX = Math.min(width - 1, Math.ceil(cx + radius + 1));
      const minY = Math.max(0, Math.floor(cy - radius - 1));
      const maxY = Math.min(height - 1, Math.ceil(cy + radius + 1));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const distance = Math.hypot(x - cx, y - cy);
          if (distance > radius) continue;
          const falloff = 1 - distance / radius;
          const index = (y * width + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const current = data.data[index + channel] ?? 0;
            data.data[index + channel] = current + (target - current) * alpha * falloff;
          }
        }
      }
    }
  },
};

const grain: PluginEffect = {
  id: 'grain',
  nameKey: 'plugin.fx.grain',
  descKey: 'plugin.fx.grainHint',
  params: [
    { key: 'amount', labelKey: 'plugin.param.amount', min: 0, max: 100, step: 1, unit: '%', default: 35 },
    { key: 'size', labelKey: 'plugin.param.grainSize', min: 1, max: 6, step: 1, unit: 'px', default: 1 },
    { key: 'color', labelKey: 'plugin.param.grainColor', min: 0, max: 100, step: 1, unit: '%', default: 0 },
  ],
  apply(data, params) {
    const { width, height } = data;
    const amount = (params.amount ?? 35) / 100;
    const cell = Math.max(1, Math.round((params.size ?? 1) * (params._scale ?? 1)));
    const color = (params.color ?? 0) / 100;
    const random = rng(0x5eed);
    // Le grain est calculé par cellules puis partagé : cela reproduit la
    // granularité de l'argentique au lieu d'un bruit vidéo à 1 px.
    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    const noise = new Float32Array(cols * rows);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (random() * 2 - 1) * amount * 42;
    for (let y = 0; y < height; y += 1) {
      const row = Math.floor(y / cell) * cols;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const base = noise[row + Math.floor(x / cell)] ?? 0;
        const luma = base;
        const chromaR = color > 0 ? noise[(row + Math.floor(x / cell) + 7) % noise.length]! * color : 0;
        const chromaB = color > 0 ? noise[(row + Math.floor(x / cell) + 19) % noise.length]! * color : 0;
        data.data[index] = (data.data[index] ?? 0) + luma + chromaR;
        data.data[index + 1] = (data.data[index + 1] ?? 0) + luma;
        data.data[index + 2] = (data.data[index + 2] ?? 0) + luma + chromaB;
      }
    }
  },
};

const vhs: PluginEffect = {
  id: 'vhs',
  nameKey: 'plugin.fx.vhs',
  descKey: 'plugin.fx.vhsHint',
  params: [
    { key: 'bleed', labelKey: 'plugin.param.bleed', min: 0, max: 40, step: 1, unit: 'px', default: 10 },
    { key: 'noise', labelKey: 'plugin.param.noise', min: 0, max: 100, step: 1, unit: '%', default: 30 },
    { key: 'tracking', labelKey: 'plugin.param.tracking', min: 0, max: 100, step: 1, unit: '%', default: 35 },
    { key: 'seed', labelKey: 'plugin.param.seed', min: 1, max: 999, step: 1, unit: '', default: 21 },
  ],
  apply(data, params) {
    const width = data.width;
    const height = data.height;
    const src = new Uint8ClampedArray(data.data);
    const bleed = Math.max(0, Math.round((params.bleed ?? 10) * (params._scale ?? 1)));
    const noise = (params.noise ?? 30) / 100;
    const tracking = (params.tracking ?? 35) / 100;
    const random = rng(params.seed ?? 21);
    // Bande de « tracking » : une zone qui défile verticalement et se tord.
    const bandY = Math.floor(random() * Math.max(1, height - height * 0.08));
    const bandHeight = Math.max(2, Math.round(height * 0.06 * tracking + 2));
    for (let y = 0; y < height; y += 1) {
      const inBand = y >= bandY && y < bandY + bandHeight;
      const lineShift = inBand ? Math.round((random() * 2 - 1) * bleed * 2) : 0;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        // Le chroma bave vers la droite (bande passante limitée de la VHS).
        let red = 0;
        let blue = 0;
        for (let tap = 0; tap <= bleed; tap += 1) {
          const weight = 1 - tap / (bleed + 1);
          red += pick(src, width, height, x - tap + lineShift, y, 0) * weight;
          blue += pick(src, width, height, x + tap + lineShift, y, 2) * weight;
        }
        const total = (bleed + 2) / 2;
        let r = red / total;
        let b = blue / total;
        let g = pick(src, width, height, x + lineShift, y, 1);
        const sparkle = (random() * 2 - 1) * noise * 34;
        r += sparkle;
        g += sparkle;
        b += sparkle;
        // Légère désaturation : la VHS ne tient pas les couleurs saturées.
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * 0.85;
        g = luma + (g - luma) * 0.85;
        b = luma + (b - luma) * 0.85;
        data.data[index] = r;
        data.data[index + 1] = g;
        data.data[index + 2] = b;
      }
    }
  },
};

export const EFFECTS_2026: SuperPhotoPlugin = {
  id: 'effects-2026',
  name: 'Effects 2026',
  version: '1.0.0',
  author: 'SuperPhoto',
  descriptionKey: 'plugin.effects2026.desc',
  icon: 'i-plugins',
  effects: [glitchRgb, glitchBlocks, scanlines, scratches, dust, grain, vhs],
};

export const PLUGINS: SuperPhotoPlugin[] = [EFFECTS_2026];

export function findPlugin(id: string): SuperPhotoPlugin | null {
  return PLUGINS.find((plugin) => plugin.id === id) ?? null;
}

export function findEffect(pluginId: string, effectId: string): PluginEffect | null {
  return findPlugin(pluginId)?.effects.find((effect) => effect.id === effectId) ?? null;
}

export function effectParams(effect: PluginEffect): Record<string, number> {
  return defaultParams(effect);
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation persistée
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'superphoto:plugins';
export const PLUGINS_EVENT = 'superphoto:plugins-change';

export type PluginState = Record<string, boolean>;

export function loadPluginState(): PluginState {
  const state: PluginState = {};
  // Le greffon livré avec l'application est actif d'emblée : c'est un outil de
  // plus, pas un module à installer.
  for (const plugin of PLUGINS) state[plugin.id] = plugin.id === EFFECTS_2026.id;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return state;
    const stored = JSON.parse(raw) as PluginState;
    for (const plugin of PLUGINS) {
      const value = stored[plugin.id];
      if (typeof value === 'boolean') state[plugin.id] = value;
    }
  } catch {
    /* Stockage indisponible : on garde les valeurs par défaut. */
  }
  return state;
}

export function savePluginState(state: PluginState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Stockage indisponible : l'activation reste valable pour la session. */
  }
  window.dispatchEvent(new CustomEvent<PluginState>(PLUGINS_EVENT, { detail: state }));
}

export function activePlugins(state: PluginState): SuperPhotoPlugin[] {
  return PLUGINS.filter((plugin) => state[plugin.id]);
}
