// Controleert de spierchips (MuscleTag) na een wijziging van de spiertokens of de chiptint:
//   node scripts/check-muscle-contrast.mjs
// Leest de kleuren uit src/app/globals.css en de tintpercentages uit src/components/MuscleChips.tsx,
// en eist WCAG AA (4,5:1) voor de chiptekst op bg, surface en surface-2. Daarnaast moet muscle-ink
// duidelijk van danger verschillen (afstand in OKLab), zodat een spierchip niet als fout leest.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(`${root}src/app/globals.css`, "utf8");
const chips = readFileSync(`${root}src/components/MuscleChips.tsx`, "utf8");

const AA = 4.5;
/** Minimale afstand in OKLab tussen muscle-ink en danger (0,02 is nauwelijks te zien). */
const MIN_DISTANCE_FROM_DANGER = 0.07;

function token(name) {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`Token --color-${name} niet gevonden als #rrggbb in globals.css`);
  return m[1];
}

function tint(cls) {
  const m = chips.match(new RegExp(`\\b${cls}/(\\d+)\\b`));
  if (!m) throw new Error(`Klasse ${cls}/<percentage> niet gevonden in MuscleChips.tsx`);
  return Number(m[1]) / 100;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const linear = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Kleur `fg` met dekking `alpha` over `bg`, zoals de browser bg-x/NN tekent. */
const over = (fg, alpha, bg) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

function oklab(color) {
  const [r, g, b] = color.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const distance = (a, b) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]));

const surfaces = { bg: token("bg"), surface: token("surface"), "surface-2": token("surface-2") };
const checks = [
  { label: "Hoofdspier (muscle-ink op muscle)", text: token("muscle-ink"), chip: token("muscle"), alpha: tint("bg-muscle") },
  { label: "Helpt mee (muted op muscle-help)", text: token("muted"), chip: token("muscle-help"), alpha: tint("bg-muscle-help") },
];

let failed = false;
for (const c of checks) {
  for (const [name, surface] of Object.entries(surfaces)) {
    const ratio = contrast(rgb(c.text), over(rgb(c.chip), c.alpha, rgb(surface)));
    const ok = ratio >= AA;
    failed ||= !ok;
    console.log(`${ok ? "OK  " : "FOUT"} ${c.label}, ${Math.round(c.alpha * 100)}% tint op ${name}: ${ratio.toFixed(2)}:1`);
  }
}

const gap = distance(rgb(token("muscle-ink")), rgb(token("danger")));
const gapOk = gap >= MIN_DISTANCE_FROM_DANGER;
failed ||= !gapOk;
console.log(`${gapOk ? "OK  " : "FOUT"} Afstand muscle-ink tot danger (OKLab): ${gap.toFixed(3)} (minimaal ${MIN_DISTANCE_FROM_DANGER})`);

process.exit(failed ? 1 : 0);
