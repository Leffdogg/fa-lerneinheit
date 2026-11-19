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

// Fehler genau zeigen (Wunsch 18.11.): welche Zeile stimmt, wo genau der Fehler steckt, was fehlt.
// Gleiche Zuordnung wie pruefeBuchung. → { zeilen: [{ i, status: ok|betrag|soll|haben|konten|extra, soll? }], fehlend: [[so, ha, be]] }
function buchungsDiagnose(eingabe, loesung) {
  const roh = (eingabe || []).map((r, i) => ({ r, i })).filter(({ r }) => r.some((c) => String(c).trim()));
  const offen = (loesung || []).map((l) => ({ l, so: normKonto(l[0]), ha: normKonto(l[1]), be: leseBetrag(l[2]) }));
  const out = roh.map(({ r, i }) => ({ i, so: normKonto(r[0]), ha: normKonto(r[1]), be: leseBetrag(r[2]), status: null }));
  const nimm = (x, j, status) => { x.status = status; x.soll = offen[j].l; offen.splice(j, 1); };
  // 1. exakte Treffer, 2. Konten richtig/Betrag falsch, 3. eine Seite richtig, 4. Rest = unnötig
  for (const x of out) {
    const j = offen.findIndex((o) => o.so === x.so && o.ha === x.ha && (o.be === null || (x.be !== null && Math.abs(o.be - x.be) < 0.01)));
    if (j >= 0) nimm(x, j, 'ok');
  }
  for (const x of out.filter((y) => !y.status)) {
    const j = offen.findIndex((o) => o.so === x.so && o.ha === x.ha);
    if (j >= 0) nimm(x, j, 'betrag');
  }
  for (const x of out.filter((y) => !y.status)) {
    let j = offen.findIndex((o) => o.so === x.so);
    if (j >= 0) { nimm(x, j, 'haben'); continue; }
    j = offen.findIndex((o) => o.ha === x.ha);
    if (j >= 0) { nimm(x, j, 'soll'); continue; }
    j = offen.findIndex((o) => o.so === x.ha && o.ha === x.so);
    if (j >= 0) { nimm(x, j, 'vertauscht'); continue; }
  }
  for (const x of out.filter((y) => !y.status)) {
    if (offen.length && x.be !== null && offen.some((o) => o.be !== null && Math.abs(o.be - x.be) < 0.01)) {
      nimm(x, offen.findIndex((o) => o.be !== null && Math.abs(o.be - x.be) < 0.01), 'konten');
    } else x.status = 'extra';
  }
  return { zeilen: out.map(({ i, status, soll }) => ({ i, status, ...(soll ? { soll } : {}) })), fehlend: offen.map((o) => o.l) };
}

// Kontoart aus dem Prüfungskontenplan: Reihenfolge der Bilanzliste = Aktiven bis Patente, danach Passiven.
// Wertberichtigungen sind Minus-Aktivkonten. Erfolg: Erlöse/Ertrag/Gewinne = Ertrag, sonst Aufwand.
function kontoArt(name) {
  const k = normKonto(name);
  const b = KONTENPLAN.bilanz.indexOf(k);
  if (b >= 0) {
    if (/^Wertberichtigung/.test(k)) return 'minusaktiv';
    return b <= KONTENPLAN.bilanz.indexOf('Patente') ? 'aktiv' : 'passiv';
  }
  if (!KONTENPLAN.erfolg.includes(k) || /^Jahresgewinn|^Bestandesänderung/.test(k)) return null;
  return /erlöse|ertrag|^Eigenleistungen|^Gewinne aus/i.test(k) ? 'ertrag' : 'aufwand';
}

// Was eine Buchungszeile bewirkt (für die T-Konten-Ansicht). Minus-Aktivkonten wirken auf den Nettowert
// des Vermögens wie Aktivkonten: im Soll steigt er, im Haben sinkt er.
function buchungsWirkung(soll, haben) {
  const art = (n) => { const a = kontoArt(n); return a === 'minusaktiv' ? 'aktiv' : a; };
  const s = art(soll), h = art(haben);
  const seite = {
    soll: { aktiv: 'Vermögen nimmt zu', passiv: 'Schulden/Eigenkapital nehmen ab', aufwand: 'Aufwand nimmt zu → Gewinn sinkt', ertrag: 'Ertrag nimmt ab → Gewinn sinkt' },
    haben: { aktiv: 'Vermögen nimmt ab', passiv: 'Schulden/Eigenkapital nehmen zu', aufwand: 'Aufwand nimmt ab → Gewinn steigt', ertrag: 'Ertrag nimmt zu → Gewinn steigt' },
  };
  const bilanz = (a) => a === 'aktiv' || a === 'passiv';
  let titel = 'Buchung';
  if (s === 'aktiv' && h === 'aktiv') titel = 'Aktivtausch';
  else if (s === 'passiv' && h === 'passiv') titel = 'Passivtausch';
  else if (s === 'aktiv' && h === 'passiv') titel = 'Bilanzverlängerung';
  else if (s === 'passiv' && h === 'aktiv') titel = 'Bilanzverkürzung';
  else if (s && h && !(bilanz(s) && bilanz(h))) {
    const plus = (s === 'ertrag' ? -1 : s === 'aufwand' ? -1 : 0) + (h === 'ertrag' ? 1 : h === 'aufwand' ? 1 : 0);
    titel = plus > 0 ? 'Erfolgswirksam: Gewinn steigt' : plus < 0 ? 'Erfolgswirksam: Gewinn sinkt' : 'Erfolgskonten unter sich';
  }
  return { titel, soll: s ? seite.soll[s] : '', haben: h ? seite.haben[h] : '' };
}

// Sicherheit vor dem Aufdecken (Wunsch 18.11.): falsch trotz „sicher“ = Denkfehler, zählt wie „schwer“
const SICHER = [['sicher', 'sicher'], ['unsicher', 'unsicher'], ['geraten', 'geraten']];
function sicherFalsch(einheit, z) {
  let n = 0;
  einheit.schritte.forEach((s, si) => {
    for (const fall of s.faelle || []) {
      const e = (z.ergebnisse || {})[`${si}.${fall.id}`];
      if (e && e.sicher === 'sicher' && e.wert != null && e.wert < 0.5) n += 1;
    }
  });
  return n;
}

// ── Erst Wirkung tippen (Wunsch 18.11.) ── vor der Buchung wählen, was passiert
const WIRKUNGEN = ['Aktivtausch', 'Passivtausch', 'Bilanzverlängerung', 'Bilanzverkürzung', 'Gewinn steigt', 'Gewinn sinkt', 'Keine Buchung'];
// Alle Wirkungen der Lösungszeilen (jede davon gilt als richtig); null = Fall eignet sich nicht
function wirkungSoll(loesung) {
  if (!Array.isArray(loesung)) return null;
  if (!loesung.length) return ['Keine Buchung'];
  const set = new Set();
  for (const [so, ha] of loesung) {
    const t = buchungsWirkung(so, ha).titel.replace(/^Erfolgswirksam: /, '');
    if (!WIRKUNGEN.includes(t)) return null;
    set.add(t);
  }
  return [...set];
}

// ── Prüfungstempo pro Fall (Wunsch 18.11.) ── gleiche Regel wie pruefTempo: 1 min pro Buchungszeile bzw. Punkt
const tempoSoll = (fall) => 60 * pruefTempo([fall]);
const tempoStufe = (sek, soll) => (sek <= soll ? 'gut' : sek <= soll * 1.5 ? 'knapp' : 'langsam');

// ── Fehlerheft (Wunsch 18.11.) ── falsche Fälle sammeln, nach 1/3/7 Tagen wiederholen, dann sitzt er
const FEHLER_ABSTAND = [1, 3, 7];
const fehlerId = (einheitId, si, fallId) => `${einheitId}|${si}.${fallId}`;
function fehlerEintragen(fehler, e, heuteISO) {
  const id = fehlerId(e.einheit, e.si, e.fall);
  return { ...fehler, [id]: { ...(fehler || {})[id], ...e, datum: heuteISO, stufe: 0, faellig: plusTage(heuteISO, 1) } };
}
// Prüfungsanker (Wunsch 18.11., Prinzip „verteilen, am Prüfungsdatum ausrichten“): nichts wird erst nach der
// letzten Woche vor der Prüfung fällig; alles kommt spätestens ANKER_TAGE vor der Prüfung noch einmal.
const ANKER_TAGE = 5;
function ankerFaellig(faellig, pruefungISO, heuteISO) {
  if (!pruefungISO) return faellig;
  const anker = plusTage(pruefungISO, -ANKER_TAGE);
  if (heuteISO >= anker || faellig <= anker) return faellig;
  return anker > heuteISO ? anker : plusTage(heuteISO, 1);
}
function fehlerNachUebung(fehler, id, richtig, heuteISO, pruefungISO = null) {
  const alt = (fehler || {})[id];
  if (!alt) return fehler;
  const neu = { ...fehler };
  if (!richtig) { neu[id] = { ...alt, stufe: 0, faellig: ankerFaellig(plusTage(heuteISO, 1), pruefungISO, heuteISO), zuletzt: heuteISO }; return neu; }
  const stufe = (alt.stufe || 0) + 1;
  // Dreimal richtig: sitzt. Liegt die Prüfung noch vor dem Anker, kommt der Fall dort ein letztes Mal.
  if (stufe >= FEHLER_ABSTAND.length) {
    const anker = pruefungISO ? plusTage(pruefungISO, -ANKER_TAGE) : null;
    if (anker && heuteISO < anker && !alt.schluss) { neu[id] = { ...alt, stufe, schluss: true, faellig: anker, zuletzt: heuteISO }; return neu; }
    delete neu[id]; return neu;
  }
  neu[id] = { ...alt, stufe, faellig: ankerFaellig(plusTage(heuteISO, FEHLER_ABSTAND[stufe]), pruefungISO, heuteISO), zuletzt: heuteISO };
  return neu;
}
// Reihenfolge: zuerst Denkfehler (sicher, aber falsch), dann Begriffsfehler, dann nach Fälligkeit
const fehlerRang = (e) => (e.sicher === 'sicher' ? 0 : 2) + (e.art === 'begriff' ? 0 : 1);
const faelligeFehler = (fehler, heuteISO, modul = null) => Object.entries(fehler || {})
  .map(([id, e]) => ({ id, ...e }))
  .filter((e) => e.faellig <= heuteISO && (!modul || (e.modul || 'fa') === modul))
  .sort((a, b) => fehlerRang(a) - fehlerRang(b) || a.faellig.localeCompare(b.faellig) || a.datum.localeCompare(b.datum));
// Fehlerart (Prinzip 6): was als Nächstes hilft
const FEHLERARTEN = [
  ['begriff', 'Begriff', 'Ich habe die Sache falsch verstanden', 'Lies das Warum oben in Ruhe. Die Wiederholung zeigt dir die Erklärung nochmals, bevor du rechnest.'],
  ['verfahren', 'Verfahren', 'Schritt vergessen oder falsches Konto', 'Löse den Zwilling Schritt für Schritt und vergleiche jeden Schritt mit der Lösung.'],
  ['fluechtig', 'Flüchtigkeit', 'Eigentlich gewusst, vertippt oder verrechnet', 'Prüfroutine vor dem Aufdecken: Soll = Haben? Betrag plausibel? Konto im Kontenplan? Gerundet wie verlangt?'],
];
// Kalibrierung (Prinzip 8): Wie oft stimmt es, wenn du „sicher“, „unsicher“ oder „geraten“ sagst? Über alle Aufgaben.
function kalibrierung(einheiten) {
  const out = { sicher: { n: 0, summe: 0 }, unsicher: { n: 0, summe: 0 }, geraten: { n: 0, summe: 0 } };
  for (const z of Object.values(einheiten || {})) {
    for (const [key, e] of Object.entries((z && z.ergebnisse) || {})) {
      if (!e || e.wert == null || !out[e.sicher] || String(key).includes('~z')) continue;
      out[e.sicher].n += 1; out[e.sicher].summe += e.wert;
    }
  }
  for (const v of Object.values(out)) v.prozent = v.n ? Math.round((v.summe / v.n) * 100) : null;
  return out;
}
const erstversuchQuote = (log) => {
  const l = (log || []).slice(-40);
  return l.length ? { n: l.length, prozent: Math.round((l.filter((x) => x.ok).length / l.length) * 100) } : null;
};

// ── Formel-Puzzle (Wunsch 18.11.) ── die auswendig zu lernenden Kennzahlen der Prüfungsinformation.
// Ausgelassen, weil die Definition noch unklar ist (⚠ in der Notiz): ROIC (13), Leverage (18), Verschuldungsfaktor (21),
// Praktiker-Cashflow (24), Umschlag operatives NUV (29), Kapitalbindungsdauer (30).
const KENNZAHLEN = [
  ['Bilanzanalyse', 1, 'Intensität des Umlaufvermögens', 'Umlaufvermögen', '÷', 'Gesamtvermögen'],
  ['Bilanzanalyse', 2, 'Intensität des Anlagevermögens', 'Anlagevermögen', '÷', 'Gesamtvermögen'],
  ['Bilanzanalyse', 3, 'Fremdfinanzierungsgrad', 'Fremdkapital', '÷', 'Gesamtkapital'],
  ['Bilanzanalyse', 4, 'Eigenfinanzierungsgrad', 'Eigenkapital', '÷', 'Gesamtkapital'],
  ['Bilanzanalyse', 5, 'Liquiditätsgrad 1', 'flüssige Mittel', '÷', 'kurzfristiges Fremdkapital'],
  ['Bilanzanalyse', 6, 'Liquiditätsgrad 2', 'flüssige Mittel + Forderungen', '÷', 'kurzfristiges Fremdkapital'],
  ['Bilanzanalyse', 7, 'Liquiditätsgrad 3', 'Umlaufvermögen', '÷', 'kurzfristiges Fremdkapital'],
  ['Bilanzanalyse', 8, 'Anlagedeckungsgrad 1', 'Eigenkapital', '÷', 'Anlagevermögen'],
  ['Bilanzanalyse', 9, 'Anlagedeckungsgrad 2', 'Eigenkapital + langfristiges Fremdkapital', '÷', 'Anlagevermögen'],
  ['Bilanzanalyse', 10, 'Selbstfinanzierungsgrad', 'Gewinnreserven', '÷', 'Eigenkapital'],
  ['Erfolgsanalyse', 11, 'Rentabilität des Eigenkapitals (ROE)', 'Reingewinn', '÷', 'Ø Eigenkapital'],
  ['Erfolgsanalyse', 12, 'Rentabilität des Gesamtkapitals (ROA)', 'EBIT', '÷', 'Ø Gesamtkapital'],
  ['Erfolgsanalyse', 14, 'Bruttogewinnmarge', 'Bruttogewinn', '÷', 'Nettoerlös'],
  ['Erfolgsanalyse', 15, 'EBIT-Marge', 'EBIT', '÷', 'Nettoerlös'],
  ['Erfolgsanalyse', 16, 'EBITDA-Marge', 'EBITDA', '÷', 'Nettoerlös'],
  ['Erfolgsanalyse', 17, 'Gewinnmarge', 'Reingewinn', '÷', 'Nettoerlös'],
  ['Cashflow-Analyse', 19, 'Cashflow-Marge', 'Cashflow', '÷', 'Nettoerlös'],
  ['Cashflow-Analyse', 20, 'Cashflow-Investitionsverhältnis', 'Cashflow', '÷', 'Nettoinvestitionen'],
  ['Cashflow-Analyse', 22, 'Zinsdeckungsfaktor', 'EBIT', '÷', 'Zinsaufwand'],
  ['Cashflow-Analyse', 23, 'Free Cashflow', 'Cashflow aus Betriebstätigkeit', '−', 'Nettoinvestitionen'],
  ['Aktivitätsanalyse', 25, 'Debitorenumschlag', 'Kreditverkäufe', '÷', 'Ø Forderungen'],
  ['Aktivitätsanalyse', 25, 'Debitorenfrist (Tage)', '360', '÷', 'Debitorenumschlag'],
  ['Aktivitätsanalyse', 26, 'Lagerumschlag', 'Warenaufwand', '÷', 'Ø Warenlager'],
  ['Aktivitätsanalyse', 26, 'Lagerdauer (Tage)', '360', '÷', 'Lagerumschlag'],
  ['Aktivitätsanalyse', 27, 'Kreditorenumschlag', 'Krediteinkäufe', '÷', 'Ø Verbindlichkeiten L+L'],
  ['Aktivitätsanalyse', 27, 'Kreditorenfrist (Tage)', '360', '÷', 'Kreditorenumschlag'],
  ['Aktivitätsanalyse', 28, 'Kapitalumschlag', 'Nettoerlös', '÷', 'Ø Gesamtkapital'],
  ['Börsenkennzahlen', 31, 'Kurs-Gewinn-Verhältnis (KGV)', 'Aktienkurs', '÷', 'Gewinn je Aktie'],
  ['Börsenkennzahlen', 32, 'PEG Ratio', 'KGV', '÷', 'erwartetes Gewinnwachstum in %'],
  ['Börsenkennzahlen', 33, 'Kurs-Buchwert-Verhältnis (KBV)', 'Aktienkurs', '÷', 'Eigenkapital je Aktie'],
  ['Börsenkennzahlen', 34, 'Gewinnrendite', 'Gewinn je Aktie', '÷', 'Aktienkurs'],
  ['Börsenkennzahlen', 35, 'Dividendenrendite', 'Dividende je Aktie', '÷', 'Aktienkurs'],
  ['Börsenkennzahlen', 36, 'Aktienrendite', 'Dividende + Kursveränderung', '÷', 'Kurs zu Beginn'],
  ['Börsenkennzahlen', 37, 'Payout Ratio', 'Dividende', '÷', 'Gewinn'],
  ['Börsenkennzahlen', 38, 'Börsenkapitalisierung', 'Anzahl Aktien', '×', 'Aktienkurs'],
].map(([gruppe, nr, name, a, op, b]) => ({ id: `${nr}·${name}`, gruppe, nr, name, a, op, b }));

// Richtig, wenn beide Plätze stimmen; beim Produkt ist die Reihenfolge egal
const pruefeFormel = (k, a, b) => (a === k.a && b === k.b) || (k.op === '×' && a === k.b && b === k.a);

// Bausteine: die zwei richtigen plus Ablenker, ähnliche (gleiches Wort) zuerst; zufall() wie Math.random
function formelBausteine(k, zufall = Math.random, n = 8) {
  const alle = [...new Set(KENNZAHLEN.flatMap((x) => [x.a, x.b]))].filter((t) => t !== k.a && t !== k.b);
  // ähnlich = gleiches Wort oder gleiche Wortendung („…vermögen“, „…kapital“), damit die Ablenker fordern
  const schluessel = `${k.a} ${k.b}`.toLowerCase().split(/[^a-zäöü0-9]+/).filter((w) => w.length > 3)
    .flatMap((w) => (w.length >= 8 ? [w, w.slice(-7)] : [w]));
  const aehnlich = alle.filter((t) => schluessel.some((x) => t.toLowerCase().includes(x)));
  const rest = alle.filter((t) => !aehnlich.includes(t));
  const misch = (l) => l.map((x) => [zufall(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const ablenker = [...misch(aehnlich), ...misch(rest)].slice(0, n - 2);
  return misch([k.a, k.b, ...ablenker]);
}

// Welche Kennzahlen heute dran sind: fällige zuerst, dann höchstens maxNeu neue aus schon unterrichteten Gruppen
const FORMEL_ABSTAND = [1, 3, 7, 21];
function formelnHeute(stand, heuteISO, erlaubt = null, maxNeu = 6) {
  const s = stand || {};
  const faellig = KENNZAHLEN.filter((k) => s[k.id] && s[k.id].faellig <= heuteISO);
  // höchstens maxNeu neue pro TAG (Korrektur 18.11.: vorher pro Runde). Alte Einträge ohne „seit“: Stufe 0 und heute geübt = heute neu
  const neuHeute = Object.values(s).filter((x) => x && (x.seit ? x.seit === heuteISO : x.stufe === 0 && x.zuletzt === heuteISO)).length;
  const neu = KENNZAHLEN.filter((k) => !s[k.id] && (!erlaubt || erlaubt.includes(k.gruppe))).slice(0, Math.max(0, maxNeu - neuHeute));
  return [...faellig, ...neu];
}
function formelNachUebung(stand, id, richtig, heuteISO, pruefungISO = null) {
  const alt = (stand || {})[id] || { stufe: -1 };
  const stufe = richtig ? Math.min(alt.stufe + 1, FORMEL_ABSTAND.length - 1) : 0;
  const tage = richtig ? FORMEL_ABSTAND[stufe] : 1;
  return { ...stand, [id]: { stufe, faellig: ankerFaellig(plusTage(heuteISO, tage), pruefungISO, heuteISO), zuletzt: heuteISO, seit: (stand || {})[id] ? ((stand[id].seit) || null) : heuteISO } };
}
// Unterrichtet = Fahrplan-Thema mit `unterricht` ≤ heute, dessen Name mit der Gruppe beginnt
function formelGruppen(plan, heuteISO) {
  if (!plan || !Array.isArray(plan.themen)) return null;
  const gruppen = [...new Set(KENNZAHLEN.map((k) => k.gruppe))];
  return gruppen.filter((g) => plan.themen.some((t) => String(t.thema).startsWith(g) && t.unterricht && isoTag(t.unterricht) <= heuteISO));
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

// Ankreuzfragen wie an MooPad/E-Assessment. Kprim: zu jeder Aussage richtig/falsch, alle richtig = voll,
// eine falsch = halb (MooPad: 3 P bei 4/4, 1,5 bei 3/4), sonst 0. Auswahl: eine (A+) oder mehrere
// richtige Antworten, nur genau die richtigen angekreuzt zählt.
const BUCHSTABEN = 'ABCDEFGH';
// Eingabe eines Kprim-Falls: ['r','f','','r']; ältere Stände waren Freitext („1. richtig …“)
function kprimWahl(eingabe, n) {
  const zelle = (eingabe || [[]])[0] || [];
  if (zelle.length === 1 && String(zelle[0]).length > 1) {
    const t = Array(n).fill('');
    for (const m of String(zelle[0]).matchAll(/(\d+)\s*[.)]?\s*(richtig|falsch|r|f)\b/gi)) {
      const i = Number(m[1]) - 1;
      if (i >= 0 && i < n) t[i] = m[2][0].toLowerCase();
    }
    return t;
  }
  return Array.from({ length: n }, (_, i) => zelle[i] || '');
}
function bewerteKprim(eingabe, aussagen) {
  const t = kprimWahl(eingabe, aussagen.length);
  const treffer = aussagen.filter((a, i) => t[i] === (a.richtig ? 'r' : 'f')).length;
  return treffer === aussagen.length ? 1 : treffer === aussagen.length - 1 ? 0.5 : 0;
}
// Eingabe eines Auswahl-Falls: ['', 'B', '', ''] oder älterer Freitext („b“, „B und D“) → gewählte Buchstaben
function auswahlWahl(eingabe) {
  const zelle = ((eingabe || [[]])[0] || []).filter((x) => String(x).trim());
  const text = zelle.length === 1 ? String(zelle[0]) : '';
  if (text.length > 1 || (text && text !== text.toUpperCase())) {
    return [...new Set([...text.matchAll(/\b([a-h])\b/gi)].map((m) => m[1].toUpperCase()))];
  }
  return zelle.map((x) => String(x).toUpperCase());
}
function bewerteAuswahl(eingabe, richtig) {
  const t = new Set(auswahlWahl(eingabe));
  return t.size === richtig.length && richtig.every((b) => t.has(b)) ? 1 : 0;
}
const istKreuz = (fall) => fall.art === 'kprim' || fall.art === 'auswahl';
const bewerteKreuz = (eingabe, fall) => (fall.art === 'kprim' ? bewerteKprim(eingabe, fall.kprim) : bewerteAuswahl(eingabe, fall.richtig));

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
      else if (istKreuz(fall)) w = bewerteKreuz(eingabe, fall);
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

// Bezug auf frühere Fälle (Wunsch 16.11.2026: nicht zurückscrollen müssen).
// `bezug:` am Fall: "a" = Fall a im selben Schritt, "2a"/"2.a" = Fall a in Schritt 2, "2" = Einleitung/Text von Schritt 2.
// Ohne `bezug:` werden Erwähnungen wie „aus a)“ im Text erkannt, wenn a ein früherer Fall im selben Schritt ist.
// Liefert [{ si, fall|null }] (si 0-basiert) oder { fehler }.
function bezuege(schritte, si, fall) {
  const out = [];
  const frueher = (s, id) => (schritte[s].faelle || []).findIndex((x) => String(x.id) === id);
  if (fall.bezug != null) {
    for (const roh of Array.isArray(fall.bezug) ? fall.bezug : [fall.bezug]) {
      const m = /^\s*(?:(\d+)\s*\.?\s*)?([a-z]\w*)?\s*$/i.exec(String(roh));
      if (!m || (!m[1] && !m[2])) return { fehler: `Bezug „${roh}“ nicht lesbar (Beispiele: a, 2a, 2).` };
      const s = m[1] ? Number(m[1]) - 1 : si;
      if (!schritte[s] || s > si) return { fehler: `Bezug „${roh}“: Schritt gibt es nicht oder er kommt später.` };
      if (!m[2]) { out.push({ si: s, fall: null }); continue; }
      const i = frueher(s, m[2]);
      const eigen = (schritte[si].faelle || []).findIndex((x) => x === fall);
      if (i < 0 || (s === si && i >= eigen)) return { fehler: `Bezug „${roh}“: kein früherer Fall mit dieser id.` };
      out.push({ si: s, fall: schritte[s].faelle[i] });
    }
    return out;
  }
  const eigen = (schritte[si].faelle || []).findIndex((x) => x === fall);
  const gesehen = new Set();
  const dazu = (s, i) => { if (s >= 0 && i >= 0 && (s < si || i < eigen) && !gesehen.has(`${s}.${i}`)) { gesehen.add(`${s}.${i}`); out.push({ si: s, fall: schritte[s].faelle[i] }); } };
  // „Aufgabe 2 a)“ / „aus der ersten Aufgabe, Fall a)“ = n-ter Schritt der Art „aufgabe“
  const aufgaben = schritte.map((s, i) => (s.art === 'aufgabe' ? i : -1)).filter((i) => i >= 0);
  const ORD = { ersten: 1, zweiten: 2, dritten: 3, vierten: 4 };
  let rest = String(fall.text || '');
  rest = rest.replace(/Aufgabe\s+(\d+)\s*,?\s*(?:Fall\s+)?([a-h])\)|(ersten|zweiten|dritten|vierten)\s+Aufgabe\s*,?\s*(?:Fall\s+)?([a-h])\)/g, (_, n, id, ord, id2) => {
    const s = aufgaben[(n ? Number(n) : ORD[ord]) - 1];
    if (s != null) dazu(s, frueher(s, id || id2));
    return ' ';
  });
  for (const m of rest.matchAll(/(?:^|[^\w])([a-h])\)/g)) dazu(si, frueher(si, m[1]));
  return out;
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
        // Mathe mit A–D (seit 18.11., Vorbild Bonustest) läuft unten durch die Auswahl, braucht aber die Aufgabenart
        if (modul === 'mathe' && fall.optionen != null && !(fall.aufgabenart || s.aufgabenart)) return f(`${wf}: Feld „aufgabenart“ fehlt (am Fall oder am Schritt).`);
        if (modul === 'mathe' && fall.optionen == null) {
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
        // Kprim: Liste von { aussage, richtig: true/false, warum }
        if (fall.kprim != null) {
          if (!Array.isArray(fall.kprim) || fall.kprim.length < 2 || fall.kprim.some((a) => !a || !a.aussage || typeof a.richtig !== 'boolean')) {
            return f(`${wf}: „kprim“ braucht eine Liste von Aussagen mit „aussage“ und „richtig: true/false“.`);
          }
          neu.faelle.push({ ...fall, id: String(fall.id), art: 'kprim' });
          continue;
        }
        // Auswahl (A+/MC): optionen + richtig (ein Buchstabe = genau eine richtig, Liste = mehrere ankreuzen)
        if (fall.optionen != null) {
          if (!Array.isArray(fall.optionen) || fall.optionen.length < 2 || fall.optionen.length > BUCHSTABEN.length) {
            return f(`${wf}: „optionen“ braucht 2 bis ${BUCHSTABEN.length} Antworten.`);
          }
          const mehrfach = Array.isArray(fall.richtig);
          const richtig = (mehrfach ? fall.richtig : [fall.richtig]).map((b) => String(b == null ? '' : b).trim().toUpperCase());
          const erlaubt = BUCHSTABEN.slice(0, fall.optionen.length);
          if (!richtig.length || richtig.some((b) => b.length !== 1 || !erlaubt.includes(b))) {
            return f(`${wf}: „richtig“ muss ein Buchstabe ${erlaubt[0]}–${erlaubt[erlaubt.length - 1]} sein (oder eine Liste davon).`);
          }
          neu.faelle.push({ ...fall, id: String(fall.id), optionen: fall.optionen.map(String), richtig, mehrfach, art: 'auswahl', ...(modul === 'mathe' ? { aufgabenart: String(fall.aufgabenart || s.aufgabenart) } : {}) });
          continue;
        }
        // Gesuchte Zahl (seit 15.11.2026): ein Zahlenfeld mit Einheit,
        // prüft sich selbst wie bei Mathe. Erklärung über `weg` (Liste) oder `warum`.
        if (fall.zahl != null) {
          const zahlen = Array.isArray(fall.zahl) ? fall.zahl : [fall.zahl];
          if (!zahlen.length || zahlen.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return f(`${wf}: „zahl“ muss eine Zahl (oder Liste von Zahlen) sein.`);
          neu.faelle.push({ ...fall, id: String(fall.id), art: 'zahl' });
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
  // Zwillingsaufgabe: wird wie ein eigener Fall geprüft (gleiche Regeln, gleiches Modul), ohne eigenen Zwilling
  for (const [si, s] of schritte.entries()) for (const [j, fall] of (s.faelle || []).entries()) {
    if (fall.zwilling == null) continue;
    const wf = `Schritt ${si + 1}, Fall ${fall.id}, Zwilling`;
    if (obj.modus === 'pruefung') return f(`${wf}: In einer Probeprüfung gibt es keine Zwillinge.`);
    if (typeof fall.zwilling !== 'object' || Array.isArray(fall.zwilling)) return f(`${wf}: muss ein Fall sein (text plus Lösung).`);
    const roh = { ...fall.zwilling, id: `${fall.id}~z`, aufgabenart: fall.zwilling.aufgabenart || fall.aufgabenart, hilfe: fall.zwilling.hilfe || fall.hilfe, bezug: [] };
    delete roh.zwilling;
    const mini = pruefeEinheit({ id: 'zwilling', thema: obj.thema, modul, schritte: [{ art: 'aufgabe', titel: 'Zwilling', soll: 1, faelle: [roh] }] });
    if (!mini.ok) return f(`${wf}: ${String(mini.fehler).replace(/^Schritt 1, Fall [^:]*: /, '')}`);
    const zw = mini.einheit.schritte[0].faelle[0];
    if (zw.art !== fall.art) return f(`${wf}: muss dieselbe Art haben wie der Fall (${fall.art}, nicht ${zw.art}).`);
    s.faelle[j] = { ...fall, zwilling: zw };
  }
  // Probeprüfung: Countdown statt Timer, jeder Fall braucht Punkte
  if (obj.modus === 'pruefung') {
    if (typeof obj.dauer !== 'number' || obj.dauer <= 0) return f('Probeprüfung: Feld „dauer“ (Minuten) fehlt.');
    for (const s of schritte) for (const fall of s.faelle || []) {
      if (typeof fall.punkte !== 'number' || fall.punkte <= 0) return f(`Probeprüfung: Fall ${fall.id} in „${s.titel}“ braucht „punkte“.`);
    }
  }
  for (const [si, s] of schritte.entries()) for (const fall of s.faelle || []) {
    const b = bezuege(schritte, si, fall);
    if (b.fehler) return f(`Schritt ${si + 1}, Fall ${fall.id}: ${b.fehler}`);
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
  const irrtum = sicherFalsch(einheit, z);
  const denk = irrtum ? ` · ${irrtum}× sicher falsch` : '';
  return `| ${d}.${m}. | ${einheit.thema} | Lerneinheit | ${ist} min (Soll ${soll})${quote}${denk} | ${z.einschaetzung} |`;
}

// ── Aufgaben-Uhr ── für Karten ohne Lerneinheit (Videos, Lesen, Aufträge); läuft in der Statusleiste
// u = { text, modul, sek, seit (ms, null = pausiert), puls (ms) }
function uhrSek(u, jetzt) {
  if (!u) return 0;
  return u.sek + (u.seit != null ? Math.min(MAX_LAUF_S, Math.max(0, Math.round((jetzt - u.seit) / 1000))) : 0);
}
// Pausieren; ohne Lebenszeichen (Schlaf, Obsidian beendet) nur bis zum letzten Puls zählen
function uhrPause(u, jetzt) {
  if (!u || u.seit == null) return u;
  return { ...u, sek: uhrSek(u, jetzt), seit: null };
}
// Fortschrittszeile „Zeit“ (ohne Einschätzung, zählt nur als Lernzeit); gleicher Tag und gleiche Aufgabe werden addiert
function setzeZeit(text, thema, datumISO, min) {
  const [, m, d] = datumISO.split('-');
  const tag = `${d}.${m}.`;
  let sauber = String(thema).replace(/\|/g, '/').trim();
  const zellen = text.split(/\r?\n/).map((z) => z.split('|').map((x) => x.trim()));
  const alt = zellen.find((c) => c[1] === tag && c[2] === sauber && c[3] === 'Zeit');
  // Gibt es am selben Tag eine andere Zeile mit gleichem Thema (z. B. eine Lerneinheit), nie überschreiben
  if (!alt && zellen.some((c) => c[1] === tag && c[2] === sauber)) sauber += ' (Zeit)';
  const alt2 = alt || zellen.find((c) => c[1] === tag && c[2] === sauber && c[3] === 'Zeit');
  const vorher = alt2 ? Number((/(\d+)\s*min/.exec(alt2[4] || '') || [0, 0])[1]) : 0;
  return setzeFortschritt(text, `| ${tag} | ${sauber} | Zeit | ${vorher + min} min |  |`);
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

// ── Automatische Lernzeit (Wunsch 16.11.2026: Zeit überall messen, nichts drücken) ──
// Zu welchem Modul gehört eine offene Datei? Ordner „Module/<Modul>/…“ oder Frontmatter „modul:“ (Name oder Kürzel).
function modulAusPfad(pfad, fmModul) {
  const teile = String(pfad || '').split('/');
  const i = teile.indexOf('Module');
  if (i >= 0 && teile.length > i + 2) {
    const k = MODUL_KEYS.find((x) => MODUL_SPALTEN[x] === teile[i + 1]);
    if (k) return k;
  }
  const m = String(fmModul || '').trim().toLowerCase();
  if (!m) return null;
  if (m === 'mathe') return 'ma';
  return MODUL_KEYS.find((x) => x === m || MODUL_SPALTEN[x].toLowerCase() === m || MODUL_INFO[x].name.toLowerCase() === m) || null;
}
// Sekunden pro Tag und Modul: { '2026-11-16': { fa: 120, … } }
function zeitDazu(zeit, iso, key, sek) {
  if (!iso || !MODUL_KEYS.includes(key) || !(sek > 0)) return zeit;
  if (!zeit[iso]) zeit[iso] = {};
  zeit[iso][key] = (zeit[iso][key] || 0) + sek;
  return zeit;
}
// Gemessene Zeit und Fortschritts-Minuten messen dasselbe Lernen doppelt: pro Tag und Modul gilt der grössere Wert.
function mischeZeit(proTag, zeit) {
  const out = new Map([...proTag].map(([iso, m]) => [iso, { ...leerMinuten(), ...m }]));
  for (const [iso, m] of Object.entries(zeit || {})) {
    for (const k of MODUL_KEYS) {
      const min = Math.round(((m && m[k]) || 0) / 60);
      if (!(min > 0)) continue;
      if (!out.has(iso)) out.set(iso, leerMinuten());
      out.get(iso)[k] = Math.max(out.get(iso)[k], min);
    }
  }
  return out;
}
// Zeit läuft erst „auf Probe“: Sie wird erst gutgeschrieben, wenn wieder eine Aktivität kommt.
// Bleibt die zu lange aus, verfällt alles seit der letzten Aktivität (Regel 16.11.2026).
// Beim Video gilt eine längere Frist, weil man dabei nichts anfasst.
const RUHE_MS = 5 * 60_000;
const VIDEO_RUHE_MS = 30 * 60_000;
function zeitSchritt(st, { jetzt, sek, modul, aktiv, schaut }) {
  const offen = { ...(st.offen || {}) };
  let letzte = st.letzte == null ? jetzt : st.letzte;
  if (modul && sek > 0) offen[modul] = (offen[modul] || 0) + sek;
  if (aktiv) {
    letzte = jetzt;
    return { st: { offen: {}, letzte }, gut: offen };
  }
  if (jetzt - letzte > (schaut ? VIDEO_RUHE_MS : RUHE_MS)) return { st: { offen: {}, letzte }, gut: {} };
  return { st: { offen, letzte }, gut: {} };
}
// Wochenziel mit Stufen ab Datum, z. B. { '2026-12-01': 1440 }; davor gilt wochenzielMin
function wochenzielFuer(iso, cfg) {
  let wert = Number(cfg.wochenzielMin) || 360;
  for (const [ab, min] of Object.entries(cfg.wochenzielAb || {}).sort()) if (ab <= iso && Number(min) > 0) wert = Number(min);
  return wert;
}
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
  // Sicher, aber falsch = Denkfehler: höchstens „schwer“, damit das Thema früher wiederkommt
  if (/sicher falsch/.test(z.material)) p = Math.min(p, PUNKTE.schwer);
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
  // Selbst gestartet (Wunsch 19.11.): Nachschauen beim vorherigen Fall zählt nicht mit
  const st = (z.tempoStart || {})[key];
  if (st != null && st < uhr[key]) davor = Math.max(davor, st);
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
      if (w === null) w = istLeer((z.eingaben || {})[key]) ? 0 : fall.art === 'zahl' ? pruefeZahlFall(z.eingaben[key], fall) : istKreuz(fall) ? bewerteKreuz(z.eingaben[key], fall) : 0;
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

// Soll nach Unterricht (16.11.2026): Was im Unterricht dran war, sollte man können – egal, wann der eigene
// Aufholplan (stichtag) es einplant. Eine Woche nach dem Unterricht das Ziel-Niveau (80 % = Note 5),
// danach weiter bis 90 % eine Woche vor der Prüfung. Ohne „unterricht:“ gilt eine Woche vor dem Stichtag.
const STOFF = { nachTagen: 7, niveau: 80 };
const unterrichtVon = (thema) => (thema.unterricht ? isoTag(thema.unterricht) : plusTage(thema.stichtag, -STOFF.nachTagen));
function sollStoff(thema, tag, pruefung, niveau = STOFF.niveau) {
  const start = unterrichtVon(thema);
  if (tag <= start) return 0;
  const n = Math.min(SOLL.ziel, Math.max(0, niveau));
  const sitzt = plusTage(start, STOFF.nachTagen);
  if (tag < sitzt) return Math.round(n * tageBis(start, tag) / STOFF.nachTagen);
  const ende = plusTage(pruefung, -SOLL.puffer);
  if (tag >= ende || sitzt >= ende) return SOLL.ziel;
  return Math.round(n + (SOLL.ziel - n) * tageBis(sitzt, tag) / tageBis(sitzt, ende));
}

// Druck aus Ist gegen Soll: noch nicht dran / im Plan / knapp / Rückstand / Alarm
function druckStufe(ist, soll) {
  if (soll <= 0 && ist <= 0) return 'ruhe';
  if (ist >= soll) return 'gut';
  const quote = ist / soll;
  return quote >= 0.8 ? 'knapp' : quote >= 0.6 ? 'hinten' : 'alarm';
}

// Mathe-Aufgaben eines Tages zu einer Zeile wie bei FA: Anteil richtig über alle Aufgaben, das schlechteste Gefühl,
// „mit Hilfe“, sobald eine Aufgabe Hilfe brauchte; punkteZeile nimmt dann das Schlechtere aus Gefühl und Anteil.
function tagesZeile(gruppe) {
  const quoten = gruppe.map((z) => { const m = /(\d+)\s*%\s*richtig/.exec(z.material); return m ? Number(m[1]) : 0; });
  const schnitt = Math.round(quoten.reduce((a, q) => a + q, 0) / quoten.length);
  const gefuehle = gruppe.map((z) => z.einschaetzung).filter((e) => Object.keys(PUNKTE).some((k) => String(e).toLowerCase().includes(k)));
  const gefuehl = gefuehle.sort((x, y) => (punkteZeile({ einschaetzung: x, material: '' }) ?? 0) - (punkteZeile({ einschaetzung: y, material: '' }) ?? 0))[0] || '';
  const hilfe = gruppe.some((z) => /mit Hilfe/.test(z.material)) ? ' · mit Hilfe' : '';
  return { ...gruppe[gruppe.length - 1], einschaetzung: gefuehl, material: `${schnitt} % richtig${hilfe}` };
}

function themaStatus(thema, zeilen, heuteISO, pruefung = '2099-12-31', niveau = STOFF.niveau) {
  const soll = sollAm(thema, heuteISO, pruefung);
  const stoff = sollStoff(thema, heuteISO, pruefung, niveau);
  const behandelt = unterrichtVon(thema) <= heuteISO;
  const roh = zeilen
    .filter((z) => thema.stichworte.some((w) => trifft(z.stufe === 'Aufgabe' ? z.thema.split(' · ')[0] : z.thema, w)) && punkteZeile(z) !== null)
    .map((z, i) => ({ z, i }))
    .sort((a, b) => (a.z.datum === b.z.datum ? a.i - b.i : a.z.datum < b.z.datum ? -1 : 1))
    .map((x) => x.z);
  // Mathe schreibt eine Zeile pro Aufgabe: Alle Zeilen eines Tages sind eine Einschätzung, gerechnet wie eine FA-Einheit
  // (Änderung 18.11.: vorher zählte die schlechteste Aufgabe, eine falsche setzte den Tag auf 0 %). Siehe tagesZeile.
  // Nur Mathe-Aufgabenzeilen (Stufe „Aufgabe“) werden pro Tag zusammengefasst; FA-Zeilen zählen wie bisher einzeln
  const gruppen = new Map();
  roh.forEach((z, i) => {
    const k = z.stufe === 'Aufgabe' ? `A:${z.datum}` : `Z:${i}`;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(z);
  });
  const treffer = [...gruppen.values()].map((g) => {
    const z = g.length > 1 || g[0].stufe === 'Aufgabe' ? tagesZeile(g) : g[0];
    return { ...g[g.length - 1], _p: punkteZeile(z) };
  });
  if (!treffer.length) {
    const status = heuteISO > thema.stichtag ? 'ueberfaellig' : 'offen';
    return { status, koennen: 0, soll, stoff, behandelt, druck: druckStufe(0, soll), letzte: null, wieder: null, anzahl: 0 };
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
    status: statusAus(koennen), koennen, soll, stoff, behandelt, druck: druckStufe(koennen, soll),
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
  // „Solltest du heute können“: Schnitt über die Themen aus dem Unterricht (mit unterricht:). Training und Meilensteine
  // ohne Unterrichtstermin zählen dort nicht mit, sonst drücken sie das Soll, obwohl der Stoff längst dran war.
  const ausUnterricht = themen.filter((t) => t.unterricht && !t.fertig);
  const basis = ausUnterricht.length ? ausUnterricht : themen;
  let stoff = Math.round(basis.reduce((s, t) => s + (t.stoff || 0), 0) / basis.length);
  // Teile mit Gewicht (KDW: Disposition 70 %, MC-Test 30 %): Schnitt pro Teil, dann nach Gewicht
  const gw = plan.teile_gewicht && typeof plan.teile_gewicht === 'object' ? plan.teile_gewicht : null;
  if (gw) {
    let summe = 0, i = 0, so = 0, st = 0;
    for (const [teil, g] of Object.entries(gw)) {
      const tt = themen.filter((t) => (t.teil || '') === teil);
      if (!tt.length || !(Number(g) > 0)) continue;
      summe += Number(g);
      i += Number(g) * tt.reduce((s, t) => s + t.koennen, 0) / tt.length;
      so += Number(g) * tt.reduce((s, t) => s + t.soll, 0) / tt.length;
      // Wie oben nur Unterrichtsthemen; hat ein Teil keine (KDW-Disposition = Meilensteine), zählen die Meilensteine
      // nach ihrem eigenen Zeitplan (soll), erledigte mit 100 (Korrektur 18.11.: vorher immer 0, Soll blieb unter 43 %)
      const mitU = tt.filter((t) => t.unterricht && !t.fertig);
      const sb = mitU.length ? mitU : tt;
      st += Number(g) * sb.reduce((s, t) => s + (t.unterricht ? (t.stoff || 0) : t.fertig ? 100 : (t.soll || 0)), 0) / sb.length;
    }
    if (summe) { ist = Math.round(i / summe); soll = Math.round(so / summe); stoff = Math.round(st / summe); }
  }
  // Nächster Meilenstein: der erste Teil, in dem noch nicht alles sitzt, fertig am spätesten Stichtag dieses Teils
  let meilenstein = null;
  for (const teil of [...new Set(themen.map((t) => t.teil || ''))]) {
    const tt = themen.filter((t) => (t.teil || '') === teil);
    if (tt.every((t) => t.status === 'sitzt')) continue;
    meilenstein = { text: `${(teil || 'Stoff').split(' –')[0].trim()} fertig`, datum: tt.map((t) => t.stichtag).sort().pop() };
    break;
  }
  // Druck misst den eigenen Aufholplan (stichtag). Wer dort im Plan ist, aber klar hinter dem Unterricht liegt,
  // sieht „Aufholen“ in Gelb statt eines grünen „Im Plan“.
  // Unter 5 Punkten Abstand zum eigenen Plan ist kein Rückstand (sonst wäre 0 % gegen 1 % schon Alarm)
  let druck = soll - ist < 5 ? (soll <= 0 && ist <= 0 ? 'ruhe' : 'gut') : druckStufe(ist, soll);
  const aufholen = (druck === 'gut' || druck === 'ruhe') && ist < stoff * 0.8;
  if (aufholen) druck = 'knapp';
  const stoffThemen = themen.filter((t) => !t.fertig && t.unterricht);
  return {
    rest: Math.max(tageBis(tag, plan.pruefung), 0), ist, soll, stoff, aufholen, druck,
    behandelt: stoffThemen.filter((t) => t.behandelt).length, stoffThemen: stoffThemen.length,
    aufgeholtBis: themen.filter((t) => t.behandelt && !t.fertig).map((t) => t.stichtag).sort().pop() || null,
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
// Ziel-Niveau des Stoffs aus der Zielnote des Fahrplans (Note 5 = 80 %), ohne Zielnote 80 %
const niveauAus = (plan) => (Number(plan && plan.zielnote) >= 4 ? Math.min(90, prozentFuer(Number(plan.zielnote))) : STOFF.niveau);

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
  return { ok: true, plan: { ...roh, modul, spick_frieren: roh.spick_frieren ? isoTag(roh.spick_frieren) : undefined, pruefung: isoTag(roh.pruefung), themen: roh.themen.map((t) => ({ ...t, stichtag: isoTag(t.stichtag), fertig: t.fertig ? isoTag(t.fertig) : undefined, unterricht: /^\d{4}-\d{2}-\d{2}$/.test(isoTag(t.unterricht)) ? isoTag(t.unterricht) : undefined, stichworte: t.stichworte.map(String) })) } };
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

// Prüfungsangaben eines Moduls: zuerst aus dem eigenen Fahrplan (pruefung, zeit, form, bewertung, hilfsmittel),
// sonst die Werte oben. So gelten bei jedem Nutzer die Termine aus seinem Vault (16.11.2026).
function pruefungsInfo(key, plan) {
  const s = PRUEFUNG[key] || {}, pl = plan || {};
  const datum = pl.pruefung || s.datum || '';
  let zeit = pl.zeit != null && pl.zeit !== '' ? pl.zeit : (datum === s.datum ? s.zeit : '');
  // YAML liest ein unquotiertes 13:30 als Zahl (810 Minuten)
  if (typeof zeit === 'number') zeit = `${String(Math.floor(zeit / 60)).padStart(2, '0')}:${String(zeit % 60).padStart(2, '0')}`;
  return { datum, zeit: String(zeit || ''), form: String(pl.form || s.form || ''), punkte: String(pl.bewertung || s.punkte || ''), hilfsmittel: String(pl.hilfsmittel || s.hilfsmittel || ''),
    strategie: Array.isArray(pl.strategie) ? pl.strategie.map(String) : [] };
}

// Einen Wert im Kopf des Fahrplan-Blocks setzen (Einstellungen → Prüfungstermine): Zeile „key: …“ ersetzen,
// sonst nach „pruefung:“ einfügen. Gibt null zurück, wenn die Seite keinen Fahrplan-Block hat.
function setzePlanWert(text, key, wert) {
  const m = /(```pruefungsfahrplan\r?\n)([\s\S]*?)(```)/.exec(text);
  if (!m) return null;
  const nl = m[1].endsWith('\r\n') ? '\r\n' : '\n';
  const zeile = `${key}: ${wert}`;
  const zeilen = m[2].split(/\r?\n/);
  const themenAb = zeilen.findIndex((z) => /^themen:/.test(z));
  const kopfEnde = themenAb < 0 ? zeilen.length : themenAb;
  let nr = zeilen.findIndex((z, i) => i < kopfEnde && new RegExp(`^${key}:`).test(z));
  if (nr >= 0) zeilen[nr] = zeile;
  else {
    nr = zeilen.findIndex((z, i) => i < kopfEnde && /^pruefung:/.test(z));
    zeilen.splice(nr < 0 ? 0 : nr + 1, 0, zeile);
  }
  return text.slice(0, m.index) + m[1] + zeilen.join(nl) + m[3] + text.slice(m.index + m[0].length);
}

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

// Neues Fälligkeitsdatum für eine offene Karte (Knöpfe „Heute“/„Morgen“/„Datum“ an überfälligen Karten, Wunsch 17.11.).
// Sucht die Zeile wie hakeAb in der eigenen Spalte; ersetzt @{datum} oder hängt es an. null, wenn die Karte weg ist.
function setzeDatum(boardText, zeile, neuISO, spalte = null) {
  const z = boardText.split('\n');
  let i = -1;
  const sp = spalte ? z.findIndex((x) => x.trim() === `## ${spalte}`) : -1;
  if (sp >= 0) for (let j = sp + 1; j < z.length && !/^## /.test(z[j]); j++) if (z[j] === zeile) { i = j; break; }
  if (i < 0) i = z.indexOf(zeile);
  if (i < 0 || !/^- \[ \] /.test(zeile)) return null;
  const cr = /\r$/.test(z[i]) ? '\r' : '';
  const ohne = z[i].replace(/\r$/, '');
  z[i] = (/@\{\d{4}-\d{2}-\d{2}\}/.test(ohne) ? ohne.replace(/@\{\d{4}-\d{2}-\d{2}\}/, `@{${neuISO}}`) : `${ohne} @{${neuISO}}`) + cr;
  return z.join('\n');
}

// Etappe von heute: heute erledigte Lerneinheiten, dann fällige offene in Board-Reihenfolge; die erste offene ist „jetzt“
// heuteFertig(link): true, wenn das Plugin die Einheit heute abgeschlossen hat. Kanban speichert kein ✅-Datum,
// darum fiel eine heute erledigte, aber gestern fällige Einheit sonst aus der Etappe (14.11. „Bewertung nach OR“).
// rang: { schluessel: zahl } aus „Später“/„Vorziehen“ (Wunsch 16.11.), kleiner = früher, Standard 0
const etappeSchluessel = (p) => p.link || p.text;
// Kurzer Titel für die schmalen Etappen-Spalten (17.11.: „überladen“): „Wiederholung X“ → „Wdh. X“, „– Einheit“ fällt weg
// Weiche Trennstellen in langen Wörtern (ab 11 Zeichen), damit sie mit Bindestrich statt mitten im Wort umbrechen.
// Einfache Regel: zwischen zwei Konsonanten vor einem Vokal (Jour-na-lis-mus, Geldfluss-rechnung), aber nicht mitten
// in einem Dreierbündel (kein „Geldf-luss“); beide Teile mindestens 4 Zeichen. Electron trennt Deutsch nicht selbst.
const weichTrennen = (t) => String(t).replace(/[\p{L}]{11,}/gu, (w) => {
  const vok = (c) => /[aeiouäöüy]/i.test(c || '');
  const stellen = [];
  for (let i = 4; i <= w.length - 4; i++) {
    if (!vok(w[i - 1]) && !vok(w[i]) && vok(w[i + 1]) && (vok(w[i - 2]) || w[i - 1] === w[i - 2])) stellen.push(i);
  }
  return stellen.length ? stellen.reduceRight((acc, i) => acc.slice(0, i) + '­' + acc.slice(i), w) : w;
});
const etappeTitel = (t) =>String(t).replace(/^Wiederholung\s+/i, 'Wdh. ').replace(/\s+[–-]\s+Einheit(?=\s|$)/i, '').trim();
function etappeHeute(board, heuteISO, heuteFertig = () => false, rang = {}) {
  // Seit 15.11.2026: alle heute fälligen Karten, nicht nur Lerneinheiten (z. B. ein Quiz)
  // Überfällige normale Karten nicht (sonst 17 Posten), nur Lerneinheiten dürfen nachhängen.
  const lernt = (k) => k.art === 'lerneinheit' || k.art === 'wiederholen';
  const passt = (k) => lernt(k) ? k.datum <= heuteISO : k.datum === heuteISO;
  const fertig = (board.erledigt || []).filter((k) => lernt(k) ? ((k.erledigtAm || k.datum) === heuteISO || heuteFertig(k.link)) : k.erledigtAm === heuteISO)
    .map((k) => ({ text: k.text, link: k.link, modul: null, status: 'fertig', art: k.art }));
  const offen = [];
  for (const key of MODUL_KEYS) {
    for (const k of board[key] || []) if (k.datum && passt(k)) offen.push({ text: k.text, link: k.link, modul: key, status: 'offen', art: k.art });
  }
  // Board-Reihenfolge der Spalten: wie im Kanban von links nach rechts (alphabetisch, übliche Anlage)
  offen.sort((a, b) => MODUL_SPALTEN[a.modul].localeCompare(MODUL_SPALTEN[b.modul], 'de'));
  const r = (p) => rang[etappeSchluessel(p)] || 0;
  offen.sort((a, b) => r(a) - r(b));
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
  wochenzielAb: {},
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
const ZEIT_TICK_MS = 15_000;
// Ist Obsidian verdeckt oder minimiert, tickt Chromium nur noch etwa einmal pro Minute. Erst eine Lücke
// über 5 min heisst wirklich Ruhezustand/Schlaf – sonst ginge Zeit mit Taschenrechner oder Papier verloren.
const PAUSE_MS = 5 * 60_000;
// Lesezeit vor dem ersten Klick: Der Timer startet rückwirkend ab Öffnen der Einheit, höchstens so weit zurück
const VORLAUF_MS = 5 * 60_000;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const uhr = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const heute = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD in Ortszeit
const betrag = (n) => Number(n).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ── Einheitlicher Stil (18.11.): Ergebnis-Zeichen werden zu Lucide-Icons ──
const GLYPH_IKON = { '✓': 'check', '✗': 'x', '◐': 'circle-dot', '⚠': 'alert-triangle' };
const GLYPH_ZIEL = '.fle-ergebnis, .fle-diagnose li, .fle-wirkung-ok, .fle-sicher-hinweis, .fle-puzzle-urteil, .fle-tempo-text, .fle-kreuz-warum p, .fle-kreuz-warum';
function glyphenZuIkonen(root) {
  for (const el of root.querySelectorAll(GLYPH_ZIEL)) {
    const t = el.firstChild;
    if (!t || t.nodeType !== 3) continue;
    const m = /^\s*([✓✗◐⚠])\s*/.exec(t.textContent);
    if (!m) continue;
    t.textContent = t.textContent.slice(m[0].length);
    const i = h('span', 'fle-ikon');
    i.setAttribute('aria-hidden', 'true');
    obsidian.setIcon(i, GLYPH_IKON[m[1]]);
    el.insertBefore(i, t);
  }
}
function beobachteGlyphen(root, besitzer) {
  let geplant = false;
  const lauf = () => { geplant = false; glyphenZuIkonen(root); };
  const mo = new MutationObserver(() => { if (!geplant) { geplant = true; requestAnimationFrame(lauf); } });
  mo.observe(root, { childList: true, subtree: true });
  lauf();
  if (besitzer && besitzer.register) besitzer.register(() => mo.disconnect());
  return mo;
}

// Fehlerart-Auswahl (Einheit und Fehlerheft): drei Knöpfe, danach der passende nächste Schritt
function baueFehlerartWahl(box, plugin, id) {
  const reihe = box.appendChild(h('div', 'fle-fehlerart'));
  reihe.setAttribute('role', 'group');
  reihe.setAttribute('aria-label', 'Was für ein Fehler war das?');
  reihe.appendChild(h('span', 'fle-fehlerart-frage', 'Was für ein Fehler war das?'));
  const knoepfe = reihe.appendChild(h('div', 'fle-wahl'));
  // Tipp nach der Wahl entfernt (Wunsch 19.11.): nur noch die Auswahl, sie steuert das Fehlerheft
  const male = () => {
    const art = ((plugin.daten.fehler || {})[id] || {}).art;
    knoepfe.querySelectorAll('button').forEach((b) => { const an = b.dataset.art === art; b.classList.toggle('is-an', an); b.setAttribute('aria-pressed', String(an)); });
  };
  for (const [art, name, erkl] of FEHLERARTEN) {
    const b = knoepfe.appendChild(h('button', 'fle-btn fle-btn-leise fle-sicher-btn', name));
    b.dataset.art = art;
    b.title = erkl;
    b.onclick = () => {
      const alt = (plugin.daten.fehler || {})[id];
      if (!alt) return;
      plugin.daten.fehler = { ...plugin.daten.fehler, [id]: { ...alt, art } };
      plugin.speichere();
      male();
    };
  }
  male();
}

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
    beobachteGlyphen(this.root, this);
    // Erste Berührung (Klick, Taste, Scrollen) startet den Timer ab dem Öffnen – die Lesezeit der Theorie zählt mit.
    // Nicht in Hover-Vorschauen, dort wird nicht gelernt.
    this.geoeffnet = Date.now();
    const erste = () => {
      if (this.geoeffnet == null || this.pruefung || this.containerEl.closest('.hover-popover')) return;
      this.autoStart(Math.max(this.geoeffnet, Date.now() - VORLAUF_MS));
      this.geoeffnet = null;
    };
    for (const art of ['pointerdown', 'keydown', 'wheel']) this.registerDomEvent(this.root, art, erste, { capture: true });
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
    const t = this.tempoLive;
    if (t && t.bar.isConnected) t.zeige(Math.max(0, this.laufendeSekunden(t.si) - t.start), false);
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
  autoStart(ab) {
    const z = this.z;
    this.geoeffnet = null;   // nach dem ersten Start nie mehr rückwirkend
    if (z.laeuft || z.einschaetzung) return;
    const neu = starte(z, z.schritt || 0, ab || Date.now());
    neu.laeuft.puls = Date.now();
    this.plugin.daten.einheiten[this.e.id] = neu;
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
    // Fortschritt über alle Fälle (Wunsch 19.11.): gleitet vom letzten Stand zum neuen
    const faelle = this.e.schritte.flatMap((s, si) => (s.faelle || []).map((f) => `${si}.${f.id}`));
    if (faelle.length && !this.pruefung) {
      const anteil = faelle.filter((k) => (z.aufgedeckt || []).includes(k)).length / faelle.length;
      const pb = kopf.appendChild(h('div', 'fle-fortschritt'));
      pb.setAttribute('role', 'progressbar');
      pb.setAttribute('aria-valuenow', String(Math.round(anteil * 100)));
      const fu = pb.appendChild(h('div', 'fle-fortschritt-fuell' + (anteil >= 1 ? ' is-voll' : '')));
      const alt = this.letzterAnteil == null ? anteil : this.letzterAnteil;
      fu.style.width = `${alt * 100}%`;
      if (alt !== anteil) window.requestAnimationFrame(() => window.requestAnimationFrame(() => { fu.style.width = `${anteil * 100}%`; }));
      this.letzterAnteil = anteil;
    }

    const rahmen = this.root.appendChild(h('div', 'fle-rahmen'));
    const spalte = rahmen.appendChild(h('nav', 'fle-spalte'));
    // Schritt-Übergang (Wunsch 19.11.): vorwärts kommt der Inhalt von rechts, zurück von links
    const vorher = this.letzterSchritt;
    const wechsel = vorher != null && vorher !== aktiv ? (aktiv > vorher ? ' is-wechsel is-vor' : ' is-wechsel is-zurueck') : '';
    const haupt = rahmen.appendChild(h('div', 'fle-haupt' + wechsel));
    this.letzterSchritt = aktiv;

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
      if (i === this.schritte.length - 1) window.setTimeout(() => { this.fertigBekannt = true; }, 0);
      const fertig = (z.fertig || []).includes(i) || (s.art === 'einschaetzen' && z.einschaetzung) || (s.art === 'abgabe' && z.abgegeben);
      const li = liste.appendChild(h('li'));
      if (!this.fertigGesehen) this.fertigGesehen = new Set();
      const frischFertig = fertig && this.fertigBekannt && !this.fertigGesehen.has(i);
      if (fertig) this.fertigGesehen.add(i);
      const b = li.appendChild(h('button', 'fle-schritt' + (i === aktiv ? ' is-aktiv' : '') + (fertig ? ' is-fertig' : '') + (frischFertig ? ' is-neu' : '')));
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
    // Wandernder Zeiger hinter dem aktiven Schritt: gleitet vom alten zum neuen Schritt
    const zeiger = liste.appendChild(h('span', 'fle-zeiger'));
    zeiger.setAttribute('aria-hidden', 'true');
    const lage = (i) => { const b = liste.querySelectorAll('.fle-schritt')[i]; if (!b) return null; const r = b.getBoundingClientRect(), o = liste.getBoundingClientRect(); return { l: r.left - o.left, t: r.top - o.top, w: r.width, h: r.height }; };
    const setze = (p) => { if (p) Object.assign(zeiger.style, { left: `${p.l}px`, top: `${p.t}px`, width: `${p.w}px`, height: `${p.h}px` }); };
    window.requestAnimationFrame(() => {
      const neu = lage(aktiv);
      if (!neu) return;
      if (vorher != null && vorher !== aktiv && lage(vorher)) {
        zeiger.classList.add('is-ohne'); setze(lage(vorher)); void zeiger.offsetWidth; zeiger.classList.remove('is-ohne');
      }
      setze(neu);
      zeiger.classList.add('is-da');
    });
    // Liste verändert noch ihre Höhe (Schrift, Zeiten): Zeiger nachführen, sonst sitzt er einen Schritt daneben
    if (this.zeigerRO) this.zeigerRO.disconnect();
    if (typeof ResizeObserver === 'function') {
      this.zeigerRO = new ResizeObserver(() => { if (zeiger.classList.contains('is-da')) setze(lage(aktiv)); });
      this.zeigerRO.observe(liste);
      liste.querySelectorAll('.fle-schritt').forEach((b) => this.zeigerRO.observe(b));
    }

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

  // Früherer Fall direkt eingeblendet: Text, bei aufgedeckten Buchungen auch die Lösung
  baueBezug(box, si, fall) {
    const liste = bezuege(this.e.schritte, si, fall);
    if (!Array.isArray(liste) || !liste.length) return;
    for (const b of liste) {
      if (b.fall && b.si === si) continue;   // Fall steht direkt darüber auf derselben Seite (Wunsch 19.11.)
      const ref = box.appendChild(h('div', 'fle-bezug'));
      const s = this.e.schritte[b.si];
      const wo = b.si === si ? '' : `${s.titel} · `;
      if (!b.fall) {
        ref.appendChild(h('div', 'fle-bezug-titel', `↪ Aus ${s.titel}`));
        this.md(ref.appendChild(h('div', 'fle-md')), [s.einleitung, s.text].filter(Boolean).join('\n\n'));
        continue;
      }
      ref.appendChild(h('div', 'fle-bezug-titel', `↪ Aus ${wo}${b.fall.id})`));
      this.md(ref.appendChild(h('div', 'fle-md')), b.fall.text);
      const key = `${b.si}.${b.fall.id}`;
      if (Array.isArray(b.fall.loesung) && b.fall.loesung.length && this.z.aufgedeckt.includes(key)) {
        const tab = ref.appendChild(h('table', 'fle-bezug-loesung'));
        for (const [soll, haben, betrag] of b.fall.loesung) {
          const tr = tab.appendChild(h('tr'));
          tr.appendChild(h('td', '', soll)); tr.appendChild(h('td', '', haben)); tr.appendChild(h('td', 'fle-zahl', betrag == null ? '' : Number(betrag).toLocaleString('de-CH')));
        }
      }
    }
  }

  baueFaelle(el, s, si) {
    this.tempoLive = null;
    if (s.einleitung) this.md(el.appendChild(h('div', 'fle-md fle-einleitung')), s.einleitung);
    for (const fall of s.faelle) {
      const key = `${si}.${fall.id}`;
      const box = el.appendChild(h('section', 'fle-fall' + (this.frisch === key ? ' fle-frisch' : '')));
      const kopf = box.appendChild(h('div', 'fle-fall-kopf'));
      kopf.appendChild(h('span', 'fle-fall-id', `${fall.id})`));
      if (this.pruefung) kopf.appendChild(h('span', 'fle-fall-punkte', `${fall.punkte} P`));
      this.md(kopf.appendChild(h('div', 'fle-md')), fall.text);
      if (!this.pruefung) this.baueBezug(box, si, fall);

      this.baueTyp(box, fall, key);
    }
    this.frisch = null;   // nur der eben aufgedeckte Fall animiert, nicht jedes Neuzeichnen
    if (this.e.modul === 'mathe') return;
    // Vorschläge für die Kontofelder, einmal pro Ansicht
    const dl = el.appendChild(h('datalist'));
    dl.id = 'fle-konten';
    for (const k of [...KONTENPLAN.bilanz, ...KONTENPLAN.erfolg]) dl.appendChild(h('option')).value = k;
  }

  baueTyp(box, fall, key) {
    if (fall.art === 'antwort') return this.baueAntwort(box, fall, key);
    if (fall.art === 'zahl') return this.baueZahl(box, fall, key);
    if (istKreuz(fall)) return this.baueKreuz(box, fall, key);
    return this.baueBuchung(box, fall, key);
  }

  // Zwillingsaufgabe (Wunsch 18.11., Vorbild: Mathe-Bonustest in 12 Versionen): Ist der Fall aufgedeckt und
  // nicht ganz richtig, erscheint dieselbe Aufgabe mit neuen Zahlen. Zählt nicht in die Trefferquote.
  // Fehlerart (Wunsch 18.11., Prinzip 6): nach einem Fehler kurz einordnen; die Wiederholung im Fehlerheft richtet sich danach
  baueFehlerart(box, key) {
    if (this.pruefung || key.includes('~z')) return;
    const e = (this.z.ergebnisse || {})[key];
    if (!this.z.aufgedeckt.includes(key) || !e || e.wert == null || e.wert >= 1) return;
    const [si, fid] = [Number(key.split('.')[0]), key.slice(key.indexOf('.') + 1)];
    const id = fehlerId(this.e.id, si, fid);
    if (!(this.plugin.daten.fehler || {})[id]) return;
    baueFehlerartWahl(box, this.plugin, id);
  }

  baueZwilling(box, fall, key) {
    this.baueFehlerart(box, key);
    if (this.pruefung || !fall.zwilling) return;
    const e = (this.z.ergebnisse || {})[key];
    if (!this.z.aufgedeckt.includes(key) || !e || e.wert == null) return;
    if (e.wert >= 1 && e.sicher !== 'geraten') return;   // richtig geraten bekommt auch einen Zwilling
    const zw = box.appendChild(h('section', 'fle-zwilling' + (this.frisch === `${key}~z` ? ' fle-frisch' : '')));
    const zt = zw.appendChild(h('div', 'fle-zwilling-titel'));
    const zi = zt.appendChild(h('span', 'fle-ikon'));
    zi.setAttribute('aria-hidden', 'true');
    obsidian.setIcon(zi, 'repeat');
    zt.appendChild(document.createTextNode('Nochmals mit neuen Zahlen'));
    zw.appendChild(h('div', 'fle-leise', 'Gleiche Aufgabe, andere Zahlen. So merkst du sofort, ob der Fehler jetzt sitzt.'));
    this.md(zw.appendChild(h('div', 'fle-md')), fall.zwilling.text);
    this.baueTyp(zw, fall.zwilling, `${key}~z`);
    this.baueSicher(zw, `${key}~z`);
  }


  // Prüfungstempo pro Fall (Wunsch 18.11.): Balken mit 1 min pro Buchungszeile bzw. Punkt; live nur beim ersten offenen Fall
  baueTempo(box, si, s, fall, key) {
    if (this.pruefung) return;
    const z = this.z;
    const soll = tempoSoll(fall);
    const bar = box.appendChild(h('div', 'fle-tempo'));
    const fuell = bar.appendChild(h('div', 'fle-tempo-fuell'));
    const txt = bar.appendChild(h('span', 'fle-tempo-text'));
    const WORT = { gut: ' ✓ im Prüfungstempo', knapp: ' · etwas langsamer als an der Prüfung', langsam: ' · deutlich zu langsam' };
    const zeige = (sek, fertig) => {
      const st = tempoStufe(sek, soll);
      fuell.style.width = `${Math.min(100, (sek / soll) * 100)}%`;
      bar.className = `fle-tempo is-${st}${fertig ? ' is-fertig' : ''}`;
      txt.textContent = `${uhr(sek)} / ${uhr(soll)}${fertig ? WORT[st] : ' Prüfungstempo'}`;
    };
    const e = (z.ergebnisse || {})[key];
    if (z.aufgedeckt.includes(key)) { if (e && e.sek) zeige(e.sek, true); else bar.remove(); return; }
    const erster = s.faelle.find((f) => !z.aufgedeckt.includes(`${si}.${f.id}`));
    if (erster !== fall) { bar.classList.add('is-wartet'); txt.textContent = `Prüfungstempo ${uhr(soll)}`; return; }
    // Ab dem zweiten Fall startet der Balken erst auf Knopfdruck (Wunsch 19.11.): erst Fehler anschauen, dann weiter
    const ts = (z.tempoStart || {})[key];
    const idx = s.faelle.indexOf(fall);
    if (ts == null && idx > 0) {
      bar.className = 'fle-tempo-start';
      bar.empty();
      const knopf = bar.appendChild(h('button', 'fle-btn mod-cta', 'Aufgabe starten'));
      bar.appendChild(h('span', 'fle-leise', `Prüfungstempo ${uhr(soll)}`));
      const los = () => {
        this.z.tempoStart = { ...(this.z.tempoStart || {}), [key]: this.laufendeSekunden(si) };
        this.autoStart();
        this.setze(this.z);
        this.baue();
      };
      knopf.addEventListener('click', los);
      return;
    }
    const start = ts != null ? ts : 0;
    this.tempoLive = { si, start, zeige, bar };
    zeige(Math.max(0, this.laufendeSekunden(si) - start), false);
  }

  // Erst Wirkung tippen (Wunsch 18.11.): vor der Buchungstabelle wählen, was passiert. true = Tabelle noch nicht zeigen
  baueWirkungFrage(box, fall, key) {
    if (this.pruefung || CFG.wirkungZuerst === false || (this.e.modul && this.e.modul !== 'fa')) return false;
    const soll = wirkungSoll(fall.loesung);
    if (!soll || this.z.aufgedeckt.includes(key)) return false;
    const w = (this.z.wirkung || {})[key];
    // Ältere Stände: „Keine Buchung“ schon gewählt, aber noch nicht aufgelöst → jetzt nachholen
    if (w && soll.length === 1 && soll[0] === 'Keine Buchung') { window.setTimeout(() => { if (!this.z.aufgedeckt.includes(key)) this.deckeAuf(key, w.wahl === 'Keine Buchung' ? 1 : 0, true); }, 0); return true; }
    if (w) {
      box.appendChild(h('div', `fle-wirkung-ok ${w.richtig ? 'is-richtig' : 'is-falsch'}`, w.richtig
        ? `✓ ${w.wahl}: richtig erkannt. Jetzt die Buchung.`
        : `✗ Du hast „${w.wahl}“ gewählt. Richtig ist ${soll.map((x) => `„${x}“`).join(' bzw. ')}. Überleg kurz, warum, dann buche.`));
      return false;
    }
    const reihe = box.appendChild(h('div', 'fle-wirkung-frage'));
    reihe.appendChild(h('div', 'fle-label', 'Zuerst: Was passiert bei diesem Fall?'));
    const knoepfe = reihe.appendChild(h('div', 'fle-wahl'));
    for (const t of WIRKUNGEN) {
      const b = knoepfe.appendChild(h('button', 'fle-btn fle-btn-leise', t));
      b.onclick = () => {
        this.autoStart(); this.merkeStart(key);
        this.frisch = key;
        this.setze({ ...this.z, wirkung: { ...(this.z.wirkung || {}), [key]: { wahl: t, richtig: soll.includes(t) } } });
        // Ist „Keine Buchung“ die Lösung, gibt es nichts zu buchen: direkt auflösen statt leere Tabelle (Wunsch 19.11.)
        if (soll.length === 1 && soll[0] === 'Keine Buchung') { this.deckeAuf(key, t === 'Keine Buchung' ? 1 : 0, true); return; }
        this.baue();
      };
    }
    reihe.appendChild(h('div', 'fle-leise', 'Danach erscheint die Buchungstabelle.'));
    return true;
  }

  // Fehlerheft (Wunsch 18.11.): nicht ganz richtige Fälle merken, Wiederholung nach 1/3/7 Tagen
  insFehlerheft(key, wert, sicher = null) {
    if (this.pruefung || key.includes('~z') || wert == null || wert >= 1) return;
    const [si, fid] = [Number(key.split('.')[0]), key.slice(key.indexOf('.') + 1)];
    const fall = ((this.e.schritte[si] || {}).faelle || []).find((f) => String(f.id) === fid);
    if (!fall) return;
    const titel = String(fall.text).replace(/[*_`]/g, '').slice(0, 110);
    this.plugin.daten.fehler = fehlerEintragen(this.plugin.daten.fehler, { einheit: this.e.id, pfad: this.pfad, si, fall: fid, modul: this.e.modul || 'fa', thema: this.e.thema, titel, ...(sicher ? { sicher } : {}) }, heute());
    this.plugin.speichere();
  }

  // Vor dem Aufdecken: Wie sicher bist du? Danach ein Hinweis bei „sicher, aber falsch“ oder „richtig geraten“.
  baueSicher(box, key) {
    if (this.pruefung) return;
    const z = this.z;
    const eigen = (el) => el.closest('.fle-zwilling, .fle-fall') === box;
    if (z.aufgedeckt.includes(key)) {
      const e = (z.ergebnisse || {})[key] || {};
      const erg = [...box.querySelectorAll('.fle-ergebnis')].find(eigen);
      if (!erg || e.wert == null) return;
      let text = '';
      if (e.sicher === 'sicher' && e.wert < 0.5) text = '⚠ Sicher, aber falsch: ein Denkfehler. Lies das Warum genau. Das Thema kommt dafür früher wieder.';
      else if (e.sicher === 'geraten' && e.wert >= 1) text = 'Richtig geraten. Das zählt, aber übe es unten nochmals.';
      else if (e.sicher === 'sicher' && e.wert >= 1) text = '✓ Sicher und richtig. Das sitzt.';
      if (text) erg.insertAdjacentElement('afterend', h('div', 'fle-sicher-hinweis' + (e.wert < 0.5 ? ' is-warnung' : ''), text));
      return;
    }
    const knopf = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Lösung zeigen' && eigen(b));
    if (!knopf) return;
    const ziel = knopf.closest('.fle-aktionen, .fle-loesung') || knopf;
    const reihe = h('div', 'fle-sicher');
    reihe.dataset.sicher = key;
    reihe.appendChild(h('span', 'fle-leise', 'Vor dem Aufdecken: Wie sicher bist du?'));
    const wahl = (z.sicher || {})[key];
    for (const [wert, text] of SICHER) {
      const b = reihe.appendChild(h('button', 'fle-btn fle-btn-leise fle-sicher-btn' + (wahl === wert ? ' is-an' : ''), text));
      b.setAttribute('aria-pressed', String(wahl === wert));
      b.onclick = () => {
        this.z.sicher = { ...(this.z.sicher || {}), [key]: wert };
        this.plugin.speichere();
        reihe.querySelectorAll('.fle-sicher-btn').forEach((x) => { const an = x === b; x.classList.toggle('is-an', an); x.setAttribute('aria-pressed', String(an)); });
        reihe.classList.remove('is-mahnen');
      };
    }
    ziel.parentElement.insertBefore(reihe, ziel);
  }

  baueBuchung(box, fall, key) {
      const z = this.z;
      if (this.baueWirkungFrage(box, fall, key)) return;
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
      // Aufgelöst ohne eigene Eingabe (z. B. „Keine Buchung“ per Knopf): leere Tabelle und „+ Zeile“ weglassen (19.11.)
      if (offen && istLeer(z.eingaben[key])) { tab.remove(); plus.remove(); }
      const loes = box.appendChild(h('div', 'fle-loesung'));
      if (!offen && this.pruefung) {
        // Probeprüfung: Lösungen erst nach der Abgabe
      } else if (!offen) {
        const b = aktionen.appendChild(h('button', 'fle-btn', 'Lösung zeigen'));
        b.onclick = () => this.deckeAuf(key, bewerteBuchung(zeilen, fall.loesung));
      } else {
        this.zeigeErgebnis(loes, key);
        this.zeigeDiagnose(loes, tbody, zeilen, fall.loesung);
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

  // Fehler genau zeigen: Felder der eigenen Buchung einfärben und pro Zeile sagen, was nicht stimmt
  zeigeDiagnose(loes, tbody, zeilen, loesung) {
    const dg = buchungsDiagnose(zeilen, loesung);
    const trs = [...tbody.children];
    trs.forEach((tr) => tr.querySelectorAll('input').forEach((i) => { i.readOnly = true; }));
    const MARK = { ok: [1, 1, 1], betrag: [1, 1, 0], soll: [0, 1, 1], haben: [1, 0, 1], vertauscht: [0, 0, 1], konten: [0, 0, 1], extra: [0, 0, 0] };
    const liste = h('ul', 'fle-diagnose');
    let n = 0;
    const zeile = (cls, text) => { const li = liste.appendChild(h('li', cls, text)); li.style.animationDelay = `${n++ * 120}ms`; };
    for (const d of dg.zeilen) {
      const tr = trs[d.i];
      if (tr) {
        tr.classList.add(`fle-z-${d.status}`);
        tr.querySelectorAll('input').forEach((inp, c) => inp.classList.add(MARK[d.status][c] ? 'is-ok' : 'is-fehler'));
      }
      const nr = `Zeile ${d.i + 1}`;
      const r = d.soll;
      if (d.status === 'ok') zeile('is-ok', `✓ ${nr} stimmt.`);
      else if (d.status === 'betrag') zeile('is-teil', `◐ ${nr}: Konten richtig, Betrag falsch (richtig: ${betrag(Number(r[2]))}).`);
      else if (d.status === 'soll') zeile('is-fehler', `✗ ${nr}: Soll-Konto falsch (richtig: ${r[0]}).`);
      else if (d.status === 'haben') zeile('is-fehler', `✗ ${nr}: Haben-Konto falsch (richtig: ${r[1]}).`);
      else if (d.status === 'vertauscht') zeile('is-fehler', `✗ ${nr}: Soll und Haben vertauscht.`);
      else if (d.status === 'konten') zeile('is-fehler', `✗ ${nr}: Betrag passt, aber beide Konten sind falsch (richtig: ${r[0]} / ${r[1]}).`);
      else zeile('is-fehler', `✗ ${nr}: unnötige Zeile. An der Prüfung gibt das Abzug.`);
    }
    for (const f of dg.fehlend) zeile('is-fehler', `✗ Fehlt: ${f[0]} / ${f[1]} ${typeof f[2] === 'number' ? betrag(f[2]) : f[2]}`);
    if (n) loes.appendChild(liste);
  }

  // Buchung als T-Konten: Beträge fliegen ins Soll bzw. Haben, darunter die Wirkung jeder Zeile
  baueTKonten(el, loesung) {
    const box = el.appendChild(h('div', 'fle-tkonten-box'));
    box.appendChild(h('div', 'fle-label', 'So wirkt die Buchung'));
    const konten = new Map();
    const ART = { aktiv: 'Aktivkonto', minusaktiv: 'Minus-Aktivkonto', passiv: 'Passivkonto', aufwand: 'Aufwandkonto', ertrag: 'Ertragskonto' };
    loesung.forEach(([so, ha, be], i) => {
      for (const [name, seite] of [[so, 'soll'], [ha, 'haben']]) {
        const k = normKonto(name);
        if (!konten.has(k)) konten.set(k, { name, soll: [], haben: [] });
        konten.get(k)[seite].push({ be, i });
      }
    });
    const reihe = box.appendChild(h('div', 'fle-tkonten'));
    for (const [k, t] of konten) {
      const art = kontoArt(k);
      const tk = reihe.appendChild(h('div', `fle-t is-${art || 'neutral'}`));
      tk.appendChild(h('div', 'fle-t-name', t.name));
      if (art) tk.appendChild(h('div', 'fle-t-art', ART[art]));
      const koerper = tk.appendChild(h('div', 'fle-t-koerper'));
      for (const seite of ['soll', 'haben']) {
        const sp = koerper.appendChild(h('div', `fle-t-seite is-${seite}`));
        sp.appendChild(h('div', 'fle-t-kopf', seite === 'soll' ? 'Soll' : 'Haben'));
        for (const { be, i } of t[seite]) {
          const b = sp.appendChild(h('div', 'fle-t-betrag', typeof be === 'number' ? betrag(be) : String(be)));
          b.style.animationDelay = `${150 + i * 450}ms`;
        }
      }
    }
    const wirkung = box.appendChild(h('ol', 'fle-wirkung'));
    loesung.forEach(([so, ha], i) => {
      const w = buchungsWirkung(so, ha);
      const li = wirkung.appendChild(h('li'));
      li.style.animationDelay = `${350 + i * 450}ms`;
      li.appendChild(h('b', null, w.titel));
      const teile = [w.soll && `${so}: ${w.soll}`, w.haben && `${ha}: ${w.haben}`].filter(Boolean);
      if (teile.length) li.appendChild(h('span', 'fle-leise', ` · ${teile.join(' · ')}`));
    });
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

  // Ankreuzfrage: Kprim (richtig/falsch je Aussage) oder Auswahl (A+ = eine, MC = mehrere); bewertet sich selbst
  baueKreuz(box, fall, key) {
    const kprim = fall.art === 'kprim';
    const offen = this.z.aufgedeckt.includes(key);
    const n = kprim ? fall.kprim.length : fall.optionen.length;
    const wahl = kprim ? kprimWahl(this.z.eingaben[key], n)
      : BUCHSTABEN.slice(0, n).split('').map((b) => (auswahlWahl(this.z.eingaben[key]).includes(b) ? b : ''));
    const merke = () => { this.autoStart(); this.merkeStart(key); this.z.eingaben[key] = [[...wahl]]; this.plugin.speichere(); };
    const liste = box.appendChild(h('div', 'fle-kreuz' + (kprim ? ' is-kprim' : '') + (offen ? ' is-zu' : '')));
    if (!kprim && !offen) liste.appendChild(h('div', 'fle-leise', fall.mehrfach ? 'Mehrere Antworten können richtig sein.' : 'Genau eine Antwort ist richtig.'));
    const knoepfe = [];
    for (let i = 0; i < n; i++) {
      const zeile = liste.appendChild(h('div', 'fle-kreuz-zeile'));
      const buchstabe = BUCHSTABEN[i];
      zeile.appendChild(h('span', 'fle-kreuz-nr', kprim ? `${i + 1}.` : `${buchstabe})`));
      const textEl = zeile.appendChild(h('div', 'fle-md fle-kreuz-text'));
      this.md(textEl, kprim ? String(fall.kprim[i].aussage) : fall.optionen[i]);
      const reihe = zeile.appendChild(h('div', 'fle-kreuz-wahl'));
      const optionen = kprim ? [['r', 'richtig'], ['f', 'falsch']] : [[buchstabe, fall.mehrfach ? '☐' : '○']];
      for (const [wert, label] of optionen) {
        const b = reihe.appendChild(h('button', 'fle-btn fle-kreuz-btn', label));
        b.setAttribute('aria-label', kprim ? `Aussage ${i + 1}: ${label}` : `Antwort ${buchstabe}`);
        knoepfe.push({ b, i, wert });
        if (offen || (this.pruefung && this.z.abgegeben)) { b.disabled = true; continue; }
        b.onclick = () => {
          if (kprim) wahl[i] = wahl[i] === wert ? '' : wert;
          else if (fall.mehrfach) wahl[i] = wahl[i] ? '' : wert;
          else for (let k = 0; k < n; k++) wahl[k] = k === i && !wahl[i] ? wert : '';
          merke(); male();
        };
      }
      if (offen) {
        const soll = kprim ? (fall.kprim[i].richtig ? 'r' : 'f') : fall.richtig.includes(buchstabe) ? buchstabe : '';
        const gewaehlt = wahl[i];
        const stimmt = kprim ? gewaehlt === soll : (gewaehlt === buchstabe) === !!soll;
        zeile.classList.add(stimmt ? 'is-richtig' : 'is-falsch');
        if (!kprim && soll) zeile.classList.add('is-loesung');
        const hinweis = kprim ? `${soll === 'r' ? 'richtig' : 'falsch'}${fall.kprim[i].warum ? ' – ' + fall.kprim[i].warum : ''}` : '';
        if (hinweis) this.md(zeile.appendChild(h('div', 'fle-md fle-kreuz-warum')), (stimmt ? '✓ ' : '✗ ') + hinweis);
      }
    }
    const male = () => {
      for (const { b, i, wert } of knoepfe) {
        const an = wahl[i] === wert;
        b.classList.toggle('is-an', an);
        b.setAttribute('aria-pressed', String(an));
        if (!kprim) b.textContent = an ? (fall.mehrfach ? '☑' : '●') : (fall.mehrfach ? '☐' : '○');
      }
    };
    male();
    const loes = box.appendChild(h('div', 'fle-loesung'));
    if (!offen) {
      if (this.pruefung) return;
      const b = loes.appendChild(h('button', 'fle-btn', 'Lösung zeigen'));
      b.onclick = () => this.deckeAuf(key, bewerteKreuz([[...wahl]], fall));
      return;
    }
    this.zeigeErgebnis(loes, key);
    if (!kprim) {
      loes.appendChild(h('div', 'fle-label', 'Lösung'));
      loes.appendChild(h('div', 'fle-md', `Richtig: ${fall.richtig.join(', ')}`));
    }
    const erklaerung = fall.warum || fall.antwort;
    if (erklaerung) this.md(loes.appendChild(h('div', 'fle-md fle-warum')), erklaerung);
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
    // Lösungsweg Schritt für Schritt (Wunsch 18.11.): einzelne Schritte vor dem Aufdecken, der letzte bleibt zu
    const wegTeil = !offen && !this.pruefung && Array.isArray(fall.weg) && fall.weg.length >= 2;
    const wegK = wegTeil ? Math.min((z.wegStufe || {})[key] || 0, fall.weg.length - 1) : 0;
    if (wegTeil && wegK) {
      const wb = box.appendChild(h('div', 'fle-weg-teil'));
      wb.appendChild(h('div', 'fle-label', `Lösungsweg, ${wegK} von ${fall.weg.length} Schritten`));
      const ol = wb.appendChild(h('ol', 'fle-weg'));
      fall.weg.slice(0, wegK).forEach((w, i) => { const li = ol.appendChild(h('li', i === wegK - 1 ? 'is-neu' : '')); this.md(li, w); });
      wb.appendChild(h('div', 'fle-leise', 'Versuch jetzt selbst weiter und gib dann deine Antwort ein.'));
    }
    const aktionen = box.appendChild(h('div', 'fle-aktionen'));
    if (wegTeil && wegK < fall.weg.length - 1) {
      const wbtn = aktionen.appendChild(h('button', 'fle-btn fle-btn-leise', wegK ? 'Nächsten Schritt zeigen' : 'Ersten Schritt des Lösungswegs zeigen'));
      wbtn.onclick = () => { this.autoStart(); this.merkeStart(key); this.frisch = key; this.setze({ ...this.z, wegStufe: { ...(this.z.wegStufe || {}), [key]: wegK + 1 } }); this.baue(); };
    }
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
      if (!this.pruefung) loes.appendChild(h('div', 'fle-leise fle-allein', e.leer ? 'Lösung ohne eigene Antwort angesehen' : e.weg ? `mit Hilfe (${e.weg} Schritt${e.weg > 1 ? 'e' : ''} des Lösungswegs${e.hilfe > e.weg ? ', Tipp ' + (e.hilfe - e.weg) : ''})` : e.hilfe ? `mit Hilfe (Tipp ${e.hilfe})` : 'allein gelöst'));
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
      if (fall.warum) this.md(loes.appendChild(h('div', 'fle-md fle-warum')), fall.warum);
    }
    if (this.pruefung || this.e.modul !== 'mathe') return;   // Spick gibt es nur in Mathe
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
    if (!z.tempoStart) z.tempoStart = {};
    if (z.tempoStart[key] == null) z.tempoStart[key] = z.uhr[key];   // tippen ohne ▶ startet ab jetzt
  }

  // Aufdecken friert das Ergebnis ein: Abschreiben danach ändert nichts mehr
  deckeAuf(key, wert, beantwortet = false) {   // beantwortet: Antwort kam per Knopf („Keine Buchung“), nicht über Felder
    const z = this.z;
    if (false) {   // „Wie sicher?“ entfernt (Wunsch 19.11.)
      new obsidian.Notice('Zuerst kurz antippen: Wie sicher bist du?');
      const r = this.root && [...this.root.querySelectorAll('.fle-sicher')].find((x) => x.dataset.sicher === key);
      if (r) { r.classList.remove('is-mahnen'); void r.offsetWidth; r.classList.add('is-mahnen'); }
      return;
    }
    z.uhr = { ...(z.uhr || {}), [key]: this.laufendeSekunden(Number(key.split('.')[0])) };
    const sek = fallSekunden(z, key);
    const a = new Set(z.aufgedeckt); a.add(key);
    const weg = (z.wegStufe || {})[key] || 0;
    const hilfe = ((z.hilfe || {})[key] || 0) + weg;
    const leer = !beantwortet && istLeer((z.eingaben || {})[key]);
    const sicher = leer ? null : (z.sicher || {})[key] || null;
    this.insFehlerheft(key, wert, sicher);
    this.frisch = key;
    this.setze({ ...z, aufgedeckt: [...a], ergebnisse: { ...(z.ergebnisse || {}), [key]: { wert, sek, hilfe, ...(weg ? { weg } : {}), ...(sicher ? { sicher } : {}), ...(leer ? { leer: true } : {}) } } });
    this.baue();
  }

  bewerteSelbst(key, wert) {
    const z = this.z;
    const alt = (z.ergebnisse || {})[key] || { sek: 0 };
    this.insFehlerheft(key, wert, alt.sicher || null);
    this.setze({ ...z, ergebnisse: { ...(z.ergebnisse || {}), [key]: { ...alt, wert } } });
    if (this.pruefung && z.abgegeben) this.speichereProbe();
    this.baue();
  }

  // Punkte-Flug (Wunsch 19.11.): ein Stern fliegt vom Ergebnis zum Fortschrittsbalken und lässt ihn aufleuchten
  punkteFlug(von) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ziel = this.root && [...this.root.querySelectorAll('.fle-fortschritt-fuell')].find((x) => x.offsetParent);
    if (!von.isConnected || !ziel) return;
    const a = von.getBoundingClientRect(), b = ziel.getBoundingClientRect();
    const st = document.body.appendChild(h('div', 'fle-flugstern'));
    obsidian.setIcon(st, 'star');
    const x0 = a.left + 14, y0 = a.top + a.height / 2, x1 = b.right - 6, y1 = b.top + b.height / 2;
    const mx = (x0 + x1) / 2 + 60, my = Math.min(y0, y1) - 80;
    const bahn = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t * t * x1;
      const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t * t * y1;
      return { transform: `translate(${x - 9}px, ${y - 9}px) scale(${1 + Math.sin(t * Math.PI) * 0.6}) rotate(${t * 300}deg)`, opacity: t > 0.9 ? 0.6 : 1 };
    });
    const ani = st.animate(bahn, { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' });
    ani.onfinish = () => {
      st.remove();
      const pb = ziel.parentElement;
      pb.classList.remove('is-blitz'); void pb.offsetWidth; pb.classList.add('is-blitz');
    };
  }

  zeigeErgebnis(el, key) {
    const e = (this.z.ergebnisse || {})[key];
    if (!e) return;
    const zeit = e.sek ? ` · ${Math.max(1, Math.round(e.sek / 60))} min` : '';
    if (e.wert == null) { el.appendChild(h('div', 'fle-ergebnis is-offen', `Noch nicht bewertet${zeit}`)); return; }
    const t = ERGEBNIS_TEXT(e.wert);
    const cls = e.wert >= 1 ? 'is-richtig' : e.wert > 0 ? 'is-teilweise' : 'is-falsch';
    const neu = this.frisch === key;
    const erg = el.appendChild(h('div', `fle-ergebnis ${cls}${neu ? ' is-neu' : ''}`, `${e.wert >= 1 ? '✓' : e.wert > 0 ? '◐' : '✗'} ${t}${zeit}`));
    erg.setAttribute('role', 'status');
    if (neu && e.wert >= 1) window.setTimeout(() => funken(erg), 120);   // Serie + Stern-Flug entfernt (19.11.)
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
          : fall.art === 'zahl' ? pruefeZahlFall(eingabe, fall) : istKreuz(fall) ? bewerteKreuz(eingabe, fall) : null;
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
      b.onclick = async () => { const erstes = !z.einschaetzung; await this.plugin.schliesseAb(this.e, w); this.feiern = erstes; this.baue(); };
    }
    if (this.feiern) {
      this.feiern = false;
      const perfekt = q && q.prozent >= 100;
      const g = el.insertBefore(h('div', 'fle-geschafft' + (perfekt ? ' is-perfekt' : '')), el.firstChild);
      const ring = g.appendChild(h('div', 'fle-geschafft-ring'));
      ring.innerHTML = '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27 l8 8 l15 -17"/></svg>';
      const tx = g.appendChild(h('div', 'fle-geschafft-text'));
      tx.appendChild(h('strong', null, perfekt ? 'Perfekt! Alles richtig' : 'Einheit geschafft'));
      if (q) { const zahl = tx.appendChild(h('span')); zaehleHoch(zahl, q.prozent, ' % richtig'); }
      window.requestAnimationFrame(() => g.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      const farben = perfekt ? ['#f5c542', '#ffd76a', '#e0a100', '#fff1b8', '#4caf50'] : ['#4caf50', '#f5c542', '#3b82f6', '#ff6b4a', '#a855f7'];
      window.setTimeout(() => schiesseKonfetti(farben), 350);
      if (perfekt) window.setTimeout(() => schiesseKonfetti(farben), 1300);
    }
    if (z.einschaetzung) el.appendChild(h('div', 'fle-leise', z.board ? 'Gespeichert, die Karte liegt in „Erledigt“.' : 'Gespeichert.'));
  }
}

const STATUS_TEXT = { sitzt: 'sitzt', fast: 'fast', wackelig: 'wackelig', offen: 'offen', ueberfaellig: 'überfällig' };
const DRUCK_TEXT = {
  ruhe: ['Noch nicht dran', 'Für die Themen beginnt die Soll-Kurve erst.'],
  gut: ['Im Plan', 'Du bist so weit, wie dein Fahrplan es heute vorsieht.'],
  knapp: ['Knapp', 'Leicht hinter deinem Fahrplan – heute eine Einheit, dann passt es.'],
  hinten: ['Rückstand', 'Deutlich hinter deinem Fahrplan – die roten Themen zuerst.'],
  alarm: ['Alarm', 'Weit hinter deinem Fahrplan – jeden Tag eine Einheit, bis es grün wird.'],
};
const kurz = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}.`; };

// Zahl hochzählen lassen (bei „weniger Bewegung“ sofort der Endwert)
// Konfetti von links und rechts, wenn die Etappe des Tages geschafft ist (Wunsch 14.11.2026)
function schiesseKonfetti(farben) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.body.appendChild(document.createElement('canvas'));
  cv.className = 'flz-konfetti';
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const teile = [];
  const salve = (seite, anzahl) => {
    for (let i = 0; i < anzahl; i++) {
      const winkel = (-90 - seite * (25 + Math.random() * 35)) * Math.PI / 180;   // links nach rechts oben, rechts nach links oben
      const tempo = (0.9 + Math.random() * 0.7) * Math.min(W, H) * 0.028 + 6;
      teile.push({
        x: seite < 0 ? -10 : W + 10, y: H * (0.62 + Math.random() * 0.12),
        vx: Math.cos(winkel) * tempo, vy: Math.sin(winkel) * tempo,
        w: 6 + Math.random() * 6, hh: 4 + Math.random() * 5, rund: Math.random() < 0.25,
        dreh: Math.random() * Math.PI, drehV: (Math.random() - 0.5) * 0.35,
        kipp: Math.random() * Math.PI, kippV: 0.08 + Math.random() * 0.12,
        farbe: farben[Math.floor(Math.random() * farben.length)],
      });
    }
  };
  salve(-1, 80); salve(1, 80);
  window.setTimeout(() => { salve(-1, 45); salve(1, 45); }, 280);
  const start = performance.now();
  let letzt = start;
  const bild = (jetzt) => {
    const f = Math.min(3, (jetzt - letzt) / 16.7); letzt = jetzt;
    ctx.clearRect(0, 0, W, H);
    const alter = jetzt - start;
    const blass = alter > 3200 ? Math.max(0, 1 - (alter - 3200) / 900) : 1;
    let sichtbar = 0;
    for (const t of teile) {
      t.vy += 0.32 * f; t.vx *= Math.pow(0.986, f); t.vy *= Math.pow(0.986, f);
      t.x += t.vx * f + Math.sin(t.kipp) * 0.6; t.y += t.vy * f;
      t.dreh += t.drehV * f; t.kipp += t.kippV * f;
      if (t.y > H + 20) continue;
      sichtbar++;
      ctx.save();
      ctx.globalAlpha = blass;
      ctx.translate(t.x, t.y); ctx.rotate(t.dreh); ctx.scale(1, Math.cos(t.kipp));
      ctx.fillStyle = t.farbe;
      if (t.rund) { ctx.beginPath(); ctx.arc(0, 0, t.hh * 0.6, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-t.w / 2, -t.hh / 2, t.w, t.hh);
      ctx.restore();
    }
    if ((sichtbar || alter < 400) && blass > 0) requestAnimationFrame(bild); else cv.remove();
  };
  requestAnimationFrame(bild);
}

// Funken um ein Element (Wunsch 19.11.: Belohnung bei „richtig“), DOM-Teilchen, räumen sich selbst auf
function funken(el, anzahl = 14) {
  if (!el || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const farben = ['var(--color-green)', 'var(--color-yellow)', 'var(--interactive-accent)', 'var(--color-cyan)'];
  const wolke = el.appendChild(h('span', 'fle-funken'));
  wolke.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < anzahl; i++) {
    const f = wolke.appendChild(h('i'));
    const w = (i / anzahl) * Math.PI * 2 + Math.random() * 0.4;
    const r = 28 + Math.random() * 34;
    f.style.setProperty('--dx', `${Math.cos(w) * r}px`);
    f.style.setProperty('--dy', `${Math.sin(w) * r - 8}px`);
    f.style.background = farben[i % farben.length];
    f.style.animationDelay = `${Math.random() * 60}ms`;
  }
  window.setTimeout(() => wolke.remove(), 900);
}

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
    const { rest, ist, stoff, aufholen, aufgeholtBis, behandelt, stoffThemen, druck, note, ziel } = fahrplanKennzahlen(themen, this.plan, cm, tag);
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
    kachel(stoff, ' %', stoffThemen ? `solltest du heute können (${behandelt} von ${stoffThemen} Themen im Unterricht behandelt)` : 'solltest du heute können', 'is-soll');
    const [titel, satz] = aufholen
      ? ['Aufholen', `Hinter dem Unterricht, aber im Zeitplan deines Fahrplans${aufgeholtBis && aufgeholtBis > tag ? ` – aufgeholt bis ${kurz(aufgeholtBis)}` : '.'}`]
      : DRUCK_TEXT[druck];
    const band = root.appendChild(h('div', `fle-plan-druck is-${druck}`));
    band.appendChild(h('span', 'fle-plan-druck-punkt'));
    band.appendChild(h('strong', null, titel));
    band.appendChild(h('span', 'fle-plan-druck-satz', satz));

    // So läuft die Prüfung dieses Moduls (aus dem Fahrplan: form, bewertung, hilfsmittel, strategie) – eingeklappt
    const pi = pruefungsInfo(MODUL_KEYS.find((k) => MODUL_INFO[k].modul === this.plan.modul), this.plan);
    if (pi.strategie.length || this.plan.form) {
      const det = root.appendChild(h('details', 'fle-plan-pruefung'));
      det.appendChild(h('summary', null, `So läuft die Prüfung${pi.form ? ` · ${pi.form}` : ''}`));
      const dl = det.appendChild(h('dl'));
      for (const [k, v] of [['Bewertung', pi.punkte], ['Hilfsmittel', pi.hilfsmittel]]) if (v) { dl.appendChild(h('dt', null, k)); dl.appendChild(h('dd', null, v)); }
      if (pi.strategie.length) {
        det.appendChild(h('div', 'fle-plan-pruefung-h', 'So holst du die Punkte'));
        const ul = det.appendChild(h('ul'));
        pi.strategie.forEach((s) => ul.appendChild(h('li', null, s)));
      }
    }

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
      const zurueck = teilThemen.filter((t) => t.koennen < t.stoff).length;
      hk.appendChild(h('span', 'fle-leise', zurueck ? `${zurueck} von ${teilThemen.length} hinter dem Soll` : `${teilThemen.length} Themen`));
      const tab = themenZiel.appendChild(h('table', 'fle-plan-tab'));
      // Feste Spalten, damit Teil A, Teil B und Gesamt bündig untereinander stehen
      const cg = tab.appendChild(h('colgroup'));
      for (const c of ['thema', 'stichtag', 'koennen', 'status', 'wieder']) cg.appendChild(h('col', `is-${c}`));
      const kopfzeile = tab.appendChild(h('thead')).appendChild(h('tr'));
      for (const s of ['Thema', 'Geplant bis', 'Können · Soll-Strich', 'Stand', 'Wieder']) kopfzeile.appendChild(h('th', null, s));
      const tb = tab.appendChild(h('tbody'));
      for (const t of teilThemen) {
        const tr = tb.appendChild(h('tr', `is-${t.druck}`));
        tr.appendChild(h('td', 'fle-plan-thema', t.thema));
        tr.appendChild(h('td', 'fle-plan-datum', kurz(t.stichtag)));
        const zelle = tr.appendChild(h('td')).appendChild(h('div', 'fle-plan-koennen'));
        if (t.stoff <= 0 && t.koennen <= 0) {
          // Noch nicht dran: kein „0 % / 0“-Rauschen
          zelle.appendChild(h('span', 'fle-plan-spaeter', t.unterricht ? `im Unterricht am ${kurz(t.unterricht)}` : `soll sitzen bis ${kurz(t.stichtag)}`));
        } else {
          const zahl = zelle.appendChild(h('span', 'fle-plan-prozent'));
          zahlen.push([zahl, t.koennen, ' %']);
          const spur = zelle.appendChild(h('div', 'fle-plan-spur'));
          const fuell = spur.appendChild(h('div', 'fle-plan-fuell'));
          const marke = spur.appendChild(h('div', 'fle-plan-marke'));
          marke.style.left = `${t.stoff}%`;
          fuell.dataset.ziel = t.koennen;
          zelle.title = `Können ${t.koennen} %, Soll heute ${t.stoff} %${t.unterricht ? ` (Unterricht ${kurz(t.unterricht)})` : ''} · geplant bis ${kurz(t.stichtag)}`;
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
// Wochen-Rückblick (Wunsch 19.11.): einmal pro Woche beim ersten Öffnen der Lernzentrale, mit Animation
class RueckblickModal extends obsidian.Modal {
  constructor(app, w) { super(app); this.w = w; }
  onOpen() {
    const { w } = this;
    this.modalEl.addClass('flz-rb-modal');
    const el = this.contentEl;
    el.empty();
    const montag = w.tage[0].iso, sonntag = w.tage[6].iso;
    const summe = w.tage.reduce((a, t) => a + t.summe, 0);
    const vor = w.tage.reduce((a, t) => a + t.vor, 0);
    const ziel = wochenzielFuer(montag, CFG);
    const proz = ziel ? Math.round((summe / ziel) * 100) : 0;
    const bester = w.tage.reduce((b, t) => (t.summe > b.summe ? t : b), w.tage[0]);
    const rb = el.appendChild(h('div', 'flz-rb'));
    rb.appendChild(h('div', 'flz-rb-label', `Rückblick · KW ${kw(montag)} · ${kurz(montag)}–${kurz(sonntag)}`));
    rb.appendChild(h('div', 'flz-rb-titel', 'Deine Woche'));
    const gross = rb.appendChild(h('div', 'flz-rb-gross'));
    const zahl = gross.appendChild(h('span', 'flz-rb-zahl'));
    zaehleHoch(zahl, summe, '', (m) => fmtMin(m));
    gross.appendChild(h('span', 'flz-rb-unter', `gelernt · Ziel ${fmtMin(ziel)}`));
    const bar = rb.appendChild(h('div', 'flz-rb-ziel'));
    const fu = bar.appendChild(h('div', 'flz-rb-ziel-fuell' + (proz >= 100 ? ' is-voll' : '')));
    const pz = bar.appendChild(h('span', 'flz-rb-ziel-text'));
    window.setTimeout(() => { fu.style.width = `${Math.min(100, proz)}%`; zaehleHoch(pz, proz, ' %'); }, 300);
    // Tage als wachsende Säulen, bester Tag golden
    const max = Math.max(1, ...w.tage.map((t) => t.summe));
    const tage = rb.appendChild(h('div', 'flz-rb-tage'));
    w.tage.forEach((t, i) => {
      const top = t === bester && t.summe > 0;
      const sp = tage.appendChild(h('div', 'flz-rb-tag' + (top ? ' is-bester' : '')));
      const saeule = sp.appendChild(h('div', 'flz-rb-saeule'));
      const fl = saeule.appendChild(h('div', 'flz-rb-saeule-fuell'));
      fl.style.height = `${(t.summe / max) * 100}%`;
      fl.style.animationDelay = `${500 + i * 90}ms`;
      if (top) saeule.appendChild(h('span', 'flz-rb-krone', fmtMin(t.summe)));
      sp.appendChild(h('span', 'flz-rb-wt', t.kurz));
    });
    if (bester.summe) rb.appendChild(h('div', 'flz-rb-satz', `Bester Tag: ${WOCHENTAG_LANG[wochentag(bester.iso)]} mit ${fmtMin(bester.summe)}.`));
    const diff = summe - vor;
    if (vor) rb.appendChild(h('div', `flz-rb-satz ${diff >= 0 ? 'is-plus' : 'is-minus'}`, diff >= 0 ? `${fmtMin(diff)} mehr als in der Woche davor.` : `${fmtMin(-diff)} weniger als in der Woche davor.`));
    const knopf = rb.appendChild(h('button', 'mod-cta flz-rb-knopf', 'Auf in die neue Woche'));
    knopf.onclick = () => this.close();
    if (proz >= 100) window.setTimeout(() => schiesseKonfetti(['#f5c542', '#ffd76a', ...Object.values(MODUL_INFO).map((m) => m.farbe)]), 1400);
  }
  onClose() { this.contentEl.empty(); }
}

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
    const proTag = mischeZeit(lernMinuten({ fa, ma, ...neu }, quiz), this.plugin.daten && this.plugin.daten.zeit);
    const plaene = {};
    for (const key of MODUL_KEYS) {
      const f = await this.plugin.ladeFahrplan(MODUL_INFO[key].modul);
      if (f) plaene[key] = { ...f, zeilen: key === 'fa' ? fa : key === 'ma' ? ma : neu[key] || [], cm: cfgFuer(MODUL_INFO[key].modul) };
    }
    // Etappe: Dauer aus dem Frontmatter der Lerneinheit („dauer: 52 Min“), Grund nur, wenn er aus Daten folgt
    const heuteFertig = new Set(Object.values((this.plugin.daten && this.plugin.daten.einheiten) || {})
      .filter((z) => z && z.abgeschlossen === tag && z.datei)
      .map((z) => z.datei.split('/').pop().replace(/\.md$/, '')));
    const eo = (this.plugin.daten && this.plugin.daten.etappeRang) || {};
    const etappe = etappeHeute(board, tag, (link) => !!link && heuteFertig.has(String(link).split('/').pop().replace(/\.md$/, '')), eo.tag === tag ? eo.rang || {} : {}).map((p0) => {
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
      tagesziel: tagesziel(summeMin(gelerntHeute), geplant, wochenzielFuer(tag, CFG), bisGestern, tag),
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
      abschnitt(() => this.pruefeRueckblick(d));
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
    // Überfällig: mit einem Klick auf heute oder morgen schieben
    if (k.ueberfaellig && k.zeile) {
      const leiste = rahmen.appendChild(h('div', 'flz-schieben'));
      const schiebe = async (iso) => {
        const datei = this.app.vault.getAbstractFileByPath(CFG.board);
        if (!(datei instanceof obsidian.TFile) || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
        let ok = false;
        try {
          await this.app.vault.process(datei, (alt) => { const neu = setzeDatum(alt, k.zeile, iso, k.spalte); ok = neu !== null; return neu === null ? alt : neu; });
        } catch (err) { new obsidian.Notice(`Verschieben ging nicht: ${err.message}`); return; }
        if (!ok) new obsidian.Notice('Die Karte hat sich im Board geändert. Bitte dort das Datum ändern.');
      };
      for (const [label, n] of [['Heute', 0], ['Morgen', 1]]) {
        const s = leiste.appendChild(h('button', 'flz-schieben-knopf'));
        s.textContent = label;
        s.title = `Auf ${label.toLowerCase()} verschieben`;
        s.onclick = (e) => { e.stopPropagation(); schiebe(plusTage(heute(), n)); };
      }
      // Eigenes Datum: Kalender des Systems; Knopf trägt ein unsichtbares Datumsfeld
      const anders = leiste.appendChild(h('button', 'flz-schieben-knopf'));
      anders.textContent = 'Datum …';
      anders.title = 'Anderes Datum wählen';
      const feld = anders.appendChild(document.createElement('input'));
      feld.type = 'date';
      feld.className = 'flz-schieben-feld';
      feld.min = heute();
      feld.value = plusTage(heute(), 2);
      feld.tabIndex = -1;
      feld.onclick = (e) => e.stopPropagation();
      feld.onchange = () => schiebe(feld.value);
      anders.onclick = (e) => {
        e.stopPropagation();
        try { feld.showPicker(); } catch { feld.focus(); feld.click(); }
      };
    }
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
    // Aufgaben-Uhr für alles ohne eigene Lerneinheit (Videos, Lesen, Aufträge): startet mit dem Klick auf die Karte
    // (Play-Knopf seit 17.11. weg); Lerneinheiten haben ihren eigenen Timer
    const modul = k.modul || Object.keys(MODUL_SPALTEN).find((x) => MODUL_SPALTEN[x] === k.spalte);
    if (modul && k.art !== 'lerneinheit' && k.art !== 'wiederholen') {
      rahmen.dataset.uhr = `${modul}|${k.text}`;
      b.disabled = false;
      b.title = 'Starten (Zeit wird gemessen)';
      b.onclick = () => {
        this.plugin.starteUhr({ text: k.text, modul, zeile: k.zeile, spalte: k.spalte });
        if (k.link) this.oeffne(k.link);
      };
      this.markiereUhr();
    }
    // Überfällige Karte: Klick geht wegen der Unschärfe nicht, darum „Starten“ als erster Knopf im Overlay
    const leiste = rahmen.querySelector('.flz-schieben');
    if (leiste && !b.disabled) {
      const start = leiste.insertBefore(h('button', 'flz-schieben-knopf is-start'), leiste.firstChild);
      start.textContent = 'Starten';
      start.onclick = (e) => { e.stopPropagation(); b.onclick(); };
    }
  }

  // Karte, deren Uhr gerade läuft, hervorheben
  markiereUhr() {
    const u = this.plugin.daten.freiUhr;
    const an = u ? `${u.modul}|${u.text}` : null;
    for (const r of this.contentEl.querySelectorAll('.flz-bk-rahmen[data-uhr]')) r.classList.toggle('is-uhr', r.dataset.uhr === an);
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
    const m = MODUL_INFO[key];
    const plan = (d.module.find((x) => x.key === key) || {}).plan;
    const p = pruefungsInfo(key, plan && plan.plan);
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

    this.baueTrainer(seite, key, plan);
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


  // Fehlerheft und Formel-Puzzle als Karten oben auf der Modulseite (Wunsch 18.11.)
  baueTrainer(seite, key, plan) {
    const modul = MODUL_INFO[key].modul;
    const tag = heute();
    const fehler = Object.values(this.plugin.daten.fehler || {}).filter((e) => (e.modul || 'fa') === modul);
    const fFaellig = faelligeFehler(this.plugin.daten.fehler, tag, modul).length;
    const formel = modul === 'fa' ? formelnHeute(this.plugin.daten.formeln, tag, formelGruppen(plan && plan.plan, tag)).length : 0;
    if (!fehler.length && modul !== 'fa') return;
    const sec = seite.appendChild(h('section', 'flz-trainer'));
    const karte = (titel, zahl, text, knopf, an, offen) => {
      const k = sec.appendChild(h('div', 'flz-trainer-karte' + (zahl ? ' is-faellig' : '')));
      const kopf = k.appendChild(h('div', 'flz-trainer-kopf'));
      kopf.appendChild(h('b', null, titel));
      if (zahl) kopf.appendChild(h('span', 'flz-trainer-zahl', String(zahl)));
      k.appendChild(h('p', 'flz-trainer-text', text));
      const b = k.appendChild(h('button', 'flz-btn' + (zahl ? ' is-cta' : ''), knopf));
      b.disabled = !an;
      b.onclick = () => offen();
    };
    const neu = () => this.render();
    karte('Fehlerheft', fFaellig, fehler.length
      ? `${fFaellig ? `${fFaellig} heute fällig` : 'Heute nichts fällig'} · ${fehler.length} im Heft. Was du dreimal richtig hast, fliegt raus.`
      : 'Noch leer. Jeder Fall, den du nicht ganz richtig hast, landet hier und kommt nach 1, 3 und 7 Tagen wieder.',
    fFaellig ? `Jetzt ${fFaellig} üben` : 'Nichts fällig', fFaellig > 0, () => new FehlerheftModal(this.app, this.plugin, modul, neu).open());
    if (modul === 'fa') karte('Formel-Puzzle', formel, formel
      ? `${formel} Kennzahlen heute dran. Setz Zähler und Nenner aus Bausteinen zusammen.`
      : 'Heute keine Kennzahl fällig. Neue kommen dazu, sobald sie im Unterricht dran waren.',
    formel ? 'Puzzle starten' : 'Nichts fällig', formel > 0, () => new FormelModal(this.app, this.plugin, formelGruppen(plan && plan.plan, tag), neu).open());
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
      <div class="flz-ring-mitte"><div class="flz-ring-normal"><div class="flz-ring-zahl"><span data-zaehl="${gelernt}">${gelernt}</span><small>von ${d.tagesziel} Min.</small></div></div>
      <div class="flz-ring-detail">${teile.map((k) => `<div><i style="background:${MODUL_INFO[k].farbe}"></i>${MODUL_INFO[k].kurz} ${d.gelerntHeute[k]} Min.</div>`).join('')}<div><i class="is-rest"></i>noch ${Math.max(0, d.tagesziel - gelernt)} Min.</div></div></div></div>
      <div class="flz-ring-leg">Lernzeit heute</div>`;   // Aufteilung nach Modul erst beim Darüberfahren (17.11.: „überfüllt“)
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

    // Tagesziel-Feier (Wunsch 19.11.): Ziel erreicht = Ring leuchtet dauerhaft, einmal pro Tag Feier mit Konfetti
    if (!d.leer && d.tagesziel > 0 && gelernt >= d.tagesziel) {
      ring.classList.add('is-erreicht');
      const klein = ring.querySelector('.flz-ring-zahl small');
      if (klein) klein.textContent = 'Ziel erreicht';
      const marke = ring.querySelector('.flz-ring-flaeche').appendChild(h('span', 'flz-ziel-marke'));
      marke.setAttribute('aria-hidden', 'true');
      obsidian.setIcon(marke, 'check');
      const daten = this.plugin.daten || {};
      if (this.ringBeob) { this.ringBeob.disconnect(); this.ringBeob = null; }
      if (daten.tageszielTag !== d.tag && typeof IntersectionObserver === 'function') {
        const beob = this.ringBeob = new IntersectionObserver((eintraege) => {
          if (!eintraege.some((e) => e.isIntersecting) || !ring.isConnected) return;
          beob.disconnect();
          if (daten.tageszielTag === d.tag) return;
          daten.tageszielTag = d.tag;
          this.plugin.saveData(daten);
          ring.classList.add('is-feiern');
          // Mit Etappe schiesst schon deren Ziel Konfetti (gleicher Moment), sonst hier
          if (!d.etappe.length) window.setTimeout(() => schiesseKonfetti(['#f5c542', '#ffd76a', ...Object.values(MODUL_INFO).map((m) => m.farbe)]), 1100);
        }, { threshold: 0.9 });
        beob.observe(ring);
        if (!this.ringAbmelden) { this.ringAbmelden = true; this.register(() => this.ringBeob && this.ringBeob.disconnect()); }
      }
    }

    const rechts = karte.appendChild(h('div'));
    if (d.leer) {
      rechts.className = 'flz-heute-leer';
      rechts.innerHTML = `<span class="flz-h">So startest du</span><ol><li><b>Prüfungsfahrplan</b> für ein Modul anlegen: Prüfungsdatum und Themen.</li><li><b>Erste Lerneinheit</b> öffnen. Der Timer zählt deine Lernzeit automatisch.</li><li>Ab dann zeigt dir die Lernzentrale jeden Tag eine <b>Etappe</b>.</li></ol>`;
      const b = rechts.appendChild(h('button', 'flz-btn is-cta', 'Fahrplan anlegen'));
      b.onclick = () => { this.app.setting.open(); this.app.setting.openTabById(this.plugin.manifest.id); };
      return;
    }
    const fertig = d.etappe.filter((p) => p.status === 'fertig').length;
    rechts.innerHTML = `<div class="flz-et-kopf"><span class="flz-h" id="flz-heute-titel">Deine Etappe heute</span><span class="flz-et-stand">${d.etappe.length ? `<b>${fertig} von ${d.etappe.length}</b> erledigt` : ''}</span></div>`;
    if (!d.etappe.length) { rechts.appendChild(h('p', 'flz-leise', 'Heute ist nichts geplant.')); return; }
    const schritte = rechts.appendChild(h('div', 'flz-schritte'));
    // Seit 17.11. (Wunsch: „erst simple Übersicht, Details beim Darüberfahren“): unter jedem Kreis nur das Modul,
    // Titel, Minuten und Knopf in einer kleinen Karte beim Darüberfahren; darunter eine schlanke „Jetzt“-Zeile.
    const n = d.etappe.length + 1;
    schritte.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
    schritte.style.setProperty('--flz-n', n);
    const jetzt = d.etappe.find((p) => p.status === 'jetzt');
    const offen = d.etappe.some((p) => p.status === 'offen');
    const kante = (i) => (i === 0 ? ' is-links' : i >= n - 2 ? ' is-rechts' : '');
    d.etappe.forEach((p, i) => {
      const m = p.modul ? MODUL_INFO[p.modul] : null;
      const s = schritte.appendChild(h('div', `flz-schritt is-${p.status}` + kante(i)));
      s.tabIndex = 0;
      // Kein aria-label: Obsidian zeigt dafür einen eigenen Tooltip, der die Hover-Karte verdeckte (17.11.).
      // Für Screenreader steht der Titel ohnehin in der Karte; die Nummer als versteckter Text.
      s.appendChild(h('span', 'flz-sr', `Posten ${i + 1}${p.status === 'fertig' ? ', erledigt' : ''}: `));
      s.appendChild(h('span', 'flz-knoten')).innerHTML = p.status === 'fertig' ? icon('<path d="M20 6 9 17l-5-5"/>') : String(i + 1);
      const label = s.appendChild(h('span', 'flz-s-modul', m ? m.kurz : ''));
      if (m) label.style.setProperty('--flz-mf', m.farbe);
      // Hover-Karte nur für kommende Posten: der aktuelle steht unten in der Jetzt-Zeile, erledigte brauchen keine (Wunsch 17.11.)
      if (p.status !== 'offen') { s.tabIndex = -1; return; }
      const pop = s.appendChild(h('div', 'flz-s-pop'));
      pop.appendChild(h('b', null, p.text));
      pop.appendChild(h('div', 'flz-s-meta')).innerHTML = (m ? `<i style="background:${m.farbe}"></i>${m.kurz}` : '') + (m && p.minuten ? ' · ' : '') + (p.minuten ? `${p.minuten}&nbsp;Min.` : '');
      const vz = pop.appendChild(h('button', 'flz-btn', 'Jetzt machen'));
      vz.onclick = () => this.verschiebe(d, p, -1);
    });
    const geschafft = fertig === d.etappe.length;
    const z = schritte.appendChild(h('div', 'flz-schritt is-ziel is-rechts' + (geschafft ? ' is-geschafft' : '')));
    z.tabIndex = 0;
    const zk = z.appendChild(h('span', 'flz-zielknoten'));
    if (geschafft) zk.innerHTML = '<span class="flz-ziel-fuell"></span>' + icon('<path d="M12 3l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.4l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z"/>');
    z.appendChild(h('span', 'flz-s-modul flz-ziel-txt', geschafft ? 'Geschafft!' : d.ziel ? `${d.ziel.kurz} ${d.ziel.neu} %` : 'Ziel'));
    const zp = z.appendChild(h('div', 'flz-s-pop'));
    zp.appendChild(h('b', null, geschafft ? 'Etappe komplett' : 'Ziel der Etappe'));
    if (!geschafft && d.ziel) zp.appendChild(h('div', 'flz-s-grund', `Schaffst du alle Posten, steht ${d.ziel.kurz} bei ${d.ziel.neu} % statt ${d.ziel.ist} %.`));
    // Jetzt-Zeile: der aktuelle Posten mit ganzem Titel, ohne Kasten
    if (jetzt) {
      const zeile = rechts.appendChild(h('div', 'flz-jetzt'));
      const m = jetzt.modul ? MODUL_INFO[jetzt.modul] : null;
      const txt = zeile.appendChild(h('div', 'flz-jetzt-txt'));
      txt.appendChild(h('span', 'flz-jetzt-label', 'Jetzt dran'));
      txt.appendChild(h('b', 'flz-jetzt-titel', jetzt.text));
      txt.appendChild(h('span', 'flz-s-meta')).innerHTML = (m ? `<i style="background:${m.farbe}"></i>${m.kurz}` : '') + (m && jetzt.minuten ? ' · ' : '') + (jetzt.minuten ? `${jetzt.minuten}&nbsp;Min.` : '');
      const b = zeile.appendChild(h('button', 'flz-btn is-cta'));
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Starten';
      b.onclick = () => this.oeffne(jetzt.link);
      if (offen) {
        const sp = zeile.appendChild(h('button', 'flz-btn flz-s-schieb', 'Später'));
        sp.title = 'Diesen Posten ans Ende schieben';
        sp.onclick = () => this.verschiebe(d, jetzt, +1);
      }
    }
    // Feiern einmal pro Tag, erst wenn das Ziel wirklich im Blick ist (nicht in einem versteckten Tab)
    const daten = this.plugin.daten || {};
    if (this.zielBeob) { this.zielBeob.disconnect(); this.zielBeob = null; }
    if (geschafft && daten.konfettiTag !== d.tag && typeof IntersectionObserver === 'function') {
      const beob = this.zielBeob = new IntersectionObserver((eintraege) => {
        if (!eintraege.some((e) => e.isIntersecting) || !z.isConnected) return;
        beob.disconnect();
        if (daten.konfettiTag === d.tag) return;
        daten.konfettiTag = d.tag;
        this.plugin.saveData(daten);
        z.classList.add('is-feiern');
        window.setTimeout(() => schiesseKonfetti([...Object.values(MODUL_INFO).map((m) => m.farbe), '#f5c542', '#ff6b4a']), 650);
      }, { threshold: 0.9 });
      beob.observe(zk);
      if (!this.zielAbmelden) { this.zielAbmelden = true; this.register(() => this.zielBeob && this.zielBeob.disconnect()); }
    }
  }

  // Später (+1) = ans Ende, Vorziehen (-1) = an den Anfang; gilt nur heute
  async verschiebe(d, p, richtung) {
    const daten = this.plugin.daten || (this.plugin.daten = {});
    if (!daten.etappeRang || daten.etappeRang.tag !== d.tag) daten.etappeRang = { tag: d.tag, rang: {} };
    const rang = daten.etappeRang.rang;
    const werte = d.etappe.filter((q) => q.status !== 'fertig').map((q) => rang[etappeSchluessel(q)] || 0);
    rang[etappeSchluessel(p)] = richtung > 0 ? Math.max(0, ...werte) + 1 : Math.min(0, ...werte) - 1;
    await this.plugin.saveData(daten);
    await this.neuLaden();
  }

  // Rückblick auf die letzte ganze Woche, einmal pro Woche (daten.rueckblick = Montag der gezeigten Woche)
  pruefeRueckblick(d, immer = false) {
    this.letztesD = d;
    if (d.leer) return;
    const montag = plusTage(d.tag, -((wochentag(d.tag) + 6) % 7) - 7);
    const daten = this.plugin.daten || {};
    if (!immer && daten.rueckblick === montag) return;
    const w = wocheVon(d.proTag, plusTage(montag, 6));
    if (!immer && !w.summeBisHeute) return;
    daten.rueckblick = montag;
    this.plugin.saveData(daten);
    window.setTimeout(() => new RueckblickModal(this.app, w).open(), immer ? 0 : 900);
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
      const summe = w.tage.reduce((s, t) => s + t.summe, 0), wz = wochenzielFuer(w.tage[0].iso, CFG);
      const zeilen = MODUL_KEYS.filter((k) => summenModul[k]).sort((a, b) => summenModul[b] - summenModul[a])
        .map((k) => `<div class="flz-zl"><i style="background:${MODUL_INFO[k].farbe}"></i>${MODUL_INFO[k].name}<b>${summenModul[k]} min</b><span class="flz-zl-bar"><u style="width:${summenModul[k] / Math.max(1, summe) * 100}%;background:${MODUL_INFO[k].farbe}"></u></span></div>`).join('');
      tafel.innerHTML = `<span class="flz-t"><span>${this.wocheVersatz ? 'Ganze Woche' : 'Woche bis heute'}</span><span>Ziel ${fmtMin(wz)} · ${Math.round(summe / wz * 100)} %</span></span>
        <span class="flz-gz">${fmtMin(summe)}</span><div class="flz-zeilen">${zeilen || '<p class="flz-leise">Lernzeit erscheint hier, sobald du in einem Modul lernst – sie wird automatisch gemessen.</p>'}</div>
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
      ? (!hinten.length && mitPlan.some((m) => m.k.aufholen)
        ? `<b>${mitPlan.filter((m) => m.k.aufholen).length} von ${mitPlan.length}</b> Modulen hinter dem Unterricht, aber im Zeitplan des eigenen Fahrplans`
        : `<b>${hinten.length} von ${mitPlan.length}</b> Modulen hinter dem eigenen Fahrplan${hinten.length ? ': ' + hinten.map((m) => m.kurz).join(', ') : ''}`)
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
      b.setAttribute('aria-label', m.k ? `${m.name}: ${m.k.ist} Prozent, Soll ${m.k.stoff}` : `${m.name}: noch kein Fahrplan`);
      const a = m.k ? (m.k.stoff / 100) * 2 * Math.PI - Math.PI / 2 : 0;
      b.innerHTML = `<span class="flz-mk-name"><i style="background:${m.farbe}"></i>${escHtml(m.name)}</span>
        <span class="flz-mk-mitte"><svg class="flz-mk-ring" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="${R}" class="flz-mk-spur"/>${m.k ? `<circle class="flz-mk-ist" cx="25" cy="25" r="${R}" stroke-dasharray="${U}" stroke-dashoffset="${U}" data-ziel="${U * (1 - m.k.ist / 100)}" transform="rotate(-90 25 25)"/>` : ''}${m.k && m.k.soll ? `<line class="flz-mk-soll" x1="${25 + (R - 6) * Math.cos(a)}" y1="${25 + (R - 6) * Math.sin(a)}" x2="${25 + (R + 6) * Math.cos(a)}" y2="${25 + (R + 6) * Math.sin(a)}"/>` : ''}</svg>
        <span><span class="flz-mk-wert">${m.k ? m.k.ist + ' %' : '–'}</span><span class="flz-mk-soll-txt">${m.k ? `Soll ${m.k.stoff} %` : 'kein Fahrplan'}</span></span></span>
        <span class="flz-stand">${icon(STAND_ICON[druck])}${m.k && m.k.aufholen ? 'aufholen' : STAND_WORT[druck]}</span>`;
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


// ── Fehlerheft-Übung ── fällige Fälle nochmals lösen (Zwilling, wenn vorhanden), Wiederholung nach 1/3/7 Tagen
class FehlerheftModal extends obsidian.Modal {
  constructor(app, plugin, modul, fertig) {
    super(app);
    this.plugin = plugin; this.fertig = fertig;
    this.liste = faelligeFehler(plugin.daten.fehler, heute(), modul);
    this.i = 0; this.richtig = 0; this.comp = new obsidian.Component();
  }
  onOpen() {
    this.comp.load();
    this.modalEl.addClass('fle-modal', 'fle-puzzle-modal');
    this.titleEl.setText('Fehlerheft');
    beobachteGlyphen(this.contentEl, null);
    this.scope.register([], 'Enter', (ev) => { if (ev.target && ev.target.tagName === 'TEXTAREA') return true; if (this.enter) this.enter(); return false; });
    this.zeige();
  }
  // Kopf wie beim Formel-Puzzle: Titel, Thema, Fortschrittspunkte
  kopf(c, e, neueZahlen) {
    const kopf = c.appendChild(h('div', 'fle-puzzle-kopf'));
    const links = kopf.appendChild(h('div', 'fle-puzzle-titel'));
    if (e) links.appendChild(h('span', 'fle-puzzle-chip', e.thema));
    if (neueZahlen) links.appendChild(h('span', 'fle-puzzle-chip is-nochmal', 'mit neuen Zahlen'));
    const punkte = kopf.appendChild(h('div', 'fle-puzzle-punkte'));
    punkte.setAttribute('role', 'img');
    punkte.setAttribute('aria-label', `${Math.min(this.i, this.liste.length)} von ${this.liste.length} erledigt`);
    this.liste.forEach((_, i) => punkte.appendChild(h('span', i < this.i ? 'is-fertig' : i === this.i ? 'is-jetzt' : '')));
  }
  onClose() { this.comp.unload(); this.contentEl.empty(); if (this.fertig) this.fertig(); }
  md(el, t, pfad) { obsidian.MarkdownRenderer.render(this.app, String(t), el, pfad || '', this.comp); }

  async ladeFall(e) {
    const f = this.app.vault.getAbstractFileByPath(e.pfad);
    if (!(f instanceof obsidian.TFile)) return null;
    const block = /```lerneinheit\r?\n([\s\S]*?)\n```/.exec(await this.app.vault.cachedRead(f));
    if (!block) return null;
    let r; try { r = pruefeEinheit(obsidian.parseYaml(block[1])); } catch (err) { return null; }
    if (!r.ok) return null;
    const fall = ((r.einheit.schritte[e.si] || {}).faelle || []).find((x) => String(x.id) === String(e.fall));
    if (!fall) return null;
    this.original = fall;
    return fall.zwilling || fall;
  }

  async zeige() {
    const c = this.contentEl; c.empty();
    c.removeClass('fle-wechsel'); void c.offsetWidth; c.addClass('fle-wechsel');
    c.addClass('fle', 'fle-puzzle');
    if (this.i >= this.liste.length) {
      this.kopf(c, null, false);
      const ende = c.appendChild(h('div', 'fle-puzzle-ende'));
      ende.appendChild(h('div', 'fle-puzzle-ende-zahl', `${this.richtig}/${this.liste.length}`));
      ende.appendChild(h('div', 'fle-puzzle-name', 'Fehlerheft geschafft'));
      ende.appendChild(h('p', 'fle-leise', 'Was richtig war, kommt in ein paar Tagen nochmals, der Rest schon morgen.'));
      const fuss = c.appendChild(h('div', 'fle-puzzle-fuss'));
      fuss.appendChild(h('span'));
      const zu = fuss.appendChild(h('button', 'fle-btn mod-cta', 'Schliessen'));
      zu.onclick = () => this.close();
      this.enter = () => this.close();
      return;
    }
    const e = this.liste[this.i];
    const fall = await this.ladeFall(e);
    if (!fall) {   // Einheit gelöscht oder umgebaut: Eintrag entfernen
      const neu = { ...this.plugin.daten.fehler }; delete neu[e.id];
      this.plugin.daten.fehler = neu; this.plugin.speichere();
      this.liste.splice(this.i, 1); return this.zeige();
    }
    this.kopf(c, e, fall.id && String(fall.id).endsWith('~z'));
    // Je nach Fehlerart ein Hinweis vor dem Versuch (Prinzip 6): Begriff → Erklärung auf Abruf, Flüchtigkeit → Prüfroutine
    if (e.art === 'fluechtig') c.appendChild(h('div', 'fle-fehlerart-tipp is-vorher', FEHLERARTEN[2][3]));
    if (e.art === 'begriff' && this.original && this.original.warum) {
      const det = c.appendChild(h('details', 'fle-erklaerung'));
      det.appendChild(h('summary', null, 'Erklärung von damals nochmals lesen'));
      this.md(det.appendChild(h('div', 'fle-md')), this.original.warum, e.pfad);
    }
    this.md(c.appendChild(h('div', 'fle-md fle-modal-text')), fall.text, e.pfad);
    const eingabe = this.eingabe(c, fall);
    const loes = c.appendChild(h('div', 'fle-loesung'));
    const fuss = c.appendChild(h('div', 'fle-puzzle-fuss'));
    this.urteil = fuss.appendChild(h('span', 'fle-leise', fall.art === 'buchung' ? 'Leer lassen, wenn keine Buchung nötig ist.' : ''));
    const knopf = this.fussKnopf = fuss.appendChild(h('button', 'fle-btn mod-cta', 'Prüfen'));
    knopf.onclick = () => {
      const wert = eingabe.wert();
      if (wert == null) { knopf.disabled = true; this.enter = null; return this.selbst(loes, fall, e); }
      this.ergebnis(loes, fall, e, wert, eingabe.roh);
    };
    this.enter = () => { if (!knopf.disabled) knopf.click(); };
  }

  // Eingabefeld je nach Fall-Art; wert() = 0…1 oder null (Text: selbst bewerten)
  eingabe(c, fall) {
    if (fall.art === 'buchung') {
      const zeilen = Array.from({ length: Math.max(fall.zeilen || 2, fall.loesung.length || 1) }, () => ['', '', '']);
      const tab = c.appendChild(h('table', 'fle-tabelle'));
      const kopf = tab.appendChild(h('thead')).appendChild(h('tr'));
      for (const t of ['Soll', 'Haben', 'Betrag']) kopf.appendChild(h('th', null, t));
      const tb = tab.appendChild(h('tbody'));
      for (const r of zeilen) {
        const tr = tb.appendChild(h('tr'));
        r.forEach((_, i) => { const inp = tr.appendChild(h('td')).appendChild(h('input', 'fle-eingabe' + (i === 2 ? ' is-betrag' : ''))); inp.setAttribute('aria-label', ['Soll', 'Haben', 'Betrag'][i]); if (i === 2) inp.inputMode = 'decimal'; if (i < 2) inp.setAttribute('list', 'fle-konten-modal'); inp.oninput = () => { r[i] = inp.value; }; });
      }
      const dl = c.appendChild(h('datalist')); dl.id = 'fle-konten-modal';
      for (const k of [...KONTENPLAN.bilanz, ...KONTENPLAN.erfolg]) dl.appendChild(h('option')).value = k;
      return { roh: zeilen, wert: () => bewerteBuchung(zeilen, fall.loesung) };
    }
    if (fall.art === 'zahl') {
      const inp = c.appendChild(h('div', 'fle-zahl')).appendChild(h('input', 'fle-eingabe fle-zahl-feld'));
      inp.inputMode = 'decimal';
      inp.setAttribute('aria-label', 'Deine Antwort');
      if (fall.einheit) inp.parentElement.appendChild(h('span', 'fle-zahl-einheit', fall.einheit));
      return { wert: () => (inp.value.trim() ? pruefeZahlFall([[inp.value]], fall) : 0) };
    }
    if (istKreuz(fall)) {
      const kprim = fall.art === 'kprim';
      const n = kprim ? fall.kprim.length : fall.optionen.length;
      const wahl = Array(n).fill('');
      const liste = c.appendChild(h('div', 'fle-kreuz' + (kprim ? ' is-kprim' : '')));
      for (let i = 0; i < n; i++) {
        const z = liste.appendChild(h('div', 'fle-kreuz-zeile'));
        z.appendChild(h('span', 'fle-kreuz-nr', kprim ? `${i + 1}.` : `${BUCHSTABEN[i]})`));
        this.md(z.appendChild(h('div', 'fle-md fle-kreuz-text')), kprim ? fall.kprim[i].aussage : fall.optionen[i]);
        const r = z.appendChild(h('div', 'fle-kreuz-wahl'));
        for (const [w, t] of kprim ? [['r', 'richtig'], ['f', 'falsch']] : [[BUCHSTABEN[i], '○']]) {
          const b = r.appendChild(h('button', 'fle-btn fle-kreuz-btn', t));
          b.onclick = () => {
            if (kprim) wahl[i] = wahl[i] === w ? '' : w;
            else if (fall.mehrfach) wahl[i] = wahl[i] ? '' : w;
            else for (let k = 0; k < n; k++) wahl[k] = k === i ? w : '';
            liste.querySelectorAll('.fle-kreuz-btn').forEach((x) => x.classList.remove('is-an'));
            liste.querySelectorAll('.fle-kreuz-zeile').forEach((zz, zi) => zz.querySelectorAll('.fle-kreuz-btn').forEach((x, xi) => {
              const ww = kprim ? ['r', 'f'][xi] : BUCHSTABEN[zi];
              if (wahl[zi] === ww) x.classList.add('is-an');
            }));
          };
        }
      }
      return { wert: () => bewerteKreuz([[...wahl]], fall) };
    }
    const t = c.appendChild(h('textarea', 'fle-eingabe fle-text')); t.rows = 3; t.setAttribute('aria-label', 'Deine Antwort');
    return { wert: () => null };
  }

  ergebnis(loes, fall, e, wert, roh) {
    const ok = wert >= 1;
    if (ok) this.richtig += 1;
    loes.appendChild(h('div', `fle-ergebnis ${ok ? 'is-richtig' : wert > 0 ? 'is-teilweise' : 'is-falsch'}`, ok ? '✓ richtig' : wert > 0 ? '◐ teilweise' : '✗ falsch'));
    if (fall.art === 'buchung') {
      const dg = buchungsDiagnose(roh, fall.loesung);
      const ul = loes.appendChild(h('ul', 'fle-diagnose'));
      for (const d of dg.zeilen) if (d.status !== 'ok') ul.appendChild(h('li', 'is-fehler', d.status === 'extra' ? `✗ Zeile ${d.i + 1}: unnötig` : `✗ Zeile ${d.i + 1}: ${d.status === 'betrag' ? 'Betrag falsch' : d.status === 'vertauscht' ? 'Soll und Haben vertauscht' : 'Konto falsch'}`));
      for (const f of dg.fehlend) ul.appendChild(h('li', 'is-fehler', `✗ Fehlt: ${f[0]} / ${f[1]} ${betrag(f[2])}`));
      loes.appendChild(h('div', 'fle-label', 'Lösung'));
      if (!fall.loesung.length) loes.appendChild(h('div', null, 'Keine Buchung nötig.'));
      if (fall.loesung.length) {
        const lt = loes.appendChild(h('table', 'fle-tabelle is-loesung'));
        const hr = lt.appendChild(h('thead')).appendChild(h('tr'));
        for (const t of ['Soll', 'Haben', 'Betrag']) hr.appendChild(h('th', null, t));
        const lb = lt.appendChild(h('tbody'));
        for (const [so, ha, be] of fall.loesung) {
          const tr = lb.appendChild(h('tr'));
          tr.appendChild(h('td', null, so)); tr.appendChild(h('td', null, ha)); tr.appendChild(h('td', 'is-betrag', betrag(be)));
        }
      }
    } else if (fall.art === 'zahl') {
      loes.appendChild(h('div', 'fle-zahl-loesung', `${(Array.isArray(fall.zahl) ? fall.zahl : [fall.zahl]).map(betrag).join('; ')}${fall.einheit ? ' ' + fall.einheit : ''}`));
      if (Array.isArray(fall.weg)) { const ol = loes.appendChild(h('ol', 'fle-weg')); for (const w of fall.weg) this.md(ol.appendChild(h('li')), w); }
    } else if (fall.art === 'auswahl') loes.appendChild(h('div', null, `Richtig: ${fall.richtig.join(', ')}`));
    else if (fall.art === 'kprim') fall.kprim.forEach((a, i) => loes.appendChild(h('div', null, `${i + 1}. ${a.richtig ? 'richtig' : 'falsch'}${a.warum ? ' – ' + a.warum : ''}`)));
    if (fall.warum) this.md(loes.appendChild(h('div', 'fle-md fle-warum')), fall.warum, e.pfad);
    // Erstversuch-Quote: nur der erste Versuch pro Tag zählt (verzögerter Abruf, Prinzip 9)
    if (!this.geloggt) this.geloggt = new Set();
    if (!this.geloggt.has(e.id)) { this.geloggt.add(e.id); this.plugin.daten.fehlerLog = [...(this.plugin.daten.fehlerLog || []), { datum: heute(), ok }].slice(-200); }
    this.plugin.daten.fehler = fehlerNachUebung(this.plugin.daten.fehler, e.id, ok, heute(), this.plugin.pruefungDatum(e.modul || 'fa'));
    this.plugin.speichere();
    const st = (this.plugin.daten.fehler || {})[e.id];
    // Urteil unten in der Leiste, daneben der Knopf „Weiter“
    this.urteil.className = `fle-puzzle-urteil ${ok ? 'is-richtig' : 'is-falsch'}`;
    this.urteil.setAttribute('role', 'status');
    this.urteil.textContent = ok ? (st ? `✓ Richtig, kommt am ${kurz(st.faellig)} nochmals` : '✓ Dreimal richtig, raus aus dem Heft') : '✗ Kommt morgen nochmals';
    const w = this.fussKnopf;
    w.disabled = false;
    w.textContent = this.i + 1 < this.liste.length ? 'Weiter' : 'Fertig';
    w.onclick = () => { this.i += 1; this.zeige(); };
    this.enter = () => w.click();
    w.focus();
  }

  selbst(loes, fall, e) {
    loes.appendChild(h('div', 'fle-label', 'Musterantwort'));
    this.md(loes.appendChild(h('div', 'fle-md')), fall.antwort, e.pfad);
    loes.appendChild(h('div', 'fle-label', 'Stimmt deine Antwort?'));
    const r = loes.appendChild(h('div', 'fle-wahl'));
    for (const [t, w] of [['richtig', 1], ['teilweise', 0.5], ['falsch', 0]]) {
      r.appendChild(h('button', 'fle-btn', t)).onclick = () => { r.remove(); this.ergebnis(loes, { ...fall, art: 'antwort', warum: null }, e, w); };
    }
  }
}

// ── Formel-Puzzle ── Zähler und Nenner der Kennzahlen aus Bausteinen setzen, Wiederholung nach 1/3/7/21 Tagen
class FormelModal extends obsidian.Modal {
  constructor(app, plugin, erlaubt, fertig) {
    super(app);
    this.plugin = plugin; this.fertig = fertig;
    this.liste = formelnHeute(plugin.daten.formeln, heute(), erlaubt);
    this.gesehen = new Set(); this.i = 0; this.richtig = 0; this.anzahl = this.liste.length;
  }
  onOpen() {
    this.modalEl.addClass('fle-modal', 'fle-puzzle-modal');
    this.titleEl.setText('Formel-Puzzle');
    beobachteGlyphen(this.contentEl, null);
    // Enter = Prüfen bzw. Weiter; einmal registriert, zeige() setzt nur das Ziel
    this.scope.register([], 'Enter', () => { if (this.enter) this.enter(); return false; });
    this.zeige();
  }
  onClose() { this.contentEl.empty(); if (this.fertig) this.fertig(); }

  // Kopf: Titel, Gruppe und Fortschrittspunkte (gefüllt = erledigt, Ring = jetzt)
  kopf(c, k, erstmals) {
    const kopf = c.appendChild(h('div', 'fle-puzzle-kopf'));
    const links = kopf.appendChild(h('div', 'fle-puzzle-titel'));
    if (k) links.appendChild(h('span', 'fle-puzzle-chip', `Nr. ${k.nr} · ${k.gruppe}`));
    if (k && !erstmals) links.appendChild(h('span', 'fle-puzzle-chip is-nochmal', 'zweiter Versuch'));
    const punkte = kopf.appendChild(h('div', 'fle-puzzle-punkte'));
    punkte.setAttribute('role', 'img');
    punkte.setAttribute('aria-label', `${Math.min(this.i, this.liste.length)} von ${this.liste.length} erledigt`);
    punkte.setAttribute('aria-label', `${Math.min(this.i, this.liste.length)} von ${this.liste.length}`);
    this.liste.forEach((_, i) => punkte.appendChild(h('span', i < this.i ? 'is-fertig' : i === this.i ? 'is-jetzt' : '')));
  }

  zeige() {
    const c = this.contentEl; c.empty();
    c.removeClass('fle-wechsel'); void c.offsetWidth; c.addClass('fle-wechsel');
    c.addClass('fle', 'fle-puzzle');
    if (this.i >= this.liste.length) {
      this.kopf(c, null, true);
      const ende = c.appendChild(h('div', 'fle-puzzle-ende'));
      ende.appendChild(h('div', 'fle-puzzle-ende-zahl', `${this.richtig}/${this.anzahl}`));
      ende.appendChild(h('div', 'fle-puzzle-name', this.richtig === this.anzahl ? 'Alles beim ersten Versuch richtig' : 'Runde geschafft'));
      ende.appendChild(h('p', 'fle-leise', this.richtig === this.anzahl
        ? 'Diese Kennzahlen kommen erst in ein paar Tagen wieder.'
        : 'Die falschen hast du gleich nochmals gesetzt. Sie kommen morgen wieder, die richtigen erst in ein paar Tagen.'));
      const fuss = c.appendChild(h('div', 'fle-puzzle-fuss'));
      fuss.appendChild(h('span'));
      const zu = fuss.appendChild(h('button', 'fle-btn mod-cta', 'Schliessen'));
      zu.onclick = () => this.close();
      zu.focus();
      this.enter = () => this.close();
      return;
    }
    const k = this.liste[this.i];
    const erstmals = !this.gesehen.has(k.id);
    this.kopf(c, k, erstmals);
    c.appendChild(h('div', 'fle-puzzle-name', k.name));
    const bruch = k.op === '÷';
    const LEER = bruch ? ['Zähler', 'Nenner'] : ['links', 'rechts'];
    const platz = [null, null];
    const formel = c.appendChild(h('div', `fle-formel ${bruch ? 'is-bruch' : 'is-reihe'}`));
    formel.appendChild(h('span', 'fle-formel-gleich', '='));
    const koerper = formel.appendChild(h('div', 'fle-formel-koerper'));
    const slots = [0, 1].map((i) => {
      const b = koerper.appendChild(h('button', 'fle-formel-platz'));
      if (i === 0) koerper.appendChild(h('div', 'fle-formel-op', bruch ? '' : k.op));
      b.onclick = () => { if (platz[i] == null || this.geprueft) return; platz[i] = null; male(); };
      return b;
    });
    const steine = c.appendChild(h('div', 'fle-formel-steine'));
    const knoepfe = formelBausteine(k).map((t) => {
      const b = steine.appendChild(h('button', 'fle-chip fle-formel-stein', t));
      // Antippen = nächstes freies Feld; Ziehen = genau auf ein Feld (Wunsch 19.11.: verspielter)
      b.onclick = () => { if (b.dataset.gezogen) { delete b.dataset.gezogen; return; } const i = platz[0] == null ? 0 : platz[1] == null ? 1 : -1; if (i < 0) return; setze(i, t, b); };
      b.addEventListener('pointerdown', (ev) => ziehe(ev, b, t));
      return b;
    });
    const ruhig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Baustein fliegt sichtbar vom Ausgangsort ins Feld und rastet mit kleinem Ruck ein
    const setze = (i, t, quelle, vonRect) => {
      if (this.geprueft) return;
      const von = vonRect || (quelle && quelle.getBoundingClientRect());
      platz[i] = t;
      male();
      const ziel = slots[i];
      ziel.classList.remove('is-rast'); void ziel.offsetWidth; ziel.classList.add('is-rast');
      if (ruhig || !von) return;
      const nach = ziel.getBoundingClientRect();
      const flug = document.body.appendChild(h('div', 'fle-chip fle-formel-stein fle-formel-flug', t));
      flug.style.left = `${von.left}px`; flug.style.top = `${von.top}px`;
      ziel.style.visibility = 'hidden';
      const dx = nach.left + nach.width / 2 - (von.left + von.width / 2), dy = nach.top + nach.height / 2 - (von.top + von.height / 2);
      const a = flug.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(1.12)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(1)` }], { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)' });
      a.onfinish = () => { flug.remove(); ziel.style.visibility = ''; ziel.classList.remove('is-rast'); void ziel.offsetWidth; ziel.classList.add('is-rast'); };
    };
    const ziehe = (ev, b, t) => {
      if (this.geprueft || b.classList.contains('is-weg') || ev.button !== 0) return;
      const start = { x: ev.clientX, y: ev.clientY };
      const r = b.getBoundingClientRect();
      let geist = null, ueber = -1;
      const bewege = (e) => {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!geist && Math.hypot(dx, dy) < 6) return;
        if (!geist) {
          geist = document.body.appendChild(h('div', 'fle-chip fle-formel-stein fle-formel-flug is-gezogen', t));
          b.classList.add('is-haelt');
        }
        geist.style.left = `${r.left + dx}px`; geist.style.top = `${r.top + dy}px`;
        ueber = slots.findIndex((sl) => { const q = sl.getBoundingClientRect(); return e.clientX >= q.left - 10 && e.clientX <= q.right + 10 && e.clientY >= q.top - 10 && e.clientY <= q.bottom + 10; });
        slots.forEach((sl, i) => sl.classList.toggle('is-ziel', i === ueber));
      };
      const los = () => {
        window.removeEventListener('pointermove', bewege);
        window.removeEventListener('pointerup', los);
        slots.forEach((sl) => sl.classList.remove('is-ziel'));
        b.classList.remove('is-haelt');
        if (!geist) return;
        b.dataset.gezogen = '1';
        const g = geist.getBoundingClientRect();
        geist.remove();
        if (ueber >= 0) setze(ueber, t, null, g);
      };
      window.addEventListener('pointermove', bewege);
      window.addEventListener('pointerup', los);
    };
    const fuss = c.appendChild(h('div', 'fle-puzzle-fuss'));
    const hinweis = fuss.appendChild(h('span', 'fle-leise', 'Tippe oder zieh einen Baustein ins Feld. Ein Feld antippen leert es.'));
    const pruefen = fuss.appendChild(h('button', 'fle-btn mod-cta', 'Prüfen'));
    this.geprueft = false;
    const male = () => {
      slots.forEach((b, i) => { b.textContent = platz[i] || LEER[i]; b.classList.toggle('is-voll', !!platz[i]); });
      knoepfe.forEach((b) => b.classList.toggle('is-weg', platz.includes(b.textContent)));
      pruefen.disabled = platz.includes(null);
    };
    male();
    pruefen.onclick = () => {
      if (pruefen.disabled) return;
      this.geprueft = true;
      const ok = pruefeFormel(k, platz[0], platz[1]);
      if (erstmals) {
        this.gesehen.add(k.id);
        if (ok) this.richtig += 1;
        this.plugin.daten.formeln = formelNachUebung(this.plugin.daten.formeln, k.id, ok, heute(), this.plugin.pruefungDatum('fa'));
        this.plugin.speichere();
        if (!ok) this.liste.push(k);   // gleich nochmals am Ende dieser Runde
      }
      formel.classList.add(ok ? 'is-richtig' : 'is-falsch');
      if (ok) window.setTimeout(() => funken(formel, 22), 250);   // Formel klappt zu, dann Funken
      // Jedes Feld einzeln: richtig gesetzt grün, falsch rot (beim Produkt zählt auch die vertauschte Reihenfolge)
      const soll = ok && k.op === '×' && platz[0] === k.b ? [k.b, k.a] : [k.a, k.b];
      slots.forEach((sl, i) => sl.classList.add(platz[i] === soll[i] ? 'is-ok' : 'is-nein'));
      steine.classList.add('is-zu');
      knoepfe.forEach((b) => { b.disabled = true; });
      // Falsch: die richtige Formel direkt darunter, im gleichen Aufbau
      if (!ok) {
        const l = h('div', `fle-formel is-loesung ${bruch ? 'is-bruch' : 'is-reihe'}`);
        l.appendChild(h('span', 'fle-formel-gleich', 'richtig'));
        const lk = l.appendChild(h('div', 'fle-formel-koerper'));
        lk.appendChild(h('div', 'fle-formel-platz is-voll', k.a));
        lk.appendChild(h('div', 'fle-formel-op', bruch ? '' : k.op));
        lk.appendChild(h('div', 'fle-formel-platz is-voll', k.b));
        formel.insertAdjacentElement('afterend', l);
      }
      hinweis.className = `fle-puzzle-urteil ${ok ? 'is-richtig' : 'is-falsch'}`;
      hinweis.setAttribute('role', 'status');
      hinweis.textContent = ok ? (erstmals ? '✓ Richtig' : '✓ Jetzt sitzt sie') : (erstmals ? '✗ Nicht ganz, kommt am Ende der Runde nochmals' : '✗ Nochmals falsch, sie kommt morgen wieder');
      pruefen.textContent = this.i + 1 < this.liste.length ? 'Weiter' : 'Fertig';
      pruefen.onclick = () => { this.i += 1; this.zeige(); };
      pruefen.focus();
    };
    this.enter = () => { if (!pruefen.disabled) pruefen.click(); };
  }
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
    // Prüfungstermine: jeder Nutzer trägt seine eigenen ein, sie landen im Fahrplan des Moduls
    el.createEl('h3', { text: 'Prüfungstermine' });
    el.createEl('p', { cls: 'setting-item-description', text: 'Deine Termine laut Prüfungsplan. Sie stehen im Prüfungsfahrplan des Moduls; Abgaben und Stichtage der Themen änderst du direkt dort.' });
    for (const key of MODUL_KEYS) {
      const c = cfgFuer(MODUL_INFO[key].modul);
      const f = this.app.metadataCache.getFirstLinkpathDest(c.fahrplan, '');
      const zeile = new obsidian.Setting(el).setName(MODUL_INFO[key].name);
      if (!(f instanceof obsidian.TFile)) { zeile.setDesc(`Noch keine Seite „${c.fahrplan}“ im Vault.`); continue; }
      const schreibe = async (k, wert) => {
        try { await this.app.vault.process(f, (t) => setzePlanWert(t, k, wert) || t); } catch (err) { new obsidian.Notice(`Fahrplan nicht gespeichert: ${err.message}`); }
      };
      this.app.vault.cachedRead(f).then((text) => {
        const kopf = (/```pruefungsfahrplan\r?\n([\s\S]*?)```/.exec(text) || [])[1] || '';
        const wert = (k) => ((new RegExp(`^${k}:\\s*["']?([^"'#\\r\\n]*)`, 'm').exec(kopf) || [])[1] || '').trim();
        zeile.setDesc(`Datum und Uhrzeit · ${f.path}`);
        zeile.addText((t) => { t.inputEl.type = 'date'; t.setValue(wert('pruefung')).onChange((v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) schreibe('pruefung', v); }); });
        zeile.addText((t) => { t.inputEl.type = 'time'; t.setValue(wert('zeit')).onChange((v) => { if (/^\d{2}:\d{2}$/.test(v)) schreibe('zeit', `"${v}"`); }); });
        zeile.addExtraButton((b) => b.setIcon('pencil').setTooltip('Fahrplan öffnen').onClick(() => this.app.workspace.getLeaf(false).openFile(f)));
      });
    }
    el.createEl('h3', { text: 'Lernzentrale' });
    const speichere = async () => { this.plugin.daten.einstellungen = { ...CFG }; await this.plugin.saveData(this.plugin.daten); };
    new obsidian.Setting(el).setName('Beim Start öffnen').setDesc('Die Lernzentrale erscheint, wenn Obsidian startet.')
      .addToggle((t) => t.setValue(CFG.startseite !== false).onChange(async (v) => { CFG.startseite = v; await speichere(); }));
    new obsidian.Setting(el).setName('Linke Leiste beim Start zuklappen').setDesc('Die Ordner-Leiste ist beim Start zu. Aufklappen geht jederzeit oben links.')
      .addToggle((t) => t.setValue(CFG.leisteZu !== false).onChange(async (v) => { CFG.leisteZu = v; await speichere(); }));
    new obsidian.Setting(el).setName('Erst Wirkung tippen').setDesc('Bei Buchungen zuerst wählen, was passiert (Aktivtausch, Gewinn steigt …), danach erscheint die Tabelle.')
      .addToggle((t) => t.setValue(CFG.wirkungZuerst !== false).onChange(async (v) => { CFG.wirkungZuerst = v; await speichere(); }));
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
    this.addCommand({ id: 'wochen-rueckblick', name: 'Wochen-Rückblick zeigen', callback: () => {
      const v = this.app.workspace.getLeavesOfType(VIEW_LZ).map((l) => l.view).find((x) => x.letztesD);
      if (v) v.pruefeRueckblick(v.letztesD, true); else new obsidian.Notice('Öffne zuerst die Lernzentrale.');
    } });
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

    // Aufgaben-Uhr: nach einem Neustart steht sie auf Pause, gezählt bis zum letzten Lebenszeichen
    const u = this.daten.freiUhr;
    if (u && u.seit != null) this.daten.freiUhr = uhrPause(u, u.puls || u.seit);
    this.uhrLeiste = this.addStatusBarItem();
    this.uhrLeiste.addClass('fle-uhrleiste');
    this.zeigeUhr();
    this.registerInterval(window.setInterval(() => this.uhrTick(), 1000));

    // Automatische Lernzeit: alle 15 s dem Modul gutschreiben, an dem gerade gelernt wird
    if (!this.daten.zeit) this.daten.zeit = {};
    this.letzteAktivitaet = Date.now();
    this.letzterZeitTick = Date.now();
    this.zeitStand = { offen: {}, letzte: Date.now() };
    for (const art of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll']) this.registerDomEvent(document, art, () => { this.letzteAktivitaet = Date.now(); }, { capture: true, passive: true });
    this.registerInterval(window.setInterval(() => this.zeitTick(), ZEIT_TICK_MS));
    // Neu gemessene Zeit zeigt die Lernzentrale, sobald man zu ihr wechselt (kein Neuzeichnen während des Lesens)
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf && leaf.view && leaf.view.getViewType && leaf.view.getViewType() === VIEW_LZ && leaf.view.daten) leaf.view.neuLaden();
    }));
  }

  // Woran wird gerade gelernt? Aufgaben-Uhr vor laufendem Lerneinheit-Timer vor offener Datei mit Aktivität (Lernzentrale zählt nie).
  aktuellesModul(jetzt) {
    const u = this.daten.freiUhr;
    if (u && u.seit != null && MODUL_KEYS.includes(u.modul)) return u.modul;
    for (const a of this.aktive || []) {
      const z = this.daten.einheiten[a.e.id];
      if (z && z.laeuft) return a.e.modul === 'mathe' ? 'ma' : modulAusPfad('', a.e.modul || 'fa');
    }
    const leaf = this.app.workspace.getMostRecentLeaf ? this.app.workspace.getMostRecentLeaf() : null;
    const v = leaf && leaf.view;
    // Die Lernzentrale (auch ihre Modulseiten) ist Übersicht, keine Lernzeit (Wunsch 18.11.)
    if (v && v.getViewType && v.getViewType() === VIEW_LZ) return null;
    const f = v && v.file;
    if (!f) return null;
    const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
    return modulAusPfad(f.path, fm.modul);
  }

  zeitTick() {
    const jetzt = Date.now();
    // Nach Schlaf/Ruhezustand nicht die ganze Lücke zählen
    const sek = Math.min(Math.round((jetzt - this.letzterZeitTick) / 1000), 2 * ZEIT_TICK_MS / 1000);
    this.letzterZeitTick = jetzt;
    const k = this.aktuellesModul(jetzt);
    const u = this.daten.freiUhr;
    // Aufgaben-Uhr läuft (Papier, Taschenrechner, Video im Browser): zählt sicher, sie hat ihre eigene Pause
    if (u && u.seit != null && k === u.modul) {
      if (sek > 0) { zeitDazu(this.daten.zeit, heute(), k, sek); this.speichere(); }
      return;
    }
    const aktiv = this.letzteAktivitaet > jetzt - sek * 1000;
    const r = zeitSchritt(this.zeitStand, { jetzt, sek, modul: k, aktiv, schaut: this.schautVideo() });
    this.zeitStand = r.st;
    let neu = false;
    for (const [m, s] of Object.entries(r.gut)) { zeitDazu(this.daten.zeit, heute(), m, s); neu = true; }
    if (neu) this.speichere();
  }

  // Video läuft: ein eigenes <video> spielt, oder der Fokus steckt in einem eingebetteten Player (YouTube-iframe).
  // Klicks im iframe sieht Obsidian nicht, deshalb zählt der Fokus dort als „schaut“.
  schautVideo() {
    if ([...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended)) return true;
    const a = document.activeElement;
    return !!a && a.tagName === 'IFRAME';
  }

  // ── Aufgaben-Uhr ──
  async starteUhr(karte) {
    const u = this.daten.freiUhr;
    if (u && u.text === karte.text && u.modul === karte.modul) { if (u.seit == null) this.uhrWeiter(); return; }
    if (u) await this.stoppeUhr(false);
    const jetzt = Date.now();
    this.daten.freiUhr = { text: karte.text, modul: karte.modul, zeile: karte.zeile, spalte: karte.spalte, sek: 0, seit: jetzt, puls: jetzt };
    this.speichere();
    this.zeigeUhr();
  }

  uhrWeiter() {
    const u = this.daten.freiUhr;
    if (!u) return;
    const jetzt = Date.now();
    this.daten.freiUhr = u.seit == null ? { ...u, seit: jetzt, puls: jetzt } : uhrPause(u, jetzt);
    this.speichere();
    this.zeigeUhr();
  }

  // Stopp schreibt die Minuten in die Fortschrittsnotiz des Moduls; „fertig“ hakt die Karte zusätzlich ab
  async stoppeUhr(fertig) {
    const u = this.daten.freiUhr;
    if (!u) return;
    const sek = uhrSek(u, Date.now());
    this.daten.freiUhr = null;
    await this.saveData(this.daten);
    this.zeigeUhr();
    const min = Math.round(sek / 60);
    const info = MODUL_INFO[u.modul];
    const fs = info && this.app.vault.getAbstractFileByPath(cfgFuer(info.modul).fortschritt);
    if (min > 0 && fs instanceof obsidian.TFile) await this.app.vault.process(fs, (t) => setzeZeit(t, u.text, heute(), min));
    else if (min > 0) new obsidian.Notice(`Fortschrittsnotiz fehlt – ${min} min nicht gespeichert.`);
    if (fertig && u.zeile) {
      const board = this.app.vault.getAbstractFileByPath(CFG.board);
      let ok = false;
      try {
        if (board instanceof obsidian.TFile) await this.app.vault.process(board, (alt) => { const n = hakeAb(alt, u.zeile, heute(), u.spalte); ok = n !== null; return n === null ? alt : n; });
      } catch (err) { console.error('fa-lerneinheit Uhr abhaken', err); }
      if (!ok) new obsidian.Notice('Zeit gespeichert, aber die Karte hat sich im Board geändert. Bitte dort abhaken.');
    }
    new obsidian.Notice(`${info ? info.kurz + ' · ' : ''}${u.text}: ${min} min gespeichert${fertig ? ' und abgehakt' : ''}.`);
  }

  uhrTick() {
    const u = this.daten.freiUhr;
    if (!u || u.seit == null) return;
    const jetzt = Date.now();
    // Lange kein Puls (Schlaf/Ruhezustand): nur bis zum letzten Puls zählen und pausieren
    if (jetzt - u.puls > PAUSE_MS) { this.daten.freiUhr = uhrPause(u, u.puls); this.speichere(); this.zeigeUhr(); return; }
    u.puls = jetzt;
    if (!this.uhrGespeichert || jetzt - this.uhrGespeichert > PULS_MS) { this.uhrGespeichert = jetzt; this.speichere(); }
    if (this.uhrZeit) this.uhrZeit.textContent = uhr(uhrSek(u, jetzt));
  }

  zeigeUhr() {
    const el = this.uhrLeiste;
    if (!el) return;
    el.empty();
    const u = this.daten.freiUhr;
    el.toggleClass('is-aus', !u);
    for (const v of this.app.workspace.getLeavesOfType(VIEW_LZ)) if (v.view && v.view.markiereUhr) v.view.markiereUhr();
    if (!u) return;
    const info = MODUL_INFO[u.modul];
    el.toggleClass('is-pause', u.seit == null);
    const t = el.createSpan({ cls: 'fle-ul-text' });
    if (info) t.createEl('i', { attr: { style: `background:${info.farbe}` } });
    t.appendText(`${info ? info.kurz + ' · ' : ''}${u.text}`);
    t.title = u.text;
    this.uhrZeit = el.createSpan({ cls: 'fle-ul-zeit', text: uhr(uhrSek(u, Date.now())) });
    const knopf = (icon, titel, fn) => { const b = el.createEl('button', { cls: 'fle-ul-btn', attr: { 'aria-label': titel, title: titel } }); obsidian.setIcon(b, icon); b.onclick = fn; return b; };
    knopf(u.seit == null ? 'play' : 'pause', u.seit == null ? 'Weiter' : 'Pause', () => this.uhrWeiter());
    knopf('check', 'Fertig: Zeit speichern und Karte abhaken', () => this.stoppeUhr(true)).addClass('is-fertig');
    knopf('square', 'Stopp: Zeit speichern, Karte bleibt offen', () => this.stoppeUhr(false));
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

  // Prüfungsdatum je Modul: aus dem zuletzt geladenen Fahrplan, sonst aus PRUEFUNG
  pruefungDatum(modul = 'fa') {
    const key = modul === 'mathe' ? 'ma' : modul;
    return ((this.pruefungsCache || {})[modul]) || (PRUEFUNG[key] || {}).datum || null;
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
    if (r.plan.pruefung) this.pruefungsCache = { ...(this.pruefungsCache || {}), [modul]: isoTag(r.plan.pruefung) };
    const zeilen = fs instanceof obsidian.TFile ? leseFortschritt(await this.app.vault.cachedRead(fs)) : [];
    const tag = heute();
    let liste = null;
    if (c.quizOrdner) {
      let quiz = null;
      try { quiz = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/plugins/lern-quiz/data.json`)); } catch (err) { quiz = null; }
      liste = quizListe(quiz, c.quizOrdner);
    }
    return { plan: r.plan, themen: r.plan.themen.map((t) => {
      const st = themaStatus(t, zeilen, tag, r.plan.pruefung, niveauAus(r.plan));
      return { ...t, ...(liste ? themaMitQuiz(t, st, liste, tag, c.quizDeckel) : st) };
    }) };
  }

  // Jede fällige Wiederholung genau einmal aufs Board; erst eine neue Einschätzung plant die nächste
  async planeWiederholungen() {
    const board = this.app.vault.getAbstractFileByPath(CFG.board);
    if (!(board instanceof obsidian.TFile)) return;
    const gemacht = this.daten.wiederholt || (this.daten.wiederholt = {});
    // Einen Tag Vorlauf (15.11.2026): Karte erscheint schon am Vortag, damit die Routine (06:30/12:30)
    // die Einheit vor dem Fälligkeitstag baut. Vorher kam die Karte oft nach dem letzten Lauf → „morgen ab 06:30“.
    const tag = plusTage(heute(), 1);
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
module.exports.logik = { bezuege, zeitSchritt, modulAusPfad, zeitDazu, mischeZeit, wochenzielFuer, auswahlWahl, bewerteKprim, bewerteAuswahl, kprimWahl, videosFuer, ERKLAERVIDEOS, folgtHinweis, kw,unterlagenGruppen, wiederholKarte, quizListe, themaMitQuiz, NEUE_MODULE, tafelSpalte, hakeAb, naechsteSiebenMitRest, UNTERLAGEN, PRUEFUNG, pruefungsSatz, modulDateien, letzteRunde, naechsteSieben, erledigtListe, fakten, fahrplanKennzahlen, hochrechnung, leseBoard, etappeHeute, lernMinuten, wocheVon, serie, tagesziel, MODUL_SPALTEN, pruefTempo, bewerteBuchung, prozentFuerMit, uebernahmeAblauf, istVorschlagSeite, pdfSeiten, pruefeSpick, spickAenderungen, uebernimmVorschlag, spickHtml, SPICK_MAX_ZEICHEN, noteMit, naechsteTodos, matheZeilen, cfgFuer, MODULE, leseZahl, leseZahlen, pruefeZahl, pruefeMenge, pruefeEinheit, KONTENPLAN, EINSCHAETZUNGEN, istKonto,
  buchungsDiagnose, kontoArt, buchungsWirkung, sicherFalsch,
  WIRKUNGEN, wirkungSoll, tempoSoll, tempoStufe, FEHLER_ABSTAND, fehlerId, fehlerEintragen, fehlerNachUebung, faelligeFehler,
  ANKER_TAGE, ankerFaellig, FEHLERARTEN, kalibrierung, erstversuchQuote,
  KENNZAHLEN, pruefeFormel, formelBausteine, formelnHeute, formelNachUebung, formelGruppen,
  neuerZustand, starte, stoppeLaufenden, istWackelig, MAX_LAUF_S, stoppeNachAbsturz, nachPause, fallSekunden, matheEinheitZeile, uhrSek, uhrPause, setzeZeit,
  hakeKarteAb, fortschrittZeile, setzeFortschritt, pruefungsErgebnis, restSekunden, freischaltung, normKonto, leseBetrag, pruefeBuchung, trefferQuote,
  leseFortschritt, punkteZeile, tagesZeile, themaStatus, sollAm, sollStoff, unterrichtVon, niveauAus, druckStufe, noteAus, pruefungsInfo, setzePlanWert, prozentFuer, statusAus, pruefeFahrplan, setzeWiederholung, tageBis, setzeDatum, etappeTitel, weichTrennen };
