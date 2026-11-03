use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Bots most channels have. Users can edit the list.
pub const KNOWN_BOTS: &[&str] = &[
    "nightbot",
    "streamelements",
    "streamlabs",
    "moobot",
    "fossabot",
    "sery_bot",
    "wizebot",
];

/// Most entries in one rule list.
pub const MAX_LIST: usize = 200;
/// Longest word or pattern.
pub const MAX_ENTRY: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct HighlightColors {
    pub first: String,
    pub mention: String,
    pub keyword: String,
    pub user: String,
    pub redeemed: String,
}

impl Default for HighlightColors {
    fn default() -> Self {
        HighlightColors {
            first: "#3ddc97".into(),
            mention: "#ff6b6b".into(),
            keyword: "#f5c451".into(),
            user: "#8ab4ff".into(),
            redeemed: "#c792ea".into(),
        }
    }
}

/// What chat hides and highlights. Used by the chat panel and chat layers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct ChatRules {
    pub hide_bots: bool,
    /// Logins. The signed-in bot account is always included.
    pub bots: Vec<String>,
    /// Messages starting with `!`.
    pub hide_commands: bool,
    pub hide_users: Vec<String>,
    /// Words, or `/pattern/flags` for a regular expression.
    pub hide_words: Vec<String>,
    /// Someone chatting for the first time.
    pub highlight_first: bool,
    /// Messages with the broadcaster's name in them.
    pub highlight_mentions: bool,
    /// Words, or `/pattern/flags`.
    pub highlight_keywords: Vec<String>,
    pub highlight_users: Vec<String>,
    pub highlight_mods: bool,
    pub highlight_vips: bool,
    /// "Highlight my message" channel point redemptions.
    pub highlight_redeemed: bool,
    pub colors: HighlightColors,
}

impl Default for ChatRules {
    fn default() -> Self {
        ChatRules {
            hide_bots: true,
            bots: KNOWN_BOTS.iter().map(|s| s.to_string()).collect(),
            hide_commands: true,
            hide_users: Vec::new(),
            hide_words: Vec::new(),
            highlight_first: true,
            highlight_mentions: true,
            highlight_keywords: Vec::new(),
            highlight_users: Vec::new(),
            highlight_mods: false,
            highlight_vips: false,
            highlight_redeemed: true,
            colors: HighlightColors::default(),
        }
    }
}

fn clean_list(list: Vec<String>, logins: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in list {
        let mut s = s.trim().to_string();
        if logins {
            s = s.trim_start_matches('@').to_lowercase();
        }
        if s.is_empty() || s.chars().count() > MAX_ENTRY || out.contains(&s) {
            continue;
        }
        out.push(s);
        if out.len() >= MAX_LIST {
            break;
        }
    }
    out
}

impl ChatRules {
    /// Trimmed, without duplicates or empty entries, and within the size limits.
    pub fn cleaned(mut self) -> Self {
        self.bots = clean_list(self.bots, true);
        self.hide_users = clean_list(self.hide_users, true);
        self.highlight_users = clean_list(self.highlight_users, true);
        self.hide_words = clean_list(self.hide_words, false);
        self.highlight_keywords = clean_list(self.highlight_keywords, false);
        self
    }
}

/// Which rules a chat layer uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatFilterSource {
    /// The rules set in the app, under Settings.
    #[default]
    App,
    /// The layer's own rules.
    Own,
    /// None, apart from the layer's hide switches.
    Off,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleaning_trims_and_dedupes() {
        let r = ChatRules {
            bots: vec![" Nightbot ".into(), "@nightbot".into(), "".into()],
            hide_words: vec![
                "Spoiler".into(),
                " Spoiler".into(),
                "x".repeat(MAX_ENTRY + 1),
            ],
            ..ChatRules::default()
        }
        .cleaned();
        assert_eq!(r.bots, ["nightbot"]);
        assert_eq!(r.hide_words, ["Spoiler"]);
    }

    #[test]
    fn old_projects_get_defaults() {
        let r: ChatRules = serde_json::from_str("{}").unwrap();
        assert!(r.hide_bots && r.bots.contains(&"fossabot".to_string()));
    }
}
