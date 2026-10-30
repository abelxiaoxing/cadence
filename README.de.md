# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence macht [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) zu einem dauerhaften Aufgaben-Workspace.
Plane eine Code-Aufgabe, lass Subagents daran arbeiten, führe deine Checks aus und prüfe das Ergebnis im Pi-Terminal (`/cadence`) oder im Browser-WebUI; beide verbinden sich mit demselben Hintergrunddienst.

## Warum Cadence

- **Die Arbeit überlebt das Fenster.**
  Aufgaben laufen in einem Hintergrunddienst: Das Schließen des Terminals, das Beenden von Pi oder das Verlassen des Browser-Tabs trennt nur die Verbindung, und jeder Client kann sich erneut mit demselben Lauf verbinden.
- **Nichts wird bearbeitet, bevor du zustimmst.**
  Eine Aufgabe analysiert zuerst schreibgeschützt und schlägt einen lesbaren Plan vor; Dateien ändern sich erst, nachdem du genau diesen Plan bestätigt hast.
- **Ergebnisse, denen du vertrauen kannst.**
  Subagent-Ausgabe, echte Check-Läufe und deine eigene Prüfung bleiben getrennt: Modelltext oder ein „Done“ zählt nie als bestanden, und fehlgeschlagene, abgebrochene und unbekannte Ergebnisse bleiben unterscheidbar.
- **Vollständige Historie.**
  Jeder Lauf behält seine Nachrichten, Tool-Aufrufe und Ausgaben, mit exakter Suche und vollständigem Markdown/NDJSON-Export; bekannte Geheimnisse werden maskiert.
- **Ein Link für alles.**
  Das WebUI (Desktop und Telefon, Englisch und Vereinfachtes Chinesisch) beherbergt außerdem gewöhnliche Pi-Gespräche und wechselt zwischen Projekten, jedes mit eigenem Owner und eigener Historie.

Cadence ist ein vertrauenswürdiger Assistent, **keine Sandbox**: Seine Agenten bearbeiten deine Arbeitskopie direkt mit Host-Tools, daher nutze es nur für Code, den du prüfen und wiederherstellen kannst.

## Installation

Du brauchst Node `>=22.19.0` mit npm und Pi, installiert und bei einem Modell-Anbieter angemeldet; Cadence wiederverwendet Pís Anmeldung und Modell-Einstellungen.

```sh
npm install -g @abelxiaoxing/cadence
cadence server install
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` registriert und startet einen Hintergrunddienst (auf Linux systemd, auf macOS ein LaunchAgent, auf Windows einen Eintrag in der Anmeldung) und gibt einen privaten Link aus, `http://127.0.0.1:17423/?token=…`.
Der letzte Befehl lässt Pi dieselbe Kopie für `/cadence` laden, sodass ein npm-Upgrade beide aktualisiert.
Port und Token liegen in `~/.pi/agent/cadence/.env`; wer das Token hat, kann deinen Workspace verwenden, daher den Link geheim halten.

## Verwendung

### Im Browser

1. Öffne den ausgegebenen Link einmal; der Browser erinnert sich dann an dich.
   Wenn du ihn verlierst, gibt `cadence token-link --reveal` ihn erneut aus.
2. Wähle mit dem Ordner-Button unten rechts einen Projektordner und wähle ein Modell.
3. Sende eine Nachricht für ein gewöhnliches Gespräch oder beginne mit `cadence <goal>` (oder wähle Cadence-Aufgabe), um eine Aufgabe zu erstellen.
4. Wenn die Analyse einen Plan vorschlägt, öffne **Implementierungsplan prüfen** und wähle **Plan bestätigen und ausführen**.
5. Verfolge die Subagents im Dock links unten; Checks, Änderungen und Prüfung finden sich unter **Aufgabendetails** rechts.

### Im Terminal

Gib im Pi-TUI selbst `/cadence [goal]` ein und drücke Enter; eingefügte oder skriptgesteuerte Eingaben öffnen es nicht.
Wähle ein Modell, erstelle oder öffne eine Aufgabe, bearbeite ihren Plan und bestätige Start; die Menüs zeigen außerdem Subagents, Checks, Änderungen, Prüfung und Historie.

Jede Pi-Session zeigt außerdem laufende Hintergrund-Agenten über der Eingabe: Drücke ↓ bei leerer Eingabe, um einen auszuwählen, und Enter, um sein Transkript zu lesen (`CADENCE_AGENT_PANEL=off` blendet das Panel aus).

### Weitere Projekte

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

Jedes Projekt erhält seinen eigenen Owner, Port und seine eigene Historie, und der Befehl gibt seinen privaten Link aus; der WebUI-Ordnerwähler öffnet Projekte auf dieselbe Weise.
Das Öffnen eines anderen Projekts stoppt nie die Arbeit im vorherigen.

### Checks

Liste die Befehle, die dein Projekt verifizieren, in `.cadence/assistant/config.json` auf, und Aufgaben können sie vor der Prüfung als echte Checks ausführen:

```json
{
  "schema": "cadence-assistant-checks/1",
  "checks": [{ "name": "Tests", "command": "bun run test", "timeoutMs": 120000 }]
}
```

## Dienst verwalten

```sh
cadence server status
cadence server restart     # nach einem Upgrade oder einer .env / models.json-Änderung
cadence server stop        # bleibt registriert und startet beim nächsten Boot oder Login erneut
cadence server uninstall   # vor npm uninstall -g ausführen
```

Upgrade mit `npm install -g @abelxiaoxing/cadence@latest`, dann `cadence server restart`.
Restart, Stop und Uninstall stoppen laufende Arbeit geordnet, statt sie getrennt zurückzulassen.
Uninstall entfernt nur die Dienstdefinition; Projekte, Historie und Pi-Einstellungen bleiben.
Linux-Root- und benannte Dienste, entfernter HTTPS-Zugang und Wiederherstellung sind in [Dienstverwaltung](docs/service-management.md) und [Fernzugriff](docs/remote-access.md) beschrieben.

## Entwicklung

Pi kann auch ein lokales Checkout oder ein gepacktes Tarball laden: Füge seinen absoluten oder relativen Pfad zu Pís `packages` hinzu, oder versuche `pi -e ./cadence`.
Cadence erzwingt keinen Pi-Versionsbereich; Entwicklungs-Pins und getestete Laufzeiten sind keine universellen Kompatibilitätsversprechen.

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

Engineering-Anleitungen sind unter [engineering/](engineering/) nach Bereich aufgeteilt; der Projektindex in [AGENTS.md](AGENTS.md) sagt, welche Datei welchen Code abdeckt.
`verify` benötigt außerdem einen offiziellen Node-Build, ein privates temporäres Verzeichnis und ein vorhandenes Chromium; siehe [Verifikation](engineering/verification.md).

## Lizenz

Cadence ist MIT.
Eingebundene Anpassungen, Schriftarten und Anbieter behalten ihre eigenen Lizenzen; siehe [Wiederverwendung und Verbreitung](docs/reuse-and-distribution.md) und [Drittanbieter-Hinweise](THIRD_PARTY_NOTICES.md).
