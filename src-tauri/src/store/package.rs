//! `.cwoverlay` files: an overlay plus the assets it uses, in one zip, for sharing.

use crate::error::{AppResult, user_err};
use crate::model::overlay::Overlay;
use crate::store::project::ProjectStore;
use crate::util::{new_id, safe_file_name};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::io::{Read, Write};
use std::path::Path;

const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_JSON_BYTES: u64 = 16 * 1024 * 1024;
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
    let tmp_dir = tempdir_in(&project.assets_dir())?;
    let mut renames: HashMap<String, String> = HashMap::new();
    let mut added: Vec<String> = Vec::new();
    let result = read_entries(project, &mut zip, &tmp_dir, &mut renames, &mut added);
    let _ = std::fs::remove_dir_all(&tmp_dir);
    let built = result.and_then(|value| {
        let mut value = value.ok_or_else(|| {
            crate::error::AppError::User("That file has no overlay in it.".into())
        })?;
        rewrite(&mut value, &|s: &str| {
            let name = s.strip_prefix("assets/")?;
            renames.get(name).map(|n| format!("assets/{n}"))
        });
        Ok(serde_json::from_value::<Overlay>(value)?)
    });
    let mut overlay = match built {
        Ok(o) => o,
        Err(e) => {
            // Don't leave half an import behind.
            for name in &added {
                let _ = project.delete_asset(name);
            }
            return Err(e);
        }
    };
    overlay.id = new_id();
    for l in &mut overlay.layers {
        l.id = new_id();
    }
    overlay.updated_at = crate::util::now_ms();
    Ok(overlay)
}

/// Copy assets into the project and return the overlay JSON, if any.
fn read_entries(
    project: &ProjectStore,
    zip: &mut zip::ZipArchive<std::fs::File>,
    tmp_dir: &Path,
    renames: &mut HashMap<String, String>,
    added: &mut Vec<String>,
) -> AppResult<Option<Value>> {
    let mut overlay: Option<Value> = None;
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(zip_err)?;
        if entry.is_dir() {
            continue;
        }
        // Sizes in the zip header can be faked, so count what is actually read.
        if entry.size() > MAX_ENTRY_BYTES || total + entry.size() > MAX_TOTAL_BYTES {
            return user_err("The overlay file is too large.");
        }
        let limit = MAX_ENTRY_BYTES.min(MAX_TOTAL_BYTES - total);
        let name = entry.name().replace('\\', "/");
        if name == "overlay.json" {
            let cap = MAX_JSON_BYTES.min(limit);
            let mut buf = Vec::new();
            entry.by_ref().take(cap + 1).read_to_end(&mut buf)?;
            if buf.len() as u64 > cap {
                return user_err("The overlay file is too large.");
            }
            total += buf.len() as u64;
            overlay = Some(serde_json::from_slice(&buf)?);
        } else if let Some(asset) = name.strip_prefix("assets/") {
            let Some(asset) = safe_file_name(asset) else {
                continue;
            };
            let staged = tmp_dir.join(&asset);
            let mut out = std::fs::File::create(&staged)?;
            let copied = std::io::copy(&mut entry.by_ref().take(limit + 1), &mut out)?;
            drop(out);
            if copied > limit {
                return user_err("The overlay file is too large.");
            }
            total += copied;
            // The same file is already here, e.g. from a template made in this project.
            if project
                .asset_path(&asset)
                .is_some_and(|have| same_file(&have, &staged))
            {
                let _ = std::fs::remove_file(&staged);
                renames.insert(asset.clone(), asset);
                continue;
            }
            let info = project.import_asset(&staged)?;
            let _ = std::fs::remove_file(&staged);
            added.push(info.name.clone());
            renames.insert(asset, info.name);
        }
    }
    Ok(overlay)
}

fn same_file(a: &Path, b: &Path) -> bool {
    let len = |p: &Path| std::fs::metadata(p).map(|m| m.len()).ok();
    len(a).is_some() && len(a) == len(b) && std::fs::read(a).ok() == std::fs::read(b).ok()
}

/// The overlay in a `.cwoverlay`, without touching the project.
pub fn peek(src: &Path) -> AppResult<Overlay> {
    let file = std::fs::File::open(src)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| {
        crate::error::AppError::User("That isn't a Castwright overlay file.".into())
    })?;
    let entry = zip
        .by_name("overlay.json")
        .map_err(|_| crate::error::AppError::User("That file has no overlay in it.".into()))?;
    if entry.size() > MAX_JSON_BYTES {
        return user_err("The overlay file is too large.");
    }
    let mut buf = Vec::new();
    entry.take(MAX_JSON_BYTES + 1).read_to_end(&mut buf)?;
    Ok(serde_json::from_slice(&buf)?)
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
    fn failed_import_leaves_no_files_behind() {
        let dir = tempfile::tempdir().unwrap();
        let (p, _) = ProjectStore::open(dir.path()).unwrap();
        let file = dir.path().join("broken.cwoverlay");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file("assets/logo.png", opts).unwrap();
            z.write_all(b"PNG").unwrap();
            z.start_file("overlay.json", opts).unwrap();
            z.write_all(b"{ not json").unwrap();
            z.finish().unwrap();
        }
        assert!(import(&p, &file).is_err());
        let left: Vec<_> = std::fs::read_dir(p.assets_dir())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert!(left.is_empty(), "left behind: {left:?}");
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
