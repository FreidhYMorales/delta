"""Tema visual: fondo tipo aurora + paneles de vidrio esmerilado.

macOS no expone su efecto de vibrancy a Qt, así que lo reproducimos: pintamos
un fondo de gradientes suaves y encima ponemos paneles translúcidos con bordes
claros. El resultado se lee como vidrio sin depender de APIs nativas.
"""

from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QPainter, QRadialGradient

# --------------------------------------------------------------------------- #
# Paleta
# --------------------------------------------------------------------------- #

INK = "#E9EBF8"
MUTED = "rgba(233, 235, 248, 0.55)"
FAINT = "rgba(233, 235, 248, 0.30)"

GLASS = "rgba(255, 255, 255, 0.055)"
GLASS_HOVER = "rgba(255, 255, 255, 0.10)"
GLASS_STRONG = "rgba(255, 255, 255, 0.13)"
STROKE = "rgba(255, 255, 255, 0.14)"
STROKE_SOFT = "rgba(255, 255, 255, 0.08)"

ACCENT = "#7DD3FC"
ACCENT_DEEP = "#38BDF8"
VIOLET = "#A78BFA"
OK = "#4ADE80"
BAD = "#FB7185"
WARN = "#FBBF24"

#: Colores del lienzo (QColor porque los usa el pintado del diagrama).
CANVAS_STATE_FILL = QColor(255, 255, 255, 26)
CANVAS_STATE_STROKE = QColor(233, 235, 248, 150)
CANVAS_STATE_TEXT = QColor(233, 235, 248)
CANVAS_SELECTED = QColor(125, 211, 252)
CANVAS_HIGHLIGHT = QColor(74, 222, 128)
CANVAS_EDGE = QColor(233, 235, 248, 130)
CANVAS_EDGE_LABEL = QColor(233, 235, 248, 225)
CANVAS_GRID = QColor(255, 255, 255, 16)


STYLESHEET = f"""
* {{
    font-family: "SF Pro Text", "Helvetica Neue", Helvetica, sans-serif;
    font-size: 13px;
    color: {INK};
}}

QMainWindow, QDialog {{
    background: transparent;
}}

QWidget#GlassPanel {{
    background: {GLASS};
    border: 1px solid {STROKE};
    border-radius: 16px;
}}

QWidget#Transparent {{
    background: transparent;
}}

QLabel {{
    background: transparent;
}}

QLabel#Title {{
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.2px;
}}

QLabel#Subtle {{
    color: {MUTED};
    font-size: 12px;
}}

QLabel#Mono {{
    font-family: "SF Mono", "JetBrains Mono", Menlo, monospace;
    font-size: 12px;
}}

/* ----------------------------------------------------------- Botones -- */

QPushButton {{
    background: {GLASS};
    border: 1px solid {STROKE};
    border-radius: 9px;
    padding: 6px 14px;
    font-weight: 500;
}}

QPushButton:hover {{
    background: {GLASS_HOVER};
    border-color: rgba(255, 255, 255, 0.24);
}}

QPushButton:pressed {{
    background: rgba(255, 255, 255, 0.16);
}}

QPushButton:disabled {{
    color: {FAINT};
    border-color: {STROKE_SOFT};
}}

QPushButton#Primary {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                                stop:0 rgba(56, 189, 248, 0.85),
                                stop:1 rgba(167, 139, 250, 0.85));
    border: 1px solid rgba(255, 255, 255, 0.28);
    color: #06121F;
    font-weight: 650;
}}

QPushButton#Primary:hover {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                                stop:0 rgba(56, 189, 248, 1.0),
                                stop:1 rgba(167, 139, 250, 1.0));
}}

/* --------------------------------------------------------- Toolbar --- */

QToolBar {{
    background: transparent;
    border: none;
    spacing: 4px;
    padding: 6px 10px;
}}

QToolBar QToolButton {{
    background: transparent;
    border: 1px solid transparent;
    border-radius: 9px;
    padding: 6px 12px;
    font-weight: 500;
}}

QToolBar QToolButton:hover {{
    background: {GLASS_HOVER};
    border-color: {STROKE};
}}

QToolBar QToolButton:checked {{
    background: rgba(125, 211, 252, 0.22);
    border-color: rgba(125, 211, 252, 0.55);
    color: #FFFFFF;
}}

QToolBar::separator {{
    background: {STROKE};
    width: 1px;
    margin: 6px 8px;
}}

/* ------------------------------------------------------------ Docks --- */

QDockWidget {{
    background: transparent;
    border: none;
    titlebar-close-icon: none;
    titlebar-normal-icon: none;
    font-weight: 600;
}}

QDockWidget > QWidget {{
    background: transparent;
}}

QDockWidget::title {{
    background: transparent;
    padding: 8px 12px 4px 14px;
    color: {MUTED};
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 1.1px;
}}

/* ------------------------------------------------------------- Tabs --- */

QTabWidget::pane {{
    border: none;
    background: transparent;
}}

QTabBar {{
    background: transparent;
    qproperty-drawBase: 0;
}}

QTabBar::tab {{
    background: transparent;
    border: 1px solid transparent;
    border-radius: 9px;
    padding: 6px 14px;
    margin: 2px 3px;
    color: {MUTED};
    font-weight: 500;
}}

QTabBar::tab:hover {{
    background: {GLASS_HOVER};
    color: {INK};
}}

QTabBar::tab:selected {{
    background: {GLASS_STRONG};
    border-color: {STROKE};
    color: {INK};
}}

/* ----------------------------------------------------------- Inputs --- */

QLineEdit, QPlainTextEdit, QTextEdit, QSpinBox, QComboBox {{
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid {STROKE};
    border-radius: 9px;
    padding: 6px 10px;
    selection-background-color: rgba(125, 211, 252, 0.35);
}}

QLineEdit:focus, QPlainTextEdit:focus, QTextEdit:focus, QComboBox:focus {{
    border-color: rgba(125, 211, 252, 0.75);
    background: rgba(0, 0, 0, 0.30);
}}

QLineEdit#Mono, QPlainTextEdit#Mono {{
    font-family: "SF Mono", "JetBrains Mono", Menlo, monospace;
}}

QLineEdit#Word {{
    font-family: "SF Mono", "JetBrains Mono", Menlo, monospace;
    font-size: 16px;
    letter-spacing: 3px;
    padding: 9px 12px;
}}

QComboBox::drop-down {{
    border: none;
    width: 18px;
}}

QComboBox QAbstractItemView {{
    background: #1B1B2E;
    border: 1px solid {STROKE};
    border-radius: 8px;
    selection-background-color: rgba(125, 211, 252, 0.30);
    padding: 4px;
}}

QCheckBox {{
    background: transparent;
    spacing: 7px;
}}

QCheckBox::indicator {{
    width: 15px;
    height: 15px;
    border-radius: 5px;
    border: 1px solid {STROKE};
    background: rgba(0, 0, 0, 0.25);
}}

QCheckBox::indicator:checked {{
    background: {ACCENT_DEEP};
    border-color: {ACCENT};
}}

/* ----------------------------------------------------------- Tablas --- */

QTableWidget, QTableView {{
    background: rgba(0, 0, 0, 0.18);
    alternate-background-color: rgba(255, 255, 255, 0.03);
    border: 1px solid {STROKE};
    border-radius: 12px;
    gridline-color: {STROKE_SOFT};
    selection-background-color: rgba(125, 211, 252, 0.25);
    selection-color: {INK};
}}

QTableWidget::item, QTableView::item {{
    padding: 5px 7px;
    border: none;
}}

QHeaderView {{
    background: transparent;
}}

QHeaderView::section {{
    background: rgba(255, 255, 255, 0.07);
    border: none;
    border-right: 1px solid {STROKE_SOFT};
    border-bottom: 1px solid {STROKE_SOFT};
    padding: 7px 8px;
    font-weight: 600;
    color: {INK};
}}

QHeaderView::section:vertical {{
    border-right: 1px solid {STROKE};
}}

QTableCornerButton::section {{
    background: rgba(255, 255, 255, 0.07);
    border: none;
}}

/* --------------------------------------------------------- Scrolls --- */

QScrollBar:vertical, QScrollBar:horizontal {{
    background: transparent;
    border: none;
    margin: 2px;
}}

QScrollBar:vertical {{ width: 10px; }}
QScrollBar:horizontal {{ height: 10px; }}

QScrollBar::handle {{
    background: rgba(255, 255, 255, 0.20);
    border-radius: 5px;
    min-height: 28px;
    min-width: 28px;
}}

QScrollBar::handle:hover {{
    background: rgba(255, 255, 255, 0.34);
}}

QScrollBar::add-line, QScrollBar::sub-line,
QScrollBar::add-page, QScrollBar::sub-page {{
    background: none;
    border: none;
    height: 0;
    width: 0;
}}

/* ------------------------------------------------------------ Menús --- */

QMenuBar {{
    background: transparent;
}}

QMenuBar::item {{
    background: transparent;
    padding: 5px 10px;
    border-radius: 7px;
}}

QMenuBar::item:selected {{
    background: {GLASS_HOVER};
}}

QMenu {{
    background: #1B1B2E;
    border: 1px solid {STROKE};
    border-radius: 10px;
    padding: 5px;
}}

QMenu::item {{
    padding: 6px 22px 6px 14px;
    border-radius: 7px;
}}

QMenu::item:selected {{
    background: rgba(125, 211, 252, 0.25);
}}

QMenu::separator {{
    height: 1px;
    background: {STROKE};
    margin: 5px 8px;
}}

/* ---------------------------------------------------------- Varios --- */

QSplitter::handle {{
    background: transparent;
}}

QGraphicsView {{
    background: transparent;
    border: 1px solid {STROKE};
    border-radius: 16px;
}}

QStatusBar {{
    background: transparent;
    color: {MUTED};
}}

QStatusBar::item {{
    border: none;
}}

QToolTip {{
    background: #1B1B2E;
    border: 1px solid {STROKE};
    border-radius: 7px;
    padding: 5px 8px;
    color: {INK};
}}
"""


def paint_aurora(painter: QPainter, rect: QRectF) -> None:
    """Pinta el fondo de la ventana: base oscura + manchas de color difusas."""
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    painter.fillRect(rect, QColor("#0E0E1A"))

    w, h = rect.width(), rect.height()
    blobs = [
        (QPointF(rect.left() + w * 0.16, rect.top() + h * 0.08), w * 0.62, QColor(88, 80, 220, 120)),
        (QPointF(rect.left() + w * 0.92, rect.top() + h * 0.20), w * 0.55, QColor(30, 140, 190, 105)),
        (QPointF(rect.left() + w * 0.72, rect.top() + h * 0.96), w * 0.66, QColor(140, 60, 190, 95)),
        (QPointF(rect.left() + w * 0.05, rect.top() + h * 0.82), w * 0.48, QColor(20, 130, 150, 85)),
    ]
    painter.setPen(Qt.PenStyle.NoPen)
    for center, radius, color in blobs:
        gradient = QRadialGradient(center, radius)
        gradient.setColorAt(0.0, color)
        transparent = QColor(color)
        transparent.setAlpha(0)
        gradient.setColorAt(1.0, transparent)
        painter.setBrush(QBrush(gradient))
        painter.drawRect(rect)
