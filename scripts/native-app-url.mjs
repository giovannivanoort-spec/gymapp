// Schrijft native/www/app-url.js: het adres van de site voor de knop "Opnieuw proberen" op het
// offline-scherm van de Android-app. Zelfde regel als capacitor.config.ts:
// CAP_SERVER_URL als die gezet is, anders DEFAULT_SERVER_URL uit capacitor.config.ts.
// Draait automatisch bij `npm run cap:sync`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(root, "capacitor.config.ts"), "utf8");
const fallback = /DEFAULT_SERVER_URL\s*=\s*"([^"]+)"/.exec(config)?.[1];
const url = process.env.CAP_SERVER_URL || fallback;

if (!url || !/^https:\/\/[^\s"'<>]+$/.test(url)) {
  console.error(`Ongeldig server-adres: ${url ?? "(leeg)"}. Gebruik een https-adres.`);
  process.exit(1);
}

const out = join(root, "native", "www", "app-url.js");
writeFileSync(
  out,
  `// Gemaakt door scripts/native-app-url.mjs (npm run cap:sync). Niet met de hand aanpassen.\nwindow.SPOTTER_APP_URL = ${JSON.stringify(url)};\n`,
);
console.log(`Offline-scherm wijst naar ${url}`);
