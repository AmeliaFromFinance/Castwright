use super::chat::{Batched, ChatBudget, ReplyBatch, command, keyword_clash, name_list};
use super::giveaway::{self, Follow, Refusal};
use super::queue::{self, Joined};
use super::*;
use crate::model::event::UserRoles;
use crate::model::play::{EntryRules, QueueSettings, SubPriority, WinnerState};
use crate::services::Recorder;
use rand::SeedableRng;
use rand::rngs::StdRng;

const DAY: i64 = 24 * 3600 * 1000;

fn viewer(id: &str) -> Viewer {
    Viewer {
        id: id.into(),
        login: id.into(),
        name: id.to_uppercase(),
        ..Viewer::default()
    }
}

fn sub(id: &str, tier: u8) -> Viewer {
    let mut v = viewer(id);
    v.sub_tier = tier;
    v.roles.subscriber = true;
    v
}

fn giveaway_with(rules: EntryRules) -> Giveaway {
    Giveaway {
        id: "g".into(),
        settings: GiveawaySettings {
            title: "A game key".into(),
            rules,
            ..GiveawaySettings::default()
        },
        open: true,
        opened_at: 0,
        closed_at: None,
        entrants: Vec::new(),
        winners: Vec::new(),
        draws: 0,
    }
}

#[test]
fn entry_rules() {
    let now = 100 * DAY;
    let mut rules = EntryRules::default();
    let ok = |r: &EntryRules, v: &Viewer, f: Follow| giveaway::check_entry(r, v, f, "mybot", now);

    assert_eq!(ok(&rules, &viewer("a"), Follow::No), Ok(()));
    let mut caster = viewer("me");
    caster.roles.broadcaster = true;
    assert_eq!(ok(&rules, &caster, Follow::No), Err(Refusal::Excluded));
    assert_eq!(
        ok(&rules, &viewer("nightbot"), Follow::No),
        Err(Refusal::Excluded)
    );
    assert_eq!(
        ok(&rules, &viewer("MyBot"), Follow::No),
        Err(Refusal::Excluded)
    );
    let mut m = viewer("m");
    m.roles.moderator = true;
    assert_eq!(ok(&rules, &m, Follow::No), Ok(()));
    rules.exclude_mods = true;
    assert_eq!(ok(&rules, &m, Follow::No), Err(Refusal::Excluded));
    rules.exclude_bots = false;
    assert_eq!(ok(&rules, &viewer("nightbot"), Follow::No), Ok(()));

    rules.audience = Audience::Followers;
    rules.min_follow_days = 7;
    assert_eq!(
        ok(&rules, &viewer("a"), Follow::No),
        Err(Refusal::NotFollowing)
    );
    assert_eq!(
        ok(&rules, &viewer("a"), Follow::Since(now - 2 * DAY)),
        Err(Refusal::FollowTooNew)
    );
    assert_eq!(
        ok(&rules, &viewer("a"), Follow::Since(now - 8 * DAY)),
        Ok(())
    );
    assert_eq!(
        ok(&rules, &viewer("a"), Follow::Unknown),
        Ok(()),
        "lookups that fail let people in"
    );

    rules.audience = Audience::Subscribers;
    assert_eq!(
        ok(&rules, &viewer("a"), Follow::Unknown),
        Err(Refusal::NotSub)
    );
    assert_eq!(ok(&rules, &sub("s", 1), Follow::No), Ok(()));
}

#[test]
fn sub_entries_and_tiers() {
    let mut rules = EntryRules {
        sub_entries: 2,
        ..EntryRules::default()
    };
    assert_eq!(giveaway::entries_for(&rules, &viewer("a")), 1);
    assert_eq!(giveaway::entries_for(&rules, &sub("b", 3)), 2);
    rules.tier_bonus = true;
    assert_eq!(giveaway::entries_for(&rules, &sub("b", 1)), 2);
    assert_eq!(giveaway::entries_for(&rules, &sub("b", 2)), 4);
    assert_eq!(giveaway::entries_for(&rules, &sub("b", 3)), 6);
}

#[test]
fn one_entry_per_person_unless_redemptions_stack() {
    let mut g = giveaway_with(EntryRules::default());
    assert_eq!(
        giveaway::enter(&mut g, viewer("a"), EntryVia::Chat, 1),
        Entered::New
    );
    assert_eq!(
        giveaway::enter(&mut g, viewer("a"), EntryVia::Chat, 2),
        Entered::Already
    );
    assert_eq!(
        giveaway::enter(&mut g, viewer("a"), EntryVia::Points, 3),
        Entered::Already
    );
    g.settings.rules.one_entry = false;
    assert_eq!(
        giveaway::enter(&mut g, viewer("a"), EntryVia::Points, 4),
        Entered::More
    );
    assert_eq!(g.entrants.len(), 1);
    assert_eq!(g.entrants[0].entries, 2);
    g.open = false;
    assert_eq!(
        giveaway::enter(&mut g, viewer("b"), EntryVia::Chat, 5),
        Entered::Closed
    );
}

#[test]
fn weighted_draw_follows_the_weights() {
    let mut rng = StdRng::seed_from_u64(7);
    let weights = [1u32, 2, 7, 0];
    let mut hits = [0u32; 4];
    let n = 100_000;
    for _ in 0..n {
        hits[giveaway::pick_weighted(&weights, &mut rng).unwrap()] += 1;
    }
    assert_eq!(hits[3], 0, "no chances, never picked");
    for (i, want) in [0.1, 0.2, 0.7].iter().enumerate() {
        let got = hits[i] as f64 / n as f64;
        assert!((got - want).abs() < 0.01, "#{i}: {got} vs {want}");
    }
    assert_eq!(giveaway::pick_weighted(&[0, 0], &mut rng), None);
    assert_eq!(giveaway::pick_weighted(&[], &mut rng), None);
}

#[test]
fn several_winners_are_different_people() {
    let mut rng = StdRng::seed_from_u64(1);
    let mut g = giveaway_with(EntryRules {
        sub_entries: 5,
        ..EntryRules::default()
    });
    for id in ["a", "b", "c"] {
        giveaway::enter(&mut g, viewer(id), EntryVia::Chat, 0);
    }
    giveaway::enter(&mut g, sub("d", 1), EntryVia::Chat, 0);
    assert_eq!(giveaway::draw(&mut g, 3, 10, &mut rng), 3);
    let mut ids: Vec<_> = g.winners.iter().map(|w| w.viewer.id.clone()).collect();
    ids.dedup();
    assert_eq!(ids.len(), 3);
    assert_eq!(g.draws, 1);
    assert_eq!(giveaway::draw(&mut g, 5, 11, &mut rng), 1, "only one left");
    assert_eq!(giveaway::draw(&mut g, 1, 12, &mut rng), 0);
    let reel = giveaway::reel(&g, "A", 20, &mut rng);
    assert_eq!(reel.len(), 20);
    assert_eq!(reel.last().unwrap(), "A");
}

#[test]
fn reroll_replaces_the_winner() {
    let mut rng = StdRng::seed_from_u64(3);
    let mut g = giveaway_with(EntryRules::default());
    for id in ["a", "b"] {
        giveaway::enter(&mut g, viewer(id), EntryVia::Chat, 0);
    }
    giveaway::draw(&mut g, 1, 10, &mut rng);
    let first = g.winners[0].viewer.id.clone();
    assert!(giveaway::reroll(&mut g, &first, 20, &mut rng));
    assert_eq!(g.winners[0].state, WinnerState::Rerolled);
    assert_ne!(g.winners[1].viewer.id, first);
    assert_eq!(g.draws, 2);
    let second = g.winners[1].viewer.id.clone();
    assert!(
        !giveaway::reroll(&mut g, &second, 30, &mut rng),
        "nobody left"
    );
    assert!(!giveaway::reroll(&mut g, "nobody", 30, &mut rng));
}

#[test]
fn claim_timer() {
    let mut rng = StdRng::seed_from_u64(5);
    let mut g = giveaway_with(EntryRules::default());
    g.settings.claim_s = 30;
    for id in ["a", "b"] {
        giveaway::enter(&mut g, viewer(id), EntryVia::Chat, 0);
    }
    giveaway::draw(&mut g, 2, 1_000, &mut rng);
    let (w1, w2) = (
        g.winners[0].viewer.id.clone(),
        g.winners[1].viewer.id.clone(),
    );
    assert_eq!(g.winners[0].claim_until, Some(31_000));

    assert!(giveaway::winner_chat(&mut g, &w1, "here!", 20_000));
    assert_eq!(g.winners[0].state, WinnerState::Claimed);
    assert_eq!(g.winners[0].said[0].text, "here!");
    assert!(
        giveaway::expire_claims(&mut g, 31_000).is_empty(),
        "not past the time yet"
    );
    assert_eq!(
        giveaway::expire_claims(&mut g, 31_001),
        vec![w2.to_uppercase()]
    );
    assert_eq!(g.winners[1].state, WinnerState::Missed);
    assert!(
        !giveaway::winner_chat(&mut g, &w2, "oops", 40_000),
        "too late to claim"
    );
    assert_eq!(g.winners[1].said.len(), 1, "still shown");
    assert!(
        giveaway::claim(&mut g, &w2),
        "can be marked claimed by hand"
    );

    g.settings.claim_s = 0;
    giveaway::enter(&mut g, viewer("c"), EntryVia::Chat, 0);
    giveaway::draw(&mut g, 1, 50_000, &mut rng);
    assert_eq!(g.winners[2].claim_until, None);
    assert!(giveaway::expire_claims(&mut g, i64::MAX).is_empty());
}

#[test]
fn auto_close() {
    let mut g = giveaway_with(EntryRules::default());
    assert!(!giveaway::should_close(&g, i64::MAX));
    g.settings.close_after_min = 5;
    assert!(!giveaway::should_close(&g, 299_999));
    assert!(giveaway::should_close(&g, 300_000));
    g.settings.close_after_min = 0;
    g.settings.close_after_entries = 2;
    giveaway::enter(&mut g, viewer("a"), EntryVia::Chat, 0);
    assert!(!giveaway::should_close(&g, 0));
    giveaway::enter(&mut g, viewer("b"), EntryVia::Chat, 0);
    assert!(giveaway::should_close(&g, 0));
}

#[test]
fn commands_and_keyword_clash() {
    assert_eq!(command("!join", "!join"), Some(""));
    assert_eq!(command("!JOIN  Kat#123 ", "!join"), Some("Kat#123"));
    assert_eq!(command("join", "!join"), None, "the ! is needed when set");
    assert_eq!(command("!joined", "!join"), None);
    assert_eq!(command("enter now", "enter"), Some("now"));
    assert_eq!(command("!join", ""), None);

    assert!(keyword_clash("!join", "!JOIN", true));
    assert!(keyword_clash("join", "!join", true));
    assert!(
        !keyword_clash("!join", "!join", false),
        "only while the giveaway is open"
    );
    assert!(!keyword_clash("!enter", "!join", true));
    assert!(!keyword_clash("", "", true));
}

#[test]
fn settings_checks() {
    let mut g = GiveawaySettings {
        title: "Prize".into(),
        ..GiveawaySettings::default()
    };
    assert!(g.check().is_ok());
    g.keyword = "two words".into();
    assert!(g.check().is_err());
    g.keyword = String::new();
    assert!(g.check().is_err(), "needs a way to enter");
    g.reward_id = "r1".into();
    assert!(g.check().is_ok());
    g.title = " ".into();
    assert!(g.check().is_err());

    let mut q = QueueSettings::default();
    assert!(q.check().is_ok());
    q.leave_word = "!JOIN".into();
    assert!(q.check().is_err());
    q.leave_word = "!leave".into();
    q.party_size = 0;
    assert!(q.check().is_err());
}

fn qs(priority: SubPriority) -> QueueSettings {
    QueueSettings {
        sub_priority: priority,
        ..QueueSettings::default()
    }
}

fn open_queue() -> ViewerQueue {
    ViewerQueue {
        open: true,
        ..ViewerQueue::default()
    }
}

fn names(q: &ViewerQueue, s: &QueueSettings) -> Vec<String> {
    queue::order_ids(q, s)
}

#[test]
fn queue_order_and_notes() {
    let s = qs(SubPriority::Off);
    let mut q = ViewerQueue::default();
    assert_eq!(queue::join(&mut q, &s, viewer("a"), "", 1), Joined::Closed);
    q.open = true;
    assert_eq!(
        queue::join(&mut q, &s, viewer("a"), "", 1),
        Joined::Added(1)
    );
    assert_eq!(
        queue::join(&mut q, &s, sub("b", 1), "Kat#1", 2),
        Joined::Added(2)
    );
    assert_eq!(
        queue::join(&mut q, &s, viewer("c"), "", 3),
        Joined::Added(3)
    );
    assert_eq!(
        queue::join(&mut q, &s, viewer("a"), "", 4),
        Joined::Already(1)
    );
    assert_eq!(
        queue::join(&mut q, &s, viewer("a"), "Ann", 5),
        Joined::NoteChanged(1)
    );
    assert_eq!(q.waiting[0].note, "Ann");
    assert_eq!(q.waiting[1].note, "Kat#1");
    assert_eq!(queue::position(&q, &s, "c"), Some(3));
    assert_eq!(queue::position(&q, &s, "x"), None);

    assert!(queue::move_before(&mut q, "c", Some("a")));
    assert_eq!(names(&q, &s), ["c", "a", "b"]);
    assert!(queue::move_before(&mut q, "c", None));
    assert_eq!(names(&q, &s), ["a", "b", "c"]);
    assert!(queue::leave(&mut q, "b"));
    assert!(!queue::leave(&mut q, "b"));
    assert_eq!(names(&q, &s), ["a", "c"]);

    let mut full = QueueSettings {
        max_size: 2,
        ..s.clone()
    };
    assert_eq!(queue::join(&mut q, &full, viewer("d"), "", 6), Joined::Full);
    full.notes = false;
    full.max_size = 0;
    assert_eq!(
        queue::join(&mut q, &full, viewer("d"), "ign", 6),
        Joined::Added(3)
    );
    assert_eq!(q.waiting[2].note, "", "notes off");
    let long = "x".repeat(100);
    queue::set_note(&mut q, "a", &long);
    assert_eq!(q.waiting[0].note.len(), queue::MAX_NOTE);
}

#[test]
fn subs_first() {
    let s = qs(SubPriority::First);
    let mut q = open_queue();
    queue::join(&mut q, &s, viewer("a"), "", 1);
    queue::join(&mut q, &s, viewer("b"), "", 2);
    assert_eq!(
        queue::join(&mut q, &s, sub("s1", 1), "", 3),
        Joined::Added(1)
    );
    assert_eq!(
        queue::join(&mut q, &s, sub("s2", 3), "", 4),
        Joined::Added(2)
    );
    assert_eq!(names(&q, &s), ["s1", "s2", "a", "b"]);
}

#[test]
fn sub_lane_takes_turns() {
    let s = QueueSettings {
        party_size: 1,
        ..qs(SubPriority::Lane)
    };
    let mut q = open_queue();
    for id in ["a", "b", "c"] {
        queue::join(&mut q, &s, viewer(id), "", 1);
    }
    queue::join(&mut q, &s, sub("s1", 1), "", 2);
    queue::join(&mut q, &s, sub("s2", 1), "", 3);
    assert!(!q.sub_turn);
    assert_eq!(names(&q, &s), ["a", "s1", "b", "s2", "c"]);
    q.sub_turn = true;
    assert_eq!(names(&q, &s), ["s1", "a", "s2", "b", "c"]);
    assert_eq!(queue::position(&q, &s, "c"), Some(5));

    let picked = queue::next(&mut q, &s, 1);
    assert_eq!(picked[0].viewer.id, "s1");
    assert!(!q.sub_turn, "everyone lane next");
    assert_eq!(queue::next(&mut q, &s, 1)[0].viewer.id, "a");
    assert!(q.sub_turn);
    let two: Vec<_> = queue::next(&mut q, &s, 2)
        .into_iter()
        .map(|e| e.viewer.id)
        .collect();
    assert_eq!(two, ["s2", "b"]);
    assert_eq!(queue::next(&mut q, &s, 1)[0].viewer.id, "c");
    assert!(q.waiting.is_empty());
}

#[test]
fn party_pulls() {
    let s = QueueSettings {
        party_size: 3,
        ..qs(SubPriority::Off)
    };
    let mut q = open_queue();
    for id in ["a", "b", "c", "d"] {
        queue::join(&mut q, &s, viewer(id), "", 1);
    }
    let picked = queue::next(&mut q, &s, s.party_size);
    assert_eq!(picked.len(), 3);
    assert_eq!(q.playing.len(), 3);
    assert_eq!(names(&q, &s), ["d"]);
    assert_eq!(queue::join(&mut q, &s, viewer("a"), "", 2), Joined::Playing);
    let picked = queue::next(&mut q, &s, 3);
    assert_eq!(picked.len(), 1, "fewer left than a party");
    assert_eq!(q.playing.len(), 1, "the last group is done");

    for id in ["e", "f", "g"] {
        queue::join(&mut q, &s, viewer(id), "", 3);
    }
    let mut rng = StdRng::seed_from_u64(2);
    let picked = queue::random(&mut q, 2, &mut rng);
    assert_eq!(picked.len(), 2);
    assert_eq!(q.waiting.len(), 1);
    assert!(queue::remove(&mut q, &picked[0].viewer.id));
    assert_eq!(q.playing.len(), 1);
}

#[test]
fn join_replies_batch_up() {
    let mut b = ReplyBatch::default();
    let one = b.push("A", 1, 0).unwrap();
    assert_eq!(one.name_text(), "A");
    assert_eq!(one.position_text(), "1");
    // A burst right after waits for the window.
    for (i, n) in ["B", "C", "D", "E", "F", "G"].iter().enumerate() {
        assert!(b.push(n, i + 2, 500 + i as i64 * 100).is_none());
    }
    assert!(b.due(500 + ReplyBatch::WINDOW_MS - 1).is_none());
    let batch = b.due(500 + ReplyBatch::WINDOW_MS).unwrap();
    assert_eq!(
        batch,
        Batched {
            names: ["B", "C", "D", "E", "F", "G"].map(String::from).to_vec(),
            positions: vec![2, 3, 4, 5, 6, 7]
        }
    );
    assert_eq!(batch.name_text(), "B, C, D, E and 2 more");
    assert_eq!(batch.position_text(), "2–7");
    assert!(b.due(i64::MAX).is_none());
    // Quiet again: the next one goes out alone.
    assert!(
        b.push("H", 8, 500 + ReplyBatch::WINDOW_MS + ReplyBatch::GAP_MS)
            .is_some()
    );

    assert_eq!(name_list(&["a".into(), "b".into()], 4), "a and b");
    assert_eq!(name_list(&[], 4), "");
}

#[test]
fn chat_budget() {
    let mut b = ChatBudget::default();
    for _ in 0..ChatBudget::LIMIT {
        assert!(b.take(0));
    }
    assert!(!b.take(1_000));
    assert!(b.take(ChatBudget::WINDOW_MS));
}

// ---------- the service ----------

fn chat_event(id: &str, text: &str) -> Event {
    let mut e = Event::new(EventKind::Chat).with_user(id, &id.to_uppercase());
    e.user.as_mut().unwrap().id = id.into();
    e.message = Some(text.into());
    e
}

struct Rig {
    play: Arc<PlayService>,
    rec: Arc<Recorder>,
    _dir: tempfile::TempDir,
    file: PathBuf,
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let settings = Arc::new(SettingsStore::open(dir.path().join("settings.json")));
    let file = dir.path().join("play.json");
    let play = PlayService::new(Hub::test(), settings, Some(file.clone()));
    let rec = Arc::new(Recorder::default());
    play.set_twitch(rec.clone());
    play.start();
    Rig {
        play,
        rec,
        _dir: dir,
        file,
    }
}

async fn chat_out(rec: &Recorder) -> Vec<String> {
    tokio::time::sleep(Duration::from_millis(50)).await;
    rec.take()
}

#[tokio::test]
async fn a_giveaway_from_chat() {
    let r = rig();
    let p = &r.play;
    p.open_giveaway(GiveawaySettings {
        title: "Mouse".into(),
        ..GiveawaySettings::default()
    })
    .unwrap();
    assert!(p.open_giveaway(GiveawaySettings::default()).is_err());
    let out = chat_out(&r.rec).await;
    assert_eq!(
        out,
        ["chat bot=true reply=false Giveaway for Mouse is open! Type !join to enter."]
    );

    p.on_event(&chat_event("a", "!join")).await;
    p.on_event(&chat_event("b", "!join please")).await;
    p.on_event(&chat_event("b", "!join")).await;
    p.on_event(&chat_event("c", "join")).await;
    let mut own = chat_event("d", "!join");
    own.data.insert("sent_by_castwright".into(), true.into());
    p.on_event(&own).await;
    p.on_event(&chat_event("nightbot", "!join")).await;
    p.set_bot(vec!["bot1".into()], "mybot".into());
    p.on_event(&chat_event("bot1", "!join")).await;
    let g = p.state().giveaway.unwrap();
    assert_eq!(
        g.entrants
            .iter()
            .map(|e| e.viewer.id.as_str())
            .collect::<Vec<_>>(),
        ["a", "b"]
    );
    assert_eq!(p.hub.vars.get("giveaway.entries"), Some(json!(2)));
    assert_eq!(p.hub.vars.get("giveaway.status"), Some(json!("open")));

    let g = p.draw(1).unwrap();
    assert!(!g.open, "drawing closes entries");
    let winner = g.winners[0].viewer.clone();
    let out = chat_out(&r.rec).await;
    assert_eq!(out.len(), 2, "{out:?}");
    assert!(out[0].ends_with("Entries are closed. 2 entered. Good luck!"));
    assert!(out[1].contains(&format!("@{} won Mouse!", winner.name)));
    assert_eq!(p.hub.vars.get("giveaway.winner"), Some(json!(winner.name)));
    let draw = p.hub.vars.get("giveaway.draw").unwrap();
    assert_eq!(draw["winner"]["id"], json!(winner.id));
    assert_eq!(
        draw["names"].as_array().unwrap().last(),
        Some(&json!(winner.name))
    );

    p.on_event(&chat_event(&winner.id, "I'm here")).await;
    let g = p.state().giveaway.unwrap();
    assert_eq!(g.winners[0].state, WinnerState::Claimed);

    let g = p.reroll(&winner.id).unwrap();
    assert_eq!(g.winners.len(), 2);
    assert_eq!(g.draws, 2);
    assert!(chat_out(&r.rec).await[0].contains("New draw"));

    let rec = p.finish().unwrap().unwrap();
    assert_eq!(rec.entrants, 2);
    assert_eq!(rec.winners.len(), 1);
    assert!(p.state().giveaway.is_none());
    assert_eq!(p.hub.vars.get("giveaway.status"), Some(json!("idle")));
    let list = p.history(10).unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].ended_at > 0);
    p.delete_record(&list[0].id).unwrap();
    assert!(p.history(10).unwrap().is_empty());
}

#[tokio::test]
async fn the_giveaway_gets_a_clashing_word() {
    let r = rig();
    let p = &r.play;
    p.set_queue_open(true);
    p.open_giveaway(GiveawaySettings {
        title: "Key".into(),
        ..GiveawaySettings::default()
    })
    .unwrap();
    assert!(p.state().clash);
    p.on_event(&chat_event("a", "!join")).await;
    let st = p.state();
    assert_eq!(st.giveaway.as_ref().unwrap().entrants.len(), 1);
    assert!(st.queue.waiting.is_empty());

    p.set_giveaway_open(false).unwrap();
    assert!(!p.state().clash);
    p.on_event(&chat_event("a", "!join")).await;
    assert_eq!(p.state().queue.waiting.len(), 1);
}

#[tokio::test]
async fn redemptions_enter_and_are_completed_or_refunded() {
    let r = rig();
    let p = &r.play;
    p.open_giveaway(GiveawaySettings {
        title: "Key".into(),
        keyword: String::new(),
        reward_id: "r1".into(),
        reward_title: "Enter".into(),
        ..GiveawaySettings::default()
    })
    .unwrap();
    chat_out(&r.rec).await;
    let redeem = |user: &str, rid: &str| {
        let mut e = Event::new(EventKind::Redemption).with_user(user, user);
        e.user.as_mut().unwrap().id = user.into();
        e.data.insert("reward_id".into(), "r1".into());
        e.data.insert("redemption_id".into(), rid.into());
        e
    };
    p.on_event(&redeem("a", "x1")).await;
    p.on_event(&redeem("a", "x2")).await;
    let mut other = redeem("b", "x3");
    other.data.insert("reward_id".into(), "r2".into());
    p.on_event(&other).await;
    assert_eq!(
        chat_out(&r.rec).await,
        [
            "redemption r1/x1 refund=false",
            "redemption r1/x2 refund=true"
        ]
    );
    assert_eq!(p.state().giveaway.unwrap().entrants.len(), 1);
}

#[tokio::test]
async fn followers_only_checks_follows() {
    struct Follows;
    #[async_trait]
    impl FollowLookup for Follows {
        async fn followed_at(&self, user_id: &str) -> AppResult<Option<i64>> {
            match user_id {
                "old" => Ok(Some(0)),
                "new" => Ok(Some(crate::util::now_ms())),
                "err" => user_err("no permission"),
                _ => Ok(None),
            }
        }
    }
    let r = rig();
    let p = &r.play;
    p.set_follows(Arc::new(Follows));
    let mut s = GiveawaySettings {
        title: "Key".into(),
        ..GiveawaySettings::default()
    };
    s.rules.audience = Audience::Followers;
    s.rules.min_follow_days = 1;
    p.open_giveaway(s).unwrap();
    for id in ["old", "new", "nope", "err"] {
        p.on_event(&chat_event(id, "!join")).await;
    }
    let ids: Vec<_> = p
        .state()
        .giveaway
        .unwrap()
        .entrants
        .into_iter()
        .map(|e| e.viewer.id)
        .collect();
    assert_eq!(ids, ["old", "err"]);
}

#[tokio::test]
async fn queue_from_chat_with_batched_replies() {
    let r = rig();
    let p = &r.play;
    p.on_event(&chat_event("a", "!join")).await;
    assert!(p.state().queue.waiting.is_empty(), "closed");
    p.set_queue_open(true);
    for id in ["a", "b", "c", "d"] {
        p.on_event(&chat_event(id, &format!("!join {id}_ign")))
            .await;
    }
    let st = p.state();
    assert_eq!(st.queue.waiting.len(), 4);
    assert_eq!(st.queue.waiting[1].note, "b_ign");
    assert_eq!(st.queue_order, ["a", "b", "c", "d"]);
    assert_eq!(p.hub.vars.get("queue.size"), Some(json!(4)));
    assert_eq!(p.hub.vars.get("queue.next"), Some(json!("A")));
    let out = chat_out(&r.rec).await;
    assert_eq!(out, ["chat bot=true reply=false A joined the queue (#1)"]);
    p.tick(crate::util::now_ms() + ReplyBatch::WINDOW_MS + 10);
    let out = chat_out(&r.rec).await;
    assert_eq!(
        out,
        ["chat bot=true reply=false B, C and D joined the queue (#2–4)"]
    );

    p.on_event(&chat_event("c", "!position")).await;
    p.on_event(&chat_event("z", "!position")).await;
    p.on_event(&chat_event("b", "!leave")).await;
    let out = chat_out(&r.rec).await;
    assert_eq!(
        out,
        [
            "chat bot=true reply=false @C you're #3 in the queue",
            "chat bot=true reply=false @Z you're not in the queue.",
            "chat bot=true reply=false B left the queue"
        ]
    );

    let picked = p.queue_next(2, false).unwrap();
    assert_eq!(picked.len(), 2);
    assert_eq!(
        chat_out(&r.rec).await,
        ["chat bot=true reply=false @A and @C, you're up!"]
    );
    assert_eq!(p.hub.vars.get("queue.playing"), Some(json!("A, C")));
    p.queue_clear();
    assert!(p.queue_next(1, false).is_err());
}

#[tokio::test]
async fn the_queue_survives_a_restart() {
    let r = rig();
    r.play.set_queue_open(true);
    r.play.on_event(&chat_event("a", "!join Ann")).await;
    r.play.on_event(&chat_event("b", "!join")).await;
    r.play.queue_move("b", Some("a"));

    let settings = r.play.settings.clone();
    let again = PlayService::new(Hub::test(), settings.clone(), Some(r.file.clone()));
    let st = again.state();
    assert!(st.queue.open);
    assert_eq!(st.queue_order, ["b", "a"]);
    assert_eq!(st.queue.waiting[1].note, "Ann");
    assert_eq!(again.hub.vars.get("queue.size"), Some(json!(2)));

    // Too old: started fresh.
    let mut saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&r.file).unwrap()).unwrap();
    saved["saved_at"] = json!(crate::util::now_ms() - 13 * 3_600_000);
    std::fs::write(&r.file, saved.to_string()).unwrap();
    let stale = PlayService::new(Hub::test(), settings, Some(r.file.clone()));
    assert!(stale.state().queue.waiting.is_empty());
}

#[test]
fn viewer_from_chat() {
    let mut e = chat_event("u1", "hi");
    e.roles = UserRoles {
        subscriber: true,
        ..UserRoles::default()
    };
    e.data.insert("color".into(), "#FF0000".into());
    e.data.insert("badges".into(), json!(["subscriber"]));
    let v = viewer_of(&e).unwrap();
    assert_eq!(v.sub_tier, 1);
    assert_eq!(v.color, "#FF0000");
    assert_eq!(v.badges, ["subscriber"]);
    e.data.insert("sub_tier".into(), json!(3));
    assert_eq!(viewer_of(&e).unwrap().sub_tier, 3);
    e.user = None;
    assert!(viewer_of(&e).is_none());
}
