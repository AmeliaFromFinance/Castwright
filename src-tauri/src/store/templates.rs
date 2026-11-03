//! Overlay templates the user saved, as `.cwoverlay` files in the project's `templates/`.

use crate::error::{AppError, AppResult, user_err};
use crate::model::overlay::Overlay;
use crate::store::package;
use crate::store::project::ProjectStore;
use std::path::PathBuf;

fn dir(project: &ProjectStore) -> PathBuf {
    project.dir().join("templates")
}

fn path_of(project: &ProjectStore, id: &str) -> AppResult<PathBuf> {
    let ok = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric());
    if !ok {
        return Err(AppError::NotFound("template".into()));
    }
    Ok(dir(project).join(format!("{id}.cwoverlay")))
}

/// Saved templates, oldest first. Each overlay's id is the template id.
pub fn list(project: &ProjectStore) -> Vec<Overlay> {
    let Ok(rd) = std::fs::read_dir(dir(project)) else {
        return Vec::new();
    };
    let mut out: Vec<(std::time::SystemTime, Overlay)> = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("cwoverlay") {
            continue;
        }
        let Some(id) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        // A broken file shouldn't hide the others.
        let Ok(mut o) = package::peek(&path) else {
            continue;
        };
        o.id = id;
        let at = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        out.push((at, o));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.name.cmp(&b.1.name)));
    out.into_iter().map(|(_, o)| o).collect()
}

/// Save a copy of an overlay, with its assets, as a template.
pub fn save(project: &ProjectStore, overlay: &Overlay, name: &str) -> AppResult<Overlay> {
    let name = name.trim();
    if name.is_empty() {
        return user_err("Give the template a name.");
    }
    let mut o = overlay.clone();
    o.id = crate::util::new_id();
    o.name = name.chars().take(80).collect();
    std::fs::create_dir_all(dir(project))?;
    package::export(project, &o, &path_of(project, &o.id)?)?;
    Ok(o)
}

pub fn delete(project: &ProjectStore, id: &str) -> AppResult<()> {
    let p = path_of(project, id)?;
    if p.exists() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

/// A new overlay from a template, with fresh ids. The caller adds it to the project.
pub fn instantiate(project: &ProjectStore, id: &str, name: &str) -> AppResult<Overlay> {
    let p = path_of(project, id)?;
    if !p.is_file() {
        return Err(AppError::NotFound("template".into()));
    }
    let mut o = package::import(project, &p)?;
    let name = name.trim();
    if !name.is_empty() {
        o.name = name.chars().take(80).collect();
    }
    Ok(o)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::overlay::{Layer, LayerKind, MediaFit};

    #[test]
    fn save_list_use_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let (p, _) = ProjectStore::open(dir.path()).unwrap();
        let src = dir.path().join("frame.png");
        std::fs::write(&src, b"PNG").unwrap();
        p.import_asset(&src).unwrap();
        let mut o = Overlay::starter();
        o.layers.push(Layer {
            kind: LayerKind::Image {
                src: "assets/frame.png".into(),
                fit: MediaFit::Contain,
            },
            ..Layer::default()
        });

        let t = save(&p, &o, "  My layout ").unwrap();
        assert_eq!(t.name, "My layout");
        let listed = list(&p);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, t.id);
        assert_eq!(listed[0].layers.len(), o.layers.len());

        let made = instantiate(&p, &t.id, "Stream 2").unwrap();
        assert_eq!(made.name, "Stream 2");
        assert_ne!(made.layers[0].id, o.layers[0].id);
        let LayerKind::Image { src, .. } = &made.layers.last().unwrap().kind else {
            panic!()
        };
        assert_eq!(src, "assets/frame.png", "the asset already here is reused");
        assert_eq!(p.assets().len(), 1);

        assert!(save(&p, &o, "  ").is_err());
        assert!(instantiate(&p, "../x", "").is_err());
        delete(&p, &t.id).unwrap();
        assert!(list(&p).is_empty());
    }
}
