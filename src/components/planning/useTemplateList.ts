"use client";

import { useCachedState } from "@/lib/cache";
import { errorMessage } from "@/lib/supabase";
import { fetchTemplates, templatesKey } from "@/lib/templates";
import type { Template } from "@/lib/types";

/**
 * Je schema's uit de gedeelde cache (sleutel `templates:<userId>`, dus de coach en andere
 * schermen verversen deze lijst met `invalidate("templates")`). De fout wordt per sleutel
 * bijgehouden door de cache, zodat elk scherm een mislukte fetch ziet, ook als een ander
 * scherm die fetch gestart heeft. `enabled = false` haalt niets op (bijv. zolang een paneel dicht is).
 */
export function useTemplateList(userId: string, enabled = true) {
  const key = userId && enabled ? templatesKey(userId) : null;
  const st = useCachedState<Template[]>(key, fetchTemplates, { persist: true, maxAge: 30_000 });
  return {
    templates: st.data,
    error: st.error ? errorMessage(st.error) : null,
    refreshing: st.refreshing,
    retry: st.retry,
  };
}
