---
name: lernplan-rechnungswesen
description: Plant einmal pro Woche Lerneinheiten Financial Accounting, Angewandte Mathematik 1 (nach mathe.md) und je eine Einheit Organisational Behaviour, Principles of Management und Kritisches Denken (nach wissen.md) an den freien Tagen als Seiten für das Obsidian-Plugin FA-Lerneinheit, gesteuert über gemessene Zeit und Einschätzung, dazu drei Quiz-Wiederholungen, und schreibt alles als Karten ins Obsidian-Board. Baut fällige Wiederholen-Karten täglich zu neuen Einheiten.
---

<!-- Teilbare Fassung der Routine aus github.com/Leffdogg/fa-lerneinheit.
     Beim Einrichten ersetzt Claude die Platzhalter (siehe EINRICHTEN.md):
     <NAME>    Vorname der Person, die lernt
     <VAULT>   absoluter Pfad zum Obsidian-Vault, mit / statt \
     <ROUTINE> absoluter Pfad zu diesem Ordner
     <JSYAML>  absoluter Pfad zum global installierten js-yaml (npm root -g)/js-yaml
     Die Pfade im Vault (Support/…, Module/…) sind der Aufbau aus dem Lernpaket FHNW.
     Liegen die Dateien anders, passt Claude sie hier und in mathe.md / wissen.md an. -->

<NAME> studiert Betriebsökonomie an der FHNW im ersten Semester. Diese Routine plant pro Woche
Lerneinheiten für das Plugin **FA-Lerneinheit** in Obsidian, damit <NAME> bis zur Prüfung auf den
Stand der Vorlesung kommt und dort bleibt:

- **fünf** Lerneinheiten Financial Accounting (ab 21.12. vier), Schritte 2 bis 8,
- **drei** Lerneinheiten Angewandte Mathematik 1 (ab 21.12. vier), Regeln in `mathe.md`, Konventionen in `mathe-konventionen.md`,
- **je eine** Lerneinheit OB, PoM und KDW, 20–25 Min, Regeln in `wissen.md`,
- **drei** kurze Quiz-Wiederholungen zu älterem Stoff aus allen Modulen (Schritt 9).

FA und Mathe sind gleich wichtig.

## Wann diese Routine etwas tut

Sie läuft täglich (empfohlen 06:30 und 12:30), tut aber fast immer nichts. Geplant wird **einmal pro
Woche**, beim ersten Lauf ab Sonntag.

**Ausnahme, jeden Tag:** Steht im Board (offene Spalten, vor `## Erledigt`) eine Karte
`[[Prüfungsfahrplan|Wiederholen: <Thema>]]`, baut die Routine **beim ersten Lauf, der sie sieht,**
die Lerneinheit „gleiches Thema, neue Fälle“ genau nach Schritt 4a, Punkt 1. Das gilt auch, wenn die
Woche schon geplant ist. Name: `<Thema ohne Klammerzusatz> II` (gibt es den schon: `III`, …). Fällig
am nächsten freien Tag, sonst heute. Danach ersetzt sie die Karte durch `- [ ] [[<neue Seite>]] @{<fällig>}`.
Eine Wiederholen-Karte, die heute oder früher fällig ist, wird **immer** sofort gebaut.
Dasselbe gilt für `[[Prüfungsfahrplan Mathematik|Wiederholen: <Aufgabenart>]]` in der Spalte
`Angewandte Mathematik 1` (Einheit nach `mathe.md`) und für `[[Prüfungsfahrplan OB|…]]`,
`[[Prüfungsfahrplan PoM|…]]` und `[[Prüfungsfahrplan KDW|Wiederholen: <Thema>]]` (Einheit nach `wissen.md`).
Gibt es keine solche Karte, keine neuen Unterlagen und ist keine Planwoche fällig: nichts tun.

## Neue Unterlagen (jeder Lauf, vor der Planung)

<NAME> legt neue Moodle-Dateien in `<VAULT>/Support/Unterlagen/Financial Accounting & Reporting/`
und `…/Angewandte Mathematik 1/` ab.

1. Die Dateien beider Ordner (Name + Grösse) mit `bekannte-unterlagen.txt` in diesem Ordner vergleichen.
   Beim allerersten Lauf ist die Liste leer: dann nur die Liste füllen, nichts nacharbeiten.
2. Für jede neue oder geänderte Datei:
   - **Folien/Theorie:** Konventionen prüfen (Mathe: `mathe-konventionen.md`; FA: Kontierungsrichtlinien in Schritt 5).
     Abweichungen dort nachtragen. Betrifft es schon geschriebene, **noch offene** Einheiten, diese korrigieren
     (Zahlen neu rechnen). Für den Mathe-Spick einen Vorschlag schreiben (`mathe.md`, Spick).
   - **Übungen/Tests mit Lösung:** als Vorlage für neue Fälle aufnehmen (FA: nicht, wenn nach Schritt 4b reserviert).
   - **Neue Prüfungsinfo:** Fahrplan (FA bzw. Mathe) und Probeprüfungen prüfen.
3. Die Liste aktualisieren und im Bericht nennen, was neu war und was sich geändert hat.

## Planwoche

1. **Planwoche bestimmen:** die Kalenderwoche (Mo–So) von *morgen*. Sonntags ist das die kommende
   Woche, an allen anderen Tagen die laufende — so wird ein verpasster Sonntag am Montag nachgeholt.
2. `letzte-plaene.md` in diesem Ordner lesen. Steht dort schon ein Plan für diese Woche
   (`| Woche NN |`), ist nichts zu tun: eine Zeile ins Protokoll, ein Satz in den Bericht, fertig.

Geplant werden nur Tage ab morgen bis zum Sonntag der Planwoche (holt ein Lauf vor 12:00 eine
verpasste Woche nach, zählt heute mit). Zweimal dieselbe Woche planen darf sie nie.

## Schritt 1 — Freie Tage bestimmen

**Jede Woche neu aus dem Stundenplan ablesen, nichts annehmen.**

```
pdftotext -layout "<VAULT>/Support/Stundenplan.pdf" -
```

Die Spaltenausrichtung verrutscht beim Extrahieren — verlässlich sind **Datum und
Modulbezeichnung**. Markiere jeden Tag der Planwoche, an dem irgendein Modul Unterricht hat, als
**Vorlesungstag**. Alle übrigen Tage sind frei. An Vorlesungstagen wird **nichts** geplant.
Fehlt der Stundenplan, im Bericht darum bitten und nur Samstag und Sonntag nutzen.

Danach die freien Tage gegen das Board prüfen: `<VAULT>/To Do's.md`. Ein Tag fällt **nur bei echten
Brocken** weg: Prüfung, Kontrollpunkt, Lernpunkte-Test oder eine grosse Abgabe an diesem Tag.
Eine gewöhnliche Karte mit Fälligkeitsdatum blockiert den Tag nicht.

**Acht Einheiten (5 FA + 3 Mathe; ab 21.12. 4 FA + 4 Mathe).** Eine Einheit dauert im Prüfungstempo
rund 30 Minuten, deshalb passen **zwei Einheiten an einen freien Tag**. Höchstens zwei pro Tag.
Möglichst gleichmässig verteilen: erst jeder freie Tag eine, dann Doppeltage, FA zuerst.
**Gibt es zu wenige freie Tage** (weniger als vier), fällt zuerst eine Mathe-Einheit weg, dann eine
FA-Einheit, aber nie unter 3 FA und 2 Mathe, solange zwei freie Tage da sind — niemals auf einen
Vorlesungstag ausweichen. Bleibt kein Tag übrig, sag das im Bericht und lege nichts an.

## Schritt 2 — Stand lesen

Das Plugin misst die Zeit pro Schritt, nimmt die Einschätzung entgegen und schreibt beides nach
`<VAULT>/.obsidian/plugins/fa-lerneinheit/data.json` — **nur lesen, nie schreiben**:

    "einheiten": {
      "2026-10-27-kunden-lieferanten": {
        "datei": "Support/To Do's/Kunden und Lieferanten.md",
        "sekunden": [540, 380, 1720, 2350, 60],     // je Schritt der Seite, der letzte ist „Einschätzen“
        "einschaetzung": "mittel",                  // leicht | mittel | schwer | nicht verstanden | null
        "abgeschlossen": "2026-10-27"
      }
    }

**Soll-Zeiten (Prüfungstempo):** Bei FA rechnet das Plugin `soll` für Aufwärmen und Aufgaben selbst:
1 min pro Buchungssatz (Lösungszeile), Rechen-/Textfragen 1 min pro `punkte`, ohne Punkte 2 min.
Ein `soll` im YAML wird dort überschrieben; nur Theorie, Mathe und Probeprüfungen brauchen es.
Gib Rechen-/Textfragen deshalb `punkte` wie an der Prüfung.

Das Plugin hakt die Karte beim Einschätzen selbst ab, verschiebt sie nach `Erledigt` und schreibt
eine Zeile in `<VAULT>/Support/Fortschritt Rechnungswesen.md`.

**Wackelig** ist eine Einheit, wenn die Zeit aller Aufwärm- und Aufgabenschritte zusammen mehr als
das **1,5-Fache** ihrer Soll-Zeit beträgt (Theorie zählt nicht), oder bei `schwer` /
`nicht verstanden`. Zu lange brauchen heisst: Das Thema sitzt noch nicht. Die Zeit wird **nie**
dazu benutzt, Einheiten zu kürzen.

| Stand des Themas | Was diese Woche geplant wird |
|---|---|
| `leicht` oder `mittel`, nicht wackelig | **nächstes Thema** (Schritt 4) |
| wackelig bei `leicht`/`mittel`, oder `schwer` | **gleiches Thema, neue Fälle** (andere Zahlen, anderes Unternehmen, eine Falle mehr) |
| `nicht verstanden` | gleiches Thema, die Einheit **beginnt wieder mit Theorie**, kleinere Fälle. Im Bericht vorschlagen, das Thema mit Claude durchzugehen |
| Karte selbst abgehakt (in `Erledigt`), aber keine Einschätzung in `data.json` | wie `mittel` behandeln, **ohne** Zeitbewertung; im Bericht bitten, beim nächsten Mal in der Einheit einzuschätzen |
| Karte offen, keine Einschätzung | **keine neue Karte.** Bestehende auf den nächsten freien Tag verschieben (Karte und `faellig`) |

Die Zeile *Karte offen* gilt **je Einheit, nicht für die ganze Woche**. Was die Zeit über die
Schritte verrät, gehört in den Bericht: Lange Theorie spricht für ein Verständnisproblem, lange
Aufgaben für ein Anwendungsproblem.

## Schritt 3 — Material sichten

Die Aufgaben schreibst du **selbst** (Schritt 5), im Stil des Unterrichts. Das Material dient als
Vorlage für Stil, Zahlen und Fallen, und für die Theorie:

- `<VAULT>/Support/Unterlagen/Financial Accounting & Reporting/` — vor allem
  `Information zur Modulschlussprüfung.pdf` (Kontierungsrichtlinien, Kontenplan, Kennzahlen),
  Repetitionen mit Lösungen, Einführungsaufgaben, Lehrmittelkapitel und `Semesterprogramm.pdf`.
- Ein Unterrichtsfall darf **als Vorlage** dienen (gleiche Falle, andere Zahlen), aber nicht
  unverändert übernommen werden.
- BM-/WMS-Prüfungen (z. B. `…-FRWW-…`) sind **keine** FHNW-Prüfungen. Nicht als Vorlage für den Prüfungsstil.
- **Teil B (Bilanz- und Erfolgsanalyse):** Liegt ein Lehrmittel dazu im Unterlagen-Ordner, darf es
  als Vorlage dienen: Aufgaben nachbauen (eigene Zahlen, eigenes Unternehmen), nie ganze Seiten
  abschreiben, ohne Lösungsband alles selbst nachrechnen. Wo das Buch anders rechnet als die
  Prüfungsinfo, gilt die Prüfungsinfo (z. B. Durchschnittskapital, 360 Tage).

## Schritt 4 — Reihenfolge des Stoffs

Jede Einheit teilt sich:

- **Aufwärmen = Grundlagen**, 5–10 Min: das Grundlagenthema mit der schwächsten letzten
  Einschätzung aus Bilanz, Erfolgsrechnung, Konten/Soll-Haben, Buchungssatz, Journal/Hauptbuch/
  Abschluss. Ein bis zwei kurze Fälle.
- **Theorie und Aufgaben = Unterrichtsstoff**, in dieser Reihenfolge (Semesterprogramm HS26):

```
1  Kunden und Lieferanten (Rabatt, Skonto, Forderungsverluste, Delkredere)
2  Warenverkehr (Handelswaren laufend geführt)
3  Personalaufwand (Lohn, Sozialversicherungen)
4  Wertschriften (Kauf/Verkauf, Marchzins, Verrechnungssteuer)
5  Mehrwertsteuer (vereinbartes Entgelt, Nettomethode)
6  Fremde Währungen (Buchkurs, Tageskurs, Kursdifferenzen)
7  Zeitliche Abgrenzungen und Rückstellungen
8  Abschreibungen (indirekt), Verkauf von Anlagevermögen
9  Rechtsformen und AG: Gründung, Gewinnverwendung, Reserven
10 Geldflussrechnung (operativer Cashflow indirekt, direkte Methode, Fondsveränderung)
11 sobald im Unterricht behandelt: Bewertung nach OR, stille Reserven,
   Bilanz- und Erfolgsanalyse mit den Kennzahlen der Prüfungsinfo
```

Ein Thema gilt als erledigt nach einer Einheit mit `leicht` oder `mittel`, die nicht wackelig war.
Teil B (Punkt 11) nie vor dem Unterricht planen — Stand im Semesterprogramm prüfen.

## Schritt 4a — Prüfungsfahrplan (hat Vorrang vor Schritt 4)

Der Fahrplan steht in der Seite `Prüfungsfahrplan.md` (per Name im Vault suchen;
```` ```pruefungsfahrplan ````-Block, nur lesen): `pruefung` (Datum), je Thema `teil`, `thema`,
`stichtag`, `stichworte`. Ziel: Teil A sitzt bis Ende November, der ganze Stoff bis 20.12.,
danach nur Repetition und Probeprüfungen.

Status je Thema rechnet das Plugin selbst — dieselbe Logik:

    node "<ROUTINE>/pruefe.js" status "<Pfad zu Prüfungsfahrplan.md>" "<VAULT>/Support/Fortschritt Rechnungswesen.md"

Können in Prozent aus den letzten drei Einschätzungen (leicht 100, mittel 60, schwer 25, nicht
verstanden 0; zu lange = schwer; neueste zählt am meisten). Höchstens 50 % nach einer Einschätzung,
75 % nach zwei. Ausgabe: `Können/Soll | Druck | Status | Stichtag | Wieder | Thema`.

**Zwei Soll-Werte (seit 0.6.0).** `soll` ist der eigene Zeitplan (aus `stichtag`). `stoff` ist, was man nach dem Unterricht können sollte (aus `unterricht:` je Thema: eine Woche nach dem Unterricht 80 %, bis 90 % vor der Prüfung); das zeigt die Lernzentrale als „solltest du heute können“. `themaStatus` liefert beides plus `behandelt`. Für die Reihenfolge der FA- und Mathe-Einheiten gilt weiter `soll`, im Bericht beide Zahlen nennen. Nie ein Thema, dessen `unterricht:` in der Zukunft liegt.
Druck: `ruhe` / `gut` / `knapp` / `hinten` / `alarm`. Status: `sitzt` (ab 80 %) / `fast` (ab 50 %) /
`wackelig` / `offen` / `ueberfaellig` (Stichtag vorbei, nie geübt).

**Verteilung der fünf FA-Plätze:** Solange es Themen gibt, deren Stichtag vorbei oder in den nächsten
7 Tagen ist und die noch **nie** geübt wurden, gehen **mindestens drei** der fünf Plätze an solche
Themen. Wiederholungen bekommen dann höchstens zwei Plätze. Schon in dieser Woche gebaute Einheiten
aus Wiederholen-Karten zählen auf diese Plätze. Eine fällige Wiederholen-Karte wird trotzdem nie
liegen gelassen. **Zwei Themen in einer Einheit** sind erlaubt, wenn sie zusammengehören und beide
nie geübt sind (z. B. Mehrwertsteuer + Fremde Währungen). Dann enthält `thema` Stichworte **beider**
Fahrplan-Themen, und jeder Aufgabenschritt bleibt bei einem Thema.

1. **Wiederholen-Karten.** Das Plugin legt fällige Wiederholungen selbst als Karte in die Spalte
   Financial Accounting. Jede offene solche Karte wird zu einer **Lerneinheit „gleiches Thema, neue
   Fälle“** (bei wackelig mit Theorie, bei fast ohne). Danach die Wiederholen-Karte entfernen und die
   Karte der neuen Einheit an ihre Stelle setzen.
2. **Grösster Rückstand zuerst** (Soll minus Können, `alarm` vor `hinten` vor `knapp`).
3. **Offene** Themen nach Stichtag, sodass jedes Thema **vor** seinem Stichtag dran ist. Reichen die
   freien Tage nicht, im Bericht sagen, welche Themen den Stichtag reissen werden.
4. Ab dem 21.12.: keine neuen Themen mehr, nur Wiederholungen (wackelig vor fast vor sitzt), vier pro Woche.

**Damit der Fahrplan die Einheit zuordnen kann:** `thema` der Lerneinheit muss mindestens ein
Stichwort des Fahrplan-Themas als ganzes Wort enthalten (z. B. `Mehrwertsteuer`, nicht `MWST-Basics`).

Im Bericht immer: Tage bis zur Prüfung, Können gegen Soll im Schnitt mit Druckstufe, welche Themen hinter dem Soll liegen.

## Schritt 4b — Probeprüfungen

Auf dem Fahrplan stehen gesperrte Probeprüfungen (`probepruefungen` im Fahrplan-YAML, z. B.
**`Probeprüfung 1`** und **`Probeprüfung 2`**). Das Plugin schaltet sie frei, sobald im Schnitt 70 %
erreicht sind und kein Thema unter 50 % liegt.

**Wann bauen:** sobald die *Information zur Modulschlussprüfung* des laufenden Semesters im
Unterlagen-Ordner liegt, spätestens am 20.12. Gibt es die Seiten schon, nichts tun.

**So echt wie möglich:** 90 Minuten, 90 Punkte, Aufbau wie in der Prüfungsinfo. Aufgaben **aus
offiziellem Material mit offizieller Lösung** (alte Tests, Repetitionen, Lernkontrollen), wörtlich
oder mit neuen Zahlen, wenn die Lösung sicher nachgerechnet ist. Die dafür gewählten Quellen danach
**nie** für normale Lerneinheiten verwenden; Probeprüfung 1 und 2 nehmen verschiedene Quellen.
Für Teil B ohne offizielles Material: Gesamtaufgaben aus dem Lehrmittel, Lösung vollständig selbst
nachgerechnet, im Bericht als nicht offiziell kennzeichnen.

**Format** (Datei in `<VAULT>/Support/To Do's/`, Frontmatter `art: Lerneinheit`, `lerneinheit: true`):

    ```lerneinheit
    id: probepruefung-1
    thema: Probeprüfung 1
    modus: pruefung
    dauer: 90
    stoff: "Quellen: …"
    schritte:
      - art: aufgabe
        titel: "A1 Geschäftsfälle buchen"
        soll: 30
        einleitung: "…"
        faelle:
          - id: a
            text: "…"
            punkte: 1.5
            loesung: [[Soll, Haben, Betrag]]
          - id: b
            text: "…"
            punkte: 3
            antwort: "Musterlösung mit Lösungsweg"
    ```

Validieren wie die Lerneinheiten, dazu: Summe `punkte` = 90, Summe `soll` = 90. **Keine Karte aufs
Board** — die Probeprüfung startet vom Fahrplan aus. Im Bericht: welche Quellen verwendet wurden.

## Schritt 5 — Aufgaben schreiben

Die Fälle stehen direkt auf der Seite der Lerneinheit (Schritt 7). **Stil wie im Unterricht und an der Prüfung:**

- **Kurze Einzelfälle** a), b), c) …, die aufeinander aufbauen dürfen. Ein bis drei Sätze pro Fall,
  nüchtern, mit allen nötigen Zahlen. Keine langen Fallstudien.
- Es ist **immer eine AG**.
- **Kontonamen nur aus dem Prüfungs-Kontenplan**, ohne Nummern. Das Plugin weist eine Seite mit
  unbekanntem Konto zurück; erlaubt sind der volle Name (`Forderungen L&L (Debitoren)`), der Teil vor
  der Klammer oder der in der Klammer. Im Zweifel `KONTENPLAN` in `main.js` des Plugins.
- **Kontierungsrichtlinien der Prüfung gelten in jedem Fall:**
  - kaufmännisch auf 5 Rappen runden; Zinsen 30/360, Darlehen und Hypotheken nachschüssig
  - MWST nach vereinbartem Entgelt, Nettomethode, Vor- und Umsatzsteuer immer buchen (Satz im Fall nennen)
  - Fremdwährung: Rechnung, Rabatt, Skonto zum Buchkurs, Zahlungen zum Tageskurs, Kursdifferenz
    bei jeder Zahlung sofort über `Übriger Finanzaufwand` bzw. `Übriger Finanzertrag`
  - Vorrat Handelswaren laufend geführt; Rohstoffe und Halb-/Fertigfabrikate ruhend
  - Transitorische Posten zu Beginn der Periode auflösen, Ende neu bilden
  - Wertschriften zum Kaufkurs, realisierte Kursdifferenzen sofort, Marchzins beim Abschluss transitorisch
  - Verrechnungssteuer auf Dividenden und Zinsen immer berücksichtigen
  - Sachanlagen indirekt abschreiben; Liegenschaften über Liegenschaftsaufwand/-ertrag
  - Gilt im laufenden Semester eine neuere Prüfungsinfo, gelten deren Richtlinien.
- **Mindestens eine Falle pro Aufgabe**: ein Fall ohne nötige Buchung (`loesung: []`), eine
  vergessene Verrechnungssteuer, eine Kursdifferenz.
- **Realistische Zahlen**: Hunderter bis rund eine Million, Prozente 2–40 %.
- **`warum` zu jedem Fall:** zwei bis vier Sätze, warum genau diese Buchung und welche falsch oder unnötig wäre.
- **Jede Zahl vorher nachrechnen** (PowerShell oder Python). Geht etwas nicht auf, wird der Fall korrigiert.
- Bei *gleiches Thema, neue Fälle*: anderes Unternehmen, andere Zahlen, eine Falle mehr.

## Schritt 6 — Aufbau einer Lerneinheit

Je **rund 30 Minuten im Prüfungstempo** (etwa 20 Buchungssätze plus zwei, drei Rechenfragen).

1. **Theorie** (`art: theorie`, 5–10 Min) — nur bei neuem Thema oder nach `nicht verstanden`.
   `notiz:` zeigt auf den passenden Abschnitt einer Theorienotiz im Vault (Tabelle unten); das Plugin
   bettet ihn ein. `text:` ergänzt höchstens drei, vier Sätze, z. B. die passende Kontierungsrichtlinie.
   Das Plugin zeigt im Theorie-Schritt automatisch das passende Erklärvideo.
2. **Aufwärmen** (`art: aufwaermen`, 5–10 Min) — Grundlagen, ein bis zwei Fälle.
3. **Aufgaben** (`art: aufgabe`, rund 80 % der Zeit) — zwei bis drei Schritte mit je drei bis fünf Fällen.

`Einschätzen` hängt das Plugin selbst an.

### Theorie aus den Notizen

Die Theorienotizen zu FA liegen in `<VAULT>/Module/Financial Accounting/` (aus dem Lernpaket oder
selbst geschrieben). Jede Notiz ist in Abschnitte `## n · Titel` gegliedert. Im `notiz:`-Feld steht
`Notiz#Überschrift`, genau wie die Überschrift lautet: `notiz: "Buchführung#3 · Buchungssatz"`.

| Thema im Stoffplan | Abschnitt |
|---|---|
| Bilanz, Bilanz aufstellen | `Jahresrechnung#2 · Bilanz` |
| Erfolgsrechnung | `Jahresrechnung#3 · Erfolgsrechnung`, mehrstufig `Jahresrechnung#4 · Mehrstufige Erfolgsrechnung` |
| Geldflussrechnung | `Jahresrechnung#7 · Geldflussrechnung` |
| Konten, Soll und Haben | `Buchführung#2 · Konten und Buchungsregeln` |
| Buchungssatz | `Buchführung#3 · Buchungssatz` |
| Journal, Hauptbuch, Abschluss | `Buchführung#4 · Journal und Hauptbuch` |
| Kunden und Lieferanten, Waren, Personal, MWST, Fremdwährungen, Wertschriften | `Geschäftsverkehr`, Abschnitte 1–6 |
| Abgrenzungen, Rückstellungen, Abschreibungen | `Jahresabschluss`, Abschnitte 1–4 |
| Einzelunternehmen, Kollektivgesellschaft, AG, GmbH | `Rechtsformen`, Abschnitte 1–5 |
| Bewertung, stille Reserven, Kennzahlen | `Bilanz- und Erfolgsanalyse`, Abschnitte 1–6 |

- **Vor dem Schreiben die Überschrift in der Notiz nachschlagen** und exakt übernehmen. Findet das
  Plugin die Überschrift nicht, zeigt es „Abschnitt nicht gefunden“ — das darf nie passieren. Fehlt
  die Notiz oder das Thema, lass `notiz` weg, schreib die Theorie knapp in `text` und nenne es im Bericht.
- Die Theorienotizen **gehören <NAME>. Du liest sie nur** und schreibst nie hinein.

## Schritt 7 — So sieht das To-Do aus

Erst die Seite `<VAULT>/Support/To Do's/<Titel>.md`, dann die Karte in der Spalte
**Financial Accounting** des Boards, datumsrichtig einsortiert: `- [ ] [[<Titel>]] @{2026-10-27}`.

Titel: das Thema, kurz — etwa `Kunden und Lieferanten`. Kommt dasselbe Thema wieder, mit Zusatz:
`Kunden und Lieferanten II`. Nie eine bestehende Seite überschreiben.

Aufbau der Seite — nur Frontmatter und **ein** ```` ```lerneinheit ````-Block:

    ---
    modul: Financial Accounting
    art: Lerneinheit
    lerneinheit: true
    faellig: 2026-10-27
    dauer: 30 Min
    quelle: Lernplan Rechnungswesen
    ---

    ```lerneinheit
    id: 2026-10-27-kunden-lieferanten
    thema: Kunden und Lieferanten
    stoff: "Rabatt, Skonto, Delkredere — Warum jetzt: erstes Unterrichtsthema nach den Grundlagen"
    schritte:
      - art: theorie
        titel: Rabatt, Skonto, Delkredere
        soll: 8
        notiz: "Geschäftsverkehr#1 · Kunden und Lieferanten"
        text: |
          Rabatt und Skonto werden zum Buchkurs gebucht …
      - art: aufwaermen
        titel: "Aufwärmen: Journal"
        soll: 7
        faelle:
          - id: a
            text: "Barverkauf von Handelswaren für CHF 560."
            loesung: [["Kasse", "Handelserlöse", 560]]
            warum: "…"
      - art: aufgabe
        titel: Exportgeschäft mit Rabatt und Skonto
        soll: 20
        einleitung: "Die Muster AG handelt mit Velozubehör."
        faelle:
          - id: a
            text: "Rechnung an einen Kunden für CHF 25'000."
            loesung: [["Forderungen L&L", "Handelserlöse", 25000]]
            warum: "…"
          - id: b
            text: "…"
            loesung: []
            warum: "Unnötig wäre …"
    ```

Regeln:

- `lerneinheit: true` ist Pflicht (Notebook Navigator kann solche Seiten ausblenden; die Seite wird über die Karte geöffnet).
- `id`: Datum der Fälligkeit plus Thema in Kleinbuchstaben mit Bindestrichen, eindeutig.
- `loesung` je Zeile `[Soll, Haben, Betrag]`, Betrag als Zahl ohne Apostroph, `[]` bei keiner Buchung.
  `zeilen` nur setzen, wenn mehr als drei leere Zeilen nötig sind.
- Texte mit Doppelpunkt oder Anführungszeichen in YAML **quoten**.
- **Prüfen vor dem Speichern** mit dem Plugin selbst:

  ```
  node "<ROUTINE>/pruefe.js" einheit "<Pfad zur Seite>"
  ```

  Ergibt das nicht `ok: true`, wird die Seite korrigiert.
- Keine Motivationssprüche. Nüchtern und konkret.

## Schritt 8 — Fortschrittsnotiz

`<VAULT>/Support/Fortschritt Rechnungswesen.md` führt **das Plugin**. Du schreibst keine Zeile und
änderst nichts in der Notiz.

## Schritt 9 — Drei Quiz-Wiederholungen pro Woche

Quizseiten liegen als `<Theorienotiz> – Quiz.md` in den Modulordnern unter `<VAULT>/Module/`. Das
Plugin `lern-quiz` (falls installiert) schreibt jede Runde nach
`<VAULT>/.obsidian/plugins/lern-quiz/data.json` (als UTF-8 lesen, nur lesen):

    "Module/Organisational Behaviour/Lernen – Quiz.md": {
      "runden": [ { "d": "2026-10-10", "p": 0.83, "n": 10, "m": "schnell" } ],
      "fragen": { "6kskeo": { "n": 1, "s": 0, "ok": 0, "r": 0 } }
    }

Eine Frage gilt ab `ok >= 2` als sicher. Ist `lern-quiz` nicht installiert oder gibt es keine
Quizseiten, entfällt dieser Schritt (im Bericht einmal erwähnen).

**Auswahl:** je Quizseite letzte Runde und Anteil sicher. Dann:

1. **Wackelig** — gespielt, Anteil sicher unter 60 %, letzte Runde mindestens 7 Tage her. Modus **Nur Fehler**.
2. **Nie gespielt**, Thema im Unterricht behandelt. Modus **Schnellrunde**. Mindestens einer der drei Plätze geht hierhin, solange es eines gibt.
3. **Auffrischung** — Anteil sicher ab 60 %, letzte Runde mindestens 21 Tage her. Modus **Schnellrunde**.

Harte Regeln: drei verschiedene Module je Woche, nie dasselbe Quiz zwei Wochen hintereinander, nur
behandelter Stoff, nie zwei Wiederholungen am selben Tag, nie an einem Vorlesungstag.

**Seite:** `<VAULT>/Support/To Do's/Wiederholung <Thema>.md`, dauerhaft (bei späterer Wiederholung
überschreiben, Abschnitt `## Notizen` bleibt). Karte in die **Modulspalte des Quiz**:
`- [ ] [[Wiederholung <Thema>]] @{<Datum>}`. Liegt in `Erledigt` noch die alte Karte derselben Seite, entferne sie.

    ---
    modul: Organisational Behaviour
    art: Wiederholung
    faellig: 2026-10-15
    dauer: 10–15 Min
    status: offen
    quelle: Lernplan
    ---

    # Wiederholung: Lernen

    Warum jetzt: Zuletzt am 10.10. gespielt, 1 von 19 Fragen steht auf sicher.

    ## Details

    **Quiz (10–15 Min)** — [[Lernen – Quiz]], Modus **Nur Fehler**

    ## Notizen

**Abhaken ist Sache von <NAME>.** Die Routine hakt nie eine Karte ab. Ist ein Quiz gespielt und die
Karte noch offen, im Bericht melden. Ist sie offen ohne Runde, auf den nächsten freien Tag verschieben.

## Grenzen

1. **Nur Material aus dem Vault.** Fälle im Stil der Unterlagen und nach den Kontierungsrichtlinien,
   Theorie aus den Notizen und dem Unterrichtsmaterial, nichts Externes erfinden.
2. **Nie an einem Vorlesungstag** fällig.
3. **Keine Dubletten.** Vor dem Schreiben Board und `Support/To Do's` prüfen.
4. **Karten und Notizen von <NAME> bleiben unangetastet**, ebenso die Spalte `Erledigt`. Ausnahme:
   offene `Wiederholen:`-Karten des Plugins werden nach Schritt 4a ersetzt.
5. **Die `data.json` von `lern-quiz` und `fa-lerneinheit` wird nur gelesen.**
6. Seiten ohne ```` ```lerneinheit ````-Block werden nicht umgebaut.

## Protokoll und Bericht

Ergänze in `letzte-plaene.md` immer eine Zeile, auch wenn nichts geplant wurde:

    2026-11-15 | Woche 47 | 5 FA: … | 3 Mathe: … | 3 Wissen: … | Doppeltag: Do 19. | 3 Quiz: …
    2026-11-16 | Woche 47 | kein Plan - schon geplant

Im Bericht: Tage bis zu den Prüfungen, Können gegen Soll (FA und Mathe), welche Einheiten an welchen
Tagen und warum, welche drei Quiz in welchem Modus, neue Unterlagen, und was fehlte. Gab es nichts zu
tun, sag genau das in einem Satz.

Sprache: Deutsch, <NAME> wird geduzt.
