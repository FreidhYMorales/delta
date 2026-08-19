"""Lienzo del diagrama: estados arrastrables y flechas de transición.

El lienzo es una vista más del documento. Dibujar acá modifica el autómata, y
la tabla y la definición formal se actualizan solas.
"""

from __future__ import annotations

import math

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (
    QBrush,
    QColor,
    QFont,
    QPainter,
    QPainterPath,
    QPainterPathStroker,
    QPen,
    QPolygonF,
    QRadialGradient,
)
from PySide6.QtWidgets import (
    QGraphicsItem,
    QGraphicsObject,
    QGraphicsScene,
    QGraphicsView,
    QInputDialog,
    QLineEdit,
    QMenu,
)

from ..core.automaton import parse_symbol_list
from ..core.document import AutomatonDocument
from . import theme

STATE_RADIUS = 30.0
FINAL_RING_GAP = 5.0
INITIAL_ARROW = 24.0
CURVE_OFFSET = 46.0
ARROW_SIZE = 11.0
ARROW_WIDTH = 6.5


# --------------------------------------------------------------------------- #
# Utilidades de geometría
# --------------------------------------------------------------------------- #


def _unit(dx: float, dy: float) -> tuple[float, float, float]:
    """Devuelve (ux, uy, longitud) del vector dado."""
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return 0.0, 0.0, 0.0
    return dx / length, dy / length, length


def _arrow_head(tip: QPointF, ux: float, uy: float) -> QPolygonF:
    """Triángulo de la punta de flecha, apuntando en dirección (ux, uy)."""
    base = QPointF(tip.x() - ux * ARROW_SIZE, tip.y() - uy * ARROW_SIZE)
    px, py = -uy, ux
    return QPolygonF(
        [
            tip,
            QPointF(base.x() + px * ARROW_WIDTH, base.y() + py * ARROW_WIDTH),
            QPointF(base.x() - px * ARROW_WIDTH, base.y() - py * ARROW_WIDTH),
        ]
    )


# --------------------------------------------------------------------------- #
# Estado
# --------------------------------------------------------------------------- #


class StateItem(QGraphicsObject):
    """Círculo que representa un estado."""

    def __init__(self, name: str, canvas: "AutomatonCanvas") -> None:
        super().__init__()
        self.name = name
        self.canvas = canvas
        self.is_initial = False
        self.is_final = False
        self.highlighted = False
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges, True)
        self.setAcceptHoverEvents(True)
        self.setZValue(2)
        self._hovered = False

    # -- geometría ---------------------------------------------------- #

    def boundingRect(self) -> QRectF:
        pad = INITIAL_ARROW + 12.0
        r = STATE_RADIUS
        return QRectF(-r - pad, -r - 14, 2 * r + 2 * pad, 2 * r + 28)

    def shape(self) -> QPainterPath:
        path = QPainterPath()
        r = STATE_RADIUS
        path.addEllipse(QPointF(0, 0), r, r)
        return path

    # -- pintado ------------------------------------------------------ #

    def paint(self, painter: QPainter, option, widget=None) -> None:  # noqa: ARG002
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        r = STATE_RADIUS
        center = QPointF(0, 0)

        if self.highlighted:
            glow = QRadialGradient(center, r + 16)
            glow.setColorAt(0.55, QColor(74, 222, 128, 130))
            glow.setColorAt(1.0, QColor(74, 222, 128, 0))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QBrush(glow))
            painter.drawEllipse(center, r + 16, r + 16)

        # Relleno de vidrio: más claro arriba, como si la luz viniera de ahí.
        fill = QRadialGradient(QPointF(-r * 0.35, -r * 0.45), r * 1.9)
        if self.highlighted:
            fill.setColorAt(0.0, QColor(74, 222, 128, 120))
            fill.setColorAt(1.0, QColor(74, 222, 128, 45))
        else:
            fill.setColorAt(0.0, QColor(255, 255, 255, 62))
            fill.setColorAt(1.0, QColor(255, 255, 255, 18))
        painter.setBrush(QBrush(fill))

        if self.isSelected():
            pen = QPen(theme.CANVAS_SELECTED, 2.4)
        elif self.highlighted:
            pen = QPen(theme.CANVAS_HIGHLIGHT, 2.2)
        elif self._hovered:
            pen = QPen(QColor(233, 235, 248, 210), 1.8)
        else:
            pen = QPen(theme.CANVAS_STATE_STROKE, 1.6)
        painter.setPen(pen)
        painter.drawEllipse(center, r, r)

        if self.is_final:
            inner = r - FINAL_RING_GAP
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawEllipse(center, inner, inner)

        if self.is_initial:
            tip = QPointF(-r - 3, 0)
            painter.setPen(QPen(pen.color(), 1.9))
            painter.drawLine(QPointF(-r - INITIAL_ARROW, 0), tip)
            painter.setBrush(QBrush(pen.color()))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawPolygon(_arrow_head(tip, 1.0, 0.0))

        font = QFont()
        font.setPointSizeF(13.0)
        font.setWeight(QFont.Weight.DemiBold)
        painter.setFont(font)
        painter.setPen(QPen(theme.CANVAS_STATE_TEXT))
        text_rect = QRectF(-r, -r, 2 * r, 2 * r)
        painter.drawText(text_rect, Qt.AlignmentFlag.AlignCenter, self.name)

    # -- interacción -------------------------------------------------- #

    def hoverEnterEvent(self, event) -> None:
        self._hovered = True
        self.update()
        super().hoverEnterEvent(event)

    def hoverLeaveEvent(self, event) -> None:
        self._hovered = False
        self.update()
        super().hoverLeaveEvent(event)

    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged:
            # Redibujar las flechas mientras se arrastra; el modelo se
            # actualiza recién al soltar, para no inundar el historial.
            self.canvas.refresh_edges_of(self.name)
        return super().itemChange(change, value)

    def mouseReleaseEvent(self, event) -> None:
        super().mouseReleaseEvent(event)
        self.canvas.commit_position(self)

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: ARG002
        self.canvas.rename_state(self.name)

    def contextMenuEvent(self, event) -> None:
        menu = QMenu()
        act_initial = menu.addAction("Marcar como inicial  →")
        act_final = menu.addAction(
            "Quitar aceptación  ◎" if self.is_final else "Marcar como aceptación  ◎"
        )
        menu.addSeparator()
        act_rename = menu.addAction("Renombrar…")
        act_delete = menu.addAction("Eliminar estado")

        chosen = menu.exec(event.screenPos())
        if chosen is act_initial:
            self.canvas.set_initial(self.name)
        elif chosen is act_final:
            self.canvas.toggle_final(self.name)
        elif chosen is act_rename:
            self.canvas.rename_state(self.name)
        elif chosen is act_delete:
            self.canvas.delete_state(self.name)


# --------------------------------------------------------------------------- #
# Transición
# --------------------------------------------------------------------------- #


class TransitionItem(QGraphicsObject):
    """Flecha etiquetada entre dos estados (o un bucle sobre uno solo)."""

    def __init__(
        self,
        source: StateItem,
        target: StateItem,
        canvas: "AutomatonCanvas",
    ) -> None:
        super().__init__()
        self.source = source
        self.target = target
        self.canvas = canvas
        self.label = ""
        self.curved = False
        self.setAcceptHoverEvents(True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
        self.setZValue(1)
        self._hovered = False
        self._path = QPainterPath()
        self._head = QPolygonF()
        self._label_rect = QRectF()
        self.refresh()

    # -- geometría ---------------------------------------------------- #

    def refresh(self) -> None:
        self.prepareGeometryChange()
        if self.source is self.target:
            self._build_loop()
        elif self.curved:
            self._build_curve()
        else:
            self._build_line()
        self.update()

    def _build_line(self) -> None:
        a, b = self.source.pos(), self.target.pos()
        ux, uy, dist = _unit(b.x() - a.x(), b.y() - a.y())
        path = QPainterPath()
        if dist <= 2 * STATE_RADIUS:
            self._path, self._head = path, QPolygonF()
            self._set_label_rect(QPointF((a.x() + b.x()) / 2, (a.y() + b.y()) / 2))
            return
        start = QPointF(a.x() + ux * STATE_RADIUS, a.y() + uy * STATE_RADIUS)
        end = QPointF(b.x() - ux * STATE_RADIUS, b.y() - uy * STATE_RADIUS)
        path.moveTo(start)
        path.lineTo(end)
        self._path = path
        self._head = _arrow_head(end, ux, uy)
        mid = QPointF((start.x() + end.x()) / 2, (start.y() + end.y()) / 2)
        self._set_label_rect(QPointF(mid.x() - uy * 15, mid.y() + ux * 15))

    def _build_curve(self) -> None:
        a, b = self.source.pos(), self.target.pos()
        ux, uy, dist = _unit(b.x() - a.x(), b.y() - a.y())
        path = QPainterPath()
        if dist < 1.0:
            self._path, self._head = path, QPolygonF()
            self._set_label_rect(a)
            return
        mid = QPointF((a.x() + b.x()) / 2, (a.y() + b.y()) / 2)
        ctrl = QPointF(mid.x() - uy * CURVE_OFFSET, mid.y() + ux * CURVE_OFFSET)

        sx, sy, _ = _unit(ctrl.x() - a.x(), ctrl.y() - a.y())
        tx, ty, _ = _unit(ctrl.x() - b.x(), ctrl.y() - b.y())
        start = QPointF(a.x() + sx * STATE_RADIUS, a.y() + sy * STATE_RADIUS)
        end = QPointF(b.x() + tx * STATE_RADIUS, b.y() + ty * STATE_RADIUS)

        path.moveTo(start)
        path.quadTo(ctrl, end)
        self._path = path
        hx, hy, _ = _unit(end.x() - ctrl.x(), end.y() - ctrl.y())
        self._head = _arrow_head(end, hx, hy)

        # Punto medio de la curva cuadrática (t = 0.5).
        apex = QPointF(
            0.25 * start.x() + 0.5 * ctrl.x() + 0.25 * end.x(),
            0.25 * start.y() + 0.5 * ctrl.y() + 0.25 * end.y(),
        )
        self._set_label_rect(QPointF(apex.x() - uy * 13, apex.y() + ux * 13))

    def _build_loop(self) -> None:
        c = self.source.pos()
        r = STATE_RADIUS
        a1, a2 = math.radians(-128), math.radians(-52)
        start = QPointF(c.x() + r * math.cos(a1), c.y() + r * math.sin(a1))
        end = QPointF(c.x() + r * math.cos(a2), c.y() + r * math.sin(a2))
        c1 = QPointF(c.x() - 42, c.y() - r - 62)
        c2 = QPointF(c.x() + 42, c.y() - r - 62)

        path = QPainterPath()
        path.moveTo(start)
        path.cubicTo(c1, c2, end)
        self._path = path
        hx, hy, _ = _unit(end.x() - c2.x(), end.y() - c2.y())
        self._head = _arrow_head(end, hx, hy)
        self._set_label_rect(QPointF(c.x(), c.y() - r - 52))

    def _set_label_rect(self, center: QPointF) -> None:
        width = max(20.0, 8.0 * len(self.label) + 14.0)
        self._label_rect = QRectF(center.x() - width / 2, center.y() - 11, width, 22)

    def boundingRect(self) -> QRectF:
        rect = self._path.boundingRect()
        if not self._head.isEmpty():
            rect = rect.united(self._head.boundingRect())
        rect = rect.united(self._label_rect)
        return rect.adjusted(-6, -6, 6, 6)

    def shape(self) -> QPainterPath:
        stroker = QPainterPathStroker()
        stroker.setWidth(14.0)
        path = stroker.createStroke(self._path)
        path.addRect(self._label_rect)
        return path

    # -- pintado ------------------------------------------------------ #

    def paint(self, painter: QPainter, option, widget=None) -> None:  # noqa: ARG002
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        if self.isSelected():
            color = theme.CANVAS_SELECTED
        elif self._hovered:
            color = QColor(233, 235, 248, 235)
        else:
            color = theme.CANVAS_EDGE

        painter.setPen(QPen(color, 1.9, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawPath(self._path)

        if not self._head.isEmpty():
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QBrush(color))
            painter.drawPolygon(self._head)

        if self.label:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QBrush(QColor(14, 14, 26, 205)))
            painter.drawRoundedRect(self._label_rect, 7, 7)
            font = QFont()
            font.setPointSizeF(12.0)
            font.setWeight(QFont.Weight.Medium)
            painter.setFont(font)
            painter.setPen(QPen(theme.CANVAS_EDGE_LABEL))
            painter.drawText(
                self._label_rect, Qt.AlignmentFlag.AlignCenter, self.label
            )

    # -- interacción -------------------------------------------------- #

    def hoverEnterEvent(self, event) -> None:
        self._hovered = True
        self.update()
        super().hoverEnterEvent(event)

    def hoverLeaveEvent(self, event) -> None:
        self._hovered = False
        self.update()
        super().hoverLeaveEvent(event)

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: ARG002
        self.canvas.edit_transition(self.source.name, self.target.name)

    def contextMenuEvent(self, event) -> None:
        menu = QMenu()
        act_edit = menu.addAction("Editar símbolos…")
        act_delete = menu.addAction("Eliminar transición")
        chosen = menu.exec(event.screenPos())
        if chosen is act_edit:
            self.canvas.edit_transition(self.source.name, self.target.name)
        elif chosen is act_delete:
            self.canvas.delete_transition(self.source.name, self.target.name)


# --------------------------------------------------------------------------- #
# Vista
# --------------------------------------------------------------------------- #


class AutomatonCanvas(QGraphicsView):
    """Editor gráfico del autómata."""

    MODE_SELECT = "select"
    MODE_STATE = "state"
    MODE_TRANSITION = "transition"
    MODE_DELETE = "delete"

    status_message = Signal(str)
    mode_reset = Signal()

    def __init__(self, document: AutomatonDocument, parent=None) -> None:
        super().__init__(parent)
        self.document = document
        self.mode = self.MODE_SELECT
        self._states: dict[str, StateItem] = {}
        self._edges: dict[tuple[str, str], TransitionItem] = {}
        self._pending_source: StateItem | None = None
        self._rubber_line = None

        scene = QGraphicsScene(self)
        self.setScene(scene)
        self._update_scene_rect()

        self.setRenderHints(
            QPainter.RenderHint.Antialiasing | QPainter.RenderHint.TextAntialiasing
        )
        self.setDragMode(QGraphicsView.DragMode.RubberBandDrag)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setViewportUpdateMode(
            QGraphicsView.ViewportUpdateMode.BoundingRectViewportUpdate
        )
        self.viewport().setAutoFillBackground(False)

        self.document.structure_changed.connect(self.rebuild)
        self.rebuild()

    # -- fondo -------------------------------------------------------- #

    def drawBackground(self, painter: QPainter, rect: QRectF) -> None:
        painter.fillRect(rect, QColor(10, 10, 20, 120))
        step = 26
        left = int(rect.left()) - (int(rect.left()) % step)
        top = int(rect.top()) - (int(rect.top()) % step)
        painter.setPen(QPen(theme.CANVAS_GRID, 1.0))
        points = [
            QPointF(x, y)
            for x in range(left, int(rect.right()), step)
            for y in range(top, int(rect.bottom()), step)
        ]
        painter.drawPoints(points)

    # -- reconstrucción desde el modelo ------------------------------- #

    def rebuild(self) -> None:
        """Recrea todos los ítems a partir del autómata."""
        selected = {
            item.name for item in self._states.values() if item.isSelected()
        }
        highlighted = {
            name for name, item in self._states.items() if item.highlighted
        }
        self._cancel_pending()
        self.scene().clear()
        self._states.clear()
        self._edges.clear()

        auto = self.document.automaton
        for state in auto.states.values():
            item = StateItem(state.name, self)
            item.setPos(state.x, state.y)
            item.is_initial = state.is_initial
            item.is_final = state.is_final
            item.highlighted = state.name in highlighted
            item.setSelected(state.name in selected)
            self._apply_flags(item)
            self.scene().addItem(item)
            self._states[state.name] = item

        pairs = {(tr.source, tr.target) for tr in auto.transitions}
        for tr in auto.transitions:
            source = self._states.get(tr.source)
            target = self._states.get(tr.target)
            if source is None or target is None:
                continue
            edge = TransitionItem(source, target, self)
            edge.label = tr.label
            # Curvar cuando también existe la flecha inversa, para que no se
            # superpongan.
            edge.curved = tr.source != tr.target and (tr.target, tr.source) in pairs
            edge.refresh()
            self.scene().addItem(edge)
            self._edges[(tr.source, tr.target)] = edge

        self._update_scene_rect()

    def _update_scene_rect(self) -> None:
        """Ajusta el área desplazable al contenido, con un margen para trabajar.

        Sin esto el lienzo tendría un tamaño fijo enorme y las barras de
        desplazamiento estarían siempre visibles.
        """
        content = self.scene().itemsBoundingRect()
        if content.isEmpty():
            content = QRectF(-300, -220, 600, 440)
        self.scene().setSceneRect(content.adjusted(-260, -200, 260, 200))

    def _apply_flags(self, item: StateItem) -> None:
        movable = self.mode == self.MODE_SELECT
        item.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, movable)

    def refresh_edges_of(self, name: str) -> None:
        for (src, dst), edge in self._edges.items():
            if src == name or dst == name:
                edge.refresh()

    def set_highlight(self, names: set[str]) -> None:
        for name, item in self._states.items():
            wanted = name in names
            if item.highlighted != wanted:
                item.highlighted = wanted
                item.update()

    # -- modo --------------------------------------------------------- #

    def set_mode(self, mode: str) -> None:
        self.mode = mode
        self._cancel_pending()
        for item in self._states.values():
            self._apply_flags(item)
        self.setDragMode(
            QGraphicsView.DragMode.RubberBandDrag
            if mode == self.MODE_SELECT
            else QGraphicsView.DragMode.NoDrag
        )
        cursors = {
            self.MODE_SELECT: Qt.CursorShape.ArrowCursor,
            self.MODE_STATE: Qt.CursorShape.CrossCursor,
            self.MODE_TRANSITION: Qt.CursorShape.PointingHandCursor,
            self.MODE_DELETE: Qt.CursorShape.ForbiddenCursor,
        }
        self.viewport().setCursor(cursors.get(mode, Qt.CursorShape.ArrowCursor))

    # -- operaciones sobre el modelo ---------------------------------- #

    def commit_position(self, item: StateItem) -> None:
        pos = item.pos()
        state = self.document.automaton.states.get(item.name)
        if state is None or (state.x == pos.x() and state.y == pos.y()):
            return
        with self.document.edit(geometry_only=True) as auto:
            auto.move_state(item.name, pos.x(), pos.y())
        self._update_scene_rect()

    def add_state_at(self, pos: QPointF) -> None:
        with self.document.edit() as auto:
            state = auto.add_state(x=pos.x(), y=pos.y())
        self.status_message.emit(f"Estado {state.name} agregado.")

    def rename_state(self, name: str) -> None:
        new, ok = QInputDialog.getText(
            self, "Renombrar estado", "Nombre:", QLineEdit.EchoMode.Normal, name
        )
        if not ok:
            return
        new = new.strip()
        if not new or new == name:
            return
        if new in self.document.automaton.states:
            self.status_message.emit(f"Ya existe un estado llamado {new}.")
            return
        with self.document.edit() as auto:
            auto.rename_state(name, new)

    def set_initial(self, name: str) -> None:
        with self.document.edit() as auto:
            auto.set_initial(name)
        self.status_message.emit(f"{name} es ahora el estado inicial.")

    def toggle_final(self, name: str) -> None:
        auto = self.document.automaton
        state = auto.states.get(name)
        if state is None:
            return
        with self.document.edit() as a:
            a.set_final(name, not state.is_final)

    def delete_state(self, name: str) -> None:
        with self.document.edit() as auto:
            auto.remove_state(name)
        self.status_message.emit(f"Estado {name} eliminado.")

    def delete_transition(self, source: str, target: str) -> None:
        with self.document.edit() as auto:
            auto.remove_transition(source, target)

    def edit_transition(self, source: str, target: str) -> None:
        auto = self.document.automaton
        existing = auto.transition_between(source, target)
        current = existing.label if existing else ""
        text, ok = QInputDialog.getText(
            self,
            "Símbolos de la transición",
            f"δ({source}, ·) → {target}\n"
            "Separá los símbolos con coma. Dejá vacío para ε.",
            QLineEdit.EchoMode.Normal,
            current,
        )
        if not ok:
            return
        symbols = parse_symbol_list(text)
        if not symbols:
            symbols = parse_symbol_list("ε")
        with self.document.edit() as a:
            a.set_symbols(source, target, symbols)

    def delete_selection(self) -> None:
        names = [i.name for i in self._states.values() if i.isSelected()]
        edges = [
            key for key, item in self._edges.items() if item.isSelected()
        ]
        if not names and not edges:
            return
        with self.document.edit() as auto:
            for src, dst in edges:
                auto.remove_transition(src, dst)
            for name in names:
                auto.remove_state(name)

    # -- interacción del mouse ---------------------------------------- #

    def _state_at(self, view_pos) -> StateItem | None:
        for item in self.items(view_pos):
            if isinstance(item, StateItem):
                return item
        return None

    def mousePressEvent(self, event) -> None:
        if event.button() != Qt.MouseButton.LeftButton:
            super().mousePressEvent(event)
            return

        scene_pos = self.mapToScene(event.position().toPoint())
        hit = self._state_at(event.position().toPoint())

        if self.mode == self.MODE_STATE:
            if hit is None:
                self.add_state_at(scene_pos)
            return

        if self.mode == self.MODE_TRANSITION:
            if hit is None:
                self._cancel_pending()
                return
            if self._pending_source is None:
                self._begin_pending(hit)
            else:
                source = self._pending_source.name
                target = hit.name
                self._cancel_pending()
                self.edit_transition(source, target)
            return

        if self.mode == self.MODE_DELETE:
            if hit is not None:
                self.delete_state(hit.name)
                return
            for item in self.items(event.position().toPoint()):
                if isinstance(item, TransitionItem):
                    self.delete_transition(item.source.name, item.target.name)
                    return
            return

        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if self._rubber_line is not None and self._pending_source is not None:
            start = self._pending_source.pos()
            end = self.mapToScene(event.position().toPoint())
            self._rubber_line.setLine(start.x(), start.y(), end.x(), end.y())
        super().mouseMoveEvent(event)

    def mouseDoubleClickEvent(self, event) -> None:
        if self.mode == self.MODE_SELECT and self._state_at(
            event.position().toPoint()
        ) is None:
            items = self.items(event.position().toPoint())
            if not any(isinstance(i, TransitionItem) for i in items):
                self.add_state_at(self.mapToScene(event.position().toPoint()))
                return
        super().mouseDoubleClickEvent(event)

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key.Key_Escape:
            self._cancel_pending()
            self.mode_reset.emit()
            return
        if event.key() in (Qt.Key.Key_Delete, Qt.Key.Key_Backspace):
            self.delete_selection()
            return
        super().keyPressEvent(event)

    def wheelEvent(self, event) -> None:
        # Cmd/Ctrl + rueda hace zoom; la rueda sola desplaza, como es habitual.
        if event.modifiers() & (
            Qt.KeyboardModifier.ControlModifier | Qt.KeyboardModifier.MetaModifier
        ):
            factor = 1.0015 ** event.angleDelta().y()
            self.zoom_by(factor)
            return
        super().wheelEvent(event)

    # -- transición pendiente ----------------------------------------- #

    def _begin_pending(self, item: StateItem) -> None:
        self._pending_source = item
        pen = QPen(theme.CANVAS_SELECTED, 1.8, Qt.PenStyle.DashLine)
        self._rubber_line = self.scene().addLine(
            item.pos().x(), item.pos().y(), item.pos().x(), item.pos().y(), pen
        )
        self._rubber_line.setZValue(0)
        self.status_message.emit(
            f"Origen: {item.name}. Hacé clic en el estado destino (Esc cancela)."
        )

    def _cancel_pending(self) -> None:
        if self._rubber_line is not None and self._rubber_line.scene() is not None:
            self.scene().removeItem(self._rubber_line)
        self._rubber_line = None
        self._pending_source = None

    # -- zoom / encuadre ---------------------------------------------- #

    def zoom_by(self, factor: float) -> None:
        current = self.transform().m11()
        target = current * factor
        if 0.25 <= target <= 3.5:
            self.scale(factor, factor)

    def reset_zoom(self) -> None:
        self.resetTransform()

    def fit_contents(self) -> None:
        items_rect = self.scene().itemsBoundingRect()
        if items_rect.isEmpty():
            self.resetTransform()
            return
        self.fitInView(
            items_rect.adjusted(-60, -60, 60, 60), Qt.AspectRatioMode.KeepAspectRatio
        )
        # No agrandar más allá del 100 %: un autómata chico se vería gigante.
        if self.transform().m11() > 1.0:
            self.resetTransform()
            self.centerOn(items_rect.center())

    def auto_layout(self) -> None:
        """Acomoda los estados en círculo. Útil al importar desde la tabla."""
        auto = self.document.automaton
        names = auto.state_names
        if not names:
            return
        radius = max(150.0, 46.0 * len(names) / math.pi)
        with self.document.edit() as a:
            for i, name in enumerate(names):
                angle = 2 * math.pi * i / len(names) - math.pi / 2
                a.move_state(name, radius * math.cos(angle), radius * math.sin(angle))
        self.fit_contents()
