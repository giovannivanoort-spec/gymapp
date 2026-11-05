"use client";

import { getCached, invalidate, setCached } from "./cache";
import { supabase } from "./supabase";
import type { PlannedExercise, Template } from "./types";

/** Schema's zijn per persoon (RLS: alleen je eigen), dus de cache-sleutel bevat de gebruiker. */
export const templatesKey = (userId: string) => `templates:${userId}`;

export async function fetchTemplates(): Promise<Template[]> {
  const { data, error } = await supabase.from("templates").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Template[];
}

/** Een schema in de cache zetten of bijwerken (na opslaan), zodat lijsten meteen kloppen. */
export function putTemplateInCache(userId: string, t: Template) {
  const key = templatesKey(userId);
  const list = getCached<Template[]>(key);
  if (!list) return invalidate(key);
  const exists = list.some((x) => x.id === t.id);
  setCached(key, exists ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list], true);
}

export function removeTemplateFromCache(userId: string, id: string) {
  const key = templatesKey(userId);
  const list = getCached<Template[]>(key);
  if (list) setCached(key, list.filter((x) => x.id !== id), true);
}

/** Opslaan-vorm: lege notities weg, lege reps naar de standaard. */
export function cleanPlan(items: PlannedExercise[]): PlannedExercise[] {
  return items.map(({ slug, sets, reps, notes }) => ({
    slug,
    sets: Math.max(1, Math.min(20, Math.round(sets) || 1)),
    reps: reps.trim() || "8-12",
    notes: notes?.trim() || undefined,
  }));
}

export async function insertTemplate(userId: string, name: string, exercises: PlannedExercise[]): Promise<Template> {
  const { data, error } = await supabase
    .from("templates")
    .insert({ name: name.trim(), exercises: cleanPlan(exercises) })
    .select("*")
    .single();
  if (error) throw error;
  putTemplateInCache(userId, data as Template);
  return data as Template;
}

export function totalSets(plan: PlannedExercise[]): number {
  return plan.reduce((s, p) => s + (p.sets || 0), 0);
}

/**
 * Grove duur-inschatting: ongeveer 2,5 minuut per set (inclusief wisselen en opwarmen),
 * afgerond op 5 minuten.
 */
export function estimateMinutes(plan: PlannedExercise[]): number {
  return Math.max(5, Math.round((totalSets(plan) * 2.5) / 5) * 5);
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Link naar het plannen van een groepstraining met dit schema alvast ingeladen. */
export function planTemplateHref(groupId: string, date: string, templateId: string) {
  return `/groups/${groupId}/plan?date=${encodeURIComponent(date)}&template=${encodeURIComponent(templateId)}`;
}
