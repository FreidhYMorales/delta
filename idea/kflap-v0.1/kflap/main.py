#!/usr/bin/env python3
"""Punto de entrada de kflap."""

from __future__ import annotations

import sys

if sys.version_info < (3, 9):
    sys.exit(
        f"kflap necesita Python 3.9 o superior (tenés {sys.version.split()[0]}).\n"
        "Descargalo de https://www.python.org/downloads/"
    )

try:
    from PySide6.QtWidgets import QApplication
except ModuleNotFoundError:
    sys.exit(
        "Falta PySide6, la única dependencia de kflap.\n\n"
        "Instalala con:\n"
        f"    {sys.executable} -m pip install PySide6\n\n"
        "Después volvé a correr:\n"
        f"    {sys.executable} main.py"
    )

from kflap.ui import theme
from kflap.ui.main_window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("kflap")
    app.setApplicationDisplayName("kflap")
    app.setOrganizationName("kflap")
    # Fusion respeta las hojas de estilo de forma consistente; el estilo nativo
    # de macOS ignora buena parte del QSS.
    app.setStyle("Fusion")
    app.setStyleSheet(theme.STYLESHEET)

    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
