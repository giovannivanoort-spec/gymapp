import type { MuscleId } from "./muscles";

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "cable"
  | "machine"
  | "bodyweight"
  | "kettlebell"
  | "ez_bar"
  | "band";

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbells",
  cable: "Kabel",
  machine: "Machine",
  bodyweight: "Lichaamsgewicht",
  kettlebell: "Kettlebell",
  ez_bar: "EZ-bar",
  band: "Weerstandsband",
};

export type Exercise = {
  /** Unieke, stabiele sleutel (kebab-case). Wordt in de database opgeslagen. */
  slug: string;
  name: string;
  equipment: Equipment;
  primary: MuscleId[];
  secondary: MuscleId[];
  /** Korte beschrijving in 1 zin. */
  summary: string;
  /** Stappen voor de juiste uitvoering. */
  steps: string[];
  /** Tips en veelgemaakte fouten. */
  tips: string[];
  /** Zoekterm voor YouTube (Engels geeft de beste resultaten). */
  videoQuery: string;
};
