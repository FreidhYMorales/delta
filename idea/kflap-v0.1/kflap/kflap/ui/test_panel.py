"""Verificación de cadenas: una sola paso a paso, o muchas de golpe."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QBrush, QColor
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from ..core.automaton import Simulation
from ..core.document import AutomatonDocument
from . import theme


def _states_text(states: set[str]) -> str:
    if not states:
        return "∅"
    return "{ " + ", ".join(sorted(states)) + " }"


class TestPanel(QWidget):
    """Panel inferior: probar cadenas contra el autómata."""

    #: Estados que el lienzo debe resaltar.
    highlight_requested = Signal(object)
    status_message = Signal(str)

    def __init__(self, document: AutomatonDocument, parent=None) -> None:
        super().__init__(parent)
        self.document = document
        self._sim: Simulation | None = None
        self._step = 0

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        tabs = QTabWidget()
        tabs.addTab(self._build_single_tab(), "Una cadena")
        tabs.addTab(self._build_batch_tab(), "Varias cadenas")
        root.addWidget(tabs)

        # Si el autómata cambia, la traza anterior deja de ser válida.
        self.document.structure_changed.connect(self._invalidate)

    # ------------------------------------------------------------------ #
    # Pestaña: una cadena
    # ------------------------------------------------------------------ #

    def _build_single_tab(self) -> QWidget:
        page = QWidget()
        page.setObjectName("Transparent")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(10)

        entry = QHBoxLayout()
        entry.setSpacing(8)
        self.word_edit = QLineEdit()
        self.word_edit.setObjectName("Word")
        self.word_edit.setPlaceholderText("Escribí la cadena…  (vacío = ε)")
        self.word_edit.returnPressed.connect(self.run_single)
        entry.addWidget(self.word_edit, 1)

        run = QPushButton("Verificar")
        run.setObjectName("Primary")
        run.clicked.connect(self.run_single)
        entry.addWidget(run)
        layout.addLayout(entry)

        self.verdict = QLabel("Escribí una cadena y presioná Verificar.")
        self.verdict.setObjectName("Subtle")
        self.verdict.setTextFormat(Qt.TextFormat.RichText)
        layout.addWidget(self.verdict)

        self.trace_label = QLabel()
        self.trace_label.setObjectName("Mono")
        self.trace_label.setTextFormat(Qt.TextFormat.RichText)
        self.trace_label.setWordWrap(True)
        layout.addWidget(self.trace_label)

        controls = QHBoxLayout()
        controls.setSpacing(6)
        self.btn_first = QPushButton("⏮")
        self.btn_prev = QPushButton("◀")
        self.btn_next = QPushButton("▶")
        self.btn_last = QPushButton("⏭")
        for button in (self.btn_first, self.btn_prev, self.btn_next, self.btn_last):
            button.setFixedWidth(46)
            controls.addWidget(button)
        self.btn_first.clicked.connect(lambda: self._goto(0))
        self.btn_prev.clicked.connect(lambda: self._goto(self._step - 1))
        self.btn_next.clicked.connect(lambda: self._goto(self._step + 1))
        self.btn_last.clicked.connect(lambda: self._goto(10**9))

        self.step_label = QLabel("")
        self.step_label.setObjectName("Subtle")
        controls.addWidget(self.step_label)
        controls.addStretch(1)
        layout.addLayout(controls)

        self.detail = QPlainTextEdit()
        self.detail.setObjectName("Mono")
        self.detail.setReadOnly(True)
        self.detail.setPlaceholderText("Acá aparece la traza completa, paso a paso.")
        layout.addWidget(self.detail, 1)

        self._set_controls_enabled(False)
        return page

    def run_single(self) -> None:
        auto = self.document.automaton
        problems = auto.validate()
        if problems:
            self.verdict.setText(
                f"<span style='color:{theme.WARN}'>⚠ {problems[0]}</span>"
            )
            self.trace_label.clear()
            self.detail.clear()
            self._sim = None
            self._set_controls_enabled(False)
            self.highlight_requested.emit(set())
            return

        self._sim = auto.simulate(self.word_edit.text())
        self._step = len(self._sim.steps) - 1
        self._set_controls_enabled(True)
        self._render_verdict()
        self._render_detail()
        self._render_step()

    def _render_verdict(self) -> None:
        sim = self._sim
        if sim is None:
            return
        if sim.error:
            self.verdict.setText(
                f"<span style='color:{theme.WARN}'>⚠ {sim.error}</span>"
            )
        elif sim.accepted:
            self.verdict.setText(
                f"<span style='color:{theme.OK}; font-size:15px; font-weight:600'>"
                f"✓ Cadena aceptada</span>"
            )
        else:
            self.verdict.setText(
                f"<span style='color:{theme.BAD}; font-size:15px; font-weight:600'>"
                f"✗ Cadena rechazada</span>"
            )

    def _render_detail(self) -> None:
        sim = self._sim
        if sim is None:
            return
        lines = []
        for step in sim.steps:
            if step.symbol is None:
                left = "inicio"
            else:
                left = f"leer '{step.symbol}'"
            lines.append(f"{step.consumed:>2}. {left:<12} → {_states_text(step.states)}")
        if sim.steps and sim.steps[-1].consumed < len(sim.tokens):
            lines.append("    (sin transición posible: la simulación se detuvo)")
        self.detail.setPlainText("\n".join(lines))

    def _render_step(self) -> None:
        sim = self._sim
        if sim is None:
            return
        step = sim.steps[self._step]
        pieces = []
        for i, token in enumerate(sim.tokens):
            if i < step.consumed:
                pieces.append(f"<span style='color:{theme.ACCENT}'>{token}</span>")
            elif i == step.consumed:
                pieces.append(
                    "<span style='background-color:rgba(125,211,252,0.32)'>"
                    f"&nbsp;{token}&nbsp;</span>"
                )
            else:
                pieces.append(f"<span style='color:{theme.FAINT}'>{token}</span>")
        word_html = "".join(pieces) or "<i>ε (cadena vacía)</i>"
        self.trace_label.setText(
            f"{word_html} &nbsp;&nbsp;·&nbsp;&nbsp; "
            f"activos: <b>{_states_text(step.states)}</b>"
        )
        self.step_label.setText(f"Paso {self._step} de {len(sim.steps) - 1}")
        self.highlight_requested.emit(set(step.states))

    def _goto(self, index: int) -> None:
        if self._sim is None:
            return
        self._step = max(0, min(index, len(self._sim.steps) - 1))
        self._render_step()

    def _set_controls_enabled(self, enabled: bool) -> None:
        for button in (self.btn_first, self.btn_prev, self.btn_next, self.btn_last):
            button.setEnabled(enabled)
        if not enabled:
            self.step_label.setText("")

    def _invalidate(self) -> None:
        self._sim = None
        self._set_controls_enabled(False)
        self.trace_label.clear()
        self.detail.clear()
        self.verdict.setText("El autómata cambió: volvé a verificar.")
        self.highlight_requested.emit(set())

    # ------------------------------------------------------------------ #
    # Pestaña: varias cadenas
    # ------------------------------------------------------------------ #

    def _build_batch_tab(self) -> QWidget:
        page = QWidget()
        page.setObjectName("Transparent")
        layout = QHBoxLayout(page)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(12)

        left = QVBoxLayout()
        left.setSpacing(8)
        hint = QLabel("Una cadena por línea (línea vacía = ε):")
        hint.setObjectName("Subtle")
        left.addWidget(hint)
        self.batch_edit = QPlainTextEdit()
        self.batch_edit.setObjectName("Mono")
        self.batch_edit.setPlaceholderText("aab\nbba\nabab")
        left.addWidget(self.batch_edit, 1)
        run = QPushButton("Probar todas")
        run.setObjectName("Primary")
        run.clicked.connect(self.run_batch)
        left.addWidget(run)
        layout.addLayout(left, 1)

        right = QVBoxLayout()
        right.setSpacing(8)
        self.batch_summary = QLabel("Sin resultados todavía.")
        self.batch_summary.setObjectName("Subtle")
        self.batch_summary.setTextFormat(Qt.TextFormat.RichText)
        right.addWidget(self.batch_summary)
        self.batch_table = QTableWidget(0, 2)
        self.batch_table.setHorizontalHeaderLabels(["Cadena", "Resultado"])
        self.batch_table.verticalHeader().setVisible(False)
        self.batch_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.batch_table.setAlternatingRowColors(True)
        header = self.batch_table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        right.addWidget(self.batch_table, 1)
        layout.addLayout(right, 1)

        return page

    def run_batch(self) -> None:
        auto = self.document.automaton
        problems = auto.validate()
        if problems:
            self.batch_summary.setText(
                f"<span style='color:{theme.WARN}'>⚠ {problems[0]}</span>"
            )
            self.batch_table.setRowCount(0)
            return

        words = self.batch_edit.toPlainText().split("\n")
        if words and words[-1] == "" and len(words) > 1:
            words = words[:-1]

        self.batch_table.setRowCount(len(words))
        accepted_count = 0
        for row, word in enumerate(words):
            sim = auto.simulate(word)
            if sim.accepted:
                accepted_count += 1
                verdict, color = "✓ aceptada", theme.OK
            elif sim.error:
                verdict, color = "⚠ fuera de Σ", theme.WARN
            else:
                verdict, color = "✗ rechazada", theme.BAD

            word_item = QTableWidgetItem(word if word else "ε")
            self.batch_table.setItem(row, 0, word_item)
            result_item = QTableWidgetItem(verdict)
            result_item.setForeground(QBrush(QColor(color)))
            self.batch_table.setItem(row, 1, result_item)

        self.batch_summary.setText(
            f"<b>{accepted_count}</b> de <b>{len(words)}</b> cadenas aceptadas."
        )
