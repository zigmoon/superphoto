/**
 * Remplissage visuel des glissières.
 *
 * Une `input[type=range]` ne sait pas exposer sa valeur à CSS : la partie
 * « remplie » de la piste est donc peinte par une variable `--fill`. La calculer
 * pour chaque glissière à chaque fois qu'elle est créée est une source d'oubli
 * (les paramètres de greffon et l'opacité du calque restaient par exemple à 50 %).
 *
 * Ce module centralise le calcul et le rejoue automatiquement :
 *   • délégation des événements `input` / `change` sur le document entier ;
 *   • `MutationObserver` pour les glissières injectées après coup (panneaux,
 *     options d'outil, paramètres de greffon…) ;
 *   • `paintRanges()` pour les mises à jour programmatiques (`input.value = …`).
 */

const SELECTOR = 'input[type="range"]';

/** Recalcule la portion remplie d'une glissière. */
export function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const low = Number.isFinite(min) ? min : 0;
  const high = Number.isFinite(max) ? max : 100;
  const ratio = high === low ? 0 : (value - low) / (high - low);
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10;
  input.style.setProperty('--fill', `${percent}%`);
}

/** Recalcule toutes les glissières d'un sous-arbre (document par défaut). */
export function paintRanges(root: ParentNode = document): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(SELECTOR)) paintRange(input);
}

function paintFromEvent(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === 'range') paintRange(target);
}

/** À appeler une fois au démarrage. Idempotent. */
export function initRangePaint(): void {
  document.addEventListener('input', paintFromEvent, true);
  document.addEventListener('change', paintFromEvent, true);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node instanceof HTMLInputElement && node.type === 'range') {
          paintRange(node);
          continue;
        }
        paintRanges(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  paintRanges();
}
