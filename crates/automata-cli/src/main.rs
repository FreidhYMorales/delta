//! Direct CLI over `automata-core`, bypassing the Tauri/GUI layer entirely.
//!
//! Exists so backend logic (correctness and performance) can be exercised
//! with cases larger and more adversarial than are practical to build by
//! hand in the GUI: see `sim` (run real/native files), `inspect` (structural
//! summary), `stress` (synthetic worst-case topologies with timing), and
//! `mealy-sim`/`mealy-inspect` (same idea, for Mealy machines — there's no
//! GUI for those at all yet, so this is the only way to exercise them).
//! `moore-sim`/`moore-inspect` are the same idea again, for Moore machines.

use std::fs;
use std::process::ExitCode;
use std::time::Instant;

use automata_core::convert::{fa_to_regex, fa_to_regular_grammar, minimize_dfa, nfa_to_dfa};
use automata_core::dto;
use automata_core::engine::fa::FaEngine;
use automata_core::engine::mealy::{run_mealy, MealyOutcome};
use automata_core::engine::moore::{run_moore, MooreOutcome};
use automata_core::engine::{run_bounded, Budget};
use automata_core::ids::SymbolId;
use automata_core::interop::jff::reader;
use automata_core::model::fa::{Classification, FaDoc};
use automata_core::model::mealy::MealyDoc;
use automata_core::model::moore::MooreDoc;

use clap::{Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(name = "automata-cli", about = "Exercise automata-core directly, without the GUI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Load a document and run one or many strings through it.
    Sim {
        /// Path to a native (.json) or JFLAP (.jff) document.
        #[arg(long)]
        file: String,
        /// Space-separated symbols, e.g. "a b a". Omit for the empty string.
        #[arg(long)]
        word: Option<String>,
        /// File with one word per line (space-separated symbols), run as a batch.
        #[arg(long)]
        words_file: Option<String>,
        #[arg(long, default_value_t = 10_000)]
        max_steps: usize,
        #[arg(long, default_value_t = 5_000)]
        max_configs: usize,
        /// Print the full step-by-step active-state-id trace, not just the outcome.
        #[arg(long)]
        trace: bool,
    },
    /// Load a document and print its structure (states, alphabet, classification, engine sizes).
    Inspect {
        #[arg(long)]
        file: String,
    },
    /// Convert an NFA (or DFA) to an equivalent DFA via subset construction.
    Convert {
        #[arg(long)]
        file: String,
        /// Save the resulting DFA as native JSON. Without this, only prints a summary.
        #[arg(long)]
        out: Option<String>,
    },
    /// Minimize a DFA by partition refinement. Fails if the input isn't already deterministic.
    Minimize {
        #[arg(long)]
        file: String,
        /// Save the resulting DFA as native JSON. Without this, only prints a summary.
        #[arg(long)]
        out: Option<String>,
    },
    /// Convert an FA (DFA or NFA) to an equivalent right-linear grammar.
    ToGrammar {
        #[arg(long)]
        file: String,
    },
    /// Convert an FA (DFA or NFA) to an equivalent regular expression (GNFA state elimination).
    ToRegex {
        #[arg(long)]
        file: String,
    },
    /// Load a Mealy machine (native JSON only) and print its structure.
    MealyInspect {
        #[arg(long)]
        file: String,
    },
    /// Load a Mealy machine and run one or many inputs through it, printing
    /// the output string each one produces (or exactly where it got stuck).
    MealySim {
        #[arg(long)]
        file: String,
        /// Space-separated input symbols, e.g. "0 1 1 0". Omit for the empty input.
        #[arg(long)]
        input: Option<String>,
        /// File with one input per line (space-separated symbols), run as a batch.
        #[arg(long)]
        inputs_file: Option<String>,
    },
    /// Load a Moore machine (native JSON only) and print its structure.
    MooreInspect {
        #[arg(long)]
        file: String,
    },
    /// Load a Moore machine and run one or many inputs through it, printing
    /// the output sequence each one produces (length input.len()+1, since
    /// the initial state's own output is emitted before any input is
    /// consumed) — or exactly where it got stuck.
    MooreSim {
        #[arg(long)]
        file: String,
        /// Space-separated input symbols, e.g. "0 1 1 0". Omit for the empty input.
        #[arg(long)]
        input: Option<String>,
        /// File with one input per line (space-separated symbols), run as a batch.
        #[arg(long)]
        inputs_file: Option<String>,
    },
    /// Synthesize a worst-case-shaped automaton and time compile + simulation.
    Stress {
        #[arg(value_enum, long, default_value_t = Topology::Chain)]
        topology: Topology,
        #[arg(long, default_value_t = 1_000)]
        states: usize,
        #[arg(long, default_value_t = 10_000)]
        input_len: usize,
        #[arg(long, default_value_t = 100_000)]
        max_steps: usize,
        #[arg(long, default_value_t = 50_000)]
        max_configs: usize,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum Topology {
    /// q0 -a-> q1 -a-> ... -> q(n-1), self-loop on the last state. No
    /// epsilon transitions: baseline, cheapest shape for the engine.
    Chain,
    /// Same shape as `chain`, but every edge is epsilon instead of on `a`.
    /// Worst case for `FaEngine::compile`'s epsilon-closure precompute,
    /// which is O(states * (states + edges)) and stores one
    /// states-sized bitset per state.
    EpsilonChain,
    /// Every state has an edge to every other state on every symbol of a
    /// small fixed alphabet. Worst case for `delta` map size and per-step
    /// branching fan-out.
    Dense,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli.command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Sim { file, word, words_file, max_steps, max_configs, trace } => {
            let doc = load_doc(&file)?;
            let engine = FaEngine::compile(&doc);
            let budget = Budget { max_steps, max_configs };

            let words = collect_words(word, words_file)?;
            for w in words {
                let input = word_to_symbols(&doc, &w);
                let start = Instant::now();
                let result = run_bounded(&engine, &input, budget);
                let elapsed = start.elapsed();
                println!(
                    "{:?}  word={:?}  steps={}  elapsed={:?}",
                    result.outcome,
                    w,
                    result.steps.len(),
                    elapsed
                );
                if trace {
                    for (i, step) in result.steps.iter().enumerate() {
                        let mut ids: Vec<u32> = step
                            .configs
                            .iter()
                            .flat_map(|cfg| cfg.0.ones().map(|i| i as u32))
                            .collect();
                        ids.sort_unstable();
                        ids.dedup();
                        println!("  [{i}] active states: {ids:?}");
                    }
                }
            }
            Ok(())
        }

        Command::Inspect { file } => {
            let doc = load_doc(&file)?;
            let engine = FaEngine::compile(&doc);
            let state_count = doc.states().count();
            let accepting_count = doc.states().filter(|&s| doc.is_accepting(s)).count();
            let alphabet_size = doc.alphabet().len();
            let classification = classification_str(doc.classify());
            let max_closure_bits: usize =
                engine.eps_closure.iter().map(|c| c.count_ones(..)).max().unwrap_or(0);

            println!("states:            {state_count}");
            println!("accepting states:  {accepting_count}");
            println!("alphabet size:     {alphabet_size}");
            println!("classification:    {classification}");
            println!("initial state set: {}", doc.initial_state().is_some());
            println!("delta entries:     {}", engine.delta.len());
            println!("largest eps-closure: {max_closure_bits} state(s)");
            Ok(())
        }

        Command::Convert { file, out } => {
            let doc = load_doc(&file)?;
            let before_states = doc.states().count();
            let before_class = doc.classify();

            let start = Instant::now();
            let dfa = nfa_to_dfa(&doc);
            let elapsed = start.elapsed();

            println!("entrada:  {before_states} estados, {}", classification_str(before_class));
            println!("salida:   {} estados, {}", dfa.states().count(), classification_str(dfa.classify()));
            println!("tiempo:   {elapsed:?}");

            if let Some(out) = out {
                let json = dto::save_to_string(&dfa).map_err(|e| e.to_string())?;
                fs::write(&out, json).map_err(|e| format!("failed to write {out}: {e}"))?;
                println!("guardado: {out}");
            }
            Ok(())
        }

        Command::Minimize { file, out } => {
            let doc = load_doc(&file)?;
            let before_states = doc.states().count();

            let start = Instant::now();
            let min = minimize_dfa(&doc).map_err(|e| e.to_string())?;
            let elapsed = start.elapsed();

            println!("entrada:  {before_states} estados");
            println!("salida:   {} estados", min.states().count());
            println!("tiempo:   {elapsed:?}");

            if let Some(out) = out {
                let json = dto::save_to_string(&min).map_err(|e| e.to_string())?;
                fs::write(&out, json).map_err(|e| format!("failed to write {out}: {e}"))?;
                println!("guardado: {out}");
            }
            Ok(())
        }

        Command::ToGrammar { file } => {
            let doc = load_doc(&file)?;
            let grammar = fa_to_regular_grammar(&doc);
            print!("{grammar}");
            Ok(())
        }

        Command::ToRegex { file } => {
            let doc = load_doc(&file)?;
            let start = Instant::now();
            let r = fa_to_regex(&doc);
            let elapsed = start.elapsed();
            println!("{r}");
            eprintln!("(tiempo: {elapsed:?})");
            Ok(())
        }

        Command::MealyInspect { file } => {
            let doc = load_mealy_doc(&file)?;
            let state_count = doc.states().count();
            let transition_count: usize = doc.edges().map(|(_, t)| t.len()).sum();
            println!("states:            {state_count}");
            println!("transitions:       {transition_count}");
            println!("input alphabet:    {}", doc.input_alphabet().len());
            println!("output alphabet:   {}", doc.output_alphabet().len());
            println!("initial state set: {}", doc.initial_state().is_some());
            println!("deterministic:     {}", doc.is_deterministic());
            Ok(())
        }

        Command::MealySim { file, input, inputs_file } => {
            let doc = load_mealy_doc(&file)?;
            let inputs = collect_words(input, inputs_file)?;
            for w in inputs {
                let symbols: Vec<&str> = w.iter().map(String::as_str).collect();
                let outcome = run_mealy(&doc, &symbols);
                match outcome {
                    MealyOutcome::Completed(outputs) => {
                        println!("input={:?}  output={:?}", w, outputs.join(" "));
                    }
                    MealyOutcome::NoInitialState => println!("input={w:?}  sin estado inicial"),
                    MealyOutcome::NoTransition { at } => {
                        println!("input={w:?}  sin transición en la posición {at} (símbolo {:?})", w[at]);
                    }
                    MealyOutcome::Ambiguous { at } => {
                        println!(
                            "input={w:?}  ambiguo (no determinista) en la posición {at} (símbolo {:?})",
                            w[at]
                        );
                    }
                }
            }
            Ok(())
        }

        Command::MooreInspect { file } => {
            let doc = load_moore_doc(&file)?;
            let state_count = doc.states().count();
            let transition_count: usize = doc.edges().map(|(_, inputs)| inputs.len()).sum();
            let outputs_set = doc.states().filter(|&s| doc.output(s).is_some()).count();
            println!("states:            {state_count}");
            println!("transitions:       {transition_count}");
            println!("input alphabet:    {}", doc.input_alphabet().len());
            println!("output alphabet:   {}", doc.output_alphabet().len());
            println!("states with output set: {outputs_set}");
            println!("initial state set: {}", doc.initial_state().is_some());
            println!("deterministic:     {}", doc.is_deterministic());
            Ok(())
        }

        Command::MooreSim { file, input, inputs_file } => {
            let doc = load_moore_doc(&file)?;
            let inputs = collect_words(input, inputs_file)?;
            for w in inputs {
                let symbols: Vec<&str> = w.iter().map(String::as_str).collect();
                let outcome = run_moore(&doc, &symbols);
                match outcome {
                    MooreOutcome::Completed(outputs) => {
                        println!("input={:?}  output={:?}", w, outputs.join(" "));
                    }
                    MooreOutcome::NoInitialState => println!("input={w:?}  sin estado inicial"),
                    MooreOutcome::NoTransition { at } => {
                        println!("input={w:?}  sin transición en la posición {at} (símbolo {:?})", w[at]);
                    }
                    MooreOutcome::Ambiguous { at } => {
                        println!(
                            "input={w:?}  ambiguo (no determinista) en la posición {at} (símbolo {:?})",
                            w[at]
                        );
                    }
                }
            }
            Ok(())
        }

        Command::Stress { topology, states, input_len, max_steps, max_configs } => {
            if states < 2 {
                return Err("stress requires at least 2 states".to_string());
            }
            let build_start = Instant::now();
            let doc = synthesize(topology, states);
            let build_elapsed = build_start.elapsed();

            let compile_start = Instant::now();
            let engine = FaEngine::compile(&doc);
            let compile_elapsed = compile_start.elapsed();

            let a = doc.symbol_label_to_id("a").expect("synthesize always interns \"a\"");
            let input: Vec<SymbolId> = std::iter::repeat_n(a, input_len).collect();
            let budget = Budget { max_steps, max_configs };

            let run_start = Instant::now();
            let result = run_bounded(&engine, &input, budget);
            let run_elapsed = run_start.elapsed();

            let closure_bits_total: usize = engine.eps_closure.iter().map(|c| c.len()).sum();

            println!("topology:          {}", topology_name(topology));
            println!("states:            {states}");
            println!("input length:      {input_len}");
            println!("build doc:         {build_elapsed:?}");
            println!("compile engine:    {compile_elapsed:?}");
            println!("run simulation:    {run_elapsed:?}  ({:?}, {} steps)", result.outcome, result.steps.len());
            println!("delta entries:     {}", engine.delta.len());
            println!(
                "eps-closure bits:  {closure_bits_total} total (~{:.1} MiB)",
                closure_bits_total as f64 / 8.0 / 1024.0 / 1024.0
            );
            if doc.classify() == Classification::Dfa {
                let minimize_start = Instant::now();
                let min = minimize_dfa(&doc).expect("checked classify() == Dfa above");
                let minimize_elapsed = minimize_start.elapsed();
                println!("minimize:          {minimize_elapsed:?}  ({} -> {} states)", states, min.states().count());
            } else {
                println!("minimize:          skipped (not a DFA)");
            }
            Ok(())
        }
    }
}

fn topology_name(t: Topology) -> &'static str {
    match t {
        Topology::Chain => "chain",
        Topology::EpsilonChain => "epsilon-chain",
        Topology::Dense => "dense",
    }
}

fn classification_str(c: Classification) -> &'static str {
    match c {
        Classification::Dfa => "DFA",
        Classification::Nfa => "NFA",
    }
}

/// Load a document from a `.jff` (JFLAP XML) or native `.json` file, chosen
/// by extension. Mirrors what `doc_open`/`jff_import` do in `src-tauri`.
fn load_doc(path: &str) -> Result<FaDoc, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("failed to read {path}: {e}"))?;
    if path.ends_with(".jff") {
        let (doc, report) = reader::import_str(&text).map_err(|e| e.to_string())?;
        for item in &report.items {
            eprintln!("[import] {:?} {:?}: {}", item.severity, item.code, item.detail);
        }
        Ok(doc)
    } else {
        dto::load_from_str(&text).map_err(|e| e.to_string())
    }
}

/// Native JSON only — no `.jff` for Mealy machines yet (out of scope for
/// this round; see docs/decisions.md).
fn load_mealy_doc(path: &str) -> Result<MealyDoc, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("failed to read {path}: {e}"))?;
    dto::mealy_load_from_str(&text).map_err(|e| e.to_string())
}

/// Native JSON only — no `.jff` for Moore machines yet, same scope cut as
/// Mealy (see docs/decisions.md).
fn load_moore_doc(path: &str) -> Result<MooreDoc, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("failed to read {path}: {e}"))?;
    dto::moore_load_from_str(&text).map_err(|e| e.to_string())
}

fn collect_words(word: Option<String>, words_file: Option<String>) -> Result<Vec<Vec<String>>, String> {
    let mut words = Vec::new();
    if let Some(w) = word {
        words.push(split_word(&w));
    }
    if let Some(path) = words_file {
        let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
        for line in text.lines() {
            if !line.trim().is_empty() {
                words.push(split_word(line));
            }
        }
    }
    if words.is_empty() {
        words.push(Vec::new()); // no --word/--words-file: run the empty string
    }
    Ok(words)
}

fn split_word(w: &str) -> Vec<String> {
    w.split_whitespace().map(str::to_string).collect()
}

/// Resolve each word symbol to its interned `SymbolId`. A symbol absent from
/// the document's alphabet is given a sentinel id that cannot match any real
/// `delta` entry (real ids are dense from 0), matching `commands::sim`'s
/// behavior in `src-tauri` so CLI and GUI results agree.
fn word_to_symbols(doc: &FaDoc, word: &[String]) -> Vec<SymbolId> {
    word.iter()
        .enumerate()
        .map(|(i, s)| doc.symbol_label_to_id(s).unwrap_or(SymbolId(u32::MAX - i as u32)))
        .collect()
}

/// Build a synthetic `FaDoc` with `states` states in the given `topology`,
/// always over alphabet `{"a"}` alone (`Dense` also uses `"b"`), always
/// accepting only the last-created state so a `chain`/`epsilon-chain` run
/// over all-`"a"` input accepts deterministically.
fn synthesize(topology: Topology, states: usize) -> FaDoc {
    let mut doc = FaDoc::new();
    let ids: Vec<_> = (0..states)
        .map(|i| doc.add_state(&format!("q{i}"), 0.0, 0.0).expect("fresh label"))
        .collect();
    doc.set_initial(Some(ids[0]));
    doc.set_accepting(*ids.last().expect("states >= 2 checked by caller"), true);

    match topology {
        Topology::Chain => {
            for w in ids.windows(2) {
                doc.add_transition(w[0], w[1], "a");
            }
            let last = *ids.last().unwrap();
            doc.add_transition(last, last, "a"); // absorb remaining input
        }
        Topology::EpsilonChain => {
            for w in ids.windows(2) {
                doc.add_epsilon_transition(w[0], w[1]);
            }
            let last = *ids.last().unwrap();
            doc.add_transition(last, last, "a");
        }
        Topology::Dense => {
            doc.intern_symbol("b");
            for &from in &ids {
                for &to in &ids {
                    doc.add_transition(from, to, "a");
                    doc.add_transition(from, to, "b");
                }
            }
        }
    }
    doc
}
