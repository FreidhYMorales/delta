"""Modelo de un autómata finito (AFD / AFN), independiente de la interfaz gráfica.

Toda la lógica formal vive acá: estados, alfabeto, función de transición y
simulación de cadenas. La GUI sólo lee y modifica este modelo.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Símbolo canónico para la transición vacía.
EPSILON = "ε"

#: Formas alternativas que el usuario puede escribir para referirse a épsilon.
#: A propósito no incluye "e" ni "l": son símbolos de alfabeto perfectamente
#: válidos y confundirlos con épsilon sería un error silencioso.
EPSILON_ALIASES = {EPSILON, "λ", "eps", "epsilon", "lambda", "vacio", "vacío"}


def normalize_symbol(raw: str) -> str:
    """Convierte lo que escribió el usuario en un símbolo canónico."""
    s = raw.strip()
    if s == "" or s.lower() in EPSILON_ALIASES:
        return EPSILON
    return s


def parse_symbol_list(raw: str) -> list[str]:
    """Parsea "a, b, ε" -> ["a", "b", "ε"], sin repetidos y respetando el orden."""
    out: list[str] = []
    for piece in raw.replace(";", ",").split(","):
        piece = piece.strip()
        if piece == "":
            continue
        sym = normalize_symbol(piece)
        if sym not in out:
            out.append(sym)
    return out


def parse_name_list(raw: str) -> list[str]:
    """Parsea una lista de nombres de estados separados por coma."""
    out: list[str] = []
    for piece in raw.replace(";", ",").replace("{", "").replace("}", "").split(","):
        piece = piece.strip()
        if piece and piece not in out:
            out.append(piece)
    return out


@dataclass
class State:
    """Un estado del autómata, con su posición en el lienzo."""

    name: str
    x: float = 0.0
    y: float = 0.0
    is_initial: bool = False
    is_final: bool = False


@dataclass
class Transition:
    """Todas las transiciones entre un par ordenado de estados.

    Se agrupan por par (origen, destino) porque en el diagrama se dibujan como
    una sola flecha etiquetada con varios símbolos.
    """

    source: str
    target: str
    symbols: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return ", ".join(self.symbols)


@dataclass
class SimulationStep:
    """Estado de la simulación después de consumir ``consumed`` símbolos."""

    consumed: int
    symbol: str | None  # símbolo recién consumido; None en el paso inicial
    states: set[str]


@dataclass
class Simulation:
    """Resultado completo de correr una cadena sobre el autómata."""

    word: str
    tokens: list[str]
    steps: list[SimulationStep]
    accepted: bool
    error: str | None = None

    @property
    def final_states(self) -> set[str]:
        return self.steps[-1].states if self.steps else set()


class Automaton:
    """Autómata finito. Admite no determinismo y transiciones épsilon."""

    def __init__(self) -> None:
        self.states: dict[str, State] = {}
        self.transitions: list[Transition] = []
        #: Alfabeto declarado explícitamente por el usuario. El alfabeto real
        #: es esto más cualquier símbolo que aparezca en las transiciones.
        self.declared_alphabet: list[str] = []

    # ------------------------------------------------------------------ #
    # Consultas
    # ------------------------------------------------------------------ #

    @property
    def state_names(self) -> list[str]:
        return list(self.states)

    @property
    def initial_state(self) -> str | None:
        for name, st in self.states.items():
            if st.is_initial:
                return name
        return None

    @property
    def final_states(self) -> list[str]:
        return [name for name, st in self.states.items() if st.is_final]

    @property
    def alphabet(self) -> list[str]:
        """Alfabeto efectivo: lo declarado, más lo usado, sin épsilon."""
        out = [s for s in self.declared_alphabet if s != EPSILON]
        for tr in self.transitions:
            for sym in tr.symbols:
                if sym != EPSILON and sym not in out:
                    out.append(sym)
        return out

    @property
    def uses_epsilon(self) -> bool:
        return any(EPSILON in tr.symbols for tr in self.transitions)

    def transition_between(self, source: str, target: str) -> Transition | None:
        for tr in self.transitions:
            if tr.source == source and tr.target == target:
                return tr
        return None

    def transitions_from(self, source: str) -> list[Transition]:
        return [tr for tr in self.transitions if tr.source == source]

    def targets(self, source: str, symbol: str) -> list[str]:
        """Estados alcanzables desde ``source`` consumiendo ``symbol``."""
        out: list[str] = []
        for tr in self.transitions:
            if tr.source == source and symbol in tr.symbols and tr.target not in out:
                out.append(tr.target)
        return out

    # ------------------------------------------------------------------ #
    # Edición: estados
    # ------------------------------------------------------------------ #

    def fresh_state_name(self) -> str:
        i = 0
        while f"q{i}" in self.states:
            i += 1
        return f"q{i}"

    def add_state(
        self,
        name: str | None = None,
        x: float = 0.0,
        y: float = 0.0,
    ) -> State:
        """Agrega un estado. Si ya existe, devuelve el existente."""
        if name is None:
            name = self.fresh_state_name()
        if name in self.states:
            return self.states[name]
        state = State(name=name, x=x, y=y)
        # El primer estado creado es el inicial por conveniencia.
        if not self.states:
            state.is_initial = True
        self.states[name] = state
        return state

    def remove_state(self, name: str) -> None:
        if name not in self.states:
            return
        del self.states[name]
        self.transitions = [
            tr for tr in self.transitions if tr.source != name and tr.target != name
        ]

    def rename_state(self, old: str, new: str) -> bool:
        """Renombra un estado. Devuelve False si el nombre nuevo ya está tomado."""
        new = new.strip()
        if not new or old not in self.states:
            return False
        if new == old:
            return True
        if new in self.states:
            return False
        # Reconstruir el dict preservando el orden de inserción.
        rebuilt: dict[str, State] = {}
        for key, st in self.states.items():
            if key == old:
                st.name = new
                rebuilt[new] = st
            else:
                rebuilt[key] = st
        self.states = rebuilt
        for tr in self.transitions:
            if tr.source == old:
                tr.source = new
            if tr.target == old:
                tr.target = new
        return True

    def set_initial(self, name: str | None) -> None:
        """Marca ``name`` como único estado inicial (o ninguno si es None)."""
        for key, st in self.states.items():
            st.is_initial = key == name

    def set_final(self, name: str, value: bool) -> None:
        if name in self.states:
            self.states[name].is_final = value

    def set_final_states(self, names: list[str]) -> None:
        wanted = set(names)
        for key, st in self.states.items():
            st.is_final = key in wanted

    def move_state(self, name: str, x: float, y: float) -> None:
        if name in self.states:
            self.states[name].x = x
            self.states[name].y = y

    # ------------------------------------------------------------------ #
    # Edición: transiciones
    # ------------------------------------------------------------------ #

    def set_symbols(self, source: str, target: str, symbols: list[str]) -> None:
        """Fija los símbolos de source->target. Con lista vacía, borra la flecha."""
        existing = self.transition_between(source, target)
        if not symbols:
            if existing:
                self.transitions.remove(existing)
            return
        if existing:
            existing.symbols = list(symbols)
        else:
            self.transitions.append(Transition(source, target, list(symbols)))

    def add_symbols(self, source: str, target: str, symbols: list[str]) -> None:
        """Agrega símbolos a source->target sin pisar los que ya estaban."""
        existing = self.transition_between(source, target)
        if existing is None:
            self.transitions.append(Transition(source, target, list(symbols)))
            return
        for sym in symbols:
            if sym not in existing.symbols:
                existing.symbols.append(sym)

    def remove_transition(self, source: str, target: str) -> None:
        tr = self.transition_between(source, target)
        if tr:
            self.transitions.remove(tr)

    def set_row(self, source: str, symbol: str, targets: list[str]) -> None:
        """Define δ(source, symbol) = targets, como una celda de la tabla.

        Quita ``symbol`` de las flechas que salen de ``source`` y no estén en
        ``targets``, y lo agrega a las que sí.
        """
        wanted = set(targets)
        for tr in list(self.transitions):
            if tr.source != source:
                continue
            if tr.target in wanted:
                if symbol not in tr.symbols:
                    tr.symbols.append(symbol)
            elif symbol in tr.symbols:
                tr.symbols.remove(symbol)
                if not tr.symbols:
                    self.transitions.remove(tr)
        for target in targets:
            if self.transition_between(source, target) is None:
                self.transitions.append(Transition(source, target, [symbol]))

    def rename_symbol(self, old: str, new: str) -> None:
        """Renombra un símbolo en todo el autómata (alfabeto y transiciones)."""
        if old == new:
            return
        self.declared_alphabet = [
            new if s == old else s for s in self.declared_alphabet
        ]
        for tr in self.transitions:
            tr.symbols = [new if s == old else s for s in tr.symbols]
            # Evitar duplicados si new ya estaba en la misma flecha.
            seen: list[str] = []
            for s in tr.symbols:
                if s not in seen:
                    seen.append(s)
            tr.symbols = seen

    def remove_symbol(self, symbol: str) -> None:
        self.declared_alphabet = [s for s in self.declared_alphabet if s != symbol]
        for tr in list(self.transitions):
            if symbol in tr.symbols:
                tr.symbols.remove(symbol)
                if not tr.symbols:
                    self.transitions.remove(tr)

    # ------------------------------------------------------------------ #
    # Análisis
    # ------------------------------------------------------------------ #

    def determinism_issues(self) -> list[str]:
        """Razones por las que el autómata NO es un AFD. Vacío => es un AFD."""
        issues: list[str] = []
        if self.uses_epsilon:
            issues.append("Tiene transiciones ε.")
        alphabet = self.alphabet
        for name in self.states:
            for sym in alphabet:
                targets = self.targets(name, sym)
                if len(targets) > 1:
                    issues.append(
                        f"δ({name}, {sym}) tiene {len(targets)} destinos: "
                        f"{', '.join(targets)}."
                    )
                elif not targets:
                    issues.append(f"δ({name}, {sym}) no está definida.")
        return issues

    def is_deterministic(self) -> bool:
        return not self.determinism_issues()

    def validate(self) -> list[str]:
        """Problemas que impiden simular el autómata."""
        problems: list[str] = []
        if not self.states:
            problems.append("El autómata no tiene estados.")
        if self.initial_state is None:
            problems.append("No hay estado inicial.")
        if not self.final_states:
            problems.append("No hay estados de aceptación.")
        return problems

    # ------------------------------------------------------------------ #
    # Simulación
    # ------------------------------------------------------------------ #

    def tokenize(self, word: str) -> list[str]:
        """Parte una cadena en símbolos del alfabeto.

        Prioriza los símbolos más largos, para soportar alfabetos con símbolos
        de más de un carácter (por ejemplo ``a1`` o ``id``). Si nada coincide,
        toma un carácter suelto: la validación posterior lo reportará.
        """
        symbols = sorted(self.alphabet, key=len, reverse=True)
        tokens: list[str] = []
        i = 0
        while i < len(word):
            for sym in symbols:
                if sym and word.startswith(sym, i):
                    tokens.append(sym)
                    i += len(sym)
                    break
            else:
                tokens.append(word[i])
                i += 1
        return tokens

    def epsilon_closure(self, states: set[str]) -> set[str]:
        """Todos los estados alcanzables usando sólo transiciones ε."""
        closure = set(states)
        pending = list(states)
        while pending:
            current = pending.pop()
            for target in self.targets(current, EPSILON):
                if target not in closure:
                    closure.add(target)
                    pending.append(target)
        return closure

    def step(self, states: set[str], symbol: str) -> set[str]:
        """Un paso de la simulación: consume ``symbol`` desde el conjunto dado."""
        moved: set[str] = set()
        for state in states:
            moved.update(self.targets(state, symbol))
        return self.epsilon_closure(moved)

    def simulate(self, word: str) -> Simulation:
        """Corre ``word`` y devuelve la traza completa, paso a paso."""
        initial = self.initial_state
        if initial is None:
            return Simulation(word, [], [], False, "No hay estado inicial.")

        tokens = self.tokenize(word)
        alphabet = set(self.alphabet)
        unknown = [t for t in tokens if t not in alphabet]
        error = None
        if unknown:
            error = (
                "Símbolos fuera del alfabeto: "
                + ", ".join(sorted(set(unknown)))
            )

        current = self.epsilon_closure({initial})
        steps = [SimulationStep(0, None, set(current))]
        for i, token in enumerate(tokens, start=1):
            current = self.step(current, token)
            steps.append(SimulationStep(i, token, set(current)))
            if not current:
                # Se trabó: no hay a dónde seguir.
                break

        finals = set(self.final_states)
        consumed_all = steps[-1].consumed == len(tokens)
        accepted = bool(consumed_all and (current & finals)) and error is None
        return Simulation(word, tokens, steps, accepted, error)

    def accepts(self, word: str) -> bool:
        return self.simulate(word).accepted

    # ------------------------------------------------------------------ #
    # Serialización
    # ------------------------------------------------------------------ #

    def to_dict(self) -> dict:
        return {
            "version": 1,
            "type": "finite-automaton",
            "alphabet": list(self.declared_alphabet),
            "states": [
                {
                    "name": st.name,
                    "x": st.x,
                    "y": st.y,
                    "initial": st.is_initial,
                    "final": st.is_final,
                }
                for st in self.states.values()
            ],
            "transitions": [
                {"from": tr.source, "to": tr.target, "symbols": list(tr.symbols)}
                for tr in self.transitions
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> Automaton:
        auto = cls()
        auto.declared_alphabet = [normalize_symbol(s) for s in data.get("alphabet", [])]
        for raw in data.get("states", []):
            state = State(
                name=raw["name"],
                x=float(raw.get("x", 0.0)),
                y=float(raw.get("y", 0.0)),
                is_initial=bool(raw.get("initial", False)),
                is_final=bool(raw.get("final", False)),
            )
            auto.states[state.name] = state
        for raw in data.get("transitions", []):
            symbols = [normalize_symbol(s) for s in raw.get("symbols", [])]
            auto.transitions.append(Transition(raw["from"], raw["to"], symbols))
        return auto

    def copy(self) -> Automaton:
        return Automaton.from_dict(self.to_dict())
