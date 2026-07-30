//! Plain intermediate representation of a parsed `.jff` document.
//!
//! **Provenance (design D5's "schema confirmation" spike, task 5.1/5.2):**
//! this shape is pinned not against a hand-drawn export (no GUI automation
//! tool was available to drive JFLAP's Swing UI in this environment) but
//! against the actual compiled `file.xml.{AbstractTransducer,
//! AutomatonTransducer, FSATransducer}` classes shipped in `idea/JFLAP7.1.jar`
//! — the exact code that both writes and reads `.jff` files. The element and
//! attribute names below are `javap -v` `ConstantValue` dumps of that jar's
//! own `private/public static final String *_NAME` fields, e.g.
//! `STATE_ID_NAME = "id"`, `TRANSITION_READ_NAME = "read"`. Both the reader
//! and writer bytecode in that class use the *same* constants, so there is
//! no drift risk between what JFLAP writes and what it accepts back.
//! Substitute-spike confidence: high (ground truth from the target jar's own
//! bytecode, not a guess or third-party tutorial) but not a substitute for
//! task 8.3's manual "reopen in real JFLAP 7.1" E2E check.
//!
//! Confirmed shape (`AbstractTransducer.newEmptyDocument`,
//! `AutomatonTransducer.{createStateElement,createTransitionElement,
//! readStates,readTransitions}`, `FSATransducer.{getType,
//! createTransitionElement,createTransition}`):
//!
//! ```xml
//! <?xml version="1.0" encoding="UTF-8" standalone="no"?>
//! <!--Created with JFLAP 7.1.-->
//! <structure>
//!     <type>fa</type>
//!     <automaton>
//!         <state id="0" name="q0">
//!             <x>50.0</x>
//!             <y>50.0</y>
//!             <initial/>
//!             <final/>
//!         </state>
//!         <transition>
//!             <from>0</from>
//!             <to>1</to>
//!             <read>a</read>
//!         </transition>
//!     </automaton>
//! </structure>
//! ```
//!
//! `id` is a required attribute (`STATE_ID_NAME`); its absence is a hard
//! `DataException` in real JFLAP ("State without id attribute encountered!"),
//! matched here as an import error, never a partial document (task 5.8).
//! `name` is an optional attribute (`STATE_NAME_NAME`) — JFLAP defaults to
//! `"q" + id` when absent/empty. `x`/`y` are required child elements
//! (`STATE_X_COORD_NAME`/`STATE_Y_COORD_NAME`); missing values are a hard
//! error in real JFLAP (NullPointerException path -> `DataException`),
//! matched here the same way. `initial`/`final` are presence-only empty
//! child elements (`STATE_INITIAL_NAME`/`STATE_FINAL_NAME`) — their content
//! is irrelevant, only whether the element exists.
//!
//! `from`/`to` are required child elements (`TRANSITION_FROM_NAME`/
//! `TRANSITION_TO_NAME`) holding a state `id`; missing/dangling references
//! are a hard `DataException` in real JFLAP, matched here as import errors.
//! `read` (`FSATransducer.TRANSITION_READ_NAME`) is always emitted by the
//! real writer (even for epsilon, as an empty element), but the real reader
//! tolerates an entirely absent `<read>` too (`Map.get` returns `null`,
//! folded to `""`). Both an absent `<read>` and an empty `<read></read>` mean
//! epsilon here.
//!
//! The root `<type>` text (`FSATransducer.getType() == "fa"`) is the only
//! discriminator between finite automata and other structure kinds; `"pda"`
//! and `"turing"` are the real strings used by JFLAP's own
//! `PDATransducer`/`TMTransducer` (confirmed the same way), used here only
//! to build a realistic non-FA rejection fixture — never actually
//! constructed by our writer.

/// A fully parsed `.jff` document, before any FA-specific conversion.
#[derive(Debug, Clone, PartialEq)]
pub struct JffFile {
    pub r#type: String,
    pub automaton: JffAutomaton,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct JffAutomaton {
    pub states: Vec<JffState>,
    pub transitions: Vec<JffTransition>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JffState {
    pub id: u32,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
    pub initial: bool,
    pub r#final: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JffTransition {
    pub from: u32,
    pub to: u32,
    /// `None` means the `<read>` element was entirely absent (still folds
    /// to epsilon on import, matching real JFLAP's `null` -> `""`
    /// fallback); `Some(String::new())` means an empty `<read></read>` (or
    /// self-closed `<read/>`) was present. Both are epsilon; only the
    /// distinction matters for round-trip byte fidelity, never semantics.
    pub read: Option<String>,
}

pub const FA_TYPE: &str = "fa";
