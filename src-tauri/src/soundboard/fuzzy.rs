//! Finds the sound a viewer meant from what they typed.

/// Lowercase letters and digits, with single spaces between words.
pub fn normalize(s: &str) -> String {
    let mut out = String::new();
    for word in s
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        if !out.is_empty() {
            out.push(' ');
        }
        out.extend(word.chars().flat_map(char::to_lowercase));
    }
    out
}

fn compact(s: &str) -> String {
    s.chars().filter(|c| *c != ' ').collect()
}

fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

/// How well `query` names `name`, both normalized. 0 = not at all.
fn score(query: &str, name: &str) -> u32 {
    if query.is_empty() || name.is_empty() {
        return 0;
    }
    if query == name {
        return 100;
    }
    let (q, n) = (compact(query), compact(name));
    if q == n {
        return 95;
    }
    if q.chars().count() < 2 {
        return 0;
    }
    if n.starts_with(&q) {
        return 80;
    }
    let words: Vec<&str> = name.split(' ').collect();
    if query
        .split(' ')
        .all(|w| words.iter().any(|nw| nw.starts_with(w)))
    {
        return 70;
    }
    if n.contains(&q) {
        return 60;
    }
    let allowed = (q.chars().count() / 4).max(1);
    let d = distance(&q, &n);
    if d <= allowed {
        return 50 - (d as u32) * 5;
    }
    0
}

/// Index of the best match among `names` (each item may have several names).
/// Ties go to the first one.
pub fn best_match<'a, I, N>(query: &str, items: I) -> Option<usize>
where
    I: IntoIterator<Item = N>,
    N: IntoIterator<Item = &'a str>,
{
    let q = normalize(query);
    let mut best: Option<(usize, u32)> = None;
    for (i, names) in items.into_iter().enumerate() {
        let s = names
            .into_iter()
            .map(|n| score(&q, &normalize(n)))
            .max()
            .unwrap_or(0);
        if s > 0 && best.is_none_or(|(_, b)| s > b) {
            best = Some((i, s));
        }
    }
    best.map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(query: &str, names: &[&[&str]]) -> Option<usize> {
        best_match(query, names.iter().map(|n| n.iter().copied()))
    }

    const BOARD: &[&[&str]] = &[
        &["Airhorn"],
        &["Sad trombone", "womp"],
        &["Drum roll"],
        &["Applause"],
        &["Air raid siren"],
    ];

    #[test]
    fn normalizes_text() {
        assert_eq!(normalize("  Sad   TROMBONE!! 🎺 "), "sad trombone");
        assert_eq!(normalize("drum-roll"), "drum roll");
        assert_eq!(normalize("🎺"), "");
    }

    #[test]
    fn exact_prefix_words_and_typos() {
        assert_eq!(pick("airhorn", BOARD), Some(0));
        assert_eq!(pick("AIR HORN", BOARD), Some(0), "spaces don't matter");
        assert_eq!(pick("air", BOARD), Some(0), "prefix, first wins a tie");
        assert_eq!(pick("air raid", BOARD), Some(4));
        assert_eq!(pick("sad", BOARD), Some(1));
        assert_eq!(pick("trombone", BOARD), Some(1), "any word");
        assert_eq!(pick("womp", BOARD), Some(1), "aliases");
        assert_eq!(pick("drumroll", BOARD), Some(2));
        assert_eq!(pick("aplause", BOARD), Some(3), "one letter off");
        assert_eq!(pick("applase!", BOARD), Some(3));
        assert_eq!(pick("roll", BOARD), Some(2));
    }

    #[test]
    fn nothing_close_is_no_match() {
        assert_eq!(pick("", BOARD), None);
        assert_eq!(pick("a", BOARD), None, "one letter is too vague");
        assert_eq!(pick("kazoo", BOARD), None);
        assert_eq!(pick("🎺", BOARD), None);
        assert_eq!(pick("airhorn", &[]), None);
    }

    #[test]
    fn exact_beats_prefix() {
        let names: &[&[&str]] = &[&["Horn blast"], &["Horn"]];
        assert_eq!(pick("horn", names), Some(1));
    }
}
