// Haalt krachtstandaarden per oefening op van StrengthLevel.com en schrijft src/lib/strength-standards.json.
//
//   node scripts/fetch-standards.mjs          alleen oefeningen die nog ontbreken
//   node scripts/fetch-standards.mjs --all    alles opnieuw
//   node scripts/fetch-standards.mjs slug-1   alleen deze oefening(en)
//
// Per oefening en geslacht: een tabel per lichaamsgewicht met de grenzen voor
// Beginner, Novice, Intermediate, Advanced en Elite (1RM in kg, of reps bij lichaamsgewicht-oefeningen).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/lib/strength-standards.json");
const SOURCES = ["exercises.ts", "exercises-upper.ts", "exercises-lower.ts"].map((f) => join(root, "src/lib", f));

/**
 * Onze slug → StrengthLevel-slug, waar de namen verschillen.
 * `null` = bewust geen rang (geen betrouwbare, gelijkwaardige standaard).
 */
const MAP = {
  "back-squat": "squat",
  "barbell-row": "bent-over-row",
  "overhead-press": "overhead-press",
  "chin-up": "chin-ups",
  "pull-up": "pull-ups",
  "push-up": "push-ups",
  "neutral-grip-pull-up": "neutral-grip-pull-ups",
  "diamond-push-up": "diamond-push-ups",
  "trap-bar-deadlift": "hex-bar-deadlift",
  "leg-press": "sled-leg-press",
  "chest-press-machine": "chest-press",
  "triceps-pushdown-bar": "tricep-pushdown",
  "triceps-pushdown-rope": "tricep-rope-pushdown",
  "skull-crusher": "lying-tricep-extension",
  "incline-dumbbell-press": "incline-dumbbell-bench-press",
  "bulgarian-split-squat": "dumbbell-bulgarian-split-squat",
  "lateral-raise": "dumbbell-lateral-raise",
  "front-raise": "dumbbell-front-raise",
  "reverse-fly": "dumbbell-reverse-fly",
  "crunch": "crunches",
  "sit-up": "sit-ups",
  "hip-adduction-machine": "hip-adduction",
  "hip-abduction-machine": "hip-abduction",
  "pec-deck": "machine-chest-fly",
  "standing-calf-raise": "machine-calf-raise",
  "seated-calf-raise": "seated-machine-calf-raise",
  "dumbbell-row": "dumbbell-row",
  "concentration-curl": "dumbbell-concentration-curl",
  "incline-dumbbell-curl": "incline-dumbbell-curl",
  "cable-curl": "cable-bicep-curl",
  "overhead-cable-triceps-extension": "cable-overhead-tricep-extension",
  "dumbbell-overhead-triceps-extension": "dumbbell-tricep-extension",
  "cable-lateral-raise": "cable-lateral-raise",
  "barbell-shrug": "barbell-shrug",
  "wrist-curl": "barbell-wrist-curl",
  "reverse-wrist-curl": "barbell-reverse-wrist-curl",
  "walking-lunge": "dumbbell-lunge",
  "goblet-squat": "goblet-squat",
  "bodyweight-squat": "bodyweight-squat",
  "machine-row": "machine-row",
  // Eenbenige variant is veel lichter dan de gewone RDL: geen eerlijke vergelijking.
  "single-leg-romanian-deadlift": null,
  "dumbbell-romanian-deadlift": "dumbbell-romanian-deadlift",
  "cable-triceps-kickback": "cable-tricep-kickback",
  "dumbbell-kickback": "dumbbell-tricep-kickback",
  "cable-kickback": "cable-glute-kickback",
  "rope-hammer-curl": "cable-hammer-curl",
  "machine-bicep-curl": "machine-bicep-curl",
  "machine-dip": "seated-dip-machine",
  "assisted-pull-up-machine": null,
  // Op tijd gemeten bij StrengthLevel; wij loggen geen tijd.
  plank: null,
  "side-plank": null,
  "overhead-press": ["military-press", "overhead-press"],
  "seated-calf-raise": ["seated-calf-raise", "seated-machine-calf-raise"],
  "wrist-curl": ["dumbbell-wrist-curl", "wrist-curl"],
  "reverse-wrist-curl": ["dumbbell-reverse-wrist-curl", "reverse-wrist-curl"],
  "reverse-curl": ["reverse-barbell-curl", "reverse-curl", "ez-bar-reverse-curl"],
  "incline-chest-press-machine": ["incline-chest-press", "machine-incline-chest-press"],
  "smith-machine-incline-press": ["smith-machine-incline-bench-press", "smith-machine-incline-press"],
  "reverse-pec-deck": ["reverse-machine-fly", "machine-reverse-fly"],
  "cable-rear-delt-fly": ["cable-reverse-fly", "cable-rear-delt-fly"],
  "trap-bar-shrug": ["hex-bar-shrug", "trap-bar-shrug"],
  "drag-curl": ["drag-curl", "barbell-drag-curl"],
  "cable-preacher-curl": ["cable-preacher-curl"],
  "step-up": ["dumbbell-step-up", "step-up", "barbell-step-up"],
  "reverse-lunge": ["dumbbell-reverse-lunge", "reverse-lunge", "barbell-reverse-lunge"],
  "lateral-lunge": ["dumbbell-lateral-lunge", "lateral-lunge"],
  "glute-bridge": ["glute-bridge", "barbell-glute-bridge"],
  "single-leg-calf-raise": ["single-leg-calf-raise", "one-leg-calf-raise"],
  "kettlebell-swing": ["kettlebell-swing"],
  "neutral-grip-pull-up": "neutral-grip-pull-ups",
  "inverted-row": ["inverted-row", "inverted-rows"],
  "bench-dips": ["bench-dips", "bench-dip"],
  "pike-push-up": ["pike-push-ups", "pike-push-up"],
  "decline-push-up": ["decline-push-ups", "decline-push-up"],
  "incline-push-up": ["incline-push-ups", "incline-push-up"],
  "hanging-leg-raise": ["hanging-leg-raises", "hanging-leg-raise"],
  "toes-to-bar": ["toes-to-bar"],
  "nordic-hamstring-curl": ["nordic-hamstring-curl", "nordic-curl"],
  "back-extension": ["back-extension", "back-extensions"],
  "pistol-squat": ["pistol-squat", "pistol-squats"],
  "bodyweight-squat": "bodyweight-squat",
  "reverse-crunch": ["reverse-crunches", "reverse-crunch"],
  "lying-leg-raise": ["lying-leg-raises", "lying-leg-raise", "leg-raises"],
  "v-up": ["v-ups", "v-up"],
  "russian-twist": ["russian-twist", "russian-twists"],
  "bicycle-crunch": ["bicycle-crunches", "bicycle-crunch"],
  "mountain-climber": ["mountain-climbers"],
  "decline-sit-up": ["decline-sit-up", "decline-sit-ups"],
  "machine-crunch": ["machine-crunch", "ab-crunch-machine"],
  "cable-kickback": ["cable-kickback", "cable-glute-kickback"],
  "cable-triceps-kickback": ["cable-tricep-kickback"],
  "single-arm-cable-pushdown": ["one-arm-cable-pushdown", "single-arm-tricep-pushdown"],
  "reverse-grip-pushdown": ["reverse-grip-tricep-pushdown"],
  "dumbbell-skull-crusher": ["dumbbell-skull-crusher", "dumbbell-lying-tricep-extension"],
  "leg-press-calf-raise": ["leg-press-calf-raise", "calf-press"],
  // Bij StrengthLevel in reps zonder gewicht; wij loggen deze met gewicht.
  "donkey-calf-raise": null,
  "sissy-squat": ["sissy-squat"],
  "single-arm-lat-pulldown": ["one-arm-lat-pulldown", "single-arm-lat-pulldown"],
  "single-arm-cable-row": ["one-arm-cable-row", "single-arm-cable-row"],
  "seal-row": ["seal-row"],
  "kroc-row": ["kroc-row"],
  "svend-press": ["svend-press"],
  "cable-front-raise": ["cable-front-raise"],
  "high-cable-curl": ["high-cable-curl", "overhead-cable-curl"],
  "cross-body-hammer-curl": ["cross-body-hammer-curl"],
  "single-leg-hip-thrust": ["single-leg-hip-thrust"],
  "b-stance-hip-thrust": null,
  "single-leg-leg-press": ["single-leg-leg-press"],
  "pendulum-squat": ["pendulum-squat"],
  "glute-ham-raise": ["glute-ham-raise"],
  "reverse-hyperextension": null,
  "jump-squat": ["jump-squat"],
  "curtsy-lunge": ["curtsy-lunge"],
};

const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.filter((a) => !a.startsWith("--"));

const exercises = [];
for (const file of SOURCES) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/slug:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*equipment:\s*"([^"]+)"/g)) {
    exercises.push({ slug: m[1], name: m[2], equipment: m[3] });
  }
}

const data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = exercises.filter((e) => (only.length ? only.includes(e.slug) : all || !(e.slug in data)));
console.log(`${exercises.length} oefeningen, ${todo.length} te doen`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36" };

function candidates(e) {
  if (e.slug in MAP) return MAP[e.slug] ? [MAP[e.slug]].flat() : [];
  const s = e.slug;
  const c = [s, `${s}s`, s.replace("triceps", "tricep")];
  // Bij dumbbell-oefeningen eerst de dumbbell-variant proberen.
  if (e.equipment === "dumbbell" && !s.startsWith("dumbbell")) c.unshift(`dumbbell-${s}`);
  if (e.equipment === "machine" && !s.startsWith("machine")) c.push(`machine-${s}`);
  if (e.equipment === "cable" && !s.startsWith("cable")) c.push(`cable-${s}`);
  if (e.equipment === "barbell" && !s.startsWith("barbell")) c.push(`barbell-${s}`);
  return [...new Set(c)];
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

const BW_HEAD = "By Bodyweight BW Beg. Nov. Int. Adv. Elite";
const AGE_HEAD = "By Age Age Beg. Nov. Int. Adv. Elite";

/**
 * Alle tabellen met deze kop, in volgorde van de pagina. Leest getallen tot het eerste woord
 * dat geen getal is. Waarden als "< 1" → 0, "+7 kg" → 7.
 */
function parseTables(t, head) {
  const tables = [];
  let from = 0;
  for (;;) {
    const start = t.indexOf(head, from);
    if (start < 0) break;
    const tokens = t
      .slice(start + head.length, start + head.length + 2500)
      .replace(/<\s*1/g, "0")
      .replace(/\bkg\b/g, "")
      .replace(/\+/g, "")
      .trim()
      .split(/\s+/);
    const body = [];
    for (const tok of tokens) {
      const n = Number(tok);
      if (tok === "" || Number.isNaN(n)) break;
      body.push(n);
    }
    const rows = [];
    for (let i = 0; i + 5 < body.length; i += 6) rows.push(body.slice(i, i + 6));
    tables.push(rows);
    from = start + head.length;
  }
  return tables.filter((rows) => rows.length >= 3);
}

async function fetchStandard(slug) {
  const res = await fetch(`https://strengthlevel.com/strength-standards/${slug}/kg`, { headers: HEADERS, redirect: "manual" });
  if (res.status !== 200) return null;
  const t = text(await res.text());
  const title = t.match(/See All Calculators (.+?) Standards \(kg\)/)?.[1]?.trim();
  const implement = /Dumbbell weights are for one dumbbell/.test(t) ? "dumbbell" : /Barbell weights include/.test(t) ? "barbell" : "other";
  const tables = parseTables(t, BW_HEAD);
  // Zelfde volgorde als de lichaamsgewicht-tabellen; waarden bij gemiddeld lichaamsgewicht per leeftijd.
  const ages = parseTables(t, AGE_HEAD);
  if (/average rep count/i.test(t)) {
    // Lichaamsgewicht: [man reps, man extra kg, vrouw reps, vrouw extra kg], of alleen [man reps, vrouw reps].
    if (tables.length >= 4) {
      return {
        source: slug, title, implement, unit: "reps",
        male: tables[0], female: tables[2], maleAdded: tables[1], femaleAdded: tables[3],
        ...(ages.length >= 4 && { ageMale: ages[0], ageFemale: ages[2], ageMaleAdded: ages[1], ageFemaleAdded: ages[3] }),
      };
    }
    if (tables.length >= 2) {
      return {
        source: slug, title, implement, unit: "reps", male: tables[0], female: tables[1],
        ...(ages.length >= 2 && { ageMale: ages[0], ageFemale: ages[1] }),
      };
    }
    return null;
  }
  // Oefeningen die in tijd gemeten worden (bijv. plank) kunnen we niet vergelijken: wij loggen reps en kg.
  if (/average time|seconds/i.test(t) && !/1RM/.test(t)) return null;
  if (tables.length < 2) return null;
  return {
    source: slug, title, implement, unit: "kg", male: tables[0], female: tables[1],
    ...(ages.length >= 2 && { ageMale: ages[0], ageFemale: ages[1] }),
  };
}

/** Klopt het materiaal/de meetwijze van de standaard met hoe wij de oefening loggen? */
function compatible(e, std) {
  if (SAME_EXERCISE.has(e.slug)) return true;
  if (std.unit === "reps") return e.equipment === "bodyweight" || REPS_OK.has(e.slug);
  const dumbbellLike = e.equipment === "dumbbell" || e.equipment === "kettlebell";
  const barbellLike = e.equipment === "barbell" || e.equipment === "ez_bar";
  if (std.implement === "dumbbell") return dumbbellLike;
  if (std.implement === "barbell") return barbellLike;
  return !dumbbellLike && !barbellLike;
}
/** Lichaamsgewicht-oefeningen die bij ons als machine staan (de machine is alleen de houder). */
/** Exact dezelfde oefening, alleen anders gelabeld (Smith machine = barbell in de machine, trap bar = hex bar). */
const SAME_EXERCISE = new Set(["smith-machine-bench-press", "smith-machine-squat", "trap-bar-deadlift"]);
const REPS_OK = new Set(["glute-ham-raise", "hanging-leg-raise", "captains-chair-leg-raise", "back-extension"]);

for (const [i, e] of todo.entries()) {
  let found = null;
  for (const c of candidates(e)) {
    let std = null;
    try {
      std = await fetchStandard(c);
    } catch (err) {
      console.log(`   fout bij ${c}: ${err.message}`);
    }
    await sleep(1100);
    if (std && !compatible(e, std)) {
      console.log(`   ${e.slug}: ${c} afgewezen (${std.implement}/${std.unit} past niet bij ${e.equipment})`);
      continue;
    }
    if (std) {
      found = std;
      break;
    }
  }
  data[e.slug] = found;
  console.log(`${i + 1}/${todo.length} ${found ? "✓" : "–"} ${e.slug}${found ? ` → ${found.source} (${found.title}, ${found.unit})` : ""}`);
  writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(data).sort()), null, 0) + "\n");
}

const matched = Object.values(data).filter(Boolean).length;
console.log(`Klaar: ${matched} van ${Object.keys(data).length} oefeningen hebben een standaard.`);
