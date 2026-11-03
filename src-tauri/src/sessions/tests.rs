use super::*;
use crate::model::event::EventUser;

const MIN: i64 = 60_000;

fn db() -> Arc<Db> {
    Arc::new(Db::open_in_memory())
}

fn twitch(live: bool, started_at: i64, viewers: u32) -> LiveSignal {
    LiveSignal {
        twitch: Some(TwitchLive {
            live,
            started_at: if live { started_at } else { 0 },
            title: "Ranked grind".into(),
            category: "Celeste".into(),
            viewers,
        }),
        obs: None,
    }
}

fn obs(streaming: bool) -> LiveSignal {
    LiveSignal {
        twitch: None,
        obs: Some(streaming),
    }
}

fn ended(changes: &[SessionChange]) -> Option<&StreamSession> {
    changes.iter().find_map(|c| match c {
        SessionChange::Ended { session } => Some(session),
        _ => None,
    })
}

fn started(changes: &[SessionChange]) -> Option<&StreamSession> {
    changes.iter().find_map(|c| match c {
        SessionChange::Started { session } => Some(session),
        _ => None,
    })
}

#[test]
fn twitch_start_and_end() {
    let s = Sessions::load(db());
    let t0 = 1_700_000_000_000;
    assert!(s.tick(&twitch(false, 0, 0), t0).is_empty());
    let c = s.tick(&twitch(true, t0 - 30_000, 10), t0);
    let first = started(&c).expect("started");
    assert_eq!(first.started_at, t0 - 30_000, "uses Twitch's start time");
    assert_eq!(first.categories, vec!["Celeste"]);
    assert!(s.tick(&twitch(true, t0 - 30_000, 30), t0 + MIN).is_empty());
    let mut sig = twitch(true, t0 - 30_000, 20);
    sig.twitch.as_mut().unwrap().category = "Just Chatting".into();
    s.tick(&sig, t0 + 2 * MIN);
    let c = s.tick(&twitch(false, 0, 0), t0 + 90 * MIN);
    let done = ended(&c).expect("ended");
    assert_eq!(done.ended_at, Some(t0 + 90 * MIN));
    assert_eq!(done.peak_viewers, 30);
    assert_eq!(done.avg_viewers, 20);
    assert_eq!(done.categories, vec!["Celeste", "Just Chatting"]);
    assert!(s.current().is_none());
    let list = s.list(10).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].session.ended_at, Some(t0 + 90 * MIN));
    assert!(s.tick(&twitch(false, 0, 0), t0 + 91 * MIN).is_empty());
}

#[test]
fn twitch_wins_over_obs() {
    let s = Sessions::load(db());
    let mut sig = twitch(false, 0, 0);
    sig.obs = Some(true);
    assert!(s.tick(&sig, 1_000 * MIN).is_empty(), "Twitch says offline");
    assert!(
        s.tick(&LiveSignal::default(), 1_001 * MIN).is_empty(),
        "nothing known"
    );
}

#[test]
fn obs_fallback() {
    let s = Sessions::load(db());
    let t0 = 1_000 * MIN;
    let c = s.tick(&obs(true), t0);
    let first = started(&c).unwrap().clone();
    assert_eq!(first.source, SessionSource::Obs);
    assert_eq!(first.started_at, t0);
    // OBS disconnecting isn't the stream ending.
    assert!(s.tick(&LiveSignal::default(), t0 + 10 * MIN).is_empty());
    assert_eq!(s.current().unwrap().id, first.id);
    let c = s.tick(&obs(false), t0 + 20 * MIN);
    assert_eq!(ended(&c).unwrap().ended_at, Some(t0 + 20 * MIN));
}

#[test]
fn short_sessions_are_dropped() {
    let s = Sessions::load(db());
    s.tick(&obs(true), 1_000 * MIN);
    assert!(s.tick(&obs(false), 1_000 * MIN + 20_000).is_empty());
    assert!(s.list(10).unwrap().is_empty());
}

#[test]
fn quick_restart_continues_the_session() {
    let s = Sessions::load(db());
    let t0 = 1_000 * MIN;
    let id = started(&s.tick(&twitch(true, t0, 5), t0)).unwrap().id;
    s.tick(&twitch(false, 0, 0), t0 + 30 * MIN);
    // Twitch gives the comeback a new start time, 3 minutes later.
    let c = s.tick(&twitch(true, t0 + 33 * MIN, 5), t0 + 33 * MIN);
    assert_eq!(started(&c).unwrap().id, id);
    assert_eq!(s.current().unwrap().started_at, t0);
    // Much later: a new session.
    s.tick(&twitch(false, 0, 0), t0 + 60 * MIN);
    let c = s.tick(&twitch(true, t0 + 120 * MIN, 5), t0 + 120 * MIN);
    assert_ne!(started(&c).unwrap().id, id);
    assert_eq!(s.list(10).unwrap().len(), 2);
}

#[test]
fn app_restart_mid_stream_resumes() {
    let db = db();
    let t0 = 1_000 * MIN;
    let id = {
        let s = Sessions::load(db.clone());
        let id = started(&s.tick(&twitch(true, t0, 40), t0)).unwrap().id;
        s.tick(&twitch(true, t0, 60), t0 + 10 * MIN);
        s.flush();
        id
    };
    let s = Sessions::load(db.clone());
    assert_eq!(s.current().unwrap().id, id, "picked up at start-up");
    // Twitch reports the same stream (its start time can wobble a little).
    let c = s.tick(&twitch(true, t0 + 20_000, 50), t0 + 15 * MIN);
    assert!(c.is_empty(), "{c:?}");
    let c = s.tick(&twitch(false, 0, 0), t0 + 40 * MIN);
    let done = ended(&c).unwrap();
    assert_eq!(done.id, id);
    assert_eq!(done.ended_at, Some(t0 + 40 * MIN));
    assert_eq!(done.peak_viewers, 60);
    assert_eq!(done.avg_viewers, 50);
}

#[test]
fn stream_ended_while_the_app_was_closed() {
    let db = db();
    let t0 = 1_000 * MIN;
    {
        let s = Sessions::load(db.clone());
        s.tick(&twitch(true, t0, 1), t0);
        s.tick(&twitch(true, t0, 1), t0 + 45 * MIN);
        s.flush();
    }
    let s = Sessions::load(db.clone());
    let c = s.tick(&twitch(false, 0, 0), t0 + 300 * MIN);
    assert_eq!(
        ended(&c).unwrap().ended_at,
        Some(t0 + 45 * MIN),
        "ends when it was last seen"
    );
}

#[test]
fn new_stream_after_restart_closes_the_old_one() {
    let db = db();
    let t0 = 1_000 * MIN;
    let old = {
        let s = Sessions::load(db.clone());
        let id = started(&s.tick(&twitch(true, t0, 1), t0)).unwrap().id;
        s.tick(&twitch(true, t0, 1), t0 + 45 * MIN);
        s.flush();
        id
    };
    let s = Sessions::load(db.clone());
    let c = s.tick(&twitch(true, t0 + 200 * MIN, 1), t0 + 210 * MIN);
    let done = ended(&c).unwrap();
    assert_eq!(done.id, old);
    assert_eq!(done.ended_at, Some(t0 + 45 * MIN));
    let new = started(&c).unwrap();
    assert_ne!(new.id, old);
    assert_eq!(new.started_at, t0 + 200 * MIN);
}

#[test]
fn obs_restart_resumes_only_if_recent() {
    let db = db();
    let t0 = 1_000 * MIN;
    let id = {
        let s = Sessions::load(db.clone());
        let id = started(&s.tick(&obs(true), t0)).unwrap().id;
        s.tick(&obs(true), t0 + 20 * MIN);
        s.flush();
        id
    };
    let s = Sessions::load(db.clone());
    assert!(s.tick(&obs(true), t0 + 25 * MIN).is_empty());
    assert_eq!(s.current().unwrap().id, id);
    s.flush();
    drop(s);

    let s = Sessions::load(db.clone());
    let c = s.tick(&obs(true), t0 + 180 * MIN);
    assert_eq!(ended(&c).unwrap().ended_at, Some(t0 + 25 * MIN));
    assert!(started(&c).is_some());
}

fn user_event(kind: EventKind, ts: i64, name: &str, amount: Option<f64>) -> Event {
    let mut e = Event::new(kind).with_user(&name.to_lowercase(), name);
    e.user.as_mut().unwrap().id = format!("id-{name}");
    e.ts = ts;
    e.amount = amount;
    e
}

fn chat(ts: i64, name: &str) -> Event {
    user_event(EventKind::Chat, ts, name, None)
}

#[test]
fn stats() {
    let db = db();
    let s = Sessions::load(db.clone());
    s.set_ignored_users(vec!["id-Botty".into()]);
    let now = crate::util::now_ms();
    let t0 = now - 60 * MIN;

    // Before the stream: an old chatter and an old follow.
    s.tick(&twitch(false, 0, 0), t0 - 10 * MIN);
    s.on_chat(&chat(t0 - 5 * MIN, "Regular"));
    db.insert_event(&user_event(EventKind::Follow, t0 - MIN, "Early", None))
        .unwrap();

    s.tick(&twitch(true, t0, 12), t0);
    let at = |m: i64| t0 + m * MIN;
    for e in [
        user_event(EventKind::Follow, at(1), "Ann", None),
        user_event(EventKind::Follow, at(2), "Bob", None),
        user_event(EventKind::Sub, at(3), "Ann", None),
        user_event(EventKind::Resub, at(4), "Cid", None),
        user_event(EventKind::Cheer, at(5), "Bob", Some(100.0)),
        user_event(EventKind::Cheer, at(6), "Ann", Some(500.0)),
        user_event(EventKind::Cheer, at(7), "Bob", Some(450.0)),
        user_event(EventKind::Raid, at(8), "Rudy", Some(42.0)),
        user_event(EventKind::CommunityGift, at(9), "Gina", Some(2.0)),
    ] {
        db.insert_event(&e).unwrap();
    }
    for i in 0..2 {
        let mut g = user_event(EventKind::GiftSub, at(9) + i, "Gina", None);
        g.data.insert("community_gift_id".into(), "cg1".into());
        db.insert_event(&g).unwrap();
    }
    db.insert_event(&user_event(EventKind::GiftSub, at(10), "Hal", None))
        .unwrap();
    let mut anon = Event::new(EventKind::Cheer);
    anon.is_anonymous = true;
    anon.ts = at(11);
    anon.amount = Some(50.0);
    db.insert_event(&anon).unwrap();
    let mut donation = user_event(EventKind::Charity, at(12), "Dee", Some(25.0));
    donation.currency = Some("USD".into());
    db.insert_event(&donation).unwrap();
    let mut test = user_event(EventKind::Follow, at(13), "Tess", None);
    test.test = true;
    db.insert_event(&test).unwrap();

    for (m, name) in [
        (1, "Ann"),
        (1, "Ann"),
        (2, "Regular"),
        (12, "Bob"),
        (13, "Ann"),
    ] {
        s.on_chat(&chat(at(m), name));
    }
    let mut own = chat(at(3), "Castwright");
    own.roles.broadcaster = true;
    s.on_chat(&own);
    s.on_chat(&chat(at(3), "Botty"));
    let mut sent = chat(at(3), "Mod");
    sent.data.insert("sent_by_castwright".into(), true.into());
    s.on_chat(&sent);
    let mut no_id = chat(at(4), "Nolan");
    no_id.user = Some(EventUser {
        id: String::new(),
        login: "nolan".into(),
        display_name: "Nolan".into(),
    });
    s.on_chat(&no_id);

    s.on_alert("Ann followed");
    s.on_alert("Bob cheered");
    s.on_action("Hydrate");
    s.on_marker("Boss down");
    s.on_raid_out("pixelbyte", "pixelbyte", 31);

    let c = s.tick(&twitch(false, 0, 0), now + MIN);
    let id = ended(&c).unwrap().id;
    let sum = s.summary(id).unwrap().unwrap();
    assert_eq!(sum.duration_ms, 61 * MIN);
    assert_eq!(sum.follows, 2, "test and earlier events skipped");
    assert_eq!((sum.new_subs, sum.resubs, sum.gifted_subs), (1, 1, 3));
    assert_eq!(sum.top_gifters[0].name, "Gina");
    assert_eq!(sum.top_gifters[0].amount, 2.0);
    assert_eq!(sum.bits, 1100);
    let cheerers: Vec<_> = sum
        .top_cheerers
        .iter()
        .map(|r| (r.name.as_str(), r.amount))
        .collect();
    assert_eq!(
        cheerers,
        vec![("Bob", 550.0), ("Ann", 500.0), ("Anonymous", 50.0)]
    );
    assert_eq!(sum.raids_in.len(), 1);
    assert_eq!(sum.raids_in[0].name, "Rudy");
    assert_eq!(sum.raids_in[0].viewers, 42);
    assert_eq!(sum.raids_out.len(), 1);
    assert_eq!(sum.raids_out[0].viewers, 31);
    assert_eq!(sum.donation_count, 1);
    assert_eq!(sum.donation_totals[0].name, "USD");
    assert_eq!(sum.top_donors[0].name, "Dee");
    assert_eq!(sum.chat_messages, 6);
    assert_eq!(sum.chatters, 4);
    assert_eq!(sum.top_chatters[0].name, "Ann");
    assert_eq!(sum.top_chatters[0].amount, 3.0);
    assert_eq!(sum.first_chatters, vec!["Ann", "Nolan", "Bob"]);
    assert_eq!((sum.alerts, sum.actions), (2, 1));
    assert_eq!(sum.markers[0].description, "Boss down");
    assert_eq!(sum.chat_minutes.iter().map(|m| m.count).sum::<u32>(), 6);
    // Community gift once, not its two single gifts.
    let gifts = sum
        .timeline
        .iter()
        .filter(|m| m.kind.contains("gift"))
        .count();
    assert_eq!(gifts, 2);
    assert!(sum.timeline.windows(2).all(|w| w[0].ts <= w[1].ts));

    // The stored summary doesn't change when history is cleared.
    db.clear_events().unwrap();
    assert_eq!(s.summary(id).unwrap().unwrap().follows, 2);
    let list = s.list(10).unwrap();
    assert_eq!((list[0].follows, list[0].subs, list[0].bits), (2, 5, 1100));
}

#[test]
fn delete_removes_activity() {
    let db = db();
    let s = Sessions::load(db.clone());
    let now = crate::util::now_ms();
    let id = started(&s.tick(&obs(true), now - 30 * MIN)).unwrap().id;
    s.on_chat(&chat(now - 10 * MIN, "Ann"));
    assert!(s.delete(id).is_err(), "can't delete while live");
    s.tick(&obs(false), now);
    assert!(s.delete(id).unwrap());
    assert!(!s.delete(id).unwrap());
    assert!(s.summary(id).unwrap().is_none());
    let left: i64 = db
        .with_conn(|c| c.query_row("SELECT COUNT(*) FROM session_activity", [], |r| r.get(0)))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn nothing_is_recorded_while_offline() {
    let db = db();
    let s = Sessions::load(db.clone());
    s.on_alert("x");
    s.on_chat(&chat(1, "Ann"));
    let (activity, chatters): (i64, i64) = db
        .with_conn(|c| {
            c.query_row(
                "SELECT (SELECT COUNT(*) FROM session_activity), (SELECT COUNT(*) FROM chatters)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
        })
        .unwrap();
    assert_eq!(activity, 0);
    assert_eq!(
        chatters, 1,
        "chatters are remembered for first-time detection"
    );
}

#[test]
fn signal_from_status() {
    use crate::model::runtime::{ObsSnapshot, TwitchAccount, TwitchStatus};
    let mut tw = TwitchStatus::default();
    tw.stream.live = true;
    tw.stream.viewers = 9;
    let mut ob = ObsSnapshot::default();
    ob.stream.active = true;

    let sig = LiveSignal::from_status(&tw, true, &ob);
    assert!(sig.twitch.is_none(), "not signed in");
    assert!(sig.obs.is_none(), "OBS not connected");

    ob.state = ConnState::Connected;
    assert_eq!(LiveSignal::from_status(&tw, true, &ob).obs, Some(true));

    tw.broadcaster = Some(TwitchAccount::default());
    assert!(
        LiveSignal::from_status(&tw, false, &ob).twitch.is_none(),
        "not read yet"
    );
    let t = LiveSignal::from_status(&tw, true, &ob).twitch.unwrap();
    assert!(t.live);
    assert_eq!(t.viewers, 9);
}

#[test]
fn credits() {
    let db = db();
    let s = Sessions::load(db.clone());
    assert_eq!(s.credits().unwrap(), Default::default(), "no stream yet");
    let now = crate::util::now_ms();
    let t0 = now - 60 * MIN;
    db.insert_event(&user_event(EventKind::Follow, t0 - MIN, "Early", None))
        .unwrap();
    let id = started(&s.tick(&twitch(true, t0, 12), t0)).unwrap().id;
    let at = |m: i64| t0 + m * MIN;
    let mut resub = user_event(EventKind::Resub, at(4), "Cid", None);
    resub.months = Some(14);
    let mut gifted = user_event(EventKind::Sub, at(5), "Lucky", None);
    gifted.is_gift = true;
    for e in [
        user_event(EventKind::Follow, at(1), "Bob", None),
        user_event(EventKind::Follow, at(2), "Ann", None),
        user_event(EventKind::Follow, at(3), "Bob", None),
        user_event(EventKind::Sub, at(3), "Ann", None),
        resub,
        gifted,
        user_event(EventKind::GiftSub, at(6), "Gina", None),
        user_event(EventKind::GiftSub, at(6) + 1, "Gina", None),
        user_event(EventKind::GiftSub, at(7), "Hal", None),
        user_event(EventKind::Cheer, at(8), "Bob", Some(100.0)),
        user_event(EventKind::Cheer, at(9), "Ann", Some(500.0)),
        user_event(EventKind::Cheer, at(10), "Bob", Some(450.0)),
        user_event(EventKind::Raid, at(11), "Rudy", Some(42.0)),
        user_event(EventKind::Raid, at(12), "Max", Some(300.0)),
    ] {
        db.insert_event(&e).unwrap();
    }
    let mut anon = Event::new(EventKind::GiftSub);
    anon.is_anonymous = true;
    anon.ts = at(13);
    db.insert_event(&anon).unwrap();

    let with_role = |m: i64, name: &str, moderator: bool, vip: bool| {
        let mut e = chat(at(m), name);
        e.user.as_mut().unwrap().id =
            format!("{}", 100 + name.len() * 7 + name.as_bytes()[0] as usize);
        e.roles.moderator = moderator;
        e.roles.vip = vip;
        e
    };
    assert!(
        s.on_chat(&with_role(1, "Zed", true, false)),
        "first message ever"
    );
    assert!(!s.on_chat(&with_role(2, "Zed", true, false)));
    s.on_chat(&with_role(2, "Vee", false, true));
    s.on_chat(&with_role(3, "Ann", false, false));
    s.on_chat(&with_role(4, "Ann", false, false));
    s.on_chat(&with_role(5, "Ann", false, false));
    let mut host = chat(at(5), "Host");
    host.roles.broadcaster = true;
    assert!(!s.on_chat(&host), "the broadcaster isn't counted");

    let c = s.credits().unwrap();
    assert_eq!(c.session_id, id);
    let names = |l: &[crate::model::session::CreditName]| {
        l.iter()
            .map(|n| (n.name.clone(), n.amount))
            .collect::<Vec<_>>()
    };
    let n = |name: &str, amount: f64| (name.to_string(), amount);
    assert_eq!(
        names(&c.followers),
        vec![n("Bob", 0.0), n("Ann", 0.0)],
        "once each, in order"
    );
    assert_eq!(
        names(&c.subscribers),
        vec![n("Ann", 0.0), n("Cid", 14.0)],
        "gifted subs are thanked under the gifter"
    );
    assert_eq!(
        names(&c.gifters),
        vec![n("Gina", 2.0), n("Anonymous", 1.0), n("Hal", 1.0)]
    );
    assert_eq!(names(&c.cheerers), vec![n("Bob", 550.0), n("Ann", 500.0)]);
    assert_eq!(names(&c.raiders), vec![n("Max", 300.0), n("Rudy", 42.0)]);
    assert_eq!(names(&c.moderators), vec![n("Zed", 0.0)]);
    assert_eq!(names(&c.vips), vec![n("Vee", 0.0)]);
    assert_eq!(
        names(&c.chatters),
        vec![n("Ann", 3.0), n("Zed", 2.0), n("Vee", 1.0)]
    );
    assert_eq!(c.followers[0].login, "bob");
    assert_eq!(c.followers[0].user_id, "id-Bob");
    assert_eq!(c.chatters[0].login, "ann");
    assert!(
        !c.chatters[0].user_id.is_empty(),
        "numeric ids are kept for paints"
    );

    // After the stream ends, the last stream's names are used.
    s.tick(&twitch(false, 0, 0), now);
    assert_eq!(s.credits().unwrap().followers.len(), 2);
}
