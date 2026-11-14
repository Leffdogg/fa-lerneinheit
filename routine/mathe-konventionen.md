# Mathe-Konventionen für Lerneinheiten und Spick (Angewandte Mathematik 1)

> **Vorläufig.** die Folien des Dozenten zu Zins (16.11.), Äquivalenz (23.11.), Renten (30.11.) und Kredit (07.12.)
> sind noch nicht auf Moodle. Sobald sie da sind, gelten sie. Abweichungen hier nachtragen und betroffene
> offene Einheiten und den Spick (per Vorschlag) anpassen. Quelle bis dahin: Lösungen der Testserie
> (`WM1_Testserien_Loesungen_NEU.pdf`, handschriftlich, aus dem Vorjahr; Dozent unbekannt).
> Fünf Lösungen am 10.11.2026 in Python nachgerechnet (A10a, A21b, A23A/B, A25b, A28A, A29): alle stimmen.

## Zinsen und Faktoren (Lösung A21, S. 15; A24, S. 16)

- Gerechnet wird immer mit dem **Aufzinsfaktor q** pro Jahr, nicht mit Zinsformeln.
  - effektiver Jahreszins i: `q = 1 + i` (3 % → 1.03)
  - nomineller Zins, m Perioden pro Jahr: `q = (1 + i/m)^m` (3 %, vierteljährlich → 1.03034)
  - stetiger Zins: `q = e^i` (→ 1.03045)
- t Jahre aufzinsen: `K · q^t`, abzinsen: `K · q^−t`. Monate als Bruch: 8 Monate = `q^(8/12)`, 18 Monate = `q^(−18/12)`.
- „um 30 % grösser“ = `K · 1.3`, „um 30 % kleiner“ = `K · 0.7`.
- Rendite oder Zinssatz gesucht: **nach q auflösen** (Taschenrechner-Solver), dann `p = q − 1` in Prozent (A23D: q = 1.0319 → 3.19 %).

## Zahlungsströme (A23, A25, A27, A28, A29)

- **Klammerdarstellung:** `Betrag (Zeitpunkte)` in Jahren ab dem Bezugstermin, z. B. `100000 (2, 4, 7)`,
  `2500 (0, 1/12, …, 9 11/12)` = 120 Monatszahlungen, `18000 (1.5, 2, …, 9.5)` = 17 Halbjahreszahlungen.
- Zeitachse zeichnen, wo die Aufgabe es verlangt (A25a, A34A).
- Wert auf einen Termin: jede Zahlung mit `q^(Termin − Zeitpunkt)` verschieben. Geschrieben als `… ⌟t` (Wert per t).
- **Rente = geometrische Reihe.** n Zahlungen R im Abstand Δ (in Jahren):
  - Wert per **erster** Zahlung: `R · (q^(−n·Δ) − 1) / (q^(−Δ) − 1)` (A23B, A25b)
  - Wert per **letzter** Zahlung: `R · (q^(n·Δ) − 1) / (q^Δ − 1)` (Kontrolle A23B, A28A)
  - danach auf den gefragten Termin verschieben, z. B. `· q^−1.5`.
  - vorschüssig/nachschüssig zeigt sich nur in den Zeitpunkten der Klammer (erste Zahlung bei 0 oder bei Δ).
- Ewige Rente (A26C) mit die Folien des Dozenten bestätigen, bis dahin Grenzwert der Reihe: Wert per erster Zahlung `R / (1 − q^−Δ)`.
- Angebote vergleichen: alle Barwerte auf denselben Termin, das grössere ist für den Empfänger besser.
- Zinskurve mit zwei Sätzen (A26): bis zum Wechsel mit q₁, danach mit q₂ abzinsen.

## Äquivalenz, Kredit, Annuität (A28, A29, A30, A31, A32)

- **Äquivalenzgleichung** per einem Termin (oft das Ende): Leistung = Gegenleistung, dann „Solve for x“ bzw. „Solve for q“.
- Schuld S, Raten R: `S (0)` gegen `x (Δ, 2Δ, …, n·Δ)`.
- **Restschuld nach k Jahren:** `RS(k) = GS(k) − RZ(k)`, also aufgezinste Schuld minus Wert der bis k gezahlten Raten per k (A28B, A29B).
  Kontrolle: Barwert der restlichen Raten per k.
- **Tilgungsquote / Amortisationsquote** nach k: `RZ(k) / GS(k)` in Prozent (A28C 51.9 %, A29C 74.1 %).
- Schuldschein mit Zinsen: Nennwert per Ablauf plus Zinsrente `Nennwert · Zinssatz (1, 2, …, n)` (A28).
- Rundung: Geldbeträge auf 2 Stellen. Mit der ungerundeten Rate weiterrechnen; mit der gerundeten Rate entstehen Rappen-Differenzen (A29B: 41377.69 statt 41377.57).

## Wachstum (A7, A10, A12, A15)

- Exponentiell: `K(t) = K₀ · q^t`. Rate aus zwei Werten: `q = (K₂/K₁)^(1/Jahre)`.
- „Wann gleich gross?“: gleichsetzen, mit ln auflösen oder Solver (A10b: Solve for t = 7.4497).
- Linear: `K(t) = K₀ + d · t`.
- **Verrechnungssteuer 35 %:** Nettozins = Zins · 0.65 (2 % → 1.3 %, q = 1.013), A10c.

## Taschenrechner

- Die Testserie-Lösungen rechnen mit Solvern („Solve for q/x/t“, Gleichungssysteme mit „Apps / PlySmlt2“, das ist eine TI-84-App).
  **An der Prüfung ist nur der TI-30X Pro erlaubt** (oder jeder TI-30).
- TI-30X Pro: Gleichung lösen mit `num-solv`, Polynome mit `poly-solv` (2./3. Grades), Systeme mit `sys-solv` (2×2, 3×3).
- **TI-30X Plus hat keinen Solver.** Rendite- und „Wann“-Aufgaben gehen dort nur über ln (wenn möglich) oder Probieren.
  Im Lösungsweg beide Wege zeigen (`tasten:` je Modell), für alle, die keinen Pro haben (Einstellung `rechner` im Plugin).

## Aufgabenarten (genau diese Namen = Fahrplan-Stichworte, `aufgabenart:` in jedem Fall)

Funktionen und Gleichungen: Polynom Nullstellen · Gleichung dritten Grades · Gewinnschwelle und Maximum ·
Lineare Funktion aus Text · Nachfrage und Erlös · Gleichungssystem aus Text · Funktion stückweise ·
Anteil und Mehreinkommen · Folgen und Summen

Wachstum: Wachstumsrate aus zwei Werten · Wann gleich gross · Linear gegen exponentiell · Abschnittsweise Rendite ·
Real gegen nominal

Finanzmathe: Aufzinsfaktor · Barwert eines Cashflows · Angebote vergleichen · Rendite über Äquivalenz ·
Rentenbarwert · Rente umwandeln · Annuität berechnen · Annuität Restschuld · Zeitpunkt einer Ausgleichszahlung

Kein Stichwort darf als ganzes Wort in einem anderen stecken (deshalb „Annuität berechnen“, nicht „Annuität“).

## Stil der Testserie

- Kurzer Sachtext mit allen Zahlen, dann Teilfragen A, B, C …, die aufeinander aufbauen.
- Kontexte: Bank, Kredit, Lotterie, Population, Wald, Versicherung, Lager, Konsum/Einkommen. Für Varianten
  **anderer Kontext und andere Zahlen**, nie die Testserie wörtlich.
- Rundungsvorgabe steht in der Frage („Runden Sie auf zwei Hinterkommastellen“) → `runden:` im Fall.

## Mustervorlage eines Mathe-Falls

```yaml
- art: aufgabe
  titel: "Kredit eines Velogeschäfts"
  soll: 12
  aufgabenart: Annuität Restschuld
  einleitung: "Ein Velogeschäft nimmt einen Kredit über CHF 80'000 auf …"
  faelle:
    - id: a
      text: "Wie hoch ist die halbjährliche Rate? Runden Sie auf zwei Stellen."
      aufgabenart: Annuität berechnen
      zahl: 4883.28          # nachgerechnet: 80000·1.04^10·(1.04^0.5−1)/(1.04^10−1)
      runden: 2
      einheit: CHF
      soll: 5
      hilfe:
        - "Gleiche Raten tilgen eine Schuld: Äquivalenz Schuld = Barwert aller Raten."
        - "Spick: Rente → Wert per letzter Zahlung, dann abzinsen."
      weg:
        - "Situation: Kredit mit gleichen Raten → Äquivalenzgleichung per Ende."
        - "S (0), x (0.5, 1, …, 10), q = 1.04"
        - "80000 · q^10 = x · (q^(20/2) − 1)/(q^(1/2) − 1) → x = 4883.28"
      tasten:
        "TI-30X Pro": "num-solv: 80000×1.04^10 − x×(1.04^10−1)/(1.04^0.5−1) = 0, solve"
        "TI-30X Plus": "(1.04^0.5 − 1) ÷ (1.04^10 − 1) × 80000 × 1.04^10 ="
```
