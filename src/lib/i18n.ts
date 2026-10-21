/**
 * Internationalisation de SuperPhoto.
 *
 * L'anglais est la langue par défaut ; le français et le japonais sont
 * proposés dans les préférences. Au premier lancement on suit la langue du
 * navigateur, puis le choix explicite de l'utilisateur est conservé dans
 * `localStorage` (clé `superphoto:lang`) — il survit donc aux rechargements et
 * aux nouvelles sessions.
 *
 * Les libellés statiques sont marqués dans le HTML par `data-i18n`,
 * `data-i18n-title`, `data-i18n-aria` ou `data-i18n-placeholder` :
 * `applyStaticTranslations()` les réécrit d'un coup au changement de langue.
 */

export type Lang = 'en' | 'fr' | 'ja';

export const LANGUAGE_STORAGE_KEY = 'superphoto:lang';
export const LANGUAGE_EVENT = 'superphoto:language';

export const LANGUAGES: Array<{ id: Lang; label: string; english: string }> = [
  { id: 'en', label: 'English', english: 'English' },
  { id: 'fr', label: 'Français', english: 'French' },
  { id: 'ja', label: '日本語', english: 'Japanese' },
];

const ORDER: Record<Lang, 0 | 1 | 2> = { en: 0, fr: 1, ja: 2 };

/** [anglais, français, japonais] */
const D: Record<string, [string, string, string]> = {
  // ── Général ──────────────────────────────────────────────────────────────
  'app.name': ['SuperPhoto', 'SuperPhoto', 'SuperPhoto'],
  'app.tagline': [
    'Photo studio',
    'Studio de retouche',
    'フォトスタジオ',
  ],
  'common.close': ['Close', 'Fermer', '閉じる'],
  'common.cancel': ['Cancel', 'Annuler', 'キャンセル'],
  'common.apply': ['Apply', 'Appliquer', '適用'],
  'common.reset': ['Reset', 'Réinitialiser', 'リセット'],
  'common.save': ['Save', 'Enregistrer', '保存'],
  'common.none': ['None', 'Aucun', 'なし'],
  'common.noneF': ['None', 'Aucune', 'なし'],
  'common.undefined': ['Undefined', 'Non définie', '未定義'],
  'common.px': ['px', 'px', 'px'],
  'common.dpi': ['dpi', 'ppp', 'dpi'],
  'common.percent': ['%', '%', '%'],

  // ── Barre supérieure ────────────────────────────────────────────────────
  'topbar.file': ['File', 'Fichier', 'ファイル'],
  'topbar.new': ['New', 'Nouveau', '新規'],
  'topbar.newTitle': ['New document (Ctrl+N)', 'Nouveau document (Ctrl+N)', '新規ドキュメント (Ctrl+N)'],
  'topbar.open': ['Open', 'Ouvrir', '開く'],
  'topbar.openTitle': ['Open an image (Ctrl+O)', 'Ouvrir une image (Ctrl+O)', '画像を開く (Ctrl+O)'],
  'topbar.save': ['Save', 'Enregistrer', '保存'],
  'topbar.saveTitle': [
    'Save a package (Ctrl+Shift+S)',
    'Enregistrer un paquet (Ctrl+Maj+S)',
    'パッケージを保存 (Ctrl+Shift+S)',
  ],
  'topbar.export': ['Export', 'Exporter', '書き出し'],
  'topbar.exportTitle': ['Export (Ctrl+S)', 'Exporter (Ctrl+S)', '書き出し (Ctrl+S)'],
  'topbar.undo': ['Undo', 'Annuler', '元に戻す'],
  'topbar.undoTitle': ['Undo (Ctrl+Z)', 'Annuler (Ctrl+Z)', '元に戻す (Ctrl+Z)'],
  'topbar.redo': ['Redo', 'Rétablir', 'やり直す'],
  'topbar.redoTitle': ['Redo (Ctrl+Y)', 'Rétablir (Ctrl+Y)', 'やり直す (Ctrl+Y)'],
  'topbar.undoNamed': ['Undo: {name}', 'Annuler : {name}', '元に戻す: {name}'],
  'topbar.redoNamed': ['Redo: {name}', 'Rétablir : {name}', 'やり直す: {name}'],
  'topbar.colors': ['Primary and secondary colors', 'Couleurs principale et secondaire', 'メインカラーとサブカラー'],
  'topbar.primary': ['Primary color', 'Couleur principale', 'メインカラー'],
  'topbar.secondary': ['Secondary color', 'Couleur secondaire', 'サブカラー'],
  'topbar.swap': ['Swap colors (X)', 'Inverser les couleurs (X)', 'カラーを入れ替え (X)'],
  'topbar.themeLight': ['Switch to light theme', 'Passer au thème clair', 'ライトテーマに切り替え'],
  'topbar.themeDark': ['Switch to dark theme', 'Passer au thème sombre', 'ダークテーマに切り替え'],
  'topbar.themeToggle': ['Toggle light / dark', 'Basculer clair / sombre', 'ライト / ダークを切り替え'],
  'topbar.preferences': ['Preferences (Ctrl+,)', 'Préférences (Ctrl+,)', '環境設定 (Ctrl+,)'],
  'topbar.openPreferences': ['Open preferences', 'Ouvrir les préférences', '環境設定を開く'],
  'topbar.toggleLayers': ['Show / hide layers', 'Afficher / masquer les calques', 'レイヤーの表示 / 非表示'],
  'topbar.toggleTools': ['Show / hide tools', 'Afficher / masquer les outils', 'ツールの表示 / 非表示'],

  // ── Onglets de documents ────────────────────────────────────────────────
  'tabs.label': ['Open documents', 'Documents ouverts', '開いているドキュメント'],
  'tabs.new': ['New document', 'Nouveau document', '新規ドキュメント'],
  'tabs.close': ['Close {name}', 'Fermer {name}', '「{name}」を閉じる'],
  'tabs.closeOthers': ['Close others', 'Fermer les autres', '他を閉じる'],
  'tabs.unsaved': ['Not exported yet', 'Pas encore exporté', '未書き出し'],
  'tabs.none': ['No document', 'Aucun document', 'ドキュメントなし'],

  // ── Outils ──────────────────────────────────────────────────────────────
  'tool.select.label': ['Select', 'Sélection', '選択'],
  'tool.select.hint': [
    'Click to pick a layer, drag to move its content.',
    'Cliquez pour choisir un calque, glissez pour déplacer son contenu.',
    'クリックでレイヤーを選択、ドラッグで内容を移動します。',
  ],
  'tool.marquee.label': ['Marquee', 'Zone de sélection', '選択範囲'],
  'tool.marquee.hint': [
    'Draw an area to limit adjustments and strokes.',
    'Tracez une zone pour limiter les réglages et les tracés.',
    '調整や描画を範囲で制限します。',
  ],
  'tool.magic-wand.label': ['Magic wand', 'Baguette magique', '自動選択'],
  'tool.magic-wand.hint': [
    'Click to select nearby colors. Shift adds to the selection.',
    'Cliquez pour sélectionner les pixels de couleur proche. Maj ajoute à la sélection.',
    '近い色のピクセルを選択します。Shift で追加選択。',
  ],
  'tool.pencil.label': ['Pencil', 'Crayon', '鉛筆'],
  'tool.pencil.hint': [
    'Hard edge, no smoothing. Alt erases.',
    'Trace net, sans lissage. Alt active la gomme.',
    '滑らかな補間なしの硬い線。Alt で消去。',
  ],
  'tool.brush.label': ['Brush', 'Pinceau', 'ブラシ'],
  'tool.brush.hint': [
    'Paint with the brush. Alt erases.',
    'Peignez avec le pinceau. Alt active la gomme.',
    'ブラシで描画します。Alt で消去。',
  ],
  'tool.eraser.label': ['Eraser', 'Gomme', '消しゴム'],
  'tool.eraser.hint': [
    'Erases layer pixels (or reveals the mask when painting it).',
    'Efface les pixels du calque (ou révèle le masque si vous peignez dessus).',
    'レイヤーのピクセルを消去します（マスク上ではマスクを表示）。',
  ],
  'tool.stamp.label': ['Clone stamp', 'Tampon', 'コピースタンプ'],
  'tool.stamp.hint': [
    'Alt+click sets the source, then paint to clone.',
    'Alt+clic définit la source, puis peignez pour cloner.',
    'Alt+クリックでソースを設定し、描いて複製します。',
  ],
  'tool.patch.label': ['Patch', 'Pièce', '修復'],
  'tool.patch.hint': [
    'Draw the area to repair, then drag it onto a clean area.',
    'Tracez la zone à réparer, puis glissez-la sur une zone propre.',
    '修復する範囲を描き、きれいな場所へドラッグします。',
  ],
  'tool.heal.label': ['Healing brush', 'Correcteur', '修復ブラシ'],
  'tool.heal.hint': [
    'Paint over a small blemish: the surroundings are brought back over it.',
    'Peignez sur une petite tache : le voisinage est ramené dessus.',
    '小さな汚れを塗ると、周囲の色で自然に補正します。',
  ],
  'tool.spotlight.label': ['Light spot', 'Point lumineux', 'スポットライト'],
  'tool.spotlight.hint': [
    'Click to light an area, drag from the center to set its radius.',
    'Cliquez pour éclairer une zone, glissez depuis le centre pour régler son rayon.',
    'クリックで明るく、中心からドラッグで半径を調整します。',
  ],
  'tool.crop.label': ['Crop', 'Recadrage', '切り抜き'],
  'tool.crop.hint': [
    'Draw the new frame, then confirm with Enter.',
    'Tracez le nouveau cadre, puis validez avec Entrée.',
    '新しい枠を描き、Enter で確定します。',
  ],
  'tool.shapes.label': ['Shapes', 'Objets', '図形'],
  'tool.shapes.hint': [
    'Drag to draw a shape. Pick the type in the options.',
    'Glissez pour dessiner une forme. Choisissez le type dans les options.',
    'ドラッグで図形を描きます。種類はオプションで選択。',
  ],
  'tool.pen.label': ['Pen', 'Plume', 'ペン'],
  'tool.pen.hint': [
    'Click to place a corner point, drag to bend it. Click the first point to close, Enter to finish, Esc to go back to Select.',
    'Cliquez pour poser un point anguleux, glissez pour le courber. Cliquez sur le premier point pour fermer, Entrée pour terminer, Échap pour revenir à la sélection.',
    'クリックでコーナー点を置き、ドラッグで曲げます。最初の点で閉じ、Enter で確定、Esc で選択ツールへ。',
  ],
  'tool.text.label': ['Text', 'Texte', 'テキスト'],
  'tool.text.hint': [
    'Click on the canvas to create a text block.',
    'Cliquez sur la toile pour créer un bloc de texte.',
    'キャンバスをクリックしてテキストを作成します。',
  ],
  'tool.eyedropper.label': ['Eyedropper', 'Pipette', 'スポイト'],
  'tool.eyedropper.hint': [
    'Click to sample a color (Alt: secondary color).',
    'Cliquez pour prélever une couleur (Alt : couleur secondaire).',
    'クリックで色を取得します（Alt でサブカラー）。',
  ],
  'tool.gradient.label': ['Gradient', 'Dégradé', 'グラデーション'],
  'tool.gradient.hint': [
    'Drag to set the direction and extent of the gradient.',
    'Glissez pour définir la direction et l’étendue du dégradé.',
    'ドラッグで方向と範囲を決めます。',
  ],
  'tool.zoom.label': ['Zoom', 'Zoom', 'ズーム'],
  'tool.zoom.hint': [
    'Click to zoom in, Alt+click to zoom out.',
    'Cliquez pour agrandir, Alt+clic pour réduire.',
    'クリックで拡大、Alt+クリックで縮小。',
  ],
  'tool.hand.label': ['Hand', 'Main', '手のひら'],
  'tool.hand.hint': [
    'Drag to move the view. Space temporarily activates the hand.',
    'Glissez pour déplacer la vue. Espace active la main temporairement.',
    'ドラッグで表示を移動。Space で一時的に手のひら。',
  ],
  'tool.hand.options': [
    'Drag in the canvas to move around. The spacebar activates the hand at any time.',
    'Glissez dans la toile pour vous déplacer. La barre d’espace active la main à tout moment.',
    'キャンバスをドラッグして移動します。Space キーでいつでも手のひら。',
  ],

  // ── Types de calques ────────────────────────────────────────────────────
  'kind.raster': ['Pixel', 'Pixel', 'ピクセル'],
  'kind.text': ['Text', 'Texte', 'テキスト'],
  'kind.shape': ['Shape', 'Objet', '図形'],
  'kind.path': ['Path', 'Tracé', 'パス'],

  // ── Modes de fusion ─────────────────────────────────────────────────────
  'blend.source-over': ['Normal', 'Normal', '通常'],
  'blend.multiply': ['Multiply', 'Produit', '乗算'],
  'blend.screen': ['Screen', 'Écran', 'スクリーン'],
  'blend.overlay': ['Overlay', 'Incrustation', 'オーバーレイ'],
  'blend.darken': ['Darken', 'Obscurcir', '比較（暗）'],
  'blend.lighten': ['Lighten', 'Éclaircir', '比較（明）'],
  'blend.color-dodge': ['Color dodge', 'Densité +', '覆い焼きカラー'],
  'blend.color-burn': ['Color burn', 'Densité −', '焼き込みカラー'],
  'blend.hard-light': ['Hard light', 'Lumière crue', 'ハードライト'],
  'blend.soft-light': ['Soft light', 'Lumière douce', 'ソフトライト'],
  'blend.difference': ['Difference', 'Différence', '差の絶対値'],
  'blend.exclusion': ['Exclusion', 'Exclusion', '除外'],
  'blend.hue': ['Hue', 'Teinte', '色相'],
  'blend.saturation': ['Saturation', 'Saturation', '彩度'],
  'blend.color': ['Color', 'Couleur', 'カラー'],
  'blend.luminosity': ['Luminosity', 'Luminosité', '輝度'],

  // ── Réglages ────────────────────────────────────────────────────────────
  'adjust.tonality': ['Tonality', 'Tonalité', 'トーン'],
  'adjust.contrast': ['Contrast', 'Contraste', 'コントラスト'],
  'adjust.color': ['Color', 'Couleur', 'カラー'],
  'adjust.levels': ['Levels', 'Niveaux', 'レベル補正'],
  'adjust.curves': ['Curves', 'Courbes', 'トーンカーブ'],
  'adjust.live': ['{name} — live preview', '{name} — aperçu direct', '{name} — ライブプレビュー'],
  'adjust.applied': ['Adjustment applied: {name}', 'Réglage appliqué : {name}', '調整を適用: {name}'],
  'adjust.exposure': ['Exposure', 'Exposition', '露出'],
  'adjust.brightness': ['Brightness', 'Luminosité', '明るさ'],
  'adjust.blacks': ['Blacks', 'Noirs', '黒レベル'],
  'adjust.saturation': ['Saturation', 'Saturation', '彩度'],
  'adjust.hue': ['Hue', 'Teinte', '色相'],
  'adjust.temperature': ['Temperature', 'Température', '色温度'],
  'adjust.tint': ['Tint', 'Teinte', '色かぶり補正'],
  'adjust.inBlack': ['Black point', 'Point noir', '黒レベル入力'],
  'adjust.inWhite': ['White point', 'Point blanc', '白レベル入力'],
  'adjust.gamma': ['Gamma', 'Gamma', 'ガンマ'],
  'adjust.outBlack': ['Output black', 'Sortie noire', '出力黒'],
  'adjust.outWhite': ['Output white', 'Sortie blanche', '出力白'],

  // ── Options d'outils ────────────────────────────────────────────────────
  'opt.image': ['Image', 'Image', '画像'],
  'opt.adjustments': ['Adjustments', 'Réglages', '調整'],
  'opt.groupDraw': ['Selection & drawing', 'Sélection & dessin', '選択と描画'],
  'opt.options': ['Options', 'Options', 'オプション'],
  'opt.studio': ['Studio', 'Studio', 'スタジオ'],
  'opt.tools': ['Tools', 'Outils', 'ツール'],
  'opt.target': ['Target', 'Cible', '対象'],
  'opt.activeLayer': ['Active layer', 'Calque actif', '選択レイヤー'],
  'opt.pickLayer': ['Select a layer', 'Sélectionnez un calque', 'レイヤーを選択'],
  'opt.maskTarget': ['Mask · {name}', 'Masque · {name}', 'マスク · {name}'],
  'opt.pixelsTarget': ['Pixels · {name}', 'Pixels · {name}', 'ピクセル · {name}'],
  'opt.maskTargetHint': ['Light reveals · dark hides', 'Clair révèle · sombre masque', '明るい色で表示 · 暗い色で隠す'],
  'opt.noDocument': ['No document open.', 'Aucun document ouvert.', 'ドキュメントが開かれていません。'],
  'opt.createDocument': ['Create a document', 'Créer un document', 'ドキュメントを作成'],
  'opt.feather': ['Feather', 'Contour progressif', 'ぼかし'],
  'opt.featherScope': [
    'Feathering applies to the next selections. Right-click in the canvas: fill, clear, invert.',
    'Le contour progressif s’applique aux sélections suivantes. Clic droit dans la toile : remplir, effacer, inverser.',
    'ぼかしは次に作成する選択範囲に適用されます。キャンバス右クリックで塗りつぶし・消去・反転。',
  ],
  'opt.selectionHint': [
    'Adjustments and strokes are limited to the selection. Right-click in the canvas: fill the selection.',
    'Les réglages et tracés sont limités à la sélection. Clic droit dans la toile : remplir la sélection.',
    '調整と描画は選択範囲に限定されます。キャンバス右クリックで選択範囲を塗りつぶし。',
  ],
  'opt.noSelection': [
    'No selection: tools affect the whole layer.',
    'Aucune sélection : les outils agissent sur tout le calque.',
    '選択範囲なし：ツールはレイヤー全体に作用します。',
  ],
  'opt.rect': ['Rectangle', 'Rectangle', '長方形'],
  'opt.ellipse': ['Ellipse', 'Ellipse', '楕円'],
  'opt.lasso': ['Lasso', 'Lasso', 'なげなわ'],
  'opt.selectAll': ['Select all', 'Tout sélectionner', 'すべて選択'],
  'opt.deselect': ['Deselect', 'Désélectionner', '選択解除'],
  'opt.invert': ['Invert', 'Inverser', '反転'],
  'opt.fill': ['Fill', 'Remplir', '塗りつぶし'],
  'opt.tolerance': ['Tolerance', 'Tolérance', '許容値'],
  'opt.contiguous': ['Contiguous areas', 'Zones contiguës', '連続した領域'],
  'opt.sampleMerged': ['Sample the composite image', 'Échantillonner l’image composée', '合成画像からサンプリング'],
  'opt.size': ['Size', 'Taille', 'サイズ'],
  'opt.thickness': ['Thickness', 'Épaisseur', '太さ'],
  'opt.hardness': ['Hardness', 'Dureté', '硬さ'],
  'opt.opacity': ['Opacity', 'Opacité', '不透明度'],
  'opt.spacing': ['Spacing', 'Espacement', '間隔'],
  'opt.brushHint': [
    'Alt erases. [ and ] change the brush size.',
    'Alt active la gomme. [ et ] changent la taille du pinceau.',
    'Alt で消去。[ と ] でブラシサイズを変更。',
  ],
  'opt.source': ['Source', 'Source', 'ソース'],
  'opt.sourceSet': ['x {x} · y {y}', 'x {x} · y {y}', 'x {x} · y {y}'],
  'opt.sourceUnset': ['Alt+click on the image to set the stamp source.', 'Alt+clic sur l’image pour définir la source du tampon.', 'Alt+クリックでスタンプのソースを設定。'],
  'opt.corrector': ['Corrector', 'Correcteur', '補正'],
  'opt.correctorHint': [
    'Blends the copied color with the destination area.',
    'Harmonise la couleur copiée avec la zone d’accueil.',
    'コピーした色を貼り付け先になじませます。',
  ],
  'opt.patchEmpty': ['Draw the area to repair first.', 'Tracez d’abord la zone à réparer', 'まず修復する範囲を描きます。'],
  'opt.patchReady': ['<strong>Zone ready</strong> Drag it onto a clean area.', '<strong>Zone prête</strong> Glissez-la sur une zone propre.', '<strong>範囲の準備完了</strong> きれいな場所へドラッグします。'],
  'opt.patchHint': [
    'Draw the area to repair, then drag it onto a clean area.',
    'Tracez la zone à réparer, puis glissez-la sur une zone propre.',
    '修復する範囲を描き、きれいな場所へドラッグします。',
  ],
  'opt.clear': ['Clear', 'Effacer', 'クリア'],
  'opt.ratio': ['Ratio', 'Format', '比率'],
  'opt.square11': ['Square 1:1', 'Carré 1:1', '正方形 1:1'],
  'opt.patchArea': ['Area to repair', 'Zone à réparer', '修復する範囲'],
  'opt.patchReadyText': ['Drag it onto a clean area', 'Glissez la zone sur une zone propre', 'きれいな場所へドラッグします'],
  'opt.curveHint': [
    'Click to add a point, drag to move it, double-click to delete it. Shift keeps the smooth curve.',
    'Cliquez pour ajouter un point, glissez pour le déplacer, double-cliquez pour le supprimer. Maj conserve la courbe lissée.',
    'クリックで点を追加、ドラッグで移動、ダブルクリックで削除します。Shift で滑らかな曲線を維持します。',
  ],
  'opt.curveLinear': ['Reset', 'Réinitialiser', 'リセット'],
  'opt.curveContrast': ['S-curve', 'Courbe en S', 'S カーブ'],
  'opt.curveBright': ['Lift', 'Éclaircir', '持ち上げ'],
  'adjust.liveShort': ['Live preview', 'Aperçu direct', 'ライブプレビュー'],
  'stage.zoomFitShort': ['Fit', 'Ajuster', '合わせる'],
  'opt.free': ['Free', 'Libre', '自由'],
  'opt.applyCrop': ['Apply crop', 'Appliquer le recadrage', '切り抜きを適用'],
  'opt.shapeType': ['Shape', 'Forme', '図形'],
  'opt.triangle': ['Triangle', 'Triangle', '三角形'],
  'opt.star': ['Star', 'Étoile', '星'],
  'opt.line': ['Line', 'Ligne', '線'],
  'opt.fillColor': ['Fill', 'Remplissage', '塗り'],
  'opt.strokeColor': ['Stroke', 'Contour', '線'],
  'opt.strokeWidth': ['Width', 'Épaisseur', '線幅'],
  'opt.radius': ['Radius', 'Rayon', '角丸'],
  'opt.newLayer': ['New layer', 'Nouveau calque', '新規レイヤー'],
  'opt.noColor': ['None — outline only', 'Sans — contour seul', 'なし — 線のみ'],
  'opt.shapeEditing': ['Editing {name}', 'Modification de {name}', '{name} を編集中'],
  'opt.alignCanvas': ['Align on the canvas', 'Alignement sur le plan de travail', 'カンバスに整列'],
  'opt.alignObjects': ['Align between objects', 'Alignement entre les objets', 'オブジェクト間で整列'],
  'opt.alignHint': ['Select two layers or more to align them together.', 'Sélectionnez au moins deux calques pour les aligner entre eux.', '2 つ以上のレイヤーを選択してください。'],
  'opt.alignTop': ['Top', 'Haut', '上'],
  'opt.alignMiddle': ['Middle', 'Centrer', '中央'],
  'opt.alignBottom': ['Bottom', 'Bas', '下'],
  'opt.alignLeftShort': ['Align left', 'Aligner à gauche', '左揃え'],
  'opt.alignCenterShort': ['Align centre', 'Aligner au centre', '中央揃え'],
  'opt.alignRightShort': ['Align right', 'Aligner à droite', '右揃え'],
  'opt.alignTopShort': ['Align top', 'Aligner en haut', '上揃え'],
  'opt.alignMiddleShort': ['Align middle', 'Aligner au milieu', '中央（縦）'],
  'opt.alignBottomShort': ['Align bottom', 'Aligner en bas', '下揃え'],
  'opt.palette': ['Swatches', 'Palette', '見本'],
  'opt.paletteSave': ['Save the current colour', 'Enregistrer la couleur courante', '現在の色を保存'],
  'opt.paletteHint': ['Click a swatch to use it · Alt+click to delete it.', 'Cliquez une couleur pour l’utiliser · Alt+clic pour la supprimer.', 'クリックで使用 · Alt+クリックで削除。'],
  'opt.content': ['Content', 'Contenu', '内容'],
  'opt.font': ['Font', 'Police', 'フォント'],
  'opt.weight': ['Weight', 'Graisse', 'ウェイト'],
  'opt.align': ['Alignment', 'Alignement', '整列'],
  'opt.lineHeight': ['Line height', 'Interligne', '行間'],
  'opt.left': ['Left', 'Gauche', '左'],
  'opt.center': ['Center', 'Centrer', '中央'],
  'opt.right': ['Right', 'Droite', '右'],
  'opt.placeholder': ['Your text', 'Votre texte', 'テキスト'],
  'opt.noText': ['Click on the canvas to start a text block.', 'Cliquez sur la toile pour créer un bloc de texte.', 'キャンバスをクリックしてテキストを作成。'],
  'opt.gradientType': ['Type', 'Type', '種類'],
  'opt.linear': ['Linear', 'Linéaire', '線形'],
  'opt.radial': ['Radial', 'Radial', '円形'],
  'opt.colors': ['Colors', 'Couleurs', '色'],
  'opt.fgTransparent': ['Foreground → transparent', 'Couleur → transparent', '前景 → 透明'],
  'opt.fgBg': ['Foreground → background', 'Couleur → secondaire', '前景 → 背景'],
  'opt.bgTransparent': ['Background → transparent', 'Secondaire → transparent', '背景 → 透明'],
  'opt.gradientHint': [
    'Drag across the layer to set direction and length.',
    'Glissez sur le calque pour définir la direction et la longueur.',
    'レイヤー上をドラッグして方向と長さを決めます。',
  ],
  'opt.sampleStyle': ['Sampling', 'Prélèvement', 'サンプリング'],
  'opt.sampleAll': ['All layers', 'Tous les calques', 'すべてのレイヤー'],
  'opt.sampleActive': ['Active layer', 'Calque actif', '選択レイヤー'],
  'opt.zoomLevel': ['Zoom level', 'Niveau de zoom', 'ズーム倍率'],
  'opt.zoomHint': [
    'Ctrl/⌘ + wheel zooms around the pointer. Ctrl+0 fits the window.',
    'Ctrl/⌘ + molette zooms autour du curseur. Ctrl+0 ajuste à la fenêtre.',
    'Ctrl/⌘ + ホイールでカーソル位置を拡大。Ctrl+0 でウィンドウに合わせます。',
  ],
  'opt.diameter': ['Diameter', 'Diamètre', '直径'],
  'opt.intensity': ['Intensity', 'Intensité', '強さ'],
  'opt.softness': ['Softness', 'Douceur', 'ぼかし'],
  'opt.spotHint': [
    'Click to light, drag from the center to set the radius. A selection limits the light.',
    'Cliquez pour éclairer, glissez depuis le centre pour régler le rayon. La sélection limite la lumière.',
    'クリックで明るく、中心からドラッグで半径を調整。選択範囲がある場合はその範囲内だけ。',
  ],
  'opt.pathHint': [
    '{n} point(s) · click the first point to close, Shift snaps to 45°, double-click a point to smooth it.',
    '{n} point(s) · cliquez sur le premier point pour fermer, Maj aligne à 45°, double-clic sur un point pour le lisser.',
    '{n} 点 · 最初の点で閉じる、Shift で 45°、ダブルクリックで滑らかに。',
  ],
  'opt.pathActions': ['Path', 'Tracé', 'パス'],
  'opt.newPath': ['New path', 'Nouveau tracé', '新規パス'],
  'opt.closePath': ['Close path', 'Fermer le tracé', 'パスを閉じる'],
  'opt.finishPath': ['Finish', 'Terminer', '完了'],
  'opt.deleteAnchor': ['Delete last point', 'Supprimer le dernier point', '最後の点を削除'],

  // ── Colonne des calques ─────────────────────────────────────────────────
  'layers.document': ['Document', 'Document', 'ドキュメント'],
  'layers.title': ['Layers', 'Calques', 'レイヤー'],
  'layers.add': ['New layer', 'Nouveau calque', '新規レイヤー'],
  'layers.empty': ['No document open.', 'Aucun document ouvert.', 'ドキュメントが開かれていません。'],
  'layers.background': ['Background', 'Arrière-plan', '背景'],
  'layers.mask': ['Mask', 'Masque', 'マスク'],
  'layers.addMask': ['Add a layer mask', 'Ajouter un masque de fusion', 'レイヤーマスクを追加'],
  'layers.duplicate': ['Duplicate', 'Dupliquer', '複製'],
  'layers.delete': ['Delete layer', 'Supprimer le calque', 'レイヤーを削除'],
  'layers.up': ['Move layer up', 'Monter le calque', 'レイヤーを上へ'],
  'layers.down': ['Move layer down', 'Descendre le calque', 'レイヤーを下へ'],
  'layers.show': ['Show layer', 'Afficher le calque', 'レイヤーを表示'],
  'layers.hide': ['Hide layer', 'Masquer le calque', 'レイヤーを隠す'],
  'layers.maskPanel': ['Layer mask', 'Masque de fusion', 'レイヤーマスク'],
  'layers.maskActive': ['Active', 'Actif', '有効'],
  'layers.paintMask': ['Paint the mask', 'Peindre le masque', 'マスクを描く'],
  'layers.backToPixels': ['Back to pixels', 'Revenir aux pixels', 'ピクセルに戻る'],
  'layers.applyMask': ['Apply', 'Appliquer', '適用'],
  'layers.applyMaskLabel': ['Apply the mask', 'Appliquer le masque', 'マスクを適用'],
  'layers.removeMask': ['Remove', 'Supprimer', '削除'],
  'layers.maskHint': ['Paint light to reveal, dark to hide.', 'Peignez en clair pour révéler, en sombre pour masquer.', '明るい色で表示、暗い色で隠します。'],
  'layers.maskActiveHint': ['Click the thumbnail to paint the mask', 'Cliquer sur la vignette pour peindre le masque', 'サムネイルをクリックしてマスクを描く'],
  'layers.maskHintShort': ['Click to paint the mask · Shift+click to disable', 'Cliquer pour peindre le masque · Maj+clic pour désactiver', 'クリックでマスクを描く · Shift+クリックで無効化'],
  'layers.maskEditingHint': ['You are painting the mask — click to go back to pixels', 'Vous peignez le masque — cliquer pour revenir aux pixels', 'マスクを描画中 — クリックでピクセルに戻る'],
  'layers.maskOffHint': ['Mask disabled — click to re-enable', 'Masque désactivé — cliquer pour le réactiver', 'マスク無効 — クリックで再有効化'],
  'layers.pixelsHint': ['Back to the layer pixels', 'Revenir aux pixels du calque', 'レイヤーのピクセルに戻る'],
  'layers.pixelsActive': ['The layer pixels are being edited', 'Les pixels du calque sont en cours d’édition', 'レイヤーのピクセルを編集中'],
  'layers.lock': ['Lock the layer', 'Verrouiller le calque', 'レイヤーをロック'],
  'layers.unlock': ['Unlock the layer', 'Déverrouiller le calque', 'レイヤーのロックを解除'],
  'layers.properties': ['Properties', 'Propriétés', 'プロパティ'],
  'layers.name': ['Layer name', 'Nom du calque', 'レイヤー名'],
  'layers.placeholder': ['Layer', 'Calque', 'レイヤー'],
  'layers.opacity': ['Opacity', 'Opacité', '不透明度'],
  'layers.blend': ['Blend mode', 'Mode de fusion', '描画モード'],
  'layers.info': ['Information', 'Informations', '情報'],
  'layers.size': ['Size', 'Taille', 'サイズ'],
  'layers.resolution': ['Resolution', 'Résolution', '解像度'],
  'layers.count': ['Layers', 'Calques', 'レイヤー数'],
  'layers.profile': ['RGB 8-bit · sRGB', 'RVB 8 bits · sRGB', 'RGB 8bit · sRGB'],

  // ── Barre d'état ────────────────────────────────────────────────────────
  'status.ready': ['Ready', 'Prêt', '準備完了'],
  'status.noLayer': ['No layer', 'Aucun calque', 'レイヤーなし'],
  'status.layer': ['Layer: {name}', 'Calque : {name}', 'レイヤー: {name}'],
  'status.noSelection': ['No selection', 'Aucune sélection', '選択範囲なし'],
  'status.selection': [
    'Selection · {w} × {h} px',
    'Sélection · {w} × {h} px',
    '選択範囲 · {w} × {h} px',
  ],
  'status.selectionPoints': [
    'Selection · {w} × {h} px · {n} pts',
    'Sélection · {w} × {h} px · {n} pts',
    '選択範囲 · {w} × {h} px · {n} 点',
  ],
  'status.feather': [
    'Selection · {w} × {h} px · feather {f} px',
    'Sélection · {w} × {h} px · contour {f} px',
    '選択範囲 · {w} × {h} px · ぼかし {f} px',
  ],
  'status.featherPoints': [
    'Selection · {w} × {h} px · {n} pts · feather {f} px',
    'Sélection · {w} × {h} px · {n} pts · contour {f} px',
    '選択範囲 · {w} × {h} px · {n} 点 · ぼかし {f} px',
  ],
  'status.auto': ['Auto', 'Auto', '自動'],
  'status.autoOff': ['Auto off', 'Auto off', '自動オフ'],
  'status.saving': ['Saving…', 'Enregistrement…', '保存中…'],
  'status.unavailable': ['Auto unavailable', 'Auto indisponible', '自動保存なし'],
  'status.saved': ['Saved {time}', 'Enregistré {time}', '保存 {time}'],
  'status.autosaveTitle': ['Automatic save', 'Sauvegarde automatique', '自動保存'],
  'status.autosaveOn': ['Session saved in the browser', 'Session enregistrée dans le navigateur', 'セッションはブラウザに保存されています'],
  'status.autosaveOff': ['Automatic save disabled (Preferences)', 'Sauvegarde automatique désactivée (Préférences)', '自動保存は無効です（環境設定）'],

  // ── Menu contextuel ─────────────────────────────────────────────────────
  'menu.label': ['Selection actions', 'Actions de sélection', '選択範囲の操作'],
  'menu.noSelection': ['No selection', 'Aucune sélection', '選択範囲なし'],
  'menu.fill': ['Fill the selection', 'Remplir la sélection', '選択範囲を塗りつぶす'],
  'menu.clear': ['Clear content', 'Effacer le contenu', '内容を消去'],
  'menu.invert': ['Invert selection', 'Inverser la sélection', '選択範囲を反転'],
  'menu.deselect': ['Deselect', 'Désélectionner', '選択解除'],
  'menu.selectAll': ['Select all', 'Tout sélectionner', 'すべて選択'],
  'menu.copyLayer': ['Layer via copy', 'Calque via copie', 'コピーしてレイヤー'],
  'menu.adjustTonality': ['Tonality…', 'Tonalité…', 'トーン…'],
  'menu.adjustContrast': ['Brightness / Contrast…', 'Luminosité / Contraste…', '明るさ・コントラスト…'],
  'menu.adjustColor': ['Hue / Saturation…', 'Teinte / Saturation…', '色相・彩度…'],
  'menu.adjustLevels': ['Levels…', 'Niveaux…', 'レベル補正…'],
  'menu.adjustCurves': ['Curves…', 'Courbes…', 'トーンカーブ…'],
  'menu.imageSize': ['Image size…', 'Taille de l’image…', '画像解像度…'],
  'menu.canvasSize': ['Canvas size…', 'Taille de la zone de travail…', 'カンバスサイズ…'],
  'menu.zoomFit': ['Fit to window', 'Ajuster à la fenêtre', 'ウィンドウに合わせる'],

  // ── Menu contextuel des calques ─────────────────────────────────────────
  'menu.layerLabel': ['Layer actions', 'Actions de calque', 'レイヤーの操作'],
  'menu.layerCount': ['{n} layers selected', '{n} calques sélectionnés', '{n} 個のレイヤーを選択中'],
  'menu.renameLayer': ['Rename the layer', 'Renommer le calque', 'レイヤー名を変更'],
  'menu.duplicateLayer': ['Duplicate the layer', 'Dupliquer le calque', 'レイヤーを複製'],
  'menu.deleteLayer': ['Delete the layer', 'Supprimer le calque', 'レイヤーを削除'],
  'menu.hideLayer': ['Hide the layer', 'Masquer le calque', 'レイヤーを非表示'],
  'menu.showLayer': ['Show the layer', 'Afficher le calque', 'レイヤーを表示'],
  'menu.addMask': ['Add a layer mask', 'Ajouter un masque de fusion', 'レイヤーマスクを追加'],
  'menu.maskFromSelection': ['Mask from the selection', 'Masque depuis la sélection', '選択範囲からマスク'],
  'menu.applyMask': ['Apply the mask', 'Appliquer le masque', 'マスクを適用'],
  'menu.invertMask': ['Invert the mask', 'Inverser le masque', 'マスクを反転'],
  'menu.duplicateMask': ['Mask onto a new layer', 'Masque sur un nouveau calque', 'マスクを新規レイヤーへ'],
  'menu.deleteMask': ['Delete the mask', 'Supprimer le masque', 'マスクを削除'],
  'menu.enableMask': ['Enable the mask', 'Activer le masque', 'マスクを有効化'],
  'menu.disableMask': ['Disable the mask', 'Désactiver le masque', 'マスクを無効化'],
  'menu.mergeDown': ['Merge down', 'Fusionner vers le bas', '下のレイヤーと結合'],
  'menu.mergeVisible': ['Merge visible layers', 'Fusionner les calques visibles', '表示レイヤーを結合'],
  'menu.flattenImage': ['Flatten the image', 'Aplatir l’image', '画像を統合'],
  'menu.rasterizeLayer': ['Rasterize the layer', 'Rasteriser le calque', 'レイヤーをラスタライズ'],
  'menu.lockLayer': ['Lock the layer', 'Verrouiller le calque', 'レイヤーをロック'],
  'menu.unlockLayer': ['Unlock the layer', 'Déverrouiller le calque', 'レイヤーのロックを解除'],
  'menu.selectAllLayers': ['Select all layers', 'Sélectionner tous les calques', 'すべてのレイヤーを選択'],
  'menu.clearLayerSelection': ['Keep only this layer', 'Ne garder que ce calque', 'このレイヤーだけを選択'],

  // ── Raccourcis affichés dans les menus ──────────────────────────────────
  'key.alt-backspace': ['Alt+Backspace', 'Alt+Retour arrière', 'Alt+Backspace'],
  'key.delete': ['Delete', 'Suppr', 'Delete'],
  'key.esc': ['Esc', 'Échap', 'Esc'],
  'key.ctrl-a': ['Ctrl+A', 'Ctrl+A', 'Ctrl+A'],
  'key.ctrl-j': ['Ctrl+J', 'Ctrl+J', 'Ctrl+J'],
  'key.ctrl-e': ['Ctrl+E', 'Ctrl+E', 'Ctrl+E'],
  'key.ctrl-alt-a': ['Ctrl+Alt+A', 'Ctrl+Alt+A', 'Ctrl+Alt+A'],
  'key.f2': ['F2', 'F2', 'F2'],

  // ── Nouveau document ────────────────────────────────────────────────────
  'new.kicker': ['NEW DOCUMENT', 'NOUVEAU DOCUMENT', '新規ドキュメント'],
  'new.title': ['New document', 'Nouveau document', '新規ドキュメント'],
  'new.untitled': ['Untitled', 'Sans titre', '名称未設定'],
  'new.subtitle': [
    'Pick a size in pixels, or open an image from your computer.',
    'Choisissez un format en pixels, ou ouvrez une image depuis l’ordinateur.',
    'ピクセルサイズを選ぶか、パソコンから画像を開きます。',
  ],
  'new.custom': ['Custom format', 'Format personnalisé', 'カスタムサイズ'],
  'new.presets': ['Presets', 'Préréglages', 'プリセット'],
  'new.width': ['Width', 'Largeur', '幅'],
  'new.height': ['Height', 'Hauteur', '高さ'],
  'new.resolution': ['Resolution', 'Résolution', '解像度'],
  'new.keepRatio': ['Keep proportions', 'Conserver les proportions', '縦横比を固定'],
  'new.background': ['Background', 'Fond', '背景'],
  'new.white': ['White', 'Blanc', '白'],
  'new.black': ['Black', 'Noir', '黒'],
  'new.transparent': ['Transparent', 'Transparent', '透明'],
  'new.openComputer': ['Open from computer', 'Ouvrir depuis l’ordinateur', 'パソコンから開く'],
  'new.create': ['Create', 'Créer', '作成'],
  'new.presetNote': [
    'Everything is computed locally: no upload, no account.',
    'Tout est calculé en local : aucun envoi, aucun compte.',
    'すべてローカルで処理されます。アップロードもアカウントも不要。',
  ],
  'new.note': [
    'You can drop images straight from your desktop onto the canvas.',
    'Vous pouvez déposer des images depuis le bureau directement sur la toile.',
    'デスクトップから画像をキャンバスにドロップできます。',
  ],
  'preset.screen': ['HD screen', 'Écran HD', 'HD スクリーン'],
  'preset.photo': ['Photo 6 Mpx', 'Photo 6 Mpx', '写真 6 Mpx'],
  'preset.a4': ['A4 300 dpi', 'A4 300 ppp', 'A4 300 dpi'],
  'preset.square': ['Square', 'Carré', '正方形'],
  'preset.uhd': ['Ultra HD', 'Ultra HD', 'Ultra HD'],
  'preset.portrait': ['Portrait', 'Portrait', 'ポートレート'],

  // ── Taille image / toile ────────────────────────────────────────────────
  'resize.imageKicker': ['IMAGE SIZE', 'TAILLE DE L’IMAGE', '画像サイズ'],
  'resize.imageTitle': ['Image size', 'Taille de l’image', '画像サイズ'],
  'resize.imageSubtitle': [
    'Resamples the pixels of every layer.',
    'Rééchantillonne les pixels de tous les calques.',
    'すべてのレイヤーのピクセルを再サンプリングします。',
  ],
  'resize.canvasKicker': ['CANVAS SIZE', 'TAILLE DE LA ZONE DE TRAVAIL', 'キャンバスサイズ'],
  'resize.canvasTitle': ['Canvas size', 'Taille de la zone de travail', 'キャンバスサイズ'],
  'resize.canvasSubtitle': [
    'Extends or crops the canvas without changing the pixel scale.',
    'Étend ou rogne la zone de travail sans changer l’échelle des pixels.',
    'ピクセル倍率を変えずにキャンバスを拡張・切り抜きします。',
  ],
  'resize.anchor': ['Anchor', 'Point d’ancrage', '基準位置'],
  'resize.anchorHint': [
    'Existing layers keep their size; pick the anchor point.',
    'Les calques existants conservent leur taille ; choisissez le point d’ancrage.',
    '既存のレイヤーはサイズを保ちます。基準位置を選んでください。',
  ],
  'resize.quality': [
    'High-quality resampling handled by the browser.',
    'Rééchantillonnage haute qualité via le navigateur.',
    'ブラウザによる高品質な再サンプリング。',
  ],
  'resize.current': ['Current', 'Actuel', '現在'],

  // ── Export ──────────────────────────────────────────────────────────────
  'export.kicker': ['OUTPUT', 'SORTIE', '出力'],
  'export.title': ['Export the image', 'Exporter l’image', '画像を書き出す'],
  'export.subtitle': [
    'Flattens visible layers and saves the result.',
    'Aplatit les calques visibles et enregistre le résultat.',
    '表示中のレイヤーを統合して保存します。',
  ],
  'export.format': ['Format', 'Format', '形式'],
  'export.pngHint': ['Lossless · transparency', 'Lossless · transparence', '可逆圧縮 · 透明'],
  'export.jpegHint': ['Photo · white background', 'Photo · fond blanc', '写真 · 白背景'],
  'export.webpHint': ['Web · transparency', 'Web · transparence', 'Web · 透明'],
  'export.avifHint': ['Modern web · smallest file', 'Web moderne · fichier le plus léger', 'モダンWeb · 最小サイズ'],
  'export.bmpHint': ['Windows · 24-bit', 'Windows · 24 bits', 'Windows · 24ビット'],
  'export.avifUnavailable': [
    'This browser cannot write AVIF — export as WebP instead.',
    'Ce navigateur ne sait pas écrire l’AVIF — exportez en WebP.',
    'このブラウザはAVIFを書き出せません — WebPをご利用ください。',
  ],
  'export.spsHint': ['SuperPhoto project · layers kept', 'Projet SuperPhoto · calques conservés', 'SuperPhoto プロジェクト · レイヤー保持'],
  'export.tiffHint': ['Print · uncompressed', 'Imprimerie · non compressé', '印刷 · 非圧縮'],
  'export.psdHint': ['Photoshop · layers kept', 'Photoshop · calques conservés', 'Photoshop · レイヤー保持'],
  'export.epsHint': ['PostScript · flattened', 'PostScript · aplati', 'PostScript · 統合'],
  'export.filename': ['File name', 'Nom du fichier', 'ファイル名'],
  'export.quality': ['Quality', 'Qualité', '品質'],
  'export.dimensions': ['Dimensions', 'Dimensions', 'サイズ'],
  'export.profile': ['Profile', 'Profil', 'プロファイル'],
  'export.hintPng': [
    'PNG keeps transparency and pixel sharpness.',
    'PNG conserve la transparence et la netteté des pixels.',
    'PNG は透明度とピクセルの鮮明さを保ちます。',
  ],
  'export.hintFlat': [
    'Transparent areas will be flattened onto white.',
    'Le fond transparent sera aplati sur du blanc.',
    '透明部分は白で合成されます。',
  ],
  'export.hintSps': [
    'The .sps file keeps every layer, mask and text editable. Reopen it in SuperPhoto.',
    'Le fichier .sps conserve tous les calques, masques et textes éditables. Rouvrez-le dans SuperPhoto.',
    '.sps はレイヤー・マスク・テキストを保持します。SuperPhoto で再度開けます。',
  ],
  'export.hintPsd': [
    'A layered PSD, readable in Photoshop, Affinity and GIMP. Masks and blend modes are kept.',
    'Un PSD multicouche, lisible dans Photoshop, Affinity et GIMP. Masques et modes de fusion conservés.',
    'レイヤー付き PSD。Photoshop・Affinity・GIMP で開けます。マスクと合成モードを保持します。',
  ],
  'export.hintTiff': [
    'Uncompressed TIFF with the document resolution — the print-shop standard.',
    'TIFF non compressé avec la résolution du document — le standard imprimeur.',
    '非圧縮 TIFF。ドキュメントの解像度を保持します。',
  ],
  'export.hintEps': [
    'Encapsulated PostScript for layout software. Layers are flattened onto white.',
    'PostScript encapsulé pour la PAO. Les calques sont aplatis sur du blanc.',
    '入稿用 EPS。レイヤーは白背景に統合されます。',
  ],
  'export.run': ['Export', 'Exporter', '書き出し'],
  'export.busy': ['Exporting…', 'Export…', '書き出し中…'],
  'export.done': ['Image exported · {name}', 'Image exportée · {name}', '書き出し完了 · {name}'],
  'export.projectDone': ['Project saved · {name}', 'Projet enregistré · {name}', 'プロジェクトを保存 · {name}'],
  'export.failed': ['Export failed: {error}', 'Export impossible : {error}', '書き出しに失敗: {error}'],
  'export.noDocument': ['Open a document before exporting.', 'Ouvrez un document avant d’exporter.', '書き出す前にドキュメントを開いてください。'],

  // ── Préférences ─────────────────────────────────────────────────────────
  'prefs.kicker': ['SUPERPHOTO', 'SUPERPHOTO', 'SUPERPHOTO'],
  'prefs.title': ['Preferences', 'Préférences', '環境設定'],
  'prefs.subtitle': [
    'Appearance, canvas, rendering and shortcuts. Settings are kept on this device.',
    'Apparence, toile, rendu et raccourcis. Les réglages sont conservés sur cet appareil.',
    '外観・キャンバス・描画・ショートカット。設定はこの端末に保存されます。',
  ],
  'prefs.tab.appearance': ['Appearance', 'Apparence', '外観'],
  'prefs.tab.canvas': ['Canvas', 'Toile', 'キャンバス'],
  'prefs.tab.shortcuts': ['Shortcuts', 'Raccourcis', 'ショートカット'],
  'prefs.tab.about': ['About', 'À propos', 'このアプリについて'],
  'prefs.language': ['Language', 'Langue', '言語'],
  'prefs.languageHint': [
    'Detected from your browser on first launch. Your choice is remembered.',
    'Détectée depuis le navigateur au premier lancement. Votre choix est mémorisé.',
    '初回はブラウザの言語を自動検出します。選択は記憶されます。',
  ],
  'prefs.theme': ['Theme', 'Thème', 'テーマ'],
  'prefs.themeHint': [
    'Light follows the SuperPrint palette; dark is the photo studio.',
    'Le clair reprend la palette de SuperPrint ; le sombre est celui du studio photo.',
    'ライトは SuperPrint の配色、ダークはフォトスタジオ調です。',
  ],
  'prefs.light': ['Light', 'Clair', 'ライト'],
  'prefs.dark': ['Dark', 'Sombre', 'ダーク'],
  'prefs.system': ['System', 'Système', 'システム'],
  'prefs.motion': ['Animations', 'Animations', 'アニメーション'],
  'prefs.motionHint': [
    'Reduced: no transition, no pulsing. The interface responds instantly.',
    'Réduites : aucune transition, aucune pulsation. L’interface répond instantanément.',
    '低減：トランジションも点滅もなし。即座に反応します。',
  ],
  'prefs.motionFull': ['Normal', 'Normales', '通常'],
  'prefs.motionReduced': ['Reduced', 'Réduites', '低減'],
  'prefs.checker': ['Transparency checker', 'Damier de transparence', '透明チェッカー'],
  'prefs.checkerHint': [
    'The backdrop behind transparent areas of the image.',
    'Le fond derrière les zones transparentes de l’image.',
    '画像の透明部分の背景です。',
  ],
  'prefs.auto': ['Automatic', 'Automatique', '自動'],
  'prefs.quality': ['Render quality', 'Qualité de rendu', '描画品質'],
  'prefs.qualityHint': [
    'Fast favours fluidity on very large images; precise refines resampling.',
    'Rapide privilégie la fluidité sur les très grandes images ; précise soigne le rééchantillonnage.',
    '高速は大きな画像での流暢さを優先、高精細は再サンプリングを丁寧に行います。',
  ],
  'prefs.fast': ['Fast', 'Rapide', '高速'],
  'prefs.balanced': ['Balanced', 'Équilibrée', '標準'],
  'prefs.precise': ['Precise', 'Précise', '高精細'],
  'prefs.display': ['Display', 'Affichage', '表示'],
  'prefs.coordinates': ['Cursor coordinates', 'Coordonnées du curseur', 'カーソル座標'],
  'prefs.coordinatesHint': ['Shows x / y in the status bar.', 'Affiche x / y dans la barre d’état.', 'ステータスバーに x / y を表示します。'],
  'prefs.smoothZoom': ['Smooth zoom', 'Lisser le zoom', 'ズームを滑らかに'],
  'prefs.smoothZoomHint': [
    'Off: pixels stay crisp beyond 400 %.',
    'Désactivé : les pixels restent nets au-delà de 400 %.',
    'オフ：400 % を超えてもピクセルは鮮明なまま。',
  ],
  'prefs.autoFit': ['Fit on resize', 'Ajuster au redimensionnement', 'リサイズ時に合わせる'],
  'prefs.autoFitHint': [
    'Refits the view when the window changes size.',
    'Recadre la vue quand la fenêtre change de taille.',
    'ウィンドウサイズが変わると表示を合わせ直します。',
  ],
  'prefs.session': ['Session', 'Session', 'セッション'],
  'prefs.autosave': ['Automatic save', 'Sauvegarde automatique', '自動保存'],
  'prefs.autosaveHint': [
    'Stores every open document in the browser after each change.',
    'Enregistre chaque document ouvert dans le navigateur après chaque modification.',
    '変更のたびに開いているドキュメントをブラウザに保存します。',
  ],
  'prefs.forget': ['Forget the saved session', 'Oublier la session enregistrée', '保存されたセッションを削除'],
  'prefs.none': ['No session saved yet.', 'Aucune session enregistrée pour l’instant.', 'まだ保存されたセッションはありません。'],
  'prefs.lastSave': ['Last save: {time}', 'Dernière sauvegarde : {time}', '最終保存: {time}'],
  'prefs.shortcutsHint': [
    'Every keyboard combination, grouped by tool, file and view.',
    'Toutes les combinaisons clavier, classées par outil, fichier et vue.',
    'すべてのキーボード操作をツール・ファイル・表示別にまとめました。',
  ],
  'prefs.saved': ['Preferences saved', 'Préférences enregistrées', '環境設定を保存しました'],
  'prefs.resetDone': ['Preferences reset', 'Préférences réinitialisées', '環境設定をリセットしました'],
  'prefs.aboutTech': ['Technologies', 'Technologies', '技術'],
  'prefs.aboutCredits': ['Credits', 'Crédits', 'クレジット'],
  'prefs.group.tools': ['Tools', 'Outils', 'ツール'],
  'prefs.group.file': ['File', 'Fichier', 'ファイル'],
  'prefs.group.layers': ['Layers & selection', 'Calques et sélection', 'レイヤーと選択'],
  'prefs.group.pen': ['Pen', 'Plume', 'ペン'],
  'prefs.group.view': ['View', 'Vue', '表示'],
  'prefs.tab.plugins': ['Plug-ins', 'Plug-ins', 'プラグイン'],
  'prefs.pluginsHint': [
    'Plug-ins extend the tools without touching the core. An enabled plug-in adds its icon to the top bar, next to Export. Everything runs locally.',
    'Les plug-ins étendent les outils sans toucher au cœur. Un plug-in actif ajoute son icône dans la barre du haut, à côté d’Exporter. Tout est calculé en local.',
    'プラグインはコアを変更せずにツールを拡張します。有効なプラグインは書き出しの隣にアイコンを追加します。すべてローカルで動作します。',
  ],
  'prefs.pluginsDev': ['Adding a plug-in', 'Ajouter un plug-in', 'プラグインの追加'],
  'prefs.pluginsDevHint': [
    'A plug-in is one entry in src/lib/plugins.ts: a list of effects, each a pure pixel function with its own sliders. No network, no build step.',
    'Un plug-in est une entrée dans src/lib/plugins.ts : une liste d’effets, chacun une fonction pure sur les pixels avec ses propres réglages. Aucun réseau, aucune compilation supplémentaire.',
    'プラグインは src/lib/plugins.ts の 1 エントリです。各エフェクトはスライダーを持つ純粋なピクセル関数です。ネットワークも追加ビルドも不要です。',
  ],
  'topbar.plugins': ['Plug-ins (Ctrl+Alt+E)', 'Plug-ins (Ctrl+Alt+E)', 'プラグイン (Ctrl+Alt+E)'],

  // ── Enregistrement d'un paquet `.spp` ───────────────────────────────────
  'save.title': ['Save a package', 'Enregistrer un paquet', 'パッケージを保存'],
  'save.subtitle': [
    'One .spp file: every layer, mask, text and colour mode. Reopen it with Open.',
    'Un seul fichier .spp : tous les calques, masques, textes et modes. Se rouvre par Ouvrir.',
    '.spp 1 ファイルに、レイヤー・マスク・テキスト・カラーモードをすべて保存します。',
  ],
  'save.scope': ['What to save', 'Quoi enregistrer', '保存する範囲'],
  'save.currentTab': ['Current tab', 'Onglet en cours', '現在のタブ'],
  'save.allTabs': ['All tabs', 'Tous les onglets', 'すべてのタブ'],
  'save.tabCount': ['{n} tab(s) open', '{n} onglet(s) ouvert(s)', '{n} 個のタブ'],
  'save.none': ['No document', 'Aucun document', 'ドキュメントなし'],
  'save.filename': ['File name', 'Nom du fichier', 'ファイル名'],
  'save.documents': ['Documents', 'Documents', 'ドキュメント'],
  'save.layers': ['Layers', 'Calques', 'レイヤー'],
  'save.masks': ['Masks', 'Masques', 'マスク'],
  'save.pixels': ['Pixels', 'Pixels', 'ピクセル'],
  'save.modes': ['Colour modes', 'Modes chromatiques', 'カラーモード'],
  'save.note': [
    'The package is a plain ZIP: rename it to .zip to inspect the JSON and the PNG layers.',
    'Le paquet est un ZIP ordinaire : renommez-le en .zip pour voir le JSON et les PNG.',
    'パッケージは通常の ZIP です。.zip に改名すると JSON と PNG を確認できます。',
  ],
  'save.run': ['Save', 'Enregistrer', '保存'],
  'save.busy': ['Saving…', 'Enregistrement…', '保存中…'],
  'save.done': ['{name} saved · {n} document(s)', '{name} enregistré · {n} document(s)', '{name} を保存 · {n} ドキュメント'],
  'save.doneShort': ['Saved {name}', 'Enregistré : {name}', '{name} を保存しました'],
  'save.failed': ['Save failed: {error}', 'Échec de l’enregistrement : {error}', '保存に失敗: {error}'],
  'save.noDocument': ['Open a document before saving.', 'Ouvrez un document avant d’enregistrer.', '保存する前にドキュメントを開いてください。'],

  // ── Paquet `.spp` : ouverture et erreurs ────────────────────────────────
  'pkg.opened': ['{name} opened · {n} document(s)', '{name} ouvert · {n} document(s)', '{name} を開きました · {n} ドキュメント'],
  'pkg.notPackage': [
    'This file is not a SuperPhoto package.',
    'Ce fichier n’est pas un paquet SuperPhoto.',
    'このファイルは SuperPhoto パッケージではありません。',
  ],
  'pkg.tooRecent': [
    'This package was saved by a newer version of SuperPhoto.',
    'Ce paquet a été enregistré par une version plus récente de SuperPhoto.',
    'このパッケージは新しいバージョンの SuperPhoto で保存されています。',
  ],
  'pkg.empty': ['This package contains no readable document.', 'Ce paquet ne contient aucun document lisible.', 'このパッケージには読めるドキュメントがありません。'],
  'pkg.noDocument': ['Nothing to save.', 'Rien à enregistrer.', '保存するものがありません。'],

  // ── Où ouvrir un média ──────────────────────────────────────────────────
  'place.title': ['Where should it open?', 'Où ouvrir ce média ?', 'どこに開きますか？'],
  'place.subtitle': ['“{name}” can be added to the current workspace or open in its own tab.', '« {name} » peut être ajouté au plan de travail ou s’ouvrir dans son propre onglet.', '「{name}」は現在のワークスペースに追加するか、新しいタブで開けます。'],
  'place.subtitleMultiple': ['{n} files — each one opens in its own tab.', '{n} fichiers — chacun s’ouvre dans son propre onglet.', '{n} 個のファイル — それぞれ別のタブで開きます。'],
  'place.current': ['In the current workspace', 'Dans le plan de travail', '現在のワークスペース'],
  'place.currentHint': ['Adds it as a new layer, without replacing anything.', 'L’ajoute sur un nouveau calque, sans rien remplacer.', '新しいレイヤーとして追加します。'],
  'place.tab': ['In a new tab', 'Dans un nouvel onglet', '新しいタブ'],
  'place.tabHint': ['Keeps everything that is already open.', 'Garde tout ce qui est déjà ouvert.', '開いているものをそのまま残します。'],
  'place.note': [
    'Both choices keep the full resolution. Adding to the current workspace creates new layers on top of the ones already there.',
    'Les deux choix gardent la pleine résolution. L’ajout au plan de travail crée de nouveaux calques au-dessus de ceux déjà présents.',
    'どちらもフル解像度を保ちます。現在のワークスペースへの追加は既存のレイヤーの上に新しいレイヤーを作ります。',
  ],

  // ── Modes chromatiques ──────────────────────────────────────────────────
  'mode.title': ['Colour mode', 'Mode chromatique', 'カラーモード'],
  'mode.rgb': ['RGB', 'RVB', 'RGB'],
  'mode.cmyk': ['CMYK', 'CMJN', 'CMYK'],
  'mode.gray': ['B&W', 'N&B', 'モノクロ'],
  'mode.rgbHint': ['RGB — screen output', 'RVB — sortie écran', 'RGB — 画面出力'],
  'mode.cmykHint': ['CMYK — print simulation', 'CMJN — simulation d’impression', 'CMYK — 印刷シミュレーション'],
  'mode.grayHint': ['Grayscale — one channel', 'Niveaux de gris — un seul canal', 'グレースケール — 1 チャンネル'],
  'mode.note': [
    'Switching away from RGB previews the print or grayscale rendering. Switching back to RGB restores the colours.',
    'Passer en CMJN ou en N&B prévisualise le rendu imprimé ou en gris. Un retour en RVB restitue les couleurs.',
    'CMYK やグレースケールは印刷・グレー表現のプレビューです。RGB に戻すと色が復元されます。',
  ],
  'mode.noteActive': [
    'This document is {mode}. Colours return intact when you switch back to RGB, unless you paint in between.',
    'Ce document est en {mode}. Les couleurs reviennent intactes au retour en RVB, sauf si vous peignez entre-temps.',
    'このドキュメントは {mode} です。途中で描画しない限り、RGB に戻すと色は元通りになります。',
  ],
  'mode.noDocument': ['Open a document first.', 'Ouvrez d’abord un document.', '先にドキュメントを開いてください。'],
  'mode.convertLabel': ['Convert {from} → {to}', 'Convertir {from} → {to}', '{from} → {to} に変換'],
  'mode.converted': ['Converted to {mode}', 'Converti en {mode}', '{mode} に変換しました'],
  'mode.samePixels': ['Colour mode changed', 'Mode chromatique modifié', 'カラーモードを変更しました'],
  'mode.profile.rgb': ['RGB 8-bit · sRGB', 'RVB 8 bits · sRGB', 'RGB 8bit · sRGB'],
  'mode.profile.cmyk': ['CMYK simulation · 8-bit', 'Simulation CMJN · 8 bits', 'CMYK シミュレーション · 8bit'],
  'mode.profile.gray': ['Grayscale · 8-bit', 'Niveaux de gris · 8 bits', 'グレースケール · 8bit'],


  // ── Greffons ────────────────────────────────────────────────────────────
  'plugin.subtitle': [
    'Glitch and film damage, rendered on your machine. The preview is live on the canvas.',
    'Glitch et pellicule abîmée, calculés sur votre machine. L’aperçu est direct sur la toile.',
    'グリッチとフィルムの損傷をローカルで処理します。プレビューはキャンバスに即時表示されます。',
  ],
  'plugin.apply': ['Apply the effect', 'Appliquer l’effet', 'エフェクトを適用'],
  'plugin.applyShort': ['Apply', 'Appliquer', '適用'],
  'plugin.effectsCount': ['effects', 'effets', 'エフェクト'],
  'plugin.target': ['Active layer: {name}', 'Calque actif : {name}', 'アクティブレイヤー：{name}'],
  'plugin.emptyLayer': [
    'Empty layer — pick the image layer',
    'Calque vide — choisissez le calque de l’image',
    '空のレイヤー — 画像レイヤーを選んでください',
  ],
  'plugin.history': ['Effect · {name}', 'Effet · {name}', 'エフェクト · {name}'],
  'plugin.applied': ['{name} applied', '{name} appliqué', '{name} を適用しました'],
  'plugin.enabled': ['{name} enabled', '{name} activé', '{name} を有効化'],
  'plugin.disabled': ['{name} disabled', '{name} désactivé', '{name} を無効化'],
  'plugin.none': ['No plug-in is enabled.', 'Aucun plug-in actif.', '有効なプラグインがありません。'],
  'plugin.effects2026.desc': [
    'Glitch, scanlines, scratches, dust, grain and VHS — a 2026 film lab in one panel.',
    'Glitch, lignes de balayage, rayures, poussière, grain et VHS — un laboratoire 2026 dans un panneau.',
    'グリッチ、走査線、傷、ほこり、粒子、VHS — 2026 年のラボを 1 つのパネルに。',
  ],
  'plugin.fx.glitchRgb': ['Chromatic glitch', 'Glitch chromatique', '色収差グリッチ'],
  'plugin.fx.glitchRgbHint': [
    'Splits the red and blue channels line by line, like a broken signal.',
    'Sépare les canaux rouge et bleu ligne par ligne, comme un signal cassé.',
    '赤と青のチャンネルを行ごとに分離します。壊れた信号のように。',
  ],
  'plugin.fx.glitchBlocks': ['Block shift', 'Blocs décalés', 'ブロックシフト'],
  'plugin.fx.glitchBlocksHint': [
    'Displaces horizontal bands: the classic datamosh smear.',
    'Décale des bandes horizontales : le smear datamosh classique.',
    '水平方向の帯をずらします。定番のデータモッシュ。',
  ],
  'plugin.fx.scanlines': ['Scanlines', 'Lignes de balayage', '走査線'],
  'plugin.fx.scanlinesHint': [
    'CRT lines and a soft vignette.',
    'Lignes cathodiques et vignettage doux.',
    'ブラウン管の走査線と柔らかいビネット。',
  ],
  'plugin.fx.scratches': ['Scratches', 'Rayures', '傷'],
  'plugin.fx.scratchesHint': [
    'Vertical scratches from an old print, bright or dark.',
    'Rayures verticales d’une copie ancienne, claires ou sombres.',
    '古いプリントの縦傷。明るいものと暗いもの。',
  ],
  'plugin.fx.dust': ['Dust & specks', 'Poussière et taches', 'ほこりと斑点'],
  'plugin.fx.dustHint': [
    'Random specks and pinholes, scattered across the frame.',
    'Taches et piqûres aléatoires, réparties sur l’image.',
    'フレーム全体に散らばる斑点とピンホール。',
  ],
  'plugin.fx.grain': ['Film grain', 'Grain argentique', 'フィルム粒子'],
  'plugin.fx.grainHint': [
    'Grain sized in pixels, monochrome or chromatic.',
    'Grain calibré en pixels, monochrome ou chromatique.',
    'ピクセル単位の粒子。モノクロまたはカラー。',
  ],
  'plugin.fx.vhs': ['VHS tape', 'Cassette VHS', 'VHS テープ'],
  'plugin.fx.vhsHint': [
    'Chroma bleed, sparkle and a tracking band that never sits still.',
    'Bave de chroma, scintillement et une bande de tracking instable.',
    '色のにじみ、ちらつき、揺れるトラッキング帯。',
  ],
  'plugin.param.amount': ['Amount', 'Amplitude', '量'],
  'plugin.param.jitter': ['Jitter', 'Gigue', 'ジッター'],
  'plugin.param.tear': ['Tears', 'Déchirures', '裂け'],
  'plugin.param.seed': ['Seed', 'Graine', 'シード'],
  'plugin.param.density': ['Blocks', 'Blocs', 'ブロック数'],
  'plugin.param.shift': ['Shift', 'Décalage', 'シフト'],
  'plugin.param.strength': ['Strength', 'Intensité', '強さ'],
  'plugin.param.period': ['Line spacing', 'Espacement', '線の間隔'],
  'plugin.param.vignette': ['Vignette', 'Vignettage', 'ビネット'],
  'plugin.param.count': ['Count', 'Nombre', '数'],
  'plugin.param.length': ['Length', 'Longueur', '長さ'],
  'plugin.param.brightness': ['Brightness', 'Luminosité', '明るさ'],
  'plugin.param.size': ['Size', 'Taille', 'サイズ'],
  'plugin.param.grainSize': ['Grain size', 'Taille du grain', '粒子サイズ'],
  'plugin.param.grainColor': ['Chromatic grain', 'Grain chromatique', 'カラー粒子'],
  'plugin.param.bleed': ['Chroma bleed', 'Bave de chroma', '色にじみ'],
  'plugin.param.noise': ['Noise', 'Bruit', 'ノイズ'],
  'plugin.param.tracking': ['Tracking', 'Tracking', 'トラッキング'],
  'about.interface': ['Interface', 'Interface', 'インターフェース'],
  'about.engine': ['Desktop engine', 'Moteur desktop', 'デスクトップエンジン'],
  'about.render': ['Rendering', 'Rendu', '描画'],
  'about.formats': ['Formats', 'Formats', '形式'],
  'about.platforms': ['Platforms', 'Plateformes', '対応 OS'],
  'about.design': ['Design', 'Conception', 'デザイン'],
  'about.studio': ['Studio', 'Studio', 'スタジオ'],
  'about.license': ['License', 'Licence', 'ライセンス'],

  // ── Dépôt / glisser-déposer ────────────────────────────────────────────
  'drop.title': ['Drop to open', 'Déposez pour ouvrir', 'ドロップして開く'],
  'drop.hint': [
    'PNG, JPEG, WebP, AVIF, GIF, TIFF, BMP, SVG, .sps — several files at once open in separate tabs.',
    'PNG, JPEG, WebP, AVIF, GIF, TIFF, BMP, SVG, .sps — plusieurs fichiers s’ouvrent dans des onglets séparés.',
    'PNG / JPEG / WebP / AVIF / GIF / TIFF / BMP / SVG / .sps — 複数ファイルは別タブで開きます。',
  ],
  'drop.videoHint': [
    'Video files open on their first frame.',
    'Les vidéos s’ouvrent sur leur première image.',
    '動画は最初のフレームで開きます。',
  ],
  'drop.unsupported': ['Unsupported file: {name}', 'Fichier non pris en charge : {name}', '未対応のファイル: {name}'],

  // ── Messages ────────────────────────────────────────────────────────────
  'msg.newDocument': ['New document {w} × {h} px', 'Nouveau document {w} × {h} px', '新規ドキュメント {w} × {h} px'],
  'msg.opened': ['{name} · {w} × {h} px', '{name} · {w} × {h} px', '{name} · {w} × {h} px'],
  'msg.projectOpened': [
    '{name} · {n} layer(s)',
    '{name} · {n} calque(s)',
    '{name} · {n} レイヤー',
  ],
  'msg.psdOpened': [
    'Photoshop file imported · {name} · {n} layer(s)',
    'Fichier Photoshop importé · {name} · {n} calque(s)',
    'Photoshop ファイルを読み込み · {name} · {n} レイヤー',
  ],
  'msg.psdEmpty': [
    'This PSD has no readable layers; open the flattened version instead.',
    'Ce PSD ne contient aucun calque lisible ; ouvrez la version aplatie à la place.',
    'この PSD には読み取り可能なレイヤーがありません。統合版を開いてください。',
  ],
  'msg.imageUnreadable': ['Unreadable image: {error}', 'Image illisible : {error}', '画像を読み込めません: {error}'],
  'msg.openFailed': ['Could not open: {error}', 'Ouverture impossible : {error}', '開けません: {error}'],
  'msg.undone': ['Undone: {label}', 'Annulé : {label}', '元に戻しました: {label}'],
  'msg.redone': ['Redone: {label}', 'Rétabli : {label}', 'やり直しました: {label}'],
  'msg.cropped': ['Cropped · {w} × {h} px', 'Recadré · {w} × {h} px', '切り抜き · {w} × {h} px'],
  'msg.filled': ['Fill · {color}', 'Remplir la sélection · {color}', '塗りつぶし · {color}'],
  'msg.maskFilled': ['Mask filled · {color}', 'Remplir le masque · {color}', 'マスクを塗りつぶし · {color}'],
  'msg.spot': ['Light spot · {size} px · {intensity} %', 'Point lumineux · {size} px · {intensity} %', 'スポットライト · {size} px · {intensity} %'],
  'msg.brushSize': ['Size {size} px', 'Taille {size} px', 'サイズ {size} px'],
  'msg.wand': ['Magic wand · {w} × {h} px', 'Baguette magique · {w} × {h} px', '自動選択 · {w} × {h} px'],
  'msg.shapeDrawn': ['{label} drawn', '{label} dessiné', '{label} を描画しました'],
  'msg.gradientApplied': ['Gradient applied', 'Dégradé appliqué', 'グラデーションを適用'],
  'msg.patchFixed': ['Area repaired', 'Zone réparée', '範囲を修復しました'],
  'msg.patchCleared': ['Area cleared', 'Zone annulée', '範囲をクリア'],
  'msg.stampSource': ['Stamp source · x {x} · y {y}', 'Source du tampon · x {x} · y {y}', 'スタンプのソース · x {x} · y {y}'],
  'msg.layerAdded': ['Layer added', 'Calque ajouté', 'レイヤーを追加'],
  'msg.layerDuplicated': ['Layer duplicated', 'Calque dupliqué', 'レイヤーを複製'],
  'msg.layerDeleted': ['Layer deleted', 'Calque supprimé', 'レイヤーを削除'],
  'msg.lastLayer': ['The last layer cannot be deleted.', 'Impossible de supprimer le dernier calque.', '最後のレイヤーは削除できません。'],
  'msg.maskAdded': ['Mask added — paint dark to hide', 'Masque ajouté — peignez en sombre pour masquer', 'マスクを追加 — 暗い色で隠せます'],
  'msg.maskApplied': ['Mask applied to pixels', 'Masque appliqué aux pixels', 'マスクをピクセルに適用'],
  'msg.maskDeleted': ['Mask deleted', 'Masque supprimé', 'マスクを削除'],
  'msg.maskOff': ['Mask disabled — click to re-enable', 'Masque désactivé — cliquer pour le réactiver', 'マスクを無効化 — クリックで再開'],
  'msg.maskOn': ['Mask re-enabled', 'Masque réactivé', 'マスクを再有効化'],
  'msg.sessionRestored': ['Session restored · {time}', 'Session restaurée · {time}', 'セッションを復元 · {time}'],
  'msg.sessionCleared': ['Saved session cleared', 'Session enregistrée effacée', '保存セッションを削除しました'],
  'msg.textEdit': ['Text edit', 'Modification du texte', 'テキスト編集'],
  'msg.textAlign': ['Text alignment', 'Alignement du texte', 'テキスト揃え'],
  'msg.pathClosed': ['Path closed', 'Tracé fermé', 'パスを閉じました'],
  'msg.noPixels': ['No pixel to select here.', 'Aucun pixel à sélectionner à cet endroit.', 'ここには選択できるピクセルがありません。'],
  'msg.finishAdjustment': ['Apply or cancel the current adjustment.', 'Validez ou annulez le réglage en cours.', '現在の調整を適用するかキャンセルしてください。'],
  'msg.selectLayer': ['Select a layer.', 'Sélectionnez un calque.', 'レイヤーを選択してください。'],
  'msg.openFirst': ['Open a document first.', 'Ouvrez un document.', '先にドキュメントを開いてください。'],
  'msg.openBeforeAdjust': ['Open a document before using an adjustment.', 'Ouvrez un document avant d’utiliser un réglage.', '調整を使う前にドキュメントを開いてください。'],
  'msg.flattenFirst': ['Flatten or duplicate the layer before clearing it.', 'Aplatissez ou dupliquez le calque avant de le vider.', '消去する前にレイヤーを統合するか複製してください。'],
  'msg.flattenBeforeFill': ['Flatten or duplicate the layer before filling it.', 'Aplatissez ou dupliquez le calque avant de le remplir.', '塗りつぶす前にレイヤーを統合するか複製してください。'],
  'msg.selectionFirst': ['Draw a selection before filling it.', 'Tracez une sélection avant de la remplir.', '塗りつぶす前に選択範囲を作成してください。'],
  'msg.maskExit': ['Leave mask editing to place a light spot.', 'Quittez l’édition du masque pour poser un point lumineux.', 'マスク編集を終了してからスポットライトを置いてください。'],
  'msg.patchExitMask': ['Go back to layer pixels to use the patch tool.', 'Revenez aux pixels du calque pour utiliser la pièce.', '修復ツールを使うにはピクセルに戻ってください。'],
  'msg.stampFirst': ['Alt+click on the image to set the stamp source.', 'Alt+clic sur l’image pour définir la source du tampon.', 'Alt+クリックでスタンプのソースを設定してください。'],
  'msg.fullscreenDenied': ['Full screen was refused by the system.', 'Le plein écran est refusé par le système.', 'フルスクリーンがシステムに拒否されました。'],
  'msg.pathStyle': ['Path style', 'Style du tracé', 'パスのスタイル'],
  'msg.shapeStyle': ['Shape style', 'Style de la forme', '図形のスタイル'],
  'msg.objectColor': ['Object colour', 'Couleur de l’objet', 'オブジェクトの色'],
  'msg.aligned': ['Aligned: {edge}', 'Alignement : {edge}', '整列：{edge}'],
  'msg.nothingToAlign': ['Nothing to align on this layer — it is empty.', 'Rien à aligner sur ce calque — il est vide.', 'このレイヤーには整列する内容がありません。'],
  'msg.alignedNeedTwo': ['Select at least two layers to align them together.', 'Sélectionnez au moins deux calques pour les aligner entre eux.', '2 つ以上のレイヤーを選択してください。'],
  'msg.paletteSaved': ['Colour saved to the swatches', 'Couleur ajoutée à la palette', '見本に色を保存しました'],
  'msg.paletteRemoved': ['Colour removed', 'Couleur supprimée', '色を削除しました'],
  'msg.paletteFull': ['The palette is full ({n} colours)', 'La palette est pleine ({n} couleurs)', '見本がいっぱいです（{n} 色）'],
  'msg.placedLayer': ['{name} placed on a new layer', '{name} placé sur un nouveau calque', '{name} を新しいレイヤーに配置しました'],
  'msg.placeLayerLabel': ['Place {name}', 'Placer {name}', '{name} を配置'],
  'msg.layerOpacity': ['Layer opacity', 'Opacité du calque', 'レイヤーの不透明度'],
  'msg.maskEnable': ['Enable the mask', 'Activer le masque', 'マスクを有効化'],
  'msg.maskDisable': ['Disable the mask', 'Désactiver le masque', 'マスクを無効化'],
  'msg.layerReorder': ['Reorder layers', 'Réorganiser les calques', 'レイヤーの並べ替え'],
  'msg.layerCleared': ['Layer cleared', 'Calque vidé', 'レイヤーを消去'],
  'msg.nudge': ['Nudge the layer', 'Décaler le calque', 'レイヤーを移動'],
  'msg.scaleLayer': ['Resize the layer', 'Redimensionner le calque', 'レイヤーを拡大縮小'],
  'msg.scaleDone': ['Content resized · {w} × {h} px', 'Contenu redimensionné · {w} × {h} px', 'サイズ変更 · {w} × {h} px'],
  'msg.merged': ['Layer merged down', 'Calque fusionné vers le bas', '下のレイヤーと統合'],
  'msg.mergeNeedsTwo': ['There is no layer below to merge into.', 'Aucun calque en dessous à fusionner.', '統合先の下レイヤーがありません。'],
  'msg.transformReady': ['Drag a handle to resize · Shift keeps the ratio · Alt from the center', 'Tirez une poignée pour redimensionner · Maj garde les proportions · Alt depuis le centre', 'ハンドルをドラッグしてサイズ変更 · Shift で比率固定 · Alt で中心から'],
  'msg.colorsSwapped': ['Colors swapped', 'Couleurs inversées', 'カラーを入れ替え'],
  'msg.colorsReset': ['Default colors', 'Couleurs par défaut', '既定のカラー'],
  'msg.blendMode': ['Blend mode', 'Mode de fusion', '合成モード'],
  'msg.layerRename': ['Rename the layer', 'Renommer le calque', 'レイヤー名を変更'],
  'msg.maskAddLabel': ['Add a mask', 'Ajouter un masque', 'マスクを追加'],
  'msg.maskDeleteLabel': ['Delete the mask', 'Supprimer le masque', 'マスクを削除'],
  'msg.layerDeleteLabel': ['Delete the layer', 'Supprimer le calque', 'レイヤーを削除'],
  'msg.layersDeleteLabel': ['Delete {n} layers', 'Supprimer {n} calques', '{n} 個のレイヤーを削除'],
  'msg.layersDuplicated': ['{n} layers duplicated', '{n} calques dupliqués', '{n} 個のレイヤーを複製'],
  'msg.layerIsLocked': ['“{name}” is locked — unlock it first.', '« {name} » est verrouillé — déverrouillez-le d’abord.', '「{name}」はロックされています。'],
  'msg.lockedNoMove': ['Locked layers cannot be reordered.', 'Les calques verrouillés ne peuvent pas être déplacés.', 'ロックされたレイヤーは並べ替えできません。'],
  'msg.layerLocked': ['“{name}” locked', '« {name} » verrouillé', '「{name}」をロックしました'],
  'msg.layerUnlocked': ['“{name}” unlocked', '« {name} » déverrouillé', '「{name}」のロックを解除しました'],
  'msg.pixelsEditing': ['Editing the layer pixels', 'Vous peignez les pixels du calque', 'レイヤーのピクセルを編集'],
  'msg.maskEditing': ['Editing the layer mask', 'Vous peignez le masque du calque', 'レイヤーマスクを編集'],
  'msg.maskInverted': ['Mask inverted', 'Masque inversé', 'マスクを反転しました'],
  'msg.maskDuplicated': ['Mask copied to a new layer', 'Masque copié sur un nouveau calque', 'マスクを新しいレイヤーに複製'],
  'msg.layersSelected': ['{n} layer(s) selected', '{n} calque(s) sélectionné(s)', '{n} 個のレイヤーを選択'],
  'msg.rasterized': ['{name} rasterized', '{name} rasterisé', '{name} をラスタライズしました'],
  'msg.mergeVisibleNone': ['Nothing to merge — at least two visible layers are needed', 'Rien à fusionner — il faut au moins deux calques visibles', '結合するには 2 つ以上の表示レイヤーが必要です'],
  'msg.flattenNone': ['The image already has a single layer', 'L’image n’a déjà qu’un seul calque', '画像はすでに 1 レイヤーです'],
  'msg.eraseContent': ['Clear the content', 'Effacer le contenu', '内容を消去'],
  'msg.cropLabel': ['Crop', 'Recadrage', '切り抜き'],
  'msg.spotlightLabel': ['Light spot', 'Point lumineux', 'スポットライト'],
  'msg.pointDelete': ['Delete the last point', 'Supprimer le dernier point', '最後のポイントを削除'],
  'msg.moveText': ['Move the text', 'Déplacer le texte', 'テキストを移動'],
  'msg.movePath': ['Move the path', 'Déplacer le tracé', 'パスを移動'],
  'msg.moveLayer': ['Move the layer', 'Déplacer le calque', 'レイヤーを移動'],
  'msg.addGradient': ['Add a gradient', 'Ajouter un dégradé', 'グラデーションを追加'],
  'msg.drawGradient': ['Draw a gradient', 'Dessiner un dégradé', 'グラデーションを描画'],
  'msg.newPath': ['New path', 'Nouveau tracé', '新規パス'],
  'msg.newPathBezier': ['New Bézier path', 'Nouveau tracé Bézier', '新規ベジェパス'],
  'msg.editPath': ['Edit the path', 'Modifier le tracé', 'パスを編集'],
  'msg.pathCommitted': ['Path finished — the pen is still ready', 'Tracé terminé — la plume reste active', 'パスを確定 — ペンはそのまま'],
  'msg.pointAdd': ['Add a point', 'Ajouter un point', 'ポイントを追加'],
  'msg.pointAdded': ['Point added', 'Point ajouté', 'ポイントを追加しました'],
  'msg.pointSmooth': ['Smooth / corner point', 'Point lissé / anguleux', 'スムーズ / コーナー点'],
  'msg.pointDeleted': ['Point deleted', 'Point supprimé', 'ポイントを削除'],
  'msg.layersLocked': ['{n} layer(s) locked', '{n} calque(s) verrouillé(s)', '{n} 個のレイヤーをロック'],
  'msg.layersUnlocked': ['{n} layer(s) unlocked', '{n} calque(s) déverrouillé(s)', '{n} 個のレイヤーのロックを解除'],
  'msg.closePathLabel': ['Close the path', 'Fermer le tracé', 'パスを閉じる'],
  'msg.clearSelection': ['Clear the selection', 'Effacer la sélection', '選択範囲を消去'],
  'msg.addLayer': ['Add a layer', 'Ajouter un calque', 'レイヤーを追加'],
  'msg.addShape': ['Add {label}', 'Ajouter {label}', '{label} を追加'],
  'msg.drawShape': ['Draw a shape', 'Dessiner un objet', '図形を描画'],
  'msg.textCreate': ['Add a text', 'Ajouter un texte', 'テキストを追加'],
  'msg.textEditLabel': ['Edit the text', 'Modification du texte', 'テキストを編集'],

  // ── Raccourcis (libellés) ───────────────────────────────────────────────
  'sc.tools': ['Tools', 'Outils', 'ツール'],
  'sc.multiSelect': ['Select several layers', 'Sélectionner plusieurs calques', '複数のレイヤーを選択'],
  'sc.dragLayer': ['Drag a layer to reorder the stack', 'Glisser un calque pour le réordonner', 'レイヤーをドラッグして並べ替え'],
  'sc.lockLayer': ['Lock / unlock the selected layers', 'Verrouiller / déverrouiller les calques sélectionnés', '選択レイヤーをロック / 解除'],
  'sc.penPoint': ['Place a corner point', 'Poser un point anguleux', 'コーナー点を置く'],
  'sc.penCurve': ['Drag to bend the curve', 'Glisser pour courber', 'ドラッグしてカーブ'],
  'sc.penAngle': ['Snap the point to 45°', 'Aligner le point à 45°', '45° にスナップ'],
  'sc.penBreak': ['Break the handles while dragging', 'Détacher les poignées pendant le glissement', 'ドラッグ中にハンドルを分離'],
  'sc.penSmooth': ['Smooth / corner point', 'Point lissé / anguleux', 'スムーズ / コーナー点'],
  'sc.penClose': ['Close the path', 'Fermer le tracé', 'パスを閉じる'],
  'sc.penFinish': ['Finish and keep the pen', 'Terminer en gardant la plume', '確定してペンを維持'],
  'sc.penExit': ['Finish and go back to Select', 'Terminer et revenir à la sélection', '確定して選択ツールへ'],
  'sc.brushSize': ['Brush size (or pencil)', 'Taille du pinceau (ou du crayon)', 'ブラシサイズ（または鉛筆）'],
  'sc.alt': ['Stamp source · temporary eraser · secondary color', 'Source du tampon · gomme temporaire · couleur secondaire', 'スタンプのソース · 一時的な消しゴム · サブカラー'],
  'sc.undo': ['Undo', 'Annuler', '元に戻す'],
  'sc.redo': ['Redo', 'Rétablir', 'やり直す'],
  'sc.new': ['New document', 'Nouveau document', '新規ドキュメント'],
  'sc.open': ['Open an image', 'Ouvrir une image', '画像を開く'],
  'sc.selectAll': ['Select all', 'Tout sélectionner', 'すべて選択'],
  'sc.export': ['Export', 'Exporter', '書き出し'],
  'sc.prefs': ['Preferences', 'Préférences', '環境設定'],
  'sc.fit': ['Fit to window', 'Ajuster à la fenêtre', 'ウィンドウに合わせる'],
  'sc.zoom100': ['Zoom 100 %', 'Zoom 100 %', 'ズーム 100 %'],
  'sc.zoomInOut': ['Zoom in / out', 'Zoom avant / arrière', 'ズームイン / アウト'],
  'sc.enter': ['Apply the crop / finish the pen path', 'Appliquer le recadrage / terminer la plume', '切り抜きを適用 / ペンを完了'],
  'sc.escape': ['Cancel the adjustment, crop or selection', 'Annuler le réglage, le recadrage ou la sélection', '調整・切り抜き・選択をキャンセル'],
  'sc.delete': ['Delete the layer (no selection)', 'Supprimer le calque (sans sélection)', 'レイヤーを削除（選択なし）'],
  'sc.clearLayer': ['Clear the layer content', 'Vider le contenu du calque', 'レイヤーの内容を消去'],
  'sc.fill': ['Fill the selection with the primary color', 'Remplir la sélection avec la couleur principale', 'メインカラーで選択範囲を塗りつぶす'],
  'sc.fillSecondary': ['Fill the selection with the secondary color', 'Remplir la sélection avec la couleur secondaire', 'サブカラーで選択範囲を塗りつぶす'],
  'sc.deselect': ['Deselect', 'Désélectionner', '選択を解除'],
  'sc.invertSelection': ['Invert the selection', 'Inverser la sélection', '選択範囲を反転'],
  'sc.newLayer': ['New layer', 'Nouveau calque', '新規レイヤー'],
  'sc.duplicateLayer': ['Duplicate the layer', 'Dupliquer le calque', 'レイヤーを複製'],
  'sc.mergeDown': ['Merge down', 'Fusionner vers le bas', '下のレイヤーと統合'],
  'sc.reorderLayer': ['Move the layer up / down', 'Monter / descendre le calque', 'レイヤーを上 / 下へ'],
  'sc.selectLayer': ['Select the layer above / below', 'Sélectionner le calque au-dessus / en dessous', '上 / 下のレイヤーを選択'],
  'sc.nudge': ['Nudge by 1 px (Shift: 10 px)', 'Décaler de 1 px (Maj : 10 px)', '1 px 移動（Shift で 10 px）'],
  'sc.transform': ['Free transform: box and handles', 'Transformation libre : boîte et poignées', '自由変形：ボックスとハンドル'],
  'sc.resetColors': ['Default colors', 'Couleurs par défaut', '既定のカラー'],
  'sc.help': ['Show this shortcut list', 'Afficher cette liste de raccourcis', 'このショートカット一覧を表示'],
  'sc.space': ['Temporary hand', 'Main temporaire', '一時的な手のひら'],
  'sc.fullscreen': ['Full screen', 'Plein écran', 'フルスクリーン'],
  'sc.closeTab': ['Close the current tab', 'Fermer l’onglet courant', '現在のタブを閉じる'],
  'sc.nextTab': ['Next / previous tab', 'Onglet suivant / précédent', '次のタブ / 前のタブ'],
  'sc.swapColors': ['Swap colors', 'Inverser les couleurs', 'カラーを入れ替え'],

  // ── Zone de prévisualisation ────────────────────────────────────────────
  'stage.zoomOut': ['Zoom out (Ctrl+-)', 'Zoom arrière (Ctrl+-)', 'ズームアウト (Ctrl+-)'],
  'stage.zoomIn': ['Zoom in (Ctrl++)', 'Zoom avant (Ctrl++)', 'ズームイン (Ctrl++)'],
  'stage.zoomValue': ['Zoom 100 % (Ctrl+1)', 'Zoom 100 % (Ctrl+1)', 'ズーム 100 % (Ctrl+1)'],
  'stage.zoomFit': ['Fit to window (Ctrl+0)', 'Ajuster à la fenêtre (Ctrl+0)', 'ウィンドウに合わせる (Ctrl+0)'],
  'stage.fullscreen': ['Full screen (F11)', 'Plein écran (F11)', 'フルスクリーン (F11)'],
  'stage.fullscreenExit': ['Exit full screen (F11)', 'Quitter le plein écran (F11)', 'フルスクリーンを終了 (F11)'],
  'stage.emptyKicker': ['SUPERPHOTO · PHOTO STUDIO', 'SUPERPHOTO · PHOTO STUDIO', 'SUPERPHOTO · PHOTO STUDIO'],
  'stage.emptyTitle': [
    'Photo retouching, without compromise.',
    'La retouche photo, sans compromis.',
    '妥協のない写真レタッチ。',
  ],
  'stage.emptyBody': [
    'Open an image or create a canvas to start. Layers, selections, curves, levels and Bézier paths await you in a fast, precise workspace.',
    'Ouvrez une image ou créez une toile pour commencer. Calques, sélections, courbes, niveaux et tracés Bézier vous attendent dans un espace précis et rapide.',
    '画像を開くかキャンバスを作成して始めましょう。レイヤー、選択範囲、トーンカーブ、レベル、ベジェパスを高速で正確なワークスペースで。',
  ],
  'stage.emptyFeatures': ['Windows · macOS · Linux', 'Windows · macOS · Linux', 'Windows · macOS · Linux'],

  // ── Erreurs techniques ─────────────────────────────────────────────────
  'err.missingElement': ['Element #{id} not found', 'Élément #{id} introuvable', '要素 #{id} が見つかりません'],
};

let current: Lang = 'en';

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'fr' || value === 'ja';
}

/** Langue du navigateur → langue supportée (défaut : anglais). */
export function detectLanguage(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const short = candidate.slice(0, 2).toLowerCase();
    if (isLang(short)) return short;
  }
  return 'en';
}

export function loadLanguage(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* Navigation privée : on retombe sur la détection. */
  }
  return detectLanguage();
}

export function currentLanguage(): Lang {
  return current;
}

/** Applique la langue à la page et previent l'interface. */
export function setLanguage(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    applyStaticTranslations(document);
    window.dispatchEvent(new CustomEvent<Lang>(LANGUAGE_EVENT, { detail: lang }));
  }
}

export function saveLanguage(lang: Lang): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* Stockage indisponible : la langue reste appliquée pour la session. */
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = D[key];
  if (!entry) return key;
  let value = entry[ORDER[current]] ?? entry[0];
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
  }
  return value;
}

/** Traduit une liste de valeurs reconnues (modes de fusion, types de calque…). */
export function tValue(prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  return D[key] ? t(key) : value;
}

/**
 * Applique les traductions statiques du document.
 *
 * Les composants Astro écrivent l'anglais par défaut et marquent les nœuds :
 *   <span data-i18n="topbar.new">New</span>
 *   <button data-i18n-title="topbar.newTitle">
 *   <input data-i18n-placeholder="opt.placeholder">
 */
export function applyStaticTranslations(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = node.dataset.i18nTitle;
    if (key) node.title = t(key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const key = node.dataset.i18nAria;
    if (key) node.setAttribute('aria-label', t(key));
  }
  for (const node of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = node.dataset.i18nPlaceholder;
    if (key) node.placeholder = t(key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    const key = node.dataset.i18nHtml;
    if (key) node.innerHTML = t(key);
  }
}

export function initLanguage(): Lang {
  current = loadLanguage();
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}
