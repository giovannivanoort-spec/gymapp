import videos from "./exercise-videos.json";

export type DefaultVideo = { id: string; title: string; channel: string; seconds: number };

/** Automatisch gekozen uitlegvideo per oefening (gegenereerd door scripts/find-videos.mjs). */
export const DEFAULT_VIDEOS: Record<string, DefaultVideo> = videos;
