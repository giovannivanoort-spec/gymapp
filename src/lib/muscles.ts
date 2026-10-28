/**
 * Spieren op twee niveaus:
 *  - MuscleGroup: herkenbare groep (Borst, Schouders, Biceps, …) voor filters en het overzicht.
 *  - Muscle: de losse spier of spierkop (bovenkant borst, lange kop triceps, …).
 * Oefeningen verwijzen altijd naar losse spieren (MuscleId).
 */

export type MuscleRegion = "push" | "pull" | "legs" | "core";

export type MuscleGroupId =
  | "chest"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "lats"
  | "upper_back"
  | "traps"
  | "lower_back"
  | "core"
  | "glutes"
  | "hip_flexors"
  | "quads"
  | "hamstrings"
  | "adductors"
  | "lower_leg";

export type MuscleGroup = {
  id: MuscleGroupId;
  name: string;
  region: MuscleRegion;
  /** Grote groepen: die horen in een complete training, anders geven we een tip. */
  major: boolean;
};

export const MUSCLE_GROUPS: MuscleGroup[] = [
  { id: "chest", name: "Borst", region: "push", major: true },
  { id: "shoulders", name: "Schouders", region: "push", major: true },
  { id: "triceps", name: "Triceps", region: "push", major: true },
  { id: "biceps", name: "Biceps", region: "pull", major: true },
  { id: "forearms", name: "Onderarmen", region: "pull", major: false },
  { id: "lats", name: "Brede rugspier", region: "pull", major: true },
  { id: "upper_back", name: "Bovenrug", region: "pull", major: true },
  { id: "traps", name: "Trapezius (boven)", region: "pull", major: false },
  { id: "lower_back", name: "Onderrug", region: "core", major: false },
  { id: "core", name: "Buikspieren", region: "core", major: true },
  { id: "glutes", name: "Bilspieren", region: "legs", major: true },
  { id: "hip_flexors", name: "Heupbuigers", region: "legs", major: false },
  { id: "quads", name: "Quadriceps", region: "legs", major: true },
  { id: "hamstrings", name: "Hamstrings", region: "legs", major: true },
  { id: "adductors", name: "Adductoren", region: "legs", major: false },
  { id: "lower_leg", name: "Kuiten & scheen", region: "legs", major: false },
];

export type MuscleId =
  // Borst
  | "chest_upper"
  | "chest_mid"
  | "chest_lower"
  | "pec_minor"
  | "serratus"
  // Schouders
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "rotator_cuff"
  // Biceps
  | "biceps_long"
  | "biceps_short"
  | "brachialis"
  // Triceps
  | "triceps_long"
  | "triceps_lateral"
  | "triceps_medial"
  // Onderarmen
  | "brachioradialis"
  | "wrist_flexors"
  | "wrist_extensors"
  // Rug
  | "lats"
  | "teres_major"
  | "rhomboids"
  | "traps_middle"
  | "traps_lower"
  | "traps_upper"
  | "erectors"
  // Core
  | "abs_upper"
  | "abs_lower"
  | "obliques"
  | "transverse_abs"
  // Heupen & benen
  | "glute_max"
  | "glute_med"
  | "glute_min"
  | "hip_flexors"
  | "rectus_femoris"
  | "vastus_lateralis"
  | "vastus_medialis"
  | "vastus_intermedius"
  | "biceps_femoris"
  | "semitendinosus"
  | "adductor_magnus"
  | "adductors_inner"
  | "gastrocnemius"
  | "soleus"
  | "tibialis";

export type Muscle = {
  id: MuscleId;
  name: string;
  /** Korte naam voor chips en balkjes. */
  short: string;
  group: MuscleGroupId;
  region: MuscleRegion;
  /**
   * Of we een tip geven als deze spier binnen een getrainde groep achterblijft.
   * Uit voor diepe/stabiliserende spieren die je niet gericht hoeft te trainen.
   */
  targetable: boolean;
};

export const MUSCLES: Muscle[] = [
  { id: "chest_upper", name: "Bovenkant borst (clavicularis)", short: "Bovenkant borst", group: "chest", region: "push", targetable: true },
  { id: "chest_mid", name: "Midden borst (sternalis)", short: "Midden borst", group: "chest", region: "push", targetable: true },
  { id: "chest_lower", name: "Onderkant borst (abdominalis)", short: "Onderkant borst", group: "chest", region: "push", targetable: true },
  { id: "pec_minor", name: "Kleine borstspier (pectoralis minor)", short: "Pec minor", group: "chest", region: "push", targetable: false },
  { id: "serratus", name: "Serratus anterior (zaagspier)", short: "Serratus", group: "chest", region: "push", targetable: false },

  { id: "front_delts", name: "Voorkant schouder (anterior deltoid)", short: "Voorkant schouder", group: "shoulders", region: "push", targetable: true },
  { id: "side_delts", name: "Zijkant schouder (lateral deltoid)", short: "Zijkant schouder", group: "shoulders", region: "push", targetable: true },
  { id: "rear_delts", name: "Achterkant schouder (posterior deltoid)", short: "Achterkant schouder", group: "shoulders", region: "pull", targetable: true },
  { id: "rotator_cuff", name: "Rotator cuff (infraspinatus, teres minor, supraspinatus)", short: "Rotator cuff", group: "shoulders", region: "pull", targetable: false },

  { id: "biceps_long", name: "Biceps lange kop (buitenkant)", short: "Biceps lange kop", group: "biceps", region: "pull", targetable: true },
  { id: "biceps_short", name: "Biceps korte kop (binnenkant)", short: "Biceps korte kop", group: "biceps", region: "pull", targetable: true },
  { id: "brachialis", name: "Brachialis (onder de biceps)", short: "Brachialis", group: "biceps", region: "pull", targetable: true },

  { id: "triceps_long", name: "Triceps lange kop", short: "Triceps lange kop", group: "triceps", region: "push", targetable: true },
  { id: "triceps_lateral", name: "Triceps laterale kop (buitenkant)", short: "Triceps laterale kop", group: "triceps", region: "push", targetable: true },
  { id: "triceps_medial", name: "Triceps mediale kop", short: "Triceps mediale kop", group: "triceps", region: "push", targetable: false },

  { id: "brachioradialis", name: "Brachioradialis (bovenkant onderarm)", short: "Brachioradialis", group: "forearms", region: "pull", targetable: true },
  { id: "wrist_flexors", name: "Polsbuigers (binnenkant onderarm)", short: "Polsbuigers", group: "forearms", region: "pull", targetable: true },
  { id: "wrist_extensors", name: "Polsstrekkers (buitenkant onderarm)", short: "Polsstrekkers", group: "forearms", region: "pull", targetable: true },

  { id: "lats", name: "Latissimus dorsi (brede rugspier)", short: "Lats", group: "lats", region: "pull", targetable: true },
  { id: "teres_major", name: "Teres major", short: "Teres major", group: "lats", region: "pull", targetable: false },
  { id: "rhomboids", name: "Rhomboïden (tussen de schouderbladen)", short: "Rhomboïden", group: "upper_back", region: "pull", targetable: true },
  { id: "traps_middle", name: "Middelste trapezius", short: "Midden trapezius", group: "upper_back", region: "pull", targetable: true },
  { id: "traps_lower", name: "Onderste trapezius", short: "Onderste trapezius", group: "upper_back", region: "pull", targetable: true },
  { id: "traps_upper", name: "Bovenste trapezius (nek/schouders)", short: "Bovenste trapezius", group: "traps", region: "pull", targetable: true },
  { id: "erectors", name: "Rugstrekkers (erector spinae)", short: "Rugstrekkers", group: "lower_back", region: "core", targetable: true },

  { id: "abs_upper", name: "Bovenste buikspieren (rectus abdominis)", short: "Bovenbuik", group: "core", region: "core", targetable: true },
  { id: "abs_lower", name: "Onderste buikspieren (rectus abdominis)", short: "Onderbuik", group: "core", region: "core", targetable: true },
  { id: "obliques", name: "Schuine buikspieren (obliques)", short: "Schuine buikspieren", group: "core", region: "core", targetable: true },
  { id: "transverse_abs", name: "Diepe buikspier (transversus abdominis)", short: "Diepe buikspier", group: "core", region: "core", targetable: false },

  { id: "glute_max", name: "Grote bilspier (gluteus maximus)", short: "Gluteus maximus", group: "glutes", region: "legs", targetable: true },
  { id: "glute_med", name: "Middelste bilspier (gluteus medius)", short: "Gluteus medius", group: "glutes", region: "legs", targetable: true },
  { id: "glute_min", name: "Kleine bilspier (gluteus minimus)", short: "Gluteus minimus", group: "glutes", region: "legs", targetable: false },
  { id: "hip_flexors", name: "Heupbuigers (iliopsoas)", short: "Heupbuigers", group: "hip_flexors", region: "legs", targetable: false },

  { id: "rectus_femoris", name: "Rectus femoris (midden bovenbeen)", short: "Rectus femoris", group: "quads", region: "legs", targetable: true },
  { id: "vastus_lateralis", name: "Vastus lateralis (buitenkant bovenbeen)", short: "Vastus lateralis", group: "quads", region: "legs", targetable: true },
  { id: "vastus_medialis", name: "Vastus medialis (traandruppel bij de knie)", short: "Vastus medialis", group: "quads", region: "legs", targetable: true },
  { id: "vastus_intermedius", name: "Vastus intermedius (diep)", short: "Vastus intermedius", group: "quads", region: "legs", targetable: false },
  { id: "biceps_femoris", name: "Biceps femoris (buitenkant hamstring)", short: "Biceps femoris", group: "hamstrings", region: "legs", targetable: true },
  { id: "semitendinosus", name: "Semitendinosus & semimembranosus (binnenkant hamstring)", short: "Semitendinosus", group: "hamstrings", region: "legs", targetable: true },
  { id: "adductor_magnus", name: "Adductor magnus (grote adductor)", short: "Adductor magnus", group: "adductors", region: "legs", targetable: true },
  { id: "adductors_inner", name: "Adductor longus, brevis & gracilis", short: "Binnenkant dij", group: "adductors", region: "legs", targetable: true },

  { id: "gastrocnemius", name: "Gastrocnemius (bovenste kuit)", short: "Gastrocnemius", group: "lower_leg", region: "legs", targetable: true },
  { id: "soleus", name: "Soleus (onderste kuit)", short: "Soleus", group: "lower_leg", region: "legs", targetable: true },
  { id: "tibialis", name: "Tibialis anterior (scheen)", short: "Scheenspier", group: "lower_leg", region: "legs", targetable: false },
];

export const MUSCLE_BY_ID = Object.fromEntries(MUSCLES.map((m) => [m.id, m])) as Record<MuscleId, Muscle>;
export const GROUP_BY_ID = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g.id, g])) as Record<MuscleGroupId, MuscleGroup>;

export function musclesInGroup(group: MuscleGroupId): Muscle[] {
  return MUSCLES.filter((m) => m.group === group);
}

export const REGION_LABEL: Record<MuscleRegion, string> = {
  push: "Duwen",
  pull: "Trekken",
  legs: "Benen",
  core: "Core",
};
