//! Regex -> DFA by the direct method (Aho, Sethi & Ullman's "followpos"
//! construction), laid out step by step the way the course worksheet
//! (`idea/nuevos_agregados/ER a AFD.pdf`) works it by hand:
//!
//! 1. Syntax tree of the regex augmented with the end marker `#`
//!    (`(r)#`), leaves numbered left to right.
//! 2. Per node: nullable, firstpos and lastpos.
//! 3. Per position: followpos (concatenation and star/plus rules).
//! 4. DFA states: sets of positions, starting from firstpos(root) and
//!    renamed A, B, C…; a transition on `a` from a set S goes to the union
//!    of followpos(p) over the positions p in S labelled `a`.
//! 5. Initial state = firstpos(root); accepting states = the sets that
//!    contain the position of `#`.
//!
//! Every intermediate result is kept (not just the final DFA) because the
//! point is to show the work, table by table.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::regex::Regex;

/// The end marker's label. Reserved: a regex using `#` as a symbol is
/// rejected, since its positions would be indistinguishable from the end
/// marker's.
pub const END_MARKER: &str = "#";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Symbol,
    Epsilon,
    Empty,
    End,
    Concat,
    Union,
    Star,
    Plus,
    Optional,
}

/// One node of the augmented syntax tree. Nodes are stored in post-order
/// (children before their parent), so `children` always point backwards
/// and the root is the last node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TreeNode {
    pub kind: NodeKind,
    /// What the node shows: the symbol, `ε`, `∅`, `#`, or the operator
    /// (`·`, `|`, `*`, `+`, `?`).
    pub label: String,
    /// The leaf's position number (1-based); only symbol and end leaves
    /// have one.
    pub position: Option<usize>,
    pub children: Vec<usize>,
    pub nullable: bool,
    pub firstpos: Vec<usize>,
    pub lastpos: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PositionInfo {
    pub position: usize,
    pub symbol: String,
    pub followpos: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DState {
    pub name: String,
    pub positions: Vec<usize>,
    pub initial: bool,
    pub accepting: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DTransition {
    pub from: String,
    pub symbol: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirectDfa {
    pub nodes: Vec<TreeNode>,
    pub root: usize,
    pub positions: Vec<PositionInfo>,
    pub end_position: usize,
    pub alphabet: Vec<String>,
    pub states: Vec<DState>,
    pub transitions: Vec<DTransition>,
}

/// Runs the direct method on `r`. Fails only if `r` uses the reserved end
/// marker `#` as a symbol (Spanish message: shown verbatim to the user).
pub fn regex_to_dfa_direct(r: &Regex) -> Result<DirectDfa, String> {
    let mut builder = TreeBuilder::default();
    let body = builder.build(r)?;
    let end = builder.leaf(NodeKind::End, END_MARKER);
    let root = builder.combine(NodeKind::Concat, "·", vec![body, end]);
    let end_position = builder.positions.len();

    let followpos = followpos(&builder.nodes, builder.positions.len());
    let positions: Vec<PositionInfo> = builder
        .positions
        .iter()
        .enumerate()
        .map(|(i, symbol)| PositionInfo {
            position: i + 1,
            symbol: symbol.clone(),
            followpos: followpos[i + 1].iter().copied().collect(),
        })
        .collect();

    let alphabet: Vec<String> = positions
        .iter()
        .filter(|p| p.position != end_position)
        .map(|p| p.symbol.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let (states, transitions) =
        build_states(&positions, &alphabet, &builder.nodes[root].firstpos, end_position);

    Ok(DirectDfa { nodes: builder.nodes, root, positions, end_position, alphabet, states, transitions })
}

#[derive(Default)]
struct TreeBuilder {
    nodes: Vec<TreeNode>,
    /// Symbol of each position, index `p - 1`.
    positions: Vec<String>,
}

impl TreeBuilder {
    fn build(&mut self, r: &Regex) -> Result<usize, String> {
        Ok(match r {
            Regex::Empty => self.leaf(NodeKind::Empty, "\u{2205}"),
            Regex::Epsilon => self.leaf(NodeKind::Epsilon, "\u{03b5}"),
            Regex::Symbol(s) if s == END_MARKER => {
                return Err(format!(
                    "'{END_MARKER}' está reservado como marcador final del método directo — usá otro símbolo"
                ));
            }
            Regex::Symbol(s) => self.leaf(NodeKind::Symbol, s),
            Regex::Concat(a, b) => {
                let children = vec![self.build(a)?, self.build(b)?];
                self.combine(NodeKind::Concat, "·", children)
            }
            Regex::Union(a, b) => {
                let children = vec![self.build(a)?, self.build(b)?];
                self.combine(NodeKind::Union, "|", children)
            }
            Regex::Star(a) => {
                let child = self.build(a)?;
                self.combine(NodeKind::Star, "*", vec![child])
            }
            Regex::Plus(a) => {
                let child = self.build(a)?;
                self.combine(NodeKind::Plus, "+", vec![child])
            }
            Regex::Optional(a) => {
                let child = self.build(a)?;
                self.combine(NodeKind::Optional, "?", vec![child])
            }
        })
    }

    /// A leaf. Symbol and end leaves get the next position number: nullable
    /// false, firstpos = lastpos = {i}. ε is nullable with empty sets; ∅ is
    /// not nullable and has empty sets (it matches nothing).
    fn leaf(&mut self, kind: NodeKind, label: &str) -> usize {
        let (position, nullable) = match kind {
            NodeKind::Symbol | NodeKind::End => {
                self.positions.push(label.to_string());
                (Some(self.positions.len()), false)
            }
            NodeKind::Epsilon => (None, true),
            _ => (None, false),
        };
        let set: Vec<usize> = position.into_iter().collect();
        self.push(TreeNode {
            kind,
            label: label.to_string(),
            position,
            children: vec![],
            nullable,
            firstpos: set.clone(),
            lastpos: set,
        })
    }

    /// An operator node, with the worksheet's rules for nullable, firstpos
    /// and lastpos.
    fn combine(&mut self, kind: NodeKind, label: &str, children: Vec<usize>) -> usize {
        let union = |a: &[usize], b: &[usize]| -> Vec<usize> {
            a.iter().chain(b).copied().collect::<BTreeSet<_>>().into_iter().collect()
        };
        let c1 = &self.nodes[children[0]];
        let (nullable, firstpos, lastpos) = match kind {
            NodeKind::Concat => {
                let c2 = &self.nodes[children[1]];
                (
                    c1.nullable && c2.nullable,
                    if c1.nullable { union(&c1.firstpos, &c2.firstpos) } else { c1.firstpos.clone() },
                    if c2.nullable { union(&c1.lastpos, &c2.lastpos) } else { c2.lastpos.clone() },
                )
            }
            NodeKind::Union => {
                let c2 = &self.nodes[children[1]];
                (c1.nullable || c2.nullable, union(&c1.firstpos, &c2.firstpos), union(&c1.lastpos, &c2.lastpos))
            }
            NodeKind::Star | NodeKind::Optional => (true, c1.firstpos.clone(), c1.lastpos.clone()),
            NodeKind::Plus => (c1.nullable, c1.firstpos.clone(), c1.lastpos.clone()),
            _ => unreachable!("combine is only called with operator kinds"),
        };
        self.push(TreeNode { kind, label: label.to_string(), position: None, children, nullable, firstpos, lastpos })
    }

    fn push(&mut self, node: TreeNode) -> usize {
        self.nodes.push(node);
        self.nodes.len() - 1
    }
}

/// followpos per position (index = position, 0 unused): for a concat node,
/// every i in lastpos(left) is followed by firstpos(right); for a star (and
/// a plus, which also repeats), every i in lastpos(n) is followed by
/// firstpos(n).
fn followpos(nodes: &[TreeNode], position_count: usize) -> Vec<BTreeSet<usize>> {
    let mut follow = vec![BTreeSet::new(); position_count + 1];
    for node in nodes {
        let (from, to) = match node.kind {
            NodeKind::Concat => (&nodes[node.children[0]].lastpos, &nodes[node.children[1]].firstpos),
            NodeKind::Star | NodeKind::Plus => (&node.lastpos, &node.firstpos),
            _ => continue,
        };
        for &i in from {
            follow[i].extend(to.iter().copied());
        }
    }
    follow
}

/// The table of D states and their transitions, breadth-first from
/// firstpos(root). A move with no positions leaves no transition (no dead
/// state), same as the worksheet.
fn build_states(
    positions: &[PositionInfo],
    alphabet: &[String],
    start: &[usize],
    end_position: usize,
) -> (Vec<DState>, Vec<DTransition>) {
    let mut states: Vec<DState> = Vec::new();
    let mut index_of: BTreeMap<Vec<usize>, usize> = BTreeMap::new();
    let mut transitions = Vec::new();

    let mut discover = |set: Vec<usize>, states: &mut Vec<DState>| -> usize {
        if let Some(&i) = index_of.get(&set) {
            return i;
        }
        let i = states.len();
        states.push(DState {
            name: state_name(i),
            accepting: set.contains(&end_position),
            initial: i == 0,
            positions: set.clone(),
        });
        index_of.insert(set, i);
        i
    };

    discover(start.to_vec(), &mut states);
    let mut next = 0;
    while next < states.len() {
        let current = states[next].positions.clone();
        for symbol in alphabet {
            let target: Vec<usize> = current
                .iter()
                .filter(|&&p| positions[p - 1].symbol == *symbol)
                .flat_map(|&p| positions[p - 1].followpos.iter().copied())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            if target.is_empty() {
                continue;
            }
            let to = discover(target, &mut states);
            transitions.push(DTransition {
                from: states[next].name.clone(),
                symbol: symbol.clone(),
                to: states[to].name.clone(),
            });
        }
        next += 1;
    }
    (states, transitions)
}

/// A, B, …, Z, AA, AB, … (spreadsheet-column style).
fn state_name(mut i: usize) -> String {
    let mut name = Vec::new();
    loop {
        name.push(b'A' + (i % 26) as u8);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    name.reverse();
    String::from_utf8(name).expect("ASCII letters")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn direct(pattern: &str) -> DirectDfa {
        regex_to_dfa_direct(&pattern.parse().expect("valid regex")).expect("no reserved symbol")
    }

    fn follow(d: &DirectDfa) -> Vec<(usize, &str, Vec<usize>)> {
        d.positions.iter().map(|p| (p.position, p.symbol.as_str(), p.followpos.clone())).collect()
    }

    fn table(d: &DirectDfa) -> Vec<(String, Vec<usize>, bool, bool)> {
        d.states.iter().map(|s| (s.name.clone(), s.positions.clone(), s.initial, s.accepting)).collect()
    }

    fn moves(d: &DirectDfa) -> Vec<(&str, &str, &str)> {
        d.transitions.iter().map(|t| (t.from.as_str(), t.symbol.as_str(), t.to.as_str())).collect()
    }

    #[test]
    fn dragon_book_example_a_or_b_star_abb() {
        let d = direct("(a|b)*abb");
        assert_eq!(
            follow(&d),
            vec![
                (1, "a", vec![1, 2, 3]),
                (2, "b", vec![1, 2, 3]),
                (3, "a", vec![4]),
                (4, "b", vec![5]),
                (5, "b", vec![6]),
                (6, "#", vec![]),
            ]
        );
        assert_eq!(d.end_position, 6);
        assert_eq!(d.alphabet, vec!["a", "b"]);
        assert_eq!(
            table(&d),
            vec![
                ("A".into(), vec![1, 2, 3], true, false),
                ("B".into(), vec![1, 2, 3, 4], false, false),
                ("C".into(), vec![1, 2, 3, 5], false, false),
                ("D".into(), vec![1, 2, 3, 6], false, true),
            ]
        );
        assert_eq!(
            moves(&d),
            vec![
                ("A", "a", "B"),
                ("A", "b", "A"),
                ("B", "a", "B"),
                ("B", "b", "C"),
                ("C", "a", "B"),
                ("C", "b", "D"),
                ("D", "a", "B"),
                ("D", "b", "A"),
            ]
        );
    }

    #[test]
    fn tree_is_post_order_with_the_augmented_root_last() {
        let d = direct("ab");
        let root = &d.nodes[d.root];
        assert_eq!(d.root, d.nodes.len() - 1);
        assert_eq!(root.kind, NodeKind::Concat);
        let end = &d.nodes[root.children[1]];
        assert_eq!((end.kind.clone(), end.label.as_str(), end.position), (NodeKind::End, "#", Some(3)));
        for (i, node) in d.nodes.iter().enumerate() {
            assert!(node.children.iter().all(|&c| c < i), "children come before their parent");
        }
    }

    #[test]
    fn node_attributes_follow_the_worksheet_tables() {
        // (a|ε)b*: union with ε is nullable; star is nullable; firstpos of
        // the concat includes b because the left side is nullable.
        let d = direct("(a|ε)b*");
        let find = |label: &str| d.nodes.iter().find(|n| n.label == label).unwrap();
        let union = find("|");
        assert!(union.nullable);
        assert_eq!(union.firstpos, vec![1]);
        let star = find("*");
        assert!(star.nullable);
        assert_eq!((star.firstpos.clone(), star.lastpos.clone()), (vec![2], vec![2]));
        let body = &d.nodes[d.nodes[d.root].children[0]];
        assert!(body.nullable);
        assert_eq!(body.firstpos, vec![1, 2]);
        assert_eq!(body.lastpos, vec![1, 2]);
        assert_eq!(d.nodes[d.root].firstpos, vec![1, 2, 3]);
    }

    #[test]
    fn plus_repeats_but_is_not_nullable() {
        let d = direct("a+");
        let plus = d.nodes.iter().find(|n| n.kind == NodeKind::Plus).unwrap();
        assert!(!plus.nullable);
        assert_eq!(follow(&d), vec![(1, "a", vec![1, 2]), (2, "#", vec![])]);
        assert_eq!(table(&d), vec![("A".into(), vec![1], true, false), ("B".into(), vec![1, 2], false, true)]);
        assert_eq!(moves(&d), vec![("A", "a", "B"), ("B", "a", "B")]);
    }

    #[test]
    fn optional_is_nullable_and_does_not_repeat() {
        let d = direct("a?b");
        assert_eq!(follow(&d), vec![(1, "a", vec![2]), (2, "b", vec![3]), (3, "#", vec![])]);
        assert_eq!(d.nodes[d.root].firstpos, vec![1, 2]);
        assert_eq!(
            table(&d),
            vec![
                ("A".into(), vec![1, 2], true, false),
                ("B".into(), vec![2], false, false),
                ("C".into(), vec![3], false, true),
            ]
        );
        assert_eq!(moves(&d), vec![("A", "a", "B"), ("A", "b", "C"), ("B", "b", "C")]);
    }

    #[test]
    fn a_nullable_regex_makes_the_initial_state_accepting() {
        let d = direct("a*");
        assert!(d.states[0].initial && d.states[0].accepting);
    }

    #[test]
    fn rejects_the_reserved_end_marker_as_a_symbol() {
        let err = regex_to_dfa_direct(&"a#".parse().unwrap()).unwrap_err();
        assert!(err.contains("marcador final"));
    }

    #[test]
    fn names_states_like_spreadsheet_columns() {
        assert_eq!(state_name(0), "A");
        assert_eq!(state_name(25), "Z");
        assert_eq!(state_name(26), "AA");
        assert_eq!(state_name(27), "AB");
    }

    /// The DFA accepts exactly the regex's language: compared word by word
    /// against Thompson's NFA for the same regex.
    #[test]
    fn accepts_the_same_language_as_thompsons_nfa() {
        use crate::convert::regex_to_nfa::regex_to_nfa;
        use crate::engine::{run_bounded, Budget, Outcome};
        use crate::ids::SymbolId;

        fn dfa_accepts(d: &DirectDfa, w: &str) -> bool {
            let mut state = d.states[0].name.clone();
            for c in w.chars() {
                match d.transitions.iter().find(|t| t.from == state && t.symbol == c.to_string()) {
                    Some(t) => state = t.to.clone(),
                    None => return false,
                }
            }
            d.states.iter().any(|s| s.name == state && s.accepting)
        }

        for pattern in ["(a|b)*abb", "a+b?", "(ab|b)*a?", "0*1(0|1)*", "((a|b)c)+|ε", "a(b|ε)*"] {
            let regex: Regex = pattern.parse().unwrap();
            let d = regex_to_dfa_direct(&regex).unwrap();
            let nfa = regex_to_nfa(&regex);
            let engine = crate::engine::fa::FaEngine::compile(&nfa);
            let alphabet: Vec<char> = "abc01".chars().collect();
            let mut words = vec![String::new()];
            for len in 1..=5 {
                let mut next = Vec::new();
                for w in words.iter().filter(|w| w.chars().count() == len - 1) {
                    for c in &alphabet {
                        next.push(format!("{w}{c}"));
                    }
                }
                words.extend(next);
            }
            for w in &words {
                let input: Vec<SymbolId> = w
                    .chars()
                    .map(|c| nfa.symbol_label_to_id(&c.to_string()).unwrap_or(SymbolId(u32::MAX)))
                    .collect();
                let nfa_accepts = run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted;
                assert_eq!(dfa_accepts(&d, w), nfa_accepts, "pattern {pattern:?}, word {w:?}");
            }
        }
    }
}
