// Vult de oefeningen zonder StrengthLevel-standaard in src/lib/strength-standards.json met een
// afgeleide of geschatte standaard, zodat elke oefening een rang heeft.
//
//   node scripts/derive-standards.mjs           schrijven + zelfcontrole
//   node scripts/derive-standards.mjs --check   alleen controleren (niets schrijven)
//
// Deterministisch en herhaalbaar: elke afgeleide standaard wordt opnieuw berekend uit de originele
// StrengthLevel-data. Originele standaarden (van scripts/fetch-standards.mjs) worden nooit aangepast.
// Let op: `node scripts/fetch-standards.mjs --all` haalt alles opnieuw op en zet de oefeningen
// hieronder weer op null; draai daarna dit script opnieuw.
//
// Soorten:
//   derived:<slug>   een bestaande standaard x factor (zelfde beweging/materiaal, met onderbouwing)
//   spotter-estimate eigen schatting (tijd, dragen/duwen, bandoefeningen) op basis van gangbare niveaus
//
// Extra velden in de JSON (zie src/lib/ranks.ts):
//   unit: "seconds"      statische oefening; de reps van een set zijn seconden
//   scoring: "load"      rang op het zwaarste gewicht van een set (geen 1RM-schatting)
//   scoring: "assisted"  gewicht = ondersteuning; rang op effectieve 1RM (lichaamsgewicht min hulp)
//   anyWeight: true      reps/seconden tellen ook als er gewicht (band, vest) bij gelogd is
//   maxReps: <n>         kg/1RM: sets tot n reps tellen mee (standaard 12), voor oefeningen die je
//                        vrijwel altijd met hoge reps doet (kuiten, kabel-abductie)
//   basedOn / factor / note   herkomst, voor de app ("Geschatte standaard op basis van ...")

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/lib/strength-standards.json");
const SOURCES = ["exercises.ts", "exercises-upper.ts", "exercises-lower.ts"].map((f) => join(root, "src/lib", f));
const checkOnly = process.argv.includes("--check");

const original = readFileSync(OUT, "utf8");
const data = JSON.parse(original);

const isEstimate = (std) => !!std && (std.source.startsWith("derived:") || std.source === "spotter-estimate");

// ───────────────────────────── Afrondingen ─────────────────────────────

const half = (n) => Math.round(n * 2) / 2;
const whole = (n) => Math.round(n);

/** Bodyweight-/leeftijdstabel x factor (eerste kolom blijft staan). */
const scaleRows = (rows, f, round) => rows?.map(([x, ...v]) => [x, ...v.map((n) => round(n * f))]);

// ───────────────────────────── 1. Afgeleid van een bestaande standaard ─────────────────────────────

/**
 * Bestaande StrengthLevel-standaard x factor. Schaalt alle grenzen in de man/vrouw-tabellen en de
 * leeftijdstabellen. Extra-gewicht-tabellen (*Added) alleen bij `keepAdded` (en dan ongeschaald:
 * ze zijn in kg, niet in reps).
 */
function derive(from, factor, note, { keepAdded = false, scoring, anyWeight, maxReps } = {}) {
  const src = data[from];
  if (!src || isEstimate(src)) throw new Error(`Bron ${from} is geen originele standaard`);
  const round = src.unit === "kg" ? half : whole;
  const std = {
    source: `derived:${from}`,
    basedOn: from,
    factor,
    note,
    implement: src.implement,
    unit: src.unit,
    ...(scoring && { scoring }),
    ...(anyWeight && { anyWeight: true }),
    ...(maxReps && { maxReps }),
    male: scaleRows(src.male, factor, round),
    female: scaleRows(src.female, factor, round),
    ...(src.ageMale && { ageMale: scaleRows(src.ageMale, factor, round) }),
    ...(src.ageFemale && { ageFemale: scaleRows(src.ageFemale, factor, round) }),
  };
  if (keepAdded && src.maleAdded) {
    Object.assign(std, {
      maleAdded: src.maleAdded,
      femaleAdded: src.femaleAdded,
      ...(src.ageMaleAdded && { ageMaleAdded: src.ageMaleAdded, ageFemaleAdded: src.ageFemaleAdded }),
    });
  }
  return std;
}

// ───────────────────────────── 2. Eigen schattingen ─────────────────────────────

const MALE_BW = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140];
const FEMALE_BW = [40, 50, 60, 70, 80, 90, 100, 110, 120];
const REF_BW = { male: 80, female: 65 };

/**
 * Leeftijdstabel met het verloop van de deadlift (StrengthLevel), toegepast op onze grenzen bij
 * gemiddeld lichaamsgewicht. `damp` < 1 maakt de daling met de leeftijd vlakker (uithouding/houdingen
 * nemen minder snel af dan maximale kracht). Wordt in de app als verhouding gebruikt (ratio-modus).
 */
function ageTable(levels, sex, round, damp = 1) {
  const tpl = data.deadlift[sex === "male" ? "ageMale" : "ageFemale"];
  const ref = tpl.find((r) => r[0] === 30);
  return tpl.map(([age, ...v]) => [age, ...levels.map((l, k) => Math.max(round === half ? 0.5 : 1, round(l * (1 - damp * (1 - v[k] / ref[k + 1])))))]);
}

/**
 * Rang op het zwaarste gewicht (dragen, duwen, zwaaien). Grenzen bij referentiegewicht (man 80 kg,
 * vrouw 65 kg), geschaald met (lichaamsgewicht / referentie) ^ exp: sterkte groeit minder dan
 * evenredig met lichaamsgewicht (allometrisch, ~0,67 voor hele-lichaamskracht).
 */
function loadStandard(note, male, female, exp = 0.67) {
  const rows = (bws, ref, levels) => bws.map((bw) => [bw, ...levels.map((l) => half(l * (bw / ref) ** exp))]);
  return {
    source: "spotter-estimate",
    note,
    unit: "kg",
    scoring: "load",
    male: rows(MALE_BW, REF_BW.male, male),
    female: rows(FEMALE_BW, REF_BW.female, female),
    ageMale: ageTable(male, "male", half),
    ageFemale: ageTable(female, "female", half),
  };
}

/**
 * Statische houding in seconden. Grotendeels onafhankelijk van lichaamsgewicht; bij hangen/steunen
 * (`exp` < 0) wordt het met meer lichaamsgewicht zwaarder, dus lagere grenzen.
 */
function timedStandard(note, male, female, exp = 0) {
  const rows = (bws, ref, levels) => bws.map((bw) => [bw, ...levels.map((l) => Math.max(1, whole(l * (bw / ref) ** exp)))]);
  return {
    source: "spotter-estimate",
    note,
    unit: "seconds",
    anyWeight: true,
    male: rows(MALE_BW, REF_BW.male, male),
    female: rows(FEMALE_BW, REF_BW.female, female),
    ageMale: ageTable(male, "male", whole, 0.5),
    ageFemale: ageTable(female, "female", whole, 0.5),
  };
}

/** Reps zonder bruikbare bron (bandoefeningen e.d.): vlakke tabel, geen leeftijdscorrectie. */
function repsStandard(note, male, female, { anyWeight = true } = {}) {
  const rows = (bws, levels) => bws.map((bw) => [bw, ...levels]);
  return {
    source: "spotter-estimate",
    note,
    unit: "reps",
    ...(anyWeight && { anyWeight: true }),
    male: rows(MALE_BW, male),
    female: rows(FEMALE_BW, female),
  };
}

/**
 * Assisted pull-up machine: gewicht = ondersteuning. De app rekent de effectieve 1RM uit
 * (lichaamsgewicht min ondersteuning, Epley) en vergelijkt die met de pull-up-standaard met extra
 * gewicht: grens = lichaamsgewicht + extra gewicht. Zo sluit de rang naadloos aan op echte pull-ups
 * (ondersteuning 0 = gewone pull-up). Leeftijdstabellen: extra gewicht + gemiddeld lichaamsgewicht
 * (aanname man 85 kg, vrouw 70 kg; alleen de verhouding telt).
 */
function assistedPullUp() {
  const src = data["pull-up"];
  const total = (rows) => rows.map(([bw, ...v]) => [bw, ...v.map((a) => half(bw + a))]);
  const totalAge = (rows, bw) => rows.map(([age, ...v]) => [age, ...v.map((a) => half(bw + a))]);
  return {
    source: "derived:pull-up",
    basedOn: "pull-up",
    factor: 1,
    note: "Pull-up-standaard met extra gewicht, omgerekend naar effectieve 1RM (lichaamsgewicht min ondersteuning).",
    implement: src.implement,
    unit: "kg",
    scoring: "assisted",
    male: total(src.maleAdded),
    female: total(src.femaleAdded),
    ageMale: totalAge(src.ageMaleAdded, 85),
    ageFemale: totalAge(src.ageFemaleAdded, 70),
  };
}

/**
 * Single-leg calf raise: reps per been (eigen schatting) plus extra gewicht (dumbbell), afgeleid van
 * de calf raise machine: één been draagt (lichaamsgewicht + machinegewicht) / 2, x 0,9 voor balans.
 * Extra gewicht = dat min lichaamsgewicht (kan negatief zijn bij de lage niveaus).
 */
function singleLegCalfRaise() {
  const src = data["standing-calf-raise"];
  const added = (rows) => rows.map(([bw, ...v]) => [bw, ...v.map((l) => half((0.9 * (bw + l)) / 2 - bw))]);
  const reps = repsStandard("", [5, 12, 20, 30, 45], [4, 10, 17, 26, 38], { anyWeight: false });
  return {
    source: "derived:standing-calf-raise",
    basedOn: "standing-calf-raise",
    note: "Reps per been: eigen schatting. Extra gewicht: calf raise machine, per been (lichaamsgewicht + gewicht) / 2 x 0,9.",
    unit: "reps",
    male: reps.male,
    female: reps.female,
    maleAdded: added(src.male),
    femaleAdded: added(src.female),
  };
}

// ───────────────────────────── De mapping (alle 81 oefeningen) ─────────────────────────────

const MAPPING = {
  // ── Borst ──
  "smith-machine-incline-press": () => derive("incline-bench-press", 0.95, "Smith machine bench zit op ~95% van de vrije bench; zelfde verhouding voor incline."),
  "incline-chest-press-machine": () => derive("chest-press-machine", 0.85, "Zelfde machinepatroon; schuin drukken is ~85% van vlak."),
  "low-to-high-cable-fly": () => derive("cable-fly", 0.8, "Zelfde kabel-fly; de baan van laag naar hoog is mechanisch zwakker."),
  "incline-cable-fly": () => derive("cable-fly", 0.9, "Zelfde kabel-fly op een schuine bank, iets lichter."),
  "high-to-low-cable-fly": () => derive("cable-fly", 1.0, "Zelfde kabel-fly; hoog naar laag is ongeveer even sterk als de standaardversie."),
  "svend-press": () => derive("front-raise", 1.0, "Eén plaat/dumbbell met twee handen voor je uit; het knijpen beperkt tot ongeveer een front raise per dumbbell."),
  "chest-dips": () => derive("dips", 1.0, "Dezelfde dip met voorovergebogen romp; reps en extra gewicht zoals gewone dips.", { keepAdded: true }),

  // ── Schouders ──
  "cable-front-raise": () => derive("front-raise", 1.0, "Kabel- en dumbbellraises liggen gelijk (zie cable vs dumbbell lateral raise)."),
  "plate-front-raise": () => derive("front-raise", 1.5, "Eén plaat met twee handen: ~1,5x het gewicht van één dumbbell."),
  "y-raise": () => derive("lateral-raise", 0.45, "Voorover op een schuine bank in Y-vorm: veel lichter dan een lateral raise."),
  "lu-raise": () => derive("lateral-raise", 0.55, "Lateral raise met gestrekte armen tot boven je hoofd: lichter dan een gewone lateral raise."),
  "band-pull-apart": () => repsStandard("Band: reps per set, ongeacht de band.", [10, 20, 35, 50, 75], [10, 20, 30, 45, 65]),
  "cuban-press": () => derive("lateral-raise", 0.6, "Begrensd door de externe rotatie; gewichten zoals een lichte lateral raise."),

  // ── Biceps / onderarmen ──
  "bayesian-curl": () => derive("cable-curl", 0.4, "Eén arm (x0,5) in de gerekte positie (x0,8) ten opzichte van de kabelcurl met twee armen."),
  "drag-curl": () => derive("barbell-curl", 0.8, "Barbell curl met ellebogen naar achteren: kortere hefboom, ~80%."),
  "bicep-21s": () =>
    derive("ez-bar-curl", 0.6, "Een set 21s gaat met ~60% van je EZ-bar-curl-1RM; rang op het zwaarste 21s-gewicht.", { scoring: "load" }),
  "spider-curl": () => derive("dumbbell-curl", 0.75, "Dumbbell curl voorover op een schuine bank, zonder momentum: ~75%."),
  "cable-preacher-curl": () => derive("cable-curl", 0.8, "Kabelcurl met preacher-kussen: geen valsspelen, ~80%."),
  "cross-body-hammer-curl": () => derive("hammer-curl", 0.95, "Hammer curl schuin over je lichaam: bijna even zwaar."),
  "behind-the-back-wrist-curl": () => derive("wrist-curl", 2.0, "Stang met twee handen (2x de dumbbell per hand); achter de rug met vingerrol."),
  "wrist-roller": () => loadStandard("Gewicht aan het touw dat je helemaal oprolt.", [5, 10, 15, 22.5, 30], [2.5, 5, 7.5, 12.5, 17.5], 0.5),
  "farmers-walk": () => loadStandard("Zwaarste gewicht per hand (per dumbbell) waarmee je loopt.", [28, 40, 56, 76, 96], [16, 22, 30, 40, 52]),
  "plate-pinch": () => loadStandard("Totaal aan schijven dat je in één hand knijpt.", [10, 15, 20, 30, 40], [5, 10, 15, 20, 25], 0.33),
  "dead-hang": () => timedStandard("Hangen aan de stang; zwaarder met meer lichaamsgewicht.", [20, 45, 75, 105, 150], [15, 30, 55, 80, 120], -0.5),

  // ── Triceps ──
  "dumbbell-skull-crusher": () => derive("skull-crusher", 0.4, "Twee dumbbells, per dumbbell ~40% van de stang (minder stabiel)."),
  "single-arm-cable-pushdown": () => derive("triceps-pushdown-rope", 0.5, "Eén arm aan de kabel: de helft van de pushdown met twee armen."),
  "cable-triceps-kickback": () => derive("dumbbell-kickback", 1.0, "Kabel- en dumbbellisolaties liggen gelijk per arm."),

  // ── Rug ──
  "assisted-pull-up-machine": assistedPullUp,
  "single-arm-cable-row": () => derive("seated-cable-row", 0.55, "Eén arm: iets meer dan de helft van de cable row met twee armen."),
  // Kroc rows zijn per definitie hoge-repsets (15-30): rang op de zwaarste dumbbell, niet op een 1RM.
  "kroc-row": () =>
    derive("dumbbell-row", 0.65, "Een set kroc rows (15+ reps, met wat lichaamsinzet) gaat met ~65% van je dumbbell-row-1RM; rang op de zwaarste dumbbell.", {
      scoring: "load",
    }),
  "cable-rope-pullover": () => derive("straight-arm-pulldown", 0.9, "Zelfde beweging als de straight-arm pulldown, met touw iets lichter."),
  "seal-row": () => derive("barbell-row", 0.8, "Barbell row liggend op een bank: geen momentum of beenhulp, ~80%."),
  "behind-the-back-cable-shrug": () => derive("barbell-shrug", 0.7, "Shrug aan de kabel achter je lichaam: kleinere bewegingsuitslag, ~70%."),

  // ── Core ──
  "bird-dog": () => derive("superman", 1.0, "Vergelijkbare rugstrek-oefening op lichaamsgewicht; reps per kant."),
  plank: () => timedStandard("Onderarmplank, seconden.", [30, 60, 120, 180, 300], [30, 60, 110, 170, 280]),
  "v-up": () => derive("sit-up", 0.5, "Romp en gestrekte benen tegelijk: ongeveer half zoveel reps als sit-ups."),
  "toe-touch-crunch": () => derive("crunch", 0.8, "Crunch met benen omhoog, iets zwaarder dan een gewone crunch."),
  "machine-crunch": () => derive("cable-crunch", 1.0, "Belaste crunch aan een gewichtsblok, zoals de cable crunch."),
  "lying-hip-raise": () => derive("reverse-crunch", 0.9, "Heupen van de grond met gestrekte benen, iets zwaarder dan een reverse crunch."),
  "captains-chair-leg-raise": () => derive("hanging-leg-raise", 1.5, "Beenheffen met rugsteun: makkelijker dan hangend, ~1,5x zoveel reps."),
  "l-sit": () => timedStandard("Steunen met gestrekte benen; zwaarder met meer lichaamsgewicht.", [3, 8, 15, 30, 60], [2, 5, 12, 25, 45], -0.5),
  "hollow-body-hold": () => timedStandard("Hollow hold op de rug, seconden.", [15, 30, 60, 90, 150], [15, 30, 55, 85, 140]),
  "side-plank": () => timedStandard("Zijplank per kant, seconden.", [20, 40, 75, 120, 180], [20, 40, 70, 110, 170]),
  "pallof-press": () => derive("cable-woodchopper", 0.8, "Anti-rotatie aan de kabel, ~80% van de woodchopper."),
  "heel-taps": () => derive("crunch", 1.3, "Korte zijwaartse tikken: meer reps dan crunches."),
  "suitcase-carry": () => loadStandard("Zwaarste dumbbell/kettlebell in één hand waarmee je loopt.", [20, 30, 42, 56, 72], [12, 17, 24, 32, 42]),
  "landmine-rotation": () => derive("landmine-press", 0.5, "Zelfde landmine-belading; draaien gaat met ongeveer de helft."),
  "dead-bug": () => derive("lying-leg-raise", 1.3, "Afwisselend arm/been: makkelijker dan lying leg raises, meer reps."),
  "plank-shoulder-tap": () => derive("mountain-climber", 0.8, "Zelfde hoge plank met afwisselende bewegingen, iets minder reps."),
  "plank-up-down": () => derive("push-up", 0.6, "Wisselen tussen onderarm- en hoge plank leunt op de armen zoals push-ups."),
  "stir-the-pot": () => derive("ab-wheel-rollout", 1.2, "Anti-extensie zoals de ab wheel; rondjes zijn iets makkelijker per rep."),

  // ── Billen / benen ──
  "reverse-lunge": () => derive("walking-lunge", 1.0, "Dumbbell lunge naar achteren: even zwaar als de dumbbell lunge (per dumbbell)."),
  "curtsy-lunge": () => derive("bodyweight-squat", 0.5, "Eenbenige lunge op lichaamsgewicht: ongeveer de helft van de squat-reps."),
  "single-leg-romanian-deadlift": () => derive("dumbbell-romanian-deadlift", 0.55, "Eén been en balans: ~55% van de dumbbell RDL (per dumbbell)."),
  "kettlebell-swing": () => loadStandard("Zwaarste kettlebell waarmee je een set swingt.", [12, 20, 28, 36, 48], [8, 12, 16, 24, 32]),
  "single-leg-hip-thrust": () => derive("glute-bridge", 0.45, "Eén been en meer bewegingsuitslag: minder dan de helft van de glute-bridge-reps."),
  "b-stance-hip-thrust": () => derive("hip-thrust", 0.6, "Werkende been doet ~80% van het werk: ~60% van de gewone hip thrust."),
  "hip-thrust-machine": () => derive("hip-thrust", 0.9, "Hip thrust in een machine; hefboom verschilt, ~90%."),
  "frog-pump": () => derive("glute-bridge", 1.2, "Kortere glute bridge: iets meer reps."),
  "donkey-kick": () => derive("glute-bridge", 0.9, "Bilisolatie op lichaamsgewicht, per been."),
  "reverse-hyperextension": () =>
    derive("cable-pull-through", 1.0, "Belaste heupstrekking zoals de cable pull-through.", { maxReps: 30 }),
  "fire-hydrant": () => derive("glute-bridge", 0.8, "Zijwaartse bilisolatie op lichaamsgewicht, per been."),
  "banded-lateral-walk": () => repsStandard("Band: stappen per richting, ongeacht de band.", [10, 20, 30, 45, 60], [10, 20, 30, 45, 60]),
  "cable-hip-abduction": () =>
    derive("hip-abduction-machine", 0.2, "Eén been staand aan de kabel met lange hefboom: ~20% van de machine.", { maxReps: 30 }),
  clamshell: () => repsStandard("Band: reps per kant, ongeacht de band.", [10, 20, 30, 45, 60], [10, 20, 30, 45, 60]),
  "sumo-squat": () => derive("goblet-squat", 1.15, "Eén dumbbell hangend tussen de benen: iets zwaarder dan vasthouden bij een goblet squat."),
  "step-up": () => derive("walking-lunge", 0.95, "Eenbenig met dumbbells, net iets lichter dan de dumbbell lunge."),
  "lateral-lunge": () => derive("bodyweight-squat", 0.5, "Eenbenig op lichaamsgewicht: ongeveer de helft van de squat-reps."),
  "pendulum-squat": () => derive("hack-squat", 0.8, "Machinesquat met zwaardere hefboom dan de hack squat."),
  "single-leg-leg-press": () => derive("leg-press", 0.55, "Eén been: iets meer dan de helft van de leg press."),
  "jump-squat": () => derive("bodyweight-squat", 0.5, "Explosieve squat: ongeveer de helft van de squat-reps."),
  "box-jump": () => derive("bodyweight-squat", 0.35, "Explosieve sprongen achter elkaar: ~een derde van de squat-reps."),
  "wall-sit": () => timedStandard("Statisch tegen de muur, seconden.", [30, 60, 100, 150, 240], [30, 55, 90, 140, 220]),
  "sled-push": () => loadStandard("Gewicht op de slee (zonder de slee zelf).", [40, 80, 120, 180, 240], [25, 50, 80, 120, 165]),
  "stability-ball-leg-curl": () => derive("glute-bridge", 0.6, "Glute bridge met leg curl op de bal: minder reps dan de bridge."),
  "copenhagen-plank": () => timedStandard("Copenhagen-zijplank per kant, seconden.", [10, 20, 35, 60, 90], [8, 15, 30, 50, 75]),
  "cable-hip-adduction": () =>
    derive("hip-adduction-machine", 0.2, "Eén been staand aan de kabel met lange hefboom: ~20% van de machine.", { maxReps: 30 }),

  // ── Kuiten / scheen ──
  "leg-press-calf-raise": () =>
    derive("standing-calf-raise", 1.15, "Kuitheffen in de leg press laadt iets zwaarder dan de staande machine.", { maxReps: 30 }),
  "single-leg-calf-raise": singleLegCalfRaise,
  "donkey-calf-raise": () =>
    derive("standing-calf-raise", 1.0, "Belaste kuitheffing zoals de staande calf raise machine.", { maxReps: 30 }),
  "tibialis-raise": () => repsStandard("Reps op lichaamsgewicht (of met tib bar).", [10, 20, 30, 45, 60], [10, 20, 30, 45, 60]),
};

// ───────────────────────────── Uitvoeren ─────────────────────────────

const exerciseSlugs = [];
for (const file of SOURCES) {
  for (const m of readFileSync(file, "utf8").matchAll(/slug:\s*"([^"]+)",\s*name:\s*"/g)) exerciseSlugs.push(m[1]);
}

const errors = [];
const fail = (msg) => errors.push(msg);

for (const [slug, make] of Object.entries(MAPPING)) {
  if (!exerciseSlugs.includes(slug)) fail(`${slug}: geen oefening met deze slug`);
  const cur = data[slug];
  if (cur && !isEstimate(cur)) fail(`${slug}: heeft al een StrengthLevel-standaard (${cur.source}); niet overschrijven`);
  else data[slug] = make();
}

// ───────────────────────────── Zelfcontrole ─────────────────────────────

const UNITS = ["kg", "reps", "seconds"];
function checkRows(slug, name, rows, { allowNegative = false, strict = !name.startsWith("age") } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return fail(`${slug}.${name}: te weinig rijen`);
  let prevX = -Infinity;
  for (const row of rows) {
    if (row.length !== 6 || row.some((n) => typeof n !== "number" || !Number.isFinite(n))) return fail(`${slug}.${name}: ongeldige rij ${JSON.stringify(row)}`);
    if (row[0] <= prevX) fail(`${slug}.${name}: eerste kolom niet oplopend`);
    prevX = row[0];
    const lv = row.slice(1);
    for (let k = 1; k < lv.length; k++) if (lv[k] < lv[k - 1]) fail(`${slug}.${name}: grenzen dalen in ${JSON.stringify(row)}`);
    if (!allowNegative && lv.some((n) => n < 0)) fail(`${slug}.${name}: negatieve grens in ${JSON.stringify(row)}`);
    // Leeftijdstabellen van de bron mogen op hoge leeftijd helemaal 0 zijn (reps, verschil-modus).
    if (strict && !(lv[4] > lv[0])) fail(`${slug}.${name}: Elite niet hoger dan Beginner in ${JSON.stringify(row)}`);
  }
}

for (const slug of Object.keys(MAPPING)) {
  const std = data[slug];
  if (!std) continue;
  if (!UNITS.includes(std.unit)) fail(`${slug}: onbekende eenheid ${std.unit}`);
  if (std.scoring && !["load", "assisted"].includes(std.scoring)) fail(`${slug}: onbekende scoring ${std.scoring}`);
  if (std.scoring && std.unit !== "kg") fail(`${slug}: scoring alleen bij kg`);
  if (std.maxReps != null && (std.unit !== "kg" || std.scoring || !(std.maxReps > 12 && std.maxReps <= 30)))
    fail(`${slug}: maxReps alleen bij een 1RM-standaard (kg zonder scoring), tussen 13 en 30`);
  if (std.basedOn && (!data[std.basedOn] || isEstimate(data[std.basedOn]))) fail(`${slug}: basedOn ${std.basedOn} is geen originele standaard`);
  for (const key of ["male", "female", "ageMale", "ageFemale"]) {
    if (key in std) checkRows(slug, key, std[key]);
  }
  // kg en seconden worden als verhouding gebruikt: de laagste grens moet > 0 zijn.
  if (std.unit !== "reps") {
    for (const key of ["male", "female", "ageMale", "ageFemale"]) {
      if (std[key]?.some((r) => r[1] <= 0)) fail(`${slug}.${key}: grens 0 bij ${std.unit}`);
    }
  }
  for (const key of ["maleAdded", "femaleAdded", "ageMaleAdded", "ageFemaleAdded"]) {
    if (key in std) checkRows(slug, key, std[key], { allowNegative: true });
  }
  if (!std.male || !std.female) fail(`${slug}: man- of vrouwtabel ontbreekt`);
}

// Originele standaarden mogen niet veranderd zijn.
const before = JSON.parse(original);
for (const [slug, std] of Object.entries(before)) {
  if (std && !isEstimate(std) && JSON.stringify(std) !== JSON.stringify(data[slug])) fail(`${slug}: originele standaard is gewijzigd`);
}
// Elke oefening heeft nu een standaard.
const missing = exerciseSlugs.filter((s) => !data[s]);
if (missing.length) fail(`Nog zonder standaard: ${missing.join(", ")}`);
// Standaarden in seconden horen precies bij de oefeningen die in de app als `timed` gelogd worden.
const timedSrc = readFileSync(SOURCES[0], "utf8").match(/const TIMED = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
const timed = [...timedSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
const seconds = exerciseSlugs.filter((s) => data[s]?.unit === "seconds").sort();
if (timed.join() !== seconds.join()) fail(`TIMED in exercises.ts (${timed.join(", ")}) wijkt af van de standaarden in seconden (${seconds.join(", ")})`);

const counts = Object.values(MAPPING).length;
if (errors.length) {
  console.error(`Zelfcontrole mislukt (${errors.length}):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}

const json = JSON.stringify(Object.fromEntries(Object.entries(data).sort()), null, 0) + "\n";
if (checkOnly) {
  const upToDate = json === original;
  console.log(upToDate ? "OK: strength-standards.json is actueel." : "Verschil: draai `node scripts/derive-standards.mjs` om bij te werken.");
  process.exit(upToDate ? 0 : 1);
}
writeFileSync(OUT, json);
const total = Object.values(data).filter(Boolean).length;
console.log(`Klaar: ${counts} afgeleide/geschatte standaarden, ${total} van ${exerciseSlugs.length} oefeningen hebben een standaard. Zelfcontrole OK.`);
