export type ThemeMode = 'light' | 'dark' | 'system';
/** Interface noir et blanc : l'accent est l'encre (ou le blanc en thème sombre). */
export type AccentId = 'ink';
export type CheckerId = 'auto' | 'light' | 'dark';
export type MotionMode = 'full' | 'reduced';
export type RenderQuality = 'fast' | 'balanced' | 'precise';

export interface Preferences {
  theme: ThemeMode;
  accent: AccentId;
  checker: CheckerId;
  motion: MotionMode;
  quality: RenderQuality;
  coordinates: boolean;
  smoothZoom: boolean;
  autoFit: boolean;
  /** Enregistre le document dans le navigateur après chaque modification. */
  autosave: boolean;
}

export const PREFERENCES_KEY = 'superphoto:prefs:v1';
export const PREFERENCES_EVENT = 'superphoto:preferences';

/**
 * SuperPrint ouvre en clair : SuperPhoto fait de même. Le thème sombre reste à
 * un clic (bascule de la barre supérieure ou Préférences).
 */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light',
  accent: 'ink',
  checker: 'auto',
  motion: 'full',
  quality: 'balanced',
  coordinates: true,
  smoothZoom: true,
  autoFit: true,
  autosave: true,
};

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const ACCENTS: AccentId[] = ['ink'];
const CHECKERS: CheckerId[] = ['auto', 'light', 'dark'];
const MOTIONS: MotionMode[] = ['full', 'reduced'];
const QUALITIES: RenderQuality[] = ['fast', 'balanced', 'precise'];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizePreferences(raw: unknown): Preferences {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    theme: pick(source.theme, THEME_MODES, DEFAULT_PREFERENCES.theme),
    accent: pick(source.accent, ACCENTS, DEFAULT_PREFERENCES.accent),
    checker: pick(source.checker, CHECKERS, DEFAULT_PREFERENCES.checker),
    motion: pick(source.motion, MOTIONS, DEFAULT_PREFERENCES.motion),
    quality: pick(source.quality, QUALITIES, DEFAULT_PREFERENCES.quality),
    coordinates: pickBoolean(source.coordinates, DEFAULT_PREFERENCES.coordinates),
    smoothZoom: pickBoolean(source.smoothZoom, DEFAULT_PREFERENCES.smoothZoom),
    autoFit: pickBoolean(source.autoFit, DEFAULT_PREFERENCES.autoFit),
    autosave: pickBoolean(source.autosave, DEFAULT_PREFERENCES.autosave),
  };
}

export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    /* Stockage indisponible (navigation privée) : on continue sans persister. */
  }
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Applique les préférences au document. Aucun re-rendu du canvas n'est
 * nécessaire : tout passe par les jetons CSS et deux attributs.
 */
export function applyPreferences(preferences: Preferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveTheme(preferences.theme);
  root.classList.toggle('theme-dark', resolved === 'dark');
  root.classList.toggle('theme-light', resolved === 'light');
  root.classList.toggle('reduce-motion', preferences.motion === 'reduced');
  root.dataset.theme = resolved;
  root.dataset.themeMode = preferences.theme;
  root.dataset.accent = preferences.accent;
  root.dataset.checker = preferences.checker;
  root.dataset.quality = preferences.quality;
  root.style.colorScheme = resolved;
  window.dispatchEvent(
    new CustomEvent<Preferences>(PREFERENCES_EVENT, { detail: { ...preferences } }),
  );
}

export function preferencesEqual(a: Preferences, b: Preferences): boolean {
  return (
    a.theme === b.theme &&
    a.accent === b.accent &&
    a.checker === b.checker &&
    a.motion === b.motion &&
    a.quality === b.quality &&
    a.coordinates === b.coordinates &&
    a.smoothZoom === b.smoothZoom &&
    a.autoFit === b.autoFit &&
    a.autosave === b.autosave
  );
}

export function onPreferencesChange(listener: (preferences: Preferences) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Preferences>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(PREFERENCES_EVENT, handler);
  return () => window.removeEventListener(PREFERENCES_EVENT, handler);
}

let systemWatcher: MediaQueryList | null = null;

/**
 * Rejoue le thème « Système » quand l'OS change de mode. Certaines webviews
 * n'émettent pas `change` : on revérifie aussi au focus et au retour de veille.
 */
export function watchSystemTheme(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  if (systemWatcher) return;

  const reapply = () => {
    const preferences = loadPreferences();
    if (preferences.theme !== 'system') return;
    if (document.documentElement.dataset.theme !== resolveTheme('system')) {
      applyPreferences(preferences);
    }
  };

  systemWatcher = window.matchMedia('(prefers-color-scheme: dark)');
  systemWatcher.addEventListener('change', reapply);
  window.addEventListener('focus', reapply);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reapply();
  });
}

export const RENDER_QUALITY_LABELS: Record<RenderQuality, string> = {
  fast: 'Rapide',
  balanced: 'Équilibrée',
  precise: 'Précise',
};
