"""Ventana principal: junta el diagrama, la tabla, la definición formal y las pruebas."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QAction, QActionGroup, QColor, QImage, QKeySequence, QPainter
from PySide6.QtWidgets import (
    QDockWidget,
    QFileDialog,
    QLabel,
    QMainWindow,
    QMessageBox,
    QTabWidget,
    QToolBar,
    QVBoxLayout,
    QWidget,
)

from ..core.document import AutomatonDocument
from . import theme
from .canvas import AutomatonCanvas
from .formal_panel import FormalPanel
from .table_panel import TablePanel
from .test_panel import TestPanel

FILE_FILTER = "Autómata kflap (*.kflap *.json);;Todos los archivos (*)"


class MainWindow(QMainWindow):
    """Ventana de la aplicación."""

    def __init__(self) -> None:
        super().__init__()
        self.document = AutomatonDocument(self)

        self.setWindowTitle("kflap")
        self.resize(1280, 840)
        self.setDockOptions(
            QMainWindow.DockOption.AnimatedDocks
            | QMainWindow.DockOption.AllowNestedDocks
        )

        self.canvas = AutomatonCanvas(self.document)
        self.table_panel = TablePanel(self.document)
        self.formal_panel = FormalPanel(self.document)
        self.test_panel = TestPanel(self.document)

        self._build_central()
        self._build_docks()
        self._build_actions()
        self._build_toolbar()
        self._build_menus()
        self._build_statusbar()

        for panel in (self.canvas, self.table_panel, self.formal_panel, self.test_panel):
            panel.status_message.connect(self._show_message)
        self.test_panel.highlight_requested.connect(self.canvas.set_highlight)
        self.canvas.mode_reset.connect(lambda: self.act_select.setChecked(True))
        self.document.file_changed.connect(self._update_title)
        self.document.structure_changed.connect(self._update_status_summary)

        self._update_title()
        self._update_status_summary()

    # ------------------------------------------------------------------ #
    # Construcción
    # ------------------------------------------------------------------ #

    def _build_central(self) -> None:
        container = QWidget()
        container.setObjectName("Transparent")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(12, 6, 6, 12)
        layout.addWidget(self.canvas)
        self.setCentralWidget(container)

    def _wrap(self, widget: QWidget) -> QWidget:
        """Envuelve un panel en el marco de vidrio."""
        panel = QWidget()
        panel.setObjectName("GlassPanel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(widget)
        return panel

    def _build_docks(self) -> None:
        side_tabs = QTabWidget()
        side_tabs.setObjectName("Transparent")
        side_tabs.addTab(self.table_panel, "Tabla de estados")
        side_tabs.addTab(self.formal_panel, "Definición formal")

        self.side_dock = QDockWidget("Autómata", self)
        self.side_dock.setObjectName("SideDock")
        self.side_dock.setWidget(self._wrap(side_tabs))
        self.side_dock.setAllowedAreas(
            Qt.DockWidgetArea.LeftDockWidgetArea | Qt.DockWidgetArea.RightDockWidgetArea
        )
        self.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, self.side_dock)
        self.side_dock.setMinimumWidth(400)

        self.test_dock = QDockWidget("Verificación de cadenas", self)
        self.test_dock.setObjectName("TestDock")
        self.test_dock.setWidget(self._wrap(self.test_panel))
        self.addDockWidget(Qt.DockWidgetArea.BottomDockWidgetArea, self.test_dock)
        self.test_dock.setMinimumHeight(260)

    def _build_actions(self) -> None:
        d = self.document

        self.act_new = QAction("Nuevo", self)
        self.act_new.setShortcut(QKeySequence.StandardKey.New)
        self.act_new.triggered.connect(self.new_file)

        self.act_open = QAction("Abrir…", self)
        self.act_open.setShortcut(QKeySequence.StandardKey.Open)
        self.act_open.triggered.connect(self.open_file)

        self.act_save = QAction("Guardar", self)
        self.act_save.setShortcut(QKeySequence.StandardKey.Save)
        self.act_save.triggered.connect(self.save_file)

        self.act_save_as = QAction("Guardar como…", self)
        self.act_save_as.setShortcut(QKeySequence.StandardKey.SaveAs)
        self.act_save_as.triggered.connect(self.save_file_as)

        self.act_export = QAction("Exportar diagrama (PNG)…", self)
        self.act_export.triggered.connect(self.export_png)

        self.act_undo = QAction("Deshacer", self)
        self.act_undo.setShortcut(QKeySequence.StandardKey.Undo)
        self.act_undo.triggered.connect(d.undo)

        self.act_redo = QAction("Rehacer", self)
        self.act_redo.setShortcut(QKeySequence.StandardKey.Redo)
        self.act_redo.triggered.connect(d.redo)

        self.act_delete = QAction("Eliminar selección", self)
        self.act_delete.triggered.connect(self.canvas.delete_selection)

        # -- modos del lienzo ----------------------------------------- #
        self.mode_group = QActionGroup(self)
        self.mode_group.setExclusive(True)

        def mode_action(text: str, mode: str, shortcut: str, tip: str) -> QAction:
            action = QAction(text, self)
            action.setCheckable(True)
            action.setShortcut(QKeySequence(shortcut))
            action.setToolTip(f"{tip}  ({shortcut})")
            action.triggered.connect(lambda: self._set_mode(mode))
            self.mode_group.addAction(action)
            return action

        self.act_select = mode_action(
            "▣  Seleccionar", AutomatonCanvas.MODE_SELECT, "V",
            "Mover y seleccionar estados",
        )
        self.act_state = mode_action(
            "◯  Estado", AutomatonCanvas.MODE_STATE, "S",
            "Clic en el lienzo para crear un estado",
        )
        self.act_transition = mode_action(
            "→  Transición", AutomatonCanvas.MODE_TRANSITION, "T",
            "Clic en el origen y después en el destino",
        )
        self.act_erase = mode_action(
            "⌫  Borrar", AutomatonCanvas.MODE_DELETE, "D",
            "Clic sobre un estado o una flecha para eliminarla",
        )
        self.act_select.setChecked(True)

        # -- vista ----------------------------------------------------- #
        self.act_zoom_in = QAction("Acercar", self)
        self.act_zoom_in.setShortcut(QKeySequence.StandardKey.ZoomIn)
        self.act_zoom_in.triggered.connect(lambda: self.canvas.zoom_by(1.18))

        self.act_zoom_out = QAction("Alejar", self)
        self.act_zoom_out.setShortcut(QKeySequence.StandardKey.ZoomOut)
        self.act_zoom_out.triggered.connect(lambda: self.canvas.zoom_by(1 / 1.18))

        self.act_zoom_reset = QAction("Zoom 100 %", self)
        self.act_zoom_reset.setShortcut(QKeySequence("Ctrl+0"))
        self.act_zoom_reset.triggered.connect(self.canvas.reset_zoom)

        self.act_fit = QAction("Ajustar a la ventana", self)
        self.act_fit.setShortcut(QKeySequence("Ctrl+1"))
        self.act_fit.triggered.connect(self.canvas.fit_contents)

        self.act_layout = QAction("Acomodar en círculo", self)
        self.act_layout.setShortcut(QKeySequence("Ctrl+L"))
        self.act_layout.triggered.connect(self.canvas.auto_layout)

        self.act_help = QAction("Cómo se usa", self)
        self.act_help.triggered.connect(self.show_help)

    def _build_toolbar(self) -> None:
        bar = QToolBar("Herramientas")
        bar.setMovable(False)
        bar.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        bar.addAction(self.act_select)
        bar.addAction(self.act_state)
        bar.addAction(self.act_transition)
        bar.addAction(self.act_erase)
        bar.addSeparator()
        bar.addAction(self.act_layout)
        bar.addAction(self.act_fit)
        self.addToolBar(Qt.ToolBarArea.TopToolBarArea, bar)

    def _build_menus(self) -> None:
        menubar = self.menuBar()

        file_menu = menubar.addMenu("Archivo")
        file_menu.addAction(self.act_new)
        file_menu.addAction(self.act_open)
        file_menu.addSeparator()
        file_menu.addAction(self.act_save)
        file_menu.addAction(self.act_save_as)
        file_menu.addSeparator()
        file_menu.addAction(self.act_export)

        edit_menu = menubar.addMenu("Editar")
        edit_menu.addAction(self.act_undo)
        edit_menu.addAction(self.act_redo)
        edit_menu.addSeparator()
        edit_menu.addAction(self.act_delete)

        view_menu = menubar.addMenu("Ver")
        view_menu.addAction(self.act_select)
        view_menu.addAction(self.act_state)
        view_menu.addAction(self.act_transition)
        view_menu.addAction(self.act_erase)
        view_menu.addSeparator()
        view_menu.addAction(self.act_zoom_in)
        view_menu.addAction(self.act_zoom_out)
        view_menu.addAction(self.act_zoom_reset)
        view_menu.addAction(self.act_fit)
        view_menu.addAction(self.act_layout)
        view_menu.addSeparator()
        view_menu.addAction(self.side_dock.toggleViewAction())
        view_menu.addAction(self.test_dock.toggleViewAction())

        help_menu = menubar.addMenu("Ayuda")
        help_menu.addAction(self.act_help)

    def _build_statusbar(self) -> None:
        self.summary_label = QLabel()
        self.summary_label.setObjectName("Subtle")
        self.statusBar().addPermanentWidget(self.summary_label)
        self._show_message(
            "Presioná S y hacé clic para crear estados; T para conectarlos."
        )

    # ------------------------------------------------------------------ #
    # Fondo
    # ------------------------------------------------------------------ #

    def paintEvent(self, event) -> None:  # noqa: ARG002
        painter = QPainter(self)
        theme.paint_aurora(painter, QRectF(self.rect()))
        painter.end()

    # ------------------------------------------------------------------ #
    # Acciones
    # ------------------------------------------------------------------ #

    def _set_mode(self, mode: str) -> None:
        self.canvas.set_mode(mode)
        tips = {
            AutomatonCanvas.MODE_SELECT: "Arrastrá para mover; doble clic renombra.",
            AutomatonCanvas.MODE_STATE: "Clic en el lienzo para crear un estado.",
            AutomatonCanvas.MODE_TRANSITION: "Clic en el origen y luego en el destino.",
            AutomatonCanvas.MODE_DELETE: "Clic sobre un estado o flecha para borrarlo.",
        }
        self._show_message(tips.get(mode, ""))

    def _show_message(self, text: str) -> None:
        self.statusBar().showMessage(text, 6000)

    def _update_title(self) -> None:
        mark = " •" if self.document.dirty else ""
        self.setWindowTitle(f"{self.document.display_name}{mark} — kflap")

    def _update_status_summary(self) -> None:
        auto = self.document.automaton
        kind = "AFD" if auto.is_deterministic() else "AFN"
        self.summary_label.setText(
            f"{kind}  ·  {len(auto.states)} estados  ·  "
            f"{len(auto.transitions)} flechas  ·  Σ = {{{', '.join(auto.alphabet)}}}"
        )

    # -- archivo ------------------------------------------------------- #

    def _confirm_discard(self) -> bool:
        if not self.document.dirty:
            return True
        answer = QMessageBox.question(
            self,
            "Cambios sin guardar",
            "El autómata tiene cambios sin guardar. ¿Querés guardarlos?",
            QMessageBox.StandardButton.Save
            | QMessageBox.StandardButton.Discard
            | QMessageBox.StandardButton.Cancel,
        )
        if answer == QMessageBox.StandardButton.Save:
            return self.save_file()
        return answer == QMessageBox.StandardButton.Discard

    def new_file(self) -> None:
        if self._confirm_discard():
            self.document.new()
            self._show_message("Autómata nuevo.")

    def open_file(self) -> None:
        if not self._confirm_discard():
            return
        path, _ = QFileDialog.getOpenFileName(self, "Abrir autómata", "", FILE_FILTER)
        if not path:
            return
        try:
            self.document.load(path)
        except Exception as error:  # noqa: BLE001 - se lo mostramos al usuario
            QMessageBox.critical(self, "No se pudo abrir", str(error))
            return
        self.canvas.fit_contents()
        self._show_message(f"Abierto: {Path(path).name}")

    def save_file(self) -> bool:
        if self.document.path is None:
            return self.save_file_as()
        try:
            self.document.save()
        except Exception as error:  # noqa: BLE001
            QMessageBox.critical(self, "No se pudo guardar", str(error))
            return False
        self._show_message(f"Guardado en {self.document.path.name}")
        return True

    def save_file_as(self) -> bool:
        path, _ = QFileDialog.getSaveFileName(
            self, "Guardar autómata", "automata.kflap", FILE_FILTER
        )
        if not path:
            return False
        try:
            self.document.save(path)
        except Exception as error:  # noqa: BLE001
            QMessageBox.critical(self, "No se pudo guardar", str(error))
            return False
        self._show_message(f"Guardado en {Path(path).name}")
        return True

    def export_png(self) -> None:
        scene = self.canvas.scene()
        rect = scene.itemsBoundingRect()
        if rect.isEmpty():
            self._show_message("No hay nada para exportar.")
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Exportar diagrama", "automata.png", "Imagen PNG (*.png)"
        )
        if not path:
            return

        scene.clearSelection()
        rect = rect.adjusted(-40, -40, 40, 40)
        # x2 para que la imagen se vea nítida en pantallas Retina y al imprimir.
        image = QImage(rect.size().toSize() * 2, QImage.Format.Format_ARGB32)
        image.fill(QColor("#0E0E1A"))
        painter = QPainter(image)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
        scene.render(painter, QRectF(image.rect()), rect)
        painter.end()

        if image.save(path):
            self._show_message(f"Diagrama exportado a {Path(path).name}")
        else:
            QMessageBox.critical(self, "Error", "No se pudo guardar la imagen.")

    def show_help(self) -> None:
        QMessageBox.information(
            self,
            "Cómo se usa kflap",
            "<b>Dibujar</b><br>"
            "• <b>S</b> + clic en el lienzo crea un estado (o doble clic en modo "
            "Seleccionar).<br>"
            "• <b>T</b> y después clic en el origen y en el destino crea una "
            "transición.<br>"
            "• <b>V</b> para mover estados. Doble clic renombra; clic derecho "
            "abre el menú (inicial, aceptación, eliminar).<br>"
            "• <b>D</b> borra con un clic. Supr elimina lo seleccionado.<br><br>"
            "<b>Tabla de estados</b><br>"
            "Escribí <b>→</b> antes del nombre para el estado inicial y <b>*</b> "
            "para los de aceptación. En las celdas van los destinos separados por "
            "coma; si nombrás un estado que no existe, se crea.<br><br>"
            "<b>Definición formal</b><br>"
            "Editá Q, Σ, q₀, F y δ y presioná «Aplicar definición».<br><br>"
            "<b>Verificar</b><br>"
            "Probá una cadena y recorré la traza con ◀ ▶, o pegá varias cadenas "
            "en la otra pestaña para probarlas todas juntas.",
        )

    # ------------------------------------------------------------------ #
    # Cierre
    # ------------------------------------------------------------------ #

    def closeEvent(self, event) -> None:
        if self._confirm_discard():
            event.accept()
        else:
            event.ignore()
