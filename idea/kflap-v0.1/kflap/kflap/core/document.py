"""Documento: envuelve un `Automaton` y avisa a las vistas cuando cambia.

Las tres vistas (diagrama, tabla y definición formal) editan este mismo objeto,
así que cualquiera de ellas puede modificar el autómata y las otras dos se
actualizan solas.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path

from PySide6.QtCore import QObject, Signal

from .automaton import Automaton

#: Cuántos pasos de deshacer guardamos.
UNDO_LIMIT = 100


class AutomatonDocument(QObject):
    """El autómata en edición, más su estado de archivo e historial."""

    #: Cambió la estructura (estados, transiciones, alfabeto, marcas).
    structure_changed = Signal()
    #: Cambió sólo la posición de los estados en el lienzo.
    geometry_changed = Signal()
    #: Cambió el archivo asociado o el flag de "sin guardar".
    file_changed = Signal()

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.automaton = Automaton()
        self.path: Path | None = None
        self._dirty = False
        self._depth = 0
        self._undo: list[dict] = []
        self._redo: list[dict] = []

    # ------------------------------------------------------------------ #
    # Estado del archivo
    # ------------------------------------------------------------------ #

    @property
    def dirty(self) -> bool:
        return self._dirty

    @property
    def display_name(self) -> str:
        return self.path.stem if self.path else "Sin título"

    def _set_dirty(self, value: bool) -> None:
        if self._dirty != value:
            self._dirty = value
            self.file_changed.emit()

    # ------------------------------------------------------------------ #
    # Edición
    # ------------------------------------------------------------------ #

    @contextmanager
    def edit(self, *, geometry_only: bool = False):
        """Modifica el autómata y notifica a las vistas una sola vez al salir.

        Se puede anidar: sólo el bloque más externo emite la señal, así una
        operación compuesta produce un único refresco y un único paso de
        deshacer.
        """
        outermost = self._depth == 0
        if outermost and not geometry_only:
            self._push_undo()
        self._depth += 1
        try:
            yield self.automaton
        finally:
            self._depth -= 1
            if self._depth == 0:
                self._set_dirty(True)
                if geometry_only:
                    self.geometry_changed.emit()
                else:
                    self.structure_changed.emit()

    def refresh(self) -> None:
        """Fuerza un refresco de las vistas sin marcar cambios."""
        self.structure_changed.emit()

    # ------------------------------------------------------------------ #
    # Deshacer / rehacer
    # ------------------------------------------------------------------ #

    def _push_undo(self) -> None:
        self._undo.append(self.automaton.to_dict())
        if len(self._undo) > UNDO_LIMIT:
            self._undo.pop(0)
        self._redo.clear()

    @property
    def can_undo(self) -> bool:
        return bool(self._undo)

    @property
    def can_redo(self) -> bool:
        return bool(self._redo)

    def undo(self) -> None:
        if not self._undo:
            return
        self._redo.append(self.automaton.to_dict())
        self.automaton = Automaton.from_dict(self._undo.pop())
        self._set_dirty(True)
        self.structure_changed.emit()

    def redo(self) -> None:
        if not self._redo:
            return
        self._undo.append(self.automaton.to_dict())
        self.automaton = Automaton.from_dict(self._redo.pop())
        self._set_dirty(True)
        self.structure_changed.emit()

    # ------------------------------------------------------------------ #
    # Archivo
    # ------------------------------------------------------------------ #

    def new(self) -> None:
        self.automaton = Automaton()
        self.path = None
        self._undo.clear()
        self._redo.clear()
        self._dirty = False
        self.file_changed.emit()
        self.structure_changed.emit()

    def load(self, path: str | Path) -> None:
        path = Path(path)
        data = json.loads(path.read_text(encoding="utf-8"))
        self.automaton = Automaton.from_dict(data)
        self.path = path
        self._undo.clear()
        self._redo.clear()
        self._dirty = False
        self.file_changed.emit()
        self.structure_changed.emit()

    def save(self, path: str | Path | None = None) -> None:
        target = Path(path) if path else self.path
        if target is None:
            raise ValueError("No hay ruta donde guardar.")
        payload = json.dumps(self.automaton.to_dict(), indent=2, ensure_ascii=False)
        target.write_text(payload + "\n", encoding="utf-8")
        self.path = target
        self._dirty = False
        self.file_changed.emit()
