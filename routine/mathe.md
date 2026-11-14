# Mathe-Teil der Routine (Angewandte Mathematik 1, seit 10.11.2026)

Ziel: vom Sachtext zur passenden Formel finden und Aufgaben, die man noch nie gesehen hat, mit dem eigenen Spick lösen.

Prüfung **Di 12.01.2027, 10:30–11:30**, Papier, 60 Min, 60 Punkte, Hilfsmittel TI-30X Pro (eigenes Modell: Plugin-Einstellung `rechner`)
und 1 A4-Spick beidseitig, handgeschrieben.

## Dateien

| Was | Wo |
|---|---|
| Fahrplan (nur lesen) | `<VAULT>/Module/Angewandte Mathematik 1/Prüfungsfahrplan Mathematik.md` (per Name suchen) |
| Fortschritt (schreibt nur das Plugin) | `<VAULT>/Support/Fortschritt Mathematik.md`, eine Zeile pro Aufgabe |
| Spick (Plugin) | `<VAULT>/Support/Spick Mathematik.md` (```` ```spick ````-Block), PDF `<VAULT>/Support/Spick Mathematik.pdf` |
| Spick-Vorschlag (schreibt die Routine) | `<VAULT>/Support/Spick Mathematik – Vorschlag.md` |
| Konventionen | `mathe-konventionen.md` in diesem Ordner |
| Plugin-Daten (nur lesen) | `<VAULT>/.obsidian/plugins/fa-lerneinheit/data.json` → `einheiten.<id>.hilfe`, `.spick`, `.ergebnisse` |
| Board-Spalte | `## Angewandte Mathematik 1` in `To Do's.md` |

## Quellen, in dieser Reihenfolge

1. die Theorienotizen in `<VAULT>/Module/Angewandte Mathematik 1/` (für den Theorie-Schritt `notiz: "<Notiz>#<Überschrift>"`, Überschrift vorher nachschlagen).
2. die Folien des Dozenten, Übungen und Lösungen in `<VAULT>/Support/Unterlagen/Angewandte Mathematik 1/` (02–07 vorhanden; Finanzmathe kommt erst noch).
3. Eine Testserie aus dem Vorjahr (falls im Unterlagen-Ordner, z. B. `WM1_Testserien_NEU.pdf` mit Lösungen) als **Vorlage für Stil und Aufgabenarten**, nie wörtlich. † = frühere Prüfungsaufgabe, ⇐ = relevant. Am wichtigsten sind 7, 8, 14, 17, 18, 23, 25, 28, 29, 31 und 34.
4. Der eigene Bonustest, sobald er da ist. Er stammt vom selben Dozenten und ist deshalb das beste Vorbild für den Stil.

**Stoffgrenze:** Semesterprogramm HS26 und Modulbeschreibung 26HS_9774571. **Keine** Mengenlehre/Venndiagramme (Testserie A1, A2, A13), bis klar ist, dass sie drankommt. Keine Ableitungen, Integrale oder Matrizen.

**Finanzmathe erst nach der Vorlesung:** Zins 16.11., Äquivalenz 23.11., Renten 30.11., Kredit 07.12. Eine Finanzmathe-Aufgabenart wird frühestens geplant, wenn ihre Vorlesung war und die Folien im Unterlagen-Ordner liegen. Bis dahin gelten die Konventionen aus `mathe-konventionen.md`, danach die Folien des Dozenten (siehe SKILL.md, „Neue Unterlagen“).

## Welche Einheit

- Reihenfolge wie Schritt 4a, nur mit dem Mathe-Fahrplan:
  1. Wiederholen-Karten
  2. grösster Rückstand
  3. offene Aufgabenarten vor ihrem Stichtag
- Ab 21.12. nur noch Wiederholungen und Probeklausuren, dann **vier** Mathe-Einheiten pro Woche (FA geht auf vier
  runter). Grund (10.11.2026): Renten, Kredit und Annuität kommen erst am 30.11., 07.12. und 14.12. dran, bis zur
  Prüfung am 12.01. bleiben nur etwa vier Wochen mit Feiertagen.
- **Mindestens zwei Aufgabenarten pro Einheit**, solange es offene Aufgabenarten vor ihrem Stichtag gibt
  (23 Aufgabenarten, Stichtage 22.11. bis 14.12., drei Einheiten pro Woche reichen sonst nicht für den ersten
  Durchgang). Jede Aufgabenart bekommt ihren eigenen Aufgabenschritt.
- Die Einheit direkt nach einer Finanzmathe-Vorlesung (Zins, Äquivalenz, Renten, Kredit) nimmt die neue
  Aufgabenart dieser Vorlesung, sobald die Folien da sind — noch in derselben Woche, nicht erst in der nächsten.
- Status rechnen, wie in Schritt 4a, mit Mathe-Pfaden:

      node "<ROUTINE>/pruefe.js" status "<VAULT>/Module/Angewandte Mathematik 1/Prüfungsfahrplan Mathematik.md" "<VAULT>/Support/Fortschritt Mathematik.md"

- Eine Einheit darf Aufgabenarten **mischen**, weil gemischtes Üben näher an der Prüfung ist. Jeder Fall trägt seine `aufgabenart`, und zwar genau einen der Namen aus `mathe-konventionen.md`.
- Aufgabenarten, die wackeln, kommen öfter dran.

## Aufbau einer Mathe-Einheit (45–60 Min)

1. **Theorie** (5–8 Min), nur bei neuer Aufgabenart oder nach `nicht verstanden`: `notiz:` auf die Theorienotiz. Dazu `text:` mit 2–4 Sätzen: Woran erkennt man die Situation im Text?
2. **Aufwärmen** (5–8 Min): reine Rechnungen, 2 Fälle.
3. **Aufgaben** (rund 80 %): 2–3 Schritte im Testserie-Stil, also Sachtext in `einleitung`, dazu Teilfragen a, b, c … mit Rundungsvorgabe.

Felder eines Mathe-Falls: siehe Mustervorlage in `mathe-konventionen.md`. Pflicht:
- `aufgabenart`
- `zahl` (Zahl oder Liste) oder `antwort` (Text, <NAME> bewertet selbst)
- `hilfe` mit **zwei** Tipps (1. Was für eine Situation? 2. Welcher Spick-Abschnitt? Den Titel des Spick-Felds nennen.)
- `weg` mit mindestens zwei Schritten; der erste nennt die Situation und das Erkennungszeichen im Text

Optional: `runden`, `prozent: true`, `einheit`, `soll` (Minuten), `tasten` für **beide** Rechner-Modelle (der TI-30X Plus hat keinen Solver, dort den Weg ohne Solver zeigen).

**Immer neue Varianten:** Vor dem Schreiben alle früheren Seiten derselben Aufgabenart in `<VAULT>/Support/To Do's/` lesen. Kontext, Zahlen und Frageform müssen sich unterscheiden, nie dieselbe Aufgabe noch einmal. Wiederholung heisst bei Mathe: neue Aufgabe, gleiche Situation.

**Jede Zahl in Python nachrechnen**, auch die Zwischenschritte im `weg`. Die Rechnung kommt ins Protokoll. Geht etwas nicht auf, wird der Fall korrigiert, nicht geschrieben.

**Prüfen vor dem Speichern** mit `pruefe.js einheit` (Schritt 7 in SKILL.md). Sie verlangt für `modul: mathe` die Pflichtfelder oben. Zusätzlich prüfen: Jede `aufgabenart` ist ein Stichwort im Mathe-Fahrplan, und jede `zahl` besteht ihren eigenen Selbsttest (`pruefeZahl(String(zahl), zahl, fall) === 1`).

**Seite und Karte:**
- Seite: `<VAULT>/Support/To Do's/<Titel>.md` mit Frontmatter `art: Lerneinheit`, `lerneinheit: true`, `modul: Angewandte Mathematik 1`, `quelle: Lernplan Mathematik`.
- Im Block: `modul: mathe`, `id` = Datum + Titel.
- Karte `- [ ] [[<Titel>]] @{<Datum>}` in die Spalte **Angewandte Mathematik 1**.
- Wiederholt sich ein Titel, bekommt er den Zusatz `II`, `III` usw.

## Spick-Vorschlag (sonntags bei der Wochenplanung, bis 28.12.2026)

1. Signale sammeln:
   - `data.json` → `spick`-Vermerke (`fehlt`/`unklar`) je Fall. Die Aufgabenart steht im Fall der Seite.
   - Aufgabenarten, die im Mathe-Fahrplan wackelig sind oder oft „mit Hilfe“ gelöst wurden
   - neue Konventionen aus die Folien des Dozenten
2. Vorschlag schreiben: `<VAULT>/Support/Spick Mathematik – Vorschlag.md` mit Frontmatter `spick: true` und einem ```` ```spick ````-Block mit **allen** Feldern, dazu `gruende: { <id>: "warum" }` für jedes geänderte Feld.
   - **Feste Plätze:** `seite`, `spalte` und `reihe` bestehender Felder nie ändern, das Plugin lehnt das ab. Ein neues Feld kommt auf einen freien Platz.
   - Wackelige Arten ausführlicher (Situation „Im Text: …“ → Formel → Mini-Beispiel), sichere Arten kürzer.
   - Formeln als Unicode (², ·, √, ≈, →, ₀, ⁿ), kein `$…$`. `==…==` markiert grün, `!!…!!` rot.
   - Grenze pro Seite 3400 Zeichen. Vorher prüfen:

         node "<ROUTINE>/pruefe.js" spick "<Pfad>"

3. Übernehmen ist Sache von <NAME>: Der Vorschlag steht den Vorschlag auf der Spick-Seite und klickt „Übernehmen“ oder „Verwerfen“. Gibt es schon einen offenen Vorschlag, wird er ersetzt und nicht ein zweiter angelegt.
4. Im Bericht: Was sich ändern würde und warum.

**Am 2026-12-29** wird der Spick eingefroren. Einmalig kommt diese Karte in die Mathe-Spalte:
`- [ ] Spick von Hand abschreiben (letzte Version, ab jetzt nur noch damit üben) @{2026-12-29}`.
Danach gibt es keine Vorschläge mehr.

## Probeklausuren (nach dem 14.12.2026, spätestens am 21.12.)

- Zwei Seiten, `Probeklausur Mathe 1` und `Probeklausur Mathe 2`, mit `modus: pruefung`, `dauer: 60`, Summe `punkte` = 60, `modul: mathe`. Keine `hilfe`, `weg` aber schon (der Weg wird nach der Abgabe gezeigt).
- Aufbau wie an der Prüfung: etwa die Hälfte Finanzmathe, dazu Wachstum und Funktionen/Polynome. Aufgaben im Testserie-Stil aus †-Aufgaben und Bonustest, mit neuen Zahlen und nachgerechnet. Die beiden Klausuren nehmen verschiedene Vorlagen.
- Keine Karte aufs Board, <NAME> startet sie vom Mathe-Fahrplan aus, sobald sie freigeschaltet sind.
