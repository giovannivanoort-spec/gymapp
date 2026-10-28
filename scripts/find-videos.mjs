// Zoekt per oefening een korte YouTube-uitlegvideo en schrijft src/lib/exercise-videos.json.
//
//   node scripts/find-videos.mjs          alleen oefeningen zonder video
//   node scripts/find-videos.mjs --all    alles opnieuw zoeken
//   node scripts/find-videos.mjs slug-1   alleen deze oefening(en)
//
// Per oefening worden de zoekresultaten gescoord op titel-overeenkomst, lengte en views,
// en via YouTube oEmbed gecontroleerd of de video bestaat en ingesloten mag worden.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/lib/exercise-videos.json");
const SOURCES = [
  "exercises.ts",
  "exercises-upper.ts",
  "exercises-lower.ts",
].map((f) => join(root, "src/lib", f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.filter((a) => !a.startsWith("--"));

const exercises = [];
for (const file of SOURCES) {
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  const re =
    /slug:\s*"([^"]+)",\s*name:\s*"([^"]+)"[\s\S]*?videoQuery:\s*"([^"]+)"/g;
  for (const m of src.matchAll(re))
    exercises.push({ slug: m[1], name: m[2], query: m[3] });
}

const videos = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = exercises.filter((e) =>
  only.length ? only.includes(e.slug) : all || !videos[e.slug],
);
console.log(`${exercises.length} oefeningen, ${todo.length} te zoeken`);

// Gerichtere zoekopdracht voor oefeningen waar de standaardzoekterm een minder goede video gaf.
const QUERY_OVERRIDES = {
  "back-squat": "jeff nippard how to squat perfect technique",
  "push-up": "how to do a push up proper form tutorial",
  "triceps-pushdown-rope": "rope tricep pushdown proper form",
  "lying-hip-raise": "lying hip raise abs exercise hips off floor",
  "high-to-low-cable-fly": "high to low cable fly crossover lower chest",
};

const STOP = new Set([
  "the",
  "a",
  "and",
  "with",
  "on",
  "of",
  "to",
  "how",
  "do",
  "proper",
  "form",
  "tutorial",
  "exercise",
]);
const tokens = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

function parseDuration(text) {
  if (!text) return null;
  return text.split(":").reduce((s, p) => s * 60 + Number(p), 0);
}

function parseViews(text) {
  const n = Number((text || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Cookie-toestemming meesturen; anders stuurt YouTube (vanuit de EU) door naar consent.youtube.com.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "SOCS=CAI; CONSENT=YES+cb",
};

async function fetchRetry(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, { headers: HEADERS });
    } catch (err) {
      if (i >= tries) throw err;
      await sleep(3000 * i);
    }
  }
}

async function search(query) {
  const res = await fetchRetry(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`,
  );
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      out.push({
        id: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join("") ?? "",
        channel: v.ownerText?.runs?.[0]?.text ?? "",
        seconds: parseDuration(v.lengthText?.simpleText),
        views: parseViews(v.viewCountText?.simpleText),
      });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

function score(ex, v, rank) {
  if (!v.seconds || v.seconds < 15 || v.seconds > 600) return -Infinity;
  const stem = (t) => t.replace(/s$/, "");
  const have = new Set(tokens(v.title).map(stem));
  // Zowel "Opdrukken" als het deel tussen haakjes ("push-up") mag overeenkomen.
  const inParens = ex.name.match(/\((.*?)\)/)?.[1];
  const match = Math.max(
    ...[ex.name, inParens].filter(Boolean).map((n) => {
      const want = tokens(n).map(stem);
      return want.length ? want.filter((t) => have.has(t)).length / want.length : 0;
    }),
  );
  if (match < 0.5) return -Infinity;
  const lengthScore = v.seconds <= 300 ? 1 : v.seconds <= 600 ? 0.4 : 0;
  return match * 3 + Math.log10(v.views + 10) / 2 + lengthScore - rank * 0.15;
}

async function embeddable(id) {
  const res = await fetchRetry(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
  );
  return res.ok;
}

const usedBy = (id, slug) => Object.entries(videos).some(([k, v]) => k !== slug && v.id === id);
const missing = [];

for (const [i, ex] of todo.entries()) {
  let pick = null;
  try {
    for (const query of [QUERY_OVERRIDES[ex.slug] ?? ex.query, `how to ${ex.name} exercise form`]) {
      const results = (await search(query)).slice(0, 12);
      const ranked = results
        .map((v, rank) => ({ v, s: score(ex, v, rank) }))
        .filter((x) => x.s > -Infinity)
        // Liever een video die nog niet bij een andere oefening hoort.
        .map((x) => (usedBy(x.v.id, ex.slug) ? { ...x, s: x.s - 2 } : x))
        .sort((a, b) => b.s - a.s);
      for (const { v } of ranked.slice(0, 3)) {
        if (await embeddable(v.id)) {
          pick = v;
          break;
        }
      }
      if (pick) break;
      await sleep(400);
    }
  } catch (err) {
    console.log(`   fout bij ${ex.slug}: ${err.cause?.message ?? err.message}`);
  }
  if (pick) {
    videos[ex.slug] = {
      id: pick.id,
      title: pick.title,
      channel: pick.channel,
      seconds: pick.seconds,
    };
    console.log(
      `${i + 1}/${todo.length} ✓ ${ex.slug} → ${pick.title} [${pick.channel}]`,
    );
  } else {
    missing.push(ex.slug);
    console.log(`${i + 1}/${todo.length} ✗ ${ex.slug}`);
  }
  // Tussentijds opslaan zodat een onderbreking geen werk kost.
  writeFileSync(OUT, JSON.stringify(sortKeys(videos), null, 2) + "\n");
  await sleep(900);
}

function sortKeys(o) {
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
}

console.log(
  `Klaar. ${Object.keys(videos).length} video's, ${missing.length} niet gevonden${missing.length ? ": " + missing.join(", ") : ""}`,
);
