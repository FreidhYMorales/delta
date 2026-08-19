# kflap

Editor y simulador de autómatas finitos para macOS, escrito en Python + PySide6.
Pensado como reemplazo de JFLAP para la cursada, y para ir creciendo con el curso.

## Instalación

Hace falta **Python 3.9 o superior** ([descarga](https://www.python.org/downloads/))
y una sola dependencia, PySide6. Funciona en macOS, Windows y Linux.

**macOS / Linux**

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

**Windows (PowerShell)**

```powershell
python -m venv .venv; .venv\Scripts\pip install -r requirements.txt
```

## Correr la app

**macOS / Linux**

```bash
.venv/bin/python main.py
```

**Windows (PowerShell)**

```powershell
.venv\Scripts\python main.py
```

> La carpeta `.venv` **no se comparte**: pesa más de 1 GB y sólo sirve en la
> máquina donde se creó. Cada persona corre la instalación de arriba y se arma
> la suya. El código en sí ocupa unos 150 KB.

## Qué hace (v0.1)

Tres vistas del **mismo** autómata, siempre sincronizadas: lo que cambiás en una
aparece en las otras dos.

### 1. Diagrama

| Tecla | Herramienta |
|-------|-------------|
| `V`   | Seleccionar y mover estados |
| `S`   | Crear estado (clic en el lienzo) |
| `T`   | Crear transición (clic en origen, después en destino) |
| `D`   | Borrar de un clic |

- Doble clic sobre un estado lo renombra; en modo Seleccionar, doble clic en el
  lienzo vacío crea un estado.
- Clic derecho sobre un estado: marcarlo inicial, marcarlo de aceptación,
  renombrar o eliminar.
- `Supr` elimina lo seleccionado, `Esc` vuelve a Seleccionar.
- `Cmd` + rueda hace zoom; `Cmd+1` ajusta a la ventana; `Cmd+L` acomoda los
  estados en círculo.

### 2. Tabla de estados

El formato de clase:

```
ESTADOS │  a  │  b
→ q0    │ q1  │ q0
* q1    │ q1  │ q0
```

- `→` marca el estado inicial, `*` los de aceptación. Se escriben junto al nombre.
- En las celdas van los destinos separados por coma (varios destinos = AFN).
- Si escribís un estado que todavía no existe, se crea solo: podés tipear la
  tabla entera de corrido y después acomodar el diagrama con `Cmd+L`.
- El campo `Σ` define las columnas.

### 3. Definición formal

La quíntupla **M = (Q, Σ, δ, q₀, F)**, editable a mano. δ se escribe con una
regla por línea:

```
δ(q0, a) = q1
δ(q0, b) = q0
δ(q1, a) = {q1, q2}
```

También se acepta `q0, a -> q1`. Al presionar **Aplicar definición** se
reconstruyen el diagrama y la tabla.

### Verificación de cadenas

- **Una cadena**: veredicto aceptada/rechazada, traza completa y recorrido paso a
  paso con `◀ ▶` resaltando los estados activos en el diagrama.
- **Varias cadenas**: una por línea, resultado de todas juntas en una tabla.

Soporta **AFD y AFN**, incluidas transiciones **ε** (se escriben `ε`, `lambda` o
dejando el símbolo vacío). La barra de estado indica si el autómata es AFD o AFN.

### Archivos

Guarda en `.kflap` (JSON legible). También exporta el diagrama a PNG desde
**Archivo › Exportar diagrama**, listo para pegar en la entrega.

## Estructura

```
main.py                  punto de entrada
kflap/core/automaton.py  modelo formal y simulación (sin Qt)
kflap/core/document.py   documento con señales, historial y archivo
kflap/ui/canvas.py       diagrama editable
kflap/ui/table_panel.py  tabla de estados
kflap/ui/formal_panel.py definición formal
kflap/ui/test_panel.py   verificación de cadenas
kflap/ui/theme.py        tema visual
```

## Próximos pasos

Cosas que se pueden agregar cuando el curso llegue a esos temas:

- Conversión AFN → AFD y minimización de AFD
- Expresiones regulares ↔ autómata
- Gramáticas regulares y libres de contexto
- Autómatas de pila y máquinas de Turing
