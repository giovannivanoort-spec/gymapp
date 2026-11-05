"use client";

import { invalidate } from "./cache";
import { errorMessage, isMissingSchemaError, supabase } from "./supabase";

/**
 * Profielfoto's (zie supabase/upgrade-avatars.sql). De foto wordt op het toestel verkleind tot een
 * vierkant van 320x320 (WebP, of JPEG waar WebP niet kan) en komt in de openbare bucket "avatars"
 * onder avatars/<jouw-id>/<tijdstip>.<ext>. Elke nieuwe foto krijgt een nieuwe naam, zodat de URL
 * een jaar lang gecachet mag worden; de vorige foto('s) ruimen we daarna op.
 */

export const AVATAR_BUCKET = "avatars";
/** Breedte en hoogte van de opgeslagen foto (scherp genoeg voor de grootste avatar op 3x-schermen). */
export const AVATAR_PX = 320;
const QUALITY = 0.85;
/** Grotere bestanden openen we niet eens (een telefoonfoto is meestal 2–12 MB). */
const MAX_INPUT_BYTES = 30 * 1024 * 1024;

export const AVATARS_DISABLED_MESSAGE = "Profielfoto's zijn nog niet ingeschakeld";

/** Fout met een melding die direct aan de gebruiker getoond kan worden. */
export class AvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarError";
  }
}

// ─────────── Foto verwerken (op het toestel) ───────────

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** Afbeelding inlezen, rechtop gezet volgens de EXIF-oriëntatie van de camera. */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // Oudere Safari kent de opties niet of kan dit formaat niet als bitmap: via <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("decode");
    // <img> houdt zich standaard al aan de EXIF-oriëntatie (image-orientation: from-image).
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

export type ProcessedAvatar = { blob: Blob; type: "image/webp" | "image/jpeg"; ext: "webp" | "jpg" };

/**
 * Maakt van een gekozen bestand een vierkante foto van 320x320: midden uitsnijden, verkleinen en
 * opslaan als WebP (of JPEG als de browser geen WebP kan maken, zoals oudere iOS Safari).
 */
export async function processAvatar(file: File): Promise<ProcessedAvatar> {
  // Een leeg type komt voor (bijv. HEIC op sommige toestellen): dan gewoon proberen te openen.
  if (file.type && !file.type.startsWith("image/")) throw new AvatarError("Dit is geen afbeelding. Kies een foto (JPG, PNG of WebP).");
  if (file.size > MAX_INPUT_BYTES) throw new AvatarError("Deze foto is te groot. Kies een foto kleiner dan 30 MB.");

  let img: Decoded;
  try {
    img = await decode(file);
  } catch {
    throw new AvatarError("Deze afbeelding kan niet worden geopend. Kies een JPG-, PNG- of WebP-foto.");
  }

  try {
    const side = Math.min(img.width, img.height);
    const sx = Math.round((img.width - side) / 2);
    const sy = Math.round((img.height - side) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AvatarError("Je browser kan deze foto niet verwerken. Probeer een andere browser.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);

    const webp = await canvasToBlob(canvas, "image/webp", QUALITY);
    // Zonder WebP-ondersteuning geeft toBlob stilletjes een PNG terug: dan JPEG.
    if (webp && webp.type === "image/webp") return { blob: webp, type: "image/webp", ext: "webp" };

    // JPEG kent geen transparantie: een donkere achtergrond achter doorzichtige delen.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#15171c";
    ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
    const jpeg = await canvasToBlob(canvas, "image/jpeg", QUALITY);
    if (!jpeg) throw new AvatarError("Je browser kan deze foto niet verwerken. Probeer een andere browser.");
    return { blob: jpeg, type: "image/jpeg", ext: "jpg" };
  } finally {
    img.release();
  }
}

// ─────────── Opslaan en verwijderen ───────────

/** Foutmeldingen van Storage/Postgres die betekenen dat upgrade-avatars.sql nog niet is gedraaid. */
function isNotEnabled(err: unknown): boolean {
  if (isMissingSchemaError(err)) return true;
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  return /bucket not found|row-level security|violates row level security/i.test(msg);
}

/** Korte Nederlandse melding bij een mislukte upload of verwijdering. */
export function avatarErrorMessage(err: unknown): string {
  if (err instanceof AvatarError) return err.message;
  if (isNotEnabled(err)) return AVATARS_DISABLED_MESSAGE;
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  if (/exceeded the maximum allowed size|payload too large|entity too large/i.test(msg)) return "Deze foto is te groot. Kies een kleinere foto.";
  if (/mime type|invalid_mime/i.test(msg)) return "Dit soort afbeelding wordt niet ondersteund. Kies een JPG-, PNG- of WebP-foto.";
  return errorMessage(err);
}

/** Verwijdert alle bestanden in jouw map behalve `keep` (best effort: fouten worden genegeerd). */
export async function deleteAvatarFiles(userId: string, keep?: string): Promise<void> {
  try {
    const bucket = supabase.storage.from(AVATAR_BUCKET);
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error || !data) return;
    const old = data.map((o) => `${userId}/${o.name}`).filter((p) => p !== keep);
    if (old.length) await bucket.remove(old);
  } catch {
    // Opruimen is een extraatje: een achtergebleven bestand kan geen kwaad.
  }
}

async function setAvatarUrl(userId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) throw error;
}

/**
 * Data in de cache waar profielen (en dus foto's) van mensen in zitten, als verouderd markeren.
 * Schermen die open staan halen het opnieuw op; de rest bij het volgende bezoek.
 */
export function invalidateProfileCaches(userId: string): void {
  for (const prefix of [
    `profile:${userId}`,
    `person:${userId}`,
    "friends:",
    "groupmates:",
    "group:",
    "group-today:",
    "home:groups:",
    "home:today-live:",
    "feed:",
    "leaderboard:",
    "ranks:board:",
    "ranks:people:",
    "wo:workout:",
  ]) {
    invalidate(prefix);
  }
}

/**
 * Verwerkt en uploadt een nieuwe profielfoto en zet hem in je profiel. Geeft de openbare URL
 * terug. Gooit een AvatarError (of een Supabase-fout; zie avatarErrorMessage) als het mislukt.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!userId) throw new AvatarError("Je bent niet ingelogd.");
  const { blob, type, ext } = await processAvatar(file);
  const path = `${userId}/${Date.now()}.${ext}`;
  const bucket = supabase.storage.from(AVATAR_BUCKET);

  const up = await bucket.upload(path, blob, { contentType: type, upsert: false, cacheControl: "31536000" });
  if (up.error) throw up.error;

  const url = bucket.getPublicUrl(path).data.publicUrl;
  try {
    await setAvatarUrl(userId, url);
  } catch (err) {
    // Profiel niet bijgewerkt: het net geüploade bestand niet laten slingeren.
    await bucket.remove([path]).catch(() => {});
    throw err;
  }

  await deleteAvatarFiles(userId, path);
  invalidateProfileCaches(userId);
  return url;
}

/** Haalt je profielfoto weg (terug naar initialen) en ruimt de bestanden op. */
export async function removeAvatar(userId: string): Promise<void> {
  if (!userId) throw new AvatarError("Je bent niet ingelogd.");
  await setAvatarUrl(userId, null);
  await deleteAvatarFiles(userId);
  invalidateProfileCaches(userId);
}

/**
 * Profielfoto van één persoon (bijv. op de uitnodigingspagina, waar alleen id en naam bekend
 * zijn). `null` als er geen foto is of de kolom nog niet bestaat.
 */
export async function fetchAvatarUrl(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
  return (data as { avatar_url?: string | null } | null)?.avatar_url ?? null;
}
