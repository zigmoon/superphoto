# SuperPhoto

**Studio de retouche photographique clair ou sombre, rapide et précis — Astro + Rust (Tauri).**

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
- **Dupliquer** et **Supprimer**.
- Monter / descendre dans la pile.
- Opacité (0–100 %) et modes de fusion (Produit, Écran, Incrustation, Lumière crue, etc.).
- Ajout de calque vide.

### Colonne de droite — Outils et réglages

| Outil | Rôle |
| --- | --- |
| **Sélection** (V) | Choisir un calque au clic, déplacer son contenu au glisser. |
| **Zone de sélection** (M) | Rectangle, ellipse ou lasso ; tout sélectionner, désélectionner, inverser. Les réglages et les tracés respectent la sélection. |
| **Recadrage** (C) | Cadre libre ou ratios 1:1, 4:3, 16:9, 3:2, 4:5 ; validation par Entrée ou bouton Appliquer. |
| **Objets** (U) | Rectangle, ellipse, triangle, étoile et ligne, avec remplissage, contour, épaisseur et rayon. |
| **Plume** (P) | Tracé Bézier : clic = point, glisser = courbes, clic sur le premier point = fermer. Points et poignées restent éditables. |
| **Texte** (T) | Bloc de texte éditable (contenu, police, taille, graisse, couleur, alignement). |
| **Pipette** (I) | Prélèvement de couleur dans l’image composite (Alt = couleur secondaire). |
| **Dégradé** (G) | Linéaire ou radial, couleur → transparent, couleur → secondaire, secondaire → transparent. |
| **Zoom** (Z) | Zoom avant/arrière, ajustement, 100 %, 200 %, 400 %, molette avec Ctrl/⌘. |
| **Main** (H) | Déplacement de la vue ; barre d’espace temporaire. |
| **Taille de l’image** | Rééchantillonnage haute qualité de tous les calques, résolution modifiable. |
| **Taille de la zone de travail** | Extension/rogne avec point d’ancrage 3×3, sans changer l’échelle des pixels. |
| **Tonalité** | Exposition (EV), luminosité, noirs. |
| **Contraste** | Contraste global. |
| **Couleur** | Saturation, teinte, température, tint. |
| **Niveaux** | Point noir, point blanc, gamma, sortie noire/blanche. |
| **Courbes** | Éditeur interactif RVB / R / G / B : clic pour ajouter un point, glisser pour ajuster, double-clic pour supprimer. |

Les cinq réglages disposent d’un **aperçu direct**, d’**Appliquer**, **Annuler** et **Réinitialiser**. Ils s’appliquent au calque actif et respectent la sélection ; appliquer un réglage à un calque Texte ou Tracé le rasterise.

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
| **Apparence** | Thème **Clair / Sombre / Système**, couleur d’accent (Orange, Encre, Bleu, Vert, Rose), animations normales ou réduites. |
| **Toile** | Damier de transparence (auto/clair/sombre), qualité de rendu (rapide/équilibrée/précise), coordonnées du curseur, lissage du zoom, ajustement automatique au redimensionnement. |
| **Raccourcis** | Toutes les combinaisons clavier, classées par outil, fichier et vue. |
| **À propos** | Version, technologies, crédits, licence. |

**Appliquer** enregistre et ferme ; **Annuler** (ou `Échap`) rétablit l’état d’ouverture ; **Réinitialiser** revient aux valeurs par défaut.

### Raccourcis

| Raccourci | Action |
| --- | --- |
| `V` `M` `C` `U` `P` `T` `I` `G` `Z` `H` | Outils |
| `Ctrl/⌘ + Z` | Annuler |
| `Ctrl/⌘ + Shift + Z` ou `Ctrl/⌘ + Y` | Rétablir |
| `Ctrl/⌘ + N` | Nouveau document |
| `Ctrl/⌘ + O` | Ouvrir une image |
| `Ctrl/⌘ + S` | Exporter |
| `Ctrl/⌘ + ,` | Préférences |
| `Ctrl/⌘ + 0` | Ajuster à la fenêtre |
| `Ctrl/⌘ + 1` | Zoom 100 % |
| `Ctrl/⌘ + +` / `Ctrl/⌘ + -` | Zoom avant / arrière |
| `Entrée` | Appliquer le recadrage / terminer la plume |
| `Échap` | Annuler le réglage, le recadrage ou la sélection |
| `Suppr` | Effacer le contenu de la sélection |
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
npm run build        # dist/
npm run preview
npm run check        # vérification TypeScript/Astro
```

### Desktop

```bash
npm run desktop:dev             # Tauri + Astro en mode développement
npm run desktop:build           # installeurs natifs (Windows/macOS/Linux)
npm run desktop:build:debug     # binaire debug sans installeur
```

La configuration Tauri se trouve dans [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json). Les assets embarqués pointent vers `../dist`.

### Compilation multi-plateforme

Le workflow [`.github/workflows/build.yml`](.github/workflows/build.yml) construit :

- **Windows x64** (MSI/NSIS) ;
- **Linux x64** (deb/AppImage) ;
- **macOS universel** (Apple Silicon + Intel).

Il s’exécute manuellement (`workflow_dispatch`) ou sur un tag `v*`. Les installeurs sont publiés comme artefacts GitHub Actions. Pour l’utiliser, le dossier `superphoto/` doit être à la racine du dépôt publié (ou déplacé dans un dépôt dédié).

---

## 4. Notes d’implémentation

- **Calques** : chaque calque possède un canvas de la taille du document. La composition applique opacité et mode de fusion. Les calques Texte et Tracé conservent leurs métadonnées éditables ; les autres outils les rasterisent si nécessaire.
- **Sélection** : masque rectangulaire, elliptique ou polygonale (lasso), avec inversion. Les réglages pixel par pixel et les dessins utilisent ce masque.
- **Historique** : commandes avec fermetures undo/redo, limitées à 24 entrées. Les snapshots de géométrie (recadrage, resize) conservent les anciens canvases.
- **Rééchantillonnage** : `drawImage` avec un `imageSmoothingQuality` piloté par la préférence de rendu (rapide / équilibrée / précise) ; le backend Rust pourra accueillir un pipeline Lanczos/ICC lors d’une prochaine itération.
- **Export** : composition des calques visibles, aplatissement sur blanc pour JPEG, encodage par le navigateur, écriture native via Rust.
- **Thèmes** : chaque couleur est un jeton CSS (`--bg-surface`, `--text`, `--accent`…). Changer de thème ou d’accent ne re-rend **jamais** le canvas ; l’état du document est indépendant de l’habillage.
- **Fluidité** : une seule mise à jour pointeur par frame (les événements sont coalescés puis « flushés » au relâchement), rect de toile mis en cache, clones de calques différés au premier vrai déplacement, liste de calques mise à jour de façon incrémentale, canvas composite en contexte GPU (sans `willReadFrequently`), zoom molette coalescé, `contain: layout style` sur les panneaux, animations désactivables.
- **Sécurité Tauri** : CSP laissée à `null` pour permettre les bundles Astro et les blobs ; les chemins de fichiers ne sont jamais exposés au JS, seuls les octets passent par les commandes.

## 5. Feuille de route

- Réglages non destructifs (calques de réglage) et masques de fusion.
- Gestion colorimétrique ICC/CMYK et aperçu d’impression.
- Import/export PSD, TIFF multipage, OpenRaster.
- Pinceaux avec pression, flux, dureté et tablette graphique.
- Pipeline Rust dédié pour les gros filtres (Lanczos, débruitage, correction lens).
- Projets `.superphoto` sauvegardables.

---

SuperPhoto — un Photoshop killer qui commence par les fondations : un canvas rapide, des calques propres, des courbes justes et une interface qui laisse respirer l’image.
