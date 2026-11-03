//! Giveaway rules and draws, without any I/O.

use crate::model::play::{
    Audience, Entrant, EntryRules, EntryVia, Giveaway, Viewer, Winner, WinnerLine, WinnerState,
};
use rand::Rng;

/// Chat bots most channels use. Matched on login.
const KNOWN_BOTS: [&str; 14] = [
    "nightbot",
    "streamelements",
    "streamlabs",
    "moobot",
    "fossabot",
    "wizebot",
    "sery_bot",
    "soundalerts",
    "botrixoficial",
    "kofistreambot",
    "pokemoncommunitygame",
    "commanderroot",
    "blerp",
    "streamstickers",
];

/// Lines of chat kept per winner.
const SAID_KEEP: usize = 5;
const DAY_MS: i64 = 24 * 3600 * 1000;

pub fn is_known_bot(login: &str) -> bool {
    KNOWN_BOTS
        .iter()
        .any(|b| b.eq_ignore_ascii_case(login.trim()))
}

/// Why someone can't enter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Excluded,
    NotFollowing,
    FollowTooNew,
    NotSub,
}

/// What we know about whether someone follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Follow {
    /// Couldn't check; let them in.
    Unknown,
    No,
    Since(i64),
}

/// Whether `v` may enter under `rules`. `bot_login` is the app's own bot account.
pub fn check_entry(
    rules: &EntryRules,
    v: &Viewer,
    follow: Follow,
    bot_login: &str,
    now: i64,
) -> Result<(), Refusal> {
    let bot = is_known_bot(&v.login)
        || (!bot_login.is_empty() && v.login.eq_ignore_ascii_case(bot_login));
    if (rules.exclude_broadcaster && v.roles.broadcaster)
        || (rules.exclude_mods && v.roles.moderator && !v.roles.broadcaster)
        || (rules.exclude_bots && bot)
    {
        return Err(Refusal::Excluded);
    }
    match rules.audience {
        Audience::Everyone => Ok(()),
        Audience::Subscribers if v.sub_tier > 0 || v.roles.subscriber || v.roles.broadcaster => {
            Ok(())
        }
        Audience::Subscribers => Err(Refusal::NotSub),
        Audience::Followers if v.roles.broadcaster => Ok(()),
        Audience::Followers => match follow {
            Follow::Unknown => Ok(()),
            Follow::No => Err(Refusal::NotFollowing),
            Follow::Since(at) => {
                if now - at >= rules.min_follow_days as i64 * DAY_MS {
                    Ok(())
                } else {
                    Err(Refusal::FollowTooNew)
                }
            }
        },
    }
}

/// Chances one entry gives `v`.
pub fn entries_for(rules: &EntryRules, v: &Viewer) -> u32 {
    let tier = if v.sub_tier > 0 {
        v.sub_tier
    } else if v.roles.subscriber {
        1
    } else {
        0
    };
    if tier == 0 {
        return 1;
    }
    let base = rules.sub_entries.clamp(1, 100);
    if rules.tier_bonus {
        base * tier.clamp(1, 3) as u32
    } else {
        base
    }
}

/// What happened when someone tried to enter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entered {
    New,
    /// Already in; more chances added (repeat redemptions).
    More,
    /// Already in; nothing changed.
    Already,
    Closed,
}

/// Adds `v`, or adds chances for a repeat redemption when that's allowed.
pub fn enter(g: &mut Giveaway, v: Viewer, via: EntryVia, now: i64) -> Entered {
    if !g.open {
        return Entered::Closed;
    }
    let add = entries_for(&g.settings.rules, &v);
    if let Some(e) = g.entrants.iter_mut().find(|e| e.viewer.id == v.id) {
        if via == EntryVia::Points && !g.settings.rules.one_entry {
            e.entries = e.entries.saturating_add(add);
            return Entered::More;
        }
        return Entered::Already;
    }
    g.entrants.push(Entrant {
        viewer: v,
        entries: add,
        joined_at: now,
        via,
    });
    Entered::New
}

/// Index into `weights`, each chosen in proportion to its weight. None when all are 0.
pub fn pick_weighted<R: Rng + ?Sized>(weights: &[u32], rng: &mut R) -> Option<usize> {
    let total: u64 = weights.iter().map(|w| *w as u64).sum();
    if total == 0 {
        return None;
    }
    let mut r = rng.random_range(0..total);
    for (i, w) in weights.iter().enumerate() {
        let w = *w as u64;
        if r < w {
            return Some(i);
        }
        r -= w;
    }
    None
}

/// Draws up to `count` new winners. People who already won (or were re-rolled)
/// can't win again. Returns how many were drawn.
pub fn draw<R: Rng + ?Sized>(g: &mut Giveaway, count: u32, now: i64, rng: &mut R) -> usize {
    let mut drawn = 0;
    for _ in 0..count.max(1) {
        let pool: Vec<usize> = (0..g.entrants.len())
            .filter(|&i| {
                let id = &g.entrants[i].viewer.id;
                !g.winners.iter().any(|w| &w.viewer.id == id)
            })
            .collect();
        let weights: Vec<u32> = pool.iter().map(|&i| g.entrants[i].entries).collect();
        let Some(k) = pick_weighted(&weights, rng) else {
            break;
        };
        let e = &g.entrants[pool[k]];
        let claim_s = g.settings.claim_s;
        g.winners.push(Winner {
            viewer: e.viewer.clone(),
            entries: e.entries,
            drawn_at: now,
            claim_until: (claim_s > 0).then(|| now + claim_s as i64 * 1000),
            state: WinnerState::Drawn,
            said: Vec::new(),
        });
        drawn += 1;
    }
    if drawn > 0 {
        g.draws += 1;
    }
    drawn
}

/// Replaces winner `user_id` with a new draw. Returns false when there's no
/// such winner or nobody is left to draw.
pub fn reroll<R: Rng + ?Sized>(g: &mut Giveaway, user_id: &str, now: i64, rng: &mut R) -> bool {
    let Some(w) = g
        .winners
        .iter_mut()
        .find(|w| w.viewer.id == user_id && w.state != WinnerState::Rerolled)
    else {
        return false;
    };
    w.state = WinnerState::Rerolled;
    w.claim_until = None;
    draw(g, 1, now, rng) == 1
}

/// Marks a winner as claimed by hand, late ones too.
pub fn claim(g: &mut Giveaway, user_id: &str) -> bool {
    match g
        .winners
        .iter_mut()
        .find(|w| w.viewer.id == user_id && w.state != WinnerState::Rerolled)
    {
        Some(w) => {
            w.state = WinnerState::Claimed;
            w.claim_until = None;
            true
        }
        None => false,
    }
}

/// A chat message from a winner: kept to show, and a claim when the timer runs.
/// Returns true when it claimed the prize.
pub fn winner_chat(g: &mut Giveaway, user_id: &str, text: &str, now: i64) -> bool {
    let mut claimed = false;
    for w in g.winners.iter_mut().filter(|w| w.viewer.id == user_id) {
        if w.state != WinnerState::Rerolled {
            w.said.push(WinnerLine {
                ts: now,
                text: text.to_string(),
            });
            if w.said.len() > SAID_KEEP {
                w.said.remove(0);
            }
        }
        if w.state == WinnerState::Drawn && w.claim_until.is_some_and(|until| now <= until) {
            w.state = WinnerState::Claimed;
            w.claim_until = None;
            claimed = true;
        }
    }
    claimed
}

/// Winners whose claim time ran out are marked missed. Returns their names.
pub fn expire_claims(g: &mut Giveaway, now: i64) -> Vec<String> {
    let mut out = Vec::new();
    for w in &mut g.winners {
        if w.state == WinnerState::Drawn && w.claim_until.is_some_and(|until| now > until) {
            w.state = WinnerState::Missed;
            w.claim_until = None;
            out.push(w.viewer.name.clone());
        }
    }
    out
}

/// Names for the overlay to spin through, ending on `winner`.
pub fn reel<R: Rng + ?Sized>(g: &Giveaway, winner: &str, len: usize, rng: &mut R) -> Vec<String> {
    let names: Vec<&str> = g
        .entrants
        .iter()
        .map(|e| e.viewer.name.as_str())
        .filter(|n| *n != winner)
        .collect();
    let mut out = Vec::with_capacity(len);
    if !names.is_empty() {
        for _ in 0..len.saturating_sub(1) {
            let mut n = names[rng.random_range(0..names.len())];
            // Avoid the same name twice in a row when there's a choice.
            if names.len() > 1 && out.last().is_some_and(|l: &String| l == n) {
                n = names[rng.random_range(0..names.len())];
            }
            out.push(n.to_string());
        }
    }
    out.push(winner.to_string());
    out
}

/// Whether entries should close now: the time or people limit was reached.
pub fn should_close(g: &Giveaway, now: i64) -> bool {
    if !g.open {
        return false;
    }
    let s = &g.settings;
    (s.close_after_min > 0 && now - g.opened_at >= s.close_after_min as i64 * 60_000)
        || (s.close_after_entries > 0 && g.entrants.len() as u32 >= s.close_after_entries)
}
