// Prüft Seiten und rechnet den Fahrplan-Stand mit der Logik des Plugins FA-Lerneinheit, ohne Obsidian.
// Die beiden Pfade ersetzt Claude beim Einrichten (EINRICHTEN.md).
//
//   node pruefe.js einheit "<Seite mit ```lerneinheit>"     → { ok: true } oder Fehler
//   node pruefe.js spick   "<Seite mit ```spick>"           → { ok: true } oder Fehler
//   node pruefe.js status  "<Prüfungsfahrplan.md>" "<Fortschrittsnotiz.md>"
//        → je Thema: Können/Soll | Druck | Status | Stichtag | Wieder | Thema
const PLUGIN = '<VAULT>/.obsidian/plugins/fa-lerneinheit';
const JSYAML = '<JSYAML>';

const fs = require('fs');
const l = require('./logik.js')(PLUGIN);
const y = require(JSYAML);

const block = (datei, name) => {
  const teile = fs.readFileSync(datei, 'utf8').replace(/\r\n/g, '\n').split('```' + name);
  if (teile.length < 2) throw new Error(`Kein \`\`\`${name}-Block in ${datei}`);
  return y.load(teile[1].split('\n```')[0]);
};

const [art, a, b] = process.argv.slice(2);
if (art === 'einheit') console.log(l.pruefeEinheit(block(a, 'lerneinheit')));
else if (art === 'spick') console.log(l.pruefeSpick(block(a, 'spick')));
else if (art === 'status') {
  const r = l.pruefeFahrplan(block(a, 'pruefungsfahrplan'));
  if (!r.ok) { console.log(r); process.exit(1); }
  const z = l.leseFortschritt(fs.readFileSync(b, 'utf8'));
  const heute = new Date().toLocaleDateString('sv-SE');
  for (const t of r.plan.themen) {
    const s = l.themaStatus(t, z, heute, r.plan.pruefung);
    console.log([`${s.koennen}/${s.soll}`, s.druck, s.status, t.stichtag, s.wieder || '-', t.thema].join(' | '));
  }
} else {
  console.log('Aufruf: node pruefe.js einheit <Seite> | spick <Seite> | status <Fahrplan> <Fortschritt>');
  process.exit(1);
}
