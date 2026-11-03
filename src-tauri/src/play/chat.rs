//! Reading chat commands and keeping replies within chat limits.

use crate::model::play::same_word;
use std::collections::VecDeque;

/// The first word of `text` and the rest, when the first word is `word`.
pub fn command<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    let text = text.trim();
    let (first, rest) = match text.find(char::is_whitespace) {
        Some(i) => (&text[..i], text[i..].trim()),
        None => (text, ""),
    };
    // A bare word needs its `!` when the setting has one, so plain chat doesn't match.
    let wanted = word.trim();
    if wanted.starts_with('!') && !first.starts_with('!') {
        return None;
    }
    same_word(first, wanted).then_some(rest)
}

/// The queue's join word is the open giveaway's keyword.
pub fn keyword_clash(giveaway_keyword: &str, queue_join: &str, giveaway_open: bool) -> bool {
    giveaway_open && same_word(giveaway_keyword, queue_join)
}

/// "a", "a and b", "a, b and c", "a, b, c and 4 more".
pub fn name_list(names: &[String], max: usize) -> String {
    match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        n if n <= max => format!("{} and {}", names[..n - 1].join(", "), names[n - 1]),
        n => format!("{} and {} more", names[..max].join(", "), n - max),
    }
}

/// Joins that come in quickly are answered together.
#[derive(Debug, Default)]
pub struct ReplyBatch {
    pending: Vec<(String, usize)>,
    since: Option<i64>,
    last_sent: Option<i64>,
}

/// A reply ready to send: names and the place of each.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batched {
    pub names: Vec<String>,
    pub positions: Vec<usize>,
}

impl Batched {
    pub fn name_text(&self) -> String {
        name_list(&self.names, 4)
    }

    /// `3`, or `3–7` for a batch.
    pub fn position_text(&self) -> String {
        let lo = self.positions.iter().min().copied().unwrap_or(0);
        let hi = self.positions.iter().max().copied().unwrap_or(0);
        if lo == hi {
            lo.to_string()
        } else {
            format!("{lo}–{hi}")
        }
    }
}

impl ReplyBatch {
    /// Quiet time after a reply before the next one goes out alone.
    pub const GAP_MS: i64 = 3_000;
    /// How long joins are collected once they start piling up.
    pub const WINDOW_MS: i64 = 5_000;

    /// Someone joined. Returns a reply to send now, or None when it waits for the batch.
    pub fn push(&mut self, name: &str, position: usize, now: i64) -> Option<Batched> {
        let quiet = self.last_sent.is_none_or(|t| now - t >= Self::GAP_MS);
        if self.pending.is_empty() && quiet {
            self.last_sent = Some(now);
            return Some(Batched {
                names: vec![name.to_string()],
                positions: vec![position],
            });
        }
        if self.pending.is_empty() {
            self.since = Some(now);
        }
        self.pending.push((name.to_string(), position));
        None
    }

    /// The collected joins, once the window has passed.
    pub fn due(&mut self, now: i64) -> Option<Batched> {
        let since = self.since?;
        if now - since < Self::WINDOW_MS || self.pending.is_empty() {
            return None;
        }
        let (names, positions) = std::mem::take(&mut self.pending).into_iter().unzip();
        self.since = None;
        self.last_sent = Some(now);
        Some(Batched { names, positions })
    }
}

/// Twitch lets a normal account post 20 messages in 30 seconds. Replies stay
/// well under that so commands and alerts still get through.
#[derive(Debug, Default)]
pub struct ChatBudget {
    sent: VecDeque<i64>,
}

impl ChatBudget {
    pub const LIMIT: usize = 10;
    pub const WINDOW_MS: i64 = 30_000;

    /// Takes a slot if one is free.
    pub fn take(&mut self, now: i64) -> bool {
        while self
            .sent
            .front()
            .is_some_and(|t| now - t >= Self::WINDOW_MS)
        {
            self.sent.pop_front();
        }
        if self.sent.len() >= Self::LIMIT {
            return false;
        }
        self.sent.push_back(now);
        true
    }
}
