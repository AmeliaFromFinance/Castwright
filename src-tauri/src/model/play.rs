//! Giveaways and the viewer queue: settings, live state and history.

use super::event::UserRoles;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Who may enter a giveaway.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Audience {
    #[default]
    Everyone,
    Followers,
    Subscribers,
}

/// A chat message that can be turned off without losing its text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct ChatLine {
    pub on: bool,
    pub text: String,
}

impl ChatLine {
    fn new(on: bool, text: &str) -> Self {
        ChatLine {
            on,
            text: text.into(),
        }
    }

    /// The text to send, if it's on and not empty.
    pub fn active(&self) -> Option<&str> {
        let t = self.text.trim();
        (self.on && !t.is_empty()).then_some(t)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct EntryRules {
    pub audience: Audience,
    /// Days someone must have followed. 0 = any follower. Only used for followers.
    pub min_follow_days: u32,
    /// Entries a sub gets. 1 = same as everyone.
    pub sub_entries: u32,
    /// Tier 2 subs get twice the sub entries, tier 3 three times.
    pub tier_bonus: bool,
    /// Off: each channel point redemption adds more entries.
    pub one_entry: bool,
    pub exclude_mods: bool,
    pub exclude_broadcaster: bool,
    /// Your bot account and well-known chat bots.
    pub exclude_bots: bool,
}

impl Default for EntryRules {
    fn default() -> Self {
        EntryRules {
            audience: Audience::Everyone,
            min_follow_days: 0,
            sub_entries: 1,
            tier_bonus: false,
            one_entry: true,
            exclude_mods: false,
            exclude_broadcaster: true,
            exclude_bots: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct GiveawayMessages {
    pub opened: ChatLine,
    pub closed: ChatLine,
    pub winner: ChatLine,
    pub reroll: ChatLine,
}

impl Default for GiveawayMessages {
    fn default() -> Self {
        GiveawayMessages {
            opened: ChatLine::new(true, "Giveaway for {{title}} is open! {{how}}"),
            closed: ChatLine::new(true, "Entries are closed. {{entries}} entered. Good luck!"),
            winner: ChatLine::new(
                true,
                "@{{winner}} won {{title}}! Say hi in chat within {{claim_s}} seconds to claim it.",
            ),
            reroll: ChatLine::new(true, "New draw: @{{winner}} won {{title}}!"),
        }
    }
}

/// A giveaway as set up in the form. The last one used is kept in settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct GiveawaySettings {
    /// The prize, shown in chat and on the overlay.
    pub title: String,
    /// Chat word to enter, like `!join`. Empty = no chat entries.
    pub keyword: String,
    /// One of the app's channel point rewards. Empty = no point entries.
    pub reward_id: String,
    pub reward_title: String,
    pub rules: EntryRules,
    /// Close entries after this many minutes. 0 = off.
    pub close_after_min: u32,
    /// Close entries at this many people. 0 = off.
    pub close_after_entries: u32,
    /// Seconds a winner has to chat. 0 = no claim timer.
    pub claim_s: u32,
    pub messages: GiveawayMessages,
}

impl Default for GiveawaySettings {
    fn default() -> Self {
        GiveawaySettings {
            title: String::new(),
            keyword: "!join".into(),
            reward_id: String::new(),
            reward_title: String::new(),
            rules: EntryRules::default(),
            close_after_min: 0,
            close_after_entries: 0,
            claim_s: 60,
            messages: GiveawayMessages::default(),
        }
    }
}

pub const MAX_TITLE: usize = 80;
pub const MAX_WORD: usize = 25;

/// A chat command word: one word, at most 25 characters. Empty is allowed (off).
pub fn word_issue(word: &str) -> Option<&'static str> {
    let w = word.trim();
    if w.is_empty() {
        return None;
    }
    if w.chars().any(char::is_whitespace) {
        return Some("Use one word, like !join.");
    }
    if w.chars().count() > MAX_WORD {
        return Some("Up to 25 characters.");
    }
    None
}

impl GiveawaySettings {
    /// What's wrong with it, in words for the user.
    pub fn check(&self) -> Result<(), String> {
        let title = self.title.trim();
        if title.is_empty() {
            return Err("Say what the prize is.".into());
        }
        if title.chars().count() > MAX_TITLE {
            return Err(format!("The prize can be up to {MAX_TITLE} characters."));
        }
        if let Some(e) = word_issue(&self.keyword) {
            return Err(format!("Keyword: {e}"));
        }
        if self.keyword.trim().is_empty() && self.reward_id.trim().is_empty() {
            return Err(
                "Pick how to enter: a chat keyword, a channel point reward or both.".into(),
            );
        }
        if self.rules.sub_entries == 0 || self.rules.sub_entries > 100 {
            return Err("Sub entries can be 1 to 100.".into());
        }
        if self.claim_s > 3600 {
            return Err("The claim time can be up to an hour.".into());
        }
        Ok(())
    }
}

/// A viewer as giveaways and the queue remember them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct Viewer {
    pub id: String,
    pub login: String,
    pub name: String,
    /// Chat name colour.
    pub color: String,
    /// Badge set ids, like `subscriber`.
    pub badges: Vec<String>,
    /// Badge images, as chat events carry them.
    #[ts(type = "unknown[]")]
    pub badge_images: Vec<serde_json::Value>,
    pub roles: UserRoles,
    /// 0 when not a sub.
    pub sub_tier: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EntryVia {
    #[default]
    Chat,
    Points,
    /// Added by hand.
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Entrant {
    pub viewer: Viewer,
    /// Chances to win.
    pub entries: u32,
    #[ts(type = "number")]
    pub joined_at: i64,
    pub via: EntryVia,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum WinnerState {
    /// Drawn; waiting to chat when there's a claim timer.
    #[default]
    Drawn,
    Claimed,
    /// Didn't chat in time.
    Missed,
    /// Replaced by a new draw.
    Rerolled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WinnerLine {
    #[ts(type = "number")]
    pub ts: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Winner {
    pub viewer: Viewer,
    pub entries: u32,
    #[ts(type = "number")]
    pub drawn_at: i64,
    /// When the claim time runs out.
    #[ts(type = "number | null")]
    pub claim_until: Option<i64>,
    pub state: WinnerState,
    /// Their last chat messages, newest last.
    pub said: Vec<WinnerLine>,
}

impl Winner {
    /// Still counts as a winner.
    pub fn standing(&self) -> bool {
        matches!(self.state, WinnerState::Drawn | WinnerState::Claimed)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Giveaway {
    pub id: String,
    pub settings: GiveawaySettings,
    /// Taking entries.
    pub open: bool,
    #[ts(type = "number")]
    pub opened_at: i64,
    #[ts(type = "number | null")]
    pub closed_at: Option<i64>,
    pub entrants: Vec<Entrant>,
    pub winners: Vec<Winner>,
    /// Counts draws, so overlays can spin once per draw.
    pub draws: u32,
}

impl Giveaway {
    pub fn total_entries(&self) -> u64 {
        self.entrants.iter().map(|e| e.entries as u64).sum()
    }
}

/// A finished (or running) giveaway in the history list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GiveawayRecord {
    pub id: String,
    pub title: String,
    #[ts(type = "number")]
    pub opened_at: i64,
    /// When it was finished; 0 while it runs.
    #[ts(type = "number")]
    pub ended_at: i64,
    /// People who entered.
    pub entrants: u32,
    /// Chances in total.
    #[ts(type = "number")]
    pub entries: u64,
    /// Names of the winners who stand.
    pub winners: Vec<String>,
}

/// How subs move up the queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SubPriority {
    #[default]
    Off,
    /// Subs line up ahead of everyone else.
    First,
    /// Subs have their own line; picks take turns between the two.
    Lane,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct QueueMessages {
    pub joined: ChatLine,
    pub left: ChatLine,
    /// Sent to the players picked.
    pub up: ChatLine,
    /// Reply to the position word.
    pub position: ChatLine,
}

impl Default for QueueMessages {
    fn default() -> Self {
        QueueMessages {
            joined: ChatLine::new(true, "{{name}} joined the queue (#{{position}})"),
            left: ChatLine::new(true, "{{name}} left the queue"),
            up: ChatLine::new(true, "{{players}}, you're up!"),
            position: ChatLine::new(true, "@{{name}} you're #{{position}} in the queue"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct QueueSettings {
    pub join_word: String,
    pub leave_word: String,
    pub position_word: String,
    /// `!join <name>` sets the player's note, like their in-game name.
    pub notes: bool,
    pub sub_priority: SubPriority,
    /// Most people waiting. 0 = no limit.
    pub max_size: u32,
    /// Players "Next" pulls in.
    pub party_size: u32,
    /// Hours the queue is kept after the app closes.
    pub keep_hours: u32,
    pub messages: QueueMessages,
}

impl Default for QueueSettings {
    fn default() -> Self {
        QueueSettings {
            join_word: "!join".into(),
            leave_word: "!leave".into(),
            position_word: "!position".into(),
            notes: true,
            sub_priority: SubPriority::Off,
            max_size: 0,
            party_size: 1,
            keep_hours: 12,
            messages: QueueMessages::default(),
        }
    }
}

impl QueueSettings {
    pub fn check(&self) -> Result<(), String> {
        for (label, w) in [
            ("Join word", &self.join_word),
            ("Leave word", &self.leave_word),
            ("Position word", &self.position_word),
        ] {
            if let Some(e) = word_issue(w) {
                return Err(format!("{label}: {e}"));
            }
        }
        if self.join_word.trim().is_empty() {
            return Err("Viewers need a word to join.".into());
        }
        let words = [&self.join_word, &self.leave_word, &self.position_word];
        for (i, a) in words.iter().enumerate() {
            for b in &words[i + 1..] {
                if !a.trim().is_empty() && same_word(a, b) {
                    return Err("Join, leave and position need different words.".into());
                }
            }
        }
        if !(1..=20).contains(&self.party_size) {
            return Err("Party size can be 1 to 20.".into());
        }
        if self.max_size > 1000 {
            return Err("The queue can hold up to 1000 people.".into());
        }
        if self.keep_hours > 72 {
            return Err("Keep the queue for up to 72 hours.".into());
        }
        Ok(())
    }
}

/// Same command word, ignoring case and a leading `!`.
pub fn same_word(a: &str, b: &str) -> bool {
    let a = a.trim().trim_start_matches('!');
    let b = b.trim().trim_start_matches('!');
    !a.is_empty() && a.eq_ignore_ascii_case(b)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QueueEntry {
    pub viewer: Viewer,
    /// In-game name or anything else to remember.
    pub note: String,
    pub sub: bool,
    #[ts(type = "number")]
    pub joined_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct ViewerQueue {
    /// Taking new people.
    pub open: bool,
    /// Waiting, in the order they were placed. With lanes, `pick_order` interleaves.
    pub waiting: Vec<QueueEntry>,
    pub playing: Vec<QueueEntry>,
    /// With lanes: the sub lane picks next.
    pub sub_turn: bool,
}

/// Everything the Interact page shows for giveaways and the queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlayState {
    pub giveaway: Option<Giveaway>,
    pub giveaway_settings: GiveawaySettings,
    pub queue: ViewerQueue,
    pub queue_settings: QueueSettings,
    /// Ids of waiting people in the order they'll be picked.
    pub queue_order: Vec<String>,
    /// The queue join word is the open giveaway's keyword; the giveaway gets it.
    pub clash: bool,
}
