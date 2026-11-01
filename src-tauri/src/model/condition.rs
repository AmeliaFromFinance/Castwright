//! Structured conditions used by alert variations, automation triggers and
//! layer visibility. The same rules are implemented in `src/lib/logic/condition.ts`;
//! both must pass `tests/vectors/conditions.json`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Op {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    Exists,
    NotExists,
    IsTrue,
    IsFalse,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Condition {
    pub field: String,
    pub op: Op,
    #[ts(type = "unknown")]
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatchMode {
    #[default]
    All,
    Any,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ConditionGroup {
    pub mode: MatchMode,
    pub conditions: Vec<Condition>,
}

impl ConditionGroup {
    pub fn evaluate(&self, ctx: &Value) -> bool {
        if self.conditions.is_empty() {
            return true;
        }
        match self.mode {
            MatchMode::All => self.conditions.iter().all(|c| c.evaluate(ctx)),
            MatchMode::Any => self.conditions.iter().any(|c| c.evaluate(ctx)),
        }
    }
}

/// Look up `field` in `ctx`. An exact key match wins (variables use flat dotted
/// keys such as `last.sub.name`); otherwise the path is walked segment by segment.
pub fn resolve<'a>(ctx: &'a Value, field: &str) -> Option<&'a Value> {
    if let Value::Object(map) = ctx
        && let Some(v) = map.get(field)
    {
        return Some(v);
    }
    let mut cur = ctx;
    for seg in field.split('.') {
        cur = match cur {
            Value::Object(map) => map.get(seg)?,
            Value::Array(items) => items.get(seg.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur)
}

/// Strict number parsing shared with the TypeScript side: optional sign,
/// digits with an optional fraction, optional exponent. No hex, no "inf".
pub fn parse_number(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    let b = t.as_bytes();
    let mut i = 0;
    if b[i] == b'+' || b[i] == b'-' {
        i += 1;
    }
    let digits_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let int_digits = i - digits_start;
    let mut frac_digits = 0;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let fs = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        frac_digits = i - fs;
    }
    if int_digits == 0 && frac_digits == 0 {
        return None;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let es = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == es {
            return None;
        }
    }
    if i != b.len() {
        return None;
    }
    t.parse::<f64>().ok().filter(|n| n.is_finite())
}

pub fn as_number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => parse_number(s),
        _ => None,
    }
}

/// Number formatting that matches JavaScript's `String(n)` for ordinary values.
pub fn format_number(n: f64) -> String {
    if n == n.trunc() && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// How a value appears in text: null and objects are empty, arrays are joined.
pub fn stringify(v: &Value) -> String {
    match v {
        Value::Null | Value::Object(_) => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.as_f64().map(format_number).unwrap_or_default(),
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(stringify).collect::<Vec<_>>().join(", "),
    }
}

fn loose_eq(a: &Value, b: &Value) -> bool {
    if let (Some(x), Some(y)) = (as_number(a), as_number(b)) {
        return x == y;
    }
    stringify(a).to_lowercase() == stringify(b).to_lowercase()
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        Some(Value::String(s)) => matches!(s.trim().to_lowercase().as_str(), "true" | "yes" | "1"),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(_)) => true,
    }
}

/// Missing, null and blank text all count as "no value".
fn has_value(v: Option<&Value>) -> bool {
    match v {
        None => false,
        Some(Value::String(s)) => !s.trim().is_empty(),
        Some(_) => true,
    }
}

impl Condition {
    pub fn evaluate(&self, ctx: &Value) -> bool {
        let actual = resolve(ctx, &self.field).filter(|v| !v.is_null());
        match self.op {
            Op::Exists => has_value(actual),
            Op::NotExists => !has_value(actual),
            Op::IsTrue => truthy(actual),
            Op::IsFalse => !truthy(actual),
            Op::Eq => actual.is_some_and(|a| loose_eq(a, &self.value)),
            Op::Ne => !actual.is_some_and(|a| loose_eq(a, &self.value)),
            Op::Gt | Op::Gte | Op::Lt | Op::Lte => {
                let (Some(a), Some(b)) = (actual.and_then(as_number), as_number(&self.value))
                else {
                    return false;
                };
                match self.op {
                    Op::Gt => a > b,
                    Op::Gte => a >= b,
                    Op::Lt => a < b,
                    _ => a <= b,
                }
            }
            Op::Contains => actual.is_some_and(|a| contains(a, &self.value)),
            Op::NotContains => !actual.is_some_and(|a| contains(a, &self.value)),
            Op::StartsWith => actual.is_some_and(|a| {
                stringify(a)
                    .to_lowercase()
                    .starts_with(&stringify(&self.value).to_lowercase())
            }),
            Op::EndsWith => actual.is_some_and(|a| {
                stringify(a)
                    .to_lowercase()
                    .ends_with(&stringify(&self.value).to_lowercase())
            }),
        }
    }
}

fn contains(actual: &Value, needle: &Value) -> bool {
    match actual {
        Value::Array(items) => items.iter().any(|i| loose_eq(i, needle)),
        other => stringify(other)
            .to_lowercase()
            .contains(&stringify(needle).to_lowercase()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Vectors {
        context: Value,
        cases: Vec<Case>,
        groups: Vec<GroupCase>,
    }
    #[derive(Deserialize)]
    struct Case {
        name: String,
        condition: Condition,
        expected: bool,
    }
    #[derive(Deserialize)]
    struct GroupCase {
        name: String,
        group: ConditionGroup,
        expected: bool,
    }

    #[test]
    fn shared_vectors() {
        let v: Vectors =
            serde_json::from_str(include_str!("../../../tests/vectors/conditions.json")).unwrap();
        for c in &v.cases {
            assert_eq!(
                c.condition.evaluate(&v.context),
                c.expected,
                "case: {}",
                c.name
            );
        }
        for g in &v.groups {
            assert_eq!(
                g.group.evaluate(&v.context),
                g.expected,
                "group: {}",
                g.name
            );
        }
    }

    #[test]
    fn number_parsing() {
        assert_eq!(parse_number("12"), Some(12.0));
        assert_eq!(parse_number(" -1.5e2 "), Some(-150.0));
        assert_eq!(parse_number(".5"), Some(0.5));
        assert_eq!(parse_number("5."), Some(5.0));
        for bad in [
            "", " ", "inf", "NaN", "0x10", "1e", "--1", "1.2.3", "12abc", ".",
        ] {
            assert_eq!(parse_number(bad), None, "{bad}");
        }
    }

    #[test]
    fn number_format_matches_js() {
        assert_eq!(format_number(3.0), "3");
        assert_eq!(format_number(3.5), "3.5");
        assert_eq!(format_number(-0.25), "-0.25");
    }
}
