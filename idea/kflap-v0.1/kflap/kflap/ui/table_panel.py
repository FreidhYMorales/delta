"""Tabla de transiciones, en el formato que se usa en clase.

    ESTADOS │  a  │  b
    → q0    │ q1  │ q0
    * q1    │     │ q0

La primera columna lleva el nombre del estado con sus marcas (``→`` inicial,
``*`` aceptación). Las demás columnas son los símbolos del alfabeto y cada
celda contiene los destinos, separados por coma.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..core.automaton import parse_name_list, parse_symbol_list
from ..core.document import AutomatonDocument

INITIAL_MARKERS = ("-->", "->", "→", ">")
FINAL_MARKERS = ("*", "◎", "★")


def parse_state_cell(text: str) -> tuple[str, bool, bool]:
    """Separa "→ * q1" en (nombre, es_inicial, es_final)."""
    s = text.strip()
    is_initial = False
    is_final = False
    changed = True
    while changed:
        changed = False
        for marker in INITIAL_MARKERS:
            if s.startswith(marker):
                s = s[len(marker) :].strip()
                is_initial = True
                changed = True
        for marker in FINAL_MARKERS:
            if s.startswith(marker):
                s = s[len(marker) :].strip()
                is_final = True
                changed = True
    return s, is_initial, is_final


def format_state_cell(name: str, is_initial: bool, is_final: bool) -> str:
    prefix = ""
    if is_initial:
        prefix += "→ "
    if is_final:
        prefix += "* "
    return prefix + name


class TablePanel(QWidget):
    """Vista de tabla del autómata, editable."""

    status_message = Signal(str)

    def __init__(self, document: AutomatonDocument, parent=None) -> None:
        super().__init__(parent)
        self.document = document
        self._loading = False

        root = QVBoxLayout(self)
        root.setContentsMargins(14, 10, 14, 14)
        root.setSpacing(9)

        # -- alfabeto ------------------------------------------------- #
        alpha_row = QHBoxLayout()
        alpha_row.setSpacing(8)
        label = QLabel("Σ")
        label.setObjectName("Title")
        alpha_row.addWidget(label)
        self.alphabet_edit = QLineEdit()
        self.alphabet_edit.setObjectName("Mono")
        self.alphabet_edit.setPlaceholderText("a, b   (símbolos separados por coma)")
        self.alphabet_edit.editingFinished.connect(self._apply_alphabet)
        alpha_row.addWidget(self.alphabet_edit, 1)
        root.addLayout(alpha_row)

        # -- tabla ---------------------------------------------------- #
        self.table = QTableWidget(0, 1)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setHorizontalHeaderLabels(["ESTADOS"])
        self.table.itemChanged.connect(self._on_item_changed)
        root.addWidget(self.table, 1)

        # -- botones -------------------------------------------------- #
        buttons = QHBoxLayout()
        buttons.setSpacing(8)
        add_state = QPushButton("+ Estado")
        add_state.clicked.connect(self._add_state)
        remove_state = QPushButton("− Estado")
        remove_state.clicked.connect(self._remove_selected)
        buttons.addWidget(add_state)
        buttons.addWidget(remove_state)
        buttons.addStretch(1)
        root.addLayout(buttons)

        hint = QLabel(
            "Escribí <b>→</b> para el estado inicial y <b>*</b> para los de "
            "aceptación. En las celdas, varios destinos van separados por coma; "
            "un estado que no exista se crea solo."
        )
        hint.setObjectName("Subtle")
        hint.setWordWrap(True)
        root.addWidget(hint)

        self.document.structure_changed.connect(self.reload)
        self.reload()

    # ------------------------------------------------------------------ #
    # Modelo -> vista
    # ------------------------------------------------------------------ #

    def reload(self) -> None:
        auto = self.document.automaton
        alphabet = auto.alphabet
        columns = ["ESTADOS"] + alphabet

        self._loading = True
        try:
            if not self.alphabet_edit.hasFocus():
                self.alphabet_edit.setText(", ".join(alphabet))

            self.table.clear()
            self.table.setColumnCount(len(columns))
            self.table.setHorizontalHeaderLabels(columns)
            self.table.setRowCount(len(auto.states))

            for row, state in enumerate(auto.states.values()):
                cell = QTableWidgetItem(
                    format_state_cell(state.name, state.is_initial, state.is_final)
                )
                cell.setData(Qt.ItemDataRole.UserRole, state.name)
                font = cell.font()
                font.setBold(True)
                cell.setFont(font)
                self.table.setItem(row, 0, cell)

                for col, symbol in enumerate(alphabet, start=1):
                    targets = auto.targets(state.name, symbol)
                    item = QTableWidgetItem(", ".join(targets))
                    item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                    self.table.setItem(row, col, item)

            header = self.table.horizontalHeader()
            header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
            for col in range(1, len(columns)):
                header.setSectionResizeMode(col, QHeaderView.ResizeMode.Stretch)
        finally:
            self._loading = False

    # ------------------------------------------------------------------ #
    # Vista -> modelo
    # ------------------------------------------------------------------ #

    def _apply_alphabet(self) -> None:
        if self._loading:
            return
        symbols = parse_symbol_list(self.alphabet_edit.text())
        if symbols == self.document.automaton.alphabet:
            return
        with self.document.edit() as auto:
            # Los símbolos que el usuario sacó de Σ dejan de existir también en
            # las transiciones; si no, la tabla mostraría menos de lo que hay.
            for old in list(auto.alphabet):
                if old not in symbols:
                    auto.remove_symbol(old)
            auto.declared_alphabet = symbols

    def _on_item_changed(self, item: QTableWidgetItem) -> None:
        if self._loading:
            return
        row, col = item.row(), item.column()
        name_item = self.table.item(row, 0)
        if name_item is None:
            return
        original = name_item.data(Qt.ItemDataRole.UserRole)

        if col == 0:
            self._apply_state_cell(original, item.text())
        else:
            symbol = self.table.horizontalHeaderItem(col).text()
            self._apply_target_cell(original, symbol, item.text())

    def _apply_state_cell(self, original: str, text: str) -> None:
        name, is_initial, is_final = parse_state_cell(text)
        auto = self.document.automaton
        if original not in auto.states:
            return
        if not name:
            self.status_message.emit("El nombre del estado no puede quedar vacío.")
            self.reload()
            return
        if name != original and name in auto.states:
            self.status_message.emit(f"Ya existe un estado llamado {name}.")
            self.reload()
            return

        was_initial = auto.states[original].is_initial
        with self.document.edit() as a:
            if name != original:
                a.rename_state(original, name)
            a.set_final(name, is_final)
            if is_initial:
                a.set_initial(name)
            elif was_initial:
                a.set_initial(None)

    def _apply_target_cell(self, source: str, symbol: str, text: str) -> None:
        targets = parse_name_list(text)
        auto = self.document.automaton
        if source not in auto.states:
            return
        with self.document.edit() as a:
            for target in targets:
                if target not in a.states:
                    # Escribir un estado nuevo en la tabla lo crea: así se puede
                    # tipear el autómata entero de corrido.
                    a.add_state(target, *self._free_slot(a))
            a.set_row(source, symbol, targets)

    @staticmethod
    def _free_slot(auto) -> tuple[float, float]:
        """Una posición libre para un estado creado desde la tabla."""
        count = len(auto.states)
        return (140.0 * (count % 5) - 260.0, 130.0 * (count // 5) - 120.0)

    # ------------------------------------------------------------------ #
    # Botones
    # ------------------------------------------------------------------ #

    def _add_state(self) -> None:
        with self.document.edit() as auto:
            auto.add_state(x=self._free_slot(auto)[0], y=self._free_slot(auto)[1])

    def _remove_selected(self) -> None:
        rows = {index.row() for index in self.table.selectedIndexes()}
        if not rows:
            self.status_message.emit("Seleccioná al menos una fila.")
            return
        names = []
        for row in rows:
            item = self.table.item(row, 0)
            if item is not None:
                names.append(item.data(Qt.ItemDataRole.UserRole))
        with self.document.edit() as auto:
            for name in names:
                auto.remove_state(name)
