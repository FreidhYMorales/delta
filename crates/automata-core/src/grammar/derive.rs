//! Derivations of a string from a `GeneralGrammar`: whether the grammar
//! generates it, the derivation step by step and its derivation tree — the
//! "Derivaciones" / "Árbol de derivación" exercises of
//! `idea/nuevos_agregados/GRAMÁTICAS.pdf`.
//!
//! - Type 2 and 3 grammars use Earley's algorithm: an exact answer even with
//!   ε-productions or left recursion. The derivation is read off the parse
//!   tree, leftmost or rightmost as asked.
//! - Type 1 grammars never shorten a sentential form (except `S → ε`), so a
//!   breadth-first search over forms no longer than the input is finite: an
//!   exact answer too.
//! - Type 0 grammars may shrink forms, and membership is undecidable in
//!   general: the search is bounded, and running out of room is reported as
//!   `LimitReached`, never as a rejection.
//!
//! The derivation tree is a graph in general: a step like `aaA → aaBB`
//! rewrites several symbols at once, so each rewritten symbol gets every
//! replacement symbol as a child. For type 2 and 3 grammars it is the usual
//! tree.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

use super::chomsky::{classify, context_split};
use super::general::{GeneralGrammar, Symbol, EPSILONS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DerivationOrder {
    Leftmost,
    Rightmost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeriveOutcome {
    Accepted,
    Rejected,
    LimitReached,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DerivationStep {
    /// The production applied, as text (`S → aSb`).
    pub production: String,
    /// Index (in symbols) in the previous form where its left side starts.
    pub position: usize,
    /// The form this step leads to, as the course writes it: a step that
    /// erases (`A → ε`) shows `ε` where the symbol was (`5<entero>` then
    /// `5ε`), the next step drops it.
    pub form: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Terminal,
    Nonterminal,
    Epsilon,
    /// Junction for a type-0 rewrite that does not keep its context: every
    /// rewritten symbol leads to it, and it leads to the replacement. Its
    /// label is the production.
    Rule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TreeNode {
    pub label: String,
    pub kind: NodeKind,
    pub children: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DerivationTree {
    pub nodes: Vec<TreeNode>,
    pub root: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Derivation {
    pub outcome: DeriveOutcome,
    /// Why it was rejected or undetermined (user-facing Spanish).
    pub reason: Option<String>,
    /// Sentential forms from the start symbol to the input, as text.
    pub forms: Vec<String>,
    /// `forms.len() - 1` steps: how each form follows from the previous.
    pub steps: Vec<DerivationStep>,
    pub tree: Option<DerivationTree>,
}

/// Search budget for type 0 and 1 grammars (sentential forms explored).
pub const MAX_FORMS: usize = 200_000;

pub fn derive(grammar: &GeneralGrammar, input: &str, order: DerivationOrder) -> Derivation {
    let target = match tokenize_input(grammar, input) {
        Ok(target) => target,
        Err(reason) => return Derivation::without_steps(DeriveOutcome::Rejected, reason),
    };
    if classify(grammar).chomsky_type >= 2 {
        derive_context_free(grammar, &target, order)
    } else {
        derive_by_search(grammar, &target)
    }
}

impl Derivation {
    fn without_steps(outcome: DeriveOutcome, reason: String) -> Self {
        Derivation { outcome, reason: Some(reason), forms: vec![], steps: vec![], tree: None }
    }
}

/// The input as terminals of Σ: spaces are ignored, multi-character
/// terminals match greedily (longest first), and `ε` alone is the empty
/// string.
fn tokenize_input(grammar: &GeneralGrammar, input: &str) -> Result<Vec<Symbol>, String> {
    let trimmed = input.trim();
    let mut chars = trimmed.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        if EPSILONS.contains(&c) {
            return Ok(vec![]);
        }
    }
    let mut terminals: Vec<&String> = grammar.terminals.iter().collect();
    terminals.sort_by_key(|t| std::cmp::Reverse(t.chars().count()));
    let mut symbols = Vec::new();
    let mut rest = trimmed;
    while let Some(c) = rest.chars().next() {
        if c.is_whitespace() {
            rest = &rest[c.len_utf8()..];
            continue;
        }
        match terminals.iter().find(|t| rest.starts_with(t.as_str())) {
            Some(t) => {
                symbols.push(Symbol::Terminal(t.to_string()));
                rest = &rest[t.len()..];
            }
            None => {
                let sigma: Vec<&str> = grammar.terminals.iter().map(String::as_str).collect();
                return Err(format!("'{c}' no es un terminal de Σ = {{{}}}", sigma.join(", ")));
            }
        }
    }
    Ok(symbols)
}

// ---------------------------------------------------------------------
// Type 2 and 3: Earley's algorithm, then the parse tree.
// ---------------------------------------------------------------------

/// Earley item: (production, dot, origin).
type Item = (usize, usize, usize);

struct Earley<'a> {
    grammar: &'a GeneralGrammar,
    by_lhs: HashMap<&'a str, Vec<usize>>,
    target: &'a [Symbol],
    /// Per end position: the (production, origin) pairs completed there.
    completed: Vec<HashSet<(usize, usize)>>,
}

#[derive(Clone)]
enum ParseTree {
    Node(usize, Vec<ParseTree>),
    Leaf(Symbol),
}

fn lhs_name(grammar: &GeneralGrammar, p: usize) -> &str {
    grammar.productions[p].lhs[0].name()
}

fn derive_context_free(grammar: &GeneralGrammar, target: &[Symbol], order: DerivationOrder) -> Derivation {
    let mut by_lhs: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, _) in grammar.productions.iter().enumerate() {
        by_lhs.entry(lhs_name(grammar, i)).or_default().push(i);
    }
    let nullable = nullable_nonterminals(grammar);
    let n = target.len();
    let mut chart: Vec<Vec<Item>> = vec![vec![]; n + 1];
    let mut seen: Vec<HashSet<Item>> = vec![HashSet::new(); n + 1];
    let mut completed: Vec<HashSet<(usize, usize)>> = vec![HashSet::new(); n + 1];
    let add = |chart: &mut Vec<Vec<Item>>, seen: &mut Vec<HashSet<Item>>, k: usize, item: Item| {
        if seen[k].insert(item) {
            chart[k].push(item);
        }
    };
    for &p in by_lhs.get(grammar.start.as_str()).map(Vec::as_slice).unwrap_or(&[]) {
        add(&mut chart, &mut seen, 0, (p, 0, 0));
    }
    for k in 0..=n {
        let mut i = 0;
        while i < chart[k].len() {
            let (p, dot, origin) = chart[k][i];
            i += 1;
            let rhs = &grammar.productions[p].rhs;
            match rhs.get(dot) {
                Some(Symbol::NonTerminal(b)) => {
                    for &q in by_lhs.get(b.as_str()).map(Vec::as_slice).unwrap_or(&[]) {
                        add(&mut chart, &mut seen, k, (q, 0, k));
                    }
                    // Aycock–Horspool: a nullable non-terminal can be skipped.
                    if nullable.contains(b.as_str()) {
                        add(&mut chart, &mut seen, k, (p, dot + 1, origin));
                    }
                }
                Some(terminal) => {
                    if k < n && target[k] == *terminal {
                        add(&mut chart, &mut seen, k + 1, (p, dot + 1, origin));
                    }
                }
                None => {
                    completed[k].insert((p, origin));
                    let a = lhs_name(grammar, p);
                    let waiting: Vec<Item> = chart[origin]
                        .iter()
                        .filter(|&&(q, d, _)| {
                            matches!(grammar.productions[q].rhs.get(d), Some(Symbol::NonTerminal(x)) if x == a)
                        })
                        .copied()
                        .collect();
                    for (q, d, o) in waiting {
                        add(&mut chart, &mut seen, k, (q, d + 1, o));
                    }
                }
            }
        }
    }

    let parser = Earley { grammar, by_lhs, target, completed };
    let tree = parser.build(&grammar.start, 0, n, &mut HashSet::new(), &mut HashMap::new()).map(|(tree, _)| tree);
    match tree {
        Some(tree) => from_parse_tree(grammar, &tree, order),
        None => Derivation::without_steps(
            DeriveOutcome::Rejected,
            format!("la gramática no genera la cadena desde {}", grammar.start),
        ),
    }
}

/// Non-terminals that derive ε (fixpoint).
fn nullable_nonterminals(grammar: &GeneralGrammar) -> HashSet<&str> {
    let mut nullable = HashSet::new();
    loop {
        let before = nullable.len();
        for (i, p) in grammar.productions.iter().enumerate() {
            if p.rhs.iter().all(|s| matches!(s, Symbol::NonTerminal(b) if nullable.contains(b.as_str()))) {
                nullable.insert(lhs_name(grammar, i));
            }
        }
        if nullable.len() == before {
            return nullable;
        }
    }
}

impl Earley<'_> {
    fn completes(&self, a: &str, i: usize, j: usize) -> bool {
        self.by_lhs.get(a).is_some_and(|ps| ps.iter().any(|&p| self.completed[j].contains(&(p, i))))
    }

    /// The smallest parse tree (fewest nodes) for `a` spanning
    /// `target[i..j]` — on an ambiguous grammar, the one written by hand,
    /// without detours through ε. `stack` guards against cycles (A → B,
    /// B → A, nullable loops): a minimal tree never revisits the same
    /// (A, i, j) on one path, so skipping those loses nothing. `memo` keeps
    /// every span already solved.
    fn build(
        &self,
        a: &str,
        i: usize,
        j: usize,
        stack: &mut HashSet<(String, usize, usize)>,
        memo: &mut HashMap<(String, usize, usize), (ParseTree, usize)>,
    ) -> Option<(ParseTree, usize)> {
        let key = (a.to_string(), i, j);
        if let Some(solved) = memo.get(&key) {
            return Some(solved.clone());
        }
        if !stack.insert(key.clone()) {
            return None;
        }
        let mut best: Option<(ParseTree, usize)> = None;
        for &p in self.by_lhs.get(a).map(Vec::as_slice).unwrap_or(&[]) {
            if !self.completed[j].contains(&(p, i)) {
                continue;
            }
            if let Some((children, size)) = self.match_rhs(&self.grammar.productions[p].rhs, i, j, stack, memo) {
                // An empty right side still draws one ε leaf.
                let total = 1 + size.max(1);
                if best.as_ref().is_none_or(|(_, s)| total < *s) {
                    best = Some((ParseTree::Node(p, children), total));
                }
            }
        }
        stack.remove(&key);
        if let Some(solved) = &best {
            memo.insert(key, solved.clone());
        }
        best
    }

    /// The smallest way to derive `target[pos..end]` from `rhs`, as the
    /// children trees and their total size.
    fn match_rhs(
        &self,
        rhs: &[Symbol],
        pos: usize,
        end: usize,
        stack: &mut HashSet<(String, usize, usize)>,
        memo: &mut HashMap<(String, usize, usize), (ParseTree, usize)>,
    ) -> Option<(Vec<ParseTree>, usize)> {
        let Some((first, rest)) = rhs.split_first() else {
            return (pos == end).then(|| (Vec::new(), 0));
        };
        match first {
            Symbol::NonTerminal(b) => {
                let mut best: Option<(Vec<ParseTree>, usize)> = None;
                for q in pos..=end {
                    if !self.completes(b, pos, q) {
                        continue;
                    }
                    let Some((child, child_size)) = self.build(b, pos, q, stack, memo) else { continue };
                    let Some((mut tail, tail_size)) = self.match_rhs(rest, q, end, stack, memo) else { continue };
                    let total = child_size + tail_size;
                    if best.as_ref().is_none_or(|(_, s)| total < *s) {
                        tail.insert(0, child);
                        best = Some((tail, total));
                    }
                }
                best
            }
            terminal => {
                if pos < end && self.target[pos] == *terminal {
                    let (mut tail, size) = self.match_rhs(rest, pos + 1, end, stack, memo)?;
                    tail.insert(0, ParseTree::Leaf(terminal.clone()));
                    Some((tail, size + 1))
                } else {
                    None
                }
            }
        }
    }
}

/// The derivation tree of a parse tree, plus its leftmost or rightmost
/// derivation (expanding the leftmost/rightmost non-terminal each step).
fn from_parse_tree(grammar: &GeneralGrammar, tree: &ParseTree, order: DerivationOrder) -> Derivation {
    let mut nodes: Vec<TreeNode> = Vec::new();
    let mut production_of: HashMap<usize, usize> = HashMap::new();
    let root = add_parse_node(grammar, tree, &mut nodes, &mut production_of);

    let mut frontier = vec![root];
    let mut forms = vec![frontier_text(&nodes, &frontier)];
    let mut steps = Vec::new();
    loop {
        let expandable = |&id: &usize| production_of.contains_key(&id);
        let position = match order {
            DerivationOrder::Leftmost => frontier.iter().position(expandable),
            DerivationOrder::Rightmost => frontier.iter().rposition(expandable),
        };
        let Some(position) = position else { break };
        let id = frontier[position];
        let replacement: Vec<usize> =
            nodes[id].children.iter().copied().filter(|&c| nodes[c].kind != NodeKind::Epsilon).collect();
        let erased = replacement.is_empty();
        let erased_view = erased.then(|| text_with_epsilon(&nodes, &frontier, position, 1));
        frontier.splice(position..=position, replacement);
        let form = frontier_text(&nodes, &frontier);
        let production = grammar.productions[production_of[&id]].to_string();
        steps.push(DerivationStep { production, position, form: erased_view.unwrap_or_else(|| form.clone()) });
        forms.push(form);
        production_of.remove(&id);
    }
    Derivation { outcome: DeriveOutcome::Accepted, reason: None, forms, steps, tree: Some(DerivationTree { nodes, root }) }
}

fn add_parse_node(
    grammar: &GeneralGrammar,
    tree: &ParseTree,
    nodes: &mut Vec<TreeNode>,
    production_of: &mut HashMap<usize, usize>,
) -> usize {
    match tree {
        ParseTree::Leaf(symbol) => push_node(nodes, symbol_node(symbol)),
        ParseTree::Node(p, children) => {
            let id = push_node(nodes, symbol_node(&grammar.productions[*p].lhs[0]));
            production_of.insert(id, *p);
            let child_ids: Vec<usize> = if children.is_empty() {
                vec![push_node(nodes, epsilon_node())]
            } else {
                children.iter().map(|c| add_parse_node(grammar, c, nodes, production_of)).collect()
            };
            nodes[id].children = child_ids;
            id
        }
    }
}

fn symbol_node(symbol: &Symbol) -> TreeNode {
    let kind = if symbol.is_nonterminal() { NodeKind::Nonterminal } else { NodeKind::Terminal };
    TreeNode { label: symbol.to_string(), kind, children: vec![] }
}

fn epsilon_node() -> TreeNode {
    TreeNode { label: "ε".to_string(), kind: NodeKind::Epsilon, children: vec![] }
}

fn push_node(nodes: &mut Vec<TreeNode>, node: TreeNode) -> usize {
    nodes.push(node);
    nodes.len() - 1
}

/// The form with `ε` standing where `len` symbols at `at` were erased.
fn text_with_epsilon(nodes: &[TreeNode], frontier: &[usize], at: usize, len: usize) -> String {
    let labels = |ids: &[usize]| ids.iter().map(|&id| nodes[id].label.as_str()).collect::<String>();
    format!("{}ε{}", labels(&frontier[..at]), labels(&frontier[at + len..]))
}

fn frontier_text(nodes: &[TreeNode], frontier: &[usize]) -> String {
    if frontier.is_empty() {
        "ε".to_string()
    } else {
        frontier.iter().map(|&id| nodes[id].label.as_str()).collect()
    }
}

// ---------------------------------------------------------------------
// Type 0 and 1: breadth-first search over sentential forms.
// ---------------------------------------------------------------------

fn derive_by_search(grammar: &GeneralGrammar, target: &[Symbol]) -> Derivation {
    let context_sensitive = classify(grammar).chomsky_type == 1;
    // A type-1 form never gets shorter, so nothing longer than the input
    // can lead to it: the bound is exact. Type 0 forms may shrink, so its
    // bound is a heuristic and hitting it means "undetermined".
    let bound = if context_sensitive { target.len().max(1) } else { 2 * target.len() + 4 };

    let start = vec![Symbol::NonTerminal(grammar.start.clone())];
    // Arena of explored forms with how each was reached.
    let mut forms: Vec<(Vec<Symbol>, Option<(usize, usize, usize)>)> = vec![(start.clone(), None)];
    let mut index_of: HashMap<Vec<Symbol>, usize> = HashMap::from([(start, 0)]);
    let mut queue: VecDeque<usize> = VecDeque::from([0]);
    let mut pruned = false;

    let mut found = (forms[0].0.as_slice() == target).then_some(0);
    'search: while let Some(current) = queue.pop_front() {
        if found.is_some() {
            break;
        }
        for (p, production) in grammar.productions.iter().enumerate() {
            let k = production.lhs.len();
            let form_len = forms[current].0.len();
            for at in 0..form_len.saturating_sub(k - 1) {
                if forms[current].0[at..at + k] != production.lhs[..] {
                    continue;
                }
                let form = &forms[current].0;
                let mut next = Vec::with_capacity(form_len - k + production.rhs.len());
                next.extend_from_slice(&form[..at]);
                next.extend_from_slice(&production.rhs);
                next.extend_from_slice(&form[at + k..]);
                if next.len() > bound {
                    pruned = true;
                    continue;
                }
                if index_of.contains_key(&next) {
                    continue;
                }
                let id = forms.len();
                let done = next.as_slice() == target;
                index_of.insert(next.clone(), id);
                forms.push((next, Some((current, p, at))));
                if done {
                    found = Some(id);
                    break 'search;
                }
                if forms.len() >= MAX_FORMS {
                    return Derivation::without_steps(
                        DeriveOutcome::LimitReached,
                        format!("se exploraron {MAX_FORMS} formas sentenciales sin encontrar una derivación"),
                    );
                }
                queue.push_back(id);
            }
        }
    }

    let Some(found) = found else {
        return if !context_sensitive && pruned {
            Derivation::without_steps(
                DeriveOutcome::LimitReached,
                format!(
                    "no se encontró una derivación con formas de hasta {bound} símbolos; en una gramática de tipo 0 \
                     la pertenencia es indecidible en general"
                ),
            )
        } else {
            Derivation::without_steps(
                DeriveOutcome::Rejected,
                format!("la gramática no genera la cadena desde {}", grammar.start),
            )
        };
    };

    // Walk back to the start, then replay the steps to build the tree.
    let mut path = Vec::new();
    let mut at = found;
    while let Some((parent, p, position)) = forms[at].1 {
        path.push((p, position));
        at = parent;
    }
    path.reverse();
    from_steps(grammar, &path)
}

/// Replays `(production, position)` steps from the start symbol, building
/// the derivation tree. A step `xAy → xzy` (every type-1 and type-2 rule)
/// only expands A into z — the context x, y stays as it is, so the result is
/// a tree. Any other type-0 rewrite has no way to say which symbol produced
/// which, so all the rewritten symbols lead to one `Rule` node that leads to
/// the replacement symbols (or an ε leaf).
fn from_steps(grammar: &GeneralGrammar, path: &[(usize, usize)]) -> Derivation {
    let mut nodes = vec![symbol_node(&Symbol::NonTerminal(grammar.start.clone()))];
    let mut frontier = vec![0];
    let mut forms = vec![frontier_text(&nodes, &frontier)];
    let mut steps = Vec::new();
    for &(p, position) in path {
        let production = &grammar.productions[p];
        if let Some(i) = context_split(production) {
            let (x, y) = (i, production.lhs.len() - i - 1);
            let z = &production.rhs[x..production.rhs.len() - y];
            let new_ids: Vec<usize> = z.iter().map(|s| push_node(&mut nodes, symbol_node(s))).collect();
            nodes[frontier[position + i]].children = new_ids.clone();
            frontier.splice(position + i..=position + i, new_ids);
            let form = frontier_text(&nodes, &frontier);
            steps.push(DerivationStep { production: production.to_string(), position, form: form.clone() });
            forms.push(form);
            continue;
        }
        let erased_view = production
            .rhs
            .is_empty()
            .then(|| text_with_epsilon(&nodes, &frontier, position, production.lhs.len()));
        let new_ids: Vec<usize> = if production.rhs.is_empty() {
            vec![push_node(&mut nodes, epsilon_node())]
        } else {
            production.rhs.iter().map(|s| push_node(&mut nodes, symbol_node(s))).collect()
        };
        let rewritten = position..position + production.lhs.len();
        if production.lhs.len() == 1 {
            // One symbol produced all of it: no ambiguity, no junction.
            nodes[frontier[position]].children = new_ids.clone();
        } else {
            let rule = push_node(
                &mut nodes,
                TreeNode { label: production.to_string(), kind: NodeKind::Rule, children: new_ids.clone() },
            );
            for &old in &frontier[rewritten.clone()] {
                nodes[old].children = vec![rule];
            }
        }
        let visible: Vec<usize> = new_ids.into_iter().filter(|&id| nodes[id].kind != NodeKind::Epsilon).collect();
        frontier.splice(position..position + production.lhs.len(), visible);
        let form = frontier_text(&nodes, &frontier);
        steps.push(DerivationStep { production: production.to_string(), position, form: erased_view.unwrap_or_else(|| form.clone()) });
        forms.push(form);
    }
    Derivation { outcome: DeriveOutcome::Accepted, reason: None, forms, steps, tree: Some(DerivationTree { nodes, root: 0 }) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grammar::general::parse_general;

    fn run(grammar: &str, input: &str) -> Derivation {
        derive(&parse_general(grammar).unwrap(), input, DerivationOrder::Leftmost)
    }

    fn accepts(grammar: &str, input: &str) -> bool {
        run(grammar, input).outcome == DeriveOutcome::Accepted
    }

    const ZERO_STAR_ONE: &str = "S -> A1B\nA -> 0A | ε\nB -> 0B | 1B | ε";
    const EXERCISE_DERIVATIONS: &str = "S -> ASB\nA -> b\naaA -> aaBB\nS -> d\nA -> aA\nB -> dcd";
    const EXERCISE_1: &str = "S -> abAS\nabA -> baab\nS -> a\nA -> b";
    const EXERCISE_2: &str = "S -> aB\nS -> bA\nA -> a\nA -> aS\nA -> bAA\nB -> b\nB -> bS\nB -> aBB";
    const EXERCISE_3: &str = "S -> aS\nS -> aA\nA -> bA\nA -> b";

    #[test]
    fn regular_grammar_exercise_3() {
        for w in ["abb", "ab", "aaaab", "aaabb", "aabbbb"] {
            assert!(accepts(EXERCISE_3, w), "{w} should be accepted");
        }
        for w in ["ba", "a", "", "abab"] {
            assert_eq!(run(EXERCISE_3, w).outcome, DeriveOutcome::Rejected, "{w} should be rejected");
        }
    }

    #[test]
    fn context_free_with_epsilon_productions_0_star_1_0_or_1_star() {
        for w in ["00101", "1001", "00011", "1"] {
            assert!(accepts(ZERO_STAR_ONE, w), "{w} should be accepted");
        }
        assert_eq!(run(ZERO_STAR_ONE, "000").outcome, DeriveOutcome::Rejected);
    }

    #[test]
    fn context_free_exercise_2() {
        for w in ["ab", "ba", "abba", "bbaa", "ababab"] {
            assert!(accepts(EXERCISE_2, w), "{w} should be accepted");
        }
        assert_eq!(run(EXERCISE_2, "aab").outcome, DeriveOutcome::Rejected);
    }

    #[test]
    fn leftmost_derivation_of_ab_in_exercise_2() {
        let d = run(EXERCISE_2, "ab");
        assert_eq!(d.forms, vec!["S", "aB", "ab"]);
        assert_eq!(d.steps[0].production, "S → aB");
        assert_eq!(d.steps[1], DerivationStep { production: "B → b".into(), position: 1, form: "ab".into() });
    }

    #[test]
    fn leftmost_and_rightmost_derivations_differ_but_share_the_tree() {
        let g = parse_general(ZERO_STAR_ONE).unwrap();
        let left = derive(&g, "01", DerivationOrder::Leftmost);
        let right = derive(&g, "01", DerivationOrder::Rightmost);
        assert_eq!(left.forms, vec!["S", "A1B", "0A1B", "01B", "01"]);
        assert_eq!(right.forms, vec!["S", "A1B", "A1", "0A1", "01"]);
        assert_eq!(left.tree, right.tree);
    }

    #[test]
    fn the_tree_of_a_context_free_derivation_has_epsilon_leaves() {
        let d = run(ZERO_STAR_ONE, "1");
        let tree = d.tree.unwrap();
        let root = &tree.nodes[tree.root];
        assert_eq!(root.label, "S");
        let labels: Vec<&str> = root.children.iter().map(|&c| tree.nodes[c].label.as_str()).collect();
        assert_eq!(labels, vec!["A", "1", "B"]);
        let a = &tree.nodes[root.children[0]];
        assert_eq!(a.children.len(), 1);
        assert_eq!(tree.nodes[a.children[0]].kind, NodeKind::Epsilon);
    }

    #[test]
    fn an_ambiguous_grammar_gets_its_smallest_tree_the_one_written_by_hand() {
        // Ejemplos gramáticas.pdf, -25: the inner <entero> is <digito><entero>,
        // not <signo><digito><entero> with an empty sign.
        let d = run("E -> GDE | DE | ε\nD -> 0|1|…|9\nG -> +|-|ε", "-25");
        let shown: Vec<&str> = d.steps.iter().map(|s| s.form.as_str()).collect();
        assert_eq!(shown, vec!["GDE", "-DE", "-2E", "-2DE", "-25E", "-25ε"]);
        let tree = d.tree.unwrap();
        let root = &tree.nodes[tree.root];
        let inner = &tree.nodes[root.children[2]];
        assert_eq!(inner.children.len(), 2);
    }

    #[test]
    fn a_highly_ambiguous_grammar_still_answers_quickly() {
        // S -> SS | a has a Catalan number of trees for a^n; picking the
        // smallest must not try them all.
        let started = std::time::Instant::now();
        assert!(accepts("S -> SS | a", &"a".repeat(30)));
        assert!(started.elapsed() < std::time::Duration::from_secs(2), "took {:?}", started.elapsed());
    }

    #[test]
    fn left_recursion_is_fine() {
        assert!(accepts("S -> Sa | b", "baaa"));
    }

    #[test]
    fn context_sensitive_derivation_exercise() {
        for w in ["abddcd", "aabddcd", "aadcddcdddcd"] {
            assert!(accepts(EXERCISE_DERIVATIONS, w), "{w} should be accepted");
        }
        // Type 1: the search space is finite, so a failure is a real rejection.
        assert_eq!(run(EXERCISE_DERIVATIONS, "abd").outcome, DeriveOutcome::Rejected);
    }

    #[test]
    fn a_context_keeping_rewrite_only_expands_the_rewritten_nonterminal() {
        // aaA -> aaBB is xAy -> xzy with x = aa: only A is rewritten (into
        // BB); the context a, a stays as it is, so the tree stays a tree.
        let d = run(EXERCISE_DERIVATIONS, "aadcddcdddcd");
        assert!(d.steps.iter().any(|s| s.production == "aaA → aaBB"));
        let tree = d.tree.unwrap();
        let mut parents = vec![0; tree.nodes.len()];
        for node in &tree.nodes {
            for &c in &node.children {
                parents[c] += 1;
            }
        }
        assert!(parents.iter().all(|&p| p <= 1), "every node has at most one parent");
        let expanded_a = tree
            .nodes
            .iter()
            .find(|n| n.label == "A" && n.children.iter().map(|&c| tree.nodes[c].label.as_str()).eq(["B", "B"]))
            .is_some();
        assert!(expanded_a, "A gets B, B as its children");
        assert_eq!(d.forms.last().unwrap(), "aadcddcdddcd");
    }

    #[test]
    fn a_rewrite_that_does_not_keep_its_context_joins_its_symbols_through_one_rule_node() {
        // abA -> baab is not xAy -> xzy: a, b and A all lead to one rule
        // node, which leads to b, a, a, b.
        let d = run(EXERCISE_1, "baaba");
        assert!(d.steps.iter().any(|s| s.production == "abA → baab"));
        let tree = d.tree.unwrap();
        let rules: Vec<usize> = (0..tree.nodes.len()).filter(|&i| tree.nodes[i].kind == NodeKind::Rule).collect();
        assert_eq!(rules.len(), 1);
        let rule = rules[0];
        assert_eq!(tree.nodes[rule].label, "abA → baab");
        let into_rule: Vec<&str> =
            tree.nodes.iter().filter(|n| n.children == vec![rule]).map(|n| n.label.as_str()).collect();
        assert_eq!(into_rule, vec!["a", "b", "A"]);
        let out: Vec<&str> = tree.nodes[rule].children.iter().map(|&c| tree.nodes[c].label.as_str()).collect();
        assert_eq!(out, vec!["b", "a", "a", "b"]);
    }

    #[test]
    fn a_single_symbol_erased_in_a_type_0_grammar_gets_an_epsilon_leaf_not_a_rule_node() {
        // Type 0 because of 0S1 -> 01; A -> ε has one symbol on the left.
        let d = run("S -> 0A1\nA -> ε\n0S1 -> 01", "01");
        let tree = d.tree.unwrap();
        assert!(tree.nodes.iter().all(|n| n.kind != NodeKind::Rule));
        let a = tree.nodes.iter().find(|n| n.label == "A").unwrap();
        assert_eq!(a.children.len(), 1);
        assert_eq!(tree.nodes[a.children[0]].kind, NodeKind::Epsilon);
    }

    #[test]
    fn unrestricted_exercise_1() {
        for w in ["a", "baaba", "abba", "abbbaaba"] {
            assert!(accepts(EXERCISE_1, w), "{w} should be accepted");
        }
    }

    #[test]
    fn unrestricted_shrinking_rule() {
        let g = "S -> 000S111\n0S1 -> 01";
        assert!(accepts(g, "000111"));
        let d = run(g, "0011");
        assert_eq!(d.outcome, DeriveOutcome::LimitReached, "type 0 never claims a rejection");
        assert!(d.reason.is_some());
    }

    #[test]
    fn a_symbol_outside_sigma_is_rejected_with_a_reason() {
        let d = run(EXERCISE_3, "abx");
        assert_eq!(d.outcome, DeriveOutcome::Rejected);
        assert!(d.reason.unwrap().contains("'x'"));
    }

    #[test]
    fn multi_character_terminals_and_spaces_in_the_input() {
        let g = "<s> -> 'if' c 'then' x | x";
        assert!(accepts(g, "if c then x"));
        assert!(accepts(g, "ifcthenx"));
        assert!(!accepts(g, "if c x"));
    }

    #[test]
    fn epsilon_input_can_be_typed_as_epsilon() {
        assert!(accepts("S -> aS | ε", "ε"));
        assert!(accepts("S -> aS | ε", "є"));
        assert!(accepts("S -> aS | ε", ""));
    }

    #[test]
    fn each_step_shows_its_form_with_epsilon_where_a_symbol_was_erased() {
        // Ejemplos gramáticas.pdf: <entero> ::= <digito><entero> ::= 5<entero> ::= 5 є
        let d = run("E -> DE | ε\nD -> 0|1|…|9", "5");
        let shown: Vec<&str> = d.steps.iter().map(|s| s.form.as_str()).collect();
        assert_eq!(shown, vec!["DE", "5E", "5ε"]);
        assert_eq!(d.forms.last().unwrap(), "5");
    }

    #[test]
    fn erasing_in_the_middle_shows_epsilon_in_place() {
        let d = run("S -> AB\nA -> ε\nB -> b", "b");
        let shown: Vec<&str> = d.steps.iter().map(|s| s.form.as_str()).collect();
        assert_eq!(shown, vec!["AB", "εB", "b"]);
    }

    #[test]
    fn every_step_rewrites_the_previous_form_into_the_next() {
        let d = run(EXERCISE_1, "abbbaaba");
        assert_eq!(d.forms.first().unwrap(), "S");
        assert_eq!(d.forms.last().unwrap(), "abbbaaba");
        assert_eq!(d.steps.len(), d.forms.len() - 1);
    }
}
