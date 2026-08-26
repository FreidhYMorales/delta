// Greek-letter-name -> symbol conversion, used wherever this app lets the
// user type a state name or a transition/alphabet symbol (across all 5
// machine kinds). Typing a recognized Greek letter's ENGLISH NAME
// ("delta", "sigma", ...) converts it to the actual glyph ("δ", "Σ") —
// this app's own formal-definition notation already uses these glyphs
// (Q/Σ/δ/q0/F), so recognizing the name someone actually types is a
// convenience, not a new convention.
//
// Case controls which form you get: an initial capital ("Delta", "SIGMA")
// gives the uppercase glyph; anything else gives lowercase. This mirrors
// how Σ (alphabet) is conventionally capital and δ (transition function)
// conventionally lowercase in the SAME formal notation, without hardcoding
// per-letter capitalization rules — the user just capitalizes what they
// want capitalized.

const GREEK_LETTERS = {
  alpha: ["α", "Α"],
  beta: ["β", "Β"],
  gamma: ["γ", "Γ"],
  delta: ["δ", "Δ"],
  epsilon: ["ε", "Ε"],
  zeta: ["ζ", "Ζ"],
  eta: ["η", "Η"],
  theta: ["θ", "Θ"],
  iota: ["ι", "Ι"],
  kappa: ["κ", "Κ"],
  lambda: ["λ", "Λ"],
  mu: ["μ", "Μ"],
  nu: ["ν", "Ν"],
  xi: ["ξ", "Ξ"],
  omicron: ["ο", "Ο"],
  pi: ["π", "Π"],
  rho: ["ρ", "Ρ"],
  sigma: ["σ", "Σ"],
  tau: ["τ", "Τ"],
  upsilon: ["υ", "Υ"],
  phi: ["φ", "Φ"],
  chi: ["χ", "Χ"],
  psi: ["ψ", "Ψ"],
  omega: ["ω", "Ω"],
};

/** @param {string} word @returns {string|null} the Greek glyph for `word`
 * (case-insensitive name match; initial capital -> uppercase glyph), or
 * `null` if `word` isn't a recognized Greek letter name. */
export function greekSymbolFor(word) {
  const entry = GREEK_LETTERS[word.toLowerCase()];
  if (!entry) return null;
  const [lower, upper] = entry;
  return /^[A-Z]/.test(word) ? upper : lower;
}

/** @param {string} text @returns {string} `text` with every maximal run of
 * ASCII letters that matches a recognized Greek letter name replaced by its
 * glyph — every other character (digits, punctuation, separators like `/`
 * or `,`, whitespace) passes through untouched. This is what lets a single
 * call handle a plain state name ("delta" -> "δ"), a comma-separated
 * alphabet ("delta, sigma, a" -> "δ, σ, a"), or a composite field like
 * Mealy's "input/output" transition format ("delta/sigma" -> "δ/σ")
 * uniformly, with no per-caller splitting logic. */
export function applyGreekSymbols(text) {
  return text.replace(/[A-Za-z]+/g, (word) => greekSymbolFor(word) ?? word);
}
