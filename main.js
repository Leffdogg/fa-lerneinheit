'use strict';
/* FA-Lerneinheit — macht aus einem ```lerneinheit-Block (YAML) eine geführte Lerneinheit:
   links die Schritte mit Timer, rechts nur der aktuelle Schritt.

   Format:
     id, thema, stoff
     schritte: [{ art: theorie|aufwaermen|aufgabe, titel, soll (Min),
                  notiz?, text?, einleitung?,
                  faelle?: [{ id, text, zeilen?, loesung: [[soll, haben, betrag]], warum? }] }]
   „Einschätzen“ hängt das Plugin selbst als letzten Schritt an. */

const obsidian = require('obsidian');

// ── Kontenplan der Modulschlussprüfung (Information zur Modulschlussprüfung, HS25), wörtlich ──
const KONTENPLAN = {
  bilanz: [
    'Kasse', 'Bank', 'Wertschriften', 'Wertberichtigung Wertschriften',
    'Forderungen L&L (Debitoren)', 'Forderungen L&L USD (Debitoren USD)',
    'Wertberichtigung Forderungen (Delkredere)', 'Forderungen Vorsteuer',
    'Forderungen Verrechnungssteuer', 'Forderungen Sozialversicherung', 'Mietzinsguthaben',
    'Übrige Forderungen', 'Vorrat Handelswaren', 'Vorrat Rohstoffe', 'Bestand Halb-/Fertigfabrikate',
    'Aktive Rechnungsabgrenzungen (Transitorische Aktiven)', 'Aktivdarlehen', 'Maschinen',
    'Anzahlungen für Maschinen', 'Wertberichtigung Maschinen', 'Mobiliar', 'Wertberichtigung Mobiliar',
    'Fahrzeuge', 'Wertberichtigung Fahrzeuge', 'Immobilien (Gebäude und Land)',
    'Wertberichtigung Immobilien (Gebäude und Land)', 'Patente',
    'Verbindlichkeiten L&L (Kreditoren)', 'Verbindlichkeiten L&L USD (Kreditoren USD)',
    'Geschuldete MWST (Umsatzsteuer)', 'Geschuldete Verrechnungssteuer', 'Übrige Verbindlichkeiten',
    'Verbindlichkeit Sozialversicherungen (Kreditor SV)',
    'Passive Rechnungsabgrenzungen (Transitorische Passiven)', 'Rückstellung für Prozesskosten',
    'Darlehensschuld', 'Hypothekarzinsschuld', 'Leasingverpflichtung', 'Hypothekarschulden',
    'Aktienkapital', 'Gesetzliche Kapitalreserve', 'Gesetzliche Gewinnreserve',
    'Freiwillige Gewinnreserve', 'Gewinnvortrag', 'Jahresgewinn (Bilanz)',
  ],
  erfolg: [
    'Produktionserlöse', 'Handelserlöse', 'Dienstleistungserlöse',
    'Eigenleistungen (Ertrag Eigenherstellung)', 'Forderungsverluste (Debitorenverluste)',
    'Bestandesänderungen Halb-/Fertigfabrikate', 'Materialaufwand', 'Handelswarenaufwand',
    'Lohnaufwand', 'Sozialversicherungsaufwand', 'Übriger Personalaufwand', 'Raumaufwand',
    'Unterhalt & Reparatur von Maschinen', 'Leasingaufwand', 'Fahrzeug- und Transportaufwand',
    'Sachversicherungsaufwand', 'Energie- und Entsorgungsaufwand', 'Verwaltungs- und Informatikaufwand',
    'Werbeaufwand', 'Sonstiger betrieblicher Aufwand', 'Abschreibungen', 'Zinsaufwand',
    'Wertschriftenaufwand', 'Übriger Finanzaufwand', 'Zinsertrag', 'Wertschriftenertrag',
    'Übriger Finanzertrag', 'Liegenschaftsertrag', 'Liegenschaftsaufwand',
    'Verluste aus Verkauf von Anlagevermögen', 'Gewinne aus Verkauf von Anlagevermögen',
    'Ausserordentlicher Aufwand', 'Ausserordentlicher Ertrag', 'Direkte Steuern',
    'Jahresgewinn (Erfolgsrechnung)',
  ],
};

const ARTEN = ['theorie', 'aufwaermen', 'aufgabe'];
const MODULE = ['fa', 'mathe', 'ob', 'pom', 'kdw'];
const EINSCHAETZUNGEN = ['leicht', 'mittel', 'schwer', 'nicht verstanden'];

// Alle erlaubten Schreibweisen: voller Eintrag, Teil vor der Klammer, Teil in der Klammer
const KONTO_NAMEN = (() => {
  const s = new Set();
  for (const k of [...KONTENPLAN.bilanz, ...KONTENPLAN.erfolg]) {
    s.add(k.toLowerCase());
    const m = k.match(/^(.*?)\s*\((.*)\)$/);
    if (m) { s.add(m[1].toLowerCase()); s.add(m[2].toLowerCase()); }
  }
  return s;
})();
const istKonto = (name) => KONTO_NAMEN.has(String(name).trim().toLowerCase());

// ── Antworten prüfen ── (rein)
// Jede Schreibweise eines Kontos → voller Eintrag, damit „Debitoren“ und „Forderungen L&L“ gleich zählen
const KONTO_VOLL = (() => {
  const m = new Map();
  for (const k of [...KONTENPLAN.bilanz, ...KONTENPLAN.erfolg]) {
    m.set(k.toLowerCase(), k);
    const t = k.match(/^(.*?)\s*\((.*)\)$/);
    if (t) { m.set(t[1].toLowerCase(), k); m.set(t[2].toLowerCase(), k); }
  }
  return m;
})();
const normKonto = (s) => { const k = String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); return KONTO_VOLL.get(k) || k; };

// „1'200.50“, „1 200,5“, „CHF 1200.–“ → 1200.5; leer oder Text → null
function leseBetrag(s) {
  if (typeof s === 'number') return s;
  let t = String(s || '').replace(/CHF|Fr\.|[’'\s]/gi, '').replace(/\.[–-]$/, '');
  if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  t = t.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

// Buchung gegen Lösung, Reihenfolge egal: Zeile mit richtigen Konten und Betrag = 1, nur Konten = ½.
// Geteilt durch die grössere Zeilenzahl, damit zusätzliche falsche Zeilen Punkte kosten. → 0 … 1
function pruefeBuchung(eingabe, loesung) {
  const zeilen = (eingabe || []).filter((r) => r.some((c) => String(c).trim()));
  if (!loesung.length) return zeilen.length ? 0 : 1;
  const offen = loesung.map((l) => ({ so: normKonto(l[0]), ha: normKonto(l[1]), be: leseBetrag(l[2]) }));
  let punkte = 0;
  for (const r of zeilen) {
    const so = normKonto(r[0]), ha = normKonto(r[1]), be = leseBetrag(r[2]);
    const passt = (l) => l.so === so && l.ha === ha;
    let i = offen.findIndex((l) => passt(l) && (l.be === null || (be !== null && Math.abs(l.be - be) < 0.01)));
    if (i >= 0) { punkte += 1; offen.splice(i, 1); continue; }
    i = offen.findIndex(passt);
    if (i >= 0) { punkte += 0.5; offen.splice(i, 1); }
  }
  return Math.round((punkte / Math.max(zeilen.length, loesung.length)) * 100) / 100;
}

// ── Mathe: Zahlen lesen und prüfen ── (rein)
// „−2“, „1'234.50“, „1 234,5“, „CHF 1'200.–“, „3/4“, „4,5 %“ → Zahl; sonst null
function leseZahl(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  let t = String(s == null ? '' : s).replace(/^\s*[a-zA-Z][a-zA-Z0-9_]*\s*=\s*/, '').replace(/CHF|Fr\./gi, '').replace(/[’'\s]/g, '')
    .replace(/[−–](?=\d)/g, '-').replace(/\.[–-]$/, '').replace(/%$/, '');
  if (!t) return null;
  const bruch = /^(-?\d+(?:[.,]\d+)?)\/(-?\d+(?:[.,]\d+)?)$/.exec(t);
  if (bruch) {
    const a = leseZahl(bruch[1]), b = leseZahl(bruch[2]);
    return a !== null && b ? a / b : null;
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) && (t.includes(',') || (t.match(/\./g) || []).length > 1)) {
    t = t.replace(/\./g, '').replace(',', '.');   // deutsche Schreibweise 1.234,5 bzw. 1.234.567
  } else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');   // genau ein Komma ohne Punkt = Dezimalkomma
  else t = t.replace(/,/g, '');
  return /^-?(\d+(\.\d*)?|\.\d+)(e-?\d+)?$/i.test(t) ? Number(t) : null;
}

// Mehrere Werte: getrennt mit ; | „ und “ oder Komma mit Leerzeichen danach („3,5“ bleibt eine Zahl)
// „x1 = 2“ → 2, „±3“ → 3 und −3, „3 5“ → 3 und 5 (aber „1 234,5“ bleibt eine Zahl mit Tausender-Leerzeichen)
function leseZahlen(s) {
  const out = [];
  for (let teil of String(s || '').split(/;|\||\s+und\s+|,\s+/)) {
    teil = teil.trim().replace(/^[a-zA-Z][a-zA-Z0-9_]*\s*=\s*/, '');
    if (!teil) continue;
    const pm = /^±\s*(.+)$/.exec(teil);
    if (pm) { const x = leseZahl(pm[1]); if (x !== null) out.push(x, -x); continue; }
    const tausender = /^-?\d{1,3}(\s\d{3})+([.,]\d+)?$/.test(teil);
    const stuecke = !tausender && /\s/.test(teil) ? teil.split(/\s+/) : [teil];
    for (const st of stuecke) { const x = leseZahl(st); if (x !== null) out.push(x); }
  }
  return out;
}

// 1 = innerhalb Rundung, ½ = Weg stimmt, Rundung/Zwischenschritt daneben (≤ 1 %), sonst 0
// Mit „runden“: höchstens eine Einheit der letzten verlangten Stelle daneben (anders gerundet) = voll.
// Ohne „runden“: 0,05 % relativ. Prozent: auch die Eingabe als Dezimalzahl (0.045 für 4,5 %, 0.005 für 0,5 %).
function pruefeZahl(eingabe, soll, opt = {}) {
  const x = leseZahl(eingabe);
  if (x === null || typeof soll !== 'number') return 0;
  const tol = Number.isInteger(opt.runden) ? 10 ** -opt.runden : 0.0005 * Math.abs(soll);
  const wert = (y) => {
    const d = Math.abs(y - soll);
    if (d <= tol * (1 + 1e-9) + 1e-12) return 1;
    if (d <= Math.max(tol, 0.01 * Math.abs(soll))) return 0.5;
    return 0;
  };
  return opt.prozent ? Math.max(wert(x), wert(x * 100)) : wert(x);
}

// Menge (z. B. Nullstellen), Reihenfolge egal; zusätzliche Werte kosten wie bei Buchungen
function pruefeMenge(eingabe, soll, opt = {}) {
  const werte = leseZahlen(eingabe);
  if (!soll.length) return werte.length ? 0 : 1;
  const offen = [...soll];
  let treffer = 0;
  for (const w of werte) {
    const i = offen.findIndex((s) => pruefeZahl(String(w), s, opt) === 1);
    if (i >= 0) { treffer += 1; offen.splice(i, 1); }
  }
  return Math.round((treffer / Math.max(werte.length, soll.length)) * 100) / 100;
}

// Eingabe eines Mathe-Falls ([[text]]) gegen zahl (eine Zahl oder Menge)
const pruefeZahlFall = (eingabe, fall) => {
  const t = ((eingabe || [])[0] || [])[0] || '';
  const opt = { runden: fall.runden, prozent: fall.prozent };
  return Array.isArray(fall.zahl) ? pruefeMenge(t, fall.zahl, opt) : pruefeZahl(t, fall.zahl, opt);
};

// Buchungsfall bewerten: Ist keine Buchung nötig, ist leer lassen richtig (pruefeBuchung kann das selbst)
const bewerteBuchung = (eingabe, loesung) => pruefeBuchung(eingabe || [], loesung || []);

const ERGEBNIS_TEXT = (w) => (w >= 1 ? 'richtig' : w > 0 ? 'teilweise' : 'falsch');
const istLeer = (eingabe) => !(eingabe || []).some((r) => r.some((c) => String(c).trim()));

// Trefferquote einer Einheit: aufgedeckte Fälle mit eingefrorenem Ergebnis; nicht aufgedeckte Buchungen
// werden jetzt geprüft, leere Fälle zählen falsch, Textantworten ohne eigene Bewertung zählen nicht
function trefferQuote(einheit, z) {
  let summe = 0, anzahl = 0;
  einheit.schritte.forEach((s, si) => {
    for (const fall of s.faelle || []) {
      const key = `${si}.${fall.id}`;
      const eingabe = (z.eingaben || {})[key];
      const fest = (z.ergebnisse || {})[key];
      let w = null;
      if (fest && fest.wert != null) w = fest.wert;
      else if (fall.art === 'buchung') w = bewerteBuchung(eingabe, fall.loesung);
      else if (istLeer(eingabe)) w = 0;
      else if (fall.art === 'zahl') w = pruefeZahlFall(eingabe, fall);
      if (w === null) continue;
      summe += w; anzahl += 1;
    }
  });
  return anzahl ? { prozent: Math.round((summe / anzahl) * 100), richtig: Math.round(summe * 10) / 10, anzahl } : null;
}

// FA-Prüfungstempo: 90 Punkte in 90 Minuten, ein Buchungssatz = 1 Punkt (HS21-Repetition: „42 Buchungssätze
// à 1 Punkt, Richtzeit 42 Min.“). Soll also 1 min pro Lösungszeile; Rechen-/Textfragen 1 min pro Punkt, sonst 2.
const TEMPO = { buchungssatz: 1, frageOhnePunkte: 2 };
function pruefTempo(faelle) {
  return faelle.reduce((a, fall) => a + (fall.art === 'buchung'
    ? TEMPO.buchungssatz * Math.max(1, fall.loesung.length)
    : (typeof fall.punkte === 'number' && fall.punkte > 0 ? fall.punkte : TEMPO.frageOhnePunkte)), 0);
}

function pruefeEinheit(obj) {
  const f = (fehler) => ({ ok: false, fehler });
  if (!obj || typeof obj !== 'object') return f('Der Block ist leer.');
  for (const feld of ['id', 'thema']) if (!obj[feld]) return f(`Feld „${feld}“ fehlt.`);
  const modul = obj.modul == null ? 'fa' : String(obj.modul);
  if (!MODULE.includes(modul)) return f(`Feld „modul“ muss ${MODULE.join(' oder ')} sein.`);
  if (!Array.isArray(obj.schritte) || !obj.schritte.length) return f('Feld „schritte“ fehlt oder ist leer.');
  const schritte = [];
  for (const [i, s] of obj.schritte.entries()) {
    const wo = `Schritt ${i + 1}`;
    if (!s || !ARTEN.includes(s.art)) return f(`${wo}: „art“ muss ${ARTEN.join(', ')} sein.`);
    if (!s.titel) return f(`${wo}: Feld „titel“ fehlt.`);
    const tempo = modul === 'fa' && obj.modus !== 'pruefung' && s.art !== 'theorie';
    if (!tempo && (typeof s.soll !== 'number' || s.soll <= 0)) return f(`${wo}: Feld „soll“ (Minuten) fehlt.`);
    const neu = { ...s };
    if (s.art !== 'theorie') {
      if (!Array.isArray(s.faelle)) return f(`${wo}: Feld „faelle“ fehlt.`);
      neu.faelle = [];
      for (const [j, fall] of s.faelle.entries()) {
        const wf = `${wo}, Fall ${fall && fall.id || j + 1}`;
        if (!fall || !fall.id || !fall.text) return f(`${wf}: „id“ und „text“ sind Pflicht.`);
        if (modul === 'mathe') {
          // Mathe: Zahl(en) automatisch geprüft oder Text selbst bewertet; immer mit Aufgabenart
          const aufgabenart = fall.aufgabenart || s.aufgabenart;
          if (!aufgabenart) return f(`${wf}: Feld „aufgabenart“ fehlt (am Fall oder am Schritt).`);
          const probe = obj.modus === 'pruefung';
          if (fall.antwort != null) {
            neu.faelle.push({ ...fall, id: String(fall.id), aufgabenart: String(aufgabenart), art: 'antwort' });
            continue;
          }
          const zahlen = Array.isArray(fall.zahl) ? fall.zahl : [fall.zahl];
          if (fall.zahl == null || !zahlen.length || zahlen.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
            return f(`${wf}: „zahl“ (Zahl oder Liste von Zahlen) oder „antwort“ fehlt.`);
          }
          if (!probe && (!Array.isArray(fall.hilfe) || fall.hilfe.length < 2)) return f(`${wf}: „hilfe“ braucht zwei Tipps (Situation, Spick).`);
          if (!probe && (!Array.isArray(fall.weg) || fall.weg.length < 2)) return f(`${wf}: „weg“ braucht mindestens zwei Schritte.`);
          neu.faelle.push({ ...fall, id: String(fall.id), aufgabenart: String(aufgabenart), art: 'zahl' });
          continue;
        }
        // Rechen- oder Textfrage statt Buchung: Textfeld, Musterantwort beim Aufdecken
        if (fall.antwort != null) {
          neu.faelle.push({ ...fall, id: String(fall.id), art: 'antwort' });
          continue;
        }
        const loesung = fall.loesung || [];
        if (!Array.isArray(loesung)) return f(`${wf}: „loesung“ muss eine Liste sein.`);
        for (const z of loesung) {
          if (!Array.isArray(z) || z.length !== 3) return f(`${wf}: Lösungszeile braucht [Soll, Haben, Betrag].`);
          for (const k of [z[0], z[1]]) if (!istKonto(k)) return f(`${wf}: Konto „${k}“ steht nicht im Kontenplan.`);
        }
        neu.faelle.push({ zeilen: 3, ...fall, id: String(fall.id), loesung, art: 'buchung' });
      }
    }
    if (tempo) neu.soll = pruefTempo(neu.faelle);
    schritte.push(neu);
  }
  // Probeprüfung: Countdown statt Timer, jeder Fall braucht Punkte
  if (obj.modus === 'pruefung') {
    if (typeof obj.dauer !== 'number' || obj.dauer <= 0) return f('Probeprüfung: Feld „dauer“ (Minuten) fehlt.');
    for (const s of schritte) for (const fall of s.faelle || []) {
      if (typeof fall.punkte !== 'number' || fall.punkte <= 0) return f(`Probeprüfung: Fall ${fall.id} in „${s.titel}“ braucht „punkte“.`);
    }
  }
  return { ok: true, einheit: { ...obj, id: String(obj.id), modul, schritte } };
}

// ── Probeprüfung ── (rein)
// Punkte nach Abgabe: eingefrorene Ergebnisse × Punkte; Textantworten ohne Bewertung zählen (noch) nicht
function pruefungsErgebnis(einheit, z, bonus = 0) {
  let erreicht = 0, max = 0, offen = 0;
  const teile = [];
  einheit.schritte.forEach((s, si) => {
    let te = 0, tm = 0;
    for (const fall of s.faelle || []) {
      const e = (z.ergebnisse || {})[`${si}.${fall.id}`];
      tm += fall.punkte;
      if (!e || e.wert == null) { offen += 1; continue; }
      te += e.wert * fall.punkte;
    }
    if (tm) teile.push({ titel: s.titel, erreicht: Math.round(te * 4) / 4, max: tm });
    erreicht += te; max += tm;
  });
  erreicht = Math.round(erreicht * 4) / 4;   // Viertelpunkte wie an der Prüfung
  // Bonuspunkte (Mathe) zählen zu den Punkten, höchstens bis zur Maximalpunktzahl
  const note = max ? Math.round((1 + 5 * Math.min(max, erreicht + bonus) / max) * 10) / 10 : 1;
  return { erreicht, max, note, prozent: max ? Math.round(erreicht / max * 100) : 0, offen, teile };
}

// Restzeit in Sekunden; die Uhr läuft wie an der echten Prüfung weiter, auch wenn Obsidian zu ist
const restSekunden = (z, dauerMin, jetzt) => (z.pruefStart != null ? Math.max(0, Math.round(dauerMin * 60 - (jetzt - z.pruefStart) / 1000)) : dauerMin * 60);

// Freischalten wie im Spiel: Schnitt über alle Stoff-Themen und kein Thema zu schwach
const FREI = { schnitt: 70, mindestens: 50, vorPruefung: 12 };
function freischaltung(themen, regel = {}) {
  const r = { ...FREI, ...regel };
  const stoff = themen.filter((t) => !t.stichworte.some((w) => /probepr/i.test(w)));
  const schnitt = stoff.length ? Math.round(stoff.reduce((a, t) => a + t.koennen, 0) / stoff.length) : 0;
  const unter = stoff.filter((t) => t.koennen < r.mindestens);
  return {
    offen: schnitt >= r.schnitt && unter.length === 0,
    schnitt, zielSchnitt: r.schnitt, mindestens: r.mindestens,
    gut: stoff.length - unter.length, anzahl: stoff.length,
    schwach: unter.sort((a, b) => a.koennen - b.koennen).slice(0, 3).map((t) => t.thema),
  };
}

// ── Zeiten ── (rein; „jetzt“ in ms wird übergeben, damit es testbar bleibt)
const MAX_LAUF_S = 4 * 3600;   // ein vergessener Timer zählt höchstens 4 h
const WACKELIG_FAKTOR = 1.5;

function neuerZustand(datei, n) {
  return { datei, sekunden: Array(n).fill(0), laeuft: null, eingaben: {}, aufgedeckt: [],
    einschaetzung: null, abgeschlossen: null, board: false, schritt: 0 };
}

function stoppeLaufenden(z, jetzt) {
  if (!z.laeuft) return z;
  const sekunden = [...z.sekunden];
  const { schritt, seit } = z.laeuft;
  while (sekunden.length <= schritt) sekunden.push(0);
  sekunden[schritt] += Math.min(MAX_LAUF_S, Math.max(0, Math.round((jetzt - seit) / 1000)));
  return { ...z, sekunden, laeuft: null };
}

function starte(z, schritt, jetzt) {
  return { ...stoppeLaufenden(z, jetzt), laeuft: { schritt, seit: jetzt, puls: jetzt } };
}

// Obsidian wurde mit laufendem Timer beendet: nur bis zum letzten Lebenszeichen zählen
function stoppeNachAbsturz(z) {
  if (!z.laeuft) return z;
  return stoppeLaufenden(z, z.laeuft.puls != null ? z.laeuft.puls : z.laeuft.seit);
}

// Ruhezustand: Kam länger als „grenze“ ms kein Puls, lief Obsidian nicht wirklich — bis zum Puls stoppen
function nachPause(z, jetzt, grenze) {
  if (!z.laeuft || z.laeuft.puls == null || jetzt - z.laeuft.puls <= grenze) return z;
  return stoppeNachAbsturz(z);
}

// Theorie zählt nicht: lange Theorie heisst Verständnis, lange Aufgaben heissen Anwendung
function istWackelig(einheit, z) {
  if (z.einschaetzung === 'schwer' || z.einschaetzung === 'nicht verstanden') return true;
  let soll = 0, ist = 0;
  einheit.schritte.forEach((s, i) => {
    if (s.art === 'theorie') return;
    soll += s.soll * 60;
    ist += z.sekunden[i] || 0;
  });
  return soll > 0 && ist > soll * WACKELIG_FAKTOR;
}

// ── Board und Fortschrittsnotiz ── (rein, Text rein → Text raus)
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Offene Karte mit Link auf „linkziel“ abhaken und als erste Karte unter „## Erledigt“ einreihen
function hakeKarteAb(boardText, linkziel) {
  const zeilen = boardText.split('\n');
  const erledigt = zeilen.findIndex((z) => /^## Erledigt\s*$/.test(z));
  if (erledigt < 0) return { text: boardText, gefunden: false };
  const karte = new RegExp(`^- \\[ \\] .*\\[\\[${escRe(linkziel)}(\\|[^\\]]*)?\\]\\]`);
  const start = zeilen.findIndex((z, i) => i < erledigt && karte.test(z));
  if (start < 0) return { text: boardText, gefunden: false };
  let ende = start + 1;
  while (ende < zeilen.length && /^\s+\S/.test(zeilen[ende])) ende++;   // eingerückte Folgezeilen
  const block = zeilen.splice(start, ende - start);
  block[0] = block[0].replace('- [ ]', '- [x]');
  const ziel = zeilen.findIndex((z) => /^## Erledigt\s*$/.test(z)) + 1;
  let einfuegen = ziel;
  while (einfuegen < zeilen.length && zeilen[einfuegen].trim() === '') einfuegen++;
  const naechste = zeilen[einfuegen];
  if (naechste === undefined || /^(%%|## )/.test(naechste)) {
    // Leere Spalte: nach einer Leerzeile einfügen und eine Leerzeile vor Settings/nächster Spalte lassen
    const leer = einfuegen - ziel;
    zeilen.splice(ziel + 1, 0, ...block, ...(leer < 2 ? [''] : []));
    if (leer === 0) zeilen.splice(ziel, 0, '');
  } else {
    zeilen.splice(einfuegen, 0, ...block);
  }
  return { text: zeilen.join('\n'), gefunden: true };
}

const minuten = (s) => Math.round(s / 60);

function fortschrittZeile(einheit, z, datumISO) {
  const [, m, d] = datumISO.split('-');
  const ist = minuten(z.sekunden.reduce((a, b) => a + (b || 0), 0));
  const soll = einheit.schritte.reduce((a, s) => a + s.soll, 0);
  const q = trefferQuote(einheit, z);
  const quote = q ? ` · ${q.prozent} % richtig (${q.richtig}/${q.anzahl})` : '';
  return `| ${d}.${m}. | ${einheit.thema} | Lerneinheit | ${ist} min (Soll ${soll})${quote} | ${z.einschaetzung} |`;
}

// Zeile mit gleichem Datum und Thema ersetzen, sonst ans Ende der Tabelle mit „Datum“-Kopf hängen
function setzeFortschritt(text, zeile) {
  const zeilen = text.split('\n');
  const schluessel = (z) => z.split('|').slice(1, 3).map((c) => c.trim()).join('|');
  const k = schluessel(zeile);
  const kopf = zeilen.findIndex((z) => /^\|\s*Datum\s*\|/.test(z));
  if (kopf < 0) return text.replace(/\n*$/, '\n\n| Datum | Thema | Stufe | Material | Einschätzung |\n| --- | --- | --- | --- | --- |\n' + zeile + '\n');
  let i = kopf + 2;
  for (; i < zeilen.length && zeilen[i].startsWith('|'); i++) {
    if (schluessel(zeilen[i]) === k) { zeilen[i] = zeile; return zeilen.join('\n'); }
  }
  zeilen.splice(i, 0, zeile);
  return zeilen.join('\n');
}

// ── Prüfungsfahrplan ── (rein) Themen der Prüfung mit Stichtag, Status aus der Fortschrittsnotiz
const plusTage = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const tageBis = (von, bis) => Math.round((Date.parse(bis + 'T12:00:00Z') - Date.parse(von + 'T12:00:00Z')) / 86400000);

// Zeilen der Tabelle mit „Datum“-Kopf; „27.10.“ → ISO, Herbst = 2026, ab Januar 2027
function leseFortschritt(text) {
  const zeilen = text.split('\n');
  const kopf = zeilen.findIndex((z) => /^\|\s*Datum\s*\|/.test(z));
  if (kopf < 0) return [];
  const out = [];
  for (let i = kopf + 2; i < zeilen.length && zeilen[i].startsWith('|'); i++) {
    const [datum, thema, stufe, material, einschaetzung] = zeilen[i].split('|').slice(1).map((c) => c.trim());
    const m = /^(\d{1,2})\.(\d{1,2})\./.exec(datum || '');
    if (!m) continue;
    const jahr = Number(m[2]) >= 8 ? 2026 : 2027;
    out.push({ datum: `${jahr}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, thema, stufe: stufe || '', material: material || '', einschaetzung: einschaetzung || '' });
  }
  return out;
}

// ── Lernzentrale: Modulspalten im Board = Ordner unter Module/ ──
const MODUL_SPALTEN = { fa: 'Financial Accounting', ma: 'Angewandte Mathematik 1', ob: 'Organisational Behaviour', pom: 'Principles of Management', kdw: 'Kritisches Denken' };
const MODUL_KEYS = Object.keys(MODUL_SPALTEN);
const leerMinuten = () => ({ fa: 0, ma: 0, ob: 0, pom: 0, kdw: 0 });
// Mathe-Aufgabenzeile „Art · Einheit 3a“ → „Einheit“
const einheitAusAufgabe = (thema) => String(thema).split(' · ').slice(1).join(' · ').replace(/\s+\S+$/, '');

// Gelernte Minuten pro Tag und Modul: Fortschrittszeilen (FA, Mathe) und Quizrunden mit gemessener Dauer.
// Quizrunden ohne „sek“ (alle alten) zählen nicht – geschätzt wird nichts.
function lernMinuten(fortschritt, quizDaten) {
  const out = new Map();
  const dazu = (iso, modul, min) => {
    if (!iso || !(min > 0)) return;
    if (!out.has(iso)) out.set(iso, leerMinuten());
    out.get(iso)[modul] += min;
  };
  // Mathe: hat eine Einheit eine „Einheit“-Zeile (Uhr der ganzen Einheit), zählen ihre Aufgabenzeilen nicht extra
  const maGanz = new Set(((fortschritt && fortschritt.ma) || []).filter((z) => z.stufe === 'Einheit').map((z) => `${z.datum}|${z.thema}`));
  for (const modul of ['fa', 'ma', 'ob', 'pom', 'kdw']) {
    for (const z of (fortschritt && fortschritt[modul]) || []) {
      if (modul === 'ma' && z.stufe === 'Aufgabe' && maGanz.has(`${z.datum}|${einheitAusAufgabe(z.thema)}`)) continue;
      const m = /(\d+)\s*min/.exec(z.material || '');
      if (m) dazu(z.datum, modul, Number(m[1]));
    }
  }
  const ordner = Object.fromEntries(Object.entries(MODUL_SPALTEN).map(([k, v]) => [v, k]));
  for (const [pfad, st] of Object.entries((quizDaten && quizDaten.quiz) || {})) {
    const modul = ordner[String(pfad).split('/')[1]];
    if (!modul) continue;
    for (const r of (st && st.runden) || []) if (typeof r.sek === 'number') dazu(r.d, modul, Math.round(r.sek / 60));
  }
  return out;
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const wochentag = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const summeMin = (t) => (t ? MODUL_KEYS.reduce((s, k) => s + (t[k] || 0), 0) : 0);

// Woche Montag bis Sonntag um „heute“, dazu derselbe Wochentag der Vorwoche
function wocheVon(proTag, heuteISO) {
  const montag = plusTage(heuteISO, -((wochentag(heuteISO) + 6) % 7));
  const tage = [];
  let summeBisHeute = 0, vorBisHeute = 0;
  for (let i = 0; i < 7; i++) {
    const iso = plusTage(montag, i);
    const minuten = { ...leerMinuten(), ...(proTag.get(iso) || {}) };
    const summe = summeMin(minuten), vor = summeMin(proTag.get(plusTage(iso, -7)));
    if (iso <= heuteISO) { summeBisHeute += summe; vorBisHeute += vor; }
    tage.push({ iso, kurz: WOCHENTAG[wochentag(iso)], minuten, summe, vor, heute: iso === heuteISO, zukunft: iso > heuteISO });
  }
  return { tage, summeBisHeute, vorBisHeute };
}

// Lernserie: Tage am Stück mit Lernzeit; heute ohne Lernen zählt bis gestern
function serie(proTag, heuteISO) {
  const gelernt = (iso) => summeMin(proTag.get(iso)) > 0;
  let tag = gelernt(heuteISO) ? heuteISO : plusTage(heuteISO, -1);
  const folge = [];
  while (gelernt(tag)) { folge.unshift(tag); tag = plusTage(tag, -1); }
  let rekord = 0, lauf = 0, vorher = null;
  for (const iso of [...proTag.keys()].filter(gelernt).sort()) {
    lauf = vorher && tageBis(vorher, iso) === 1 ? lauf + 1 : 1;
    rekord = Math.max(rekord, lauf);
    vorher = iso;
  }
  return { tage: folge.length, punkte: folge.slice(-5).map((iso) => WOCHENTAG[wochentag(iso)]), rekord };
}

// Tagesziel: gelernt plus geplant; ist nichts geplant, der Rest des Wochenziels verteilt auf die restlichen Tage
function tagesziel(gelerntHeute, geplantHeute, wochenzielMin, wocheSummeBisGestern, heuteISO) {
  if (geplantHeute > 0) return gelerntHeute + geplantHeute;
  const restTage = 7 - ((wochentag(heuteISO) + 6) % 7);
  return Math.max(gelerntHeute, Math.round(Math.max(0, wochenzielMin - wocheSummeBisGestern) / restTage));
}

// Fakten aus echten Daten, jeder erst ab genug Daten (sonst wäre die Aussage Zufall)
const WOCHENTAG_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
function fakten({ proTag, faZeilen, maZeilen, serie: s }, heuteISO) {
  const out = [];
  const tage = [...proTag.entries()].filter(([iso, t]) => iso <= heuteISO && summeMin(t) > 0);
  if (tage.length >= 14) {
    const proWt = new Map();
    for (const [iso, t] of tage) { const w = wochentag(iso); const a = proWt.get(w) || [0, 0]; proWt.set(w, [a[0] + summeMin(t), a[1] + 1]); }
    const [w, [sum, n]] = [...proWt.entries()].sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1])[0];
    out.push(`Dein bester Lerntag ist der <b>${WOCHENTAG_LANG[w]}</b>: im Schnitt ${Math.round(sum / n)} min.`);
  }
  // Mathe schreibt eine Zeile pro Aufgabe: eine Einheit = gleicher Tag und gleicher Einheitsname
  const maEinheiten = new Set((maZeilen || []).filter((z) => z.stufe === 'Aufgabe')
    .map((z) => `${z.datum}|${String(z.thema).split(' · ').slice(1).join(' · ').replace(/\s+\S+$/, '')}`));
  const anzahl = (faZeilen || []).filter((z) => z.stufe === 'Lerneinheit').length + maEinheiten.size;
  if (anzahl >= 5) out.push(`Seit Semesterbeginn hast du <b>${anzahl} Lerneinheiten</b> abgeschlossen.`);
  if (s && s.rekord >= 3) out.push(`Deine längste Lernserie: <b>${s.rekord} Tage</b>.`);
  return out;
}

// Stichwort als ganzes Wort: „Bilanz“ trifft „Bilanz aufstellen“, nicht „Bilanzanalyse“
const trifft = (text, wort) => new RegExp(`(^|[^\\p{L}])${escRe(wort)}([^\\p{L}]|$)`, 'iu').test(text);

// ── Erklärvideos (nur YouTube-Kanal @kvwirtschaftkompakt, Reihe FWZ) ── Wunsch 14.11.2026:
// vor der Theorie das passende Video schauen. Nur IDs aus dieser Liste werden je abgespielt.
const VIDEO_KANAL = 'https://www.youtube.com/@kvwirtschaftkompakt';
const ERKLAERVIDEOS = [
  { stichworte: ['Bilanz', 'Erfolgsrechnung', 'Konten', 'Buchungssatz', 'Buchungssätze', 'Journal', 'Hauptbuch', 'Geschäftsjahrs'], videos: [
    ['wpe5vjB15a0', 'Bilanz #1 Vermögen und Schulden'], ['BozSsVomZFk', 'Bilanz #2 Gliederung'], ['dth8VQhM0_M', 'Bilanz #3 Veränderungen'],
    ['Z_edOkkb66s', 'Konto #1 Das Konto'], ['HvD1Ky2S06Y', 'Konto #2 Der Buchungssatz'], ['SxbruLv6eHw', 'Konto #3 Journal und Hauptbuch'],
    ['6ZTCbWaAnI4', 'Erfolgsrechnung #1 Aufbau'], ['D6aDEgGQ-Zw', 'Erfolgsrechnung #2 Die Erfolgskonten'], ['PBV_K0CrqRM', 'Erfolgsrechnung #3 Buchen mit Aufwand und Ertrag'],
    ['rxuOnPUV6KE', 'Erfolgsrechnung #4 Doppelter Erfolgsnachweis'], ['PXxCEkPAYx8', 'Erfolgsrechnung #5 Kontenrahmen']] },
  { stichworte: ['Kunden und Lieferanten', 'Rabatt', 'Skonto', 'Offene Posten'], videos: [
    ['zCKNr8go17k', 'Warenhandel #2 Einkauf'], ['9lcOJGiekZw', 'Warenhandel #4 Verkauf'], ['FGHWeyFnxuA', 'MWST #6 Rabatt und Skonto mit MWST'],
    ['RFDp_Bfi_OI', 'Offene-Posten-Buchhaltung']] },
  { stichworte: ['Forderungsverluste', 'Delkredere', 'Debitorenverluste'], videos: [
    ['U_JWvso6eKc', 'Verluste auf Forderungen #1 Endgültige Verluste'], ['_mIYp4XUypo', 'Verluste auf Forderungen #2 Mutmassliche Verluste (Delkredere)']] },
  { stichworte: ['Warenverkehr', 'Handelswaren', 'Warenhandel'], videos: [
    ['PpNh2ckPSMk', 'Warenhandel #1 Begriff'], ['zCKNr8go17k', 'Warenhandel #2 Einkauf'], ['Mt2U6ssEaGs', 'Warenhandel #3 Lagerveränderung'],
    ['9lcOJGiekZw', 'Warenhandel #4 Verkauf'], ['Mx6o-yTbUIo', 'Warenhandel #5 Bruttogewinn'], ['RdSmDwJrQvk', 'Warenhandel #6 Mehrstufige Erfolgsrechnung']] },
  { stichworte: ['Geldflussrechnung', 'GFR', 'Geldfluss', 'Cashflow indirekt'], videos: [
    ['g4lYCxa2PCs', 'Geldflussrechnung #1 Veränderung der flüssigen Mittel'], ['0pbF6yrc5Gs', 'Geldflussrechnung #2 Der Cashflow-Begriff'],
    ['SyBVZrp8rsw', 'Geldflussrechnung #3-1 Cashflow und Verkaufserlös'], ['dQLJProF0go', 'Geldflussrechnung #3-2 Cashflow und Handelswarenaufwand'],
    ['eHX5Fy7Mqc4', 'Geldflussrechnung #3-3 Cashflow, Verschiedenes'], ['-YddKnr0osU', 'Geldflussrechnung #4 Cashflow berechnen'],
    ['8mlZwqSMVjw', 'Geldflussrechnung #5 Investitionsbereich'], ['bTYN6EY-9YM', 'Geldflussrechnung #6 Finanzierungsbereich'],
    ['pxRupIDpKjk', 'Geldflussrechnung #7 Erstellen'], ['yTjARuIa79k', 'Geldflussrechnung #7 Erstellen (andere Variante)']] },
  { stichworte: ['Cashflow-Analyse', 'Free Cashflow', 'Verschuldungsfaktor'], videos: [
    ['rfj82Ei42rc', 'Geldflussrechnung #8 Free Cashflow und Verschuldungsfaktor']] },
  { stichworte: ['Mehrwertsteuer', 'MWST', 'MwSt'], videos: [
    ['H5hdi18NO0o', 'MWST #1 Funktionsweise'], ['SVYz-CuCmZo', 'MWST #2 Berechnungen'], ['7xgEXCjda1A', 'MWST #3 Geschuldete MWST berechnen'],
    ['UmROKaoSEPA', 'MWST #4 Saldomethode'], ['836bwS_4w7Y', 'MWST #5 Verbuchen'], ['FGHWeyFnxuA', 'MWST #6 Rabatt und Skonto mit MWST'],
    ['IQSCF5smRVM', 'MWST #7 Verbuchen nach der Saldomethode']] },
  { stichworte: ['Fremde Währungen', 'Fremdwährung', 'Fremdwährungen', 'Kursdifferenzen'], videos: [
    ['d-AOS9Xnlhc', 'Fremde Währungen #1 Begriffe'], ['f6_rVY7mGoA', 'Fremde Währungen #2 Berechnungen'], ['DIvkDkHz9Mc', 'Warenhandel #7 Einkauf und Verkauf in Fremdwährung']] },
  { stichworte: ['Personalaufwand', 'Lohn', 'Lohnabrechnung', 'Sozialversicherungen'], videos: [
    ['-UjSH-UIr38', 'Personalaufwand #1 Lohnabrechnung'], ['ViOhvzIKC2A', 'Personalaufwand #2 Verbuchen'], ['rMirmVX22Zk', 'Personalaufwand #3 Abrechnung mit den Sozialversicherungen']] },
  { stichworte: ['Wertschriften', 'Verrechnungssteuer'], videos: [
    ['4it0KEUJu70', 'Wertschriften #1 Bankabrechnung'], ['tJBNeWL1xcE', 'Wertschriften #2 Aktien buchen'], ['H5naVOwmju0', 'Wertschriften #3 Obligationen buchen'],
    ['sd3gHnzt0bY', 'Wertschriften #4 Renditeberechnung'], ['Uk2U52NDduU', 'Bank #3 Verrechnungssteuer']] },
  { stichworte: ['Abgrenzungen', 'Rechnungsabgrenzung', 'Rechnungsabgrenzungen', 'Rückstellungen', 'Rückstellung', 'Transitorische'], videos: [
    ['tSNf8CnULMw', 'Zeitliche Abgrenzungen #1 Aktive und passive'], ['Jc3pG4f5N1g', 'Zeitliche Abgrenzungen #2 Betrag berechnen'], ['t8mXE_Lws8U', 'Zeitliche Abgrenzungen #3 Rückstellungen']] },
  { stichworte: ['Abschreibungen', 'Abschreibung'], videos: [
    ['g8aqaNvbJdM', 'Abschreibungen #1 Grundlagen'], ['49iFOnH549o', 'Abschreibungen #2 Degressiv'], ['3xa-PLTCbPc', 'Abschreibungen #3 Indirekt'],
    ['3awz2M0Smak', 'Abschreibungen #4 Verkauf zum Buchwert'], ['dJpvB6PNPyg', 'Abschreibungen #4 Verkauf mit Veräusserungsdifferenz']] },
  { stichworte: ['Einzelunternehmen', 'Einzelunternehmung', 'Kollektivgesellschaft', 'Personengesellschaften'], videos: [
    ['Jj5vHHaXbkc', 'Einzelunternehmen #1 Die Konten'], ['ztgISF6u2NU', 'Einzelunternehmen #2 Jahresabschluss'], ['5CQUjlZeQBQ', 'Einzelunternehmen #3 Unternehmereinkommen'],
    ['DmjTn1zxNvY', 'Einzelunternehmen Repetition']] },
  { stichworte: ['AG', 'GmbH', 'Aktiengesellschaft', 'Unterbilanz', 'Unterbilanzen', 'Gewinnverwendung', 'Gewinnverteilung'], videos: [
    ['Xce3BjlzKpA', 'AG #1 Die Eigenkapitalkonten'], ['R-1B_76MWzA', 'AG #2 Gewinnverwendung'], ['DLMos-OPIhA', 'AG #3 Gewinnverteilung nach OR 671'],
    ['lN88J36_oZU', 'AG #4 Unterbilanz (Kapitalverlust)'], ['TDU456QMUIA', 'AG Repetition']] },
  { stichworte: ['Bewertung', 'Bewertungsvorschriften'], videos: [
    ['SH7Qj5W_ROU', 'Bewertung #1 Bewertung'], ['x5ZTg9pAS-c', 'Bewertung #4 Vorschriften für börsenkotierte Unternehmen']] },
  { stichworte: ['Stille Reserven', 'Bereinigung'], videos: [
    ['TH0V3Rk_Gh4', 'Stille Reserven #2 Stille Reserven'], ['7XBMcqNRH9k', 'Stille Reserven #3 Einfluss auf die Erfolgsrechnung'], ['L5AfnX8dqTQ', 'Stille Reserven Repetition']] },
  { stichworte: ['Bilanzanalyse', 'Liquidität', 'Anlagedeckung', 'Finanzierungsgrad'], videos: [
    ['CpyyN6GXUxQ', 'Analyse Jahresrechnung #3 Kennzahlen'], ['kqE5aMF6W9Y', 'Analyse Jahresrechnung #3-1 Kennzahlen berechnen']] },
  { stichworte: ['Erfolgsanalyse', 'Rentabilität', 'Leverage', 'Financial Leverage'], videos: [
    ['97AvduXe4N8', 'Analyse Jahresrechnung #1 Mehrstufige Erfolgsrechnung'], ['CpyyN6GXUxQ', 'Analyse Jahresrechnung #3 Kennzahlen'], ['KRivVlx7X-Q', 'Finanzierung #3 Leverage-Effekt']] },
];
const ERLAUBTE_VIDEOS = new Map(ERKLAERVIDEOS.flatMap((g) => g.videos));

// Videos zum Thema einer Einheit; `video:` im Theorie-Schritt (ID oder Liste) geht vor, aber nur mit IDs aus der Liste
function videosFuer(thema, schritt) {
  const eigene = schritt && schritt.video != null ? [].concat(schritt.video).map(String) : null;
  const ids = eigene || ERKLAERVIDEOS.filter((g) => g.stichworte.some((w) => trifft(String(thema || ''), w))).flatMap((g) => g.videos.map((v) => v[0]));
  return [...new Set(ids)].filter((id) => ERLAUBTE_VIDEOS.has(id)).map((id) => ({ id, titel: ERLAUBTE_VIDEOS.get(id) }));
}

// ── Können in Prozent (streng) ──
// Punkte pro Einschätzung; bei „leicht/mittel“ zählt das Schlechtere, zu lange gebraucht zählt wie schwer
const PUNKTE = { leicht: 100, mittel: 60, schwer: 25, 'nicht verstanden': 0 };
// Einmal geübt heisst noch nicht gekonnt: höchstens 50 % nach 1 Einschätzung, 75 % nach 2, erst ab 3 bis 100 %
const DECKEL = [0, 50, 75, 100];
const VERGESSEN_PRO_TAG = 2;   // pro Tag über dem Wiederholungstermin sinkt das Können um 2 Punkte
// Soll-Kurve pro Thema: 14 Tage vor Stichtag anfangen, am Stichtag 50 % (gesehen und etwas gekonnt),
// eine Woche vor der Prüfung 90 %
const SOLL = { vorlauf: 14, amStichtag: 50, ziel: 90, puffer: 7 };

function punkteZeile(z) {
  const e = z.einschaetzung.toLowerCase();
  const werte = Object.keys(PUNKTE).filter((k) => e.includes(k));
  const quoteNur = /(\d+)\s*%\s*richtig/.exec(z.material);
  if (!werte.length) return /^note\s/.test(e) && quoteNur ? Number(quoteNur[1]) : null;   // Probeprüfung: „Note 4,3“
  let p = Math.min(...werte.map((k) => PUNKTE[k]));
  const zeit = /(\d+)\s*min\s*\(Soll\s*(\d+)\)/.exec(z.material);
  if (zeit && Number(zeit[1]) > Number(zeit[2]) * WACKELIG_FAKTOR) p = Math.min(p, PUNKTE.schwer);
  // Trefferquote der Aufgaben: Gefühl und Ergebnis, das Schlechtere zählt
  const quote = /(\d+)\s*%\s*richtig/.exec(z.material);
  if (quote) p = Math.min(p, Number(quote[1]));
  // Mathe: mit Tipp gelöst zählt höchstens wie „schwer“ – an der Prüfung gibt es keine Tipps
  if (/mit Hilfe/.test(z.material)) p = Math.min(p, PUNKTE.schwer);
  return p;
}

// Zeit für einen Fall in Sekunden: Schritt-Uhr bei seiner letzten Eingabe minus Schritt-Uhr beim
// Fall davor (oder Schrittbeginn). Alte Stände ohne „uhr“ behalten ihre gemessene Zeit ab erster Eingabe.
function fallSekunden(z, key) {
  const uhr = z.uhr || {};
  if (uhr[key] == null) return ((z.ergebnisse || {})[key] || {}).sek || 0;
  const schritt = key.split('.')[0];
  let davor = 0;
  for (const [k, s] of Object.entries(uhr)) if (k !== key && k.split('.')[0] === schritt && s < uhr[key] && s > davor) davor = s;
  return Math.min(1800, Math.max(0, uhr[key] - davor));
}

// Mathe: eine Fortschrittszeile pro Aufgabe, Thema = Aufgabenart · Einheit Schritt+Fall
function matheZeilen(einheit, z, datumISO) {
  const [, m, d] = datumISO.split('-');
  const out = [];
  einheit.schritte.forEach((s, si) => {
    for (const fall of s.faelle || []) {
      if (!fall.aufgabenart) continue;
      const key = `${si}.${fall.id}`;
      const e = (z.ergebnisse || {})[key];
      let w = e && e.wert != null ? e.wert : null;
      if (w === null) w = istLeer((z.eingaben || {})[key]) ? 0 : fall.art === 'zahl' ? pruefeZahlFall(z.eingaben[key], fall) : 0;
      const hilfe = (e && e.hilfe) || ((z.hilfe || {})[key] || 0);
      const leer = istLeer((z.eingaben || {})[key]);
      const wie = e && e.leer ? 'Lösung angesehen'
        : hilfe ? `mit Hilfe ${hilfe}`
        : fall.art === 'antwort' && !leer && !(e && e.wert != null) ? 'nicht bewertet'
        : !e && leer ? 'nicht bearbeitet' : 'allein';
      const min = minuten(fallSekunden(z, key));
      const soll = fall.soll ? ` (Soll ${fall.soll})` : '';
      out.push(`| ${d}.${m}. | ${fall.aufgabenart} · ${einheit.thema} ${si + 1}${fall.id} | Aufgabe | ${wie} · ${Math.round(w * 100)} % richtig (${Math.round(w * 100) / 100}/1) · ${min} min${soll} | ${z.einschaetzung || ''} |`);
    }
  });
  return out;
}

// Mathe: Gesamtzeit der Einheit (Uhr über alle Schritte, auch Theorie und Nachdenken) für die Lernzentrale.
// Ohne Einschätzung, damit der Fahrplan (themaStatus) die Zeile nicht als Übung zählt.
function matheEinheitZeile(einheit, z, datumISO) {
  const [, m, d] = datumISO.split('-');
  const ist = minuten((z.sekunden || []).reduce((a, b) => a + (b || 0), 0));
  return `| ${d}.${m}. | ${einheit.thema} | Einheit | ${ist} min gesamt |  |`;
}

// Wiederholung nach Können: schwach morgen wieder, gut erst später – aber nie nach der Prüfung
const wiederNach = (k) => (k < 40 ? 1 : k < 70 ? 3 : k < 85 ? 7 : 14);
// Grenzen nach der Notenformel der Prüfung (Note = 1 + 5 × Punkte / Max): 80 % = Note 5, 70 % = Note 4,5
const statusAus = (k) => (k >= 80 ? 'sitzt' : k >= 70 ? 'fast' : 'wackelig');
// Note aus Können in Prozent; Bonuspunkte zählen zu den Punkten, höchstens Note 6
const noteMit = (prozent, max, bonus = 0) => {
  const p = (Math.max(0, Math.min(100, prozent)) / 100) * max;
  return Math.min(6, Math.round((1 + 5 * Math.min(max, p + bonus) / max) * 10) / 10);
};
const noteAus = (prozent) => noteMit(prozent, 90, 0);
const prozentFuer = (note) => Math.round(((note - 1) / 5) * 100);
// Wie viel Prozent der Prüfungspunkte für eine Note nötig sind, wenn Bonuspunkte dazukommen
const prozentFuerMit = (note, max, bonus = 0) => Math.max(0, Math.round((((note - 1) / 5) * max - bonus) / max * 100));

function sollAm(thema, tag, pruefung) {
  const start = plusTage(thema.stichtag, -SOLL.vorlauf);
  const ende = plusTage(pruefung, -SOLL.puffer);
  if (tag <= start) return 0;
  if (tag <= thema.stichtag) return Math.round(SOLL.amStichtag * tageBis(start, tag) / SOLL.vorlauf);
  if (tag >= ende) return SOLL.ziel;
  const anteil = tageBis(thema.stichtag, tag) / Math.max(1, tageBis(thema.stichtag, ende));
  return Math.round(SOLL.amStichtag + (SOLL.ziel - SOLL.amStichtag) * anteil);
}

// Druck aus Ist gegen Soll: noch nicht dran / im Plan / knapp / Rückstand / Alarm
function druckStufe(ist, soll) {
  if (soll <= 0 && ist <= 0) return 'ruhe';
  if (ist >= soll) return 'gut';
  const quote = ist / soll;
  return quote >= 0.8 ? 'knapp' : quote >= 0.6 ? 'hinten' : 'alarm';
}

function themaStatus(thema, zeilen, heuteISO, pruefung = '2099-12-31') {
  const soll = sollAm(thema, heuteISO, pruefung);
  const roh = zeilen
    .filter((z) => thema.stichworte.some((w) => trifft(z.stufe === 'Aufgabe' ? z.thema.split(' · ')[0] : z.thema, w)) && punkteZeile(z) !== null)
    .map((z, i) => ({ z, i }))
    .sort((a, b) => (a.z.datum === b.z.datum ? a.i - b.i : a.z.datum < b.z.datum ? -1 : 1))
    .map((x) => x.z);
  // Mathe schreibt eine Zeile pro Aufgabe: Mehrere Zeilen am selben Tag sind eine Einschätzung (das Schlechteste zählt),
  // sonst wäre ein Thema nach einer einzigen Einheit schon „sitzt“
  // Nur Mathe-Aufgabenzeilen (Stufe „Aufgabe“) werden pro Tag zusammengefasst; FA-Zeilen zählen wie bisher einzeln
  const proTag = new Map();
  roh.forEach((z, i) => {
    const k = z.stufe === 'Aufgabe' ? `A:${z.datum}` : `Z:${i}`;
    const p = punkteZeile(z);
    const alt = proTag.get(k);
    if (!alt || p < alt.p) proTag.set(k, { z, p });
    else proTag.set(k, { z: alt.p === p ? z : alt.z, p: alt.p });
  });
  const treffer = [...proTag.values()].map((x) => ({ ...x.z, _p: x.p }));
  if (!treffer.length) {
    const status = heuteISO > thema.stichtag ? 'ueberfaellig' : 'offen';
    return { status, koennen: 0, soll, druck: druckStufe(0, soll), letzte: null, wieder: null, anzahl: 0 };
  }
  // Letzte drei Einschätzungen, die neueste zählt am meisten (Gewicht 1, 2, 3)
  const drei = treffer.slice(-3).map((z) => z._p);
  const gewicht = drei.reduce((s, _, i) => s + i + 1, 0);
  const basis = Math.min(drei.reduce((s, p, i) => s + p * (i + 1), 0) / gewicht, DECKEL[Math.min(treffer.length, 3)]);
  const letzte = treffer[treffer.length - 1];
  const wieder = plusTage(letzte.datum, wiederNach(basis));
  const ueber = Math.max(0, tageBis(wieder, heuteISO));
  const koennen = Math.max(0, Math.round(basis - ueber * VERGESSEN_PRO_TAG));
  return {
    status: statusAus(koennen), koennen, soll, druck: druckStufe(koennen, soll),
    letzte: letzte.datum, quelle: letzte.thema, wieder, anzahl: treffer.length,
  };
}

// Alle Quizrunden eines Modulordners: Thema = Name der Quizseite ohne „– Quiz“
function quizListe(quiz, ordner) {
  const out = [];
  for (const [pfad, q] of Object.entries((quiz && quiz.quiz) || {})) {
    if (!pfad.startsWith(ordner + '/')) continue;
    const thema = pfad.slice(ordner.length + 1).replace(/\.md$/, '').replace(/ – Quiz$/, '');
    for (const r of (q && q.runden) || []) out.push({ thema, datum: r.d, prozent: Math.round((r.p || 0) * 100) });
  }
  return out.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
}

// Stand eines Themas der neuen Module: erledigter Meilenstein = 100 %; ohne Lerneinheit zählen die Quizrunden (Teil 4, Wahl 11.11.):
// die letzten drei Runden, die neueste am meisten, höchstens 40 % nach 1 Runde, 55 % nach 2, 70 % ab 3 – „sitzt“ nur mit Lerneinheit.
// Danach Vergessen wie bei FA.
const QUIZ_DECKEL = [0, 40, 55, 70];
// FA und Mathe: Quiz zählt schwächer, weil dort Rechnen und Buchen geprüft wird 
const QUIZ_DECKEL_RECHNEN = [0, 25, 35, 45];
function themaMitQuiz(thema, basis, liste, heuteISO = null, deckel = QUIZ_DECKEL) {
  if (thema.fertig) return { ...basis, status: 'sitzt', koennen: 100, druck: druckStufe(100, basis.soll), letzte: isoTag(thema.fertig), wieder: null, anzahl: Math.max(1, basis.anzahl) };
  if (basis.anzahl) return basis;
  const treffer = liste.filter((q) => thema.stichworte.some((w) => trifft(q.thema, w)));
  if (!treffer.length) return basis;
  const drei = treffer.slice(-3).map((q) => q.prozent);
  const gewicht = drei.reduce((s, _, i) => s + i + 1, 0);
  const roh = Math.min(drei.reduce((s, p, i) => s + p * (i + 1), 0) / gewicht, deckel[Math.min(treffer.length, 3)]);
  const l = treffer[treffer.length - 1];
  const wieder = plusTage(l.datum, wiederNach(roh));
  const ueber = heuteISO ? Math.max(0, tageBis(wieder, heuteISO)) : 0;
  const k = Math.max(0, Math.round(roh - ueber * VERGESSEN_PRO_TAG));
  return { ...basis, koennen: k, status: statusAus(k), druck: druckStufe(k, basis.soll), letzte: l.datum, quelle: 'Quiz', wieder, anzahl: treffer.length };
}

// Soll für ein fälliges Thema eine Wiederholen-Karte aufs Board? Bei FA/Mathe nur, wenn der Stand aus Lerneinheiten kommt
const wiederholKarte = (modul, t) => !((modul === 'fa' || modul === 'mathe') && t.quelle === 'Quiz');

// Kennzahlen eines Fahrplans (Kopf der Fahrplan-Ansicht und Modulkarten der Lernzentrale)
function fahrplanKennzahlen(themen, plan, cm, tag) {
  const n = Math.max(1, themen.length);
  let ist = Math.round(themen.reduce((s, t) => s + t.koennen, 0) / n);
  let soll = Math.round(themen.reduce((s, t) => s + t.soll, 0) / n);
  // Teile mit Gewicht (KDW: Disposition 70 %, MC-Test 30 %): Schnitt pro Teil, dann nach Gewicht
  const gw = plan.teile_gewicht && typeof plan.teile_gewicht === 'object' ? plan.teile_gewicht : null;
  if (gw) {
    let summe = 0, i = 0, so = 0;
    for (const [teil, g] of Object.entries(gw)) {
      const tt = themen.filter((t) => (t.teil || '') === teil);
      if (!tt.length || !(Number(g) > 0)) continue;
      summe += Number(g);
      i += Number(g) * tt.reduce((s, t) => s + t.koennen, 0) / tt.length;
      so += Number(g) * tt.reduce((s, t) => s + t.soll, 0) / tt.length;
    }
    if (summe) { ist = Math.round(i / summe); soll = Math.round(so / summe); }
  }
  // Nächster Meilenstein: der erste Teil, in dem noch nicht alles sitzt, fertig am spätesten Stichtag dieses Teils
  let meilenstein = null;
  for (const teil of [...new Set(themen.map((t) => t.teil || ''))]) {
    const tt = themen.filter((t) => (t.teil || '') === teil);
    if (tt.every((t) => t.status === 'sitzt')) continue;
    meilenstein = { text: `${(teil || 'Stoff').split(' –')[0].trim()} fertig`, datum: tt.map((t) => t.stichtag).sort().pop() };
    break;
  }
  return {
    rest: Math.max(tageBis(tag, plan.pruefung), 0), ist, soll, druck: druckStufe(ist, soll),
    note: noteMit(ist, cm.maxPunkte, cm.bonus), ziel: Number(plan.zielnote) || 0,
    wackelig: themen.filter((t) => t.status === 'wackelig').map((t) => t.thema), meilenstein,
  };
}

// Können des Moduls, wenn heute jeder Posten der Etappe mit „mittel“ eingeschätzt würde; null ohne passenden Posten
function hochrechnung(themen, zeilen, posten, heuteISO, pruefung) {
  const extra = [];
  for (const p of posten || []) {
    const t = themen.find((x) => (x.stichworte || []).some((w) => trifft(p.text || '', w)));
    if (t) extra.push({ datum: heuteISO, thema: p.text, stufe: 'Lerneinheit', material: '', einschaetzung: 'mittel' });
  }
  if (!extra.length || !themen.length) return null;
  const alle = [...zeilen, ...extra];
  return Math.round(themen.reduce((s, t) => s + themaStatus(t, alle, heuteISO, pruefung).koennen, 0) / themen.length);
}

const isoTag = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || ''));

function pruefeFahrplan(roh) {
  if (!roh || typeof roh !== 'object') return { ok: false, fehler: 'kein YAML' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoTag(roh.pruefung))) return { ok: false, fehler: 'pruefung: YYYY-MM-DD fehlt' };
  if (!Array.isArray(roh.themen) || !roh.themen.length) return { ok: false, fehler: 'themen fehlen' };
  for (const t of roh.themen) {
    if (!t.thema || !/^\d{4}-\d{2}-\d{2}$/.test(isoTag(t.stichtag)) || !Array.isArray(t.stichworte)) {
      return { ok: false, fehler: `Thema „${t.thema || '?'}“ braucht stichtag und stichworte` };
    }
  }
  const modul = roh.modul == null ? 'fa' : String(roh.modul);
  if (!MODULE.includes(modul)) return { ok: false, fehler: `modul muss ${MODULE.join(' oder ')} sein` };
  return { ok: true, plan: { ...roh, modul, spick_frieren: roh.spick_frieren ? isoTag(roh.spick_frieren) : undefined, pruefung: isoTag(roh.pruefung), themen: roh.themen.map((t) => ({ ...t, stichtag: isoTag(t.stichtag), fertig: t.fertig ? isoTag(t.fertig) : undefined, stichworte: t.stichworte.map(String) })) } };
}

// Offene Karten einer Board-Spalte, als Nächstes dran: nach Fälligkeit, Karten ohne Datum zuletzt
// Eine Kanban-Zeile „- [ ] [[Link|Text]] #tag @{2026-11-10}“ zerlegen; null, wenn es keine Karte ist
function zerlegeKarte(zeile, heuteISO) {
  const m = /^- \[([ x])\] (.*)$/.exec(zeile.replace(/\r$/, ''));
  if (!m) return null;
  let rest = m[2];
  const erledigtAm = (/✅\s*(\d{4}-\d{2}-\d{2})/u.exec(rest) || [])[1] || null;
  rest = rest.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, '');
  const tags = (rest.match(/(^|\s)#[\p{L}\d_-]+/gu) || []).map((t) => t.trim().slice(1).toLowerCase());
  const datum = (/@\{(\d{4}-\d{2}-\d{2})\}/.exec(rest) || [])[1] || null;
  rest = rest.replace(/@@?\{[^}]*\}/g, '').replace(/(^|\s)#[\p{L}\d_-]+/gu, '').trim();
  const l = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(rest);
  const text = l ? rest.replace(l[0], l[2] || l[1]).trim() : rest;
  return { text, link: l ? l[1].trim() : null, datum, ueberfaellig: !!datum && datum < heuteISO,
    wiederholen: tags.includes('wiederholen'), tags, erledigt: m[1] === 'x', erledigtAm };
}

// Zeilen einer Board-Spalte (bis zur nächsten Überschrift oder den Kanban-Einstellungen)
function spaltenZeilen(boardText, spalte) {
  const zeilen = boardText.split('\n');
  const nr = zeilen.findIndex((z) => z.trim() === `## ${spalte}`);
  if (nr < 0) return [];
  const out = [];
  for (let i = nr + 1; i < zeilen.length && !/^## /.test(zeilen[i]) && !/^%%/.test(zeilen[i]); i++) out.push(zeilen[i]);
  return out;
}

// Board für die Lernzentrale: offene Karten pro Modul mit Etikett, dazu die erledigten
function leseBoard(boardText, heuteISO, istLerneinheit = () => false) {
  const art = (k) => (k.wiederholen ? 'wiederholen' : k.link && istLerneinheit(k.link) ? 'lerneinheit'
    : k.tags.includes('abgabe') ? 'abgabe' : k.tags.includes('unterricht') ? 'unterricht' : null);
  const out = {};
  for (const [key, spalte] of Object.entries(MODUL_SPALTEN)) {
    out[key] = spaltenZeilen(boardText, spalte).map((z) => [z, zerlegeKarte(z, heuteISO)]).filter(([, k]) => k && !k.erledigt)
      .map(([z, k]) => ({ text: k.text, link: k.link, datum: k.datum, art: art(k), erledigt: false, ueberfaellig: k.ueberfaellig, zeile: z, spalte }));
  }
  out.erledigt = spaltenZeilen(boardText, 'Erledigt').map((z) => zerlegeKarte(z, heuteISO)).filter((k) => k && k.erledigt)
    .map((k) => ({ text: k.text, link: k.link, datum: k.datum, art: art(k), erledigt: true, ueberfaellig: false, erledigtAm: k.erledigtAm }));
  return out;
}

// Eine Spalte der Tafel: nach Fälligkeit sortiert (ohne Datum zuletzt), Fälligkeit als Text, ab der 5. Karte hinter „mehr anzeigen“
// Module, in denen man hauptsächlich mit den Plugin-Aufgaben lernt
const FOKUS_MODULE = ['fa'];
// fokus: nur Plugin-Aufgaben (Lerneinheit, Wiederholung) vorne, der Rest kommt ausgegraut in „zurückgestellt“ (Wunsch für FA, 10.11.)
const istPluginKarte = (k) => k.art === 'lerneinheit' || k.art === 'wiederholen' || /^Wiederholung\b/.test(k.text);
function tafelSpalte(karten, heuteISO, max = 4, fokus = false) {
  const morgen = plusTage(heuteISO, 1);
  const wt = (iso) => `${WOCHENTAG[wochentag(iso)]} ${kurz(iso)}`;
  const tage = (iso) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(heuteISO + 'T12:00:00Z')) / 86400000);
  const wann = (k) => {
    if (!k.datum) return '';
    const n = tage(k.datum);
    if (n < 0) return `${-n} ${-n === 1 ? 'Tag' : 'Tage'} überfällig · ${wt(k.datum)}`;
    return n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen · ${wt(k.datum)}`;
  };
  const sortiert = karten.map((k, i) => ({ k, i }))
    .sort((a, b) => ((a.k.datum || '9999') < (b.k.datum || '9999') ? -1 : (a.k.datum || '9999') > (b.k.datum || '9999') ? 1 : a.i - b.i))
    .map(({ k }) => ({ ...k, wann: wann(k) }));
  const vorne = fokus ? sortiert.filter(istPluginKarte) : sortiert;
  return { sichtbar: vorne.slice(0, max), rest: vorne.slice(max), zurueck: fokus ? sortiert.filter((k) => !istPluginKarte(k)) : [] };
}

// ── Modulseiten (Teil 2) ──

// Prüfungen HS26 laut Prüfungsplan und Semesterprogrammen (Recherche 10.11.2026)
const PRUEFUNG = {
  fa: { datum: '2027-01-22', zeit: '09:00', form: 'Papier, 90 Minuten', punkte: '90 Punkte, Teil A FIBU/GFR, Teil B Analyse', hilfsmittel: 'nur TI-30, kein OR' },
  ma: { datum: '2027-01-12', zeit: '10:30', form: 'Klausur auf Papier, 60 Minuten', punkte: '60 Punkte', hilfsmittel: 'TI-30X Pro und ein A4-Spick, beidseitig' },
  ob: { datum: '2027-01-18', zeit: '13:30', form: 'MooPad, 75 Minuten, Kprim und A+', punkte: '60 Punkte', hilfsmittel: 'keine' },
  pom: { datum: '2027-01-15', zeit: '09:00', form: 'hybrid, 75 Minuten: MooPad-Fragen und Fallstudie, danach 15 Minuten TOPSIM-Reflexion', punkte: '70 Punkte Prüfung, 10 Reflexion, 20 TOPSIM-Gruppe', hilfsmittel: 'nur TI-30' },
  kdw: { datum: '2027-01-19', zeit: '14:30', form: 'E-Assessment MC, 60 Minuten (30 % der Note)', punkte: 'Disposition 70 %, Abgabe 20.12.2026 um 23:55', hilfsmittel: '–' },
};

// „Prüfung am Freitag, 22. Januar um 09:00“
function pruefungsSatz(p) {
  const [, m, d] = p.datum.split('-').map(Number);
  return `Prüfung am ${WOCHENTAG_LANG[wochentag(p.datum)]}, ${d}. ${MONAT[m - 1]}${p.zeit ? ` um ${p.zeit}` : ''}`;
}

// Dateien eines Moduls für die drei Menüs: Theorie (eigene Notizen), Quiz (inkl. Probeprüfungen), Unterlagen (Programm, Fahrplan, Mindmap, PDFs)
const WICHTIG = [/^Semesterprogramm/i, /^Prüfungsfahrplan/i, /mindmap/i];
// Unterlagen-Ordner pro Modul (heissen anders als die Board-Spalten)
const UNTERLAGEN = {
  fa: ['Support/Unterlagen/Financial Accounting & Reporting', 'Support/Unterlagen/Rechnungswesen Aufholen', 'Support/Unterlagen/Vorkurs Financial Accounting'],
  ma: ['Support/Unterlagen/Angewandte Mathematik 1'],
  ob: ['Support/Unterlagen/Organisational Behaviour'],
  pom: ['Support/Unterlagen/Principles of Management'],
  kdw: ['Support/Unterlagen/Kritisches Denken & Wissenschaftliches Schreiben'],
};
const DOKUMENT = ['pdf', 'docx', 'doc', 'pptx', 'xlsx', 'md'];
function modulDateien(dateien, ordner, unterlagenOrdner) {
  const liste = [].concat(unterlagenOrdner || []);
  const drin = (d, o) => o && d.path.startsWith(o + '/');
  const theorie = [], quiz = [], wichtig = [], rest = [];
  for (const d of dateien) {
    const imModul = drin(d, ordner), imUnterlagen = liste.some((o) => drin(d, o));
    if (!imModul && !imUnterlagen) continue;
    const fm = d.fm || {};
    if (d.extension === 'md' && (fm.quiz === true || fm.probepruefung === true)) { quiz.push(d); continue; }
    const istWichtig = WICHTIG.some((r) => r.test(d.basename)) || !!fm['excalidraw-plugin'];
    if (istWichtig) { wichtig.push(d); continue; }
    if (d.extension === 'pdf' || (imUnterlagen && DOKUMENT.includes(d.extension))) { rest.push(d); continue; }
    if (d.extension === 'md' && imModul) theorie.push(d);
  }
  const abc = (a, b) => a.basename.localeCompare(b.basename, 'de');
  const rang = (d) => WICHTIG.findIndex((r) => r.test(d.basename));
  wichtig.sort((a, b) => ((rang(a) < 0 ? 9 : rang(a)) - (rang(b) < 0 ? 9 : rang(b))) || abc(a, b));
  return { theorie: theorie.sort(abc), quiz: quiz.sort((a, b) => (a.fm && a.fm.probepruefung ? 1 : 0) - (b.fm && b.fm.probepruefung ? 1 : 0) || abc(a, b)), unterlagen: [...wichtig, ...rest.sort(abc)] };
}

// Unterlagen-Menü in Gruppen . Die erste passende Regel gewinnt,
// innerhalb einer Gruppe natürliche Sortierung, damit Aufgabe und Lösung nebeneinander stehen.
const UNTERLAGEN_REGELN = [
  ['Vorkurs', (d) => /\/Vorkurs /i.test(d.path)],
  ['Aufholen', (d) => /\/Rechnungswesen Aufholen\//i.test(d.path)],
  ['Lernziele', (d) => /^Lernziele/i.test(d.basename)],
  ['Wichtig', (d) => /^Semesterprogramm|^Prüfungsfahrplan|mindmap|Information zur Modulschlussprüfung|Modulbeschreibung|Leistungsnachweise_Dossier/i.test(d.basename) || !!(d.fm && d.fm['excalidraw-plugin'])],
  ['Prüfungen & Tests', (d) => /FRWW|HS21|\bTest\b|Testserie|Lernkontrolle|Prüfungsfragen|Probeprüfung|Kontrollfragen|Repetition/i.test(d.basename)],
  ['Planspiel & Abgaben', (d) => /TOPSIM|Spielrunde|MgmtChallenge|Disposition|Verpflichtende Aktivit|Aufgabenliste|Teilnehmerhandbuch|Management_Essentials|Lernpunkte|Lern-Punkte|VA1|VA2|Team Charta/i.test(d.basename)],
  ['Praxisbeispiele', (d) => /Jahresrechnung|Geschäftsbericht|_GB\d|Report|Facebook|Straumann|Coop|Emmi|Inditex|Fallstudie|BaZ|Megatrend|Bilanz \d/i.test(d.basename)],
  ['Folien & Theorie', (d) => /folien|slide|^\d\d_PoM|theorie|skript|präsenz|vorbereitung|handout|reader|_A4|einführung|einfuehrung|einleitung|merkblatt|zusammenfassung|notizen|lernblatt/i.test(d.basename)],
  ['Übungen & Lösungen', (d) => /übung|uebung|aufgabe|arbeitsbl|lösung|loesung|beilage|case|selbsttest|activity|vorlage|^Rep\./i.test(d.basename)],
  ['Gesetze & Literatur', (d) => /^OR\b|obligationenrecht|ESTV|kontenrahmen|kontenplan|literatur|jahrbuch|thommen|presserat|zotero|wirtschaftsmathematik|[ _](19|20)\d{2}[ _]|\(\d{4}\)|^[A-ZÄÖÜ][\wäöü-]*(?:[ _&,]+[A-ZÄÖÜ][\wäöü-]*)* \d{4}[ _]/i.test(d.basename)],
];
const UNTERLAGEN_REIHE = ['Wichtig', 'Lernziele', 'Prüfungen & Tests', 'Folien & Theorie', 'Übungen & Lösungen', 'Planspiel & Abgaben', 'Praxisbeispiele', 'Gesetze & Literatur', 'Vorkurs', 'Aufholen', 'Weitere'];
function unterlagenGruppen(dateien) {
  const gruppen = new Map(UNTERLAGEN_REIHE.map((t) => [t, []]));
  for (const d of dateien) {
    const regel = UNTERLAGEN_REGELN.find(([, passt]) => passt(d));
    gruppen.get(regel ? regel[0] : 'Weitere').push(d);
  }
  const nat = (a, b) => a.basename.localeCompare(b.basename, 'de', { numeric: true, sensitivity: 'base' });
  // „Wichtig“ in fester Reihenfolge: Semesterprogramm, Fahrplan, Mindmap, Prüfungsinfo, Modulbeschreibung
  const RANG = [/^Semesterprogramm/i, /^Prüfungsfahrplan/i, /mindmap/i, /Information zur Modulschlussprüfung|Leistungsnachweise_Dossier/i, /Modulbeschreibung/i];
  const rang = (d) => { const i = RANG.findIndex((r) => r.test(d.basename)); return i < 0 ? RANG.length : i; };
  return UNTERLAGEN_REIHE.filter((t) => gruppen.get(t).length).map((t) => ({ titel: t,
    dateien: gruppen.get(t).sort(t === 'Wichtig' ? (a, b) => rang(a) - rang(b) || nat(a, b) : nat) }));
}

// Ergebnis der jüngsten Quizrunde einer Quizseite (aus lern-quiz/data.json)
function letzteRunde(quiz, pfad) {
  const r = quiz && quiz.quiz && quiz.quiz[pfad] && quiz.quiz[pfad].runden;
  if (!r || !r.length) return null;
  const l = [...r].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).pop();
  return { prozent: Math.round((l.p || 0) * 100), datum: l.d };
}

// Aufgaben der nächsten 7 Tage (überfällige zuerst); mit Fokus nur Plugin-Aufgaben
function naechsteSiebenMitRest(karten, heuteISO, fokus) {
  const bis = plusTage(heuteISO, 7);
  const { sichtbar, rest, zurueck } = tafelSpalte(karten.filter((k) => k.datum && k.datum <= bis), heuteISO, Infinity, fokus);
  return { karten: [...sichtbar, ...rest], zurueck };
}
const naechsteSieben = (karten, heuteISO, fokus) => naechsteSiebenMitRest(karten, heuteISO, fokus).karten;

// Modul-Schlüssel aus einem Frontmatter-Wert („Financial Accounting“, „mathe“, „fa“ …)
const modulAus = (wert) => (wert ? Object.keys(MODUL_SPALTEN).find((k) => k === wert || MODUL_SPALTEN[k] === wert || MODUL_INFO[k].name === wert || MODUL_INFO[k].modul === wert) || null : null);

// Erledigt-Streifen: Board-Reihenfolge (oben = zuletzt abgehakt), Modul aus dem Frontmatter der verlinkten Seite
function erledigtListe(erledigt, fm) {
  return erledigt.map((k) => { const f = k.link ? fm(k.link) : null; return { ...k, modul: f ? modulAus(f.modul) : null }; });
}

// Karte abhaken: Zeile aus ihrer Spalte nehmen und als „- [x]“ oben in „## Erledigt“ einfügen; null, wenn es die Zeile nicht (mehr) gibt
function hakeAb(boardText, zeile, heuteISO = null, spalte = null) {
  const z = boardText.split('\n');
  const ohneCR = (x) => x.replace(/\r$/, '');
  // In der eigenen Spalte suchen, damit ein gleichlautendes Duplikat anderswo stehen bleibt
  let i = -1;
  const sp = spalte ? z.findIndex((x) => x.trim() === `## ${spalte}`) : -1;
  if (sp >= 0) for (let j = sp + 1; j < z.length && !/^## /.test(z[j]); j++) if (z[j] === zeile) { i = j; break; }
  if (i < 0) i = z.indexOf(zeile);
  if (i < 0 || !/^- \[ \] /.test(ohneCR(zeile)) || !z.some((x) => x.trim() === '## Erledigt')) return null;
  // Eingerückte Zeilen direkt unter der Karte gehören zu ihr und wandern mit
  let n = 1;
  while (i + n < z.length && /^[ \t]+\S/.test(z[i + n])) n++;
  const block = z.splice(i, n);
  const cr = /\r$/.test(block[0]) ? '\r' : '';
  block[0] = ohneCR(block[0]).replace(/^- \[ \] /, '- [x] ') + (heuteISO ? ` ✅ ${heuteISO}` : '') + cr;
  const e = z.findIndex((x) => x.trim() === '## Erledigt');
  let ziel = e + 1;
  while (ziel < z.length && z[ziel].trim() === '') ziel++;
  if (ziel < z.length && /^- \[/.test(z[ziel])) {
    z.splice(ziel, 0, ...block);
  } else {
    // Erledigt ist leer: nach Überschrift und einer Leerzeile einfügen, danach eine Leerzeile lassen (z. B. vor den Kanban-Einstellungen)
    const pos = z[e + 1] !== undefined && z[e + 1].trim() === '' ? e + 2 : e + 1;
    if (pos === e + 1) block.unshift(cr);
    z.splice(pos, 0, ...block);
    const nach = pos + block.length;
    if (nach < z.length && z[nach].trim() !== '') z.splice(nach, 0, cr);
  }
  return z.join('\n');
}

// Etappe von heute: heute erledigte Lerneinheiten, dann fällige offene in Board-Reihenfolge; die erste offene ist „jetzt“
function etappeHeute(board, heuteISO) {
  const lernt = (k) => k.art === 'lerneinheit' || k.art === 'wiederholen';
  const fertig = (board.erledigt || []).filter((k) => lernt(k) && (k.erledigtAm || k.datum) === heuteISO)
    .map((k) => ({ text: k.text, link: k.link, modul: null, status: 'fertig', art: k.art }));
  const offen = [];
  for (const key of MODUL_KEYS) {
    for (const k of board[key] || []) if (lernt(k) && k.datum && k.datum <= heuteISO) offen.push({ text: k.text, link: k.link, modul: key, status: 'offen', art: k.art });
  }
  // Board-Reihenfolge der Spalten: wie im Kanban von links nach rechts (alphabetisch, übliche Anlage)
  offen.sort((a, b) => MODUL_SPALTEN[a.modul].localeCompare(MODUL_SPALTEN[b.modul], 'de'));
  if (offen.length) offen[0].status = 'jetzt';
  return [...fertig, ...offen];
}

function naechsteTodos(boardText, spalte, heuteISO, filter = null) {
  const out = [];
  for (const z of spaltenZeilen(boardText, spalte)) {
    const k = zerlegeKarte(z, heuteISO);
    if (!k || k.erledigt) continue;
    const karte = { text: k.text, link: k.link, datum: k.datum, ueberfaellig: k.ueberfaellig, wiederholen: k.wiederholen };
    if (!filter || filter(karte)) out.push(karte);
  }
  return out.map((k, i) => ({ k, i }))
    .sort((a, b) => (a.k.datum || '9999') < (b.k.datum || '9999') ? -1 : (a.k.datum || '9999') > (b.k.datum || '9999') ? 1 : a.i - b.i)
    .map((x) => x.k);
}

// Fällige Wiederholung als Karte in die Spalte (Einstellung „Spalte im Board“), sofern dort nicht schon offen.
// Link auf den Fahrplan (nie auf die alte Seite), #wiederholen färbt sie orange; die Routine ersetzt sie durch eine neue Einheit.
// Wann die Routine die Einheit baut – sonst landet man auf dem Fahrplan und weiss nicht weiter.
// Seit 14.11. morgens + mittags statt 18:30 (Lernen tagsüber). Bei Cron-Änderung mitziehen.
const ROUTINE_UHREN = ['06:30', '12:30'];
const folgtHinweis = (jetzt = new Date()) => {
  const min = jetzt.getHours() * 60 + jetzt.getMinutes();
  const naechste = ROUTINE_UHREN.find(u => { const [hh, mm] = u.split(':').map(Number); return min < hh * 60 + mm; });
  return naechste ? `Übung kommt heute ab ${naechste}` : `Übung kommt morgen ab ${ROUTINE_UHREN[0]}`;
};
const folgtNotice = (text, jetzt) => `„${text}“: Dafür gibt es noch keine Übung. ${folgtHinweis(jetzt)}. Sofort üben? Bitte Claude, die Einheit jetzt zu bauen.`;
const wiederKarte = (thema, ziel, datum) => `- [ ] [[${ziel}|Wiederholen: ${thema}]] #wiederholen @{${datum}}`;
function setzeWiederholung(boardText, thema, datum, ziel = FAHRPLAN_NAME, spalte = CFG.spalte) {
  const offen = boardText.split('## Erledigt')[0].split('\n');
  if (offen.some((z) => z.startsWith('- [ ] ') && z.includes(`|Wiederholen: ${thema}]]`))) {
    return { text: boardText, neu: false };
  }
  const zeilen = boardText.split('\n');
  const nr = zeilen.findIndex((z) => z.trim() === `## ${spalte}`);
  if (nr < 0) return { text: boardText, neu: false };
  let i = nr + 1;
  while (i < zeilen.length && zeilen[i].trim() === '') i++;
  zeilen.splice(i, 0, wiederKarte(thema, ziel, datum));
  return { text: zeilen.join('\n'), neu: true };
}

// ── Spick (Mathe) ── (rein) Ein A4, Vorder- und Rückseite, jedes Thema auf festem Platz
// Grenze: ein handgeschriebener Spick hatte 3383 Zeichen auf einer Seite und war handschriftlich gerade noch machbar
const SPICK_MAX_ZEICHEN = 3400;
const SPICK_FRIEREN = '2026-12-29';
const spickZeichen = (f) => (String(f.titel || '') + String(f.inhalt || '')).replace(/\$|\*\*/g, '').length;
const platz = (f) => `${f.seite}/${f.spalte}/${f.reihe}`;

function pruefeSpick(obj) {
  const nein = (fehler) => ({ ok: false, fehler });
  if (!obj || !Array.isArray(obj.felder) || !obj.felder.length) return nein('Feld „felder“ fehlt oder ist leer.');
  const ids = new Set(), plaetze = new Map(), zeichen = { 1: 0, 2: 0 };
  for (const f of obj.felder) {
    if (!f || !f.id || !f.titel) return nein('Jedes Feld braucht „id“ und „titel“.');
    if (ids.has(f.id)) return nein(`Feld „${f.id}“ kommt doppelt vor.`);
    ids.add(f.id);
    if (![1, 2].includes(f.seite) || ![0, 1, 2].includes(f.spalte) || !(Number.isInteger(f.reihe) && f.reihe >= 1)) {
      return nein(`Feld „${f.id}“: seite muss 1 oder 2 sein, spalte 0 (ganze Breite), 1 oder 2, reihe ab 1.`);
    }
    if (plaetze.has(platz(f))) return nein(`Platz Seite ${f.seite}, Spalte ${f.spalte}, Reihe ${f.reihe} ist doppelt belegt („${plaetze.get(platz(f))}“ und „${f.id}“).`);
    plaetze.set(platz(f), f.id);
    zeichen[f.seite] += spickZeichen(f);
  }
  for (const s of [1, 2]) {
    if (zeichen[s] > SPICK_MAX_ZEICHEN) return nein(`Seite ${s} hat ${zeichen[s]} Zeichen, erlaubt sind ${SPICK_MAX_ZEICHEN} – sonst passt sie nicht handschriftlich auf ein A4.`);
  }
  const felder = [...obj.felder].sort((a, b) => a.seite - b.seite || a.spalte - b.spalte || a.reihe - b.reihe);
  return { ok: true, spick: { ...obj, stand: isoTag(obj.stand), version: Number(obj.version) || 1, felder, zeichen } };
}

function spickAenderungen(alt, neu) {
  const a = new Map(alt.felder.map((f) => [f.id, f]));
  const n = new Map(neu.felder.map((f) => [f.id, f]));
  const out = [];
  for (const [id, f] of n) {
    const v = a.get(id);
    if (!v) out.push({ id, art: 'neu', vorher: null, nachher: f, platzGeaendert: false });
    else if (v.inhalt !== f.inhalt || v.titel !== f.titel || platz(v) !== platz(f)) {
      out.push({ id, art: 'geaendert', vorher: v, nachher: f, platzGeaendert: platz(v) !== platz(f) });
    }
  }
  for (const [id, v] of a) if (!n.has(id)) out.push({ id, art: 'entfernt', vorher: v, nachher: null, platzGeaendert: false });
  return out;
}

function uebernimmVorschlag(alt, neu, heuteISO, frieren = SPICK_FRIEREN) {
  if (heuteISO >= frieren) return { ok: false, fehler: `Der Spick ist seit ${frieren} eingefroren.` };
  const r = pruefeSpick(neu);
  if (!r.ok) return r;
  const wechsel = spickAenderungen(alt, neu).filter((x) => x.platzGeaendert);
  if (wechsel.length) return { ok: false, fehler: `Feste Plätze: ${wechsel.map((x) => x.id).join(', ')} würde den Platz wechseln.` };
  const { gruende, ...rest } = r.spick;
  return { ok: true, spick: { ...rest, version: (Number(alt.version) || 1) + 1, stand: heuteISO } };
}

// Übernehmen in sicherer Reihenfolge: erst drucken (2 Seiten?), nur dann Seite, PDF und Vorschlag anfassen
async function uebernahmeAblauf({ drucke, schreibeBlock, schreibePdf, entferneVorschlag }) {
  let pdf;
  try { pdf = await drucke(); } catch (err) { return { ok: false, fehler: err.message }; }
  await schreibeBlock();
  await schreibePdf(pdf);
  await entferneVorschlag();
  return { ok: true };
}
const istVorschlagSeite = (pfad, spickSeite) => String(pfad).split('/').pop().replace(/\.md$/, '') === `${spickSeite} – Vorschlag`;
const pdfSeiten = (daten) => (daten && daten.length ? (daten.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length : 0);

// Selbständiges HTML für den PDF-Druck: zwei A4-Seiten mit zwei Spalten; render(tex, display) wandelt Formeln
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function spickText(text, render) {
  const formeln = [];
  let t = String(text || '');
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => { formeln.push(render(x.trim(), true)); return `\u0000${formeln.length - 1}\u0000`; });
  t = t.replace(/\$([^$\n]+?)\$/g, (_, x) => { formeln.push(render(x.trim(), false)); return `\u0000${formeln.length - 1}\u0000`; });
  t = escHtml(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/==([^\n]+?)==/g, '<mark>$1</mark>')
    .replace(/!!([^!]+)!!/g, '<span class="rot">$1</span>')
    .split('\n').map((z) => (/^\s*[-•]\s+/.test(z) ? '• ' + z.replace(/^\s*[-•]\s+/, '') : z)).join('<br>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => formeln[Number(i)]);
}
// Stil eines handgeschriebenen Spicks: Handschrift-Schrift (Handschrift), Karopapier, blaue Tinte,
// Titel unterstrichen, ==grün markiert==, !!rot für Warnungen!!; spalte 0 = Feld über beide Spalten
function spickHtml(spick, render = (tex) => escHtml(tex), schriftBase64 = null) {
  const felder = [...spick.felder].sort((a, b) => a.seite - b.seite || a.spalte - b.spalte || a.reihe - b.reihe);
  const feldHtml = (f) => `<div class="feld" data-id="${escHtml(f.id)}"><div class="titel">${escHtml(f.titel)}</div><div class="inhalt">${spickText(f.inhalt, render)}</div></div>`;
  const seite = (n) => `<div class="breit">${felder.filter((f) => f.seite === n && f.spalte === 0).map(feldHtml).join('')}</div>`
    + `<div class="spalten">${[1, 2].map((sp) => `<div class="spalte">${felder.filter((f) => f.seite === n && f.spalte === sp).map(feldHtml).join('')}</div>`).join('')}</div>`;
  const schrift = schriftBase64
    ? `@font-face { font-family: "Handschrift"; src: url(data:font/ttf;base64,${schriftBase64}) format("truetype"); }
` : '';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Spick Mathematik v${spick.version || 1}</title><style>
${schrift}@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 11.5pt/1.25 "Handschrift", "Segoe Print", "Comic Sans MS", cursive; color: #1d2f6f; }
.seite { width: 194mm; page-break-after: always; padding: 1mm 2mm;
  background-image: linear-gradient(#cdd9ee 0.2mm, transparent 0.2mm), linear-gradient(90deg, #cdd9ee 0.2mm, transparent 0.2mm);
  background-size: 5mm 5mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.seite:last-child { page-break-after: auto; }
.breit { border-bottom: 0.5mm solid #1d2f6f; margin-bottom: 2mm; }
.spalten { display: grid; grid-template-columns: 1fr 1fr; gap: 0 5mm; }
.spalte + .spalte { border-left: 0.5mm solid #1d2f6f; padding-left: 4mm; }
.feld { padding-bottom: 1.5mm; margin-bottom: 2mm; border-bottom: 0.4mm solid #1d2f6f; break-inside: avoid; }
.titel { display: inline-block; font-size: 17pt; line-height: 1.1; color: #1a2a5e; border-bottom: 0.4mm solid #1a2a5e; margin-bottom: 1mm; }
mark { background: #b7ec9c; color: inherit; padding: 0 0.5mm; }
.rot { color: #d0312d; }
b { font-weight: normal; color: #0f1c48; text-decoration: underline; }
mjx-container, svg { vertical-align: middle; max-width: 100%; color: inherit; }
</style></head><body><section class="seite">${seite(1)}</section><section class="seite">${seite(2)}</section></body></html>`;
}

// ── Oberfläche ──
// Pfade und Namen sind in den Plugin-Einstellungen änderbar; das hier sind die Standardwerte
const STANDARD = {
  board: "To Do's.md",
  spalte: 'Financial Accounting',
  fortschritt: 'Support/Fortschritt Rechnungswesen.md',
  kontenplanPdf: 'Information zur Modulschlussprüfung.pdf',
  matheFortschritt: 'Support/Fortschritt Mathematik.md',
  matheFahrplan: 'Prüfungsfahrplan Mathematik',
  matheSpalte: 'Angewandte Mathematik 1',
  spickPdf: 'Spick Mathematik.pdf',
  spickSeite: 'Spick Mathematik',
  rechner: 'TI-30X Plus',
  matheBonus: 0,
  startseite: true,
  leisteZu: true,
  wochenzielMin: 360,
  name: '',
};
const RECHNER = ['TI-30X Plus', 'TI-30X Pro'];
const CFG = { ...STANDARD };
const FAHRPLAN_NAME = 'Prüfungsfahrplan';
// Probeprüfung freigeschaltet: FA behält den alten Schlüssel
const freiSchluessel = (modul) => (modul === 'mathe' ? 'freigeschaltet_mathe' : 'freigeschaltet');

// Was je Modul anders ist: Notizen, Board-Spalte, Beilage-PDF, Punkte der Prüfung
// Neue Module (Teil 3): Fahrplan-Seite, Board-Spalte, Prüfungspunkte; Können kommt aus Quiz und Meilensteinen
const NEUE_MODULE = {
  ob: { fahrplan: 'Prüfungsfahrplan OB', spalte: 'Organisational Behaviour', maxPunkte: 60, fortschritt: 'Support/Fortschritt OB.md' },
  pom: { fahrplan: 'Prüfungsfahrplan PoM', spalte: 'Principles of Management', maxPunkte: 100, fortschritt: 'Support/Fortschritt PoM.md' },
  kdw: { fahrplan: 'Prüfungsfahrplan KDW', spalte: 'Kritisches Denken', maxPunkte: 100, fortschritt: 'Support/Fortschritt KDW.md' },
};
function cfgFuer(modul = 'fa') {
  if (NEUE_MODULE[modul]) {
    const n = NEUE_MODULE[modul];
    return { fortschritt: n.fortschritt, fahrplan: n.fahrplan, spalte: n.spalte, beilagePdf: '', beilageText: '', beilageSeite: '', maxPunkte: n.maxPunkte, bonus: 0, quizOrdner: `Module/${n.spalte}`, quizDeckel: QUIZ_DECKEL };
  }
  if (modul === 'mathe') {
    return { fortschritt: CFG.matheFortschritt, fahrplan: CFG.matheFahrplan, spalte: CFG.matheSpalte,
      beilagePdf: CFG.spickPdf, beilageText: 'Spick', beilageSeite: '', maxPunkte: 60, bonus: Number(CFG.matheBonus) || 0,
      quizOrdner: 'Module/Angewandte Mathematik 1', quizDeckel: QUIZ_DECKEL_RECHNEN };
  }
  return { fortschritt: CFG.fortschritt, fahrplan: FAHRPLAN_NAME, spalte: CFG.spalte,
    beilagePdf: CFG.kontenplanPdf, beilageText: 'Kontenplan', beilageSeite: '#page=3', maxPunkte: 90, bonus: 0,
    quizOrdner: 'Module/Financial Accounting', quizDeckel: QUIZ_DECKEL_RECHNEN };
}
const PULS_MS = 30_000;
const PAUSE_MS = 60_000;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const uhr = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const heute = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD in Ortszeit
const betrag = (n) => Number(n).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

class EinheitAnsicht extends obsidian.MarkdownRenderChild {
  constructor(el, plugin, einheit, sourcePath) {
    super(el);
    this.plugin = plugin;
    this.e = einheit;
    this.pfad = sourcePath;
    // „Einschätzen“ ist immer der letzte Schritt
    this.pruefung = einheit.modus === 'pruefung';
    this.schritte = [...einheit.schritte, this.pruefung
      ? { art: 'abgabe', titel: 'Abgabe & Ergebnis' }
      : { art: 'einschaetzen', titel: 'Einschätzen' }];
  }

  get z() { return this.plugin.zustand(this.e.id, this.pfad, this.schritte.length); }
  setze(z) {
    this.plugin.daten.einheiten[this.e.id] = z;
    this.plugin.speichere();
    // Ist dieselbe Einheit in einem zweiten Tab offen, zeigt der sonst einen veralteten Stand
    for (const a of this.plugin.aktive) if (a !== this && a.e.id === this.e.id) a.baue();
  }

  onload() {
    this.plugin.aktive.add(this);
    this.root = h('div', 'fle');
    this.containerEl.empty();
    this.containerEl.appendChild(this.root);
    this.baue();
    this.registerInterval(window.setInterval(() => this.tick(), 1000));
  }

  onunload() {
    this.plugin.aktive.delete(this);
    // Wird die Seite nur neu gerendert, lebt gleich wieder eine Ansicht derselben Einheit
    window.setTimeout(() => this.plugin.stoppeVerwaiste(this.e.id), 400);
  }

  laufendeSekunden(i) {
    const z = this.z;
    let s = z.sekunden[i] || 0;
    if (z.laeuft && z.laeuft.schritt === i) s += Math.min(MAX_LAUF_S, Math.round((Date.now() - z.laeuft.seit) / 1000));
    return s;
  }

  tick() {
    const z = this.z;
    // Probeprüfung: Countdown, bei 0 wird automatisch abgegeben
    if (this.pruefung && z.pruefStart != null && !z.abgegeben) {
      const rest = restSekunden(z, this.e.dauer, Date.now());
      if (this.uhrEl) { this.uhrEl.textContent = uhr(rest); this.uhrEl.classList.toggle('is-knapp', rest <= 600); }
      if (rest <= 0) { this.gibAb(); return; }
    }
    if (!z.laeuft) return;
    const jetzt = Date.now();
    const pausiert = nachPause(z, jetzt, PAUSE_MS);
    if (pausiert !== z) { this.setze(pausiert); this.baue(); return; }
    // Puls jede Sekunde im Speicher, auf die Platte nur alle 30 s
    z.laeuft.puls = jetzt;
    if (!this.plugin.letztesSpeichern || jetzt - this.plugin.letztesSpeichern > PULS_MS) {
      this.plugin.letztesSpeichern = jetzt;
      this.plugin.speichere();
    }
    const gesamt = this.schritte.reduce((a, _, i) => a + this.laufendeSekunden(i), 0);
    if (this.uhrEl && !this.pruefung) this.uhrEl.textContent = uhr(gesamt);
    const zeit = this.zeitEls && this.zeitEls[z.laeuft.schritt];
    if (zeit) zeit.textContent = this.zeitText(z.laeuft.schritt);
  }

  zeitText(i) {
    const s = this.schritte[i];
    const m = Math.floor(this.laufendeSekunden(i) / 60);
    return s.soll ? `${m} / ${s.soll} min` : `${m} min`;
  }

  geheZu(i) {
    let z = { ...this.z, schritt: i };
    if (z.laeuft) z = starte(z, i, Date.now());
    this.setze(z);
    this.baue();
  }

  // Wer tippt oder weitergeht, arbeitet: Timer starten, falls er noch nicht läuft
  autoStart() {
    const z = this.z;
    if (z.laeuft || z.einschaetzung) return;
    this.plugin.daten.einheiten[this.e.id] = starte(z, z.schritt || 0, Date.now());
    this.plugin.speichere();
    const knopf = this.root.querySelector('.fle-timer');
    if (knopf) { knopf.classList.add('is-laeuft'); obsidian.setIcon(knopf.querySelector('button'), 'pause'); }
  }

  umschalten() {
    const z = this.z;
    this.setze(z.laeuft ? stoppeLaufenden(z, Date.now()) : starte(z, z.schritt, Date.now()));
    this.baue();
  }

  baue() {
    const z = this.z;
    const aktiv = Math.min(z.schritt || 0, this.schritte.length - 1);
    this.root.empty();
    if (this.pruefung && !this.plugin.daten[freiSchluessel(this.e.modul)]) { this.baueGesperrt(); return; }
    if (this.pruefung && z.pruefStart == null) { this.baueStart(); return; }
    const kopf = this.root.appendChild(h('div', 'fle-kopf'));
    kopf.appendChild(h('div', 'fle-thema', this.e.thema));
    if (this.e.stoff) kopf.appendChild(h('div', 'fle-stoff', this.e.stoff));

    const rahmen = this.root.appendChild(h('div', 'fle-rahmen'));
    const spalte = rahmen.appendChild(h('nav', 'fle-spalte'));
    const haupt = rahmen.appendChild(h('div', 'fle-haupt'));

    // Timer (Probeprüfung: Countdown ohne Pause)
    if (this.pruefung) {
      const timer = spalte.appendChild(h('div', 'fle-timer fle-countdown' + (z.abgegeben ? '' : ' is-laeuft')));
      const rest = restSekunden(z, this.e.dauer, z.abgegeben || Date.now());
      this.uhrEl = timer.appendChild(h('span', 'fle-uhr' + (rest <= 600 && !z.abgegeben ? ' is-knapp' : ''), z.abgegeben ? 'abgegeben' : uhr(rest)));
    }
    const timer = this.pruefung ? h('div') : spalte.appendChild(h('div', 'fle-timer' + (z.laeuft ? ' is-laeuft' : '')));
    if (!this.pruefung) this.uhrEl = timer.appendChild(h('span', 'fle-uhr', uhr(this.schritte.reduce((a, _, i) => a + this.laufendeSekunden(i), 0))));
    const knopf = timer.appendChild(h('button', 'fle-btn fle-btn-rund'));
    knopf.setAttribute('aria-label', z.laeuft ? 'Timer pausieren' : 'Timer starten');
    obsidian.setIcon(knopf, z.laeuft ? 'pause' : 'play');
    knopf.onclick = () => this.umschalten();

    // Schrittliste
    this.zeitEls = [];
    const liste = spalte.appendChild(h('ol', 'fle-liste'));
    this.schritte.forEach((s, i) => {
      const fertig = (z.fertig || []).includes(i) || (s.art === 'einschaetzen' && z.einschaetzung) || (s.art === 'abgabe' && z.abgegeben);
      const li = liste.appendChild(h('li'));
      const b = li.appendChild(h('button', 'fle-schritt' + (i === aktiv ? ' is-aktiv' : '') + (fertig ? ' is-fertig' : '')));
      if (i === aktiv) b.setAttribute('aria-current', 'step');
      const ikon = b.appendChild(h('span', 'fle-status'));
      obsidian.setIcon(ikon, fertig ? 'check' : i === aktiv ? 'circle-dot' : 'circle');
      const txt = b.appendChild(h('span', 'fle-schritt-txt'));
      txt.appendChild(h('span', 'fle-schritt-titel', s.titel));
      const punkte = (s.faelle || []).reduce((a, f) => a + (f.punkte || 0), 0);
      const nebentext = s.art === 'einschaetzen' ? (z.einschaetzung || '')
        : s.art === 'abgabe' ? (z.ergebnis ? `Note ${String(z.ergebnis.note).replace('.', ',')}` : '')
        : this.pruefung ? `${punkte} P · ${s.soll} min` : this.zeitText(i);
      this.zeitEls[i] = txt.appendChild(h('span', 'fle-schritt-zeit', nebentext));
      b.onclick = () => this.geheZu(i);
    });

    // Aktueller Schritt
    const s = this.schritte[aktiv];
    const karte = haupt.appendChild(h('div', 'fle-karte'));
    const zeile = karte.appendChild(h('div', 'fle-karte-kopf'));
    zeile.appendChild(h('h3', 'fle-titel', s.titel));
    if ((s.art === 'aufwaermen' || s.art === 'aufgabe') && cfgFuer(this.e.modul).beilageText) {
      const c = cfgFuer(this.e.modul);
      const k = zeile.appendChild(h('button', 'fle-btn fle-btn-leise', c.beilageText));
      k.setAttribute('aria-label', `${c.beilageText} rechts daneben öffnen`);
      k.onclick = () => this.oeffneBeilage();
    }
    const inhalt = karte.appendChild(h('div', 'fle-inhalt'));
    if (s.art === 'theorie') this.baueTheorie(inhalt, s);
    else if (s.art === 'einschaetzen') this.baueEinschaetzen(inhalt);
    else if (s.art === 'abgabe') this.baueAbgabe(inhalt);
    else this.baueFaelle(inhalt, s, aktiv);

    // Navigation
    const nav = karte.appendChild(h('div', 'fle-nav'));
    if (aktiv > 0) {
      const zur = nav.appendChild(h('button', 'fle-btn', '← Zurück'));
      zur.onclick = () => this.geheZu(aktiv - 1);
    }
    nav.appendChild(h('span', 'fle-luecke'));
    if (aktiv < this.schritte.length - 1) {
      const w = nav.appendChild(h('button', 'fle-btn mod-cta', 'Weiter →'));
      w.onclick = () => {
        this.autoStart();
        const fertig = new Set(this.z.fertig || []); fertig.add(aktiv);
        this.setze({ ...this.z, fertig: [...fertig] });
        this.geheZu(aktiv + 1);
      };
    }
  }

  md(el, text) {
    obsidian.MarkdownRenderer.render(this.plugin.app, String(text), el, this.pfad, this);
  }

  baueVideo(el, s) {
    if (this.e.modul && this.e.modul !== 'fa') return;
    const liste = videosFuer(this.e.thema, s);
    if (!liste.length) return;
    const box = el.appendChild(h('section', 'fle-video'));
    const kopf = box.appendChild(h('div', 'fle-video-kopf'));
    kopf.appendChild(h('b', '', 'Zuerst das Erklärvideo'));
    const titel = kopf.appendChild(h('span', 'fle-video-titel'));
    const rahmen = box.appendChild(h('div', 'fle-video-rahmen'));
    const fusszeile = box.appendChild(h('div', 'fle-video-liste'));
    const knoepfe = [];
    const zeige = (v) => {
      rahmen.empty();
      const f = rahmen.appendChild(document.createElement('iframe'));
      f.src = `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1`;
      f.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      titel.setText(v.titel);
      knoepfe.forEach((b) => b.toggleClass('is-aktiv', b.dataset.id === v.id));
      oeffnen.href = `https://www.youtube.com/watch?v=${v.id}`;
    };
    if (liste.length > 1) for (const v of liste) {
      const b = fusszeile.appendChild(h('button', 'fle-video-chip', v.titel));
      b.dataset.id = v.id; b.onclick = () => zeige(v); knoepfe.push(b);
    }
    const oeffnen = box.appendChild(h('a', 'fle-video-link', 'Auf YouTube öffnen ↗'));
    oeffnen.setAttribute('target', '_blank');
    zeige(liste[0]);
  }

  baueTheorie(el, s) {
    this.baueVideo(el, s);
    if (s.notiz) {
      const [datei, ...rest] = String(s.notiz).split('#');
      const ueberschrift = rest.join('#').trim();
      const f = this.plugin.app.metadataCache.getFirstLinkpathDest(datei.trim(), this.pfad);
      const kopf = f && (this.plugin.app.metadataCache.getFileCache(f) || {}).headings;
      const da = f && (!ueberschrift || (kopf || []).some((k) => k.heading.trim() === ueberschrift));
      if (da) this.md(el.appendChild(h('div', 'fle-notiz')), `![[${s.notiz}]]`);
      else el.appendChild(h('div', 'fle-hinweis', `Abschnitt nicht gefunden: ${s.notiz}`));
    }
    if (s.text) this.md(el.appendChild(h('div', 'fle-md')), s.text);
  }

  baueFaelle(el, s, si) {
    if (s.einleitung) this.md(el.appendChild(h('div', 'fle-md fle-einleitung')), s.einleitung);
    for (const fall of s.faelle) {
      const key = `${si}.${fall.id}`;
      const box = el.appendChild(h('section', 'fle-fall'));
      const kopf = box.appendChild(h('div', 'fle-fall-kopf'));
      kopf.appendChild(h('span', 'fle-fall-id', `${fall.id})`));
      if (this.pruefung) kopf.appendChild(h('span', 'fle-fall-punkte', `${fall.punkte} P`));
      this.md(kopf.appendChild(h('div', 'fle-md')), fall.text);

      const z = this.z;
      if (fall.art === 'antwort') { this.baueAntwort(box, fall, key); continue; }
      if (fall.art === 'zahl') { this.baueZahl(box, fall, key); continue; }
      const zeilen = z.eingaben[key] || Array.from({ length: fall.zeilen }, () => ['', '', '']);
      const tab = box.appendChild(h('table', 'fle-tabelle'));
      const tr0 = tab.appendChild(h('thead')).appendChild(h('tr'));
      for (const t of ['Soll', 'Haben', 'Betrag']) tr0.appendChild(h('th', null, t));
      const tbody = tab.appendChild(h('tbody'));
      const merke = () => { this.autoStart(); this.merkeStart(key); this.z.eingaben[key] = zeilen; this.plugin.speichere(); };
      const zeileBauen = (r) => {
        const tr = tbody.appendChild(h('tr'));
        r.forEach((wert, c) => {
          const inp = tr.appendChild(h('td')).appendChild(h('input', 'fle-eingabe' + (c === 2 ? ' is-betrag' : '')));
          inp.value = wert;
          inp.setAttribute('aria-label', ['Soll', 'Haben', 'Betrag'][c]);
          if (c < 2) inp.setAttribute('list', 'fle-konten');
          else inp.inputMode = 'decimal';
          inp.oninput = () => { r[c] = inp.value; merke(); };
        });
      };
      zeilen.forEach(zeileBauen);
      const aktionen = box.appendChild(h('div', 'fle-aktionen'));
      const plus = aktionen.appendChild(h('button', 'fle-btn fle-btn-leise', '+ Zeile'));
      plus.onclick = () => { const r = ['', '', '']; zeilen.push(r); zeileBauen(r); merke(); };

      const offen = z.aufgedeckt.includes(key);
      const loes = box.appendChild(h('div', 'fle-loesung'));
      if (!offen && this.pruefung) {
        // Probeprüfung: Lösungen erst nach der Abgabe
      } else if (!offen) {
        const b = aktionen.appendChild(h('button', 'fle-btn', 'Lösung zeigen'));
        b.onclick = () => this.deckeAuf(key, bewerteBuchung(zeilen, fall.loesung));
      } else {
        this.zeigeErgebnis(loes, key);
        loes.appendChild(h('div', 'fle-label', 'Lösung'));
        if (!fall.loesung.length) loes.appendChild(h('div', 'fle-md', 'Keine Buchung nötig.'));
        else {
          const lt = loes.appendChild(h('table', 'fle-tabelle is-loesung'));
          const hr = lt.appendChild(h('thead')).appendChild(h('tr'));
          for (const t of ['Soll', 'Haben', 'Betrag']) hr.appendChild(h('th', null, t));
          const lb = lt.appendChild(h('tbody'));
          for (const [so, ha, be] of fall.loesung) {
            const tr = lb.appendChild(h('tr'));
            tr.appendChild(h('td', null, so)); tr.appendChild(h('td', null, ha));
            tr.appendChild(h('td', 'is-betrag', typeof be === 'number' ? betrag(be) : String(be)));
          }
        }
        if (fall.warum) this.md(loes.appendChild(h('div', 'fle-md fle-warum')), fall.warum);
      }
    }
    if (this.e.modul === 'mathe') return;
    // Vorschläge für die Kontofelder, einmal pro Ansicht
    const dl = el.appendChild(h('datalist'));
    dl.id = 'fle-konten';
    for (const k of [...KONTENPLAN.bilanz, ...KONTENPLAN.erfolg]) dl.appendChild(h('option')).value = k;
  }

  // Rechen- oder Textfrage: eigenes Textfeld, beim Aufdecken die Musterantwort
  baueAntwort(box, fall, key) {
    const feld = box.appendChild(h('textarea', 'fle-eingabe fle-text'));
    feld.rows = 3;
    feld.setAttribute('aria-label', `Antwort ${fall.id}`);
    feld.value = (this.z.eingaben[key] || [['']])[0][0];
    feld.oninput = () => { this.autoStart(); this.merkeStart(key); this.z.eingaben[key] = [[feld.value]]; this.plugin.speichere(); };
    const loes = box.appendChild(h('div', 'fle-loesung'));
    if (!this.z.aufgedeckt.includes(key) && this.pruefung) return;
    if (!this.z.aufgedeckt.includes(key)) {
      const b = loes.appendChild(h('button', 'fle-btn', 'Lösung zeigen'));
      // Ohne eigene Antwort aufgedeckt = falsch; sonst bewertest du selbst, sobald du die Lösung siehst
      b.onclick = () => this.deckeAuf(key, feld.value.trim() ? null : 0);
      return;
    }
    this.zeigeErgebnis(loes, key);
    loes.appendChild(h('div', 'fle-label', 'Lösung'));
    this.md(loes.appendChild(h('div', 'fle-md')), fall.antwort);
    if (fall.warum) this.md(loes.appendChild(h('div', 'fle-md fle-warum')), fall.warum);
    const fest = (this.z.ergebnisse || {})[key];
    if (!fest || fest.wert == null) {
      loes.appendChild(h('div', 'fle-label', 'Stimmt deine Antwort? Sei ehrlich – das zählt für die Wiederholung.'));
      const reihe = loes.appendChild(h('div', 'fle-wahl'));
      for (const [text, w] of [['richtig', 1], ['teilweise', 0.5], ['falsch', 0]]) {
        const b = reihe.appendChild(h('button', 'fle-btn', text));
        b.onclick = () => this.bewerteSelbst(key, w);
      }
    }
  }

  // Mathe: ein Zahlenfeld, Tipps in zwei Stufen, dann Lösung mit Weg und Tastenweg; Spick-Vermerke
  baueZahl(box, fall, key) {
    const z = this.z;
    const menge = Array.isArray(fall.zahl);
    const zeile = box.appendChild(h('div', 'fle-zahl'));
    const feld = zeile.appendChild(h('input', 'fle-eingabe fle-zahl-feld'));
    feld.inputMode = 'decimal';
    feld.setAttribute('aria-label', `Antwort ${fall.id}`);
    if (menge) feld.placeholder = 'mehrere Werte mit ; trennen';
    feld.value = ((z.eingaben[key] || [['']])[0] || [''])[0];
    if (fall.einheit) zeile.appendChild(h('span', 'fle-zahl-einheit', fall.einheit));
    const offen = z.aufgedeckt.includes(key);
    // Zeigt beim Tippen, was das Plugin liest – damit „x = 3“ oder „±3“ nicht still als falsch zählt
    const gelesen = box.appendChild(h('div', 'fle-leise fle-gelesen'));
    const zeigeGelesen = () => {
      const werte = menge ? leseZahlen(feld.value) : [leseZahl(feld.value)].filter((x) => x !== null);
      gelesen.textContent = !feld.value.trim() ? '' : werte.length ? `gelesen als: ${werte.map((x) => betrag(x)).join('; ')}` : 'nicht lesbar – bitte nur Zahlen';
      gelesen.classList.toggle('is-fehler', !!feld.value.trim() && !werte.length);
      return werte.length > 0;
    };
    zeigeGelesen();
    feld.oninput = () => { this.autoStart(); this.merkeStart(key); this.z.eingaben[key] = [[feld.value]]; this.plugin.speichere(); zeigeGelesen(); };
    const opt = { runden: fall.runden, prozent: fall.prozent };
    const bewerte = () => (menge ? pruefeMenge(feld.value, fall.zahl, opt) : pruefeZahl(feld.value, fall.zahl, opt));

    if (this.pruefung && !offen) return;   // Probeprüfung: keine Tipps, Lösung erst nach Abgabe
    const stufe = (z.hilfe || {})[key] || 0;
    const tipps = box.appendChild(h('div', 'fle-tipps'));
    (fall.hilfe || []).slice(0, stufe).forEach((t, i) => {
      const b = tipps.appendChild(h('div', 'fle-tipp'));
      b.appendChild(h('span', 'fle-label', i === 0 ? 'Tipp 1 · Situation' : 'Tipp 2 · Spick'));
      this.md(b.appendChild(h('div', 'fle-md')), t);
    });
    const aktionen = box.appendChild(h('div', 'fle-aktionen'));
    if (!offen) {
      if (!this.pruefung && stufe < Math.min(2, (fall.hilfe || []).length)) {
        const tb = aktionen.appendChild(h('button', 'fle-btn fle-btn-leise', stufe === 0 ? 'Tipp: Was für eine Situation?' : 'Tipp: Welcher Spick-Abschnitt?'));
        tb.onclick = () => { this.autoStart(); this.merkeStart(key); this.setze({ ...this.z, hilfe: { ...(this.z.hilfe || {}), [key]: stufe + 1 } }); this.baue(); };
      }
      const lb = aktionen.appendChild(h('button', 'fle-btn', 'Lösung zeigen'));
      lb.onclick = () => {
        if (feld.value.trim() && !zeigeGelesen()) { new obsidian.Notice('Deine Antwort ist nicht lesbar – schreib nur Zahlen (mehrere mit ;), dann nochmals.'); feld.focus(); return; }
        this.deckeAuf(key, feld.value.trim() ? bewerte() : 0);
      };
    } else {
      const loes = box.appendChild(h('div', 'fle-loesung'));
      this.zeigeErgebnis(loes, key);
      const e = (this.z.ergebnisse || {})[key] || {};
      if (!this.pruefung) loes.appendChild(h('div', 'fle-leise fle-allein', e.leer ? 'Lösung ohne eigene Antwort angesehen' : e.hilfe ? `mit Hilfe (Tipp ${e.hilfe})` : 'allein gelöst'));
      loes.appendChild(h('div', 'fle-label', 'Lösung'));
      const zahlText = (menge ? fall.zahl : [fall.zahl]).map((x) => betrag(x)).join('; ');
      loes.appendChild(h('div', 'fle-zahl-loesung', `${zahlText}${fall.einheit ? ' ' + fall.einheit : ''}${fall.prozent ? ' %' : ''}`));
      if (Array.isArray(fall.weg) && fall.weg.length) {
        loes.appendChild(h('div', 'fle-label', 'Lösungsweg'));
        const ol = loes.appendChild(h('ol', 'fle-weg'));
        for (const w of fall.weg) this.md(ol.appendChild(h('li')), w);
      }
      const tasten = fall.tasten && fall.tasten[CFG.rechner];
      if (tasten) {
        loes.appendChild(h('div', 'fle-label', `Tasten (${CFG.rechner})`));
        loes.appendChild(h('code', 'fle-tasten', tasten));
      }
    }
    if (this.pruefung) return;
    // Spick-Vermerke: das wichtigste Signal für Änderungen am Spick
    const vermerk = (this.z.spick || {})[key];
    const sp = box.appendChild(h('div', 'fle-spick-vermerk'));
    for (const [wert, text] of [['fehlt', 'Auf dem Spick nicht gefunden'], ['unklar', 'Auf dem Spick unklar']]) {
      const b = sp.appendChild(h('button', 'fle-btn fle-btn-leise' + (vermerk === wert ? ' is-an' : ''), text));
      b.setAttribute('aria-pressed', String(vermerk === wert));
      b.onclick = () => {
        const s = { ...(this.z.spick || {}) };
        if (s[key] === wert) delete s[key]; else s[key] = wert;
        this.setze({ ...this.z, spick: s });
        this.baue();
      };
    }
  }

  // Zeit pro Fall: Stand der Schritt-Uhr bei der letzten Eingabe (ohne Pausen); die Differenz zum
  // vorherigen Fall ist die Zeit für diesen Fall, inklusive Lesen und Nachdenken vor dem Tippen
  merkeStart(key) {
    const z = this.z;
    if (!z.start) z.start = {};
    if (!z.start[key]) z.start[key] = Date.now();
    if ((z.aufgedeckt || []).includes(key)) return;
    if (!z.uhr) z.uhr = {};
    z.uhr[key] = this.laufendeSekunden(Number(key.split('.')[0]));
  }

  // Aufdecken friert das Ergebnis ein: Abschreiben danach ändert nichts mehr
  deckeAuf(key, wert) {
    const z = this.z;
    z.uhr = { ...(z.uhr || {}), [key]: this.laufendeSekunden(Number(key.split('.')[0])) };
    const sek = fallSekunden(z, key);
    const a = new Set(z.aufgedeckt); a.add(key);
    const hilfe = (z.hilfe || {})[key] || 0;
    const leer = istLeer((z.eingaben || {})[key]);
    this.setze({ ...z, aufgedeckt: [...a], ergebnisse: { ...(z.ergebnisse || {}), [key]: { wert, sek, hilfe, ...(leer ? { leer: true } : {}) } } });
    this.baue();
  }

  bewerteSelbst(key, wert) {
    const z = this.z;
    const alt = (z.ergebnisse || {})[key] || { sek: 0 };
    this.setze({ ...z, ergebnisse: { ...(z.ergebnisse || {}), [key]: { ...alt, wert } } });
    if (this.pruefung && z.abgegeben) this.speichereProbe();
    this.baue();
  }

  zeigeErgebnis(el, key) {
    const e = (this.z.ergebnisse || {})[key];
    if (!e) return;
    const zeit = e.sek ? ` · ${Math.max(1, Math.round(e.sek / 60))} min` : '';
    if (e.wert == null) { el.appendChild(h('div', 'fle-ergebnis is-offen', `Noch nicht bewertet${zeit}`)); return; }
    const t = ERGEBNIS_TEXT(e.wert);
    const cls = e.wert >= 1 ? 'is-richtig' : e.wert > 0 ? 'is-teilweise' : 'is-falsch';
    el.appendChild(h('div', `fle-ergebnis ${cls}`, `${e.wert >= 1 ? '✓' : e.wert > 0 ? '◐' : '✗'} ${t}${zeit}`));
  }

  // ── Probeprüfung ──
  baueGesperrt() {
    const box = this.root.appendChild(h('div', 'fle-probe is-zu fle-probe-gross'));
    const ikon = box.appendChild(h('span', 'fle-probe-ikon'));
    obsidian.setIcon(ikon, 'lock');
    box.appendChild(h('div', 'fle-probe-titel', `${this.e.thema} ist noch gesperrt`));
    box.appendChild(h('p', 'fle-probe-text', 'Schalte sie im Prüfungsfahrplan frei: im Schnitt 70 % und kein Thema unter 50 %.'));
    const b = box.appendChild(h('button', 'fle-btn mod-cta', 'Zum Prüfungsfahrplan'));
    b.onclick = () => {
      const f = this.plugin.app.metadataCache.getFirstLinkpathDest(cfgFuer(this.e.modul).fahrplan, this.pfad);
      if (f) this.plugin.app.workspace.getLeaf(false).openFile(f);
    };
  }

  baueStart() {
    const box = this.root.appendChild(h('div', 'fle-probe is-offen fle-probe-gross'));
    const ikon = box.appendChild(h('span', 'fle-probe-ikon'));
    obsidian.setIcon(ikon, 'timer');
    box.appendChild(h('div', 'fle-probe-titel', this.e.thema));
    const max = this.e.schritte.reduce((a, s) => a + (s.faelle || []).reduce((b, f) => b + f.punkte, 0), 0);
    const ul = box.appendChild(h('ul', 'fle-probe-regeln'));
    const mathe = this.e.modul === 'mathe';
    for (const t of [
      `${this.e.dauer} Minuten, ${max} Punkte – die Uhr läuft ohne Pause, auch wenn du Obsidian schliesst.`,
      mathe ? 'Erlaubt: dein Spick (Knopf „Spick“) und der Taschenrechner. Sonst nichts.'
        : 'Erlaubt: Kontenplan-Beilage (Knopf „Kontenplan“) und Taschenrechner. Keine Notizen, kein OR.',
      'Lösungen siehst du erst nach der Abgabe. Bei 0:00 wird automatisch abgegeben.',
      ...(mathe ? [] : ['Für nicht erforderliche Buchungssätze gibt es Abzug – wie an der echten Prüfung.']),
    ]) ul.appendChild(h('li', null, t));
    if (this.e.stoff) box.appendChild(h('div', 'fle-leise', this.e.stoff));
    const b = box.appendChild(h('button', 'fle-btn mod-cta fle-probe-start', 'Prüfung starten'));
    b.onclick = () => {
      if (!window.confirm(`${this.e.thema} jetzt starten? Die ${this.e.dauer} Minuten laufen sofort.`)) return;
      const jetzt = Date.now();
      this.setze({ ...starte(this.z, 0, jetzt), pruefStart: jetzt, schritt: 0 });
      this.baue();
    };
  }

  // Abgabe friert alles ein: Buchungen prüft das Plugin, Textantworten bewertest du danach selbst
  gibAb() {
    const z = stoppeLaufenden(this.z, Date.now());
    if (z.abgegeben) return;
    const ergebnisse = { ...(z.ergebnisse || {}) };
    const aufgedeckt = new Set(z.aufgedeckt);
    this.e.schritte.forEach((s, si) => {
      for (const fall of s.faelle || []) {
        const key = `${si}.${fall.id}`;
        const eingabe = z.eingaben[key];
        const start = (z.start || {})[key];
        const sek = start ? Math.round((Date.now() - start) / 1000) : 0;
        const wert = fall.art === 'buchung' ? bewerteBuchung(eingabe, fall.loesung) : istLeer(eingabe) ? 0
          : fall.art === 'zahl' ? pruefeZahlFall(eingabe, fall) : null;
        ergebnisse[key] = { wert, sek };
        aufgedeckt.add(key);
      }
    });
    const abgegeben = Math.min(Date.now(), z.pruefStart + this.e.dauer * 60_000);
    this.setze({ ...z, ergebnisse, aufgedeckt: [...aufgedeckt], abgegeben, schritt: this.schritte.length - 1 });
    this.speichereProbe();
    this.baue();
  }

  baueAbgabe(el) {
    const z = this.z;
    if (!z.abgegeben) {
      let bearbeitet = 0, alle = 0;
      this.e.schritte.forEach((s, si) => { for (const f of s.faelle || []) { alle++; if (!istLeer(z.eingaben[`${si}.${f.id}`])) bearbeitet++; } });
      el.appendChild(h('p', null, `${bearbeitet} von ${alle} Aufgaben bearbeitet. Nach der Abgabe kannst du nichts mehr ändern.`));
      const b = el.appendChild(h('button', 'fle-btn mod-cta', 'Prüfung abgeben'));
      b.onclick = () => { if (window.confirm('Wirklich abgeben?')) this.gibAb(); };
      return;
    }
    const r = pruefungsErgebnis(this.e, z, cfgFuer(this.e.modul).bonus);
    const stufe = r.note >= 5 ? 'is-richtig' : r.note >= 4 ? 'is-teilweise' : 'is-falsch';
    const box = el.appendChild(h('div', `fle-quote fle-probe-ergebnis ${stufe}`));
    box.appendChild(h('div', 'fle-probe-note', `Note ${String(r.note).replace('.', ',')}`));
    box.appendChild(h('div', null, `${r.erreicht} von ${r.max} Punkten (${r.prozent} %) · ${Math.round((z.abgegeben - z.pruefStart) / 60000)} von ${this.e.dauer} Minuten`));
    if (r.offen) box.appendChild(h('div', 'fle-leise', `Noch ${r.offen} Textantworten selbst bewerten – erst dann ist die Note fertig.`));
    const tab = el.appendChild(h('table', 'fle-tabelle fle-zeiten'));
    const tb = tab.appendChild(h('tbody'));
    for (const t of r.teile) {
      const tr = tb.appendChild(h('tr'));
      tr.appendChild(h('td', null, t.titel));
      tr.appendChild(h('td', 'is-betrag', `${t.erreicht} / ${t.max} P`));
    }
    el.appendChild(h('div', 'fle-leise', 'Die Lösungen stehen jetzt bei jeder Aufgabe. Gehe sie durch – vor allem die mit ✗.'));
  }

  async speichereProbe() {
    const z = this.z;
    const c = cfgFuer(this.e.modul);
    const r = pruefungsErgebnis(this.e, z, c.bonus);
    const note = String(r.note).replace('.', ',');
    this.setze({ ...z, ergebnis: r, einschaetzung: `Note ${note}`, abgeschlossen: z.abgeschlossen || heute() });
    const fs = this.plugin.app.vault.getAbstractFileByPath(c.fortschritt);
    if (!(fs instanceof obsidian.TFile)) return;
    const [, m, d] = (z.abgeschlossen || heute()).split('-');
    const min = Math.round((z.abgegeben - z.pruefStart) / 60000);
    const zeile = `| ${d}.${m}. | ${this.e.thema} | Probeprüfung | ${min} min (Soll ${this.e.dauer}) · ${r.prozent} % richtig (${r.erreicht}/${r.max}) | Note ${note} |`;
    await this.plugin.app.vault.process(fs, (t) => setzeFortschritt(t, zeile));
  }

  // Originalseite der Prüfungsinfo rechts daneben, damit Aufgabe und Kontenplan gleichzeitig sichtbar sind
  async oeffneBeilage() {
    const app = this.plugin.app;
    const c = cfgFuer(this.e.modul);
    const f = app.metadataCache.getFirstLinkpathDest(c.beilagePdf, this.pfad);
    if (!f) { new obsidian.Notice(`${c.beilagePdf} nicht gefunden.`); return; }
    let leaf = this.plugin.kontenLeaf;
    if (!leaf || !app.workspace.getLeafById || !app.workspace.getLeafById(leaf.id)) {
      leaf = this.plugin.kontenLeaf = app.workspace.getLeaf('split', 'vertical');
    }
    await leaf.openFile(f, c.beilageSeite ? { active: false, eState: { subpath: c.beilageSeite } } : { active: false });
  }

  baueEinschaetzen(el) {
    const z = this.z;
    const tab = el.appendChild(h('table', 'fle-tabelle fle-zeiten'));
    const tb = tab.appendChild(h('tbody'));
    let ist = 0, soll = 0;
    this.schritte.forEach((s, i) => {
      if (s.art === 'einschaetzen') return;
      const sek = this.laufendeSekunden(i);
      ist += sek; soll += s.soll;
      const tr = tb.appendChild(h('tr'));
      tr.appendChild(h('td', null, s.titel));
      tr.appendChild(h('td', 'is-betrag', `${Math.floor(sek / 60)} min`));
      tr.appendChild(h('td', 'is-betrag fle-leise', `Soll ${s.soll}`));
    });
    const sum = tb.appendChild(h('tr', 'is-summe'));
    sum.appendChild(h('td', null, 'Total'));
    sum.appendChild(h('td', 'is-betrag', `${Math.floor(ist / 60)} min`));
    sum.appendChild(h('td', 'is-betrag fle-leise', `Soll ${soll}`));

    const q = trefferQuote(this.e, z);
    if (q) {
      const stufe = q.prozent >= 80 ? 'is-richtig' : q.prozent >= 50 ? 'is-teilweise' : 'is-falsch';
      const box = el.appendChild(h('div', `fle-quote ${stufe}`));
      box.appendChild(h('strong', null, `${q.prozent} % richtig`));
      box.appendChild(h('span', null, ` · ${q.richtig} von ${q.anzahl} Aufgaben`));
      box.appendChild(h('div', 'fle-leise', 'Für die Wiederholung zählt das Schlechtere aus deinem Gefühl und diesem Ergebnis.'));
    }
    el.appendChild(h('div', 'fle-label', 'Wie ist es gelaufen?'));
    const reihe = el.appendChild(h('div', 'fle-wahl'));
    for (const w of EINSCHAETZUNGEN) {
      const b = reihe.appendChild(h('button', 'fle-btn' + (z.einschaetzung === w ? ' mod-cta' : ''), w));
      b.setAttribute('aria-pressed', String(z.einschaetzung === w));
      b.onclick = async () => { await this.plugin.schliesseAb(this.e, w); this.baue(); };
    }
    if (z.einschaetzung) el.appendChild(h('div', 'fle-leise', z.board ? 'Gespeichert, die Karte liegt in „Erledigt“.' : 'Gespeichert.'));
  }
}

const STATUS_TEXT = { sitzt: 'sitzt', fast: 'fast', wackelig: 'wackelig', offen: 'offen', ueberfaellig: 'überfällig' };
const DRUCK_TEXT = {
  ruhe: ['Noch nicht dran', 'Für die Themen beginnt die Soll-Kurve erst.'],
  gut: ['Im Plan', 'Du bist so weit, wie du heute sein solltest.'],
  knapp: ['Knapp', 'Leicht hinter dem Soll – heute eine Einheit, dann passt es.'],
  hinten: ['Rückstand', 'Deutlich hinter dem Soll – die roten Themen zuerst.'],
  alarm: ['Alarm', 'Weit hinter dem Soll – jeden Tag eine Einheit, bis es grün wird.'],
};
const kurz = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}.`; };

// Zahl hochzählen lassen (bei „weniger Bewegung“ sofort der Endwert)
function zaehleHoch(el, ziel, endung = '', form = String) {
  const ruhig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (ruhig || ziel <= 0) { el.textContent = form(ziel) + endung; return; }
  const start = performance.now();
  const dauer = 900;
  const schritt = (jetzt) => {
    const t = Math.min(1, (jetzt - start) / dauer);
    el.textContent = form(Math.round(ziel * (1 - Math.pow(1 - t, 3)))) + endung;
    if (t < 1) window.requestAnimationFrame(schritt);
  };
  el.textContent = form(0) + endung;
  window.requestAnimationFrame(schritt);
}

class FahrplanAnsicht extends obsidian.MarkdownRenderChild {
  // opts.einbett: in der Modulseite (Themen eingeklappt), opts.todos: eigener Aufgabenblock statt „Als Nächstes dran“
  constructor(el, plugin, plan, opts = {}) { super(el); this.plugin = plugin; this.plan = plan; this.opts = opts; }

  onload() {
    this.fertig = this.baue();
    if (this.opts.einbett) return;
    this.registerEvent(this.plugin.app.vault.on('modify', (f) => { if (f.path === cfgFuer(this.plan.modul).fortschritt || f.path === CFG.board) this.baue(); }));
  }

  async baue() {
    const f = await this.plugin.ladeFahrplan(this.plan.modul);
    // Plan frisch aus der Datei: Obsidian hält gerenderte Codeblöcke manchmal mit altem Text fest
    if (f) this.plan = f.plan;
    const tag = heute();
    const themen = f ? f.themen : this.plan.themen.map((t) => ({ ...t, status: 'offen', koennen: 0, soll: 0, druck: 'ruhe' }));
    const root = h('div', 'fle fle-plan');
    const cm = cfgFuer(this.plan.modul);
    const { rest, ist, soll, druck, note, ziel } = fahrplanKennzahlen(themen, this.plan, cm, tag);
    const zahlen = [];

    // Kopf: drei grosse Zahlen in der Druckfarbe
    const kopf = root.appendChild(h('div', `fle-plan-kopf is-${druck}`));
    const kachel = (wert, endung, text, cls = '') => {
      const k = kopf.appendChild(h('div', 'fle-plan-kachel ' + cls));
      zahlen.push([k.appendChild(h('div', 'fle-plan-zahl')), wert, endung]);
      k.appendChild(h('div', 'fle-plan-unter', text));
    };
    kachel(rest, '', `Tage bis zur Prüfung (${kurz(this.plan.pruefung)}${this.plan.datum_geschaetzt ? ', geschätzt' : ''})`);
    const nk =kopf.appendChild(h('div', 'fle-plan-kachel is-note'));
    const nz = nk.appendChild(h('div', 'fle-plan-zahl'));
    // Zählt von 1,0 hoch (tiefste Note), nicht von 0
    const komma = (n) => n.toFixed(1).replace('.', ',');
    zahlen.push([nz, Math.round((note - 1) * 10), '', (v) => komma(1 + v / 10)]);
    nk.appendChild(h('div', 'fle-plan-unter', `Note, wenn heute Prüfung wäre (${ist} %${cm.bonus ? ` + ${String(cm.bonus).replace('.', ',')} Bonuspunkte` : ''})`));
    if (ziel) nk.appendChild(h('div', 'fle-plan-ziel', `Ziel ${komma(ziel)} · ab ${prozentFuerMit(ziel, cm.maxPunkte, cm.bonus)} %`));
    kachel(soll, ' %', 'solltest du heute können', 'is-soll');
    const [titel, satz] = DRUCK_TEXT[druck];
    const band = root.appendChild(h('div', `fle-plan-druck is-${druck}`));
    band.appendChild(h('span', 'fle-plan-druck-punkt'));
    band.appendChild(h('strong', null, titel));
    band.appendChild(h('span', 'fle-plan-druck-satz', satz));

    // Spick einfrieren (Mathe): ab dann nur noch mit dem handgeschriebenen Blatt üben
    if (this.plan.spick_frieren) {
      const bis = tageBis(tag, this.plan.spick_frieren);
      root.appendChild(h('div', 'fle-plan-spick' + (bis <= 0 ? ' is-zu' : ''), bis > 0
        ? `Spick wird am ${kurz(this.plan.spick_frieren)} eingefroren – noch ${bis} Tage für Änderungen.`
        : 'Spick eingefroren – übe nur noch mit deinem handgeschriebenen Blatt.'));
    }


    const zaehle = (s) => themen.filter((t) => t.status === s).length;
    const balken = root.appendChild(h('div', 'fle-plan-balken'));
    for (const s of ['sitzt', 'fast', 'wackelig', 'offen', 'ueberfaellig']) {
      const n = zaehle(s);
      if (n) { const b = balken.appendChild(h('span', `is-${s}`)); b.style.flexGrow = n; b.title = `${STATUS_TEXT[s]}: ${n}`; }
    }
    // Legende statt Rätselbalken: Farbpunkt, Name, Anzahl
    const legende = root.appendChild(h('div', 'fle-plan-legende'));
    for (const st of ['sitzt', 'fast', 'wackelig', 'offen', 'ueberfaellig']) {
      const n = zaehle(st);
      if (!n && st !== 'sitzt') continue;
      const e = legende.appendChild(h('span', `fle-plan-leg is-${st}`));
      e.appendChild(h('i'));
      e.appendChild(h('span', null, `${STATUS_TEXT[st]} ${n}`));
    }
    legende.title = 'Stand der Themen (Aufgabenarten) dieser Prüfung';
    legende.prepend(h('span', 'fle-plan-leg-titel', `${themen.length} Themen:`));

    // Als Nächstes dran: offene Lerneinheiten des Moduls vom Board (Wunsch 10.11.), unter der Themen-Legende
    try { if (this.opts.todos) this.opts.todos(root, tag); else await this.baueTodos(root, cm, tag); } catch (err) { console.error('fa-lerneinheit To-dos', err); }

    if (f) {
      try { this.baueProbe(root, themen, tag); } catch (err) {
        console.error('fa-lerneinheit Probeprüfung', err);
        root.appendChild(h('div', 'fle fle-fehler', `Probeprüfung-Karte: ${err.message}`));
      }
    }

    // Eingebettet (Modulseite): Themen eingeklappt in „Themen im Detail“
    let themenZiel = root;
    if (this.opts.einbett) {
      themenZiel = root.appendChild(h('details', 'fle-plan-details'));
      themenZiel.id = 'flz-m-themen';
      themenZiel.appendChild(h('summary', null, `Themen im Detail · ${themen.length} Themen`));
    }
    // Jetzt dran: grösster Rückstand zuerst, dann fällige Wiederholungen
    const dran = themen
      .filter((t) => t.koennen < t.soll || (t.wieder && t.wieder <= tag))
      .sort((a, b) => (b.soll - b.koennen) - (a.soll - a.koennen));
    if (dran.length) {
      const kopfDran = themenZiel.appendChild(h('div', 'fle-plan-hkopf'));
      kopfDran.appendChild(h('h4', 'fle-plan-h', 'Jetzt dran'));
      kopfDran.appendChild(h('span', 'fle-leise', 'grösster Rückstand zuerst'));
      // Die ersten fünf sofort, der Rest aufklappbar – sonst ist alles gleich wichtig
      const zeile = (liste, t) => {
        const li = liste.appendChild(h('li', `is-${t.druck}`));
        li.appendChild(h('span', 'fle-plan-punkt'));
        const name = li.appendChild(h('span', 'fle-plan-dran-name', t.thema));
        if (!t.anzahl) name.appendChild(h('span', 'fle-plan-neu', 'noch nie geübt'));
        const luecke = t.soll - t.koennen;
        li.appendChild(h('span', 'fle-plan-dran-wert', luecke > 0 ? `−${luecke}` : 'wiederholen'));
      };
      const ul = themenZiel.appendChild(h('ul', 'fle-plan-dran'));
      dran.slice(0, 5).forEach((t) => zeile(ul, t));
      if (dran.length > 5) {
        const mehr = themenZiel.appendChild(h('details', 'fle-plan-mehr'));
        mehr.appendChild(h('summary', null, `${dran.length - 5} weitere`));
        const ul2 = mehr.appendChild(h('ul', 'fle-plan-dran'));
        dran.slice(5).forEach((t) => zeile(ul2, t));
      }
    }

    for (const teil of [...new Set(themen.map((t) => t.teil || ''))]) {
      const teilThemen = themen.filter((x) => (x.teil || '') === teil);
      const hk = themenZiel.appendChild(h('div', 'fle-plan-hkopf'));
      hk.appendChild(h('h4', 'fle-plan-h', teil || 'Themen'));
      const zurueck = teilThemen.filter((t) => t.koennen < t.soll).length;
      hk.appendChild(h('span', 'fle-leise', zurueck ? `${zurueck} von ${teilThemen.length} hinter dem Soll` : `${teilThemen.length} Themen`));
      const tab = themenZiel.appendChild(h('table', 'fle-plan-tab'));
      // Feste Spalten, damit Teil A, Teil B und Gesamt bündig untereinander stehen
      const cg = tab.appendChild(h('colgroup'));
      for (const c of ['thema', 'stichtag', 'koennen', 'status', 'wieder']) cg.appendChild(h('col', `is-${c}`));
      const kopfzeile = tab.appendChild(h('thead')).appendChild(h('tr'));
      for (const s of ['Thema', 'Stichtag', 'Können · Soll-Strich', 'Stand', 'Wieder']) kopfzeile.appendChild(h('th', null, s));
      const tb = tab.appendChild(h('tbody'));
      for (const t of teilThemen) {
        const tr = tb.appendChild(h('tr', `is-${t.druck}`));
        tr.appendChild(h('td', 'fle-plan-thema', t.thema));
        tr.appendChild(h('td', 'fle-plan-datum', kurz(t.stichtag)));
        const zelle = tr.appendChild(h('td')).appendChild(h('div', 'fle-plan-koennen'));
        if (t.soll <= 0 && t.koennen <= 0) {
          // Noch nicht dran: kein „0 % / 0“-Rauschen
          zelle.appendChild(h('span', 'fle-plan-spaeter', `ab ${kurz(plusTage(t.stichtag, -SOLL.vorlauf))}`));
        } else {
          const zahl = zelle.appendChild(h('span', 'fle-plan-prozent'));
          zahlen.push([zahl, t.koennen, ' %']);
          const spur = zelle.appendChild(h('div', 'fle-plan-spur'));
          const fuell = spur.appendChild(h('div', 'fle-plan-fuell'));
          const marke = spur.appendChild(h('div', 'fle-plan-marke'));
          marke.style.left = `${t.soll}%`;
          fuell.dataset.ziel = t.koennen;
          zelle.title = `Können ${t.koennen} %, Soll heute ${t.soll} %`;
        }
        tr.appendChild(h('td')).appendChild(h('span', `fle-plan-status is-${t.status}`, STATUS_TEXT[t.status]));
        tr.appendChild(h('td', 'fle-plan-datum', t.wieder ? kurz(t.wieder) : '–'));
      }
    }
    this.containerEl.empty();
    this.containerEl.appendChild(root);
    for (const [el, wert, endung, form] of zahlen) zaehleHoch(el, wert, endung, form);
    // Balken erst nach dem Einhängen setzen, damit die Breite animiert
    window.requestAnimationFrame(() => {
      for (const b of root.querySelectorAll('.fle-plan-fuell')) b.style.width = `${b.dataset.ziel}%`;
    });
  }
}

// Die nächsten offenen Karten der Modulspalte, mit Link und Fälligkeit
FahrplanAnsicht.prototype.baueTodos = async function (root, cm, tag) {
  const app = this.plugin.app;
  const board = app.vault.getAbstractFileByPath(CFG.board);
  if (!(board instanceof obsidian.TFile)) return;
  // Nur Aufgaben vom Plugin (Korrektur 10.11.): Lerneinheiten und Wiederholen-Karten, nicht die übrigen To-dos
  const istLerneinheit = (link) => {
    const f = app.metadataCache.getFirstLinkpathDest(link, '');
    const fm = f && (app.metadataCache.getFileCache(f) || {}).frontmatter;
    return !!fm && fm.lerneinheit === true;
  };
  const karten = naechsteTodos(await app.vault.cachedRead(board), cm.spalte, tag, (k) => k.wiederholen || (k.link !== null && istLerneinheit(k.link)));
  const kopf = root.appendChild(h('div', 'fle-plan-hkopf'));
  kopf.appendChild(h('h4', 'fle-plan-h', 'Als Nächstes dran'));
  kopf.appendChild(h('span', 'fle-leise', karten.length ? `${karten.length} Lerneinheit${karten.length === 1 ? '' : 'en'} offen` : 'keine Lerneinheit offen'));
  if (!karten.length) return;
  const ul = root.appendChild(h('ul', 'fle-plan-dran fle-plan-todos'));
  const zeile = (liste, k) => {
    const li = liste.appendChild(h('li', k.ueberfaellig ? 'is-alarm' : k.datum === tag ? 'is-knapp' : 'is-ruhe'));
    li.appendChild(h('span', 'fle-plan-punkt'));
    // Wiederholen-Karten zeigen auf diesen Fahrplan selbst – ein Link würde nichts tun. Die Routine baut die Einheit.
    const klickbar = k.link && !k.wiederholen;
    const name = li.appendChild(h(klickbar ? 'a' : 'span', 'fle-plan-dran-name' + (klickbar ? ' internal-link' : ''), k.text));
    if (k.wiederholen) {
      name.appendChild(h('span', 'fle-plan-neu', folgtHinweis()));
      name.style.cursor = 'pointer';
      name.onclick = () => new obsidian.Notice(folgtNotice(k.text), 10000);
    }
    if (klickbar) {
      name.setAttribute('href', k.link);
      name.onclick = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); app.workspace.openLinkText(k.link, '', ev.ctrlKey || ev.metaKey); };
    }
    li.appendChild(h('span', 'fle-plan-dran-wert', k.datum ? (k.ueberfaellig ? `überfällig · ${kurz(k.datum)}` : k.datum === tag ? 'heute' : kurz(k.datum)) : '–'));
  };
  karten.slice(0, 5).forEach((k) => zeile(ul, k));
  if (karten.length > 5) {
    const mehr = root.appendChild(h('details', 'fle-plan-mehr'));
    mehr.appendChild(h('summary', null, `${karten.length - 5} weitere`));
    const ul2 = mehr.appendChild(h('ul', 'fle-plan-dran fle-plan-todos'));
    karten.slice(5).forEach((k) => zeile(ul2, k));
  }
};

// Probeprüfung als freischaltbare Karte (wie ein gesperrtes Level)
FahrplanAnsicht.prototype.baueProbe = function (root, themen, tag) {
  const plugin = this.plugin;
  const namen = (this.plan.probepruefungen || []).map(String);
  if (!namen.length) return;
  const fs = freischaltung(themen, this.plan.freischalten || {});
  const spaet = plusTage(this.plan.pruefung, -FREI.vorPruefung);
  const fk = freiSchluessel(this.plan.modul);
  const schonFrei = plugin.daten[fk];
  const neu = !schonFrei && fs.offen;
  if (neu) {
    plugin.daten[fk] = tag;
    plugin.saveData(plugin.daten);
    new obsidian.Notice('🔓 Probeprüfung freigeschaltet!', 8000);
  }
  const offen = !!plugin.daten[fk];
  const karte = root.appendChild(h('div', `fle-probe ${offen ? 'is-offen' : 'is-zu'}${neu ? ' is-neu' : ''}`));
  const kopf = karte.appendChild(h('div', 'fle-probe-kopf'));
  const ikon = kopf.appendChild(h('span', 'fle-probe-ikon'));
  obsidian.setIcon(ikon, offen ? 'lock-open' : 'lock');
  const titel = kopf.appendChild(h('div'));
  titel.appendChild(h('div', 'fle-probe-titel', 'Probeprüfung'));
  titel.appendChild(h('div', 'fle-leise', `${this.plan.probe_dauer || 90} Minuten · ${this.plan.probe_punkte || 90} Punkte · wie die echte Prüfung`));

  if (!offen) {
    const rest = tageBis(tag, spaet);
    karte.appendChild(h('p', 'fle-probe-text',
      `Gesperrt. Freischalten, wenn du im Schnitt ${fs.zielSchnitt} % kannst (Note 4,5) und kein Thema unter ${fs.mindestens} % liegt.`));
    const leiste = (label, wert, ziel, text) => {
      const zeile = karte.appendChild(h('div', 'fle-probe-ziel'));
      zeile.appendChild(h('span', null, label));
      const spur = zeile.appendChild(h('div', 'fle-plan-spur'));
      const fuell = spur.appendChild(h('div', 'fle-plan-fuell fle-probe-fuell'));
      fuell.dataset.ziel = Math.min(100, Math.round(wert / ziel * 100));
      zeile.appendChild(h('span', 'fle-probe-zahl', text));
    };
    leiste('Schnitt', fs.schnitt, fs.zielSchnitt, `${fs.schnitt} / ${fs.zielSchnitt} %`);
    leiste(`Themen ab ${fs.mindestens} %`, fs.gut, fs.anzahl, `${fs.gut} / ${fs.anzahl}`);
    if (fs.schwach.length) karte.appendChild(h('div', 'fle-leise', `Am schwächsten: ${fs.schwach.join(', ')}`));
    const frist = karte.appendChild(h('div', `fle-probe-frist ${rest < 0 ? 'is-alarm' : rest <= 14 ? 'is-hinten' : ''}`));
    frist.textContent = rest >= 0
      ? `Spätestens bis ${kurz(spaet)} freischalten – noch ${rest} Tage. Danach bleiben vor der Prüfung genug Tage für zwei Versuche.`
      : `Frist ${kurz(spaet)} verpasst – jetzt jeden Tag die schwächsten Themen.`;
    return;
  }

  karte.appendChild(h('p', 'fle-probe-text', `Freigeschaltet am ${kurz(plugin.daten[fk])}. Bedingungen wie an der Prüfung: Zeit läuft ohne Pause, Lösungen erst nach der Abgabe.`));
  const liste = karte.appendChild(h('div', 'fle-probe-liste'));
  for (const name of namen) {
    const datei = plugin.app.metadataCache.getFirstLinkpathDest(name, '');
    const versuch = Object.values(plugin.daten.einheiten).find((z) => datei && z.datei === datei.path && z.ergebnis);
    const b = liste.appendChild(h('button', 'fle-btn mod-cta', versuch ? `${name} · Note ${String(versuch.ergebnis.note).replace('.', ',')}` : `${name} starten`));
    if (!datei) { b.disabled = true; b.textContent = `${name} – Seite fehlt noch`; continue; }
    b.onclick = () => plugin.app.workspace.getLeaf('tab').openFile(datei);
  }
};

// ── Spick-Seite: Vorschau auf zwei A4-Blättern, Änderungsvorschlag übernehmen, PDF erzeugen ──
const spickBlock = (text) => (/```spick\r?\n([\s\S]*?)\r?\n```/.exec(text) || [])[1];
class SpickAnsicht extends obsidian.MarkdownRenderChild {
  constructor(el, plugin, spick, pfad, nurLesen = false) { super(el); this.plugin = plugin; this.spick = spick; this.pfad = pfad; this.nurLesen = nurLesen; }
  onload() {
    this.baue();
    this.registerEvent(this.plugin.app.vault.on('modify', (f) => { if (f.basename === `${CFG.spickSeite} – Vorschlag`) this.baue(); }));
    this.registerEvent(this.plugin.app.vault.on('create', (f) => { if (f.basename === `${CFG.spickSeite} – Vorschlag`) this.baue(); }));
  }

  async frieren() {
    const f = await this.plugin.ladeFahrplan('mathe');
    return (f && f.plan.spick_frieren) || SPICK_FRIEREN;
  }

  async vorschlag() {
    const app = this.plugin.app;
    const f = app.metadataCache.getFirstLinkpathDest(`${CFG.spickSeite} – Vorschlag`, this.pfad);
    if (!(f instanceof obsidian.TFile)) return null;
    let roh;
    try { roh = obsidian.parseYaml(spickBlock(await app.vault.read(f)) || ''); } catch (err) { return { datei: f, fehler: err.message }; }
    return { datei: f, roh };
  }

  async baue() {
    const root = h('div', 'fle fle-spick');
    const frieren = await this.frieren();
    const zu = heute() >= frieren;
    const kopf = root.appendChild(h('div', 'fle-spick-kopf'));
    kopf.appendChild(h('div', 'fle-thema', `Spick Mathematik · Version ${this.spick.version}`));
    kopf.appendChild(h('div', 'fle-leise', `Stand ${kurz(this.spick.stand)} · Seite 1: ${this.spick.zeichen[1]} / Seite 2: ${this.spick.zeichen[2]} von ${SPICK_MAX_ZEICHEN} Zeichen`
      + (zu ? ` · eingefroren seit ${kurz(frieren)}` : ` · Änderungen bis ${kurz(plusTage(frieren, -1))}`)));
    if (this.nurLesen) {
      // Vorschlagsseite: nur ansehen – übernommen wird auf der eigentlichen Spick-Seite
      root.appendChild(h('div', 'fle-hinweis', `Das ist ein Vorschlag. Übernehmen oder verwerfen kannst du ihn auf der Seite „${CFG.spickSeite}“.`));
    } else {
      const pdf = kopf.appendChild(h('button', 'fle-btn', 'PDF neu erzeugen'));
      pdf.onclick = () => this.plugin.erzeugeSpickPdf(this.spick, this.pfad);
      const v = await this.vorschlag();
      if (v) this.baueVorschlag(root, v, zu, frieren);
    }

    const blaetter = root.appendChild(h('div', 'fle-spick-blaetter'));
    const render = await this.plugin.formelRender();
    const feldEl = (ziel, f) => {
      const feld = ziel.appendChild(h('div', 'fle-spick-feld'));
      feld.appendChild(h('div', 'fle-spick-titel', f.titel));
      // gleiche Umwandlung wie im PDF; spickText maskiert jeden Text, nur eigene Tags bleiben
      feld.appendChild(h('div', 'fle-spick-inhalt')).innerHTML = spickText(f.inhalt, render);
    };
    for (const s of [1, 2]) {
      const blatt = blaetter.appendChild(h('div', 'fle-spick-blatt'));
      blatt.dataset.seite = String(s);
      const breit = blatt.appendChild(h('div', 'fle-spick-breit'));
      for (const f of this.spick.felder.filter((x) => x.seite === s && x.spalte === 0)) feldEl(breit, f);
      const spalten = blatt.appendChild(h('div', 'fle-spick-spalten'));
      for (const sp of [1, 2]) {
        const spalte = spalten.appendChild(h('div', 'fle-spick-spalte'));
        for (const f of this.spick.felder.filter((x) => x.seite === s && x.spalte === sp)) feldEl(spalte, f);
      }
    }
    this.containerEl.empty();
    this.containerEl.appendChild(root);
    // Läuft ein Blatt über, ist es zu voll – auch wenn die Zeichenzahl noch passt
    window.setTimeout(() => {
      for (const b of root.querySelectorAll('.fle-spick-blatt')) {
        const voll = b.scrollHeight > b.clientHeight + 2;
        b.classList.toggle('is-voll', voll);
        if (voll && !b.querySelector('.fle-spick-warnung')) b.prepend(h('div', 'fle-spick-warnung', `Seite ${b.dataset.seite} zu voll`));
      }
    }, 600);
  }

  baueVorschlag(root, v, zu, frieren) {
    const box = root.appendChild(h('div', 'fle-spick-vorschlag'));
    if (v.fehler) { box.appendChild(h('div', 'fle-fehler', `Vorschlag nicht lesbar: ${v.fehler}`)); return; }
    const neu = pruefeSpick(v.roh);
    const aenderungen = neu.ok ? spickAenderungen(this.spick, neu.spick) : [];
    box.appendChild(h('div', 'fle-probe-titel', `Vorschlag vom ${v.roh && v.roh.stand ? kurz(isoTag(v.roh.stand)) : '?'}: ${aenderungen.length} Änderung${aenderungen.length === 1 ? '' : 'en'}`));
    if (!neu.ok) box.appendChild(h('div', 'fle-fehler', neu.fehler));
    const gruende = (v.roh && v.roh.gruende) || {};
    for (const a of aenderungen) {
      const z = box.appendChild(h('details', 'fle-spick-aenderung'));
      z.open = aenderungen.length <= 3;
      z.appendChild(h('summary', null, `${{ neu: 'Neu', geaendert: 'Geändert', entfernt: 'Entfernt' }[a.art]}: ${(a.nachher || a.vorher).titel}${a.platzGeaendert ? ' (Platzwechsel – nicht erlaubt)' : ''}`));
      if (gruende[a.id]) z.appendChild(h('div', 'fle-leise', gruende[a.id]));
      const zwei = z.appendChild(h('div', 'fle-spick-vergleich'));
      for (const [label, f] of [['vorher', a.vorher], ['nachher', a.nachher]]) {
        const s = zwei.appendChild(h('div'));
        s.appendChild(h('div', 'fle-label', label));
        if (f) s.appendChild(h('div', 'fle-spick-inhalt fle-spick-hand')).innerHTML = spickText(f.inhalt, (tex) => escHtml(tex));
        else s.appendChild(h('div', 'fle-leise', '–'));
      }
    }
    const reihe = box.appendChild(h('div', 'fle-aktionen'));
    const ja = reihe.appendChild(h('button', 'fle-btn mod-cta', 'Übernehmen'));
    ja.disabled = zu || !neu.ok;
    if (zu) ja.title = 'Der Spick ist eingefroren.';
    ja.onclick = async () => {
      const r = uebernimmVorschlag(this.spick, neu.spick, heute(), frieren);
      if (!r.ok) { new obsidian.Notice(r.fehler, 8000); return; }
      const app = this.plugin.app;
      const datei = app.vault.getAbstractFileByPath(this.pfad);
      const { zeichen, ...ohne } = r.spick;
      const yaml = obsidian.stringifyYaml(ohne).trimEnd();
      ja.disabled = true; ja.textContent = 'PDF wird gedruckt …';
      // Erst drucken: Hat das PDF nicht genau 2 Seiten, bleiben Spick, PDF und Vorschlag unverändert
      const erg = await uebernahmeAblauf({
        drucke: () => this.plugin.druckeSpickPdf(r.spick),
        schreibeBlock: () => app.vault.process(datei, (t) => t.replace(/```spick\r?\n[\s\S]*?\r?\n```/, () => '```spick\n' + yaml + '\n```')),
        schreibePdf: (daten) => this.plugin.schreibeSpickPdf(daten, this.pfad),
        entferneVorschlag: () => app.vault.trash(v.datei, false),
      });
      if (!erg.ok) { new obsidian.Notice(`Nicht übernommen: ${erg.fehler}`, 10000); this.baue(); return; }
      new obsidian.Notice(`Spick übernommen und PDF aktualisiert (Version ${r.spick.version}).`);
      this.spick = r.spick;
      this.baue();
    };
    const nein = reihe.appendChild(h('button', 'fle-btn', 'Verwerfen'));
    nein.onclick = async () => { await this.plugin.app.vault.trash(v.datei, false); this.baue(); };
  }
}

// ── Lernzentrale: Startseite als eigene Ansicht ──
const VIEW_LZ = 'fle-lernzentrale';
const MODUL_INFO = {
  fa: { name: 'Financial Accounting', kurz: 'FA', farbe: '#7b5cf0', modul: 'fa' },
  ma: { name: 'Angewandte Mathematik', kurz: 'Mathe', farbe: '#2a78d6', modul: 'mathe' },
  ob: { name: 'Organisational Behaviour', kurz: 'OB', farbe: '#1baf7a', modul: 'ob' },
  pom: { name: 'Principles of Management', kurz: 'PoM', farbe: '#e87ba4', modul: 'pom' },
  kdw: { name: 'Kritisches Denken', kurz: 'KDW', farbe: '#a8651e', modul: 'kdw' },
};
const STAND_WORT = { gut: 'gut', knapp: 'knapp', hinten: 'hinten', alarm: 'Alarm', ruhe: 'kein Plan' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, a, p) => { const e = document.createElementNS(SVG_NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const STAND_ICON = {
  alarm: '<path d="M12 7v6M12 17h.01"/>', knapp: '<path d="M12 5v14M6 13l6 6 6-6"/>', hinten: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  gut: '<path d="M20 6 9 17l-5-5"/>', ruhe: '<path d="M6 12h12"/>',
};
const icon = (pfade, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pfade}</svg>`;
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? m % 60 : ''}`.trim() : `${m} min`);
const MONAT = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

class LernzentraleAnsicht extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.ansichtPlan = 'tafel';
    this.wocheVersatz = 0;
    this.monatVersatz = 0;
    this.faktNr = 0;
    this.modulWahl = 'fa';
    this.seite = 'start';
    this.verlauf = [];
    this.kinder = [];
  }
  getViewType() { return VIEW_LZ; }
  getState() { return { ...super.getState(), seite: this.seite }; }
  async setState(state, result) {
    if (state && state.seite && (state.seite === 'start' || MODUL_INFO[state.seite]) && state.seite !== this.seite) {
      // Wiederhergestellt (Start von Obsidian oder Obsidians Zurück): eigener Verlauf beginnt leer
      this.verlauf = [];
      this.seite = state.seite;
      if (this.daten) this.render();
    }
    return super.setState(state, result);
  }
  getDisplayText() { return 'Lernzentrale'; }
  getIcon() { return 'layout-dashboard'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('flz-blatt');
    this.zeigeSkelett();
    const neu = obsidian.debounce(() => this.neuLaden(), 2000, true);
    this.registerInterval(window.setInterval(() => { if (this.daten && this.daten.tag !== heute()) this.neuLaden(); }, 60000));
    this.registerDomEvent(document, 'click', () => this.alleZu());
    this.registerDomEvent(document, 'keydown', (e) => { if (e.key === 'Escape') this.alleZu(); });
    this.registerEvent(this.app.vault.on('modify', (f) => {
      const pfade = [CFG.board, CFG.fortschritt, CFG.matheFortschritt, ...Object.values(NEUE_MODULE).map((n) => n.fortschritt)];
      if (pfade.includes(f.path) || f.basename === FAHRPLAN_NAME || f.basename === CFG.matheFahrplan || Object.values(NEUE_MODULE).some((n) => n.fahrplan === f.basename)) neu();
    }));
    await this.neuLaden();
  }

  zeigeSkelett() {
    this.contentEl.innerHTML = `<div class="flz"><div class="flz-seite">
      <div class="flz-sk" style="height:40px;width:40%;margin-top:22px"></div>
      <div class="flz-sk" style="height:230px;margin-top:18px;border-radius:14px"></div>
      <div class="flz-sk" style="height:270px;margin-top:44px"></div>
      <div class="flz-sk" style="height:160px;margin-top:44px"></div></div></div>`;
  }

  async neuLaden() {
    try {
      this.daten = await this.laden();
      this.render();
    } catch (err) {
      console.error('fa-lerneinheit Lernzentrale', err);
      this.contentEl.innerHTML = '';
      this.contentEl.appendChild(h('div', 'fle fle-fehler', `Lernzentrale konnte nicht laden: ${err.message}`));
    }
  }

  async lies(pfad) {
    const f = this.app.vault.getAbstractFileByPath(pfad);
    return f instanceof obsidian.TFile ? this.app.vault.cachedRead(f) : null;
  }

  fm(link) {
    const f = this.app.metadataCache.getFirstLinkpathDest(link, '');
    return f ? ((this.app.metadataCache.getFileCache(f) || {}).frontmatter || null) : null;
  }

  async laden() {
    const tag = heute();
    const fa = leseFortschritt((await this.lies(CFG.fortschritt)) || '');
    const ma = leseFortschritt((await this.lies(CFG.matheFortschritt)) || '');
    let quiz = null;
    try { quiz = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/plugins/lern-quiz/data.json`)); } catch (err) { quiz = null; }
    const boardText = (await this.lies(CFG.board)) || '';
    const board = leseBoard(boardText, tag, (link) => { const fm = this.fm(link); return !!fm && fm.lerneinheit === true; });
    const neu = {};
    for (const k of ['ob', 'pom', 'kdw']) neu[k] = leseFortschritt((await this.lies(NEUE_MODULE[k].fortschritt)) || '');
    const proTag = lernMinuten({ fa, ma, ...neu }, quiz);
    const plaene = {};
    for (const key of MODUL_KEYS) {
      const f = await this.plugin.ladeFahrplan(MODUL_INFO[key].modul);
      if (f) plaene[key] = { ...f, zeilen: key === 'fa' ? fa : key === 'ma' ? ma : neu[key] || [], cm: cfgFuer(MODUL_INFO[key].modul) };
    }
    // Etappe: Dauer aus dem Frontmatter der Lerneinheit („dauer: 52 Min“), Grund nur, wenn er aus Daten folgt
    const etappe = etappeHeute(board, tag).map((p0) => {
      let p = p0;
      const fm = p.link ? this.fm(p.link) : null;
      // Erledigte Karten stehen in „Erledigt“ ohne Spalte: Modul aus dem Frontmatter der Lerneinheit
      if (!p.modul && fm && fm.modul) p = { ...p, modul: Object.keys(MODUL_SPALTEN).find((k) => MODUL_SPALTEN[k] === fm.modul || MODUL_INFO[k].name === fm.modul) || null };
      const minuten = fm && fm.dauer ? Number((/(\d+)/.exec(String(fm.dauer)) || [])[1]) || null : null;
      let grund = p.status === 'fertig' ? 'erledigt' : p.art === 'wiederholen' ? 'wackelig, bald vergessen' : '';
      const plan = p.modul && plaene[p.modul];
      if (plan && p.art === 'lerneinheit') {
        const t = plan.themen.find((x) => (x.stichworte || []).some((w) => trifft(p.text, w)));
        const groesster = [...plan.themen].sort((a, b) => (b.soll - b.koennen) - (a.soll - a.koennen))[0];
        if (t && groesster && t.thema === groesster.thema && t.soll > t.koennen) grund = 'grösster Rückstand';
      }
      return { ...p, minuten, grund };
    });
    const gelerntHeute = { ...leerMinuten(), ...(proTag.get(tag) || {}) };
    const geplant = etappe.filter((p) => p.status !== 'fertig').reduce((s, p) => s + (p.minuten || 0), 0);
    const woche = wocheVon(proTag, tag);
    const bisGestern = woche.tage.filter((t) => t.iso < tag).reduce((s, t) => s + t.summe, 0);
    const module = MODUL_KEYS.map((key) => {
      const p = plaene[key];
      return { key, ...MODUL_INFO[key], plan: p || null, k: p ? fahrplanKennzahlen(p.themen, p.plan, p.cm, tag) : null };
    });
    // Hochrechnung fürs Modul des aktuellen Postens
    let ziel = null;
    const aktuell = etappe.find((p) => p.status === 'jetzt') || etappe.find((p) => p.modul);
    if (aktuell && plaene[aktuell.modul]) {
      const p = plaene[aktuell.modul];
      const offen = etappe.filter((x) => x.modul === aktuell.modul && x.status !== 'fertig');
      const neu = hochrechnung(p.plan.themen, p.zeilen, offen, tag, p.plan.pruefung);
      const ist = fahrplanKennzahlen(p.themen, p.plan, p.cm, tag).ist;
      if (neu !== null && neu > ist) ziel = { neu, ist, kurz: MODUL_INFO[aktuell.modul].kurz };
    }
    const s = serie(proTag, tag);
    const pruefungen = module.filter((m) => m.plan).map((m) => ({ kurz: m.kurz, tage: m.k.rest })).sort((a, b) => a.tage - b.tage);
    return {
      tag, fa, ma, quiz, proTag, board, etappe, gelerntHeute, geplant, ziel, woche, module, serie: s,
      tagesziel: tagesziel(summeMin(gelerntHeute), geplant, Number(CFG.wochenzielMin) || 360, bisGestern, tag),
      naechste: pruefungen[0] || null,
      fakten: fakten({ proTag, faZeilen: fa, maZeilen: ma, serie: s }, tag),
      leer: !Object.keys(plaene).length && !proTag.size,
    };
  }

  oeffne(link) {
    if (!link) return;
    const f = this.app.metadataCache.getFirstLinkpathDest(link, '');
    if (f) this.leaf.openFile(f); else this.app.workspace.openLinkText(link, '', false);
  }

  render(nachOben = false) {
    const nr = this.renderNr = (this.renderNr || 0) + 1;
    const d = this.daten;
    const root = h('div', 'flz');
    root.lang = 'de'; // für saubere Silbentrennung langer Wörter
    const seite = root.appendChild(h('div', 'flz-seite'));
    const abschnitt = (fn) => {
      try { fn(); } catch (err) {
        console.error('fa-lerneinheit Lernzentrale', err);
        seite.appendChild(h('div', 'fle fle-fehler', `Dieser Teil konnte nicht angezeigt werden: ${err.message}`));
      }
    };
    // Eingebettete Fahrplan-Ansichten der letzten Modulseite abräumen
    for (const k of this.kinder) this.removeChild(k);
    this.kinder = [];
    abschnitt(() => this.baueNav(seite));
    if (this.seite !== 'start' && MODUL_INFO[this.seite]) {
      abschnitt(() => this.baueModulseite(seite, this.seite, d));
    } else {
      abschnitt(() => this.baueKopf(seite, d));
      abschnitt(() => this.baueHeute(seite, d));
      abschnitt(() => this.bauePlan(seite, d));
      abschnitt(() => this.baueModule(seite, d));
      abschnitt(() => this.baueWoche(seite, d));
      abschnitt(() => this.baueFakt(seite, d));
    }
    const einhaengen = () => {
      if (this.renderNr !== nr) return;
      this.contentEl.empty();
      this.contentEl.appendChild(root);
      if (nachOben) this.contentEl.scrollTop = 0;
      this.nachRender(root);
    };
    if (this.kinder.length) Promise.all(this.kinder.map((k) => k.fertig)).finally(einhaengen);
    else einhaengen();
  }

  nachRender(root) {
    // Abschnitte blenden beim Scrollen einmal ein
    if (this.io) this.io.disconnect();
    const io = this.io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-da'); io.unobserve(e.target); } }), { root: this.contentEl, threshold: 0.12 });
    root.querySelectorAll('.flz-rein').forEach((el) => io.observe(el));
    if (!this.ioAbmelden) { this.ioAbmelden = true; this.register(() => this.io && this.io.disconnect()); }
    for (const el of root.querySelectorAll('[data-zaehl]')) zaehleHoch(el, Number(el.dataset.zaehl), el.dataset.endung || '');
  }

  baueNav(seite) {
    const nav = seite.appendChild(h('nav', 'flz-nav'));
    nav.setAttribute('aria-label', 'Lernzentrale');
    const knopf = (ziel, inhalt) => {
      const b = nav.appendChild(h('button', 'flz-nav-a' + (this.seite === ziel ? ' is-an' : '')));
      b.innerHTML = inhalt;
      if (this.seite === ziel) b.setAttribute('aria-current', 'page');
      b.onclick = () => this.zeigeSeite(ziel);
    };
    const hist = this.leaf.history;
    // Zurück-Knopf nur, wenn man von einer anderen Datei hierher kam – nie auf der Startseite und nicht fürs Springen
    // zwischen Start und Modulseiten, das geht über die Leiste selbst 
    if (this.seite !== 'start' && hist && hist.backHistory && hist.backHistory.length) {
      const z = nav.appendChild(h('button', 'flz-nav-a flz-nav-zurueck'));
      z.innerHTML = '<span aria-hidden="true">‹</span> Zurück';
      z.setAttribute('aria-label', 'Zurück zur letzten Seite');
      z.onclick = () => this.zurueck();
    }
    knopf('start', 'Start');
    for (const key of MODUL_KEYS) knopf(key, `<i style="background:${MODUL_INFO[key].farbe}"></i>${MODUL_INFO[key].kurz}`);
    nav.appendChild(h('span', 'flz-luecke'));
    const sprung = nav.appendChild(h('span', 'flz-sprung'));
    const ziele = this.seite === 'start' ? [['flz-plan', 'Was steht an'], ['flz-module', 'Module'], ['flz-woche', 'Woche']]
      : [['flz-m-sieben', 'Nächste 7 Tage'], ['flz-m-themen', 'Themen']];
    for (const [id, t] of ziele) {
      const a = sprung.appendChild(h('button', 'flz-nav-a', t));
      a.onclick = () => { const z = this.contentEl.querySelector('#' + id); if (z) z.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    }
    this.contentEl.onscroll = () => nav.classList.toggle('is-unten', this.contentEl.scrollTop > 40);
  }


  // Zwischen Startseite und Modulseiten wechseln, ohne eine Datei zu öffnen
  zeigeSeite(seite, zurueck = false) {
    if (!zurueck && seite !== this.seite) this.verlauf.push(this.seite);
    this.seite = seite;
    this.render(true);
    this.app.workspace.requestSaveLayout();
  }

  // Zurück: erst innerhalb der Lernzentrale, sonst wie der Pfeil von Obsidian
  zurueck() {
    const hist = this.leaf.history;
    if (hist && hist.backHistory && hist.backHistory.length) hist.back();
  }


  // Datei in einem neuen Tab öffnen, damit die Lernzentrale offen bleibt
  oeffneDatei(pfad) {
    if (/\.(docx?|pptx|xlsx)$/i.test(pfad)) this.app.openWithDefaultApp(pfad);
    else {
      const f = this.app.vault.getAbstractFileByPath(pfad);
      if (f instanceof obsidian.TFile) this.leaf.openFile(f); else this.app.workspace.openLinkText(pfad, '', false);
    }
  }

  // Abhaken-Karte (Tafel und Modulseite): Kreis links, Titel, Fälligkeit
  baueKarte(ziel, k, d) {
    const ETIKETT = { lerneinheit: 'Lerneinheit', wiederholen: 'Wiederholen', abgabe: 'Abgabe', unterricht: 'Unterricht' };
    const rahmen = ziel.appendChild(h('div', 'flz-bk-rahmen'));
    const b = rahmen.appendChild(h('button', 'flz-bk' + (k.ueberfaellig ? ' is-ueber' : k.datum === d.tag ? ' is-heute' : '')));
    const haken = rahmen.appendChild(h('button', 'flz-haken'));
    haken.setAttribute('aria-label', `${k.text} abhaken`);
    haken.title = 'Abhaken';
    haken.onclick = async () => {
      const datei = this.app.vault.getAbstractFileByPath(CFG.board);
      if (!(datei instanceof obsidian.TFile) || !k.zeile) return;
      let ok = false;
      rahmen.classList.add('is-weg');
      try {
        await this.app.vault.process(datei, (alt) => { const neu = hakeAb(alt, k.zeile, heute(), k.spalte); ok = neu !== null; return neu === null ? alt : neu; });
      } catch (err) {
        console.error('fa-lerneinheit Abhaken', err);
        rahmen.classList.remove('is-weg');
        new obsidian.Notice(`Abhaken ging nicht: ${err.message}`);
        return;
      }
      if (!ok) { rahmen.classList.remove('is-weg'); new obsidian.Notice('Die Karte hat sich im Board geändert. Bitte dort abhaken.'); }
    };
    const wann = (k.wann || '').split(' · ').map((t, i) => (i ? ` <span class="flz-bk-datum">· ${escHtml(t)}</span>` : `<span class="flz-bk-rel">${escHtml(t)}</span>`)).join('');
    b.innerHTML = `<b>${escHtml(k.text)}</b>${k.art === 'wiederholen' ? `<span class="flz-bk-hinweis">${folgtHinweis()}</span>` : ''}<span class="flz-bk-zeile">${k.art ? `<span class="flz-etikett is-${k.art}">${ETIKETT[k.art]}</span>` : ''}<span class="flz-bk-wann">${wann}</span></span>`;
    // Wiederholen-Karten: Die Routine baut die Einheit erst noch, deshalb führen sie auf die Modulseite (Wunsch 11.11.)
    if (k.art === 'wiederholen') {
      b.onclick = () => {
        const key = Object.keys(MODUL_SPALTEN).find((x) => MODUL_SPALTEN[x] === k.spalte);
        if (key && key !== this.seite) this.zeigeSeite(key);
        new obsidian.Notice(`${folgtNotice(k.text)} Bis dahin helfen Theorie und Quiz oben im Menü.`, 10000);
      };
    } else if (k.link) b.onclick = () => this.oeffne(k.link);
    else b.disabled = true;
  }

  // Erledigt-Streifen unter der Tafel: zuletzt abgehakte Aufgaben, die neuesten zuerst
  baueErledigt(sec, d) {
    const liste = erledigtListe(d.board.erledigt || [], (l) => this.fm(l));
    if (!liste.length) return;
    const box = sec.appendChild(h('div', 'flz-erledigt'));
    const kopf = box.appendChild(h('div', 'flz-erl-kopf'));
    kopf.innerHTML = `<span class="flz-erl-titel">${icon('<path d="M20 6 9 17l-5-5"/>')}Erledigt</span><span class="flz-leise">${liste.length} ${liste.length === 1 ? 'Aufgabe' : 'Aufgaben'}</span>`;
    const ul = box.appendChild(h('ul', 'flz-erl-liste'));
    const MAX = 8;
    liste.forEach((k, i) => {
      const li = ul.appendChild(h('li', i >= MAX ? 'is-mehr' : ''));
      const m = k.modul && MODUL_INFO[k.modul];
      li.innerHTML = `${m ? `<i style="background:${m.farbe}" title="${m.kurz}"></i>` : '<i class="is-leer"></i>'}<span>${escHtml(k.text)}</span>`;
      if (k.link) {
        li.classList.add('is-link');
        li.tabIndex = 0;
        li.onclick = () => this.oeffne(k.link);
        li.onkeydown = (e) => { if (e.key === 'Enter') this.oeffne(k.link); };
      }
    });
    if (liste.length > MAX) {
      const knopf = box.appendChild(h('button', 'flz-sp-mehr'));
      const setze = () => { box.classList.toggle('is-alle', !!this.erledigtAlle); knopf.textContent = this.erledigtAlle ? 'weniger anzeigen' : `alle ${liste.length} anzeigen`; };
      knopf.onclick = () => { this.erledigtAlle = !this.erledigtAlle; setze(); };
      setze();
    }
  }

  // Menüs und Info-Kasten: öffnen beim Drüberfahren, bleiben nach dem Verlassen noch kurz offen (schräg zur Liste fahren),
  // ein Klick auf den Knopf hält sie offen, bis man daneben klickt oder Esc drückt 
  aufklapper(w, knopf) {
    let zu = null;
    w.addEventListener('mouseenter', () => { window.clearTimeout(zu); this.alleZu(w); w.classList.add('is-auf'); });
    w.addEventListener('mouseleave', () => {
      window.clearTimeout(zu);
      zu = window.setTimeout(() => { if (!w.classList.contains('is-fix')) w.classList.remove('is-auf'); }, 200);
    });
    knopf.addEventListener('click', (e) => {
      e.stopPropagation();
      const fix = !w.classList.contains('is-fix');
      this.alleZu();
      if (fix) w.classList.add('is-fix', 'is-auf'); else knopf.blur();
    });
  }

  alleZu(ausser = null) {
    for (const el of this.contentEl.querySelectorAll('.flz-menu.is-auf, .flz-info.is-auf')) if (el !== ausser) el.classList.remove('is-auf', 'is-fix');
  }

  // ── Modulseite ──
  baueModulseite(seite, key, d) {
    const m = MODUL_INFO[key], p = PRUEFUNG[key];
    const plan = (d.module.find((x) => x.key === key) || {}).plan;
    const kopf = seite.appendChild(h('div', 'flz-mkopf'));
    const links = kopf.appendChild(h('div', 'flz-mkopf-links'));
    links.innerHTML = `<h1 class="flz-gruss flz-mtitel"><i style="background:${m.farbe}"></i>${escHtml(m.name)}</h1>`;
    const unter = links.appendChild(h('p', 'flz-gruss-unter'));
    const rest = tageBis(d.tag, p.datum);
    unter.innerHTML = `${escHtml(pruefungsSatz(p))} · <b>${rest > 0 ? `noch ${rest} Tage` : rest === 0 ? 'heute' : 'vorbei'}</b>`;
    const info = unter.appendChild(h('span', 'flz-info'));
    info.tabIndex = 0;
    info.setAttribute('aria-label', 'Details zur Prüfung');
    this.aufklapper(info, info);
    info.innerHTML = `${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>')}<span class="flz-info-box" role="tooltip"><b>Form</b><span>${escHtml(p.form)}</span><b>Bewertung</b><span>${escHtml(p.punkte)}</span><b>Hilfsmittel</b><span>${escHtml(p.hilfsmittel)}</span></span>`;

    // Drei Menüs: Theorie, Alle Quiz, Unterlagen – gehen beim Drüberfahren oder mit Tab auf
    const ordner = `Module/${MODUL_SPALTEN[key]}`;
    const dateien = this.app.vault.getFiles().map((f) => ({ path: f.path, basename: f.basename, extension: f.extension, fm: f.extension === 'md' ? (this.app.metadataCache.getFileCache(f) || {}).frontmatter || null : null }));
    const md = modulDateien(dateien, ordner, UNTERLAGEN[key]);
    const menues = kopf.appendChild(h('div', 'flz-menues'));
    const menu = (titel, ikon, eintraege, zeile, gruppen = null) => {
      const w = menues.appendChild(h('div', 'flz-menu' + (gruppen ? ' is-gruppen' : '')));
      const b = w.appendChild(h('button', 'flz-btn flz-menu-knopf'));
      b.innerHTML = `${icon(ikon)}${titel}<span class="flz-menu-zahl">${eintraege.length}</span>`;
      b.setAttribute('aria-haspopup', 'true');
      const box = w.appendChild(h('div', 'flz-menu-box'));
      this.aufklapper(w, b);
      box.addEventListener('click', (e) => e.stopPropagation());
      if (!eintraege.length) { box.appendChild(h('div', 'flz-menu-leer', 'Noch nichts im Modulordner.')); return; }
      // Lange Listen (Unterlagen) bekommen ein Suchfeld
      const knoepfe = [];
      if (eintraege.length > 12) {
        const such = box.appendChild(h('input', 'flz-menu-such'));
        such.type = 'search';
        such.placeholder = `${eintraege.length} Dateien durchsuchen …`;
        such.oninput = () => {
          const q = such.value.trim().toLowerCase();
          for (const [a, e] of knoepfe) a.hidden = !!q && !e.basename.toLowerCase().includes(q);
          // Beim Suchen alle Gruppen offen, leere ausblenden; ohne Suche wieder wie vorher
          for (const g of box.querySelectorAll('.flz-menu-gruppe')) {
            const treffer = [...g.querySelectorAll('.flz-menu-a')].some((a) => !a.hidden);
            g.hidden = !!q && !treffer;
            if (q) g.open = true; else g.open = g.dataset.offen === '1';
          }
        };
      }
      const eintrag = (ziel, e) => {
        const a = ziel.appendChild(h('button', 'flz-menu-a'));
        a.innerHTML = zeile(e);
        a.title = e.basename;
        a.onclick = () => this.oeffneDatei(e.path);
        knoepfe.push([a, e]);
      };
      if (!gruppen) { eintraege.forEach((e) => eintrag(box, e)); return; }
      // Unterlagen: aufklappbare Gruppen, „Wichtig“ ist offen
      for (const g of gruppen) {
        const det = box.appendChild(h('details', 'flz-menu-gruppe'));
        det.dataset.offen = g.titel === 'Wichtig' ? '1' : '0';
        det.open = g.titel === 'Wichtig';
        det.appendChild(h('summary')).innerHTML = `<span>${escHtml(g.titel)}</span><span class="flz-menu-zahl">${g.dateien.length}</span>`;
        g.dateien.forEach((e) => eintrag(det, e));
      }
    };
    menu('Theorie', '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>', md.theorie, (e) => `<span>${escHtml(e.basename)}</span>`);
    menu('Alle Quiz', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17h.01"/>', md.quiz, (e) => {
      const r = letzteRunde(d.quiz, e.path);
      const name = e.basename.replace(/ – Quiz$/, '');
      const stufe = r ? (r.prozent >= 80 ? ' is-gut' : r.prozent >= 60 ? ' is-knapp' : ' is-hinten') : '';
      return `<span>${escHtml(name)}${e.fm && e.fm.probepruefung ? ' <small>Probeprüfung</small>' : ''}</span><span class="flz-menu-wert${stufe}">${r ? `${r.prozent} % · ${kurz(r.datum)}` : 'noch nie'}</span>`;
    });
    menu('Unterlagen', '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>', md.unterlagen, (e) => `<span>${escHtml(e.basename)}</span><span class="flz-menu-typ">${e.extension === 'md' ? 'Notiz' : e.extension.toUpperCase()}</span>`, unterlagenGruppen(md.unterlagen));

    // Fahrplan (FA, Mathe): Zahlen, Druckzeile, Balken, 7 Tage, Probeprüfung, Themen eingeklappt – Logik der Fahrplan-Ansicht
    if (plan) {
      const box = seite.appendChild(h('section', 'flz-mfahrplan'));
      const kind = new FahrplanAnsicht(box, this.plugin, plan.plan, { einbett: true, todos: (root) => this.baueSieben(root, key, d) });
      this.kinder.push(kind);
      this.addChild(kind);
      return;
    }
    const sec = seite.appendChild(h('section', 'flz-mohne'));
    this.baueSieben(sec, key, d);
    const hinweis = sec.appendChild(h('div', 'flz-leer-box flz-m-hinweis'));
    hinweis.innerHTML = `<b>Noch kein Prüfungsfahrplan für ${escHtml(m.kurz)}</b><p>Sobald es einen gibt, siehst du hier Können, Soll, Note und die Themen im Detail. Theorie, Quiz und Unterlagen findest du oben in den Menüs.</p>`;
  }

  // Die nächsten 7 Tage eines Moduls als Karten mit Abhaken; fünf sichtbar, Rest aufklappbar
  baueSieben(root, key, d) {
    const { karten, zurueck } = naechsteSiebenMitRest(d.board[key] || [], d.tag, FOKUS_MODULE.includes(key));
    const sec = root.appendChild(h('div', 'flz-sieben'));
    sec.id = 'flz-m-sieben';
    const satz = karten.length ? `<b>${karten.length} ${karten.length === 1 ? 'Aufgabe' : 'Aufgaben'}</b> bis ${kurz(plusTage(d.tag, 7))}` : 'Nichts fällig in den nächsten 7 Tagen.';
    sec.innerHTML = `<div class="flz-a-kopf"><div><h2>Die nächsten 7 Tage</h2><p class="flz-antwort">${satz}</p></div></div>`;
    if (zurueck.length) {
      const zu = sec.appendChild(h('details', 'flz-sp-zurueck flz-sieben-zurueck'));
      zu.appendChild(h('summary', null, `${zurueck.length} zurückgestellt`));
      const g = zu.appendChild(h('div', 'flz-sieben-gitter'));
      zurueck.forEach((k) => this.baueKarte(g, { ...k, ueberfaellig: false, wann: k.datum ? kurz(k.datum) : '' }, d));
      // Zurückgestellte stehen ganz unten, nach den eigenen Karten
      window.setTimeout(() => sec.appendChild(zu), 0);
    }
    if (!karten.length) return;
    const gitter = sec.appendChild(h('div', 'flz-sieben-gitter'));
    karten.slice(0, 5).forEach((k) => this.baueKarte(gitter, k, d));
    if (karten.length > 5) {
      const mehr = sec.appendChild(h('details', 'flz-sieben-mehr'));
      mehr.appendChild(h('summary', 'flz-sp-mehr', `+ ${karten.length - 5} weitere`));
      const g2 = mehr.appendChild(h('div', 'flz-sieben-gitter'));
      karten.slice(5).forEach((k) => this.baueKarte(g2, k, d));
    }
  }

  baueKopf(seite, d) {
    const k = seite.appendChild(h('div', 'flz-kopf'));
    const std = new Date().getHours();
    const gruss = std < 11 ? 'Guten Morgen' : std < 18 ? 'Guten Tag' : 'Guten Abend';
    const datum = new Date(d.tag + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' });
    const links = k.appendChild(h('div'));
    links.appendChild(h('div', 'flz-gruss', d.leer ? 'Willkommen in der Lernzentrale' : `${gruss}${CFG.name ? ', ' + CFG.name : ''}`));
    const unter = links.appendChild(h('div', 'flz-gruss-unter'));
    unter.innerHTML = `${escHtml(datum)} · ${d.naechste ? `<b>${escHtml(d.naechste.kurz)} in ${d.naechste.tage} Tagen</b>` : 'noch keine Prüfung eingetragen'}`;
    const chip = k.appendChild(h('span', 'flz-chip' + (d.serie.tage ? '' : ' is-aus')));
    chip.tabIndex = 0;
    const flamme = icon('<path d="M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3-1-3 0-6 1-8z"/>');
    chip.innerHTML = d.serie.tage
      ? `${flamme}${d.serie.tage} ${d.serie.tage === 1 ? 'Tag' : 'Tage'} am Stück<span class="flz-pop"><span class="flz-pop-gr">Lernserie</span><span class="flz-punkte">${d.serie.punkte.map((p, i, a) => `<i class="${i === a.length - 1 && summeMin(d.gelerntHeute) === 0 ? '' : 'is-ja'}">${p}</i>`).join('')}</span><span class="flz-pop-gr">Rekord: ${d.serie.rekord} Tage.</span></span>`
      : `${flamme}Noch keine Lernserie<span class="flz-pop"><span class="flz-pop-gr">Lerne an zwei Tagen hintereinander, dann beginnt hier deine Serie.</span></span>`;
  }

  baueHeute(seite, d) {
    const karte = seite.appendChild(h('section', 'flz-heute'));
    karte.setAttribute('aria-labelledby', 'flz-heute-titel');
    const gelernt = summeMin(d.gelerntHeute);
    const ring = karte.appendChild(h('div', 'flz-ringbox'));
    ring.tabIndex = 0;
    ring.setAttribute('aria-label', `Heute ${gelernt} von ${d.tagesziel} Minuten gelernt`);
    const teile = MODUL_KEYS.filter((k) => d.gelerntHeute[k] > 0);
    ring.innerHTML = `<div class="flz-ring-flaeche"><svg viewBox="0 0 144 144" aria-hidden="true"></svg>
      <div class="flz-ring-mitte"><div class="flz-ring-normal"><div class="flz-ring-zahl"><span data-zaehl="${gelernt}">${gelernt}</span><small>von ${d.tagesziel} min</small></div></div>
      <div class="flz-ring-detail">${teile.map((k) => `<div><i style="background:${MODUL_INFO[k].farbe}"></i>${MODUL_INFO[k].kurz} ${d.gelerntHeute[k]} min</div>`).join('')}<div><i class="is-rest"></i>noch ${Math.max(0, d.tagesziel - gelernt)} min</div></div></div></div>
      <div class="flz-ring-leg">${teile.map((k) => `<span><i style="background:${MODUL_INFO[k].farbe}"></i>${MODUL_INFO[k].kurz} ${d.gelerntHeute[k]}</span>`).join('')}</div>`;
    // Ring B: flache Stücke pro Modul, feine Fuge dazwischen
    const svg = ring.querySelector('svg'), R = 64, c = 72, U = 2 * Math.PI * R, ziel = Math.max(d.tagesziel, gelernt, 1);
    svgEl('circle', { class: 'flz-r-spur', cx: c, cy: c, r: R }, svg);
    let start = 0;
    teile.forEach((k, i) => {
      const len = U * d.gelerntHeute[k] / ziel;
      const a = svgEl('circle', { class: 'flz-r-teil', cx: c, cy: c, r: R, stroke: MODUL_INFO[k].farbe, 'stroke-dasharray': `0 ${U}`, transform: `rotate(${-90 + start / U * 360} ${c} ${c})` }, svg);
      window.setTimeout(() => a.setAttribute('stroke-dasharray', `${len} ${U}`), 200 + i * 450);
      start += len;
      if (i < teile.length - 1) {
        const w = (-90 + start / U * 360) * Math.PI / 180;
        svgEl('line', { class: 'flz-r-fuge', x1: c + (R - 8) * Math.cos(w), y1: c + (R - 8) * Math.sin(w), x2: c + (R + 8) * Math.cos(w), y2: c + (R + 8) * Math.sin(w) }, svg);
      }
    });

    const rechts = karte.appendChild(h('div'));
    if (d.leer) {
      rechts.className = 'flz-heute-leer';
      rechts.innerHTML = `<span class="flz-h">So startest du</span><ol><li><b>Prüfungsfahrplan</b> für ein Modul anlegen: Prüfungsdatum und Themen.</li><li><b>Erste Lerneinheit</b> öffnen. Der Timer zählt deine Lernzeit automatisch.</li><li>Ab dann zeigt dir die Lernzentrale jeden Tag eine <b>Etappe</b>.</li></ol>`;
      const b = rechts.appendChild(h('button', 'flz-btn is-cta', 'Fahrplan anlegen'));
      b.onclick = () => { this.app.setting.open(); this.app.setting.openTabById(this.plugin.manifest.id); };
      return;
    }
    const fertig = d.etappe.filter((p) => p.status === 'fertig').length;
    const rest = d.etappe.filter((p) => p.status !== 'fertig').reduce((s, p) => s + (p.minuten || 0), 0);
    rechts.innerHTML = `<div class="flz-et-kopf"><span class="flz-h" id="flz-heute-titel">Deine Etappe heute</span><span class="flz-et-stand">${d.etappe.length ? `<b>${fertig} von ${d.etappe.length}</b> Posten${rest ? ` · noch etwa ${rest} min` : ''}` : ''}</span></div>`;
    if (!d.etappe.length) { rechts.appendChild(h('p', 'flz-leise', 'Heute ist nichts geplant.')); return; }
    const schritte = rechts.appendChild(h('div', 'flz-schritte'));
    schritte.style.gridTemplateColumns = `repeat(${d.etappe.length}, minmax(0, 1fr)) 120px`;
    d.etappe.forEach((p, i) => {
      const s = schritte.appendChild(h('div', `flz-schritt is-${p.status}`));
      s.appendChild(h('span', 'flz-knoten')).innerHTML = p.status === 'fertig' ? icon('<path d="M20 6 9 17l-5-5"/>') : String(i + 1);
      const t = s.appendChild(h('div', 'flz-s-text'));
      const titel = t.appendChild(h('b', null, p.text));
      titel.title = p.text;
      const m = p.modul ? MODUL_INFO[p.modul] : null;
      t.appendChild(h('div', 'flz-s-meta')).innerHTML = (m ? `<i style="background:${m.farbe}"></i>` : '') + [m ? m.kurz : '', p.minuten ? `${p.minuten} min` : ''].filter(Boolean).join(' · ');
      if (p.grund) t.appendChild(h('div', 'flz-s-grund', p.grund));
      if (p.status === 'jetzt') {
        const b = t.appendChild(h('button', 'flz-btn is-cta'));
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Starten';
        b.onclick = () => this.oeffne(p.link);
      }
    });
    const z = schritte.appendChild(h('div', 'flz-schritt is-ziel'));
    z.appendChild(h('span', 'flz-zielknoten'));
    z.appendChild(h('div', 'flz-ziel-txt')).innerHTML = d.ziel ? `<b>${d.ziel.neu}&nbsp;%</b>${d.ziel.kurz} am Ziel, <span class="flz-nowrap">statt ${d.ziel.ist}&nbsp;%</span>` : '<b>Ziel</b>';
  }

  baueWoche(seite, d) {
    const sec = seite.appendChild(h('section', 'flz-abschnitt flz-rein'));
    sec.id = 'flz-woche';
    const tag = plusTage(d.tag, this.wocheVersatz * 7);
    const w = this.wocheVersatz ? wocheVon(d.proTag, tag) : d.woche;
    const montag = w.tage[0].iso, sonntag = w.tage[6].iso;
    const vorTag = WOCHENTAG_LANG[wochentag(tag)];
    const diff = w.summeBisHeute - w.vorBisHeute;
    sec.innerHTML = `<div class="flz-a-kopf"><div><h2>Lerne ich genug?</h2><p class="flz-antwort">${w.summeBisHeute
      ? `Bis ${this.wocheVersatz ? 'Sonntag' : 'heute'} <b>${fmtMin(w.summeBisHeute)}</b>, letzte Woche bis ${vorTag} ${fmtMin(w.vorBisHeute)} · <span class="${diff >= 0 ? 'is-plus' : 'is-minus'}">${diff >= 0 ? '+' : ''}${diff} min</span>`
      : 'In dieser Woche ist noch keine Lernzeit erfasst.'}</p></div>
      <div class="flz-wochenwahl"><button class="flz-btn is-rund" aria-label="Vorige Woche">‹</button><span>KW ${kw(montag)} · ${kurz(montag)}–${kurz(sonntag)}</span><button class="flz-btn is-rund" aria-label="Nächste Woche" ${this.wocheVersatz >= 0 ? 'disabled' : ''}>›</button></div></div>
      <div class="flz-woche-rahmen"><div><svg class="flz-chart" role="img" aria-label="Lernzeit pro Tag, gestapelt nach Modul, daneben grau die Vorwoche"></svg><div class="flz-legende"></div></div><div class="flz-tafel" aria-live="polite"></div></div>`;
    const [zur, vor] = sec.querySelectorAll('.flz-wochenwahl button');
    zur.onclick = () => { this.wocheVersatz--; this.render(); this.springe('flz-woche'); };
    vor.onclick = () => { if (this.wocheVersatz < 0) { this.wocheVersatz++; this.render(); this.springe('flz-woche'); } };
    const summenModul = leerMinuten();
    w.tage.forEach((t) => MODUL_KEYS.forEach((k) => { summenModul[k] += t.minuten[k]; }));
    const leg = sec.querySelector('.flz-legende');
    leg.innerHTML = MODUL_KEYS.filter((k) => summenModul[k]).map((k) => `<span><i style="background:${MODUL_INFO[k].farbe}"></i>${MODUL_INFO[k].kurz}</span>`).join('') + '<span><i class="is-vor"></i>Vorwoche</span>';
    const tafel = sec.querySelector('.flz-tafel');
    const wocheTafel = () => {
      const summe = w.tage.reduce((s, t) => s + t.summe, 0), wz = Number(CFG.wochenzielMin) || 360;
      const zeilen = MODUL_KEYS.filter((k) => summenModul[k]).sort((a, b) => summenModul[b] - summenModul[a])
        .map((k) => `<div class="flz-zl"><i style="background:${MODUL_INFO[k].farbe}"></i>${MODUL_INFO[k].name}<b>${summenModul[k]} min</b><span class="flz-zl-bar"><u style="width:${summenModul[k] / Math.max(1, summe) * 100}%;background:${MODUL_INFO[k].farbe}"></u></span></div>`).join('');
      tafel.innerHTML = `<span class="flz-t"><span>${this.wocheVersatz ? 'Ganze Woche' : 'Woche bis heute'}</span><span>Ziel ${fmtMin(wz)} · ${Math.round(summe / wz * 100)} %</span></span>
        <span class="flz-gz">${fmtMin(summe)}</span><div class="flz-zeilen">${zeilen || '<p class="flz-leise">Lernzeit erscheint hier, sobald du eine Lerneinheit mit Timer machst.</p>'}</div>
        <div class="flz-fuss">Vorwoche bis ${vorTag}: <b>${fmtMin(w.vorBisHeute)}</b></div>`;
    };
    const tagTafel = (t) => {
      const zeilen = MODUL_KEYS.filter((k) => t.minuten[k]).map((k) => `<div class="flz-zl"><i style="background:${MODUL_INFO[k].farbe}"></i>${MODUL_INFO[k].name}<b>${t.minuten[k]} min</b></div>`).join('');
      const df = t.summe - t.vor;
      tafel.innerHTML = `<span class="flz-t"><span>${WOCHENTAG_LANG[wochentag(t.iso)]}, ${kurz(t.iso)}</span><span>${t.heute ? 'heute' : ''}</span></span>
        <span class="flz-gz">${t.summe ? t.summe + ' min' : '–'}</span><div class="flz-zeilen">${zeilen || `<p class="flz-leise">${t.zukunft ? 'Dieser Tag kommt noch.' : 'An diesem Tag nicht gelernt.'}</p>`}</div>
        <div class="flz-fuss">Vorwoche: <b>${t.vor} min</b>${t.summe ? ` · <span class="${df >= 0 ? 'is-plus' : 'is-minus'}">${df >= 0 ? '+' : ''}${df} min</span>` : ''}</div>`;
    };
    wocheTafel();
    // Erst zeichnen, wenn die Seite im DOM hängt: vorher ist die Breite 0 und die Grafik wird gestaucht (Prüfer 4)
    const svgW = sec.querySelector('.flz-chart');
    // Bei jeder Breitenänderung neu zeichnen (Fenster ziehen, Seite erst später sichtbar)
    if (this.roWoche) this.roWoche.disconnect();
    let breite = 0;
    this.roWoche = new ResizeObserver(() => {
      const b = Math.round(svgW.clientWidth);
      if (!b || b === breite) return;
      breite = b;
      this.zeichneWoche(svgW, w, tagTafel, wocheTafel);
    });
    this.roWoche.observe(svgW);
    this.register(() => this.roWoche && this.roWoche.disconnect());
  }

  zeichneWoche(svg, w, tagTafel, wocheTafel) {
    svg.replaceChildren();
    const W = svg.clientWidth || 640, Hh = 240;
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    const hoch = Math.max(...w.tage.map((t) => Math.max(t.summe, t.vor)));
    const max = Math.max(60, Math.ceil(hoch / 30) * 30 + 30), base = Hh - 26, top = 22, H = base - top, links = 28, sp = (W - links) / 7;
    const y = (v) => base - v / max * H;
    [1, 2, 3].forEach((n) => { const v = max / 3 * n; svgEl('line', { class: 'flz-gitter', x1: links, x2: W, y1: y(v), y2: y(v) }, svg); svgEl('text', { class: 'flz-achse', x: links - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = v; });
    svgEl('line', { class: 'flz-basis', x1: links, x2: W, y1: base, y2: base }, svg);
    const bw = Math.min(30, sp * 0.36), vw = Math.round(bw * 0.55), gp = 3;
    w.tage.forEach((t, i) => {
      const cxa = links + (i + 0.5) * sp, cx = cxa - (vw + gp) / 2;
      const g = svgEl('g', { class: 'flz-tag', tabindex: 0, role: 'button', 'aria-label': `${WOCHENTAG_LANG[wochentag(t.iso)]}: ${t.summe} Minuten, Vorwoche ${t.vor}` }, svg);
      svgEl('rect', { class: 'flz-tag-feld' + (t.heute ? ' is-heute' : ''), x: cxa - sp / 2 + 3, y: top - 20, width: sp - 6, height: H + 20, rx: 9 }, g);
      if (t.vor) svgEl('rect', { class: 'flz-vor', x: cx + bw / 2 + gp, y: y(t.vor), width: vw, height: base - y(t.vor), rx: 3 }, g);
      let yy = base, k = 0;
      for (const m of MODUL_KEYS) {
        if (!t.minuten[m]) continue;
        const hgt = t.minuten[m] / max * H; yy -= hgt;
        const r = svgEl('rect', { class: 'flz-saeule', x: cx - bw / 2, y: yy, width: bw, height: Math.max(hgt - 2, 1), rx: 4, fill: MODUL_INFO[m].farbe }, g);
        r.style.animationDelay = `${150 + i * 80 + k * 100}ms`;
        k++;
      }
      svgEl('text', { class: 'flz-tag-name' + (t.heute ? ' is-heute' : ''), x: cxa, y: Hh - 6, 'text-anchor': 'middle' }, g).textContent = t.kurz;
      const an = () => { svg.classList.add('is-fokus'); g.classList.add('is-an'); tagTafel(t); };
      const ab = () => { svg.classList.remove('is-fokus'); g.classList.remove('is-an'); };
      g.addEventListener('mouseenter', an); g.addEventListener('focus', an); g.addEventListener('click', an);
      g.addEventListener('mouseleave', ab); g.addEventListener('blur', () => { ab(); wocheTafel(); });
    });
    svg.addEventListener('mouseleave', wocheTafel);
  }

  springe(id) { const z = this.contentEl.querySelector('#' + id); if (z) { z.classList.add('is-da'); z.scrollIntoView({ block: 'start' }); } }

  baueModule(seite, d) {
    const sec = seite.appendChild(h('section', 'flz-abschnitt flz-rein'));
    sec.id = 'flz-module';
    const hinten = d.module.filter((m) => m.k && (m.k.druck === 'alarm' || m.k.druck === 'hinten'));
    const mitPlan = d.module.filter((m) => m.k);
    sec.innerHTML = `<div class="flz-a-kopf"><div><h2>Wo stehe ich?</h2><p class="flz-antwort">${mitPlan.length
      ? `<b>${hinten.length} von ${mitPlan.length}</b> Modulen mit Fahrplan hinter dem Soll${hinten.length ? ': ' + hinten.map((m) => m.kurz).join(', ') : ''}`
      : 'Noch kein Modul mit Fahrplan.'}</p></div><span class="flz-leise">Ring = Können · Strich = Soll heute</span></div>`;
    if (!mitPlan.length) {
      sec.appendChild(h('div', 'flz-leer-box')).innerHTML = '<b>Noch kein Prüfungsfahrplan</b><p>Leg für ein Modul Prüfungsdatum und Themen fest. Dann siehst du hier, wie viel du schon kannst und wie viel du bis heute können solltest.</p>';
      return;
    }
    const reihe = sec.appendChild(h('div', 'flz-modkarten'));
    const panel = sec.appendChild(h('div', 'flz-modpanel'));
    panel.setAttribute('aria-live', 'polite');
    const R = 20, U = 2 * Math.PI * R;
    const zeigePanel = (m) => {
      if (!m.k) {
        panel.innerHTML = `<div><div class="flz-lbl">${escHtml(m.name)}</div><div class="flz-wert">Noch kein Fahrplan</div></div><div class="flz-leise">Kommt mit dem nächsten Ausbau der Lernzentrale.</div>`;
        panel.appendChild(h('button', 'flz-btn', 'Zur Modulseite ›')).onclick = () => this.zeigeSeite(m.key);
        return;
      }
      const k = m.k, komma = (n) => n.toFixed(1).replace('.', ',');
      panel.innerHTML = `<div><div class="flz-lbl">Prüfung</div><div class="flz-wert">${kurz(m.plan.plan.pruefung)} <small>· in ${k.rest} Tagen</small></div></div>
        <div><div class="flz-lbl">Note, wenn heute Prüfung wäre</div><div class="flz-wert">${komma(k.note)}${k.ziel ? ` <small>· Ziel ${komma(k.ziel)}</small>` : ''}</div></div>
        <div><div class="flz-lbl">${k.wackelig.length ? 'Wackelig, bald wiederholen' : 'Nächster Meilenstein'}</div>${k.wackelig.length
          ? `<div class="flz-wack">${k.wackelig.slice(0, 3).map((t) => `<span>${escHtml(t)}</span>`).join('')}</div>`
          : `<div class="flz-wert">${k.meilenstein ? `${escHtml(k.meilenstein.text)} <small>· ${kurz(k.meilenstein.datum)}</small>` : 'alles sitzt'}</div>`}</div>`;
      const b = panel.appendChild(h('button', 'flz-btn', 'Zur Modulseite ›'));
      b.onclick = () => this.zeigeSeite(m.key);
    };
    d.module.forEach((m) => {
      const druck = m.k ? m.k.druck : 'ruhe';
      const b = reihe.appendChild(h('button', `flz-mk is-${druck}`));
      b.setAttribute('aria-pressed', String(m.key === this.modulWahl));
      b.setAttribute('aria-label', m.k ? `${m.name}: ${m.k.ist} Prozent, Soll ${m.k.soll}` : `${m.name}: noch kein Fahrplan`);
      const a = m.k ? (m.k.soll / 100) * 2 * Math.PI - Math.PI / 2 : 0;
      b.innerHTML = `<span class="flz-mk-name"><i style="background:${m.farbe}"></i>${escHtml(m.name)}</span>
        <span class="flz-mk-mitte"><svg class="flz-mk-ring" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="${R}" class="flz-mk-spur"/>${m.k ? `<circle class="flz-mk-ist" cx="25" cy="25" r="${R}" stroke-dasharray="${U}" stroke-dashoffset="${U}" data-ziel="${U * (1 - m.k.ist / 100)}" transform="rotate(-90 25 25)"/>` : ''}${m.k && m.k.soll ? `<line class="flz-mk-soll" x1="${25 + (R - 6) * Math.cos(a)}" y1="${25 + (R - 6) * Math.sin(a)}" x2="${25 + (R + 6) * Math.cos(a)}" y2="${25 + (R + 6) * Math.sin(a)}"/>` : ''}</svg>
        <span><span class="flz-mk-wert">${m.k ? m.k.ist + ' %' : '–'}</span><span class="flz-mk-soll-txt">${m.k ? `Soll ${m.k.soll} %` : 'kein Fahrplan'}</span></span></span>
        <span class="flz-stand">${icon(STAND_ICON[druck])}${STAND_WORT[druck]}</span>`;
      const wahl = () => { this.modulWahl = m.key; reihe.querySelectorAll('.flz-mk').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); zeigePanel(m); };
      b.addEventListener('mouseenter', wahl); b.addEventListener('focus', wahl); b.addEventListener('click', wahl);
    });
    zeigePanel(d.module.find((m) => m.key === this.modulWahl) || d.module[0]);
    window.setTimeout(() => reihe.querySelectorAll('.flz-mk-ist').forEach((c, i) => window.setTimeout(() => c.setAttribute('stroke-dashoffset', c.dataset.ziel), i * 90)), 350);
  }

  bauePlan(seite, d) {
    const sec = seite.appendChild(h('section', 'flz-abschnitt flz-rein'));
    sec.id = 'flz-plan';
    const offen = MODUL_KEYS.reduce((s, k) => s + d.board[k].length, 0);
    const abgaben = MODUL_KEYS.flatMap((k) => d.board[k].filter((c) => c.art === 'abgabe' && c.datum && c.datum >= d.tag).map((c) => ({ ...c, modul: k }))).sort((a, b) => (a.datum < b.datum ? -1 : 1));
    const n = abgaben[0];
    sec.innerHTML = `<div class="flz-a-kopf"><div><h2>Was steht an?</h2><p class="flz-antwort">${offen ? `<b>${offen} offene Aufgaben</b>${n ? `, nächste Abgabe: ${escHtml(MODUL_INFO[n.modul].kurz)} ${escHtml(n.text)} am ${kurz(n.datum)}` : ''}` : 'Noch keine Aufgaben auf dem Board.'}</p></div>
      <div class="flz-rechts"><div class="flz-seg" role="tablist" aria-label="Ansicht"><button role="tab" data-a="tafel">Tafel</button><button role="tab" data-a="kal">Kalender</button></div>
      <div class="flz-wochenwahl flz-monatwahl"><button class="flz-btn is-rund" aria-label="Voriger Monat">‹</button><span></span><button class="flz-btn is-rund" aria-label="Nächster Monat">›</button></div></div></div><div class="flz-plan-inhalt"></div>`;
    const inhalt = sec.querySelector('.flz-plan-inhalt');
    const mw = sec.querySelector('.flz-monatwahl');
    const zeige = () => {
      sec.querySelectorAll('[data-a]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.a === this.ansichtPlan)));
      mw.style.visibility = this.ansichtPlan === 'kal' ? 'visible' : 'hidden';
      inhalt.empty();
      if (this.ansichtPlan === 'tafel') this.baueTafel(inhalt, d); else this.baueKalender(inhalt, d, mw);
    };
    sec.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => { this.ansichtPlan = b.dataset.a; zeige(); }; });
    const [zur, vor] = mw.querySelectorAll('button');
    zur.onclick = () => { this.monatVersatz--; zeige(); };
    vor.onclick = () => { this.monatVersatz++; zeige(); };
    zeige();
    this.baueErledigt(sec, d);
  }

  baueTafel(inhalt, d) {
    const board = inhalt.appendChild(h('div', 'flz-board'));
    for (const key of MODUL_KEYS) {
      const m = MODUL_INFO[key], karten = d.board[key];
      const sp = board.appendChild(h('div', 'flz-spalte'));
      const vorne = tafelSpalte(karten, d.tag, Infinity, FOKUS_MODULE.includes(key)).sichtbar.length;
      sp.appendChild(h('div', 'flz-sp-kopf')).innerHTML = `<i style="background:${m.farbe}"></i>${m.kurz}<span>${vorne}</span>`;
      if (!karten.length) { sp.appendChild(h('div', 'flz-sp-leer', 'Keine Aufgaben')); continue; }
      const { sichtbar, rest, zurueck } = tafelSpalte(karten, d.tag, 4, FOKUS_MODULE.includes(key));
      const karte = (ziel, k) => this.baueKarte(ziel, k, d);
      sichtbar.forEach((k) => karte(sp, k));
      if (rest.length) {
        if (!this.offeneSpalten) this.offeneSpalten = new Set();
        const box = sp.appendChild(h('div', 'flz-sp-rest'));
        const knopf = sp.appendChild(h('button', 'flz-sp-mehr'));
        const setze = () => {
          const auf = this.offeneSpalten.has(key);
          box.hidden = !auf;
          knopf.textContent = auf ? 'weniger anzeigen' : `${rest.length} weitere anzeigen`;
          knopf.setAttribute('aria-expanded', String(auf));
        };
        rest.forEach((k) => karte(box, k));
        knopf.onclick = () => { if (this.offeneSpalten.has(key)) this.offeneSpalten.delete(key); else this.offeneSpalten.add(key); setze(); };
        setze();
      }
      if (zurueck.length) {
        const zu = sp.appendChild(h('details', 'flz-sp-zurueck'));
        zu.appendChild(h('summary', null, `${zurueck.length} zurückgestellt`));
        zurueck.forEach((k) => karte(zu, { ...k, ueberfaellig: false, wann: k.datum ? kurz(k.datum) : '' }));
      }
    }
  }

  baueKalender(inhalt, d, mw) {
    const basis = new Date(d.tag + 'T12:00:00Z');
    const erster = new Date(Date.UTC(basis.getUTCFullYear(), basis.getUTCMonth() + this.monatVersatz, 1, 12));
    const jahr = erster.getUTCFullYear(), monat = erster.getUTCMonth();
    mw.querySelector('span').textContent = `${MONAT[monat]}${jahr !== basis.getUTCFullYear() ? ' ' + jahr : ''}`;
    const tageImMonat = new Date(Date.UTC(jahr, monat + 1, 0, 12)).getUTCDate();
    const versatz = (erster.getUTCDay() + 6) % 7;
    const alle = MODUL_KEYS.flatMap((k) => d.board[k].map((c) => ({ ...c, modul: k }))).filter((c) => c.datum);
    const proDatum = new Map();
    for (const c of alle) { if (!proDatum.has(c.datum)) proDatum.set(c.datum, []); proDatum.get(c.datum).push(c); }
    const kal = inhalt.appendChild(h('div', 'flz-kal'));
    kal.setAttribute('role', 'grid');
    kal.innerHTML = `<div class="flz-kal-kopf">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((t) => `<span>${t}</span>`).join('')}</div>`;
    const grid = kal.appendChild(h('div', 'flz-kal-grid'));
    const liste = inhalt.appendChild(h('ul', 'flz-agenda'));
    for (let i = 0; i < versatz; i++) grid.appendChild(h('div', 'flz-kz is-leer'));
    for (let t = 1; t <= tageImMonat; t++) {
      const iso = `${jahr}-${String(monat + 1).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
      const min = summeMin(d.proTag.get(iso));
      const ev = proDatum.get(iso) || [];
      const wt = (versatz + t - 1) % 7;
      const z = grid.appendChild(h('div', 'flz-kz' + (wt >= 5 ? ' is-we' : '') + (iso < d.tag ? ' is-vorbei' : '') + (iso === d.tag ? ' is-heute' : '')));
      z.setAttribute('role', 'gridcell');
      z.setAttribute('aria-label', `${t}. ${MONAT[monat]}${min ? `, ${min} Minuten gelernt` : ''}${ev.length ? ', ' + ev.map((e) => e.text).join(', ') : ''}`);
      z.innerHTML = `<span class="flz-kz-nr">${t}</span>${ev.map((e) => `<span class="flz-ev" style="--farbe:${MODUL_INFO[e.modul].farbe}">${escHtml(e.text)}</span>`).join('')}${iso <= d.tag ? `<span class="flz-kz-min">${min ? min + ' min' : '–'}</span><span class="flz-kz-lern"><u style="width:${Math.min(100, min / 90 * 100)}%"></u></span>` : ''}`;
      if (ev.length || iso === d.tag) {
        const li = liste.appendChild(h('li'));
        li.innerHTML = `<span class="flz-ag-d${iso === d.tag ? ' is-heute' : ''}">${t}.</span><span class="flz-ag-e">${iso === d.tag ? `<span class="flz-leise">heute${min ? ` · ${min} min gelernt` : ''}</span>` : ''}${ev.map((e) => `<span class="flz-ev" style="--farbe:${MODUL_INFO[e.modul].farbe}">${escHtml(e.text)}</span>`).join('')}</span>`;
      }
    }
    while (grid.children.length % 7) grid.appendChild(h('div', 'flz-kz is-leer'));
  }

  baueFakt(seite, d) {
    const sec = seite.appendChild(h('section', 'flz-abschnitt flz-fakt-abschnitt flz-rein'));
    const box = sec.appendChild(h('div', 'flz-fakt'));
    box.appendChild(h('span', 'flz-fakt-ikon')).innerHTML = icon('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>');
    const satz = box.appendChild(h('span', 'flz-fakt-satz'));
    satz.setAttribute('aria-live', 'polite');
    if (!d.fakten.length) { satz.textContent = 'Nach deiner ersten Lernwoche erscheinen hier kleine Erkenntnisse zu deinem Lernen.'; return; }
    const nav = box.appendChild(h('span', 'flz-fakt-nav'));
    const zur = nav.appendChild(h('button', 'flz-btn is-rund', '‹')); zur.setAttribute('aria-label', 'Voriger Fakt');
    const nr = nav.appendChild(h('span', 'flz-fakt-nr'));
    const vor = nav.appendChild(h('button', 'flz-btn is-rund', '›')); vor.setAttribute('aria-label', 'Nächster Fakt');
    const zeige = () => { this.faktNr = (this.faktNr + d.fakten.length) % d.fakten.length; satz.innerHTML = d.fakten[this.faktNr]; nr.textContent = `${this.faktNr + 1} / ${d.fakten.length}`; };
    zur.onclick = () => { this.faktNr--; zeige(); };
    vor.onclick = () => { this.faktNr++; zeige(); };
    zeige();
  }
}

// Kalenderwoche nach ISO 8601
function kw(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const tag = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - tag + 3);
  const erster = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round(((d - erster) / 86400000 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7);
}

class Einstellungen extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl;
    el.empty();
    const feld = (key, name, desc) => new obsidian.Setting(el).setName(name).setDesc(desc)
      .addText((t) => t.setPlaceholder(STANDARD[key]).setValue(CFG[key]).onChange(async (v) => {
        CFG[key] = v.trim() || STANDARD[key];
        this.plugin.daten.einstellungen = { ...CFG };
        await this.plugin.saveData(this.plugin.daten);
      }));
    feld('board', 'To-do-Board', 'Pfad der Kanban-Datei, in der die Karten der Lerneinheiten stehen.');
    feld('spalte', 'Spalte im Board', 'Überschrift der Spalte (ohne ##), in die Wiederholen-Karten kommen.');
    feld('fortschritt', 'Fortschrittsnotiz', 'Pfad der Notiz mit der Tabelle Datum | Thema | Stufe | Material | Einschätzung.');
    feld('kontenplanPdf', 'Kontenplan-PDF', 'Dateiname des PDFs, das der Kontenplan-Knopf öffnet.');
    el.createEl('h3', { text: 'Lernzentrale' });
    const speichere = async () => { this.plugin.daten.einstellungen = { ...CFG }; await this.plugin.saveData(this.plugin.daten); };
    new obsidian.Setting(el).setName('Beim Start öffnen').setDesc('Die Lernzentrale erscheint, wenn Obsidian startet.')
      .addToggle((t) => t.setValue(CFG.startseite !== false).onChange(async (v) => { CFG.startseite = v; await speichere(); }));
    new obsidian.Setting(el).setName('Linke Leiste beim Start zuklappen').setDesc('Die Ordner-Leiste ist beim Start zu. Aufklappen geht jederzeit oben links.')
      .addToggle((t) => t.setValue(CFG.leisteZu !== false).onChange(async (v) => { CFG.leisteZu = v; await speichere(); }));
    new obsidian.Setting(el).setName('Wochenziel (Stunden)').setDesc('Wie viele Stunden du pro Woche lernen willst.')
      .addText((t) => t.setValue(String((Number(CFG.wochenzielMin) || 360) / 60)).onChange(async (v) => {
        const n = Number(String(v).replace(',', '.'));
        CFG.wochenzielMin = Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 360; await speichere(); }));
    new obsidian.Setting(el).setName('Name').setDesc('Für die Begrüssung, leer lassen für ohne Namen.')
      .addText((t) => t.setValue(CFG.name || '').onChange(async (v) => { CFG.name = v.trim(); await speichere(); }));
    el.createEl('h3', { text: 'Mathematik' });
    feld('matheFortschritt', 'Fortschrittsnotiz Mathe', 'Pfad der Notiz, in die jede Mathe-Aufgabe eine Zeile schreibt.');
    feld('matheFahrplan', 'Mathe-Fahrplan', 'Name der Seite mit dem Mathe-Prüfungsfahrplan.');
    feld('matheSpalte', 'Mathe-Spalte im Board', 'Überschrift der Board-Spalte für Mathe (ohne ##).');
    feld('spickSeite', 'Spick-Seite', 'Name der Seite mit dem spick-Block.');
    feld('spickPdf', 'Spick-PDF', 'Dateiname des PDFs, das der Spick-Knopf öffnet und das Plugin erzeugt.');
    new obsidian.Setting(el).setName('Taschenrechner').setDesc('Für dieses Modell zeigt der Lösungsweg die Tasten.')
      .addDropdown((d) => { for (const r of RECHNER) d.addOption(r, r); d.setValue(CFG.rechner).onChange(async (v) => {
        CFG.rechner = v; this.plugin.daten.einstellungen = { ...CFG }; await this.plugin.saveData(this.plugin.daten); }); });
    new obsidian.Setting(el).setName('Bonuspunkte Mathe').setDesc('Punkte aus dem Bonustest (0–6), zählen zur Note.')
      .addText((t) => t.setValue(String(CFG.matheBonus)).onChange(async (v) => {
        const n = Number(String(v).replace(',', '.'));
        CFG.matheBonus = Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : 0;
        this.plugin.daten.einstellungen = { ...CFG }; await this.plugin.saveData(this.plugin.daten); }));
  }
}

// ── Plugin ──
class FaLerneinheit extends obsidian.Plugin {
  async onload() {
    this.daten = Object.assign({ einheiten: {} }, await this.loadData());
    Object.assign(CFG, this.daten.einstellungen);
    this.addSettingTab(new Einstellungen(this.app, this));
    this.registerView(VIEW_LZ, (leaf) => new LernzentraleAnsicht(leaf, this));
    this.addCommand({ id: 'lernzentrale-oeffnen', name: 'Lernzentrale öffnen', callback: () => this.oeffneLernzentrale(true) });
    this.addRibbonIcon('layout-dashboard', 'Lernzentrale', () => this.oeffneLernzentrale(true));
    // Nur beim Start die Lernzentrale zeigen (abschaltbar); neue Tabs bleiben leer (Wunsch 10.11.)
    const schonOffen = this.app.workspace.layoutReady;
    this.app.workspace.onLayoutReady(() => {
      if (schonOffen) return;
      if (CFG.startseite !== false) this.oeffneLernzentrale(true);
      // Ordner-Leiste links zuklappen: Dateien erreicht man über die Menüs der Modulseiten (Wunsch 11.11.)
      if (CFG.leisteZu !== false && this.app.workspace.leftSplit) this.app.workspace.leftSplit.collapse();
    });
    this.aktive = new Set();
    // Timer, die beim letzten Beenden noch liefen, nur bis zum letzten Lebenszeichen zählen
    for (const [id, z] of Object.entries(this.daten.einheiten)) if (z.laeuft) this.daten.einheiten[id] = stoppeNachAbsturz(z);

    this.registerMarkdownCodeBlockProcessor('lerneinheit', (source, el, ctx) => {
      let roh;
      try { roh = obsidian.parseYaml(source); } catch (err) {
        el.appendChild(h('div', 'fle fle-fehler', `Lerneinheit konnte nicht gelesen werden: ${err.message}`));
        return;
      }
      const r = pruefeEinheit(roh);
      if (!r.ok) { el.appendChild(h('div', 'fle fle-fehler', `Lerneinheit fehlerhaft: ${r.fehler}`)); return; }
      ctx.addChild(new EinheitAnsicht(el, this, r.einheit, ctx.sourcePath));
    });

    // Handschrift für die Spick-Vorschau
    const b64 = this.schriftBase64();
    if (b64) {
      const st = document.head.appendChild(document.createElement('style'));
      st.textContent = `@font-face { font-family: "Handschrift"; src: url(data:font/ttf;base64,${b64}) format("truetype"); }`;
      this.register(() => st.remove());
    }

    // Spick (Mathe): Vorschau, Vorschlag übernehmen, PDF
    this.registerMarkdownCodeBlockProcessor('spick', (source, el, ctx) => {
      let roh;
      try { roh = obsidian.parseYaml(source); } catch (err) { roh = null; }
      const r = pruefeSpick(roh);
      if (!r.ok) { el.appendChild(h('div', 'fle fle-fehler', `Spick fehlerhaft: ${r.fehler}`)); return; }
      ctx.addChild(new SpickAnsicht(el, this, r.spick, ctx.sourcePath, istVorschlagSeite(ctx.sourcePath, CFG.spickSeite)));
    });

    // Lerneinheiten und der Spick öffnen immer in der Leseansicht (wie die Quizseiten)
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!file) return;
      const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter;
      if (!fm || (fm.art !== 'Lerneinheit' && fm.spick !== true)) return;
      const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view && view.file === file && view.getMode() !== 'preview') {
        const st = view.leaf.getViewState();
        st.state = Object.assign({}, st.state, { mode: 'preview' });
        view.leaf.setViewState(st);
      }
    }));

    // Karten auf dem Board, die auf eine Lerneinheit zeigen, eigens einfärben (Farbe in styles.css)
    this.kartenStil = document.head.appendChild(document.createElement('style'));
    this.register(() => this.kartenStil.remove());
    const markiere = obsidian.debounce(() => this.markiereKarten(), 300, true);
    this.app.workspace.onLayoutReady(() => markiere());
    this.registerEvent(this.app.metadataCache.on('resolved', markiere));

    // Prüfungsfahrplan: Ansicht plus fällige Wiederholungen aufs Board (beim Start, bei neuer Einschätzung, stündlich)
    this.registerMarkdownCodeBlockProcessor('pruefungsfahrplan', (source, el, ctx) => {
      let roh;
      try { roh = obsidian.parseYaml(source); } catch (err) { roh = null; }
      const r = pruefeFahrplan(roh);
      if (!r.ok) { el.appendChild(h('div', 'fle fle-fehler', `Fahrplan fehlerhaft: ${r.fehler}`)); return; }
      ctx.addChild(new FahrplanAnsicht(el, this, r.plan));
    });
    const plane = obsidian.debounce(() => this.planeWiederholungen(), 2000, true);
    this.app.workspace.onLayoutReady(() => plane());
    this.registerEvent(this.app.vault.on('modify', (f) => { if (MODULE.some((m) => f.path === cfgFuer(m).fortschritt || f.basename === cfgFuer(m).fahrplan)) plane(); }));
    this.registerInterval(window.setInterval(plane, 3600_000));
  }

  /* Spick-PDF: HTML (Formeln als MathML), gedruckt mit Edge headless in einen Temp-Ordner.
     druckeSpickPdf liefert die PDF-Daten nur bei genau 2 Seiten, sonst Fehler; der Vault bleibt dabei unberührt. */
  async druckeSpickPdf(spick) {
    const fs = require('fs'), os = require('os'), path = require('path'), { execFile } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fle-spick-'));
    try {
      const html = spickHtml(spick, await this.formelRender(), this.schriftBase64());
      const htmlDatei = path.join(tmp, 'spick.html'), pdfTmp = path.join(tmp, 'spick.pdf');
      fs.writeFileSync(htmlDatei, html, 'utf8');
      const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
        .find((x) => fs.existsSync(x));
      if (!edge) throw new Error('Microsoft Edge nicht gefunden');
      await new Promise((ok) => execFile(edge, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
        `--user-data-dir=${path.join(tmp, 'profil')}`, `--print-to-pdf=${pdfTmp}`, 'file:///' + htmlDatei.replace(/\\/g, '/')],
      { timeout: 60_000 }, () => ok()));
      // Edge meldet sich teils zurück, bevor das PDF fertig geschrieben ist: bis 20 s auf eine stabile Datei warten
      let groesse = -1;
      for (let i = 0; i < 40; i++) {
        const g = fs.existsSync(pdfTmp) ? fs.statSync(pdfTmp).size : -1;
        if (g > 0 && g === groesse) break;
        groesse = g;
        await new Promise((r) => window.setTimeout(r, 500));
      }
      const daten = fs.existsSync(pdfTmp) ? fs.readFileSync(pdfTmp) : null;
      if (!daten || !daten.length) throw new Error('Edge hat kein PDF geschrieben (Edge offen oder blockiert?)');
      const seiten = pdfSeiten(daten);
      if (seiten === 0) throw new Error('Das PDF ist unlesbar');
      if (seiten !== 2) throw new Error(`Das PDF hätte ${seiten} Seiten statt 2 – Spick zu voll, nichts geändert.`);
      return daten;
    } finally {
      // Aufräumen darf nie als Fehler zählen (Edge hält Profil-Dateien manchmal noch kurz fest)
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (err) { /* bleibt im Temp-Ordner liegen */ }
    }
  }

  async schreibeSpickPdf(daten, seitenPfad) {
    const ordner = seitenPfad.includes('/') ? seitenPfad.slice(0, seitenPfad.lastIndexOf('/')) : '';
    const ziel = (ordner ? ordner + '/' : '') + CFG.spickPdf;
    const vorhanden = this.app.vault.getAbstractFileByPath(ziel);
    const puffer = daten.buffer.slice(daten.byteOffset, daten.byteOffset + daten.byteLength);
    if (vorhanden instanceof obsidian.TFile) await this.app.vault.modifyBinary(vorhanden, puffer);
    else await this.app.vault.createBinary(ziel, puffer);
  }

  // Knopf „PDF neu erzeugen“: drucken, nur bei Erfolg das PDF im Vault ersetzen
  async erzeugeSpickPdf(spick, seitenPfad) {
    try {
      await this.schreibeSpickPdf(await this.druckeSpickPdf(spick), seitenPfad);
      new obsidian.Notice(`Spick-PDF aktualisiert (Version ${spick.version}).`);
      return true;
    } catch (err) {
      console.error('fa-lerneinheit Spick-PDF', err);
      new obsidian.Notice(`Spick-PDF nicht erzeugt: ${err.message}`, 10000);
      return false;
    }
  }

  // Handschrift-Font aus dem Plugin-Ordner (für PDF und Vorschau); null, wenn sie fehlt
  schriftBase64() {
    if (this._schrift !== undefined) return this._schrift;
    try {
      const fs = require('fs'), path = require('path');
      const datei = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir, 'Handschrift.ttf');
      this._schrift = fs.existsSync(datei) ? fs.readFileSync(datei).toString('base64') : null;
    } catch (err) { this._schrift = null; }
    return this._schrift;
  }

  // $…$ im Spick als SVG (MathJax aus Obsidian); ohne MathJax bleibt der Text stehen
  async formelRender() {
    try { await obsidian.loadMathJax(); } catch (err) { /* ohne Formelsatz weiter */ }
    const mj = window.MathJax;
    // Obsidian bringt MathJax ohne SVG-Ausgabe mit (nur CHTML/MathML); MathML zeigen Edge und Obsidian selbst an
    return (tex, display) => {
      try {
        if (mj && mj.tex2svg) return mj.tex2svg(tex, { display }).outerHTML;
        if (mj && mj.tex2mml) return mj.tex2mml(tex, { display });
      } catch (err) { /* Text stehen lassen */ }
      return escHtml(tex);
    };
  }

  // Vorhandene Lernzentrale zeigen; sonst ein leeres Blatt nutzen oder (auf Wunsch) einen neuen Tab öffnen
  async oeffneLernzentrale(neuerTab) {
    // Nur im Hauptbereich, nie in einer Seitenleiste
    const haupt = (l) => l.getRoot() === this.app.workspace.rootSplit;
    for (const l of this.app.workspace.getLeavesOfType(VIEW_LZ)) if (!haupt(l)) l.detach();
    const da = this.app.workspace.getLeavesOfType(VIEW_LZ).find(haupt);
    if (da) { if (neuerTab) this.app.workspace.revealLeaf(da); return; }
    const leer = this.app.workspace.getLeavesOfType('empty').find(haupt);
    const leaf = leer || (neuerTab ? this.app.workspace.getLeaf('tab') : null);
    if (leaf) await leaf.setViewState({ type: VIEW_LZ, active: true });
  }

  async ladeFahrplan(modul = 'fa') {
    // Per Name suchen: Die Seite darf in einen beliebigen Ordner verschieben
    const c = cfgFuer(modul);
    const fp = this.app.metadataCache.getFirstLinkpathDest(c.fahrplan, '');
    const fs = this.app.vault.getAbstractFileByPath(c.fortschritt);
    if (!(fp instanceof obsidian.TFile)) return null;
    const block = /```pruefungsfahrplan\r?\n([\s\S]*?)```/.exec(await this.app.vault.cachedRead(fp));
    if (!block) return null;
    let roh;
    try { roh = obsidian.parseYaml(block[1]); } catch (err) { return null; }
    const r = pruefeFahrplan(roh);
    if (!r.ok) return null;
    const zeilen = fs instanceof obsidian.TFile ? leseFortschritt(await this.app.vault.cachedRead(fs)) : [];
    const tag = heute();
    let liste = null;
    if (c.quizOrdner) {
      let quiz = null;
      try { quiz = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/plugins/lern-quiz/data.json`)); } catch (err) { quiz = null; }
      liste = quizListe(quiz, c.quizOrdner);
    }
    return { plan: r.plan, themen: r.plan.themen.map((t) => {
      const st = themaStatus(t, zeilen, tag, r.plan.pruefung);
      return { ...t, ...(liste ? themaMitQuiz(t, st, liste, tag, c.quizDeckel) : st) };
    }) };
  }

  // Jede fällige Wiederholung genau einmal aufs Board; erst eine neue Einschätzung plant die nächste
  async planeWiederholungen() {
    const board = this.app.vault.getAbstractFileByPath(CFG.board);
    if (!(board instanceof obsidian.TFile)) return;
    const gemacht = this.daten.wiederholt || (this.daten.wiederholt = {});
    const tag = heute();
    const auftraege = [];
    for (const modul of MODULE) {
      const f = await this.ladeFahrplan(modul);
      if (!f) continue;
      // FA behält die alten Schlüssel (nur Thema), Mathe bekommt ein Präfix
      const schluessel = (t) => (modul === 'fa' ? t.thema : `${modul}:${t.thema}`);
      const c = cfgFuer(modul);
      for (const t of f.themen) {
        if (t.wieder && t.wieder <= tag && t.wieder < f.plan.pruefung && gemacht[schluessel(t)] !== t.wieder && wiederholKarte(modul, t)) {
          auftraege.push({ t, c, k: schluessel(t) });
        }
      }
    }
    if (!auftraege.length) return;
    await this.app.vault.process(board, (text) => {
      for (const { t, c, k } of auftraege) {
        // Nie auf die alte, ausgefüllte Seite: bis die Routine neue Fälle baut, zeigt die Karte auf den Fahrplan
        text = setzeWiederholung(text, t.thema, t.wieder, c.fahrplan, c.spalte).text;
        gemacht[k] = t.wieder;
      }
      return text;
    });
    await this.saveData(this.daten);
  }

  markiereKarten() {
    const namen = this.app.vault.getMarkdownFiles()
      .filter((f) => {
        const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
        // Lerneinheiten plus alles, was aus dem Lernplan stammt statt aus dem Unterricht – in jedem Modul
        return fm.lerneinheit === true || /^Lernplan/.test(String(fm.quelle || ''));
      })
      .map((f) => CSS.escape(f.basename));
    // Kanban malt Titel- und Inhaltsfläche selbst an, darum dort deckend einfärben
    const regel = (links, farbe) => {
      const karte = `:is(${links.map((n) => `.kanban-plugin__item:has(a.internal-link[data-href="${n}"])`).join(',')})`;
      return `${karte} { border-left: 4px solid rgb(var(${farbe})) !important; }
        ${karte} :is(.kanban-plugin__item-content-wrapper, .kanban-plugin__item-title-wrapper) {
          background: color-mix(in srgb, rgb(var(${farbe})) 16%, var(--background-primary)) !important; }`;
    };
    this.kartenStil.textContent = (namen.length ? regel(namen, '--color-purple-rgb') : '')
      + regel([CSS.escape(FAHRPLAN_NAME)], '--color-orange-rgb').replaceAll('a.internal-link[data-href="Prüfungsfahrplan"]', 'a.tag[href="#wiederholen"]');
  }

  onunload() {
    for (const [id, z] of Object.entries(this.daten.einheiten)) {
      if (z.laeuft) this.daten.einheiten[id] = stoppeLaufenden(z, Date.now());
    }
    this.saveData(this.daten);
  }

  zustand(id, datei, n) {
    let z = this.daten.einheiten[id];
    if (!z) z = this.daten.einheiten[id] = neuerZustand(datei, n);
    while (z.sekunden.length < n) z.sekunden.push(0);
    z.datei = datei;
    return z;
  }

  speichere() {
    window.clearTimeout(this.speicherTimer);
    this.speicherTimer = window.setTimeout(() => this.saveData(this.daten), 500);
  }

  stoppeVerwaiste(id) {
    const z = this.daten.einheiten[id];
    if (!z || !z.laeuft) return;
    for (const a of this.aktive) if (a.e.id === id) return;
    this.daten.einheiten[id] = stoppeLaufenden(z, Date.now());
    this.speichere();
  }

  async schliesseAb(einheit, wert) {
    let z = stoppeLaufenden(this.daten.einheiten[einheit.id], Date.now());
    z = { ...z, einschaetzung: wert, abgeschlossen: z.abgeschlossen || heute() };
    this.daten.einheiten[einheit.id] = z;
    const vault = this.app.vault;
    if (!z.board) {
      const board = vault.getAbstractFileByPath(CFG.board);
      const ziel = z.datei.split('/').pop().replace(/\.md$/, '');
      let gefunden = false;
      if (board instanceof obsidian.TFile) {
        await vault.process(board, (t) => { const r = hakeKarteAb(t, ziel); gefunden = r.gefunden; return r.text; });
        for (const a of this.aktive) if (a.e.id === einheit.id) a.baue();
      }
      if (gefunden) z.board = true;
      else new obsidian.Notice('Karte nicht im Board gefunden – Einschätzung ist gespeichert.');
    }
    const fs = vault.getAbstractFileByPath(cfgFuer(einheit.modul).fortschritt);
    if (fs instanceof obsidian.TFile) {
      const zeilen = einheit.modul === 'mathe' ? [...matheZeilen(einheit, z, z.abgeschlossen), matheEinheitZeile(einheit, z, z.abgeschlossen)] : [fortschrittZeile(einheit, z, z.abgeschlossen)];
      await vault.process(fs, (t) => zeilen.reduce((acc, zeile) => setzeFortschritt(acc, zeile), t));
    } else if (einheit.modul === 'mathe') {
      new obsidian.Notice(`${cfgFuer('mathe').fortschritt} fehlt – Ergebnisse nur im Plugin gespeichert.`);
    }
    await this.saveData(this.daten);
  }
}

module.exports = FaLerneinheit;
module.exports.logik = { videosFuer, ERKLAERVIDEOS, folgtHinweis, kw,unterlagenGruppen, wiederholKarte, quizListe, themaMitQuiz, NEUE_MODULE, tafelSpalte, hakeAb, naechsteSiebenMitRest, UNTERLAGEN, PRUEFUNG, pruefungsSatz, modulDateien, letzteRunde, naechsteSieben, erledigtListe, fakten, fahrplanKennzahlen, hochrechnung, leseBoard, etappeHeute, lernMinuten, wocheVon, serie, tagesziel, MODUL_SPALTEN, pruefTempo, bewerteBuchung, prozentFuerMit, uebernahmeAblauf, istVorschlagSeite, pdfSeiten, pruefeSpick, spickAenderungen, uebernimmVorschlag, spickHtml, SPICK_MAX_ZEICHEN, noteMit, naechsteTodos, matheZeilen, cfgFuer, MODULE, leseZahl, leseZahlen, pruefeZahl, pruefeMenge, pruefeEinheit, KONTENPLAN, EINSCHAETZUNGEN, istKonto,
  neuerZustand, starte, stoppeLaufenden, istWackelig, MAX_LAUF_S, stoppeNachAbsturz, nachPause, fallSekunden, matheEinheitZeile,
  hakeKarteAb, fortschrittZeile, setzeFortschritt, pruefungsErgebnis, restSekunden, freischaltung, normKonto, leseBetrag, pruefeBuchung, trefferQuote,
  leseFortschritt, punkteZeile, themaStatus, sollAm, druckStufe, noteAus, prozentFuer, statusAus, pruefeFahrplan, setzeWiederholung, tageBis };
