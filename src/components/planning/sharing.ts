"use client";

import { useCachedState } from "@/lib/cache";
import { fetchMyGroups, myGroupsKey, type MyGroup } from "@/lib/groups";
import { errorMessage, supabase } from "@/lib/supabase";
import { putTemplateInCache } from "@/lib/templates";
import type { Template } from "@/lib/types";

/**
 * Schema's delen met een groep (kolom templates.group_id, zie supabase/upgrade-planning.sql).
 * Zonder dat script bestaat de kolom niet: dan is alles gewoon "van jezelf" en meldt delen netjes
 * dat het nog niet kan.
 */
export type SharedTemplate = Template & { group_id?: string | null };

export const groupOf = (t: Template): string | null => (t as SharedTemplate).group_id ?? null;

export const SHARING_UNAVAILABLE =
  "Delen met de groep is nog niet ingeschakeld. Vraag de beheerder om supabase/upgrade-planning.sql uit te voeren.";

/** Fout doordat de kolom group_id (nog) niet bestaat. */
export function isMissingSharing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42703" || e.code === "PGRST204" || /group_id/i.test(e.message ?? "");
}

export function sharingError(err: unknown): string {
  return isMissingSharing(err) ? SHARING_UNAVAILABLE : errorMessage(err);
}

/** Delen met een groep (`groupId`) of weer privé maken (`null`). Werkt de lijst in de cache bij. */
export async function setTemplateGroup(userId: string, id: string, groupId: string | null): Promise<SharedTemplate> {
  const { data, error } = await supabase.from("templates").update({ group_id: groupId }).eq("id", id).select("*").single();
  if (error) throw error;
  putTemplateInCache(userId, data as Template);
  return data as SharedTemplate;
}

/** Je groepen met foutstatus (gedeelde cache met Home), zodat schermen niet eindeloos blijven laden. */
export function useMyGroupsState(userId: string) {
  const st = useCachedState<MyGroup[]>(userId ? myGroupsKey(userId) : null, () => fetchMyGroups(userId), {
    persist: true,
    maxAge: 60_000,
  });
  const trainerGroups = st.data?.filter((g) => g.role === "trainer");
  return {
    groups: st.data,
    trainerGroups,
    error: st.error ? errorMessage(st.error) : null,
    refreshing: st.refreshing,
    retry: st.retry,
  };
}
