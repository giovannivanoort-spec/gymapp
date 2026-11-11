"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { isNetworkError, StaleDataError, trackStaleResponses } from "./supabase";

/**
 * Kleine cache voor opgehaalde data ("stale-while-revalidate"): een pagina toont direct wat er
 * al bekend is en ververst op de achtergrond. Data blijft bewaard tussen pagina's en (optioneel)
 * op het toestel, zodat de app bij opnieuw openen meteen iets laat zien.
 *
 * Garanties:
 * - Een mislukte fetch overschrijft nooit goede data: de vorige stand blijft staan en de fout is
 *   per sleutel op te vragen (useCachedState), met automatisch opnieuw proberen (oplopende wachttijd).
 * - Een offline kopie van de service worker (header x-sw-cache) telt niet als vers: de vorige data
 *   blijft staan en de status zegt eerlijk "offline".
 * - Een fetch die al liep toen de sleutel ongeldig werd verklaard (bijv. een set gelogd terwijl
 *   de geschiedenis nog onderweg was), schrijft zijn (te oude) antwoord niet weg: er wordt meteen
 *   opnieuw opgehaald, zodat een net gelogde set nooit door een ouder antwoord verdwijnt.
 * - Komt de app terug op de voorgrond of is er weer internet, dan wordt alles wat op het scherm
 *   staat ververst.
 * - Bewaren op het toestel: kleine items in localStorage (direct beschikbaar bij openen), grote
 *   items (zoals een volledige trainingsgeschiedenis) in IndexedDB. localStorage heeft een eigen
 *   budget dat past binnen de ~5 MB van Safari op iPhone, zodat er altijd ruimte blijft voor de
 *   offline wachtrij en de login-sessie.
 * - Meerdere tabbladen/vensters blijven gelijk lopen ("storage"-event en BroadcastChannel).
 * - Na uitloggen (clearCache) kan een fetch die nog liep geen oude data meer terugschrijven.
 * - Het geheugen groeit niet eindeloos: items die al een tijd niet op het scherm stonden, worden
 *   uit het geheugen gehaald (een bewaarde kopie op het toestel blijft).
 */

type Entry = {
  data: unknown;
  /** Tijdstip waarop deze data is opgehaald (ms), 0 als onbekend. */
  at: number;
  /** Verouderd gemarkeerd (invalidate, terug naar de app, offline kopie): opnieuw ophalen. */
  stale?: boolean;
};
type Status = {
  /** Laatste fout (null als de laatste poging lukte). */
  error: unknown;
  /** Tijdstip van de laatste fout (ms), 0 als er geen is. */
  errorAt: number;
  /** Aantal mislukte pogingen op rij (voor de wachttijd tot de volgende poging). */
  failures: number;
  loading: boolean;
};

const IDLE: Status = Object.freeze({ error: null, errorAt: 0, failures: 0, loading: false });

const mem = new Map<string, Entry>();
/** Laatste keer dat een sleutel gelezen of geschreven is (voor het opruimen van het geheugen). */
const touched = new Map<string, number>();
/** Sleutels waarvan we al weten dat ze nergens op het toestel bewaard zijn (scheelt leesacties per render). */
const missing = new Set<string>();
const status = new Map<string, Status>();
/** Lopende fetch per sleutel, met de versie van de sleutel bij het starten. */
const inflight = new Map<string, { p: Promise<unknown>; v: number }>();
const listeners = new Map<string, Set<() => void>>();
/** Versie per sleutel: omhoog bij elke invalidate/removeCached, zodat een lopende fetch weet dat hij te oud is. */
const versions = new Map<string, number>();
/** Sleutels die met removeCached zijn vergeten, met de versie op dat moment. */
const removedAt = new Map<string, number>();
/** Recente invalidate-aanroepen, voor items die nog alleen op het toestel staan. */
let invalidations: { prefix: string; at: number }[] = [];
/** Volgnummer per prefix van de laatste "harde" invalidate (zie invalidate / hardInvalidationSeq). */
const hardSeq = new Map<string, number>();
let seq = 0;
/** Wordt opgehoogd bij clearCache; fetches uit een vorige "generatie" schrijven niets meer weg. */
let generation = 0;

const LS_PREFIX = "gymapp-cache:v1:";
/** Items tot deze grootte (tekens) gaan naar localStorage, grotere naar IndexedDB. */
const LS_ITEM_MAX = 250_000;
/** Zonder IndexedDB: grotere items toch in localStorage, maar nooit groter dan dit. */
const LS_FALLBACK_MAX = 400_000;
/**
 * Totaal budget voor de cache in localStorage. Safari (iPhone, ook als app op het beginscherm)
 * geeft ~5 MB in UTF-16, dus ~2,5 miljoen tekens voor de hele app: ruim de helft blijft vrij voor
 * de login-sessie en de offline wachtrij.
 */
const PERSIST_BUDGET = 1_200_000;
/** Grootste item en totaal budget (tekens) voor IndexedDB. */
const IDB_ITEM_MAX = 8_000_000;
const IDB_BUDGET = 40_000_000;
/** Bewaarde items die langer niet ververst zijn, worden opgeruimd. */
const PERSIST_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
/** Bij terugkeren naar de app: alleen verversen wat ouder is dan dit. */
const FOCUS_MIN_AGE = 5_000;
/** Pas verversen na terugkeren als de app minstens zo lang op de achtergrond stond. */
const HIDDEN_MIN_MS = 30_000;
/** Zo lang wacht een fetch maximaal op het inlezen van een bewaarde kopie uit IndexedDB. */
const WARM_WAIT_MS = 400;
/** Items die zo lang niet op het scherm stonden, gaan uit het geheugen. */
const MEM_IDLE_MS = 10 * 60 * 1000;
/** Cachenamen van de service worker met (gebruikers)data; worden gewist bij uitloggen. */
const SW_DATA_CACHE_PREFIX = "spotter-data";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function versionOf(key: string): number {
  return versions.get(key) ?? 0;
}

function bump(key: string) {
  versions.set(key, versionOf(key) + 1);
}

/** Is dit bewaarde item intussen ongeldig verklaard (bijv. sets gelogd in deze sessie)? */
function invalidatedSince(key: string, at: number): boolean {
  return invalidations.some((inv) => key.startsWith(inv.prefix) && at <= inv.at);
}

// ─────────── localStorage met budget ───────────

/** Leest het tijdstip uit een bewaard item zonder de hele JSON te parsen. */
function readAt(raw: string): number {
  const m = raw.slice(0, 40).match(/^\{"at":(\d+)/) ?? raw.slice(-40).match(/"at":(\d+)\}$/);
  return m ? Number(m[1]) : 0;
}

let index: Map<string, { at: number; size: number }> | null = null;

/** Overzicht van wat er in localStorage staat (eenmalig opgebouwd); verouderde items gaan meteen weg. */
function persistIndex(): Map<string, { at: number; size: number }> {
  if (index) return index;
  index = new Map();
  const ls = storage();
  if (!ls) return index;
  const now = Date.now();
  try {
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (!k?.startsWith(LS_PREFIX)) continue;
      const raw = ls.getItem(k) ?? "";
      const at = readAt(raw);
      if (!at || now - at > PERSIST_MAX_AGE) ls.removeItem(k);
      else index.set(k, { at, size: raw.length });
    }
  } catch {
    // opslag niet beschikbaar
  }
  return index;
}

function removePersisted(storageKey: string) {
  try {
    storage()?.removeItem(storageKey);
  } catch {
    // niets te wissen
  }
  index?.delete(storageKey);
}

/**
 * Ruimt de oudste bewaarde cache-items in localStorage op tot er minstens `chars` tekens vrij
 * zijn gekomen. Bedoeld als noodrem als localStorage vol zit (bijv. voor de offline wachtrij).
 * Geeft terug hoeveel tekens er zijn vrijgemaakt.
 */
export function freePersistedSpace(chars = 250_000, keep?: string): number {
  const idx = persistIndex();
  const order = [...idx.entries()].filter(([k]) => k !== keep).sort((a, b) => a[1].at - b[1].at);
  let freed = 0;
  for (const [k, v] of order) {
    if (freed >= chars) break;
    removePersisted(k);
    freed += v.size;
  }
  return freed;
}

/** Zorgt dat er binnen het budget ruimte is voor `needed` tekens (oudste items eerst weg). */
function fitBudget(needed: number, keep: string) {
  const idx = persistIndex();
  let total = 0;
  for (const [k, v] of idx) if (k !== keep) total += v.size;
  if (total + needed <= PERSIST_BUDGET) return;
  freePersistedSpace(total + needed - PERSIST_BUDGET, keep);
}

/** Schrijft naar localStorage; false als het niet lukte. */
function writeLocal(storageKey: string, raw: string, at: number): boolean {
  const ls = storage();
  if (!ls) return false;
  fitBudget(raw.length, storageKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      ls.setItem(storageKey, raw);
      persistIndex().set(storageKey, { at, size: raw.length });
      return true;
    } catch {
      // Opslag vol (bijv. door andere data): oudste cache-items opruimen en nog één keer proberen.
      if (attempt === 0) freePersistedSpace(raw.length * 2, storageKey);
    }
  }
  // Niet gelukt: liever geen dan een verouderde kopie.
  removePersisted(storageKey);
  return false;
}

// ─────────── IndexedDB voor grote items ───────────

const IDB_NAME = "spotter-cache";
const DATA_STORE = "data";
const META_STORE = "meta";
type IdbRecord = { at: number; raw: string };
type IdbMeta = { key: string; at: number; size: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;
let idbIndexPromise: Promise<Map<string, IdbMeta> | null> | null = null;
/** Ingelezen overzicht van IndexedDB (null zolang het nog niet geladen is). */
let idbIndex: Map<string, IdbMeta> | null = null;
/** Lopende leesacties uit IndexedDB per sleutel. */
const pendingIdb = new Map<string, Promise<void>>();
/** Volgnummer per sleutel van de laatste schrijfactie naar IndexedDB (de laatste wint). */
const idbWrites = new Map<string, number>();
let idbWriteSeq = 0;

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      if (typeof indexedDB === "undefined") return finish(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE);
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
          idbIndexPromise = null;
          idbIndex = null;
        };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
      // Sommige browsers (privévenster) laten open() eeuwig hangen.
      setTimeout(() => finish(null), 3_000);
    } catch {
      finish(null);
    }
  });
  return dbPromise;
}

/** Overzicht van wat er in IndexedDB staat; verouderde items worden meteen opgeruimd. */
function loadIdbIndex(): Promise<Map<string, IdbMeta> | null> {
  if (idbIndexPromise) return idbIndexPromise;
  const gen = generation;
  idbIndexPromise = (async () => {
    const db = await openDb();
    if (!db) return null;
    try {
      const metas = (await reqP(db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll())) as IdbMeta[];
      const map = new Map<string, IdbMeta>();
      const expired: string[] = [];
      const now = Date.now();
      for (const m of metas) {
        if (!m?.key) continue;
        if (!m.at || now - m.at > PERSIST_MAX_AGE) expired.push(m.key);
        else map.set(m.key, m);
      }
      if (expired.length) {
        const tx = db.transaction([DATA_STORE, META_STORE], "readwrite");
        for (const k of expired) {
          tx.objectStore(DATA_STORE).delete(k);
          tx.objectStore(META_STORE).delete(k);
        }
        await txDone(tx).catch(() => {});
      }
      if (gen === generation) idbIndex = map;
      return map;
    } catch {
      return null;
    }
  })();
  return idbIndexPromise;
}

/**
 * Leest een groot item uit IndexedDB in het geheugen en laat de schermen het weten. Met `replace`
 * (een ander tabblad schreef een nieuwere versie) blijft de huidige data staan tot de nieuwere
 * kopie is ingelezen, en wordt die alleen overgenomen als hij echt nieuwer is.
 */
function hydrateFromIdb(key: string, replace = false) {
  if (pendingIdb.has(key)) return;
  const gen = generation;
  const p = (async () => {
    const idx = await loadIdbIndex();
    if (gen !== generation || (!replace && mem.has(key))) return;
    if (!idx?.has(key)) {
      if (!mem.has(key)) missing.add(key);
      return;
    }
    const db = await openDb();
    if (!db) return;
    const rec = (await reqP(db.transaction(DATA_STORE, "readonly").objectStore(DATA_STORE).get(key))) as IdbRecord | undefined;
    // Intussen vers opgehaald of alles gewist: dat gaat voor.
    if (gen !== generation || (!replace && mem.has(key))) return;
    if (!rec || typeof rec.raw !== "string") {
      idx.delete(key);
      if (!mem.has(key)) missing.add(key);
      return;
    }
    const at = Number(rec.at) || 0;
    if (replace) {
      // Een eigen fetch die nu loopt, of data die minstens zo nieuw is, gaat voor.
      const cur = mem.get(key);
      if (inflight.has(key) || (cur && cur.at >= at)) return;
    }
    const parsed = JSON.parse(rec.raw) as { data: unknown };
    mem.set(key, invalidatedSince(key, at) ? { data: parsed.data, at, stale: true } : { data: parsed.data, at });
    touched.set(key, Date.now());
    missing.delete(key);
    notify(key);
  })()
    .catch(() => {
      if (gen === generation && !mem.has(key)) missing.add(key);
    })
    .finally(() => pendingIdb.delete(key));
  pendingIdb.set(key, p);
}

async function idbRemove(keys: string[]) {
  if (!keys.length) return;
  keys.forEach((k) => idbIndex?.delete(k));
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([DATA_STORE, META_STORE], "readwrite");
    for (const k of keys) {
      tx.objectStore(DATA_STORE).delete(k);
      tx.objectStore(META_STORE).delete(k);
    }
    await txDone(tx);
  } catch {
    // niets te wissen
  }
}

/** Schrijft een groot item naar IndexedDB; zonder IndexedDB valt het terug op localStorage. */
async function writeIdb(key: string, raw: string, at: number) {
  const gen = generation;
  const mine = ++idbWriteSeq;
  idbWrites.set(key, mine);
  const db = await openDb();
  const idx = db ? await loadIdbIndex() : null;
  // Uitgelogd of een nieuwere schrijfactie voor deze sleutel: deze overslaan.
  if (gen !== generation || idbWrites.get(key) !== mine) return;
  if (!db || !idx) {
    if (raw.length <= LS_FALLBACK_MAX) writeLocal(LS_PREFIX + key, raw, at);
    return;
  }
  // Budget: de oudste andere items eerst weg.
  let total = 0;
  for (const [k, m] of idx) if (k !== key) total += m.size;
  const evict: string[] = [];
  if (total + raw.length > IDB_BUDGET) {
    for (const [k, m] of [...idx].filter(([k]) => k !== key).sort((a, b) => a[1].at - b[1].at)) {
      if (total + raw.length <= IDB_BUDGET) break;
      evict.push(k);
      total -= m.size;
    }
  }
  try {
    const tx = db.transaction([DATA_STORE, META_STORE], "readwrite");
    for (const k of evict) {
      tx.objectStore(DATA_STORE).delete(k);
      tx.objectStore(META_STORE).delete(k);
    }
    tx.objectStore(DATA_STORE).put({ at, raw } satisfies IdbRecord, key);
    tx.objectStore(META_STORE).put({ key, at, size: raw.length } satisfies IdbMeta, key);
    await txDone(tx);
    evict.forEach((k) => idx.delete(k));
    idx.set(key, { key, at, size: raw.length });
    broadcast({ type: "key", key, at });
  } catch {
    // Opslag vol of geweigerd: liever geen dan een verouderde kopie.
    await idbRemove([key]);
  }
}

function writePersisted(key: string, entry: Entry) {
  const storageKey = LS_PREFIX + key;
  let raw: string;
  try {
    // "at" vooraan, zodat readAt het tijdstip kan lezen zonder alles te parsen.
    raw = JSON.stringify({ at: entry.at, data: entry.data });
  } catch {
    return;
  }
  if (raw.length <= LS_ITEM_MAX) {
    writeLocal(storageKey, raw, entry.at);
    // Een eerdere (grote) versie in IndexedDB is nu verouderd; een schrijfactie die daar nog
    // onderweg is, gaat niet meer door.
    idbWrites.delete(key);
    if (idbIndex?.has(key)) void idbRemove([key]);
    else if (idbIndex === null) {
      void loadIdbIndex().then((idx) => {
        if (idx?.has(key) && !idbWrites.has(key)) void idbRemove([key]);
      });
    }
    return;
  }
  // Groot: naar IndexedDB, een eventuele kleinere oude kopie in localStorage weg.
  removePersisted(storageKey);
  if (raw.length <= IDB_ITEM_MAX) void writeIdb(key, raw, entry.at);
  else void idbRemove([key]);
}

/** Verwijdert de bewaarde kopie van één sleutel, waar die ook staat. */
function removeEverywhere(key: string) {
  removePersisted(LS_PREFIX + key);
  idbWrites.delete(key);
  void idbRemove([key]);
  broadcast({ type: "key", key });
}

// Eenmalig na het opstarten: verouderde items opruimen (bijv. voedingsdagen van weken geleden).
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    persistIndex();
    void loadIdbIndex();
  }, 4_000);
}

// ─────────── Andere tabbladen (IndexedDB heeft geen "storage"-event) ───────────

/** `at`: tijdstip van de data die het andere tabblad net in IndexedDB zette (ontbreekt bij wissen). */
type Broadcast = { type: "key"; key: string; at?: number } | { type: "clear" };
let channel: BroadcastChannel | null = null;
try {
  if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel("spotter-cache");
} catch {
  channel = null;
}

function broadcast(msg: Broadcast) {
  try {
    channel?.postMessage(msg);
  } catch {
    // ander tabblad niet bereikbaar
  }
}

if (channel) {
  channel.onmessage = (e: MessageEvent<Broadcast>) => {
    const msg = e.data;
    if (msg?.type === "clear") {
      const keys = [...mem.keys()];
      mem.clear();
      missing.clear();
      idbIndex = null;
      idbIndexPromise = null;
      keys.forEach(notify);
    } else if (msg?.type === "key" && typeof msg.key === "string") {
      // Een lopende fetch hier schrijft zijn eigen resultaat nog weg; dat is minstens zo vers.
      idbIndexPromise = null;
      idbIndex = null;
      if (inflight.has(msg.key)) return;
      const cur = mem.get(msg.key);
      if (cur && typeof msg.at === "number") {
        // Het andere tabblad schreef nieuwe data. De huidige data niet weggooien (dan zou dit
        // tabblad zelf opnieuw ophalen en wegschrijven, waarop het andere tabblad weer ophaalt,
        // enzovoort), maar de nieuwere kopie inlezen en pas overnemen als die echt nieuwer is.
        if (cur.at < msg.at) hydrateFromIdb(msg.key, true);
        return;
      }
      mem.delete(msg.key);
      missing.delete(msg.key);
      notify(msg.key);
    }
  };
}

// ─────────── Geheugen + abonnees ───────────

function load(key: string): Entry | undefined {
  const hit = mem.get(key);
  if (hit) {
    touched.set(key, Date.now());
    return hit;
  }
  if (missing.has(key) || pendingIdb.has(key)) return undefined;
  try {
    const raw = storage()?.getItem(LS_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as Entry;
      const at = Number(parsed.at) || 0;
      const entry: Entry = invalidatedSince(key, at) ? { data: parsed.data, at, stale: true } : { data: parsed.data, at };
      mem.set(key, entry);
      touched.set(key, Date.now());
      return entry;
    }
  } catch {
    // geen opslag beschikbaar of onleesbaar item
  }
  // Niet in localStorage: misschien een groot item in IndexedDB (komt asynchroon binnen).
  if (typeof window !== "undefined" && (idbIndex === null || idbIndex.has(key))) hydrateFromIdb(key);
  else missing.add(key);
  return undefined;
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function setStatus(key: string, patch: Partial<Status>, silent = false) {
  status.set(key, { ...(status.get(key) ?? IDLE), ...patch });
  if (!silent) notify(key);
}

/** Is er data die jonger is dan `maxAge` ms en niet verouderd gemarkeerd? */
function isFresh(e: Entry | undefined, maxAge: number): boolean {
  return !!e && !e.stale && e.at > 0 && Date.now() - e.at < maxAge;
}

export function getCached<T>(key: string): T | undefined {
  return load(key)?.data as T | undefined;
}

/** Wanneer deze sleutel voor het laatst is opgehaald (ms), 0 als verouderd, -1 als onbekend. */
export function getCachedAt(key: string): number {
  const e = load(key);
  if (!e) return -1;
  return e.stale ? 0 : e.at;
}

let writesSinceSweep = 0;

export function setCached<T>(key: string, data: T, persist = false) {
  const entry: Entry = { data, at: Date.now() };
  mem.set(key, entry);
  touched.set(key, entry.at);
  missing.delete(key);
  removedAt.delete(key);
  if (persist) writePersisted(key, entry);
  notify(key);
  if (++writesSinceSweep >= 100) sweepMemory();
}

/**
 * Wel of niet op het toestel bewaren. Als functie wordt het pas na het ophalen bepaald, met de
 * opgehaalde data (bijv. alleen de eigen geschiedenis volledig bewaren, als bekend is wie er
 * ingelogd is).
 */
export type Persist = boolean | ((data: unknown) => boolean);

/**
 * Haalt data op (één verzoek tegelijk per sleutel) en bewaart het resultaat. Bij een fout blijft
 * de vorige data staan en wordt de fout bijgehouden; de promise wordt dan afgewezen.
 *
 * Is de sleutel ongeldig verklaard terwijl het verzoek liep, dan wordt het antwoord niet
 * opgeslagen maar meteen opnieuw opgehaald (het kan de laatste wijziging missen).
 *
 * Kwam (een deel van) het antwoord uit de offline kopie van de service worker, dan wordt het niet
 * als vers opgeslagen: bestaande data blijft staan (de promise geeft die terug), en zonder
 * bestaande data wordt de kopie getoond maar verouderd gemarkeerd. De status krijgt dan een
 * StaleDataError, zodat het scherm "offline" kan tonen en het later opnieuw geprobeerd wordt.
 *
 * Met `maxAge`: blijkt de bewaarde kopie die nog uit IndexedDB kwam al jonger dan `maxAge` ms,
 * dan wordt er niet opgehaald.
 */
export function fetchCached<T>(key: string, fetcher: () => Promise<T>, persist: Persist = false, maxAge?: number): Promise<T> {
  const v = versionOf(key);
  const running = inflight.get(key);
  if (running && running.v === v) return running.p as Promise<T>;
  const gen = generation;
  setStatus(key, { loading: true });
  // Een groot item dat nog uit IndexedDB komt, eerst even afwachten: een incrementele fetcher
  // (geschiedenis) bouwt daarop voort in plaats van alles opnieuw op te halen.
  load(key);
  const warming = pendingIdb.get(key);
  const ready = warming ? Promise.race([warming, new Promise<void>((r) => setTimeout(r, WARM_WAIT_MS))]) : Promise.resolve();

  const attempt = (): Promise<T> =>
    // Alleen antwoorden van deze fetcher zelf tellen als offline kopie, niet die van een ander
    // verzoek dat toevallig tegelijk liep (zie trackStaleResponses).
    trackStaleResponses(fetcher).then(
      ({ data, stale, cachedAt }) => {
        if (gen !== generation) return data;
        if (versionOf(key) !== v) {
          // Vergeten met removeCached: niets meer wegschrijven.
          if (removedAt.get(key) === versionOf(key)) {
            setStatus(key, { loading: false }, true);
            return data;
          }
          // Tijdens het ophalen ongeldig verklaard: dit antwoord kan te oud zijn.
          return fetchCached(key, fetcher, persist);
        }
        if (stale) {
          const prev = load(key);
          const patch: Status = {
            error: new StaleDataError(cachedAt),
            errorAt: Date.now(),
            failures: (status.get(key)?.failures ?? 0) + 1,
            loading: false,
          };
          if (prev) {
            setStatus(key, patch);
            return prev.data as T;
          }
          setStatus(key, patch, true);
          mem.set(key, { data, at: cachedAt, stale: true });
          touched.set(key, Date.now());
          missing.delete(key);
          notify(key);
          return data;
        }
        setStatus(key, { error: null, errorAt: 0, failures: 0, loading: false }, true);
        setCached(key, data, typeof persist === "function" ? persist(data) : persist);
        return data;
      },
      (err: unknown) => {
        if (gen === generation) {
          // Ongeldig verklaard tijdens een mislukte poging: meteen één keer opnieuw.
          if (versionOf(key) !== v && removedAt.get(key) !== versionOf(key)) return fetchCached(key, fetcher, persist);
          const prev = status.get(key) ?? IDLE;
          setStatus(key, { error: err, errorAt: Date.now(), failures: prev.failures + 1, loading: false });
        }
        throw err;
      },
    );

  const p: Promise<T> = ready
    .then(() => {
      // Wat intussen uit IndexedDB binnenkwam (bijv. net opgehaald door een ander tabblad), kan
      // al vers genoeg zijn: dan niet nog eens ophalen.
      if (warming && maxAge !== undefined && gen === generation && versionOf(key) === v) {
        const e = mem.get(key);
        if (e && isFresh(e, maxAge)) {
          setStatus(key, { error: null, errorAt: 0, failures: 0, loading: false });
          return e.data as T;
        }
      }
      return attempt();
    })
    .finally(() => {
      if (inflight.get(key)?.p === p) inflight.delete(key);
    });
  inflight.set(key, { p, v });
  return p;
}

/**
 * Markeert alles dat met `prefix` begint als verouderd; actieve pagina's halen het opnieuw op.
 * Werkt ook als een eerdere invalidate al liep en het ophalen toen mislukte (elke aanroep geeft
 * een nieuw item, dus schermen merken het altijd), voor een fetch die op dat moment al liep (die
 * schrijft zijn antwoord niet weg en haalt opnieuw op) en voor items die nog alleen op het
 * toestel staan (die worden bij het inlezen meteen als verouderd gezien).
 */
export function invalidate(prefix: string, { soft = false }: { soft?: boolean } = {}) {
  invalidations = [...invalidations.filter((i) => i.prefix !== prefix), { prefix, at: Date.now() }].slice(-50);
  if (!soft) hardSeq.set(prefix, ++seq);
  for (const key of inflight.keys()) if (key.startsWith(prefix)) bump(key);
  for (const key of [...mem.keys()]) {
    if (!key.startsWith(prefix)) continue;
    if (!inflight.has(key)) bump(key);
    mem.set(key, { ...mem.get(key)!, stale: true });
    const s = status.get(key);
    // Na een bewuste wijziging (bijv. sets gelogd) meteen ophalen, niet pas na de wachttijd.
    if (s?.failures) status.set(key, { ...s, failures: 0, errorAt: 0 });
    notify(key);
  }
}

/**
 * Vergeet alles dat met `prefix` begint: uit het geheugen, van het toestel en een fetch die nog
 * loopt, schrijft niets meer weg. Voor data die niet meer bij jou hoort (bijv. een verlaten
 * groep). Schermen die de sleutel nog tonen, halen hem opnieuw op.
 */
export function removeCached(prefix: string) {
  if (!prefix) return;
  const keys = keysWithPrefix(prefix, { includeInflight: true });
  for (const key of keys) {
    bump(key);
    removedAt.set(key, versionOf(key));
    mem.delete(key);
    touched.delete(key);
    status.delete(key);
    inflight.delete(key);
    removeEverywhere(key);
  }
  // Grote items waarvan het overzicht nog niet geladen was: alsnog opruimen.
  if (idbIndex === null) {
    void loadIdbIndex().then((idx) => {
      const late = [...(idx?.keys() ?? [])].filter((k) => k.startsWith(prefix) && !mem.has(k));
      void idbRemove(late);
    });
  }
  // Schermen die de sleutel tonen, lezen opnieuw in (en halen zo nodig opnieuw op).
  for (const key of keys) {
    missing.delete(key);
    notify(key);
  }
}

/**
 * Sleutels die met `prefix` beginnen en in het geheugen of op het toestel staan (IndexedDB alleen
 * als dat overzicht al geladen is). Met `includeInflight` ook sleutels die nu worden opgehaald of
 * alleen een status (bijv. een fout) hebben.
 */
function keysWithPrefix(prefix: string, { includeInflight = false }: { includeInflight?: boolean } = {}): Set<string> {
  const keys = new Set<string>();
  const add = (k: string) => {
    if (k.startsWith(prefix)) keys.add(k);
  };
  for (const k of mem.keys()) add(k);
  if (includeInflight) {
    for (const k of inflight.keys()) add(k);
    for (const k of status.keys()) add(k);
  }
  for (const sk of persistIndex().keys()) add(sk.slice(LS_PREFIX.length));
  for (const k of idbIndex?.keys() ?? []) add(k);
  return keys;
}

/**
 * Alle sleutels met `prefix` waarvoor data in het geheugen of op het toestel staat, ook grote items
 * in IndexedDB (dat overzicht wordt zo nodig eerst ingelezen). Om gericht op te ruimen op basis van
 * de inhoud, samen met readCached.
 */
export async function cachedKeys(prefix: string): Promise<string[]> {
  await loadIdbIndex();
  return [...keysWithPrefix(prefix)];
}

/**
 * Leest de bewaarde data van één sleutel zonder op te halen, ook als die alleen nog in IndexedDB
 * staat (die komt dan tijdelijk in het geheugen en verdwijnt daar vanzelf weer als hij niet wordt
 * gebruikt). Undefined als er niets (meer) is of het niet kon worden gelezen.
 */
export async function readCached<T>(key: string): Promise<T | undefined> {
  const hit = load(key);
  if (hit) return hit.data as T;
  await pendingIdb.get(key);
  return mem.get(key)?.data as T | undefined;
}

/**
 * Volgnummer van de laatste "harde" invalidate die deze sleutel raakte (0 als er geen was). Een
 * fetcher die incrementeel ophaalt, kan hiermee zien dat er een volledige verversing nodig is
 * (bijv. na het verwijderen van een training), terwijl een "zachte" invalidate (nieuwe sets)
 * genoeg heeft aan alleen het nieuwste deel.
 */
export function hardInvalidationSeq(key: string): number {
  let max = 0;
  for (const [prefix, n] of hardSeq) if (key.startsWith(prefix) && n > max) max = n;
  return max;
}

/** Wist de data-cache van de service worker (afgeschermde Supabase-antwoorden). */
function purgeServiceWorkerData() {
  try {
    if (typeof caches !== "undefined") {
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith(SW_DATA_CACHE_PREFIX)).map((k) => caches.delete(k))))
        .catch(() => {});
    }
    if (typeof navigator !== "undefined") navigator.serviceWorker?.controller?.postMessage({ type: "clear-data" });
  } catch {
    // geen service worker of Cache Storage beschikbaar
  }
}

/**
 * Gezondheidstabellen (stappen, kcal, slaap, toestemmingen). Gelijk aan het deel van PRIVATE_TABLE in
 * public/sw.js dat hierover gaat. Een nieuwe service worker bewaart ze niet meer, maar een oudere
 * (spotter-data-v3, actief tot "Herladen") kan ze nog in Cache Storage hebben staan.
 */
const HEALTH_TABLE = /\/rest\/v1\/(?:[a-z_]*sleep[a-z_]*|daily_[a-z_]*|activity_settings|activity_consent_log)(?:[/?]|$)/i;

/**
 * Wist alleen de gezondheidsgegevens uit de data-cache van de service worker (de rest, zoals de
 * laatst geladen training, blijft offline beschikbaar). Na intrekken of verwijderen van activiteit
 * of slaap: geen kopie op het toestel laten staan. Wacht niet.
 */
export function purgeServiceWorkerHealthData() {
  try {
    if (typeof caches === "undefined") return;
    void caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(SW_DATA_CACHE_PREFIX))
            .map(async (k) => {
              const cache = await caches.open(k);
              const reqs = await cache.keys();
              await Promise.all(reqs.filter((r) => HEALTH_TABLE.test(new URL(r.url).pathname)).map((r) => cache.delete(r)));
            }),
        ),
      )
      .catch(() => {});
  } catch {
    // geen Cache Storage beschikbaar
  }
}

/** Wist alles in IndexedDB (zonder te wachten). */
function clearIdb() {
  idbIndex = new Map();
  idbIndexPromise = Promise.resolve(idbIndex);
  pendingIdb.clear();
  idbWrites.clear();
  void openDb().then(async (db) => {
    if (!db) return;
    try {
      const tx = db.transaction([DATA_STORE, META_STORE], "readwrite");
      tx.objectStore(DATA_STORE).clear();
      tx.objectStore(META_STORE).clear();
      await txDone(tx);
    } catch {
      // niets te wissen
    }
  });
}

/** Alles wissen (bij uitloggen of wisselen van account), ook de offline kopie in de service worker. */
export function clearCache() {
  // Fetches die nog lopen, horen bij het vorige account: hun resultaat wordt genegeerd.
  generation++;
  inflight.clear();
  mem.clear();
  touched.clear();
  missing.clear();
  status.clear();
  versions.clear();
  removedAt.clear();
  invalidations = [];
  hardSeq.clear();
  try {
    const ls = storage();
    if (ls) {
      for (let i = ls.length - 1; i >= 0; i--) {
        const k = ls.key(i);
        if (k?.startsWith(LS_PREFIX)) ls.removeItem(k);
      }
    }
  } catch {
    // niets te wissen
  }
  index = new Map();
  clearIdb();
  broadcast({ type: "clear" });
  purgeServiceWorkerData();
  // Bewust geen notify: schermen van het vorige account mogen nu niet opnieuw gaan ophalen
  // (zonder sessie zou dat lege resultaten onder hun sleutel opslaan). Ze verdwijnen bij uitloggen.
}

/** Verwijdert alleen de bewaarde kopie op het toestel (de data in het geheugen blijft). */
export function forgetPersisted(key: string) {
  removePersisted(LS_PREFIX + key);
  if (idbIndex === null || idbIndex.has(key)) {
    idbWrites.delete(key);
    void idbRemove([key]);
  }
}

function subscribe(key: string, fn: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => {
    const set = listeners.get(key);
    set?.delete(fn);
    if (set && !set.size) listeners.delete(key);
  };
}

/**
 * Haalt items uit het geheugen die al een tijd niet op het scherm staan (bijv. de geschiedenis
 * van een vriend die je een kwartier geleden bekeek). Een bewaarde kopie op het toestel blijft
 * staan en wordt bij een volgend bezoek weer ingelezen.
 */
function sweepMemory() {
  writesSinceSweep = 0;
  const now = Date.now();
  for (const key of [...mem.keys()]) {
    if (listeners.has(key) || inflight.has(key)) continue;
    if (now - (touched.get(key) ?? 0) < MEM_IDLE_MS) continue;
    mem.delete(key);
    touched.delete(key);
    // Niet als "ontbrekend" markeren: bij de volgende keer lezen kijken we weer op het toestel.
    missing.delete(key);
  }
}

// ─────────── Verversen bij terugkeren / weer online / ander tabblad ───────────

/** Markeert alles wat nu op het scherm staat als verouderd, zodat het opnieuw wordt opgehaald. */
export function revalidateActive() {
  const now = Date.now();
  for (const key of [...listeners.keys()]) {
    const e = mem.get(key);
    if (e && !e.stale && now - e.at > FOCUS_MIN_AGE) mem.set(key, { ...e, stale: true });
    const s = status.get(key);
    // Wachttijd na fouten resetten: nu meteen opnieuw proberen.
    if (s && s.failures) status.set(key, { ...s, failures: 0, errorAt: 0 });
    notify(key);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  let hiddenAt = 0;
  window.addEventListener("online", revalidateActive);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      sweepMemory();
    } else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_MIN_MS) revalidateActive();
  });
  // Een ander tabblad/venster schreef of wiste een bewaard item: opnieuw inlezen.
  window.addEventListener("storage", (e) => {
    if (e.storageArea && e.storageArea !== storage()) return;
    if (e.key === null) {
      // localStorage helemaal gewist (bijv. uitloggen in een ander venster).
      const keys = [...mem.keys()];
      mem.clear();
      missing.clear();
      index = null;
      keys.forEach(notify);
      return;
    }
    if (!e.key.startsWith(LS_PREFIX)) return;
    const key = e.key.slice(LS_PREFIX.length);
    // Lopende fetch hier laat zijn eigen resultaat nog wegschrijven; dat is minstens zo vers.
    mem.delete(key);
    missing.delete(key);
    if (index) {
      if (e.newValue) index.set(e.key, { at: readAt(e.newValue), size: e.newValue.length });
      else index.delete(e.key);
    }
    notify(key);
  });
}

// ─────────── Overzicht (Opslag en synchronisatie) ───────────

export type CacheStats = {
  /** Aantal items in het geheugen. */
  memoryItems: number;
  /** Aantal en grootte (tekens) van de bewaarde items in localStorage. */
  localItems: number;
  localChars: number;
  /** Aantal en grootte (tekens) van de grote items in IndexedDB (null als niet beschikbaar). */
  deviceItems: number | null;
  deviceChars: number | null;
  /** Meest recente succesvolle ophaalactie in deze sessie of uit de bewaarde data (ms), 0 als onbekend. */
  lastSyncAt: number;
  /** Aantal sleutels waarvan de laatste poging mislukte. */
  failing: number;
};

/** Overzicht van wat er bewaard is, voor een scherm als "Opslag en synchronisatie". */
export async function cacheStats(): Promise<CacheStats> {
  const idx = persistIndex();
  let localChars = 0;
  let lastSyncAt = 0;
  for (const v of idx.values()) {
    localChars += v.size;
    lastSyncAt = Math.max(lastSyncAt, v.at);
  }
  for (const e of mem.values()) if (!e.stale) lastSyncAt = Math.max(lastSyncAt, e.at);
  const big = await loadIdbIndex();
  let deviceChars = 0;
  for (const m of big?.values() ?? []) {
    deviceChars += m.size;
    lastSyncAt = Math.max(lastSyncAt, m.at);
  }
  let failing = 0;
  for (const s of status.values()) if (s.error) failing++;
  return {
    memoryItems: mem.size,
    localItems: idx.size,
    localChars,
    deviceItems: big ? big.size : null,
    deviceChars: big ? deviceChars : null,
    lastSyncAt,
    failing,
  };
}

/**
 * Wist de bewaarde kopieën (geheugen, toestel, service worker) zonder uit te loggen. Schermen die
 * nu open staan, halen hun data direct opnieuw op. De offline wachtrij met sets blijft staan.
 */
export function resetCache() {
  const active = [...listeners.keys()];
  clearCache();
  active.forEach(notify);
}

// ─────────── Hooks ───────────

export type CachedState<T> = {
  /** Bekende data (ook als die verouderd is), undefined zolang er nog niets is. */
  data: T | undefined;
  /** Fout van de laatste poging (null als die lukte of nog bezig is). */
  error: unknown;
  /** Er loopt nu een verzoek (eerste keer laden of verversen op de achtergrond). */
  refreshing: boolean;
  /** Tijdstip waarop de getoonde data is opgehaald (ms), of null. */
  updatedAt: number | null;
  /**
   * De getoonde data is mogelijk niet de laatste stand: de laatste poging mislukte of het is een
   * offline kopie. Voor een regel als "Offline, bijgewerkt om 18:42".
   */
  stale: boolean;
  /** De laatste poging mislukte door geen of slechte verbinding (geen echte fout). */
  offline: boolean;
  /** Direct opnieuw proberen (bijv. vanaf een "Opnieuw"-knop). */
  retry: () => void;
};

function backoff(failures: number) {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1));
}

/**
 * Als useCached, maar geeft ook fout- en laadstatus terug, zodat een pagina een foutmelding met
 * "Opnieuw" kan tonen in plaats van eindeloos een skeleton (zie components/platform/LoadError en
 * components/platform/DataStatus).
 */
export function useCachedState<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { persist = false, maxAge = 10_000 }: { persist?: Persist; maxAge?: number } = {},
): CachedState<T> {
  const sub = useCallback((fn: () => void) => (key ? subscribe(key, fn) : () => {}), [key]);
  const entry = useSyncExternalStore(
    sub,
    () => (key ? load(key) : undefined),
    () => undefined,
  );
  const st = useSyncExternalStore(
    sub,
    () => (key ? (status.get(key) ?? IDLE) : IDLE),
    () => IDLE,
  );

  useEffect(() => {
    if (!key) return;
    if (isFresh(entry, maxAge)) return;
    if (st.loading) return;
    const run = () => {
      fetchCached(key, fetcher, persist, maxAge).catch(() => {});
    };
    if (st.failures) {
      // Offline: wachten op het "online"-signaal in plaats van steeds opnieuw proberen.
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const wait = backoff(st.failures) - (Date.now() - st.errorAt);
      if (wait > 0) {
        const t = setTimeout(run, wait);
        return () => clearTimeout(t);
      }
    }
    run();
    // fetcher en persist horen bij de sleutel; een nieuwe functie-instantie per render mag geen
    // nieuwe fetch (of nieuwe wachttijd) geven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entry, st, maxAge]);

  const retry = () => {
    if (!key) return;
    setStatus(key, { failures: 0, errorAt: 0 }, true);
    fetchCached(key, fetcher, persist).catch(() => {});
  };

  const error = st.loading ? null : st.error;
  return {
    data: entry?.data as T | undefined,
    error,
    refreshing: st.loading,
    updatedAt: entry && entry.at > 0 ? entry.at : null,
    stale: !!entry && !!st.error,
    offline: !!st.error && isNetworkError(st.error),
    retry,
  };
}

/**
 * Geeft de bekende data direct terug (of undefined) en ververst op de achtergrond als de data
 * ouder is dan `maxAge` ms. `key = null` slaat ophalen over.
 */
export function useCached<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: { persist?: Persist; maxAge?: number } = {},
): T | undefined {
  return useCachedState(key, fetcher, options).data;
}

/** Laatste fout voor deze sleutel (null als de laatste poging lukte), zonder zelf op te halen. */
export function useCachedError(key: string | null): unknown {
  const sub = useCallback((fn: () => void) => (key ? subscribe(key, fn) : () => {}), [key]);
  return useSyncExternalStore(
    sub,
    () => (key ? (status.get(key) ?? IDLE).error : null),
    () => null,
  );
}
