// Bouwt de debug-APK van de Android-app: npm run android:build
//
// 1. Controleert dat AndroidManifest.xml alle gezondheidsrechten van @capgo/capacitor-health verwijdert,
//    op READ_STEPS en READ_ACTIVE_CALORIES_BURNED na (anders keurt de Play-beoordeling de app af).
// 2. native/www/app-url.js bijwerken en `cap sync android` (config, plugins, offline-scherm).
// 3. gradlew assembleDebug in android/, met een JDK 21 t/m 25 (Gradle 9.2 draait op Java 25) en
//    de Android SDK uit %LOCALAPPDATA%\Android\Sdk als ANDROID_HOME niet gezet is.
//
// Java: JAVA_HOME als die een JDK 21 t/m 25 is, anders de eerste geschikte uit %USERPROFILE%\.jdks
// (Android Studio: Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK >
// Download JDK > versie 21), Eclipse Adoptium, Microsoft, en als laatste de Java van Android Studio (jbr).
// De jbr van Android Studio 2026.2 (Java 25) werkt: de Gradle-wrapper staat op 9.2.1.
//
// Resultaat: android/app/build/outputs/apk/debug/app-debug.apk
// Andere locaties: zet JAVA_HOME en/of ANDROID_HOME zelf, of maak android/local.properties met sdk.dir=...
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(root, "android");
const win = process.platform === "win32";
const env = { ...process.env };

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p));
}

// ─────────────── 1. Gezondheidsrechten in het manifest ───────────────

/** Gezondheidsrechten die de app echt gebruikt. Moet gelijk zijn aan de Health apps-verklaring in de Play Console. */
const KEEP_HEALTH = new Set(["android.permission.health.READ_STEPS", "android.permission.health.READ_ACTIVE_CALORIES_BURNED"]);

function healthPermissions(xml) {
  return [...xml.matchAll(/<uses-permission\b[^>]*>/g)]
    .map((m) => m[0])
    .map((tag) => ({ name: /android:name="([^"]+)"/.exec(tag)?.[1] ?? "", remove: /tools:node="remove"/.test(tag) }))
    .filter((p) => p.name.startsWith("android.permission.health."));
}

function checkHealthManifest() {
  const pluginManifest = join(root, "node_modules", "@capgo", "capacitor-health", "android", "src", "main", "AndroidManifest.xml");
  const appManifest = join(android, "app", "src", "main", "AndroidManifest.xml");
  if (!existsSync(pluginManifest)) {
    console.error("@capgo/capacitor-health ontbreekt. Draai eerst npm install.");
    process.exit(1);
  }
  const plugin = new Set(healthPermissions(readFileSync(pluginManifest, "utf8")).map((p) => p.name));
  const app = healthPermissions(readFileSync(appManifest, "utf8"));
  const removed = new Set(app.filter((p) => p.remove).map((p) => p.name));
  const kept = new Set(app.filter((p) => !p.remove).map((p) => p.name));

  const problems = [];
  for (const name of plugin) {
    if (!removed.has(name) && !KEEP_HEALTH.has(name)) problems.push(`niet verwijderd: ${name}`);
  }
  for (const name of removed) {
    if (!plugin.has(name)) problems.push(`verwijderd maar bestaat niet in de plugin (tikfout?): ${name}`);
  }
  for (const name of kept) {
    if (!KEEP_HEALTH.has(name)) problems.push(`onverwacht gevraagd: ${name}`);
  }
  for (const name of KEEP_HEALTH) {
    if (!kept.has(name)) problems.push(`ontbreekt: ${name}`);
  }
  if (problems.length) {
    console.error("AndroidManifest.xml klopt niet met de gezondheidsrechten van @capgo/capacitor-health:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Pas de lijst met tools:node=\"remove\" in android/app/src/main/AndroidManifest.xml aan.");
    process.exit(1);
  }
  console.log(`Gezondheidsrechten: ${[...KEEP_HEALTH].map((n) => n.replace("android.permission.health.", "")).join(", ")} (${removed.size} van de plugin verwijderd).`);
}

checkHealthManifest();

// ─────────────── Java (JDK 21 t/m 25) ───────────────

const JAVA_MIN = 21;
const JAVA_MAX = 25;

/** Hoofdversie uit <jdk>/release (JAVA_VERSION="21.0.8" → 21), of null. */
function javaMajor(home) {
  try {
    const m = /^JAVA_VERSION="(\d+)(?:\.(\d+))?/m.exec(readFileSync(join(home, "release"), "utf8"));
    if (!m) return null;
    const major = Number(m[1]);
    return major === 1 ? Number(m[2]) : major;
  } catch {
    return null;
  }
}

const suitable = (home) => {
  const v = home ? javaMajor(home) : null;
  return v != null && v >= JAVA_MIN && v <= JAVA_MAX;
};

/** Submappen van `dir` die aan `test` voldoen, nieuwste naam eerst. */
function children(dir, test) {
  try {
    return readdirSync(dir)
      .filter(test)
      .sort()
      .reverse()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function javaCandidates() {
  const jdks = join(homedir(), ".jdks");
  const mac = (p) => (process.platform === "darwin" ? join(p, "Contents", "Home") : p);
  const list = [
    // Liefst 21 (waar Capacitor 8 op mikt), daarna 22 t/m 25.
    ...children(jdks, (n) => /(^|[^0-9])21([^0-9]|$)/.test(n)).map(mac),
    ...children(jdks, () => true).map(mac),
  ];
  if (win) {
    list.push(
      ...children("C:\\Program Files\\Eclipse Adoptium", (n) => n.startsWith("jdk-")),
      ...children("C:\\Program Files\\Microsoft", (n) => n.startsWith("jdk-")),
      ...children("C:\\Program Files\\Java", (n) => n.startsWith("jdk")),
      "C:\\Program Files\\Android\\Android Studio\\jbr",
      join(env.LOCALAPPDATA ?? "", "Programs", "Android Studio", "jbr"),
    );
  } else {
    list.push(
      ...children("/Library/Java/JavaVirtualMachines", () => true).map((p) => join(p, "Contents", "Home")),
      ...children("/usr/lib/jvm", () => true),
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
      "/opt/android-studio/jbr",
      join(homedir(), "android-studio", "jbr"),
    );
  }
  return list;
}

if (env.JAVA_HOME && !suitable(env.JAVA_HOME)) {
  const v = javaMajor(env.JAVA_HOME);
  console.warn(`JAVA_HOME (${env.JAVA_HOME}) is Java ${v ?? "onbekend"}; nodig is ${JAVA_MIN} t/m ${JAVA_MAX}. Ik zoek een andere JDK.`);
  delete env.JAVA_HOME;
}
if (!env.JAVA_HOME) {
  const jdk = javaCandidates().find((p) => existsSync(p) && suitable(p));
  if (jdk) env.JAVA_HOME = jdk;
}
if (!env.JAVA_HOME) {
  console.error(
    [
      `Geen geschikte Java gevonden (nodig: JDK ${JAVA_MIN} t/m ${JAVA_MAX}).`,
      "Normaal wordt de Java van Android Studio (jbr) gevonden. Anders kun je JDK 21 installeren:",
      "  Android Studio > Settings > Build, Execution, Deployment > Build Tools > Gradle >",
      "  Gradle JDK > Download JDK... > Version 21 (JetBrains Runtime of Eclipse Temurin) > Download.",
      "  Hij komt in %USERPROFILE%\\.jdks\\ en wordt daarna vanzelf gevonden.",
      "Of zet JAVA_HOME op een JDK 21.",
    ].join("\n"),
  );
  process.exit(1);
}
console.log(`Java ${javaMajor(env.JAVA_HOME)}: ${env.JAVA_HOME}`);

// ─────────────── Android SDK ───────────────

if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && !existsSync(join(android, "local.properties"))) {
  const sdk = firstExisting(
    win ? [join(env.LOCALAPPDATA ?? "", "Android", "Sdk")] : [join(homedir(), "Library", "Android", "sdk"), join(homedir(), "Android", "Sdk")],
  );
  if (!sdk) {
    console.error("Geen Android SDK gevonden. Rond de installatiewizard van Android Studio af, of zet ANDROID_HOME.");
    process.exit(1);
  }
  env.ANDROID_HOME = sdk;
}

// ─────────────── 2 en 3. Sync en bouwen ───────────────

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: win });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("node", [join("scripts", "native-app-url.mjs")], root);
run("npx", ["cap", "sync", "android"], root);
run(win ? `"${join(android, "gradlew.bat")}"` : "./gradlew", ["assembleDebug"], android);

console.log(`\nKlaar: ${join(android, "app", "build", "outputs", "apk", "debug", "app-debug.apk")}`);
