# Lernplan-Routine einrichten

Das Plugin **zeigt** Lerneinheiten an und wertet sie aus. Neue Einheiten **baut** diese Routine:
Claude läuft jeden Tag, plant einmal pro Woche deine Einheiten (FA, Mathe, OB, PoM, KDW), macht aus
Wiederholen-Karten neue Übungen und legt alles als Karten auf dein Board.

## Was du brauchst

- **Claude Desktop** mit eigenem Abo. Die Routine läuft auf deinem Konto und verbraucht deine Nutzung.
- **Obsidian** mit dem Plugin FA-Lerneinheit (über BRAT, siehe README) und dem Plugin **Kanban**.
- Deinen Vault im Aufbau des **Lernpakets FHNW**: Board `To Do's.md`, Ordner `Support/To Do's`,
  `Support/Unterlagen/<Modul>`, Fortschrittsnotizen in `Support/`, Prüfungsfahrpläne und
  Theorienotizen in `Module/<Modul>/`. Anders aufgebaut geht auch, dann passt Claude die Pfade an.
- Deinen Stundenplan als `Support/Stundenplan.pdf`. Neue Moodle-Unterlagen legst du selbst in
  `Support/Unterlagen/<Modul>/`.

Den Computer braucht die Routine eingeschaltet, und Claude Desktop muss laufen.

## Einrichten (5 Minuten)

Öffne in Claude Desktop den Tab **Code**, wähle als Ordner deinen Obsidian-Vault und schick Claude
diese Nachricht:

> Richte mir die Lernplan-Routine aus github.com/Leffdogg/fa-lerneinheit ein (Ordner `routine`).
> Lies zuerst `routine/EINRICHTEN.md` und alle Dateien in `routine/`.
> 1. Kopiere den Ordner `routine` nach `~/.claude/scheduled-tasks/lernplan-rechnungswesen/`.
> 2. Ersetze in allen `.md`-Dateien und in `pruefe.js` dort `<NAME>` durch meinen Vornamen, `<VAULT>` durch den Pfad
>    meines Vaults (mit `/`), `<ROUTINE>` durch den Pfad des neuen Ordners und `<JSYAML>` durch den
>    Pfad von js-yaml (`npm install -g js-yaml`, dann `npm root -g` + `/js-yaml`).
> 3. Prüfe, ob die Dateien und Ordner aus der Routine in meinem Vault so heissen. Wenn nicht, frag
>    mich und pass die Pfade in der Routine an. Prüfe auch die Pfade in den Einstellungen des Plugins.
> 4. Prüfe, ob `node`, `pdftotext` und `py` laufen. Was fehlt, sag mir, bevor du etwas installierst.
> 5. Teste `node pruefe.js einheit <Seite>` an einer bestehenden Lerneinheit und `node pruefe.js status <Fahrplan> <Fortschritt>`.
> 6. Lege die geplante Aufgabe `lernplan-rechnungswesen` an, täglich 06:30 und 12:30, mit der
>    Anweisung, `~/.claude/scheduled-tasks/lernplan-rechnungswesen/SKILL.md` auszuführen.
> 7. Starte sie einmal zum Test und zeig mir den Bericht.

## Gut zu wissen

- Die Routine **liest** deine Ergebnisse (`data.json` der Plugins) nur und hakt nie Karten für dich ab.
- Deine Theorienotizen liest sie nur. Ohne Notiz zu einem Thema schreibt sie die Theorie kurz direkt in die Einheit.
- Termine (Prüfungsdaten, Vorlesungen Finanzmathe, Stichtage) gelten für HS26, Klasse TZT26a. In einer
  anderen Klasse oder einem anderen Semester: Fahrpläne und `mathe.md` anpassen lassen.
- Neue Version der Routine: Claude bitten, die Dateien aus dem Repo neu zu holen. `letzte-plaene.md`
  und `bekannte-unterlagen.txt` dabei **nicht** überschreiben, das ist dein Stand.
