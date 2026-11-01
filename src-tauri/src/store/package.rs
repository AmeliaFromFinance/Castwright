//! `.cwoverlay` files: an overlay plus the assets it uses, in one zip, for sharing.

use crate::error::{AppResult, user_err};
use crate::model::overlay::Overlay;
use crate::store::project::ProjectStore;
use crate::util::{new_id, safe_file_name};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::io::{Read, Write};
use std::path::Path;

const MAX_ENTRY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 500;

/// Every `assets/<name>` string anywhere in the overlay.
pub fn referenced_assets(overlay: &Overlay) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let v = serde_json::to_value(overlay).unwrap_or(Value::Null);
    walk(&v, &mut |s| {
        if let Some(name) = s.strip_prefix("assets/")
            && let Some(name) = safe_file_name(name)
        {
            out.insert(name);
        }
    });
    out
}

fn walk(v: &Value, f: &mut impl FnMut(&str)) {
    match v {
        Value::String(s) => f(s),
        Value::Array(a) => a.iter().for_each(|x| walk(x, f)),
        Value::Object(m) => m.values().for_each(|x| walk(x, f)),
        _ => {}
    }
}

fn rewrite(v: &mut Value, f: &impl Fn(&str) -> Option<String>) {
    match v {
        Value::String(s) => {
            if let Some(n) = f(s) {
                *s = n;
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| rewrite(x, f)),
        Value::Object(m) => m.values_mut().for_each(|x| rewrite(x, f)),
        _ => {}
    }
}

pub fn export(project: &ProjectStore, overlay: &Overlay, dest: &Path) -> AppResult<()> {
    let tmp = dest.with_extension("cwoverlay.part");
    {
        let file = std::fs::File::create(&tmp)?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("overlay.json", opts).map_err(zip_err)?;
        zip.write_all(&serde_json::to_vec_pretty(overlay)?)?;
        for name in referenced_assets(overlay) {
            if let Some(path) = project.asset_path(&name) {
                zip.start_file(format!("assets/{name}"), opts)
                    .map_err(zip_err)?;
                let mut f = std::fs::File::open(path)?;
                std::io::copy(&mut f, &mut zip)?;
            }
        }
        zip.finish().map_err(zip_err)?;
    }
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

/// Read a `.cwoverlay`, copy its assets into the project (renaming on clashes)
/// and return the overlay with fresh ids. The caller adds it to the project.
pub fn import(project: &ProjectStore, src: &Path) -> AppResult<Overlay> {
    let file = std::fs::File::open(src)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| {
        crate::error::AppError::User("That isn't a Castwright overlay file.".into())
    })?;
    if zip.len() > MAX_ENTRIES {
        return user_err("That overlay file has too many files inside.");
    }
    let mut overlay: Option<Value> = None;
    let mut renames: HashMap<String, String> = HashMap::new();
    let mut total: u64 = 0;
    let tmp_dir = tempdir_in(&project.assets_dir())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(zip_err)?;
        if entry.is_dir() {
            continue;
        }
        let size = entry.size();
        if size > MAX_ENTRY_BYTES {
            return user_err("A file inside the overlay is too large.");
        }
        total += size;
        if total > MAX_TOTAL_BYTES {
            return user_err("The overlay file is too large.");
        }
        let name = entry.name().replace('\\', "/");
        if name == "overlay.json" {
            let mut buf = Vec::new();
            entry
                .by_ref()
                .take(16 * 1024 * 1024)
                .read_to_end(&mut buf)?;
            overlay = Some(serde_json::from_slice(&buf)?);
        } else if let Some(asset) = name.strip_prefix("assets/") {
            let Some(asset) = safe_file_name(asset) else {
                continue;
            };
            let staged = tmp_dir.join(&asset);
            let mut out = std::fs::File::create(&staged)?;
            std::io::copy(&mut entry.by_ref().take(MAX_ENTRY_BYTES), &mut out)?;
            drop(out);
            let added = project.import_asset(&staged)?;
            renames.insert(asset, added.name);
        }
    }
    let _ = std::fs::remove_dir_all(&tmp_dir);
    let Some(mut value) = overlay else {
        return user_err("That file has no overlay in it.");
    };
    rewrite(&mut value, &|s: &str| {
        let name = s.strip_prefix("assets/")?;
        renames.get(name).map(|n| format!("assets/{n}"))
    });
    let mut overlay: Overlay = serde_json::from_value(value)?;
    overlay.id = new_id();
    for l in &mut overlay.layers {
        l.id = new_id();
    }
    overlay.updated_at = crate::util::now_ms();
    Ok(overlay)
}

fn tempdir_in(base: &Path) -> AppResult<std::path::PathBuf> {
    let d = base.join(format!(".import-{}", new_id()));
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

fn zip_err(e: zip::result::ZipError) -> crate::error::AppError {
    crate::error::AppError::User(format!("Overlay file problem: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::overlay::{Layer, LayerKind, MediaFit};

    #[test]
    fn round_trip_with_assets_and_renames() {
        let dir = tempfile::tempdir().unwrap();
        let (a, _) = ProjectStore::open(&dir.path().join("a")).unwrap();
        let src = dir.path().join("logo.png");
        std::fs::write(&src, b"PNG").unwrap();
        a.import_asset(&src).unwrap();
        let mut o = Overlay::starter();
        o.layers.push(Layer {
            kind: LayerKind::Image {
                src: "assets/logo.png".into(),
                fit: MediaFit::Contain,
            },
            ..Layer::default()
        });
        assert_eq!(
            referenced_assets(&o).into_iter().collect::<Vec<_>>(),
            vec!["logo.png"]
        );
        let file = dir.path().join("hud.cwoverlay");
        export(&a, &o, &file).unwrap();

        let (b, _) = ProjectStore::open(&dir.path().join("b")).unwrap();
        std::fs::write(b.assets_dir().join("logo.png"), b"OTHER").unwrap();
        let imported = import(&b, &file).unwrap();
        assert_ne!(imported.id, o.id);
        assert_eq!(imported.layers.len(), o.layers.len());
        let LayerKind::Image { src, .. } = &imported.layers.last().unwrap().kind else {
            panic!()
        };
        assert_eq!(src, "assets/logo-2.png", "renamed to avoid overwriting");
        assert_eq!(
            std::fs::read(b.assets_dir().join("logo-2.png")).unwrap(),
            b"PNG"
        );
        assert_eq!(
            std::fs::read(b.assets_dir().join("logo.png")).unwrap(),
            b"OTHER"
        );
        assert!(!b.assets().iter().any(|x| x.name.starts_with(".import")));
    }

    #[test]
    fn rejects_non_zip_and_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let (p, _) = ProjectStore::open(dir.path()).unwrap();
        let bad = dir.path().join("bad.cwoverlay");
        std::fs::write(&bad, b"nope").unwrap();
        assert!(import(&p, &bad).is_err());

        let evil = dir.path().join("evil.cwoverlay");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&evil).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file("overlay.json", opts).unwrap();
            z.write_all(
                serde_json::to_string(&Overlay::default())
                    .unwrap()
                    .as_bytes(),
            )
            .unwrap();
            z.start_file("assets/../../escape.txt", opts).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        import(&p, &evil).unwrap();
        assert!(!dir.path().join("escape.txt").exists());
        assert!(!dir.path().parent().unwrap().join("escape.txt").exists());
    }
}
