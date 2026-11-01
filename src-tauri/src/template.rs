//! `{{ key | filter }}` text templates. Mirrored in `src/lib/logic/template.ts`;
//! both must pass `tests/vectors/templates.json`.

use crate::model::condition::{as_number, format_number, resolve, stringify};
use serde_json::Value;

pub fn render(template: &str, ctx: &Value) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let inner = &after[..end];
        if inner.trim().is_empty() {
            out.push_str("{{");
            out.push_str(inner);
            out.push_str("}}");
        } else {
            out.push_str(&eval_expr(inner, ctx));
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

fn eval_expr(inner: &str, ctx: &Value) -> String {
    let mut parts = split_pipes(inner).into_iter();
    let key = parts.next().unwrap_or_default();
    let raw = resolve(ctx, key.trim()).cloned().unwrap_or(Value::Null);
    let mut text = stringify(&raw);
    let mut numeric = as_number(&raw).filter(|_| !matches!(raw, Value::Bool(_)));
    for filter in parts {
        let filter = filter.trim();
        let (name, arg) = match filter.split_once(':') {
            Some((n, a)) => (n.trim(), Some(unquote(a.trim()))),
            None => (filter, None),
        };
        match name {
            "upper" => text = text.to_uppercase(),
            "lower" => text = text.to_lowercase(),
            "number" => {
                if let Some(n) = numeric {
                    text = group_thousands(n);
                }
            }
            "round" => {
                if let Some(n) = numeric {
                    let r = (n + 0.5).floor();
                    numeric = Some(r);
                    text = format_number(r);
                }
            }
            "default" if text.is_empty() => {
                text = arg.unwrap_or_default();
                numeric = crate::model::condition::parse_number(&text);
            }
            _ => {}
        }
    }
    text
}

/// Split on `|` but not inside double quotes, so `default:"a|b"` works.
fn split_pipes(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut in_quotes = false;
    let mut last = 0;
    for (i, ch) in s.char_indices() {
        match ch {
            '"' => in_quotes = !in_quotes,
            '|' if !in_quotes => {
                out.push(&s[last..i]);
                last = i + 1;
            }
            _ => {}
        }
    }
    out.push(&s[last..]);
    out
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// `1234567.891` -> `1,234,567.89`. At most two decimals, trailing zeros dropped.
pub fn group_thousands(n: f64) -> String {
    let fixed = format!("{:.2}", n.abs());
    let (int_part, frac) = fixed.split_once('.').unwrap_or((&fixed, ""));
    let frac = frac.trim_end_matches('0');
    let mut grouped = String::new();
    let digits: Vec<char> = int_part.chars().collect();
    for (i, d) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(*d);
    }
    let negative = n < 0.0 && (grouped != "0" || !frac.is_empty());
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.push_str(&grouped);
    if !frac.is_empty() {
        out.push('.');
        out.push_str(frac);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Vectors {
        context: Value,
        cases: Vec<Case>,
    }
    #[derive(Deserialize)]
    struct Case {
        name: String,
        template: String,
        expected: String,
    }

    #[test]
    fn shared_vectors() {
        let v: Vectors =
            serde_json::from_str(include_str!("../../tests/vectors/templates.json")).unwrap();
        for c in &v.cases {
            assert_eq!(
                render(&c.template, &v.context),
                c.expected,
                "case: {}",
                c.name
            );
        }
    }

    #[test]
    fn thousands() {
        assert_eq!(group_thousands(0.0), "0");
        assert_eq!(group_thousands(999.0), "999");
        assert_eq!(group_thousands(1000.0), "1,000");
        assert_eq!(group_thousands(-1234.5), "-1,234.5");
        assert_eq!(group_thousands(-0.001), "0");
    }

    #[test]
    fn unicode_is_safe() {
        let ctx = serde_json::json!({ "name": "ナナ" });
        assert_eq!(render("✨ {{name}} ✨ {{", &ctx), "✨ ナナ ✨ {{");
    }
}
