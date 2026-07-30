//! Visible, non-silent loss reporting for `.jff` import/export (spec
//! "Visible Loss Report on Lossy Conversion": any conversion that cannot
//! fully represent the source MUST produce a user-visible report; silent
//! data loss is prohibited).

/// How significant a single reported item is. `Info` is not data loss (the
/// conversion is exact) but is still worth surfacing; `Lossy` means the
/// value was approximated; `Dropped` means content was discarded entirely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Info,
    Lossy,
    Dropped,
}

/// Stable classification of *why* an item was reported, so callers (and
/// tests) can match on cause rather than parsing `detail` strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LossCode {
    /// The `.jff` `<type>` was not `"fa"` — import was refused entirely, no
    /// partial document created (spec "Reject non-FA .jff content").
    NonFaType,
    /// A `<read>` value is more than one character; imported as a single
    /// atomic symbol (matching JFLAP's own string-equality transition
    /// semantics), not silently truncated or split.
    MultiCharSymbol,
    /// More than one `<initial/>` state was present; the last one parsed
    /// wins (matching real JFLAP's own last-write-wins behavior), the
    /// others are reported.
    MultipleInitialStates,
    /// No state was marked `<initial/>`.
    NoInitialState,
    /// Two states resolved to the same name; the later one was
    /// disambiguated rather than silently merged or overwritten.
    DuplicateStateName,
    /// An XML element inside `<state>`/`<transition>`/`<automaton>` that
    /// this reader does not understand was skipped rather than
    /// interpreted.
    UnknownElementDropped,
    /// A required geometry value was missing/unreadable and was defaulted
    /// rather than failing the whole import.
    GeometryDefaulted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Import,
    Export,
}

/// What the item is about — a specific state/transition, or the document
/// as a whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Subject {
    Document,
    State(String),
    Edge { from: String, to: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LossItem {
    pub severity: Severity,
    pub code: LossCode,
    pub subject: Subject,
    pub detail: String,
}

/// The full report for one import or export call. Never swallowed by
/// callers — a non-empty report is always shown to the user (design D5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InteropReport {
    pub direction: Direction,
    pub items: Vec<LossItem>,
}

impl InteropReport {
    pub fn new(direction: Direction) -> Self {
        InteropReport { direction, items: Vec::new() }
    }

    pub fn push(&mut self, severity: Severity, code: LossCode, subject: Subject, detail: impl Into<String>) {
        self.items.push(LossItem { severity, code, subject, detail: detail.into() });
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// True if any item is `Lossy` or `Dropped` (not just `Info`) — the
    /// signal a caller would use to decide whether to warn more loudly.
    pub fn has_data_loss(&self) -> bool {
        self.items
            .iter()
            .any(|i| matches!(i.severity, Severity::Lossy | Severity::Dropped))
    }
}
