use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::io::Cursor;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageFile {
    name: String,
    mime: String,
    data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageInfo {
    width: u32,
    height: u32,
    format: String,
    size_bytes: u64,
}

fn mime_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "image".to_string())
}

/// Lit une image depuis le disque et la renvoie en base64 : la webview la décode
/// avec `createImageBitmap`, sans exposer le système de fichiers au JavaScript.
#[tauri::command]
fn read_image_file(path: String) -> Result<ImageFile, String> {
    let path = PathBuf::from(path);
    let bytes = std::fs::read(&path).map_err(|error| format!("Lecture impossible : {error}"))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    // WebView2/Safari/WebKit ne décodent pas TIFF : on normalise les formats
    // exotiques en PNG côté Rust avant de les confier à `createImageBitmap`.
    if matches!(extension.as_str(), "tif" | "tiff" | "bmp") {
        let image = image::ImageReader::open(&path)
            .map_err(|error| format!("Image illisible : {error}"))?
            .with_guessed_format()
            .map_err(|error| format!("Format indéterminé : {error}"))?
            .decode()
            .map_err(|error| format!("Décodage impossible : {error}"))?;
        let mut png = Cursor::new(Vec::new());
        image
            .write_to(&mut png, image::ImageFormat::Png)
            .map_err(|error| format!("Conversion PNG impossible : {error}"))?;
        return Ok(ImageFile {
            name: display_name(&path),
            mime: "image/png".to_string(),
            data_base64: STANDARD.encode(png.into_inner()),
        });
    }

    Ok(ImageFile {
        name: display_name(&path),
        mime: mime_for(&path).to_string(),
        data_base64: STANDARD.encode(bytes),
    })
}

/// Écrit le blob exporté par le canvas (PNG, JPEG ou WebP déjà encodé).
#[tauri::command]
fn write_export_file(path: String, data_base64: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|error| format!("Flux d’export invalide : {error}"))?;
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Dossier de destination inaccessible : {error}"))?;
        }
    }
    std::fs::write(&path, bytes).map_err(|error| format!("Écriture impossible : {error}"))
}

/// Métadonnées natives (format, dimensions, poids) utilisées par le studio
/// pour qualifier une image avant son import.
#[tauri::command]
fn probe_image(path: String) -> Result<ImageInfo, String> {
    let path = PathBuf::from(path);
    let metadata =
        std::fs::metadata(&path).map_err(|error| format!("Fichier introuvable : {error}"))?;
    let reader = image::ImageReader::open(&path)
        .map_err(|error| format!("Image illisible : {error}"))?
        .with_guessed_format()
        .map_err(|error| format!("Format indéterminé : {error}"))?;
    let format = reader
        .format()
        .map(|value| format!("{value:?}").to_ascii_lowercase())
        .unwrap_or_else(|| "inconnu".to_string());
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| format!("Dimensions illisibles : {error}"))?;
    Ok(ImageInfo {
        width,
        height,
        format,
        size_bytes: metadata.len(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_image_file,
            write_export_file,
            probe_image
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SuperPhoto");
}
