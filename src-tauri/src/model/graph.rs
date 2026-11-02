//! The action graph: lookups used by runs, and conversion of the older step lists.

use super::automation::{
    Action, EdgeBranch, EdgeSide, Graph, GraphEdge, GraphNode, NodeKind, Step, Trigger,
};
use std::collections::HashSet;

/// Layout of converted step lists; matches the size of nodes in the flow.
pub const NODE_W: f64 = 280.0;
const COL_W: f64 = 332.0;
const TRIGGER_ROW: f64 = 210.0;
const ROW: f64 = 136.0;
const BRANCH_GAP: f64 = 24.0;

/// Where a run starts: trigger nodes marked as fired, and the nodes to run first.
#[derive(Debug, Default, PartialEq)]
pub struct StartPlan {
    pub fired: Vec<String>,
    pub first: Vec<String>,
}

impl Graph {
    pub fn node(&self, id: &str) -> Option<&GraphNode> {
        self.nodes.iter().find(|n| n.id == id)
    }

    pub fn trigger_nodes(&self) -> impl Iterator<Item = (&GraphNode, &Trigger)> {
        self.nodes.iter().filter_map(|n| match &n.kind {
            NodeKind::Trigger { trigger } => Some((n, trigger)),
            NodeKind::Step { .. } => None,
        })
    }

    /// Lines leaving `id`, ordered by where they lead: top to bottom, then left to right.
    pub fn outgoing(&self, id: &str) -> Vec<&GraphEdge> {
        let mut out: Vec<&GraphEdge> = self.edges.iter().filter(|e| e.from == id).collect();
        out.sort_by(|a, b| self.position_order(&a.to, &b.to));
        out
    }

    fn position_order(&self, a: &str, b: &str) -> std::cmp::Ordering {
        let pos = |id: &str| {
            self.node(id)
                .map(|n| (n.y, n.x))
                .unwrap_or((f64::MAX, f64::MAX))
        };
        let (pa, pb) = (pos(a), pos(b));
        pa.0.total_cmp(&pb.0).then(pa.1.total_cmp(&pb.1))
    }

    /// Start of a run. `trigger` is the index of the trigger that fired; `None` is a
    /// manual run: the first Button trigger, else all triggers at once, else nodes
    /// nothing leads to.
    pub fn start_plan(&self, trigger: Option<usize>) -> StartPlan {
        let triggers: Vec<&GraphNode> = self.trigger_nodes().map(|(n, _)| n).collect();
        let chosen: Vec<&GraphNode> = match trigger {
            Some(i) => triggers.get(i).copied().into_iter().collect(),
            None => match self
                .trigger_nodes()
                .find(|(_, t)| matches!(t, Trigger::Manual))
            {
                Some((n, _)) => vec![n],
                None => triggers.clone(),
            },
        };
        if chosen.is_empty() {
            if trigger.is_some() || !triggers.is_empty() {
                return StartPlan::default();
            }
            let led_to: HashSet<&str> = self.edges.iter().map(|e| e.to.as_str()).collect();
            let mut roots: Vec<&GraphNode> = self
                .nodes
                .iter()
                .filter(|n| !led_to.contains(n.id.as_str()))
                .collect();
            roots.sort_by(|a, b| self.position_order(&a.id, &b.id));
            return StartPlan {
                fired: Vec::new(),
                first: roots.into_iter().map(|n| n.id.clone()).collect(),
            };
        }
        let mut first: Vec<String> = Vec::new();
        for t in &chosen {
            for e in self.outgoing(&t.id) {
                // Several triggers leading to one node run it once.
                if chosen.len() == 1 || !first.contains(&e.to) {
                    first.push(e.to.clone());
                }
            }
        }
        if chosen.len() > 1 {
            first.sort_by(|a, b| self.position_order(a, b));
        }
        StartPlan {
            fired: chosen.into_iter().map(|n| n.id.clone()).collect(),
            first,
        }
    }

    /// Nodes reachable from `from` along any line, `from` included.
    pub fn reachable<'a>(&'a self, from: impl IntoIterator<Item = &'a str>) -> HashSet<&'a str> {
        let mut seen: HashSet<&str> = HashSet::new();
        let mut stack: Vec<&str> = from.into_iter().collect();
        while let Some(id) = stack.pop() {
            if !seen.insert(id) {
                continue;
            }
            for e in self.edges.iter().filter(|e| e.from == id) {
                stack.push(e.to.as_str());
            }
        }
        seen
    }

    /// Drop lines to missing nodes, lines from a node to itself, and repeats.
    fn clean(&mut self) {
        let ids: HashSet<String> = self.nodes.iter().map(|n| n.id.clone()).collect();
        let mut seen = HashSet::new();
        self.edges.retain(|e| {
            e.from != e.to
                && ids.contains(&e.from)
                && ids.contains(&e.to)
                && seen.insert((
                    e.from.clone(),
                    e.from_side,
                    e.to.clone(),
                    e.to_side,
                    e.branch,
                ))
        });
    }
}

impl Action {
    /// Convert an older step list to a graph, tidy the graph and refresh `triggers`.
    pub fn normalize(&mut self) {
        if self.graph.nodes.is_empty() && (!self.triggers.is_empty() || !self.steps.is_empty()) {
            self.graph = graph_from_tree(&self.triggers, &self.steps);
        }
        self.steps.clear();
        self.graph.clean();
        self.triggers = self.graph.trigger_nodes().map(|(_, t)| t.clone()).collect();
    }

    /// A normalized copy when the action still has steps in the old form.
    pub fn normalized(&self) -> std::borrow::Cow<'_, Action> {
        if self.graph.nodes.is_empty() && !self.steps.is_empty() {
            let mut a = self.clone();
            a.normalize();
            std::borrow::Cow::Owned(a)
        } else {
            std::borrow::Cow::Borrowed(self)
        }
    }
}

/// Triggers on top, steps chained below them. If steps get Then and Otherwise lines
/// into their branches, and both branches join again at the step after the If.
pub fn graph_from_tree(triggers: &[Trigger], steps: &[Step]) -> Graph {
    let mut b = Builder::default();
    let w = list_width(steps);
    let center = w * COL_W / 2.0;
    let n = triggers.len() as f64;
    let mut preds = Vec::new();
    for (i, t) in triggers.iter().enumerate() {
        let id = crate::util::new_id();
        let x = center - NODE_W / 2.0 + (i as f64 - (n - 1.0) / 2.0) * (NODE_W + 32.0);
        b.nodes.push(GraphNode {
            id: id.clone(),
            x,
            y: 0.0,
            kind: NodeKind::Trigger { trigger: t.clone() },
        });
        preds.push((id, EdgeBranch::Next));
    }
    let top = if triggers.is_empty() {
        0.0
    } else {
        TRIGGER_ROW
    };
    b.list(steps, 0.0, w, top, preds);
    Graph {
        nodes: b.nodes,
        edges: b.edges,
    }
}

fn list_width(list: &[Step]) -> f64 {
    list.iter().map(step_width).fold(1.0, f64::max)
}

fn step_width(s: &Step) -> f64 {
    match s {
        Step::If {
            then, otherwise, ..
        } => list_width(then) + list_width(otherwise),
        _ => 1.0,
    }
}

#[derive(Default)]
struct Builder {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
}

impl Builder {
    fn connect(&mut self, from: &str, branch: EdgeBranch, to: &str) {
        self.edges.push(GraphEdge {
            id: crate::util::new_id(),
            from: from.to_string(),
            from_side: EdgeSide::Bottom,
            to: to.to_string(),
            to_side: EdgeSide::Top,
            branch,
        });
    }

    /// Lay out `list` in columns `c0..c0+w` from `y` down. `preds` are the open ends that
    /// lead into the list. Returns the open ends after it and the next free `y`.
    fn list(
        &mut self,
        list: &[Step],
        c0: f64,
        w: f64,
        mut y: f64,
        mut preds: Vec<(String, EdgeBranch)>,
    ) -> (Vec<(String, EdgeBranch)>, f64) {
        let x = (c0 + w / 2.0) * COL_W - NODE_W / 2.0;
        for step in list {
            let id = crate::util::new_id();
            for (p, branch) in preds.drain(..) {
                self.connect(&p, branch, &id);
            }
            let kind = match step {
                Step::If { conditions, .. } => Step::If {
                    conditions: conditions.clone(),
                    then: Vec::new(),
                    otherwise: Vec::new(),
                },
                s => s.clone(),
            };
            self.nodes.push(GraphNode {
                id: id.clone(),
                x,
                y,
                kind: NodeKind::Step { step: kind },
            });
            match step {
                Step::If {
                    then, otherwise, ..
                } => {
                    let (wt, wo) = (list_width(then), list_width(otherwise));
                    let start = c0 + (w - wt - wo) / 2.0;
                    let by = y + ROW + BRANCH_GAP;
                    let (te, ty) =
                        self.list(then, start, wt, by, vec![(id.clone(), EdgeBranch::Then)]);
                    let (oe, oy) = self.list(
                        otherwise,
                        start + wt,
                        wo,
                        by,
                        vec![(id, EdgeBranch::Otherwise)],
                    );
                    preds = te.into_iter().chain(oe).collect();
                    y = ty.max(oy);
                }
                // Nothing after a stop runs.
                Step::Stop => y += ROW,
                _ => {
                    preds = vec![(id, EdgeBranch::Next)];
                    y += ROW;
                }
            }
        }
        (preds, y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::condition::ConditionGroup;

    fn say(m: &str) -> Step {
        Step::ChatSend {
            message: m.into(),
            as_bot: false,
            reply: false,
        }
    }

    fn iff(then: Vec<Step>, otherwise: Vec<Step>) -> Step {
        Step::If {
            conditions: ConditionGroup::default(),
            then,
            otherwise,
        }
    }

    /// Node label: trigger kind or chat message, for readable assertions.
    fn label(g: &Graph, id: &str) -> String {
        match &g.node(id).unwrap().kind {
            NodeKind::Trigger { trigger } => format!("{trigger:?}")
                .split([' ', '{'])
                .next()
                .unwrap()
                .to_string(),
            NodeKind::Step { step } => match step {
                Step::ChatSend { message, .. } => message.clone(),
                Step::If { .. } => "if".into(),
                Step::Stop => "stop".into(),
                s => format!("{s:?}"),
            },
        }
    }

    fn edges(g: &Graph) -> Vec<String> {
        let mut out: Vec<String> = g
            .edges
            .iter()
            .map(|e| {
                format!(
                    "{} -{}-> {}",
                    label(g, &e.from),
                    format!("{:?}", e.branch).to_lowercase(),
                    label(g, &e.to)
                )
            })
            .collect();
        out.sort();
        out
    }

    #[test]
    fn chain_with_two_triggers() {
        let g = graph_from_tree(
            &[Trigger::Manual, Trigger::StreamOnline],
            &[say("a"), say("b")],
        );
        assert_eq!(g.nodes.len(), 4);
        assert_eq!(
            edges(&g),
            vec!["Manual -next-> a", "StreamOnline -next-> a", "a -next-> b"]
        );
        let (t0, t1) = (&g.nodes[0], &g.nodes[1]);
        assert_eq!(t0.y, t1.y);
        assert!(t0.x < t1.x);
        assert!(g.nodes[2].y > t0.y && g.nodes[3].y > g.nodes[2].y);
        assert_eq!(g.nodes[2].x, g.nodes[3].x);
    }

    #[test]
    fn nested_ifs_and_empty_branches_join_after() {
        let g = graph_from_tree(
            &[Trigger::Manual],
            &[
                iff(vec![say("t1"), iff(vec![say("deep")], vec![])], vec![]),
                say("after"),
            ],
        );
        assert_eq!(
            edges(&g),
            vec![
                "Manual -next-> if",
                "deep -next-> after",
                "if -otherwise-> after",
                "if -otherwise-> after",
                "if -then-> deep",
                "if -then-> t1",
                "t1 -next-> if",
            ]
        );
        // If nodes keep no nested steps.
        for n in &g.nodes {
            if let NodeKind::Step {
                step: Step::If {
                    then, otherwise, ..
                },
            } = &n.kind
            {
                assert!(then.is_empty() && otherwise.is_empty());
            }
        }
        // Then sits left of Otherwise.
        let deep = g.nodes.iter().find(|n| label(&g, &n.id) == "deep").unwrap();
        let after = g
            .nodes
            .iter()
            .find(|n| label(&g, &n.id) == "after")
            .unwrap();
        assert!(after.y > deep.y);
    }

    #[test]
    fn branches_side_by_side_and_stop_ends() {
        let g = graph_from_tree(
            &[],
            &[
                iff(vec![say("yes"), Step::Stop], vec![say("no")]),
                say("end"),
            ],
        );
        assert_eq!(
            edges(&g),
            vec![
                "if -otherwise-> no",
                "if -then-> yes",
                "no -next-> end",
                "yes -next-> stop"
            ]
        );
        let yes = g.nodes.iter().find(|n| label(&g, &n.id) == "yes").unwrap();
        let no = g.nodes.iter().find(|n| label(&g, &n.id) == "no").unwrap();
        assert_eq!(yes.y, no.y);
        assert!(yes.x + NODE_W <= no.x);
    }

    #[test]
    fn normalize_converts_once_and_derives_triggers() {
        let mut a = Action {
            triggers: vec![Trigger::Manual],
            steps: vec![say("hi")],
            ..Action::default()
        };
        a.normalize();
        assert!(a.steps.is_empty());
        assert_eq!(a.graph.nodes.len(), 2);
        assert_eq!(a.triggers, vec![Trigger::Manual]);
        let before = a.graph.clone();
        a.normalize();
        assert_eq!(a.graph, before);
        // Triggers follow the graph, not the other way round.
        a.graph.nodes.remove(0);
        a.normalize();
        assert!(a.triggers.is_empty());
        assert!(a.graph.edges.is_empty(), "lines to a removed node go too");
    }

    #[test]
    fn start_plans() {
        let mut g = graph_from_tree(
            &[Trigger::StreamOnline, Trigger::StreamOffline],
            &[say("a")],
        );
        let a = g.nodes[2].id.clone();
        assert_eq!(g.start_plan(Some(1)).fired, vec![g.nodes[1].id.clone()]);
        assert_eq!(g.start_plan(Some(1)).first, vec![a.clone()]);
        assert_eq!(g.start_plan(Some(5)), StartPlan::default());
        // No Button trigger: all triggers, shared next node once.
        let all = g.start_plan(None);
        assert_eq!(all.fired.len(), 2);
        assert_eq!(all.first, vec![a.clone()]);
        // A Button trigger wins.
        let manual = graph_from_tree(&[Trigger::Manual], &[say("m")]);
        g.nodes.push(manual.nodes[0].clone());
        g.nodes.push(manual.nodes[1].clone());
        g.edges.extend(manual.edges);
        let plan = g.start_plan(None);
        assert_eq!(plan.fired, vec![manual.nodes[0].id.clone()]);
        assert_eq!(plan.first, vec![manual.nodes[1].id.clone()]);
        // No triggers at all: nodes nothing leads to.
        let free = graph_from_tree(&[], &[say("x"), say("y")]);
        assert_eq!(free.start_plan(None).first, vec![free.nodes[0].id.clone()]);
        assert!(free.start_plan(Some(0)).first.is_empty());
    }

    #[test]
    fn clean_drops_bad_lines() {
        let mut a = Action {
            triggers: vec![Trigger::Manual],
            steps: vec![say("a")],
            ..Action::default()
        };
        a.normalize();
        let e = a.graph.edges[0].clone();
        a.graph.edges.push(e.clone());
        a.graph.edges.push(GraphEdge {
            id: "self".into(),
            to: e.from.clone(),
            ..e.clone()
        });
        a.graph.edges.push(GraphEdge {
            id: "gone".into(),
            to: "missing".into(),
            ..e
        });
        a.normalize();
        assert_eq!(a.graph.edges.len(), 1);
    }
}
