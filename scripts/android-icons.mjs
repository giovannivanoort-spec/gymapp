// Maakt de app-iconen en het opstartscherm van de Android-app uit de huisstijl van Spotter
// (zelfde halter als public/icon.svg, accent #c8f53a op #0b0d10). Draait zonder netwerk.
//
//   npm run android:icons
//
// Gebruikt sharp (komt mee met Next.js). Ontbreekt sharp, gebruik dan in Android Studio:
// rechtsklik op app > New > Image Asset (zie docs/android-app.md).
//
// Schrijft naar android/app/src/main/res:
// - mipmap-*/ic_launcher.png         klassiek icoon (afgeronde tegel), uit public/icons/icon-512.png
// - mipmap-*/ic_launcher_round.png   rond icoon, uit public/icons/maskable-512.png
// - mipmap-*/ic_launcher_foreground.png  voorgrond van het adaptieve icoon (alleen de halter, transparant)
// - mipmap-anydpi-v26/ic_launcher(.xml|_round.xml)  adaptief icoon + monochroom (Android 13 thema-iconen)
// - drawable*/splash.png              opstartscherm (Android 11 en ouder), donkere achtergrond met logo
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp is niet gevonden. Maak de iconen in Android Studio via New > Image Asset.");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "android", "app", "src", "main", "res");
if (!existsSync(res)) {
  console.error("android/ bestaat nog niet. Draai eerst: npx cap add android");
  process.exit(1);
}

const BG = "#0b0d10";
const ACCENT = "#c8f53a";
const ICON = join(root, "public", "icons", "icon-512.png");
const MASKABLE = join(root, "public", "icons", "maskable-512.png");

/** De halter uit public/icon.svg (in een vlak van 512 × 512, breed 96..416, hoog 176..336). */
const DUMBBELL = `
  <rect x="96" y="176" width="48" height="160" rx="14"/>
  <rect x="368" y="176" width="48" height="160" rx="14"/>
  <rect x="152" y="208" width="36" height="96" rx="10"/>
  <rect x="324" y="208" width="36" height="96" rx="10"/>
  <rect x="188" y="240" width="136" height="32" rx="8"/>`;

/**
 * Halter gecentreerd op een vierkant van `size` px, `share` = breedte van de halter t.o.v. het vlak.
 * Adaptieve iconen: 108dp-vlak, alleen de middelste cirkel van 66dp is altijd zichtbaar. Met share 0.5
 * valt de halter (54 × 27dp) daar ruim binnen.
 */
function dumbbellSvg(size, share, background) {
  const scale = (size * share) / 320;
  const tx = size / 2 - 256 * scale;
  const ty = size / 2 - 256 * scale;
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}` +
      `<g fill="${ACCENT}" transform="translate(${tx} ${ty}) scale(${scale})">${DUMBBELL}</g></svg>`,
  );
}

const DENSITIES = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

function out(dir, file) {
  const d = join(res, dir);
  mkdirSync(d, { recursive: true });
  return join(d, file);
}

const circle = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

for (const [name, f] of DENSITIES) {
  const legacy = Math.round(48 * f);
  const fg = Math.round(108 * f);
  await sharp(ICON).resize(legacy, legacy).png().toFile(out(`mipmap-${name}`, "ic_launcher.png"));
  await sharp(MASKABLE)
    .resize(legacy, legacy)
    .composite([{ input: circle(legacy), blend: "dest-in" }])
    .png()
    .toFile(out(`mipmap-${name}`, "ic_launcher_round.png"));
  await sharp(dumbbellSvg(fg, 0.5)).png().toFile(out(`mipmap-${name}`, "ic_launcher_foreground.png"));
}

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
writeFileSync(out("mipmap-anydpi-v26", "ic_launcher.xml"), adaptive);
writeFileSync(out("mipmap-anydpi-v26", "ic_launcher_round.xml"), adaptive);
writeFileSync(
  out("values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG}</color>
</resources>
`,
);

// Opstartschermen (Android 11 en ouder; vanaf Android 12 tekent het systeem zelf, zie styles.xml).
const SPLASH = [
  ["drawable", 480, 320],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
];
for (const [dir, w, h] of SPLASH) {
  const logo = Math.round(Math.min(w, h) * 0.32);
  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: await sharp(ICON).resize(logo, logo).png().toBuffer(), gravity: "center" }])
    .png()
    .toFile(out(dir, "splash.png"));
}

console.log("Android-iconen en opstartschermen gemaakt in android/app/src/main/res");
