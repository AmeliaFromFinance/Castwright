//! `.cwactions` files: actions to share, with what they point at stored by name so it
//! can be linked to something else on import. Plain JSON, so the browser demo can read it.
//! The same rules are in `src/lib/pages/automation/sharing.ts` for the demo.

use crate::error::{AppResult, user_err};
use crate::model::automation::{Action, NodeKind, Step};
use crate::model::project::Project;
use crate::util::new_id;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use ts_rs::TS;

pub const ACTIONS_KIND: &str = "castwright-actions";
/// Bump when older versions of the app couldn't read the file correctly.
pub const ACTIONS_VERSION: u32 = 1;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// Variables the app keeps up to date itself; never exported.
const BUILT_IN: [&str; 5] = ["stream.", "obs.", "twitch.", "last.", "session."];
/// Parts of a variable name that mark its value as private.
const SECRET_WORDS: [&str; 8] = [
    "secret", "token", "password", "passwd", "apikey", "key", "auth", "webhook",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct ActionPackage {
    pub kind: String,
    pub version: u32,
    pub app_version: String,
    #[ts(type = "number")]
    pub exported_at: i64,
    pub actions: Vec<Action>,
    pub variables: Vec<PackageVar>,
    pub refs: Vec<PackageRef>,
}

impl Default for ActionPackage {
    fn default() -> Self {
        ActionPackage {
            kind: ACTIONS_KIND.into(),
            version: ACTIONS_VERSION,
            app_version: String::new(),
            exported_at: 0,
            actions: Vec::new(),
            variables: Vec::new(),
            refs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PackageVar {
    pub name: String,
    /// Starting value for a project that doesn't have the variable yet.
    #[ts(type = "unknown")]
    #[serde(default)]
    pub default: Option<Value>,
    /// The name looks private, so no value was exported.
    #[serde(default)]
    pub secret: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RefKind {
    Layer,
    Action,
    Asset,
}

/// Something a step points at that isn't in the file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PackageRef {
    pub kind: RefKind,
    /// Id in the project it came from. Assets use the file name.
    pub id: String,
    pub name: String,
    /// Layers: the overlay's id and name.
    #[serde(default)]
    pub overlay_id: String,
    #[serde(default)]
    pub overlay_name: String,
}

impl PackageRef {
    /// Key used in `ImportChoices::links`. Same as `refKey` in sharing.ts.
    pub fn key(&self) -> String {
        ref_key(self.kind, &self.overlay_id, &self.id)
    }
}

fn ref_key(kind: RefKind, overlay_id: &str, id: &str) -> String {
    match kind {
        RefKind::Layer => format!("layer:{overlay_id}/{id}"),
        RefKind::Action => format!("action:{id}"),
        RefKind::Asset => format!("asset:{id}"),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ConflictChoice {
    Skip,
    Replace,
    #[default]
    KeepBoth,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct ImportChoices {
    /// By action id in the file, for actions whose name is taken. Missing = keep both.
    pub conflicts: HashMap<String, ConflictChoice>,
    /// By reference key: the local id to use (layers `overlay_id/layer_id`, assets the
    /// file name), or null to leave it unlinked. Missing = the same id if it exists here.
    pub links: HashMap<String, Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS, Default)]
#[ts(export)]
pub struct ImportReport {
    pub added: u32,
    pub replaced: u32,
    pub skipped: u32,
    /// References left pointing at nothing.
    pub unlinked: u32,
    /// Variables created with their default.
    pub variables: u32,
    /// The first imported action, to select it.
    pub first_id: Option<String>,
}

pub fn is_secret_name(name: &str) -> bool {
    name.to_lowercase()
        .split(['.', '_', '-'])
        .any(|part| SECRET_WORDS.contains(&part))
}

fn is_built_in(name: &str) -> bool {
    BUILT_IN.iter().any(|p| name.starts_with(p))
}

/// Every step in an action, nested If lists included.
fn steps(a: &Action) -> Vec<&Step> {
    fn walk<'a>(list: &'a [Step], out: &mut Vec<&'a Step>) {
        for s in list {
            out.push(s);
            if let Step::If {
                then, otherwise, ..
            } = s
            {
                walk(then, out);
                walk(otherwise, out);
            }
        }
    }
    let mut out = Vec::new();
    for n in &a.graph.nodes {
        if let NodeKind::Step { step } = &n.kind {
            walk(std::slice::from_ref(step), &mut out);
        }
    }
    out
}

fn steps_mut(a: &mut Action, f: &mut impl FnMut(&mut Step)) {
    fn walk(list: &mut [Step], f: &mut impl FnMut(&mut Step)) {
        for s in list {
            f(s);
            if let Step::If {
                then, otherwise, ..
            } = s
            {
                walk(then, f);
                walk(otherwise, f);
            }
        }
    }
    for n in &mut a.graph.nodes {
        if let NodeKind::Step { step } = &mut n.kind {
            walk(std::slice::from_mut(step), f);
        }
    }
}

fn asset_name(path: &str) -> Option<&str> {
    path.strip_prefix("assets/").filter(|n| !n.is_empty())
}

/// Keys written in `{{ key | filter }}` templates and condition fields.
fn template_keys(text: &str, out: &mut HashSet<String>) {
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { break };
        let key = after[..end].split('|').next().unwrap_or("").trim();
        if !key.is_empty() {
            out.insert(key.to_string());
        }
        rest = &after[end + 2..];
    }
}

/// Variable names the actions read or write.
fn used_variables(actions: &[Action]) -> (HashSet<String>, HashSet<String>) {
    let mut written = HashSet::new();
    let mut read = HashSet::new();
    for a in actions {
        for n in &a.graph.nodes {
            let v = match &n.kind {
                NodeKind::Trigger { trigger } => serde_json::to_value(trigger),
                NodeKind::Step { step } => serde_json::to_value(step),
            };
            let v = v.unwrap_or(Value::Null);
            walk_strings(&v, &mut |s| template_keys(s, &mut read));
            walk_fields(&v, &mut read);
        }
        for s in steps(a) {
            match s {
                Step::SetVariable { key, .. } | Step::AddToVariable { key, .. } => {
                    written.insert(key.trim().to_string());
                }
                Step::HttpRequest { save_to, .. } if !save_to.trim().is_empty() => {
                    written.insert(save_to.trim().to_string());
                }
                _ => {}
            }
        }
    }
    (written, read)
}

fn walk_strings(v: &Value, f: &mut impl FnMut(&str)) {
    match v {
        Value::String(s) => f(s),
        Value::Array(a) => a.iter().for_each(|x| walk_strings(x, f)),
        Value::Object(m) => m.values().for_each(|x| walk_strings(x, f)),
        _ => {}
    }
}

/// `field` of every condition.
fn walk_fields(v: &Value, out: &mut HashSet<String>) {
    match v {
        Value::Array(a) => a.iter().for_each(|x| walk_fields(x, out)),
        Value::Object(m) => {
            if let (Some(Value::String(f)), Some(_)) = (m.get("field"), m.get("op")) {
                out.insert(f.trim().to_string());
            }
            m.values().for_each(|x| walk_fields(x, out));
        }
        _ => {}
    }
}

/// Build a package from some of the project's actions. `vars` are the current values,
/// `saved` the ones kept on disk.
pub fn build(
    project: &Project,
    ids: &[String],
    vars: &Map<String, Value>,
    saved: &Map<String, Value>,
) -> AppResult<ActionPackage> {
    let actions: Vec<Action> = project
        .actions
        .iter()
        .filter(|a| ids.contains(&a.id))
        .map(|a| a.normalized().into_owned())
        .collect();
    if actions.is_empty() {
        return user_err("Pick at least one action to export.");
    }
    let inside: HashSet<&str> = actions.iter().map(|a| a.id.as_str()).collect();

    let mut refs: BTreeMap<String, PackageRef> = BTreeMap::new();
    let mut add = |r: PackageRef| {
        refs.entry(r.key()).or_insert(r);
    };
    for a in &actions {
        for s in steps(a) {
            match s {
                Step::RunAction { action_id } if !inside.contains(action_id.as_str()) => {
                    if let Some(t) = project.actions.iter().find(|x| &x.id == action_id) {
                        add(PackageRef {
                            kind: RefKind::Action,
                            id: t.id.clone(),
                            name: t.name.clone(),
                            overlay_id: String::new(),
                            overlay_name: String::new(),
                        });
                    }
                }
                Step::SetLayerVisible {
                    overlay_id,
                    layer_id,
                    ..
                } => {
                    let found = project
                        .overlays
                        .iter()
                        .find(|o| &o.id == overlay_id)
                        .and_then(|o| o.layers.iter().find(|l| &l.id == layer_id).map(|l| (o, l)));
                    if let Some((o, l)) = found {
                        add(PackageRef {
                            kind: RefKind::Layer,
                            id: l.id.clone(),
                            name: l.name.clone(),
                            overlay_id: o.id.clone(),
                            overlay_name: o.name.clone(),
                        });
                    }
                }
                Step::PlaySound { src, .. } => {
                    if let Some(n) = asset_name(src) {
                        add(asset_ref(n));
                    }
                }
                Step::PlayAlert { image, sound, .. } => {
                    for p in [image, sound] {
                        if let Some(n) = asset_name(p) {
                            add(asset_ref(n));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let (written, read) = used_variables(&actions);
    let mut names: Vec<String> = written
        .iter()
        .cloned()
        .chain(read.into_iter().filter(|k| vars.contains_key(k)))
        .filter(|k| crate::vars::valid_key(k) && !is_built_in(k))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    names.sort();
    let variables = names
        .into_iter()
        .map(|name| {
            let secret = is_secret_name(&name);
            let default = if secret {
                None
            } else {
                match saved.get(&name) {
                    // Counters start again from zero.
                    Some(v) if v.is_number() => Some(Value::from(0)),
                    Some(v) => Some(v.clone()),
                    None => None,
                }
            };
            PackageVar {
                name,
                default,
                secret,
            }
        })
        .collect();

    Ok(ActionPackage {
        kind: ACTIONS_KIND.into(),
        version: ACTIONS_VERSION,
        app_version: env!("CARGO_PKG_VERSION").into(),
        exported_at: crate::util::now_ms(),
        actions,
        variables,
        refs: refs.into_values().collect(),
    })
}

fn asset_ref(name: &str) -> PackageRef {
    PackageRef {
        kind: RefKind::Asset,
        id: name.to_string(),
        name: name.to_string(),
        overlay_id: String::new(),
        overlay_name: String::new(),
    }
}

pub fn write(pkg: &ActionPackage, dest: &Path) -> AppResult<()> {
    crate::util::write_atomic(dest, &serde_json::to_vec_pretty(pkg)?)?;
    Ok(())
}

pub fn read(src: &Path) -> AppResult<ActionPackage> {
    if std::fs::metadata(src)?.len() > MAX_FILE_BYTES {
        return user_err("That actions file is too large.");
    }
    parse(&std::fs::read(src)?)
}

/// Check and load a package. Newer versions are refused.
pub fn parse(bytes: &[u8]) -> AppResult<ActionPackage> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return user_err("That actions file is too large.");
    }
    let not_ours = || crate::error::AppError::User("That isn't a Castwright actions file.".into());
    let raw: Value = serde_json::from_slice(bytes).map_err(|_| not_ours())?;
    if raw.get("kind").and_then(Value::as_str) != Some(ACTIONS_KIND) {
        return Err(not_ours());
    }
    let version = raw.get("version").and_then(Value::as_u64).unwrap_or(0);
    if version > ACTIONS_VERSION as u64 {
        return user_err(
            "These actions were exported by a newer version of Castwright. Update Castwright to import them.",
        );
    }
    let mut pkg: ActionPackage = serde_json::from_value(raw)?;
    if pkg.actions.is_empty() {
        return user_err("That file has no actions in it.");
    }
    for a in &mut pkg.actions {
        a.normalize();
    }
    pkg.variables.retain(|v| crate::vars::valid_key(&v.name));
    for v in &mut pkg.variables {
        if v.secret || is_secret_name(&v.name) {
            v.secret = true;
            v.default = None;
        }
    }
    Ok(pkg)
}

/// "Name (2)", "Name (3)"... not clashing with `taken` (lowercase).
fn free_name(name: &str, taken: &HashSet<String>) -> String {
    (2..)
        .map(|n| format!("{name} ({n})"))
        .find(|c| !taken.contains(&c.to_lowercase()))
        .unwrap_or_else(|| name.to_string())
}

/// Where a reference points in this project: the chosen link, else the same id if it
/// exists here, else nothing.
fn resolve(
    project: &Project,
    assets: &[String],
    choices: &ImportChoices,
    kind: RefKind,
    overlay_id: &str,
    id: &str,
) -> Option<String> {
    if let Some(choice) = choices.links.get(&ref_key(kind, overlay_id, id)) {
        return choice.clone().filter(|s| !s.is_empty());
    }
    let here = match kind {
        RefKind::Layer => project
            .overlays
            .iter()
            .any(|o| o.id == overlay_id && o.layers.iter().any(|l| l.id == id)),
        RefKind::Action => project.actions.iter().any(|a| a.id == id),
        RefKind::Asset => assets.iter().any(|a| a == id),
    };
    here.then(|| match kind {
        RefKind::Layer => format!("{overlay_id}/{id}"),
        _ => id.to_string(),
    })
}

/// Add the package's actions to the project. Imported actions start turned off.
/// Returns what happened and the variables to create (name, value).
pub fn apply(
    project: &mut Project,
    pkg: &ActionPackage,
    choices: &ImportChoices,
    assets: &[String],
) -> (ImportReport, Vec<(String, Value)>) {
    let mut report = ImportReport::default();
    let mut taken: HashSet<String> = project
        .actions
        .iter()
        .map(|a| a.name.trim().to_lowercase())
        .collect();
    let existing: Vec<(String, String)> = project
        .actions
        .iter()
        .map(|a| (a.name.trim().to_lowercase(), a.id.clone()))
        .collect();

    // Decide each action's fate first, so steps running another imported action can follow it.
    enum Fate {
        Skip,
        Replace(String),
        Add(String, String),
    }
    let mut ids: HashMap<String, String> = HashMap::new();
    let mut fates = Vec::new();
    for a in &pkg.actions {
        let key = a.name.trim().to_lowercase();
        let clash = existing.iter().find(|(n, _)| *n == key).map(|(_, id)| id);
        let fate = match clash {
            Some(local) => match choices.conflicts.get(&a.id).copied().unwrap_or_default() {
                ConflictChoice::Skip => {
                    ids.insert(a.id.clone(), local.clone());
                    Fate::Skip
                }
                ConflictChoice::Replace => {
                    ids.insert(a.id.clone(), local.clone());
                    Fate::Replace(local.clone())
                }
                ConflictChoice::KeepBoth => {
                    let name = free_name(a.name.trim(), &taken);
                    taken.insert(name.to_lowercase());
                    let id = new_id();
                    ids.insert(a.id.clone(), id.clone());
                    Fate::Add(id, name)
                }
            },
            None => {
                // Two actions in the file can share a name too.
                let name = if taken.contains(&key) {
                    free_name(a.name.trim(), &taken)
                } else {
                    a.name.clone()
                };
                taken.insert(name.trim().to_lowercase());
                let id = new_id();
                ids.insert(a.id.clone(), id.clone());
                Fate::Add(id, name)
            }
        };
        fates.push(fate);
    }

    let mut unlinked: HashSet<String> = HashSet::new();
    for (a, fate) in pkg.actions.iter().zip(fates) {
        let mut action = a.clone();
        steps_mut(&mut action, &mut |s| match s {
            Step::RunAction { action_id } => {
                if let Some(id) = ids.get(action_id.as_str()) {
                    *action_id = id.clone();
                } else if !action_id.is_empty() {
                    match resolve(project, assets, choices, RefKind::Action, "", action_id) {
                        Some(id) => *action_id = id,
                        None => {
                            unlinked.insert(ref_key(RefKind::Action, "", action_id));
                            action_id.clear();
                        }
                    }
                }
            }
            Step::SetLayerVisible {
                overlay_id,
                layer_id,
                ..
            } if !layer_id.is_empty() => {
                let to = resolve(
                    project,
                    assets,
                    choices,
                    RefKind::Layer,
                    overlay_id,
                    layer_id,
                );
                match to.as_deref().and_then(|t| t.split_once('/')) {
                    Some((o, l)) => {
                        *overlay_id = o.to_string();
                        *layer_id = l.to_string();
                    }
                    None => {
                        unlinked.insert(ref_key(RefKind::Layer, overlay_id, layer_id));
                        overlay_id.clear();
                        layer_id.clear();
                    }
                }
            }
            Step::PlaySound { src, .. } => {
                relink_asset(project, assets, choices, src, &mut unlinked)
            }
            Step::PlayAlert { image, sound, .. } => {
                relink_asset(project, assets, choices, image, &mut unlinked);
                relink_asset(project, assets, choices, sound, &mut unlinked);
            }
            _ => {}
        });
        action.enabled = false;
        action.normalize();
        match fate {
            Fate::Skip => report.skipped += 1,
            Fate::Replace(id) => {
                action.id = id.clone();
                if let Some(slot) = project.actions.iter_mut().find(|x| x.id == id) {
                    action.name = slot.name.clone();
                    *slot = action;
                }
                report.replaced += 1;
                report.first_id.get_or_insert(id);
            }
            Fate::Add(id, name) => {
                action.id = id.clone();
                action.name = name;
                project.actions.push(action);
                report.added += 1;
                report.first_id.get_or_insert(id);
            }
        }
    }
    report.unlinked = unlinked.len() as u32;

    let vars = pkg
        .variables
        .iter()
        .filter(|v| !v.secret && !is_secret_name(&v.name) && crate::vars::valid_key(&v.name))
        .filter_map(|v| v.default.clone().map(|d| (v.name.clone(), d)))
        .collect();
    (report, vars)
}

fn relink_asset(
    project: &Project,
    assets: &[String],
    choices: &ImportChoices,
    path: &mut String,
    unlinked: &mut HashSet<String>,
) {
    let Some(name) = asset_name(path).map(str::to_string) else {
        return;
    };
    match resolve(project, assets, choices, RefKind::Asset, "", &name) {
        Some(to) => *path = format!("assets/{to}"),
        // Kept as is: adding a file with this name later fixes it.
        None => {
            unlinked.insert(ref_key(RefKind::Asset, "", &name));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::automation::{Toggle, Trigger};
    use crate::model::overlay::{Layer, Overlay};
    use serde_json::json;

    fn action(name: &str, steps: Vec<Step>) -> Action {
        let mut a = Action {
            name: name.into(),
            triggers: vec![Trigger::Manual],
            steps,
            ..Action::default()
        };
        a.normalize();
        a
    }

    fn step_list(a: &Action) -> Vec<Step> {
        steps(a).into_iter().cloned().collect()
    }

    /// A project with an overlay, a sound and three actions that point at things.
    fn source() -> (Project, Map<String, Value>) {
        let mut p = Project::default();
        let mut o = Overlay {
            name: "Main".into(),
            ..Overlay::default()
        };
        o.layers.push(Layer {
            name: "Webcam frame".into(),
            ..Layer::default()
        });
        let (oid, lid) = (o.id.clone(), o.layers[0].id.clone());
        p.overlays.push(o);
        let helper = action(
            "Helper",
            vec![Step::Log {
                message: "hi".into(),
            }],
        );
        let outside = action("Outside", vec![]);
        let main = action(
            "Hype",
            vec![
                Step::AddToVariable {
                    key: "counter.hype".into(),
                    amount: 1.0,
                    persist: true,
                },
                Step::ChatSend {
                    message: "{{counter.hype}} {{api.token}} {{name}} {{session.subs}}".into(),
                    as_bot: false,
                    reply: false,
                },
                Step::SetLayerVisible {
                    overlay_id: oid,
                    layer_id: lid,
                    state: Toggle::On,
                },
                Step::PlaySound {
                    src: "assets/ding.mp3".into(),
                    volume: 70,
                },
                Step::RunAction {
                    action_id: helper.id.clone(),
                },
                Step::RunAction {
                    action_id: outside.id.clone(),
                },
            ],
        );
        p.actions = vec![main, helper, outside];
        let saved = json!({
            "counter.hype": 41,
            "api.token": "s3cret",
            "settings.link": "discord.gg/x",
            "session.subs": 3
        });
        (p, saved.as_object().unwrap().clone())
    }

    fn export(p: &Project, saved: &Map<String, Value>, names: &[&str]) -> ActionPackage {
        let ids: Vec<String> = p
            .actions
            .iter()
            .filter(|a| names.contains(&a.name.as_str()))
            .map(|a| a.id.clone())
            .collect();
        let pkg = build(p, &ids, saved, saved).unwrap();
        // Through a file and back, like a real share.
        parse(&serde_json::to_vec_pretty(&pkg).unwrap()).unwrap()
    }

    #[test]
    fn round_trip_into_an_empty_project() {
        let (p, saved) = source();
        let pkg = export(&p, &saved, &["Hype", "Helper"]);
        assert_eq!(pkg.version, ACTIONS_VERSION);
        assert_eq!(pkg.actions.len(), 2);
        let kinds: Vec<_> = pkg.refs.iter().map(|r| (r.kind, r.name.as_str())).collect();
        assert!(kinds.contains(&(RefKind::Layer, "Webcam frame")));
        assert!(kinds.contains(&(RefKind::Asset, "ding.mp3")));
        assert!(kinds.contains(&(RefKind::Action, "Outside")));
        assert!(
            !kinds.contains(&(RefKind::Action, "Helper")),
            "actions in the file aren't references"
        );
        let layer = pkg.refs.iter().find(|r| r.kind == RefKind::Layer).unwrap();
        assert_eq!(layer.overlay_name, "Main");

        let mut target = Project::default();
        let (report, vars) = apply(&mut target, &pkg, &ImportChoices::default(), &[]);
        assert_eq!(report.added, 2);
        assert_eq!(report.unlinked, 3);
        assert!(
            target.actions.iter().all(|a| !a.enabled),
            "imports start off"
        );
        let hype = target.actions.iter().find(|a| a.name == "Hype").unwrap();
        let helper = target.actions.iter().find(|a| a.name == "Helper").unwrap();
        assert_ne!(helper.id, p.actions[1].id);
        assert_eq!(report.first_id.as_deref(), Some(hype.id.as_str()));
        let s = step_list(hype);
        assert_eq!(s.len(), 6);
        assert!(s.contains(&Step::RunAction {
            action_id: helper.id.clone()
        }));
        assert!(s.contains(&Step::RunAction {
            action_id: String::new()
        }));
        assert!(s.contains(&Step::SetLayerVisible {
            overlay_id: String::new(),
            layer_id: String::new(),
            state: Toggle::On
        }));
        assert_eq!(vars, vec![("counter.hype".to_string(), json!(0))]);
    }

    #[test]
    fn secrets_never_leave() {
        let (p, saved) = source();
        let pkg = export(&p, &saved, &["Hype"]);
        let names: Vec<_> = pkg.variables.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(names, vec!["api.token", "counter.hype"]);
        let token = &pkg.variables[0];
        assert!(token.secret);
        assert_eq!(token.default, None);
        let text = serde_json::to_string(&pkg).unwrap();
        assert!(!text.contains("s3cret"));
        assert!(!text.contains("discord.gg"), "unused variables stay home");

        // A hand-edited file can't sneak a value in either.
        let mut raw = serde_json::to_value(&pkg).unwrap();
        raw["variables"][0]["secret"] = json!(false);
        raw["variables"][0]["default"] = json!("leak");
        let back = parse(raw.to_string().as_bytes()).unwrap();
        assert!(back.variables[0].secret);
        let (_, vars) = apply(
            &mut Project::default(),
            &back,
            &ImportChoices::default(),
            &[],
        );
        assert!(vars.iter().all(|(k, _)| k != "api.token"));

        for (name, secret) in [
            ("twitch_api_key", true),
            ("my.password", true),
            ("discord-webhook", true),
            ("counter.deaths", false),
            ("monkey.count", false),
        ] {
            assert_eq!(is_secret_name(name), secret, "{name}");
        }
    }

    #[test]
    fn references_relink_to_chosen_items() {
        let (p, saved) = source();
        let pkg = export(&p, &saved, &["Hype"]);
        let mut target = Project::default();
        let mut o = Overlay::default();
        o.layers.push(Layer {
            name: "Cam".into(),
            ..Layer::default()
        });
        let want = format!("{}/{}", o.id, o.layers[0].id);
        target.overlays.push(o);
        let local = action("Local helper", vec![]);
        let local_id = local.id.clone();
        target.actions.push(local);

        let mut choices = ImportChoices::default();
        for r in &pkg.refs {
            let to = match r.kind {
                RefKind::Layer => Some(want.clone()),
                RefKind::Action => Some(local_id.clone()),
                RefKind::Asset => Some("chime.ogg".into()),
            };
            choices.links.insert(r.key(), to);
        }
        // Leave the step that runs Helper unlinked.
        choices
            .links
            .insert(format!("action:{}", p.actions[1].id), None);
        let (report, _) = apply(&mut target, &pkg, &choices, &["chime.ogg".into()]);
        assert_eq!(report.added, 1);
        assert_eq!(report.unlinked, 1);
        let s = step_list(target.actions.last().unwrap());
        let (oid, lid) = want.split_once('/').unwrap();
        assert!(s.contains(&Step::SetLayerVisible {
            overlay_id: oid.into(),
            layer_id: lid.into(),
            state: Toggle::On
        }));
        assert!(s.contains(&Step::PlaySound {
            src: "assets/chime.ogg".into(),
            volume: 70
        }));
        assert!(s.contains(&Step::RunAction {
            action_id: local_id
        }));
    }

    #[test]
    fn same_project_keeps_links_without_choices() {
        let (mut p, saved) = source();
        let pkg = export(&p, &saved, &["Hype"]);
        let mut choices = ImportChoices::default();
        choices
            .conflicts
            .insert(pkg.actions[0].id.clone(), ConflictChoice::KeepBoth);
        let (report, _) = apply(&mut p, &pkg, &choices, &["ding.mp3".into()]);
        assert_eq!(report.unlinked, 0);
        let copy = p.actions.last().unwrap();
        assert_eq!(copy.name, "Hype (2)");
        let original = step_list(&p.actions[0]);
        assert_eq!(
            step_list(copy),
            original,
            "every reference still points home"
        );
    }

    #[test]
    fn name_conflicts() {
        let (p, saved) = source();
        let pkg = export(&p, &saved, &["Hype", "Helper"]);
        let hype_file = pkg.actions[0].id.clone();
        let helper_file = pkg.actions[1].id.clone();

        let mut target = Project::default();
        let mut mine = action(
            "hype ",
            vec![Step::Log {
                message: "mine".into(),
            }],
        );
        mine.enabled = true;
        let mine_id = mine.id.clone();
        let other = action("Helper", vec![]);
        let other_id = other.id.clone();
        target.actions = vec![mine, other, action("Helper (2)", vec![])];

        // Skip: nothing changes, and steps that ran it use the local one.
        let mut choices = ImportChoices::default();
        choices
            .conflicts
            .insert(hype_file.clone(), ConflictChoice::Skip);
        choices
            .conflicts
            .insert(helper_file.clone(), ConflictChoice::Skip);
        let mut t = target.clone();
        let (r, _) = apply(&mut t, &pkg, &choices, &[]);
        assert_eq!((r.added, r.replaced, r.skipped), (0, 0, 2));
        assert_eq!(t, target);

        // Replace keeps the local id and name, takes the new graph, and starts off.
        choices
            .conflicts
            .insert(hype_file.clone(), ConflictChoice::Replace);
        let mut t = target.clone();
        let (r, _) = apply(&mut t, &pkg, &choices, &[]);
        assert_eq!((r.added, r.replaced, r.skipped), (0, 1, 1));
        assert_eq!(t.actions.len(), 3);
        let replaced = &t.actions[0];
        assert_eq!(replaced.id, mine_id);
        assert_eq!(replaced.name, "hype ");
        assert!(!replaced.enabled);
        let s = step_list(replaced);
        assert_eq!(s.len(), 6);
        assert!(s.contains(&Step::RunAction {
            action_id: other_id
        }));

        // Keep both picks a free name.
        let mut t = target.clone();
        let (r, _) = apply(&mut t, &pkg, &ImportChoices::default(), &[]);
        assert_eq!((r.added, r.replaced, r.skipped), (2, 0, 0));
        let names: Vec<_> = t.actions.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["hype ", "Helper", "Helper (2)", "Hype (2)", "Helper (3)"]
        );
        let ids: HashSet<_> = t.actions.iter().map(|a| &a.id).collect();
        assert_eq!(ids.len(), 5);
    }

    #[test]
    fn refuses_newer_versions_and_other_files() {
        let (p, saved) = source();
        let mut raw = serde_json::to_value(export(&p, &saved, &["Helper"])).unwrap();
        raw["version"] = json!(ACTIONS_VERSION + 1);
        let err = parse(raw.to_string().as_bytes()).unwrap_err().to_string();
        assert!(err.contains("newer version"), "{err}");

        for bad in [
            &b"nope"[..],
            br#"{"kind":"castwright-overlay"}"#,
            br#"[1,2]"#,
        ] {
            let err = parse(bad).unwrap_err().to_string();
            assert!(err.contains("isn't a Castwright actions file"), "{err}");
        }
        let empty = json!({ "kind": ACTIONS_KIND, "version": 1, "actions": [] });
        assert!(parse(empty.to_string().as_bytes()).is_err());
    }

    #[test]
    fn writes_and_reads_files() {
        let dir = tempfile::tempdir().unwrap();
        let (p, saved) = source();
        let file = dir.path().join("hype.cwactions");
        let ids = vec![p.actions[0].id.clone()];
        write(&build(&p, &ids, &saved, &saved).unwrap(), &file).unwrap();
        let back = read(&file).unwrap();
        assert_eq!(back.actions[0].name, "Hype");
        assert!(build(&p, &[], &saved, &saved).is_err());
    }
}
