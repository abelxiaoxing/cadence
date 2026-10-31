# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence convierte a [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) en un espacio de trabajo de tareas persistente.
Planifica una tarea de código, deja que los subagentes trabajen en ella, ejecuta tus comprobaciones y revisa el resultado desde el terminal de Pi (`/cadence`) o desde la interfaz web del navegador; ambos se conectan al mismo servicio en segundo plano.

## Por qué Cadence

- **El trabajo sobrevive a la ventana.**
  Las tareas se ejecutan en un servicio en segundo plano: cerrar el terminal, salir de Pi o dejar la pestaña del navegador solo desconecta, y cualquier cliente puede volver a conectarse a la misma ejecución.
- **Nada se edita antes de que apruebes.**
  Una tarea primero analiza en solo lectura y propone un plan legible; los archivos solo cambian después de que confirmes ese plan exacto.
- **Resultados en los que puedes confiar.**
  La salida de los subagentes, las ejecuciones reales de comprobaciones y tu propia revisión permanecen separadas: la prosa del modelo o un "Done" nunca cuentan como comprobación superada, y los resultados fallidos, cancelados y desconocidos permanecen distinguidos.
- **Historial completo.**
  Cada ejecución conserva sus mensajes, llamadas a herramientas y salidas, con búsqueda exacta y exportación completa en Markdown/NDJSON; los secretos conocidos se enmascaran.
- **Un enlace para todo.**
  La interfaz web (escritorio y teléfono, inglés y chino simplificado) también aloja conversaciones ordinarias de Pi y cambia entre proyectos, cada uno con su propio owner e historial.

Cadence es un asistente de confianza, **no una caja de arena**: sus agentes editan tu copia de trabajo directamente con herramientas del host, así que úsalo en código que puedas revisar y recuperar.

## Instalación

Necesitas Node `>=22.19.0` con npm, y Pi instalado y conectado a un proveedor de modelos; Cadence reutiliza el inicio de sesión y la configuración de modelos de Pi.

```sh
npm install -g @abelxiaoxing/cadence
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` registra e inicia un servicio en segundo plano (systemd en Linux, un LaunchAgent en macOS, una entrada de inicio de sesión en Windows) e imprime un enlace privado, `http://127.0.0.1:17423/?token=…`.
El último comando permite que Pi cargue la misma copia para `/cadence`, de modo que una actualización de npm actualiza ambos.
El puerto y el token están en `~/.pi/agent/cadence/.env`; cualquiera con el token puede usar tu espacio de trabajo, así que mantén el enlace privado.

## Uso

### En el navegador

1. Abre el enlace impreso una vez; el navegador entonces te recuerda.
   Si lo pierdes, `cadence token-link --reveal` lo imprime de nuevo.
2. Elige una carpeta de proyecto.
   Al enviar se reutiliza la preferencia de modelo guardada; elige una vez si no existe.
3. Envía `/cadence [objetivo]` una vez.
   Esta conversación permanece en modo Cadence; aclara los requisitos con mensajes normales.
4. Revisa el plan completo y pulsa **Implement this plan**.
   La implementación, comprobaciones, reparaciones limitadas y entrega local acordada son automáticas.
5. Sigue el progreso en la conversación; abre los registros de los subagentes desde el panel **Subagents** abajo a la izquierda.
   Recargar o terminar un objetivo no desactiva el modo.
   **Exit Cadence** sale del modo; **Cancel workflow — request stop** solicita cancelar el trabajo.

**Legacy task**: previous task/history workflow.
No live Pi terminal is required for the browser conversation workflow.

### En el terminal

Escribe `/cadence <objetivo>` una sola vez y continúa conversando normalmente.
Cadence investiga el proyecto, aclara decisiones y prepara un plan.
Tras aprobarlo explícitamente, implementa, verifica, realiza reparaciones limitadas y entrega la integración local acordada.

El modo permanece activo durante toda la conversación, incluso al terminar un objetivo.
Usa `exit cadence` para salir; salir no cancela el trabajo aceptado.
Las preferencias de modelo se guardan entre proyectos en `~/.pi/agent/cadence/settings.json`.

El propietario local se inicia bajo demanda; el servicio del sistema es opcional para WebUI/inicio automático.

`/cadence-inspect`: legacy task/history UI.
[Conversation mode](docs/conversation-mode.md): native/browser approval, limits and worktree setup.
Browser authentication is not execution consent.

### Más proyectos

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

Cada proyecto obtiene su propio owner, puerto e historial, y el comando imprime su enlace privado; el selector de carpetas de la interfaz web abre proyectos de la misma manera.
Abrir otro proyecto nunca detiene el trabajo del anterior.

### Comprobaciones

Lista los comandos que verifican tu proyecto en `.cadence/assistant/config.json`, y las tareas pueden ejecutarlos como comprobaciones reales antes de la revisión:

```json
{
  "schema": "cadence-assistant-checks/1",
  "checks": [{ "name": "Tests", "command": "bun run test", "timeoutMs": 120000 }]
}
```

## Gestionar el servicio

```sh
cadence server status
cadence server restart     # después de una actualización o un cambio de .env / models.json
cadence server stop        # permanece registrado y vuelve a iniciar en el próximo arranque o inicio de sesión
cadence server uninstall   # ejecutar antes de npm uninstall -g
```

Actualiza con `npm install -g @abelxiaoxing/cadence@latest`, luego `cadence server restart`.
Restart, stop y uninstall detienen el trabajo en ejecución en orden en lugar de dejarlo desconectado.
Uninstall solo elimina la definición del servicio; los proyectos, el historial y la configuración de Pi permanecen.
Los servicios raíz de Linux y con nombre, el acceso HTTPS remoto y la recuperación se cubren en [gestión del servicio](docs/service-management.md) y [acceso remoto](docs/remote-access.md).

## Desarrollo

Pi también puede cargar un checkout local o un tarball empaquetado: añade su ruta absoluta o relativa a `packages` de Pi, o prueba `pi -e ./cadence`.
Cadence no impone un rango de versiones de Pi; los pines de desarrollo y los tiempos de ejecución probados no son promesas de compatibilidad universales.

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

La guía de ingeniería se divide por área bajo [engineering/](engineering/); el índice del proyecto en [AGENTS.md](AGENTS.md) indica qué archivo cubre qué código.
`verify` también necesita un build oficial de Node, un directorio temporal privado y un Chromium existente; ver [verificación](engineering/verification.md).

## Licencia

Cadence es MIT.
Las adaptaciones, fuentes y proveedores incluidos conservan sus propias licencias; ver [reutilización y distribución](docs/reuse-and-distribution.md) y [avisos de terceros](THIRD_PARTY_NOTICES.md).
