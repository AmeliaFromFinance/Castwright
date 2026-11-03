//! Viewer queue order and picks, without any I/O.

use crate::model::play::{QueueEntry, QueueSettings, SubPriority, Viewer, ViewerQueue};
use rand::Rng;
use rand::seq::SliceRandom;

pub const MAX_NOTE: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Joined {
    /// Position from 1.
    Added(usize),
    /// Already waiting; the note was changed.
    NoteChanged(usize),
    Already(usize),
    /// Playing right now.
    Playing,
    Full,
    Closed,
}

pub fn clean_note(note: &str) -> String {
    let n: String = note.trim().chars().take(MAX_NOTE).collect();
    n.trim().to_string()
}

pub fn join(q: &mut ViewerQueue, s: &QueueSettings, v: Viewer, note: &str, now: i64) -> Joined {
    let note = if s.notes {
        clean_note(note)
    } else {
        String::new()
    };
    if let Some(e) = q.waiting.iter_mut().find(|e| e.viewer.id == v.id) {
        let changed = !note.is_empty() && e.note != note;
        if changed {
            e.note = note;
        }
        let pos = position(q, s, &v.id).unwrap_or(0);
        return if changed {
            Joined::NoteChanged(pos)
        } else {
            Joined::Already(pos)
        };
    }
    if q.playing.iter().any(|e| e.viewer.id == v.id) {
        return Joined::Playing;
    }
    if !q.open {
        return Joined::Closed;
    }
    if s.max_size > 0 && q.waiting.len() as u32 >= s.max_size {
        return Joined::Full;
    }
    let sub = v.sub_tier > 0 || v.roles.subscriber;
    let id = v.id.clone();
    let entry = QueueEntry {
        viewer: v,
        note,
        sub,
        joined_at: now,
    };
    if s.sub_priority == SubPriority::First && sub {
        let at = q.waiting.iter().rposition(|e| e.sub).map_or(0, |i| i + 1);
        q.waiting.insert(at, entry);
    } else {
        q.waiting.push(entry);
    }
    Joined::Added(position(q, s, &id).unwrap_or(q.waiting.len()))
}

pub fn leave(q: &mut ViewerQueue, user_id: &str) -> bool {
    let before = q.waiting.len();
    q.waiting.retain(|e| e.viewer.id != user_id);
    q.waiting.len() != before
}

/// Indexes into `waiting` in the order they'll be picked.
pub fn pick_order(q: &ViewerQueue, s: &QueueSettings) -> Vec<usize> {
    if s.sub_priority != SubPriority::Lane {
        return (0..q.waiting.len()).collect();
    }
    let subs: Vec<usize> = (0..q.waiting.len()).filter(|&i| q.waiting[i].sub).collect();
    let rest: Vec<usize> = (0..q.waiting.len())
        .filter(|&i| !q.waiting[i].sub)
        .collect();
    let (mut a, mut b) = if q.sub_turn {
        (subs.into_iter(), rest.into_iter())
    } else {
        (rest.into_iter(), subs.into_iter())
    };
    let mut out = Vec::with_capacity(q.waiting.len());
    loop {
        match (a.next(), b.next()) {
            (None, None) => break,
            (x, y) => out.extend(x.into_iter().chain(y)),
        }
    }
    out
}

/// Place in line from 1.
pub fn position(q: &ViewerQueue, s: &QueueSettings, user_id: &str) -> Option<usize> {
    pick_order(q, s)
        .iter()
        .position(|&i| q.waiting[i].viewer.id == user_id)
        .map(|p| p + 1)
}

/// Ids of waiting people in pick order.
pub fn order_ids(q: &ViewerQueue, s: &QueueSettings) -> Vec<String> {
    pick_order(q, s)
        .into_iter()
        .map(|i| q.waiting[i].viewer.id.clone())
        .collect()
}

fn take(q: &mut ViewerQueue, mut idx: Vec<usize>) -> Vec<QueueEntry> {
    let picked: Vec<QueueEntry> = idx.iter().map(|&i| q.waiting[i].clone()).collect();
    idx.sort_unstable_by(|a, b| b.cmp(a));
    for i in idx {
        q.waiting.remove(i);
    }
    picked
}

/// The next `n` in line become the players; the last group is done.
pub fn next(q: &mut ViewerQueue, s: &QueueSettings, n: u32) -> Vec<QueueEntry> {
    let order = pick_order(q, s);
    let count = (n.max(1) as usize).min(order.len());
    if s.sub_priority == SubPriority::Lane && count > 0 {
        // The lane that didn't pick last goes first next time.
        let last = order[count - 1];
        q.sub_turn = !q.waiting[last].sub;
    }
    let picked = take(q, order[..count].to_vec());
    q.playing = picked.clone();
    picked
}

/// `n` random people from the line become the players.
pub fn random<R: Rng + ?Sized>(q: &mut ViewerQueue, n: u32, rng: &mut R) -> Vec<QueueEntry> {
    let mut idx: Vec<usize> = (0..q.waiting.len()).collect();
    idx.shuffle(rng);
    idx.truncate(n.max(1) as usize);
    let picked = take(q, idx);
    q.playing = picked.clone();
    picked
}

/// Moves `user_id` in front of `before`, or to the end when `before` is None.
pub fn move_before(q: &mut ViewerQueue, user_id: &str, before: Option<&str>) -> bool {
    let Some(from) = q.waiting.iter().position(|e| e.viewer.id == user_id) else {
        return false;
    };
    if before == Some(user_id) {
        return true;
    }
    let entry = q.waiting.remove(from);
    let at = before
        .and_then(|b| q.waiting.iter().position(|e| e.viewer.id == b))
        .unwrap_or(q.waiting.len());
    q.waiting.insert(at, entry);
    true
}

pub fn set_note(q: &mut ViewerQueue, user_id: &str, note: &str) -> bool {
    let note = clean_note(note);
    match q
        .waiting
        .iter_mut()
        .chain(q.playing.iter_mut())
        .find(|e| e.viewer.id == user_id)
    {
        Some(e) => {
            e.note = note;
            true
        }
        None => false,
    }
}

pub fn remove(q: &mut ViewerQueue, user_id: &str) -> bool {
    let before = q.waiting.len() + q.playing.len();
    q.waiting.retain(|e| e.viewer.id != user_id);
    q.playing.retain(|e| e.viewer.id != user_id);
    q.waiting.len() + q.playing.len() != before
}
