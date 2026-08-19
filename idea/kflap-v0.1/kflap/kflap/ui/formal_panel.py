"""Definición formal del autómata: la quíntupla M = (Q, Σ, δ, q₀, F).

Se puede editar directamente acá; al aplicar, el diagrama y la tabla se
reconstruyen a partir de lo que se escribió.
"""

from __future__ import annotations

import math
import re

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ..core.automaton import (
    EPSILON,
    normalize_symbol,
    parse_name_list,
    parse_symbol_list,
)
from ..core.document import AutomatonDocument
from . import theme

NO_INITIAL = "— ninguno —"

#: δ(q0, a) = q1   |   (q0, a) = q1
DELTA_CALL_RE = re.compile(
    r"^\s*(?:δ|d|delta)?\s*\(\s*(?P<src>[^,()]+?)\s*,\s*(?P<sym>[^,()]*?)\s*\)"
    r"\s*(?:=|->|→|:)\s*(?P<dst>.+?)\s*$",
    re.IGNORECASE,
)
#: q0, a -> q1
DELTA_ARROW_RE = re.compile(
    r"^\s*(?P<src>[^,()]+?)\s*,\s*(?P<sym>[^,()]*?)\s*(?:->|→|=>|=)\s*(?P<dst>.+?)\s*$"
)


def parse_delta(text: str) -> tuple[list[tuple[str, str, list[str]]], list[str]]:
    """Parsea el cuerpo de δ. Devuelve (reglas, errores)."""
    rules: list[tuple[str, str, list[str]]] = []
    errors: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = DELTA_CALL_RE.match(line) or DELTA_ARROW_RE.match(line)
        if not match:
            errors.append(f"Línea {number}: no entiendo «{line}».")
            continue
        source = match.group("src").strip()
        symbol = normalize_symbol(match.group("sym"))
        targets = parse_name_list(match.group("dst"))
        if not source or not targets:
            errors.append(f"Línea {number}: falta el origen o el destino.")
            continue
        rules.append((source, symbol, targets))
    return rules, errors


def format_delta(auto) -> str:
    """Escribe δ como una regla por línea, ordenada por estado y símbolo."""
    lines: list[str] = []
    symbols = auto.alphabet + ([EPSILON] if auto.uses_epsilon else [])
    for name in auto.state_names:
        for symbol in symbols:
            targets = auto.targets(name, symbol)
            if not targets:
                continue
            right = targets[0] if len(targets) == 1 else "{" + ", ".join(targets) + "}"
            lines.append(f"δ({name}, {symbol}) = {right}")
    return "\n".join(lines)


class FormalPanel(QWidget):
    """Editor de la definición formal."""

    status_message = Signal(str)

    def __init__(self, document: AutomatonDocument, parent=None) -> None:
        super().__init__(parent)
        self.document = document
        self._loading = False

        root = QVBoxLayout(self)
        root.setContentsMargins(14, 10, 14, 14)
        root.setSpacing(10)

        grid = QGridLayout()
        grid.setHorizontalSpacing(10)
        grid.setVerticalSpacing(8)
        grid.setColumnStretch(1, 1)

        self.q_edit = QLineEdit()
        self.q_edit.setObjectName("Mono")
        self.q_edit.setPlaceholderText("q0, q1, q2")

        self.sigma_edit = QLineEdit()
        self.sigma_edit.setObjectName("Mono")
        self.sigma_edit.setPlaceholderText("a, b")

        self.q0_combo = QComboBox()

        self.f_edit = QLineEdit()
        self.f_edit.setObjectName("Mono")
        self.f_edit.setPlaceholderText("q1")

        rows = [
            ("Q", "Conjunto finito de estados", self.q_edit),
            ("Σ", "Alfabeto de entrada", self.sigma_edit),
            ("q₀", "Estado inicial", self.q0_combo),
            ("F", "Estados de aceptación", self.f_edit),
        ]
        for row, (symbol, tip, widget) in enumerate(rows):
            label = QLabel(symbol)
            label.setObjectName("Title")
            label.setToolTip(tip)
            label.setAlignment(
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            )
            label.setMinimumWidth(24)
            grid.addWidget(label, row, 0)
            grid.addWidget(widget, row, 1)
        root.addLayout(grid)

        delta_label = QLabel("δ")
        delta_label.setObjectName("Title")
        delta_label.setToolTip("Función de transición")
        delta_header = QHBoxLayout()
        delta_header.addWidget(delta_label)
        delta_hint = QLabel("una regla por línea:  δ(q0, a) = q1")
        delta_hint.setObjectName("Subtle")
        delta_header.addWidget(delta_hint)
        delta_header.addStretch(1)
        root.addLayout(delta_header)

        self.delta_edit = QPlainTextEdit()
        self.delta_edit.setObjectName("Mono")
        self.delta_edit.setPlaceholderText("δ(q0, a) = q1\nδ(q0, b) = q0")
        root.addWidget(self.delta_edit, 1)

        buttons = QHBoxLayout()
        buttons.setSpacing(8)
        apply_button = QPushButton("Aplicar definición")
        apply_button.setObjectName("Primary")
        apply_button.clicked.connect(self.apply_definition)
        revert = QPushButton("Descartar cambios")
        revert.clicked.connect(self.reload)
        buttons.addWidget(apply_button)
        buttons.addWidget(revert)
        buttons.addStretch(1)
        root.addLayout(buttons)

        self.summary = QLabel()
        self.summary.setObjectName("Subtle")
        self.summary.setWordWrap(True)
        self.summary.setTextFormat(Qt.TextFormat.RichText)
        root.addWidget(self.summary)

        self.document.structure_changed.connect(self.reload)
        self.reload()

    # ------------------------------------------------------------------ #
    # Modelo -> vista
    # ------------------------------------------------------------------ #

    def reload(self) -> None:
        auto = self.document.automaton
        self._loading = True
        try:
            self.q_edit.setText(", ".join(auto.state_names))
            self.sigma_edit.setText(", ".join(auto.alphabet))
            self.f_edit.setText(", ".join(auto.final_states))

            self.q0_combo.clear()
            self.q0_combo.addItem(NO_INITIAL)
            self.q0_combo.addItems(auto.state_names)
            initial = auto.initial_state
            self.q0_combo.setCurrentText(initial if initial else NO_INITIAL)

            self.delta_edit.setPlainText(format_delta(auto))
        finally:
            self._loading = False
        self._update_summary()

    def _update_summary(self) -> None:
        auto = self.document.automaton
        states = ", ".join(auto.state_names) or "∅"
        alphabet = ", ".join(auto.alphabet) or "∅"
        initial = auto.initial_state or "—"
        finals = ", ".join(auto.final_states) or "∅"
        kind = "AFD" if auto.is_deterministic() else "AFN"
        color = theme.ACCENT if kind == "AFD" else theme.VIOLET
        self.summary.setText(
            f"<b style='color:{color}'>{kind}</b> &nbsp; "
            f"M = ({{{states}}}, {{{alphabet}}}, δ, {initial}, {{{finals}}})"
        )

    # ------------------------------------------------------------------ #
    # Vista -> modelo
    # ------------------------------------------------------------------ #

    def apply_definition(self) -> None:
        names = parse_name_list(self.q_edit.text())
        alphabet = parse_symbol_list(self.sigma_edit.text())
        initial = self.q0_combo.currentText()
        finals = parse_name_list(self.f_edit.text())
        rules, errors = parse_delta(self.delta_edit.toPlainText())

        if errors:
            self.status_message.emit(errors[0])
            return

        # Estados nombrados sólo dentro de δ o F también cuentan.
        for source, _symbol, targets in rules:
            for name in [source, *targets]:
                if name not in names:
                    names.append(name)
        for name in finals:
            if name not in names:
                names.append(name)
        if initial != NO_INITIAL and initial not in names:
            names.append(initial)

        if not names:
            self.status_message.emit("Q no puede estar vacío.")
            return

        auto = self.document.automaton
        # Conservar las posiciones que ya tenían los estados existentes.
        positions = {n: (s.x, s.y) for n, s in auto.states.items()}

        with self.document.edit() as a:
            a.states.clear()
            a.transitions.clear()
            a.declared_alphabet = alphabet
            for i, name in enumerate(names):
                if name in positions:
                    x, y = positions[name]
                else:
                    angle = 2 * math.pi * i / max(len(names), 1) - math.pi / 2
                    radius = max(150.0, 46.0 * len(names) / math.pi)
                    x, y = radius * math.cos(angle), radius * math.sin(angle)
                state = a.add_state(name, x, y)
                state.is_initial = False
                state.is_final = False
            for source, symbol, targets in rules:
                for target in targets:
                    a.add_symbols(source, target, [symbol])
            a.set_initial(None if initial == NO_INITIAL else initial)
            a.set_final_states(finals)

        self.status_message.emit("Definición aplicada.")
