<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/brand-logo-dark.png">
  <img src=".github/brand-logo-light.png" alt="SuperPhoto — studio de retouche photographique" width="340">
</picture>

**Studio de retouche photographique clair ou sombre, rapide et précis — Astro + Rust (Tauri).**

[![Build](https://github.com/zigmoon/superphoto/actions/workflows/build.yml/badge.svg)](https://github.com/zigmoon/superphoto/actions/workflows/build.yml)
[![Dernière version](https://img.shields.io/github/v/release/zigmoon/superphoto?label=release)](https://github.com/zigmoon/superphoto/releases/latest)
[![Licence](https://img.shields.io/github/license/zigmoon/superphoto)](LICENSE)

**Windows · macOS · Linux · Web**

</div>

---

SuperPhoto reprend la grammaire visuelle de [SuperPrint](https://superprint.cc/app/index.html) — barres compactes, libellés mono, panneaux à filets fins, toile au centre. Le **thème clair est la palette exacte de SuperPrint** (`#f8f8f8`, `#ffffff`, `#e0e0e0`, `#1a1a1a`, toile `#e8e8e8`) ; le thème sombre est celui du studio photo. Calques à gauche, outils et réglages à droite, image au centre.

L’application est une web app Astro/TypeScript qui s’exécute aussi bien dans un navigateur (`npm run dev`) que dans une fenêtre native Tauri pour **Windows, macOS et Linux** (`npm run desktop:dev`, `npx tauri build`).

---

## 1. Ce qui est déjà là

### Fenêtre d’ouverture

Au lancement, une boîte **Nouveau document** propose :

- **Largeur**, **Hauteur** (en pixels) et **Résolution** (ppp) ;
- des formats rapides (Écran HD, Photo 6 Mpx, A4 300 ppp, Carré, Ultra HD, Portrait) ;
- un fond **Blanc**, **Transparent** ou **Noir**, avec aperçu du ratio ;
- les boutons **Ouvrir** (créer le document), **Annuler** et **Ouvrir depuis l’ordinateur**.

Le bouton **Ouvrir depuis l’ordinateur** utilise les dialogues natifs Tauri en mode desktop et un sélecteur de fichier en mode navigateur.

### Colonne de gauche — Calques

- Liste ordonnée (du calque supérieur au calque inférieur) avec vignette, nom et type.
- Afficher/masquer, sélectionner, renommer.
- **Masque de fusion** (bouton *Masque*) : vignette à côté du calque, activable/désactivable, appliquable aux pixels ou supprimable. Cliquer la vignette du masque met les outils en mode masque (clair = révéler, sombre = masquer).
- **Dupliquer** et **Supprimer** (le masque est dupliqué avec le calque).
- Monter / descendre dans la pile.
- Opacité (0–100 %) et modes de fusion (Produit, Écran, Incrustation, Lumière crue, etc.).
- Ajout de calque vide.

### Colonne de droite — Outils et réglages

| Outil | Rôle |
| --- | --- |
| **Sélection** (V) | Choisir un calque au clic, déplacer son contenu au glisser. |
| **Zone de sélection** (M) | Rectangle, ellipse ou lasso ; **contour progressif** de 0 à 120 px, visible dans la toile (bande translucide) et appliqué au pinceau, au remplissage, aux objets et aux réglages. Tout sélectionner, désélectionner, inverser. Clic droit dans la toile : **Remplir la sélection**, effacer, inverser, désélectionner. |
| **Baguette magique** (W) | Sélection par couleur proche, tolérance réglable, zones contiguës ou globales, échantillonnage du calque ou de l’image composée. Le contour devient une sélection polygonale (trous compris) : détourage, inversion et réglages fonctionnent dessus. |
| **Recadrage** (C) | Cadre libre ou ratios 1:1, 4:3, 16:9, 3:2, 4:5 ; validation par Entrée ou bouton Appliquer. |
| **Objets** (U) | Rectangle, ellipse, triangle, étoile et ligne, avec remplissage, contour, épaisseur et rayon. |
| **Plume** (P) | Tracé Bézier : clic = point, glisser = courbes, clic sur le premier point = fermer. Points et poignées restent éditables. |
| **Texte** (T) | Bloc de texte éditable (contenu, police, taille, graisse, couleur, alignement). |
| **Crayon** (N) | Trait net sans lissage, épaisseur et opacité réglables. Alt = gomme. |
| **Pinceau** (B) | Tampons doux : taille (1–600 px), dureté, opacité, espacement, préréglages 8/24/56/120/280. Alt = gomme. |
| **Gomme** (E) | Efface les pixels du calque (ou masque, si vous peignez le masque). |
| **Tampon** (S) | Clonage : Alt+clic définit la source, puis on peint. Option **Correcteur** pour harmoniser la couleur copiée avec la zone d’accueil. Échantillonne l’image composée. |
| **Pièce** (J) | Tracez la zone à réparer, puis glissez-la sur une zone propre : le contenu propre remplace la zone. Avec ou sans **Correcteur** (harmonisation colorimétrique). |
| **Correcteur** (K) | Peinture de retouche : la source est choisie automatiquement parmi quatre zones voisines (rejet de la valeur aberrante) et sa couleur est harmonisée. |
| **Point lumineux** (L) | Éclaircit une zone circulaire : diamètre, intensité et douceur réglables. Clic pour poser au diamètre choisi, glisser depuis le centre pour ajuster le rayon. La sélection (nette ou floue) limite la lumière. |
| **Pipette** (I) | Prélèvement de couleur dans l’image composite (Alt = couleur secondaire). |
| **Dégradé** (G) | Linéaire ou radial, couleur → transparent, couleur → secondaire, secondaire → transparent. |
| **Zoom** (Z) | Zoom avant/arrière, ajustement, 100 %, 200 %, 400 %, molette avec Ctrl/⌘. |
| **Main** (H) | Déplacement de la vue ; barre d’espace temporaire. |
| **Taille de l’image** | Rééchantillonnage haute qualité de tous les calques (masques compris), résolution modifiable. |
| **Taille de la zone de travail** | Extension/rogne avec point d’ancrage 3×3, sans changer l’échelle des pixels. |
| **Tonalité** | Exposition (EV), luminosité, noirs. |
| **Contraste** | Contraste global. |
| **Couleur** | Saturation, teinte, température, tint. |
| **Niveaux** | Point noir, point blanc, gamma, sortie noire/blanche. |
| **Courbes** | Éditeur interactif RVB / R / G / B : clic pour ajouter un point, glisser pour ajuster, double-clic pour supprimer. |

Les cinq réglages disposent d’un **aperçu direct**, d’**Appliquer**, **Annuler** et **Réinitialiser**. Ils s’appliquent au calque actif et respectent la sélection ; appliquer un réglage à un calque Texte ou Tracé le rasterise.

### Sauvegarde automatique

Le document (calques **et** masques) est enregistré dans **IndexedDB** après chaque modification — fermer l’onglet ne perd plus le travail.

- Badge dans la barre d’état : `Auto`, `Enregistrement…`, `Enregistré 10:42`, `Auto off`, `Auto indisponible`.
- Au démarrage, la session précédente est **restaurée automatiquement** ; sinon la fenêtre « Nouveau document » s’ouvre.
- Les calques sont stockés en PNG (`toBlob`), sans base64 : pas de limite de 5 Mo et pas de blocage de l’interface.
- Désactivable dans **Préférences → Toile → Session**, avec un bouton **Oublier la session enregistrée**.

### Barre supérieure et barre d’état

- Nouveau, Ouvrir, Exporter.
- Annuler / Rétablir avec historique (24 niveaux).
- Zoom, ajustement à la fenêtre, couleurs principale/secondaire.
- Bascule **clair / sombre** en un clic et bouton **⚙ Préférences** (même glyphe que SuperPrint).
- Nom du document, dimensions, résolution, nombre de calques.
- Export **PNG**, **JPEG** ou **WebP** avec qualité réglable.

### Préférences (⚙)

Les préférences s’ouvrent avec le bouton **⚙** de la barre supérieure ou `Ctrl/⌘ + ,`. Elles sont enregistrées dans `localStorage` et appliquées avant le premier rendu (aucun flash de thème).

| Onglet | Réglages |
| --- | --- |
| **Apparence** | Thème **Clair / Sombre / Système**, animations normales ou réduites. L'interface reste **noir et blanc** : aucun accent coloré. |
| **Toile** | Damier de transparence (auto/clair/sombre), qualité de rendu (rapide/équilibrée/précise), coordonnées du curseur, lissage du zoom, ajustement automatique au redimensionnement. **Session** : sauvegarde automatique et bouton pour oublier la session enregistrée. |
| **Raccourcis** | Toutes les combinaisons clavier, classées par outil, fichier et vue. |
| **À propos** | Version, technologies, crédits, licence. |

**Appliquer** enregistre et ferme ; **Annuler** (ou `Échap`) rétablit l’état d’ouverture ; **Réinitialiser** revient aux valeurs par défaut.

### Raccourcis

| Raccourci | Action |
| --- | --- |
| `V` `M` `W` `C` `U` `P` `T` `N` `B` `E` `S` `J` `K` `L` `I` `G` `Z` `H` | Outils (Sélection, Zone, Baguette, Recadrage, Objets, Plume, Texte, Crayon, Pinceau, Gomme, Tampon, Pièce, Correcteur, Point lumineux, Pipette, Dégradé, Zoom, Main) |
| `[` / `]` | Taille du pinceau (ou du crayon) |
| `Alt + clic` | Source du tampon · gomme temporaire · couleur secondaire (pipette) |
| `Ctrl/⌘ + Z` | Annuler |
| `Ctrl/⌘ + Shift + Z` ou `Ctrl/⌘ + Y` | Rétablir |
| `Ctrl/⌘ + N` | Nouveau document |
| `Ctrl/⌘ + O` | Ouvrir une image |
| `Ctrl/⌘ + A` | Tout sélectionner |
| `Ctrl/⌘ + S` | Exporter |
| `Ctrl/⌘ + ,` | Préférences |
| `Ctrl/⌘ + 0` | Ajuster à la fenêtre |
| `Ctrl/⌘ + 1` | Zoom 100 % |
| `Ctrl/⌘ + +` / `Ctrl/⌘ + -` | Zoom avant / arrière |
| `Entrée` | Appliquer le recadrage / terminer la plume |
| `Échap` | Annuler le réglage, le recadrage ou la sélection |
| `Suppr` | Effacer le contenu de la sélection |
| `Alt + Retour arrière` | Remplir la sélection avec la couleur principale |
| `Espace` | Main temporaire |

---

## 2. Architecture

```text
superphoto/
├─ src/
│  ├─ pages/index.astro          # page unique du studio
│  ├─ components/                # top bar, calques, outils, toile, dialogues, préférences
│  ├─ layouts/BaseLayout.astro   # amorçage du thème avant le premier rendu
│  ├─ styles/app.css             # jetons clair + sombre, composants, préférences
│  └─ lib/
│     ├─ editor.ts               # contrôleur UI, outils, historique, raccourcis
│     ├─ preferences.ts          # préférences typées, persistance, thème système
│     ├─ document.ts             # modèle de document, composition, resize/crop
│     ├─ adjustments.ts          # tonalité, contraste, couleur, niveaux, courbes
│     ├─ history.ts              # undo/redo par commandes
│     ├─ io.ts                   # pont navigateur ↔ Tauri (open/save)
│     ├─ types.ts
│     └─ utils.ts
├─ src-tauri/
│  ├─ src/lib.rs                 # commandes Rust natives
│  ├─ src/main.rs
│  ├─ tauri.conf.json
│  ├─ capabilities/default.json
│  └─ icons/
├─ .github/workflows/build.yml   # builds Windows / Linux / macOS universel
└─ astro.config.mjs
```

### Frontend Astro

Le HTML et le CSS sont générés par Astro. Le studio est un moteur TypeScript qui manipule un **canvas 2D** par calque et un canvas composite affiché. Les opérations de dessin, d’ajustement et d’export restent dans la webview pour une latence minimale ; Astro ne livre que la page et les bundles nécessaires.

### Backend Rust

Tauri v2 expose trois commandes dans [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) :

- `read_image_file` — lit une image et renvoie son contenu (base64) à la webview ;
- `write_export_file` — écrit le blob PNG/JPEG/WebP exporté ;
- `probe_image` — lit les métadonnées natives (format, dimensions, poids) via la crate `image`.

Les dialogues **Ouvrir** et **Enregistrer** passent par `tauri-plugin-dialog`. Le glisser-déposer de fichiers est géré par `onDragDropEvent`.

---

## 3. Démarrage

### Prérequis

- Node.js ≥ 20.3 (testé avec Node 22) ;
- Rust stable et les prérequis Tauri :
  - **Windows** : Visual Studio Build Tools (workload C++), WebView2 (présent sur Windows 10/11) ;
  - **macOS** : Xcode Command Line Tools ;
  - **Linux** : `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `libgtk-3-dev`, `patchelf`.

### Web

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # dist/ (liens absolus : racine de domaine ou bureau)
npm run build:web    # dist/ (liens relatifs : n'importe quel sous-dossier)
npm run preview:web  # teste dist/ monté dans /app/ — comme après un envoi FTP
npm run check        # vérification TypeScript/Astro
```

L’application web est **la même page que celle du bureau** : aucun backend n’est requis.
Quand `isTauri()` est faux, l’ouverture passe par le sélecteur de fichiers du navigateur
et l’export par un téléchargement (`Blob`). Tout le reste — calques, historique,
courbes, niveaux, préférences — tourne dans le navigateur.

### Mise en ligne par FTP

`npm run build:web` produit un dossier autonome dont tous les liens sont relatifs
(`./assets/…`, `./favicon.svg`) : il fonctionne aussi bien à la racine du domaine que
dans `/app/`, `/superphoto/` ou `/outils/photo/`, sans rien recompiler.

```bash
npm run build:web:zip                 # dist/ + superphoto-web.zip
# puis : envoyer le CONTENU de dist/ (pas le dossier lui-même) par FTP
```

- Le script échoue volontairement si un lien absolu subsiste : un dossier « à moitié
  relatif » ne peut pas être publié par erreur.
- `public/.htaccess` est copié dans `dist/` : types MIME (`webp`, `svg`), compression et
  cache (un an pour les assets hachés, `no-cache` pour `index.html`). Il est ignoré par
  un serveur qui ne lit pas Apache — aucun réglage n’est nécessaire ailleurs.
- Mise à jour = relancer `npm run build:web` et réenvoyer le contenu de `dist/`.
- Base fixe : `node scripts/build-web.mjs --base=/app/` (liens absolus) si le site est
  servi depuis un sous-dossier définitif (`npm` intercepterait `--base`).

### Desktop

```bash
npm run desktop:dev             # Tauri + Astro en mode développement
npm run desktop:build           # installeurs natifs (Windows/macOS/Linux)
npm run desktop:exe             # binaire autonome, sans installeur (assets embarqués)
```

La configuration Tauri se trouve dans [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json). Les assets embarqués pointent vers `../dist`.

#### ⚠️ « localhost a refusé de se connecter » au lancement

Cette page d’erreur signifie une seule chose : le binaire a été compilé **en mode dev**
et cherche le serveur Astro sur `http://localhost:4321` au lieu de charger les fichiers
embarqués. Tauri décide de cela à la compilation, via la feature `custom-protocol` :

| Commande | Mode | Résultat |
| --- | --- | --- |
| `npm run desktop:dev` | dev | ✅ nécessite Astro (`beforeDevCommand` le lance) |
| `npm run desktop:exe` / `desktop:build` | production | ✅ autonome, aucune dépendance réseau |
| `cargo build --features custom-protocol` | production | ✅ équivalent, pour un `cargo` manuel |
| `cargo build` **seul** | dev | ❌ `ERR_CONNECTION_REFUSED` sans serveur Astro |

Si le port 4321 est déjà pris (un `npm run dev` oublié), `astro dev` refuse de démarrer et
`tauri dev` ouvre la fenêtre sur une page d’erreur : fermez l’autre instance ou lancez
`npm run dev` séparément, puis `npm run desktop:exe`.

Vérification rapide du binaire produit — l’URL chargée doit être `tauri://localhost`, pas
`localhost:4321` :

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'
.\src-tauri\target\debug\superphoto.exe
curl.exe -s http://127.0.0.1:9333/json    # "url":"http://tauri.localhost/"
```

### Compilation multi-plateforme (GitHub Actions)

Le workflow [`.github/workflows/build.yml`](.github/workflows/build.yml) produit, à chaque
envoi sur `main` :

| Job | Produit |
| --- | --- |
| **Web (FTP)** | `superphoto-web.zip` — le dossier à décompresser sur le serveur |
| **Windows x64** | installeur NSIS `SuperPhoto_0.1.3_x64-setup.exe` |
| **Linux x64** | paquet `.deb` et `.AppImage` |
| **macOS universel** | `.dmg` signé pour Apple Silicon **et** Intel (`universal-apple-darwin`) |

- Les fichiers sont attachés à chaque exécution comme **artefacts** (conservés 90 jours).
- Un tag `v*` (ou le lancement manuel avec l’option *release*) publie en plus une
  **Release GitHub** contenant les quatre livrables.
- Rust est mis en cache (`Swatinem/rust-cache`) et les builds sont annulés s’ils sont
  remplacés par un envoi plus récent (`concurrency`).

```bash
git tag v0.1.0 && git push origin v0.1.0   # → Release complète Windows + Linux + macOS + web
```

Le dépôt est [`zigmoon/superphoto`](https://github.com/zigmoon/superphoto) ; le dossier
`superphoto/` en est la racine.

---

## 4. Marque et icônes

Le logo officiel est déposé à la racine du projet (`super_photo_noir.svg`,
`super_photo_blanc.svg` et leurs PNG). Les exports Illustrator contiennent une
quarantaine de calques masqués, un `DOCTYPE` avec DTD externe — qui rend le fichier
impossible à lire dans un canvas — et 250 Ko de métadonnées : ils ne sont **jamais**
utilisés tels quels.

```bash
npm run brand      # régénère tous les fichiers de marque
```

`scripts/brand.mjs` ne garde que le calque visible, recolore les deux familles de formes
(silhouette / fentes) et écrit :

| Fichier | Usage |
| --- | --- |
| `src/assets/brand/app-icon.svg` | marque inlinée par `BrandMark.astro` (barre supérieure, état vide, À propos, fenêtre d’ouverture) |
| `public/favicon.svg` | favicon adaptatif (pastille sombre + marque blanche, lisible en 16 px) |
| `public/favicon-32.png`, `public/apple-touch-icon.png` | replis PNG et icône iOS |
| `public/brand/mark.svg` | marque monochrome adaptative (`--brand-ink` / `--brand-knockout`) |
| `public/brand/mark-light.svg`, `mark-dark.svg` | marque noire / blanche pour `<img>`, e-mails, presse |
| `public/brand/app-icon.svg`, `icon-192.png`, `icon-512.png`, `icon-64.png` | PWA, boutiques, partages |
| `public/brand/og-image.png` | carte de partage 1200 × 630 |
| `public/site.webmanifest` | manifeste PWA (nom, icônes, couleurs) |

Les icônes natives (`.ico`, `.icns`, Windows Store, Android, iOS) sont générées depuis
`public/brand/app-icon.svg` :

```bash
npx tauri icon public/brand/app-icon.svg   # écrit src-tauri/icons/
```

La pastille est volontairement **identique dans les deux thèmes** (carré sombre, marque
blanche) : un logo noir sur fond sombre disparaîtrait de la barre des tâches ou du dock.
En mode monochrome (impression, filigrane), utilisez `mark.svg` avec `currentColor`.

---

## 5. Notes d’implémentation

- **Calques** : chaque calque possède un canvas de la taille du document. La composition applique opacité et mode de fusion. Les calques Texte et Tracé conservent leurs métadonnées éditables ; les autres outils les rasterisent si nécessaire.
- **Masques** : le masque est un canvas dont l’**alpha** porte la visibilité. Peindre en clair compose en `source-over`, peindre en sombre efface en `destination-out` — aucune boucle par pixel. La composition passe par un canvas de travail (`destination-in`), si bien que l’opacité et le mode de fusion du calque restent intacts.
- **Baguette magique** : diffusion 4-connexe sur un `Uint8Array`, puis extraction des contours (segments de frontière), simplification Douglas-Peucker et conversion en sélection polygonale multi-anneaux (remplissage pair-impair). Tous les outils existants fonctionnent dessus sans code parallèle.
- **Moteur de peinture** : tampons calculés dans un canvas de la taille du pinceau (jamais du document), espacement constant quelle que soit la fréquence de la souris, tampon obligatoire au premier contact (`force`) pour qu’un simple clic marque. Tampon et correcteur échantillonnent l’image composée ; le correcteur choisit sa source parmi quatre voisines par consensus (rejet de la valeur aberrante) et harmonise la couleur.
- **Sélection** : masque rectangulaire, elliptique ou polygonale (lasso ou baguette), avec inversion. Les réglages pixel par pixel et les dessins utilisent ce masque.
- **Historique** : commandes avec fermetures undo/redo, limitées à 24 entrées. Les snapshots de géométrie (recadrage, resize) conservent les anciens canvases et les masques.
- **Sauvegarde automatique** : IndexedDB (`superphoto` / `sessions` / `current`), un PNG par calque et par masque via `toBlob`, écriture différée de 1,5 s et vidage forcée quand l’onglet passe en arrière-plan.
- **Rééchantillonnage** : `drawImage` avec un `imageSmoothingQuality` piloté par la préférence de rendu (rapide / équilibrée / précise) ; le backend Rust pourra accueillir un pipeline Lanczos/ICC lors d’une prochaine itération.
- **Export** : composition des calques visibles, aplatissement sur blanc pour JPEG, encodage par le navigateur, écriture native via Rust.
- **Thèmes** : chaque couleur est un jeton CSS (`--bg-surface`, `--text`, `--accent`…). Changer de thème ou d’accent ne re-rend **jamais** le canvas ; l’état du document est indépendant de l’habillage.
- **Fluidité** : une seule mise à jour pointeur par frame (les événements sont coalescés puis « flushés » au relâchement), rect de toile mis en cache, clones de calques différés au premier vrai déplacement, liste de calques mise à jour de façon incrémentale, canvas composite en contexte GPU (sans `willReadFrequently`), zoom molette coalescé, `contain: layout style` sur les panneaux, animations désactivables.
- **Sécurité Tauri** : CSP laissée à `null` pour permettre les bundles Astro et les blobs ; les chemins de fichiers ne sont jamais exposés au JS, seuls les octets passent par les commandes.

## 6. Feuille de route

- Réglages non destructifs (calques de réglage).
- Gestion colorimétrique ICC/CMYK et aperçu d’impression.
- Import/export PSD, TIFF multipage, OpenRaster.
- Pinceaux avec pression, flux, dureté et tablette graphique.
- Pipeline Rust dédié pour les gros filtres (Lanczos, débruitage, correction lens).
- Projets `.superphoto` sauvegardables.

---

SuperPhoto — un Photoshop killer qui commence par les fondations : un canvas rapide, des calques propres, des courbes justes et une interface qui laisse respirer l’image.
