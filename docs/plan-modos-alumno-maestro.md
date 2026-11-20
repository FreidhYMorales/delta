# Plan: modos Libre / Alumno / Maestro, modo manual y ejercicios

Objetivo: que la app pueda usarse en clase como alternativa (o reemplazo)
de JFLAP — que el alumno resuelva a mano lo que hoy la app calcula sola, y
que el maestro cree ejercicios, revise entregas y muestre soluciones paso a
paso. Este documento recoge lo decidido y lo que falta decidir; se completa
antes de escribir código para no tener que corregir sobre la marcha.

## Decisiones tomadas

1. **Toda herramienta tiene modo automático y modo manual.** Automático es
   lo de hoy (la app calcula). Manual: el usuario completa los mismos pasos
   (tablas, árbol, derivación, tipo de Chomsky…) y la app los verifica.
2. **Tres modos de uso:**
   - **Libre** (lo de hoy): todo disponible — automático, manual con
     verificación y editor de nodos.
   - **Alumno**: nunca tiene respuesta automática; resuelve en manual. La
     verificación y las pistas dependen de la hoja: sí en práctica, no en
     evaluación (decisión 13). Entrega un archivo.
   - **Maestro**: crea ejercicios y los exporta; modo presentación (solución
     paso a paso en clase); revisión de entregas (la app corrige, marca qué
     está bien o mal, y el maestro puede corregir).
3. **Editor de nodos** para armar árboles a mano (árbol sintáctico de
   ER → AFD, árbol de derivación) con facilidades para el usuario; en Libre
   y en Alumno.
4. **El archivo de ejercicio no lleva la respuesta.** Todos los cálculos de
   la app son deterministas: al revisar, la app del maestro recalcula la
   respuesta desde los datos del ejercicio. Única excepción: los ejercicios
   de diseño en hojas de práctica (decisión 34).
5. **Corrección inteligente:** las respuestas se comparan por equivalencia,
   no por igualdad exacta (un AFD con otros nombres de estado, una
   derivación válida distinta), y se señala el primer paso equivocado.
6. **Banco de ejercicios:** los de los PDFs del curso precargados, más un
   generador aleatorio para practicar.
7. **Documentación** de la teoría y el uso de cada herramienta.
8. **Acceso por llave de activación firmada.** La app arranca en modo
   Alumno por defecto. "Activar…" carga un archivo de llave que habilita los
   modos Libre y Maestro. La llave está **firmada digitalmente**: la clave
   privada vive fuera del repo público (repo privado o fuera de línea) y la
   app solo trae la clave pública para verificar, así que nadie puede
   fabricar una llave válida leyendo el código. Cada llave lleva titular y
   vencimiento (p. ej. por semestre); la app muestra "Activado para: … ·
   vence …". Una herramienta de línea de comandos genera y firma llaves con
   la clave privada. Se descartaron los usuarios con contraseña (guardados
   en la propia máquina, evitables reinstalando) y las dos ediciones
   separadas (dos instaladores y dos canales de actualización).
9. **Límites conocidos (a comunicar al profesor):** el repo y las releases
   son públicos. Quien tenga una llave puede compartirla (titular y
   vencimiento lo desalientan); alguien con conocimientos podría compilar
   una versión sin el chequeo; la release v0.2.3 ya publicada no tiene este
   control (aunque tampoco las funciones nuevas). Sin internet no hay
   revocación anticipada: el vencimiento es la red de seguridad.
10. **Llaves atadas al equipo.** "Activar…" muestra un código de equipo
    (derivado del identificador del sistema — `/etc/machine-id`,
    `MachineGuid` de Windows, UUID de macOS — mezclado con un valor propio
    de Delta para no exponerlo). La llave firmada incluye ese código, titular,
    rol y vencimiento: en otra máquina no sirve. Reinstalar el sistema
    operativo cambia el código y requiere una llave nueva. Un "un solo uso"
    literal necesitaría un servidor en internet; se descartó (todo funciona
    sin conexión).
11. **Emisión de llaves desde un repo privado, sin repartir la clave
    privada.** La clave privada vive como secret cifrado del repo privado;
    un workflow de GitHub Actions (formulario: titular, código de equipo,
    rol, vencimiento) firma y entrega el archivo `.llave`, y registra cada
    emisión en el repo. Los colaboradores (profesores, encargados,
    directores) emiten llaves sin ver la clave; quitar a uno es quitarle el
    acceso al repo.
12. **Seguridad proporcional:** el objetivo es que un alumno no pueda
    saltear la restricción de forma casual (un clic, copiar un archivo), no
    blindar la app contra expertos.
13. **Ejercicios de práctica o de evaluación.** Al crear un ejercicio el
    maestro elige: práctica (el alumno puede verificar y ver pistas; sirve
    para estudiar en casa) o evaluación (sin verificación; se entrega para
    revisar).
14. **Aviso de vencimiento y registro en la entrega.** La app avisa 30 días
    antes de que venza la llave; al vencer vuelve a Alumno sin perder
    archivos. La entrega registra la versión de la app, si la hoja se cerró
    y reabrió, y los pases de práctica activados (contexto para revisar, no
    prueba infalible). Sin registro de horas: las entregas ya tienen fecha
    límite del curso.
15. **Pases de práctica libre que emite el maestro, sin internet.** Al
    activar su llave de maestro, la app del maestro crea su propio par de
    claves; la llave emitida desde el repo privado certifica esa clave
    ("Prof. X puede emitir pases de práctica hasta …"). La app del maestro
    firma pases sin pedírselos a nadie; la del alumno verifica la cadena
    (firma raíz → maestro → pase). Un maestro solo puede emitir pases de
    práctica, nunca llaves de maestro.
    - **Atados a equipos:** los alumnos entregan su código de equipo (p. ej.
      por un formulario); el maestro pega la lista y su app genera un solo
      archivo para el curso, que solo funciona en los equipos registrados.
      Misma máquina → mismo pase; máquina nueva (o sistema reinstalado) →
      el maestro la agrega y regenera.
    - **Dos plazos:** ventana de activación (por defecto 2 días desde la
      emisión: después no se puede activar) y duración de uso (por defecto
      7 días desde la activación). Volver a cargar el pase en el mismo
      equipo no reinicia la duración.
    - **Registro:** el equipo del alumno anota cada pase activado (cuál,
      cuándo, hasta cuándo) y ese registro viaja en las entregas, así el
      maestro lo ve al revisar; el equipo del maestro guarda el historial
      de lo emitido. Sin internet no hay consulta directa entre equipos.
    - **Guarda de reloj:** la app recuerda la fecha más reciente que vio; si
      el reloj retrocede más de un margen, no activa pases y lo registra.
      Reinstalar borra esa memoria, pero el uso nunca supera la ventana de
      activación más la duración.
    - Cada pase es único (emisión, plazos, curso, identificador aleatorio).
16. **Alcance del modo manual (y tipos de ejercicio).** Además de AFN → AFD,
    ER → AFD, gramáticas (tipo de Chomsky, derivación, árbol) y autómatas:
    - **Conversiones de AF:** AF → ER por eliminación de estados paso a
      paso, AF ↔ gramática regular, minimización de AFD.
    - **Simulación a mano:** traza de una cadena — estados en un AF,
      configuraciones (estado, pila, cinta) en Pila y Turing, salidas en
      Mealy y Moore —, verificada paso a paso.
    - **Diseño desde enunciado:** el alumno construye un AF, AP, MT o una
      gramática para un lenguaje; se corrige por equivalencia (AF, ER,
      gramáticas regulares) o con casos de prueba (Pila, Turing, gramáticas
      libres de contexto, donde la equivalencia es indecidible).
    - **Thompson verificado:** el AFN armado con piezas se verifica contra
      la expresión del enunciado.
    El formato de cada herramienta en manual sigue cómo se trabaja en clase:
    **pendiente** recibir ejemplos de ejercicios hechos a mano
    (`idea/ejercicios_clase/`) antes de la fase 3.
17. **Hoja de ejercicios con incisos.** Un archivo es una hoja (título,
    curso, instrucciones) con varios incisos de cualquier tipo. El alumno
    completa nombre y carné al empezar. Sin control de tiempo (ni límite ni
    ventana de fechas).
18. **Verificación con botón y pistas** (en Libre y en hojas de práctica):
    "Verificar" marca en verde/rojo las celdas o pasos y señala el primer
    error; "Pista" revela solo el siguiente paso o celda.
19. **La app no pone notas.** Al revisar solo indica qué está bien y qué no
    (y el primer error), para facilitar la corrección; el puntaje lo lleva
    el maestro en la plataforma de la universidad o viene dado por la tarea.
20. **Revisión por carpeta con resumen.** El maestro abre la carpeta con las
    entregas de una hoja: tabla alumno × inciso (✓/✗, con botón Copiar) y
    detalle de cada entrega (qué está mal, primer error). Puede cambiar a
    mano la marca de un inciso y dejar comentarios. La revisión queda en el
    equipo del maestro: no hay archivo de devolución para el alumno.
21. **Presentación paso a paso completa.** En cualquier herramienta, la
    solución se arma de a un paso (una celda, una fila, un nodo del árbol,
    un paso de derivación) con Siguiente/Anterior y teclado (← →), pantalla
    completa, letra grande y una explicación breve de cada paso.
22. **Interfaz en español e inglés, con selector de idioma.** Todo texto
    visible pasa por un catálogo de traducciones. Los mensajes que hoy arma
    el core en español (errores de los parsers de regex y gramáticas,
    explicaciones de Chomsky, motivos de rechazo) pasan a devolverse como
    código de mensaje + datos, y el frontend los traduce. La base de idiomas
    va primero (fase 0) para que todo lo nuevo nazca traducible; los textos
    existentes se migran en la fase de mejoras visuales.
23. **Permisos, no modos para alternar.** Sin llave: Alumno. Con pase de
    práctica: Libre. Con llave de maestro: Libre + menú Maestro (crear hojas,
    revisar, presentar, emitir pases). El maestro tiene "Ver como alumno"
    para ver la app con las restricciones del modo Alumno.
24. **Solicitud de activación.** "Activar…" genera una solicitud (texto para
    copiar) con el código de equipo y la clave pública que la app crea en
    ese momento; el workflow del repo privado recibe la solicitud y firma la
    llave certificando esa clave (necesario para que el maestro emita
    pases). La clave privada del maestro se guarda en el almacén seguro del
    sistema operativo (keyring); si se pierde, se reactiva. Los alumnos solo
    necesitan su código de equipo (corto) para los pases; Alumno muestra
    "Mi código de equipo".
25. **Reglas de vigencia:** un pase nunca vale más allá del vencimiento de la
    llave del maestro que lo emitió; la guarda de reloj también aplica al
    vencimiento de las llaves.
26. **Rotación de claves y desarrollo.** La app acepta una lista de claves
    públicas raíz (si la privada se filtra, una actualización agrega una
    nueva y retira la vieja). Las compilaciones de desarrollo y los tests
    usan una clave raíz de prueba.
27. **Formatos de archivo versionados** (hoja, entrega, llave, pase,
    solicitud), como el formato de proyecto. La entrega referencia el
    identificador de la hoja.
28. **La hoja es un tipo de proyecto:** cada inciso se abre como pestaña,
    con sus instrucciones arriba; se reutiliza el sistema de pestañas.
29. **Base común "pasos de solución".** Cada herramienta expone su solución
    como una secuencia de pasos; esa misma estructura alimenta las pistas
    (siguiente paso), la verificación (primer error) y la presentación (paso
    a paso). Se construye en la fase 3 pensando ya en la 6.
30. **Casos de prueba** para diseño en Pila, Turing y gramáticas libres de
    contexto (equivalencia indecidible): los define el maestro o se generan
    desde su solución de referencia.
31. **Los enunciados no se traducen** (los escribe el maestro en su idioma);
    la interfaz sí.
32. **Usuarios actuales:** al actualizar, quien usa la v0.2.x queda en
    Alumno; avisarlo en las notas de la versión y tener lista la llave
    propia antes de publicar.
33. **Qué hay en modo Alumno (con o sin hoja abierta).** Disponible: todo
    lo que no da respuestas — editar autómatas y gramáticas, tabla de
    estados, definición formal, Organizar, piezas de Thompson, todo el modo
    manual — y **simular cadenas** en el autómata propio (es como probar un
    programa). En gramáticas, probar una cadena muestra solo si se acepta o
    no, sin derivación ni árbol. Ocultas: las conversiones automáticas
    (pestañas Expresión regular, Gramática regular, AFN → AFD, ER → AFD,
    Convertir/Minimizar, generar desde regex o gramática), la clasificación
    de Chomsky, y las derivaciones y árboles automáticos.
34. **Diseño en hojas de práctica: referencia oculta.** Solo en práctica, la
    solución de referencia del maestro va dentro del archivo, ofuscada (no se
    ve al abrirlo ni en la app); "Verificar" dice bien o mal y da un
    contraejemplo ("tu AFD acepta 'ab' y no debería"). Un experto podría
    extraerla, pero es práctica. En hojas de evaluación nunca va la
    referencia: la tiene solo el maestro para revisar. Por eso el maestro
    trabaja sobre su copia de la hoja (con las referencias) y exporta la
    versión para alumnos.
35. **Thompson verificado: estructura + lenguaje.** Se exige la
    construcción exacta (mismas piezas y conexiones, sin importar nombres ni
    posición de los estados); si la estructura no coincide pero el lenguaje
    sí, se indica "acepta el lenguaje correcto, pero no es la construcción
    de Thompson". La referencia es la **nomenclatura del curso** (`rs`
    comparte el estado del medio, sin ε). Tarea derivada: el generador
    automático regex → AFN del core hoy une la concatenación con una ε; debe
    pasar a la nomenclatura del curso para que automático, piezas y
    verificación coincidan.
36. **Editor de hojas (Maestro).** Una pestaña "Hoja": título, curso,
    práctica o evaluación, instrucciones. "Agregar inciso" elige el tipo
    (convertir AFN → AFD, derivar, diseñar…), el enunciado y los datos, que
    se editan con las herramientas de siempre (diagrama, gramática) o se
    traen de una pestaña abierta; en los de diseño, la solución de
    referencia y, si corresponde, los casos de prueba. Vista previa como
    alumno y "Exportar para alumnos".
37. **Reabrir y reentregar.** El alumno puede seguir trabajando y volver a
    entregar. "Entregar" guarda sobre el mismo archivo por defecto (o donde
    el alumno elija): la plataforma del curso ya guarda cada intento. El
    archivo lleva un contador de intentos (entrega 1, 2…) que el maestro ve
    al revisar. El plazo lo controla la plataforma del curso.

## Fases

| Fase | Contenido |
|---|---|
| 0 · Idiomas | Catálogo de traducciones, selector español/inglés, mensajes del core como código + datos |
| 1 · Modos y llaves | Permisos Alumno / Libre / Maestro y qué se oculta en Alumno; solicitud de activación y llaves firmadas atadas al equipo; workflow de emisión en el repo privado; pases de práctica del maestro; vigencias, guarda de reloj y rotación de claves (decisiones 8, 10–12, 14, 15, 23–26, 32, 33) |
| 2 · Editor de nodos | Armar árboles a mano; lo usan 3b y 3c |
| 3 · Modo manual con verificación | Base "pasos de solución"; 3a AFN → AFD · 3b ER → AFD · 3c Gramáticas · 3d Autómatas · conversiones de AF, simulación a mano, diseño desde enunciado y Thompson verificado, con el generador regex → AFN pasado a la nomenclatura del curso (decisiones 16, 18, 29, 35). **Requiere antes los ejemplos de clase.** |
| 4 · Ejercicios | Formatos versionados; editor de hojas y exportación (Maestro); resolver, verificar en práctica y entregar/reentregar (Alumno) (decisiones 13, 17, 27, 28, 33, 34, 36, 37) |
| 5 · Revisión | Carpeta de entregas con resumen ✓/✗; corrección inteligente; marcas manuales y comentarios; sin notas (decisiones 5, 19, 20, 30) |
| 6 · Presentación | Solución paso a paso en clase, sobre la base "pasos de solución" (decisiones 21, 29) |
| 7 · Banco de ejercicios | Precargados de los PDFs + generador aleatorio |
| 8 · Documentación | Teoría y uso de cada herramienta |

Después: optimizaciones y mejoras visuales (acordado: al final, con todo
estable).

## Cómo se trabaja cada fase

- **Este plan** fija el *qué*: comportamiento visible, permisos, flujos y
  reglas.
- **Al empezar cada fase**, antes de programar, se agrega aquí una sección
  "Diseño de la fase N" con el *cómo*: estructuras de datos, formato
  interno de archivos, módulos y cómo se ve cada pantalla nueva. Se
  consulta lo que afecta el uso o la apariencia; lo técnico queda
  documentado para revisión. El diseño técnico de las fases avanzadas
  depende de lo construido en las primeras, por eso no se adelanta.
- Cada fase se hace con TDD, termina con la suite completa y el build en
  verde, y se commitea por separado.

## Preguntas abiertas

Se resuelven una por una; cada respuesta pasa a "Decisiones tomadas".

Segunda revisión (pendientes de decidir):

10. ~~Ejercicios de diseño en hojas de práctica~~ → decisión 34.
11. ~~Qué puede hacer el Alumno sin hoja abierta~~ → decisión 33.
12. ~~Thompson verificado~~ → decisión 35.
13. ~~Cómo arma el maestro una hoja~~ → decisión 36.
14. ~~Entregar~~ → decisión 37.

1. ~~Cómo se entra y se sale de cada modo~~ → decisión 8 (llave firmada).
2. ~~Alcance del modo manual~~ → decisión 16.
3. ~~Forma del ejercicio~~ → decisión 17.
4. ~~Verificación en Libre~~ → decisión 18.
5. ~~Puntaje~~ → decisión 19 (sin notas).
6. ~~Revisión~~ → decisión 20.
7. ~~Presentación~~ → decisión 21.
8. **Documentación** — **pendiente a propósito**: el usuario la consulta
   (el contenido puede cambiar). Opciones planteadas: ayuda contextual (un
   "?" por herramienta), una sección aparte con índice y buscador, o ambas;
   todo sin internet. Es la última fase, no bloquea las anteriores.
9. ~~Idioma~~ → decisión 22.
