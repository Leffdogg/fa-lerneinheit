# Wissensfächer der Routine: OB, PoM, KDW (seit 11.11.2026)

Auch Organisational Behaviour, Principles of Management und Kritisches Denken bekommen Lerneinheiten,
nicht nur Quiz: Mit Quiz allein kommt ein Thema höchstens auf 70 % („fast“), „sitzt“ gibt es nur mit
einer Lerneinheit.

## Dateien

| Was | Wo |
|---|---|
| Fahrpläne (nur lesen, per Name suchen) | `Prüfungsfahrplan OB`, `Prüfungsfahrplan PoM`, `Prüfungsfahrplan KDW` in `<VAULT>/Module/<Modul>/` |
| Fortschritt (schreibt nur das Plugin) | `<VAULT>/Support/Fortschritt OB.md`, `Fortschritt PoM.md`, `Fortschritt KDW.md` |
| Theorie | die Theorienotizen `<VAULT>/Module/<Modul>/<Thema>.md` |
| Quiz und Ergebnisse (nur lesen) | `<VAULT>/Module/<Modul>/<Thema> – Quiz.md`, Runden und Fragen in `<VAULT>/.obsidian/plugins/lern-quiz/data.json` (UTF-8 lesen) |
| Unterlagen | `<VAULT>/Support/Unterlagen/Organisational Behaviour/`, `…/Principles of Management/`, `…/Kritisches Denken & Wissenschaftliches Schreiben/` |
| Board-Spalten | `## Organisational Behaviour`, `## Principles of Management`, `## Kritisches Denken` |

## Wie viele und welche

- **Eine Lerneinheit pro Modul und Woche**, also drei. Sie kommen zu den FA-, Mathe- und Quiz-Plänen
  dazu und dauern **20–25 Min**. Sie dürfen auf einen Tag mit anderer Einheit fallen, aber nie zwei
  Wissens-Einheiten am selben Tag.
- **Welches Thema:** aus dem Fahrplan das Thema mit dem **grössten Rückstand** (Soll minus Können)
  unter den Themen, deren Stoff im Unterricht schon behandelt wurde (Stichtag vorbei oder Theorienotiz
  vorhanden). Den Stand rechnet die Routine wie das Plugin: `require('<ROUTINE>/logik.js')('<VAULT>/.obsidian/plugins/fa-lerneinheit')`,
  dann `themaStatus` und `themaMitQuiz` mit `quizListe(data, 'Module/<Modul>')` und dem heutigen Tag.
- **KDW:** nur Themen aus dem Teil „MC-Test“. Die Dispo-Meilensteine sind keine Lerneinheiten.
  Ist ein Meilenstein in 7 Tagen fällig und noch nicht `fertig`, kommt stattdessen eine schlichte
  Karte `- [ ] Dispo: <Meilenstein> @{<Stichtag>}` in die Spalte Kritisches Denken (einmal, keine
  Dublette). Ob er erledigt ist, entscheidet <NAME>. Die Routine setzt nie selbst `fertig:`.
- **Nie** ein Thema, das im Unterricht noch nicht dran war.

## Wiederholen-Karten (jeden Tag, wie bei FA)

Steht im Board `[[Prüfungsfahrplan OB|Wiederholen: <Thema>]]` (ebenso PoM, KDW), baut die Routine
am selben Tag eine **kurze Einheit (10–15 Min)** zum Thema und ersetzt die Karte durch
`- [ ] [[<neue Seite>]] @{<fällig>}`. Name `<Thema> – Einheit II` (gibt es den schon: `III`, …). Fällig am
nächsten freien Tag, sonst heute. Ist das Thema reines Wissen und es gibt dazu ein Quiz mit
wackeligen Fragen, darf die Einheit nur aus Aufwärmen (Quizfragen) und Einschätzen bestehen.

## Aufbau einer Einheit

Format wie in Schritt 7 von `SKILL.md`, aber:

- **Seitenname `<Thema> – Einheit`** in `<VAULT>/Support/To Do's/` (z. B. `Konflikte – Einheit`). die Theorienotizen heissen
  genau wie die Themen; ohne Zusatz zeigen Links und `notiz:` auf die falsche Seite.

- Frontmatter `modul: <Spaltenname>` (z. B. `Organisational Behaviour`), `lerneinheit: true`,
  `art: Lerneinheit`, `quelle: Lernplan Wissensfächer`.
- Im Block: `modul: ob` bzw. `pom` bzw. `kdw`. `thema:` muss ein **Stichwort aus dem Fahrplan**
  enthalten, sonst zählt die Einheit nicht für das Können.
- **Jeder Schritt braucht `soll`** (Minuten). Fälle nur mit `antwort:` (Musterantwort, <NAME>
  bewertet selbst), keine Buchungen. `punkte:` wie an der Prüfung setzen.
- Kein Beilage-Knopf (Kontenplan/Spick gibt es hier nicht).

Schritte:

1. **Theorie (5 Min):** `notiz: "<Theorienotiz>#<Überschrift>"` aus die Theorienotiz, Überschrift vorher
   nachschlagen. Dazu 2–3 Sätze `text`, was heute wichtig ist.
2. **Aufwärmen aus dem Quiz (5 Min):** 3–4 Fragen aus der Quizseite des Themas, bevorzugt die, die in
   `data.json` unter `fragen` noch nicht sicher sind (`ok < 2`) oder nie gespielt wurden. Als
   `antwort`-Fall umformulieren, nicht wörtlich kopieren, mit der Begründung aus der Quizseite.
   Gibt es kein Quiz zum Thema, Aufwärmen aus der Theorienotiz.
3. **Aufgaben im Prüfungsstil (10–12 Min):**
   - **OB** (MooPad, Kprim und A+, keine Hilfsmittel): zwei **Kprim**-Fragen (vier Aussagen,
     <NAME> schreibt zu jeder richtig/falsch; `antwort` nennt alle vier mit je einem Halbsatz Grund,
     `punkte: 3`; volle Punkte nur bei 4/4, 1,5 bei 3/4) und zwei **A+**-Fragen (eine richtige von vier,
     `punkte: 1`). Stoff aus die Theorienotiz und den Begleitfolien.
   - **PoM** (hybrid: Hälfte MooPad zu den Leseaufträgen, Hälfte Fallstudie handschriftlich):
     zwei kurze strukturierte Fragen zum Leseauftrag (Thommen-Kapitel laut Semesterprogramm) und
     **ein Mini-Fall** (3–4 Sätze Ausgangslage, ein Unternehmen wie im TOPSIM), der ein Modell der
     Kontakteinheit anwenden lässt, `punkte: 4–6`. Laut Studierenden aus dem Vorjahr ähneln die Prüfungsfragen den
     Moodle-Quiz (Wissensüberprüfung, wahr/falsch mit Überzeugung), also auch solche Aussagen einbauen.
   - **KDW** (E-Assessment MC, 60 Min): vier **MC-Fragen** zum Thema (eine oder mehrere richtig),
     `antwort` nennt die richtigen und warum die anderen falsch sind.
4. **Einschätzen.**

## Prüfen

Vor dem Speichern mit dem Plugin validieren (Befehl aus Schritt 7 von `SKILL.md`), Ergebnis muss
`ok: true` sein. Danach die Karte datumsrichtig in die Modulspalte.

## Grenzen

- Nur die eigenen Material und die Moodle-Unterlagen im Vault. Keine erfundenen Theorien oder Autoren.
- Die Quizseiten werden nur gelesen, nie geändert.
- `fertig:` im KDW-Fahrplan setzt nur <NAME> (oder Claude auf Zuruf), nie die Routine.

## Bericht

Im Bericht eine Zeile je Modul: Thema der Einheit, Tag, Grund („grösster Rückstand: 0 % statt 35 %“).
Im Protokoll `letzte-plaene.md` ein Abschnitt `| 3 Wissen: …`.
