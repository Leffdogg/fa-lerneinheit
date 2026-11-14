# FA-Lerneinheit

Obsidian-Plugin für geführte Lerneinheiten in Financial Accounting und Angewandter Mathematik 1 (FHNW): Schritte mit Timer, Erklärvideo, Buchungstabellen, Zahlenprüfung, Prüfungsfahrplan und Spick.

## Am einfachsten: mit Claude installieren

Lade [`INSTALLIEREN-MIT-CLAUDE.md`](INSTALLIEREN-MIT-CLAUDE.md) herunter (oder kopiere den Link), öffne Claude Desktop im Tab **Code** in deinem Obsidian-Vault und gib Claude die Datei mit „Mach, was da drin steht“. Claude installiert das Plugin mit automatischen Updates und richtet die Lernplan-Routine ein.

## Von Hand installieren

1. In Obsidian: **Einstellungen → Community-Plugins → Durchsuchen**, nach **BRAT** suchen, installieren und aktivieren.
2. **Einstellungen → BRAT → Add Beta Plugin**, dann eingeben: `Leffdogg/fa-lerneinheit`
3. Unter **Community-Plugins** „FA-Lerneinheit“ einschalten.
4. In den Einstellungen von FA-Lerneinheit die Pfade (Board, Spalte, Fortschrittsnotiz, Kontenplan) auf deinen Vault anpassen.

BRAT prüft beim Start von Obsidian, ob es eine neue Version gibt, und installiert sie automatisch.

## Neue Lerneinheiten automatisch (Claude-Routine)

Das Plugin zeigt Lerneinheiten nur an. Neue Einheiten baut eine Claude-Routine, die jeden Tag läuft. Anleitung: [`routine/EINRICHTEN.md`](routine/EINRICHTEN.md).

## Handschrift für den Spick (optional)

Der Spick nutzt die Schrift `Handschrift.ttf`. BRAT lädt nur `main.js`, `manifest.json` und `styles.css`; die Schrift aus dem neuesten Release einmal in den Plugin-Ordner `.obsidian/plugins/fa-lerneinheit/` legen (die Claude-Installation macht das selbst). Ohne die Datei nimmt der Spick eine normale Schreibschrift.
