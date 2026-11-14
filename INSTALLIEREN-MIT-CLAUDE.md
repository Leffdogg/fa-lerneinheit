# FA-Lerneinheit mit Claude installieren

**Für dich:** Öffne Claude Desktop, Tab **Code**, wähle als Ordner deinen Obsidian-Vault und gib
Claude diese Datei, entweder hineinziehen oder den Link einfügen. Dazu schreibst du:
„Mach, was da drin steht.“ Claude fragt dich, wenn es etwas wissen muss.

---

## Anweisung an Claude

Du richtest für diese Person zwei Dinge ein: das Obsidian-Plugin **FA-Lerneinheit** mit
automatischen Updates und die **Lernplan-Routine**, die jeden Tag neue Lerneinheiten baut.
Quelle ist das öffentliche Repo https://github.com/Leffdogg/fa-lerneinheit (Branch `main`, Releases).
Sprich Deutsch, einfach und kurz. Frag nach, bevor du etwas überschreibst, löschst oder installierst.

### 0. Lage klären

1. Finde den Obsidian-Vault (Ordner mit `.obsidian/`). Ist es nicht der aktuelle Ordner, frag nach dem Pfad.
2. Frag nach dem Vornamen der Person (für die Routine).
3. Bitte die Person, **Obsidian zu schliessen**, bevor du in `.obsidian/` schreibst. Sonst überschreibt
   Obsidian deine Änderungen beim Beenden.

### 1. Plugin mit automatischen Updates (über BRAT)

1. Neueste Release-Dateien von `Leffdogg/fa-lerneinheit` holen (`main.js`, `manifest.json`, `styles.css`, `Handschrift.ttf`)
   nach `<Vault>/.obsidian/plugins/fa-lerneinheit/`. Gibt es den Ordner schon, nur diese drei Dateien
   (und die Schrift) ersetzen, `data.json` (Lernstände!) **nie** anfassen.
2. Das Plugin **BRAT** installieren, falls es fehlt: neuestes Release von `TfTHacker/obsidian42-brat`
   (`main.js`, `manifest.json`, `styles.css`) nach `<Vault>/.obsidian/plugins/obsidian42-brat/`.
3. In `<Vault>/.obsidian/plugins/obsidian42-brat/data.json` `Leffdogg/fa-lerneinheit` in die Liste
   `pluginList` eintragen und `updateAtStartup` auf `true` setzen. Gibt es die Datei nicht, mit genau
   diesen zwei Feldern anlegen; vorhandene Einträge bleiben.
4. In `<Vault>/.obsidian/community-plugins.json` (eine JSON-Liste) `obsidian42-brat` und
   `fa-lerneinheit` ergänzen, falls sie fehlen. Für Community-Plugins muss in Obsidian der
   eingeschränkte Modus aus sein; das schaltet die Person selbst unter Einstellungen → Community-Plugins.
5. Für Kanban-Boards braucht der Vault das Plugin **Kanban** (`mgmeyers/obsidian-kanban`). Fehlt es, auf
   dieselbe Art installieren und eintragen.
6. Nach dem nächsten Start von Obsidian: Die Person soll in den Einstellungen von FA-Lerneinheit die
   Pfade prüfen (Board, Spalte, Fortschrittsnotiz, Kontenplan). Hilf dabei, indem du die passenden
   Dateien im Vault suchst und die Werte nennst.


### 2. Lernplan-Routine

1. Den Ordner `routine/` aus dem Repo holen und `routine/EINRICHTEN.md` lesen.
2. **Gibt es schon eine ähnliche Routine?** Schau unter `~/.claude/scheduled-tasks/` und in den geplanten
   Aufgaben (Scheduled Tasks) nach Routinen, die Lerneinheiten, Lernpläne oder Obsidian-Boards für die
   FHNW betreffen.
   - **Ja:** Zeig der Person kurz, was ihre Routine heute macht und was die neue anders macht. Frag, ob
     du die bestehende **anpassen** (ihre eigenen Regeln behalten, das Fehlende aus `routine/` übernehmen)
     oder **ersetzen** sollst. Nie zwei Routinen parallel laufen lassen, die dasselbe Board beschreiben.
   - **Nein:** Neu einrichten genau nach den Schritten 1–7 in `routine/EINRICHTEN.md`.
3. Zum Schluss einen Testlauf machen und den Bericht zeigen.

### 3. Abschluss

Sag der Person in drei, vier Sätzen, was jetzt eingerichtet ist, was sie noch selbst tun muss
(Obsidian starten, eingeschränkten Modus aus, Pfade prüfen) und dass Updates des Plugins ab jetzt
beim Start von Obsidian automatisch kommen.
