"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCached, setCached, useCached, useCachedState } from "@/lib/cache";
import { toISODate } from "@/lib/dates";
import { fmt } from "@/lib/nutrition/format";
import {
  addLog,
  addLogs,
  deleteSavedMeal,
  fetchCustomFoods,
  fetchFavorites,
  fetchFrequent,
  fetchHistoryFoods,
  fetchRecent,
  fetchSavedMeals,
  findCustomByBarcode,
  freshFetch,
  nutritionKeys,
  quickFood,
  rememberInHistory,
  setFavorite,
  type FoodLog,
  type FrequentItem,
  type HistoryFood,
  type SavedMeal,
} from "@/lib/nutrition/log";
import { lookupBarcodeDetailed, OFF_ATTRIBUTION, searchProducts, type PartialProduct } from "@/lib/nutrition/openFoodFacts";
import { getBasisFood, indexFood, normText, rankIndexed, searchBasisFoods, type FoodIndex } from "@/lib/nutrition/searchFoods";
import { macrosFor, MEALS, sumMacros, type Food, type Macros, type Meal } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { BarcodeScanner } from "../BarcodeScanner";
import { BookIcon, CheckIcon, ChevronRightIcon, CloseIcon, FlameIcon, PlusIcon, SparkleIcon } from "../Icons";
import { Sheet } from "../Sheet";
import { CustomFoodForm } from "./CustomFoodForm";
import { PhotoEstimate } from "./PhotoEstimate";
import { PortionPicker } from "./PortionPicker";
import { QuickAddForm } from "./QuickAddForm";
import { RecipeBuilder } from "./RecipeBuilder";

type Mode =
  | { kind: "search" }
  | { kind: "portion"; food: Food; grams?: number }
  | { kind: "photo" }
  | { kind: "custom"; barcode?: string; reason?: "unknown" | "incomplete"; edit?: Food; partial?: PartialProduct | null }
  | { kind: "quick" }
  | { kind: "recipe" };

/** Wat er in deze sessie van het paneel is toegevoegd (voor het lopende overzicht en "Klaar"). */
type Added = { id: string; name: string; kcal: number };

/** Lijsten in het paneel: tonen wat bekend is, op de achtergrond verversen als ze ouder zijn dan dit. */
const LIST_MAX_AGE = 60_000;
/** Zonder zoekterm tonen we zoveel eigen producten; de rest achter "Alle tonen". */
const MINE_PREVIEW = 4;
/** Bij zoeken tonen we zoveel eerder gegeten producten; de rest achter "Meer tonen". */
const PAST_PREVIEW = 6;
const NO_FOODS: Food[] = [];

const byName = (a: Food, b: Food) => a.name.localeCompare(b.name, "nl");

/**
 * Actuele versie van een bewaarde kopie (geschiedenis, favorieten, "Vaak bij"): eigen producten
 * zoals ze nu zijn, basisproducten met hun porties ("1 stuk", "1 snee"). null: het eigen product is
 * verwijderd. Zijn je eigen producten (nog) niet geladen, bijv. de eerste keer zonder verbinding,
 * dan blijft de bewaarde kopie staan: verwijderd of niet weten we dan nog niet.
 */
function currentFood(f: Food, customById: Map<string, Food> | null): Food | null {
  if (f.source === "custom") return customById ? (customById.get(f.id) ?? null) : f;
  if (f.source === "basis") return getBasisFood(f.id) ?? f;
  return f;
}

/**
 * Een regel onder "Eerder gegeten": het product in de actuele versie, met de vorige keer uit je
 * geschiedenis. `use` is null voor een favoriet die niet in je (opgehaalde) geschiedenis staat.
 */
type PastItem = { food: Food; use: HistoryFood | null };

/** Product uit een eigen lijst met vooraf genormaliseerde naam en merk (typen blijft zo snel). */
type Indexed<T> = { item: T; idx: FoodIndex };

/** Alles uit `list` dat bij de zoekterm past, beste eerst (bij gelijke rang volgens `tie`). */
function searchIndexed<T>(list: Indexed<T>[], q: string, tie: (a: T, b: T) => number): T[] {
  const qn = normText(q);
  if (!qn.norm) return [];
  const hits: { item: T; rank: number }[] = [];
  for (const c of list) {
    const rank = rankIndexed(c.idx, qn);
    if (rank !== null) hits.push({ item: c.item, rank });
  }
  return hits.sort((a, b) => a.rank - b.rank || tie(a.item, b.item)).map((h) => h.item);
}

const lastAt = (p: PastItem) => (p.use ? Date.parse(p.use.last) || 0 : 0);

/** Vaker gelogd eerst (favorieten zonder geschiedenis daarna), dan het laatst gelogde, dan op naam. */
const byUse = (a: PastItem, b: PastItem) => (b.use?.count ?? 0) - (a.use?.count ?? 0) || lastAt(b) - lastAt(a) || byName(a.food, b.food);

/**
 * Paneel om eten toe te voegen. `onAdded` krijgt de toegevoegde regels en een korte melding mee,
 * zodat de pagina een "Ongedaan maken" kan tonen (en het dagboek ververst).
 */
export function AddFoodSheet({
  open,
  onClose,
  meal,
  date,
  onAdded,
  dayLogs,
}: {
  open: boolean;
  onClose: () => void;
  meal: Meal;
  date: string;
  onAdded: (added?: FoodLog[], message?: string) => void;
  /**
   * Het dagboek van `date` zoals de pagina het toont. Zo klopt het lopende overzicht ook na
   * "Ongedaan maken" vanuit de melding.
   */
  dayLogs?: FoodLog[];
}) {
  const { session } = useAuth();
  const uid = session?.user.id ?? "anon";
  const [mode, setMode] = useState<Mode>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [scanner, setScanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [listError, setListError] = useState(false);
  const [showAllMine, setShowAllMine] = useState(false);
  /** Toegevoegd sinds het paneel openging: het paneel blijft open voor de volgende. */
  const [added, setAdded] = useState<Added[]>([]);
  /** Laatst toegevoegd, voor een korte bevestiging bovenin (met eigen sleutel voor de animatie). */
  const [flash, setFlash] = useState<{ text: string; n: number } | null>(null);
  /** Lopende barcode-zoekactie; wordt afgebroken als het paneel sluit of er opnieuw gescand wordt. */
  const lookup = useRef<AbortController | null>(null);

  // Lijsten uit de cache (direct zichtbaar bij opnieuw openen), ververst na elke wijziging.
  const onListError = <T,>(p: Promise<T>) =>
    p.catch((err) => {
      setListError(true);
      throw err;
    });
  const recent = useCached(open ? nutritionKeys.recent(uid) : null, () => onListError(fetchRecent()), { persist: true, maxAge: LIST_MAX_AGE });
  const favorites = useCached(open ? nutritionKeys.favorites(uid) : null, () => onListError(fetchFavorites()), { persist: true, maxAge: LIST_MAX_AGE }) ?? NO_FOODS;
  const customList = useCached(open ? nutritionKeys.custom(uid) : null, () => onListError(fetchCustomFoods()), { persist: true, maxAge: LIST_MAX_AGE });
  const saved = useCached(open ? nutritionKeys.saved(uid) : null, () => onListError(fetchSavedMeals()), { persist: true, maxAge: LIST_MAX_AGE }) ?? [];
  const frequent = useCached(open ? nutritionKeys.frequent(uid) : null, () => fetchFrequent(), { persist: true, maxAge: 5 * LIST_MAX_AGE });
  // Je eetgeschiedenis (~600 items) om in te zoeken; bewaard, dus ook zonder verbinding. Wat je
  // hier toevoegt, zet done() er direct in (rememberInHistory), dus hij hoeft niet vaker ververst
  // dan "Vaak bij ...". freshFetch: een fetch die al liep tijdens een wijziging, haalt opnieuw op.
  // De vorige stand levert de porties van gescande producten (die staan niet in het dagboek).
  const historyKey = open ? nutritionKeys.history(uid) : null;
  const historyState = useCachedState(
    historyKey,
    () => freshFetch(() => fetchHistoryFoods(historyKey ? getCached<HistoryFood[]>(historyKey) : undefined)),
    { persist: true, maxAge: 5 * LIST_MAX_AGE },
  );
  const historyList = historyState.data;
  /** Nog nooit geladen en de laatste poging mislukte (bijv. zonder verbinding). */
  const historyFailed = historyList === undefined && !!historyState.error;
  /** Nog nooit geladen en bezig met de eerste keer. */
  const historyLoading = open && historyList === undefined && !historyState.error;
  /** De eerste keer laden duurt langer dan even: pas dan een skeleton (snel laden geeft geen geflits). */
  const [historySlow, setHistorySlow] = useState(false);
  // Klaar met laden: terug naar af, zodat een volgende eerste poging ("Opnieuw") weer eerst even wacht.
  if (!historyLoading && historySlow) setHistorySlow(false);
  useEffect(() => {
    if (!historyLoading) return;
    const t = setTimeout(() => setHistorySlow(true), 150);
    return () => clearTimeout(t);
  }, [historyLoading]);
  /** Zoekterm waarvoor "Eerder gegeten" helemaal is uitgeklapt (een nieuwe zoekterm klapt weer in). */
  const [pastExpandedFor, setPastExpandedFor] = useState<string | null>(null);

  const [brands, setBrands] = useState<{ q: string; foods: Food[] | null; error?: string } | null>(null);

  // Merkproducten (Open Food Facts) met vertraging, zodat we niet bij elke letter zoeken.
  const q = query.trim();
  useEffect(() => {
    if (q.length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setBrands({ q, foods: null });
      searchProducts(q, { signal: ctrl.signal })
        .then((foods) => setBrands({ q, foods }))
        .catch((err) => !ctrl.signal.aborted && setBrands({ q, foods: [], error: errorMessage(err) }));
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const customById = useMemo(() => (customList ? new Map(customList.map((f) => [f.id, f])) : null), [customList]);

  /**
   * Je eetgeschiedenis om in te zoeken, in de actuele versie: aangepaste eigen producten zoals ze nu
   * zijn, verwijderde vallen weg. Porties van een gescand product komen uit de geschiedenis of je
   * favorieten. Daarna je favorieten die niet in de geschiedenis staan (zonder "vorige keer", dus
   * zonder plus), maar pas als de geschiedenis er is (of niet te laden was): anders schuiven ze even
   * later tussen de rest. Namen en merken worden hier één keer genormaliseerd.
   */
  const pastIndex = useMemo<Indexed<PastItem>[]>(() => {
    const favPortions = new Map(favorites.filter((f) => f.portions?.length).map((f) => [f.id, f.portions]));
    const out: Indexed<PastItem>[] = [];
    const seen = new Set<string>();
    for (const h of historyList ?? []) {
      const current = currentFood(h.food, customById);
      if (!current || seen.has(current.id)) continue;
      seen.add(current.id);
      const portions = current.portions?.length ? current.portions : h.food.portions?.length ? h.food.portions : (favPortions.get(current.id) ?? []);
      const food = current === h.food && (portions === h.food.portions || !portions.length) ? h.food : { ...current, portions };
      out.push({ item: { food, use: h }, idx: indexFood(food) });
    }
    if (historyList !== undefined || historyFailed) {
      for (const fav of favorites) {
        const food = currentFood(fav, customById);
        if (!food || seen.has(food.id)) continue;
        seen.add(food.id);
        out.push({ item: { food, use: null }, idx: indexFood(food) });
      }
    }
    return out;
  }, [historyList, historyFailed, customById, favorites]);
  const customIndex = useMemo<Indexed<Food>[]>(() => (customList ?? []).map((f) => ({ item: f, idx: indexFood(f) })), [customList]);

  /** Eerder gegeten dat bij de zoekterm past: lokaal, dus direct en offline. Beste treffer, dan vaakst gelogd. */
  const past = useMemo(() => searchIndexed(pastIndex, q, byUse), [pastIndex, q]);
  const showAllPast = pastExpandedFor === q;
  const shownPast = useMemo(() => (showAllPast ? past : past.slice(0, PAST_PREVIEW)), [past, showAllPast]);
  /**
   * Wat zichtbaar onder "Eerder gegeten" staat, tonen we hieronder niet nog een keer. Alleen de
   * zichtbare regels: bij een korte zoekterm ("k") verdwijnen sterke basisproducten anders achter
   * "Meer tonen". Klap je die open, dan verhuizen de extra getoonde producten mee naar boven.
   */
  const aboveIds = useMemo(() => new Set(shownPast.map((p) => p.food.id)), [shownPast]);

  // Bij inklappen (geen treffers meer) blijven de laatste regels staan tot de animatie klaar is.
  const [keptPast, setKeptPast] = useState<PastItem[]>([]);
  if (shownPast.length > 0 && shownPast !== keptPast) setKeptPast(shownPast);
  const pastOpen = past.length > 0 || (historyLoading && historySlow);
  const pastRows = past.length > 0 ? shownPast : pastOpen ? [] : keptPast;

  const basisAll = useMemo(() => (q ? searchBasisFoods(q, 25) : []), [q]);
  const basis = useMemo(() => basisAll.filter((f) => !aboveIds.has(f.id)), [basisAll, aboveIds]);
  const brandFoods = useMemo(() => brands?.foods?.filter((f) => !aboveIds.has(f.id)) ?? null, [brands, aboveIds]);
  /** Eigen producten die passen, met dezelfde rangorde als "Eerder gegeten" (naam voor merk). */
  const mine = useMemo(() => searchIndexed(customIndex, q, byName).filter((f) => !aboveIds.has(f.id)), [customIndex, q, aboveIds]);
  const favIds = new Set(favorites.map((f) => f.id));
  const mealLabel = MEALS.find((m) => m.id === meal)?.label.toLowerCase() ?? "";
  const planning = date > toISODate();

  /** Recent en favorieten bewaren een kopie; voor eigen producten nemen we de actuele versie. */
  const resolve = (f: Food): Food => (f.source === "custom" && customById?.get(f.id)) || f;

  /**
   * Porties staan niet in het dagboek. Heeft een eerder gescand product er nog geen, dan nemen we
   * die van hetzelfde product in de merkresultaten ("1 bakje", "hele verpakking").
   */
  const withPortions = (food: Food): Food => {
    if (food.portions.length || !brands?.foods) return food;
    const hit = brands.foods.find((f) => f.id === food.id);
    return hit?.portions.length ? { ...food, portions: hit.portions } : food;
  };

  function close() {
    lookup.current?.abort();
    lookup.current = null;
    setLookingUp(false);
    setMode({ kind: "search" });
    setQuery("");
    setMessage(null);
    setNotice(null);
    setBrands(null);
    setConfirmDelete(null);
    setListError(false);
    setShowAllMine(false);
    setPastExpandedFor(null);
    setAdded([]);
    setFlash(null);
    onClose();
  }

  /**
   * De pagina ververst het dagboek en toont de melding met "Ongedaan maken". Het paneel blijft
   * open: een ontbijt van drie producten is zo drie keer tikken, zonder steeds opnieuw te openen.
   */
  function done(logs: FoodLog[], msg: string, foods?: Food[]) {
    navigator.vibrate?.(12);
    onAdded(logs, msg);
    // Ná de invalidate van de pagina: de geschiedenis lokaal bijwerken (ook zonder verbinding)
    // in plaats van bij elk product opnieuw ~600 items te downloaden. `foods` bewaart hun porties.
    rememberInHistory(uid, logs, foods);
    setAdded((list) => [...list, ...logs.map((l) => ({ id: l.id, name: l.name, kcal: l.kcal }))]);
    setFlash((f) => ({ text: msg, n: (f?.n ?? 0) + 1 }));
    setMode({ kind: "search" });
    setQuery("");
    setMessage(null);
    setNotice(null);
    setConfirmDelete(null);
  }

  /** Eén tik: vaak gegeten product met de laatst gebruikte hoeveelheid toevoegen. */
  async function addFrequent(it: FrequentItem) {
    await add(resolve(it.food), it.grams, meal, it.portion_label);
  }

  async function add(food: Food, grams: number, m: Meal, label: string | null) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const log = await addLog(food, grams, m, date, label);
      const target = MEALS.find((x) => x.id === m)?.label.toLowerCase();
      done([log], `${food.name} ${log.planned ? "gepland bij" : "toegevoegd aan"} ${target}`, [food]);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addQuick(name: string, macros: Macros) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const food = quickFood(name, macros);
      const log = await addLog(food, 100, meal, date, "Snelle invoer");
      done([log], `${fmt(macros.kcal)} kcal ${log.planned ? "gepland bij" : "toegevoegd aan"} ${mealLabel}`);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addSavedMeal(sm: SavedMeal) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // Eén insert: bij een fout komt er niets half in je dagboek.
      const added = await addLogs(sm.items.map((it) => ({ food: it.food, grams: it.grams, meal, date, portionLabel: it.portion_label ?? null })));
      done(
        added,
        `${sm.name} toegevoegd (${sm.items.length} ${sm.items.length === 1 ? "item" : "items"})`,
        sm.items.map((it) => it.food),
      );
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeSavedMeal(sm: SavedMeal) {
    if (confirmDelete !== sm.id) {
      setConfirmDelete(sm.id);
      return;
    }
    setConfirmDelete(null);
    const key = nutritionKeys.saved(uid);
    const before = getCached<SavedMeal[]>(key) ?? saved;
    setCached(key, before.filter((x) => x.id !== sm.id), true);
    try {
      await deleteSavedMeal(sm.id);
    } catch (err) {
      setCached(key, before, true);
      setMessage(errorMessage(err));
    }
  }

  async function onBarcode(code: string) {
    setScanner(false);
    lookup.current?.abort();
    const ctrl = new AbortController();
    lookup.current = ctrl;
    setLookingUp(true);
    setMessage(null);
    setNotice(null);
    try {
      const own = await findCustomByBarcode(code);
      if (ctrl.signal.aborted) return;
      if (own) {
        setMode({ kind: "portion", food: own });
        return;
      }
      const res = await lookupBarcodeDetailed(code, { signal: ctrl.signal });
      // Paneel intussen gesloten of opnieuw gescand: dit resultaat hoort nergens meer bij.
      if (ctrl.signal.aborted) return;
      if (res.food) setMode({ kind: "portion", food: res.food });
      else setMode({ kind: "custom", barcode: code, reason: res.status, partial: res.status === "incomplete" ? res.partial : null });
    } catch (err) {
      if (!ctrl.signal.aborted) setMessage(errorMessage(err));
    } finally {
      if (lookup.current === ctrl) {
        lookup.current = null;
        setLookingUp(false);
      }
    }
  }

  async function toggleFavorite(food: Food) {
    const key = nutritionKeys.favorites(uid);
    const before = getCached<Food[]>(key) ?? favorites;
    const on = !favIds.has(food.id);
    setCached(key, on ? [food, ...before] : before.filter((f) => f.id !== food.id), true);
    try {
      await setFavorite(food, on);
    } catch (err) {
      setCached(key, before, true);
      setMessage(`Favoriet ${on ? "toevoegen" : "verwijderen"} lukte niet: ${errorMessage(err)}`);
    }
  }

  /** Eigen product aangepast: lijsten in de cache direct bijwerken, daarna terug naar de portie. */
  function onCustomEdited(food: Food) {
    const customKey = nutritionKeys.custom(uid);
    const list = getCached<Food[]>(customKey) ?? customList ?? [];
    setCached(customKey, list.map((f) => (f.id === food.id ? food : f)).sort(byName), true);
    const favKey = nutritionKeys.favorites(uid);
    const favs = getCached<Food[]>(favKey);
    if (favs?.some((f) => f.id === food.id)) setCached(favKey, favs.map((f) => (f.id === food.id ? food : f)), true);
    setNotice("Product bijgewerkt");
    setMode({ kind: "portion", food });
  }

  function onCustomDeleted(food: Food) {
    const customKey = nutritionKeys.custom(uid);
    setCached(customKey, (getCached<Food[]>(customKey) ?? customList ?? []).filter((f) => f.id !== food.id), true);
    const favKey = nutritionKeys.favorites(uid);
    const favs = getCached<Food[]>(favKey);
    if (favs) setCached(favKey, favs.filter((f) => f.id !== food.id), true);
    setNotice(`${food.name} verwijderd uit je producten`);
    setMode({ kind: "search" });
  }

  /** Naar de portiekeuze; met `grams` staat de vorige hoeveelheid klaar. */
  function pick(food: Food, grams?: number) {
    setNotice(null);
    setMessage(null);
    setMode({ kind: "portion", food: resolve(food), grams });
  }

  function back() {
    setMode(mode.kind === "custom" && mode.edit ? { kind: "portion", food: mode.edit } : { kind: "search" });
    setMessage(null);
    setNotice(null);
  }

  const title =
    mode.kind === "photo"
      ? "Foto van je maaltijd"
      : mode.kind === "custom"
        ? mode.edit
          ? "Product bewerken"
          : "Eigen product"
        : mode.kind === "portion"
          ? "Hoeveelheid"
          : mode.kind === "quick"
            ? "Snelle invoer"
            : mode.kind === "recipe"
              ? "Recept samenstellen"
              : `${date > toISODate() ? "Plannen bij" : "Toevoegen aan"} ${mealLabel}`;

  // Lopend overzicht: alleen wat nog in het dagboek staat (na "Ongedaan maken" valt het weg).
  const basket = dayLogs ? added.filter((a) => dayLogs.some((l) => l.id === a.id)) : added;
  const basketKcal = basket.reduce((a, b) => a + b.kcal, 0);
  const suggestions = (frequent?.[meal] ?? []).filter((it) => !basket.some((b) => b.name === it.food.name));

  const shownMine = customList ? (showAllMine ? customList : customList.slice(0, MINE_PREVIEW)) : [];

  return (
    <>
      <Sheet open={open && !scanner} onClose={close} title={title}>
        {mode.kind !== "search" && (
          <button className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm text-muted hover:text-ink" onClick={back}>
            <ChevronRightIcon size={16} className="rotate-180" /> Terug
          </button>
        )}

        {basket.length > 0 && mode.kind === "search" && (
          <div className="animate-fade-in mb-4 flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 py-2 pl-3 pr-2" role="status">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink" aria-hidden>
              <CheckIcon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <p key={flash?.n} className="animate-fade-in truncate text-sm font-semibold">
                {flash?.text ?? "Toegevoegd"}
              </p>
              <p className="truncate text-xs text-muted tabular-nums">
                {basket.length} {basket.length === 1 ? "item" : "items"} · {fmt(basketKcal)} kcal · {basket.map((b) => b.name).join(", ")}
              </p>
            </div>
            <button className="btn-primary min-h-11 shrink-0 px-4 text-sm" onClick={close}>
              Klaar
            </button>
          </div>
        )}

        {message && (
          <p role="alert" className="animate-fade-in mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {message}
          </p>
        )}
        {notice && !message && (
          <p role="status" className="animate-fade-in mb-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">
            {notice}
          </p>
        )}

        {mode.kind === "portion" && (
          <PortionPicker
            key={mode.food.id}
            food={mode.food}
            meal={meal}
            date={date}
            initialGrams={mode.grams}
            favorite={favIds.has(mode.food.id)}
            onToggleFavorite={() => toggleFavorite(mode.food)}
            onAdd={(g, m, label) => add(mode.food, g, m, label)}
            onEdit={() => {
              setNotice(null);
              setMode({ kind: "custom", edit: mode.food });
            }}
            busy={busy}
          />
        )}

        {mode.kind === "photo" && (
          <PhotoEstimate
            meal={meal}
            date={date}
            onDone={(added = []) =>
              done(added, `${added.length} ${added.length === 1 ? "onderdeel" : "onderdelen"} ${date > toISODate() ? "gepland bij" : "toegevoegd aan"} ${mealLabel}`)
            }
          />
        )}

        {mode.kind === "custom" && (
          <CustomFoodForm
            key={mode.edit?.id ?? mode.barcode ?? "new"}
            barcode={mode.barcode}
            reason={mode.reason}
            prefill={mode.partial}
            initial={mode.edit}
            onDeleted={onCustomDeleted}
            onSaved={(food) => {
              if (mode.edit) {
                onCustomEdited(food);
                return;
              }
              const key = nutritionKeys.custom(uid);
              setCached(key, [...(getCached<Food[]>(key) ?? customList ?? []), food].sort(byName), true);
              setMode({ kind: "portion", food });
            }}
          />
        )}

        {mode.kind === "recipe" && (
          <RecipeBuilder
            customFoods={customList}
            recentFoods={recent?.map((r) => resolve(r.food))}
            onSaved={(food) => {
              const key = nutritionKeys.custom(uid);
              setCached(key, [...(getCached<Food[]>(key) ?? customList ?? []), food].sort(byName), true);
              setNotice(`Recept "${food.name}" bewaard bij Mijn producten. Kies hoeveel je eet.`);
              setMode({ kind: "portion", food });
            }}
          />
        )}

        {mode.kind === "quick" && <QuickAddForm busy={busy} onSubmit={addQuick} submitLabel={date > toISODate() ? "Plannen" : "Toevoegen"} />}

        {mode.kind === "search" && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              <ActionButton label="Barcode" onClick={() => setScanner(true)} icon={<BarcodeIcon />} disabled={lookingUp} />
              <ActionButton label="Foto" onClick={() => setMode({ kind: "photo" })} icon={<SparkleIcon size={20} />} />
              <ActionButton label="Snel" onClick={() => setMode({ kind: "quick" })} icon={<FlameIcon size={20} />} />
              <ActionButton label="Product" onClick={() => setMode({ kind: "custom" })} icon={<PlusIcon size={20} />} />
            </div>
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-dashed border-line px-3 py-2 text-left transition hover:border-accent active:scale-[0.99]"
              onClick={() => setMode({ kind: "recipe" })}
            >
              <span className="text-accent">
                <BookIcon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Recept samenstellen</span>
                <span className="block truncate text-xs text-muted">Meal prep: ingrediënten bij elkaar, log per portie</span>
              </span>
              <ChevronRightIcon size={16} className="shrink-0 text-muted" />
            </button>
            <input
              className="input"
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek product, bijv. kipfilet, havermout, AH yoghurt"
              aria-label="Zoek product"
              autoFocus={added.length === 0}
            />
            {lookingUp && (
              <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-3 text-sm text-muted" role="status">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Barcode opzoeken…
              </div>
            )}
            {busy && !lookingUp && <div className="skeleton h-12" />}
            {listError && recent === undefined && !q && (
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">Je recente producten konden niet worden geladen. Zoeken werkt wel.</p>
            )}

            {!q ? (
              <>
                {suggestions.length > 0 && (
                  <Section title={`Vaak bij ${mealLabel}`}>
                    {suggestions.map((it) => {
                      // Actuele versie (basisproducten met hun porties); de plus logt precies wat de regel toont.
                      const food = currentFood(it.food, customById) ?? resolve(it.food);
                      return (
                        <OneTapRow
                          key={food.id}
                          food={food}
                          grams={it.grams}
                          portionLabel={it.portion_label}
                          note={`${it.count}× gelogd`}
                          planning={planning}
                          busy={busy}
                          onPick={() => pick(food, it.grams)}
                          onAdd={() => addFrequent({ ...it, food })}
                        />
                      );
                    })}
                  </Section>
                )}
                {saved.length > 0 && (
                  <Section title="Mijn maaltijden">
                    {saved.map((sm) => {
                      const t = sumMacros(sm.items.map((it) => macrosFor(it.food.per100, it.grams)));
                      const confirming = confirmDelete === sm.id;
                      return (
                        <li key={sm.id} className="flex items-center gap-1">
                          <button
                            onClick={() => addSavedMeal(sm)}
                            disabled={busy}
                            className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 py-2.5 text-left transition active:opacity-70 disabled:opacity-50"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{sm.name}</p>
                              <p className="truncate text-xs text-muted">{sm.items.map((it) => it.food.name).join(", ")}</p>
                            </div>
                            <span className="shrink-0 text-right text-xs text-muted tabular-nums">
                              {fmt(t.kcal)} kcal
                              <span className="block text-[10px]">E {fmt(t.protein)} g</span>
                            </span>
                          </button>
                          <button
                            className={`flex h-11 shrink-0 items-center justify-center rounded-xl text-xs font-semibold transition ${
                              confirming ? "bg-danger/15 px-3 text-danger" : "w-11 text-muted hover:text-danger"
                            }`}
                            aria-label={confirming ? `${sm.name} definitief verwijderen` : `${sm.name} verwijderen`}
                            onClick={() => removeSavedMeal(sm)}
                            onBlur={() => confirming && setConfirmDelete(null)}
                          >
                            {confirming ? "Verwijderen?" : <CloseIcon size={16} />}
                          </button>
                        </li>
                      );
                    })}
                  </Section>
                )}
                {favorites.length > 0 && (
                  <Section title="Favorieten">
                    {favorites.map((f) => (
                      <FoodRow key={f.id} food={resolve(f)} onClick={() => pick(f)} />
                    ))}
                  </Section>
                )}
                <Section title="Recent">
                  {recent === undefined ? (
                    listError ? (
                      <li className="py-2 text-sm text-muted">Niet geladen.</li>
                    ) : (
                      <>
                        <li className="skeleton my-2 h-10" />
                        <li className="skeleton my-2 h-10" />
                      </>
                    )
                  ) : recent.length === 0 ? (
                    <li className="py-2 text-sm text-muted">Nog niets gelogd. Zoek een product, scan een barcode of maak een foto.</li>
                  ) : (
                    recent.map((r) => <FoodRow key={r.food.id} food={resolve(r.food)} sub={`laatst ${fmt(r.grams)} g`} onClick={() => pick(r.food, r.grams)} />)
                  )}
                </Section>
                {customList && customList.length > 0 && (
                  <Section title={`Mijn producten (${customList.length})`}>
                    {shownMine.map((f) => (
                      <FoodRow key={f.id} food={f} onClick={() => pick(f)} />
                    ))}
                    {customList.length > MINE_PREVIEW && (
                      <li>
                        <button
                          className="flex min-h-11 w-full items-center justify-center text-xs font-semibold text-accent"
                          onClick={() => setShowAllMine((v) => !v)}
                          aria-expanded={showAllMine}
                        >
                          {showAllMine ? "Minder tonen" : `Alle ${customList.length} tonen`}
                        </button>
                      </li>
                    )}
                  </Section>
                )}
              </>
            ) : (
              <>
                {historyFailed && (
                  <div className="flex items-center gap-2 rounded-xl bg-surface-2 py-1 pl-3 pr-1 text-sm text-muted" role="status">
                    <p className="min-w-0 flex-1 py-1">
                      {historyState.offline
                        ? "Geen verbinding: je eerder gegeten producten zijn nog niet geladen. Basisproducten zoeken werkt wel."
                        : "Je eerder gegeten producten konden niet worden geladen. Zoeken in basis- en merkproducten werkt wel."}
                    </p>
                    {!historyState.offline && (
                      <button className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-accent" onClick={historyState.retry}>
                        Opnieuw
                      </button>
                    )}
                  </div>
                )}
                <Collapse open={pastOpen}>
                  <Section title="Eerder gegeten">
                    {pastRows.length === 0 ? (
                      <li className="skeleton my-1 h-10" aria-hidden />
                    ) : (
                      pastRows.map(({ food: f, use }) => {
                        const food = withPortions(f);
                        return use ? (
                          <OneTapRow
                            key={food.id}
                            food={food}
                            grams={use.grams}
                            portionLabel={use.portion_label}
                            note={`${use.count}× gelogd`}
                            planning={planning}
                            busy={busy}
                            onPick={() => pick(food, use.grams)}
                            onAdd={() => addFrequent({ ...use, food })}
                          />
                        ) : (
                          <FavoriteRow key={food.id} food={food} onClick={() => pick(food)} />
                        );
                      })
                    )}
                    {past.length > PAST_PREVIEW && (
                      <li>
                        <button
                          className="flex min-h-11 w-full items-center justify-center text-xs font-semibold text-accent"
                          onClick={() => setPastExpandedFor(showAllPast ? null : q)}
                          aria-expanded={showAllPast}
                        >
                          {showAllPast ? "Minder tonen" : `Meer tonen (${past.length - PAST_PREVIEW})`}
                        </button>
                      </li>
                    )}
                  </Section>
                </Collapse>
                {mine.length > 0 && (
                  <Section title="Mijn producten">
                    {mine.map((f) => (
                      <FoodRow key={f.id} food={f} onClick={() => pick(f)} />
                    ))}
                  </Section>
                )}
                {(basis.length > 0 || basisAll.length === 0) && (
                  <Section title="Basisproducten">
                    {basis.length === 0 ? (
                      <li className="py-2 text-sm text-muted">Geen basisproducten gevonden.</li>
                    ) : (
                      basis.map((f) => <FoodRow key={f.id} food={f} onClick={() => pick(f)} />)
                    )}
                  </Section>
                )}
                {q.length >= 3 ? (
                  <Section title="Merkproducten">
                    {!brands || brands.q !== q || brandFoods === null ? (
                      <>
                        <li className="skeleton my-2 h-10" />
                        <li className="skeleton my-2 h-10" />
                      </>
                    ) : brands.error ? (
                      <li className="py-2 text-sm text-muted">{brands.error}</li>
                    ) : brandFoods.length === 0 ? (
                      <li className="py-2 text-sm text-muted">
                        {brands.foods?.length
                          ? "Geen andere merkproducten gevonden."
                          : "Geen merkproducten gevonden. Tip: scan de barcode of gebruik snelle invoer."}
                      </li>
                    ) : (
                      brandFoods.map((f) => <FoodRow key={f.id} food={f} onClick={() => pick(f)} />)
                    )}
                  </Section>
                ) : (
                  <p className="text-xs text-muted">Typ minstens 3 letters om ook merkproducten te zoeken.</p>
                )}
                <p className="text-center text-[11px] text-muted">Basisproducten: USDA FoodData Central · {OFF_ATTRIBUTION}</p>
              </>
            )}
          </div>
        )}
      </Sheet>
      {scanner && <BarcodeScanner open={scanner} onClose={() => setScanner(false)} onDetected={onBarcode} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="animate-fade-in">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

function FoodRow({ food, sub, onClick }: { food: Food; sub?: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex min-h-12 w-full items-center justify-between gap-3 py-2.5 text-left transition active:opacity-70">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{food.name}</p>
          <p className="truncate text-xs text-muted">{[food.brand, sub, `E ${fmt(food.per100.protein, 1)} g / 100 g`].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="shrink-0 text-xs text-muted tabular-nums">{fmt(food.per100.kcal)} kcal</span>
      </button>
    </li>
  );
}

/**
 * Klapt soepel in en uit (hoogte en doorzichtigheid), zodat de lijst eronder niet verspringt. In
 * een `space-y-4`-lijst: de ruimte eronder zit binnenin, dus ingeklapt neemt hij echt 0 px in.
 */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`my-0 grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
      inert={!open}
      aria-hidden={!open || undefined}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="pb-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Favoriet zonder "vorige keer" onder "Eerder gegeten": zelfde opbouw als OneTapRow (kcal in
 * dezelfde kolom), maar zonder plus. Tik opent de portiekeuze.
 */
function FavoriteRow({ food, onClick }: { food: Food; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex min-h-12 w-full items-center gap-1 text-left transition active:opacity-70">
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2.5">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{food.name}</span>
            <span className="block truncate text-xs text-muted">{[food.brand, "Favoriet", "per 100 g"].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="shrink-0 text-xs text-muted tabular-nums">{fmt(food.per100.kcal)} kcal</span>
        </span>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center text-muted" aria-hidden>
          <ChevronRightIcon size={16} />
        </span>
      </button>
    </li>
  );
}

/** Product met de laatst gebruikte hoeveelheid: tik op de regel voor de portie, op de plus om direct toe te voegen. */
function OneTapRow({
  food,
  grams,
  portionLabel,
  note,
  planning,
  busy,
  onPick,
  onAdd,
}: {
  food: Food;
  grams: number;
  portionLabel: string | null;
  note: string;
  /** Dag in de toekomst: de plus plant in plaats van toe te voegen. */
  planning: boolean;
  busy: boolean;
  onPick: () => void;
  onAdd: () => void;
}) {
  const kcal = (food.per100.kcal * grams) / 100;
  const amount = portionLabel ?? `${fmt(grams)} g`;
  return (
    <li className="flex items-center gap-1">
      <button onClick={onPick} className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 py-2.5 text-left transition active:opacity-70">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{food.name}</p>
          <p className="truncate text-xs text-muted">{[food.brand, amount, note].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="shrink-0 text-xs text-muted tabular-nums">{fmt(kcal)} kcal</span>
      </button>
      <button
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/50 text-accent transition hover:bg-accent hover:text-accent-ink active:scale-90 disabled:opacity-50"
        onClick={onAdd}
        disabled={busy}
        aria-label={`${food.name} direct ${planning ? "plannen" : "toevoegen"} (${amount})`}
      >
        <PlusIcon size={16} />
      </button>
    </li>
  );
}

function ActionButton({ label, onClick, icon, disabled }: { label: string; onClick: () => void; icon: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface-2 px-1 py-3 text-xs font-medium transition hover:border-accent hover:text-accent active:scale-95 disabled:opacity-50"
    >
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  );
}

function BarcodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 8v8M10 8v8M13 8v8M16 8v8" />
    </svg>
  );
}
