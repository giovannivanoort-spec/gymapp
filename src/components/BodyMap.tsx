import { MUSCLE_BY_ID, type MuscleId } from "@/lib/muscles";

/**
 * Gestileerde spierkaart (voor- en achteraanzicht) met losse spierdelen.
 * Vormen zijn voor de linkerhelft getekend (x < 100) en worden gespiegeld.
 * Diepe spieren (bijv. vastus intermedius) kleuren de vorm erboven mee; de pec minor staat
 * er niet op, omdat die anders de bovenkant borst onterecht laat oplichten.
 */

type Shape = { muscles: MuscleId[]; points: string };

const W = 200;

// ── Basis-silhouet (huid / niet-spier) ──
const BASE_COMMON: string[] = [
  "91,46 109,46 111,64 89,64", // nek
  "66,70 134,70 130,118 127,182 73,182 70,118", // romp
  "50,78 68,72 67,142 47,142", // bovenarm
  "45,140 65,140 60,196 41,196", // onderarm
  "70,176 130,176 125,206 100,216 75,206", // bekken
  "68,190 100,208 99,292 73,292 66,240", // bovenbeen
  "72,286 99,286 99,306 71,306", // knie
  "71,302 99,302 95,380 77,380", // onderbeen
  "76,378 96,378 99,394 71,394", // voet
];

const FRONT: Shape[] = [
  { muscles: ["traps_upper"], points: "91,52 91,66 76,71" },
  { muscles: ["front_delts"], points: "66,71 80,71 78,82 71,97 63,100 62,73" },
  { muscles: ["side_delts"], points: "62,73 63,100 52,100 48,88 54,77" },
  { muscles: ["chest_upper"], points: "82,72 98,72 98,85 77.5,85" },
  { muscles: ["chest_mid"], points: "77.5,85 98,85 98,101 69.5,101" },
  { muscles: ["chest_lower"], points: "69.5,101 98,101 98,112 87,115 75,109" },
  { muscles: ["serratus"], points: "69.5,103 75,110 73,114 70,122 68,111" },
  { muscles: ["biceps_long"], points: "51,104 58.5,103.5 60,140 56,141 49,126" },
  { muscles: ["biceps_short"], points: "58.5,103.5 66,103 64,138 60,140" },
  { muscles: ["brachialis"], points: "46.5,118 49,126 56,141 47,142" },
  { muscles: ["brachioradialis"], points: "47,145 55,144 50,175 44,162" },
  { muscles: ["wrist_flexors"], points: "55,144 64,143 59,192 45,192 50,175" },
  { muscles: ["abs_upper"], points: "87,117 99,117 99,134 87,134" },
  { muscles: ["abs_upper"], points: "87,137 99,137 99,154 87,154" },
  { muscles: ["abs_lower"], points: "87,157 99,157 99,177 88,177" },
  { muscles: ["obliques", "transverse_abs"], points: "73,115 85,117 85,177 76,175 71,151 70,126" },
  { muscles: ["hip_flexors"], points: "80,184 97,192 96,208 92,212 88,205 76,195" },
  { muscles: ["vastus_lateralis"], points: "70,196 78,200 76,236 79,276 72,271 67,236" },
  { muscles: ["rectus_femoris", "vastus_intermedius"], points: "78,200 88,205 92,213 91,250 86,250 84,268 79,276 76,236" },
  { muscles: ["vastus_medialis"], points: "86,250 91,250 90,282 80,287 79,276 84,268" },
  { muscles: ["adductors_inner", "adductor_magnus"], points: "93,213 99,215 98,252 92,263" },
  { muscles: ["gastrocnemius", "soleus"], points: "73,307 84,307 84,362 77,354 71,331" },
  { muscles: ["tibialis"], points: "86,308 96,308 93,356 87,360" },
];

const BACK: Shape[] = [
  { muscles: ["traps_upper"], points: "100,46 91,51 72,72 84,78 100,70" },
  { muscles: ["traps_middle"], points: "100,70 84,78 88,90 100,96" },
  { muscles: ["rear_delts"], points: "72,72 84,78 80,94 66,99 64,79" },
  { muscles: ["side_delts"], points: "64,79 66,99 52,100 48,88 56,76" },
  { muscles: ["rotator_cuff"], points: "84,78 88,90 90,104 82,106 80,94" },
  { muscles: ["rhomboids"], points: "88,90 100,96 100,116 94,114 90,104" },
  { muscles: ["traps_lower"], points: "100,116 94,114 90,104 82,106 92,132 100,142" },
  { muscles: ["teres_major"], points: "80,94 82,106 76,110 68,104 70,100" },
  { muscles: ["lats"], points: "68,104 76,110 82,106 92,132 92,142 84,160 74,143 68,119" },
  { muscles: ["erectors"], points: "93,136 100,144 100,180 84,180 86,162 93,148" },
  { muscles: ["triceps_long"], points: "58,102 66,101 65,138 60,140" },
  { muscles: ["triceps_lateral"], points: "50,103 58,102 59,124 48,124" },
  { muscles: ["triceps_medial"], points: "48,124 59,124 60,140 56,141" },
  { muscles: ["brachioradialis"], points: "47,145 54,144 50,170 44,162" },
  { muscles: ["wrist_extensors"], points: "54,144 64,143 59,192 45,192 50,170" },
  { muscles: ["glute_med", "glute_min"], points: "71,178 92,180 86,188 74,196 70,190" },
  { muscles: ["glute_max"], points: "74,196 86,188 92,180 99,185 99,222 86,226 74,217 70,199" },
  { muscles: ["biceps_femoris"], points: "71,229 83,229 82,260 80,288 76,287 69,257" },
  { muscles: ["adductor_magnus"], points: "83,229 98,227 97,240 86,236 83,236" },
  { muscles: ["semitendinosus"], points: "83,236 86,236 97,240 96,283 84,289 80,288 82,260" },
  { muscles: ["gastrocnemius"], points: "71,307 98,307 94,338 84,342 76,338 69,325" },
  { muscles: ["soleus"], points: "69,325 76,338 84,342 94,338 94,352 84,357 76,351" },
];

function mirror(points: string): string {
  return points
    .split(" ")
    .map((p) => {
      const [x, y] = p.split(",").map(Number);
      return `${W - x},${y}`;
    })
    .join(" ");
}

const COLOR = {
  skin: "#2a303a",
  idle: "#434c5b",
  primary: "#ff4d5e",
  secondary: "#ffa24a",
  outline: "#0b0d10",
};

/** Mengt de "niet getraind"-kleur met rood, t = 0..1. */
function heat(t: number): string {
  const a = [0x43, 0x4c, 0x5b];
  const b = [0xff, 0x4d, 0x5e];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  return `rgb(${c.join(",")})`;
}

type Props = {
  primary?: MuscleId[];
  secondary?: MuscleId[];
  /** Intensiteit per spier (0..1) voor een heatmap, i.p.v. primary/secondary. */
  intensity?: Partial<Record<MuscleId, number>>;
  className?: string;
  labels?: boolean;
};

export function BodyMap({ primary = [], secondary = [], intensity, className = "", labels = true }: Props) {
  function fill(muscles: MuscleId[]) {
    if (intensity) {
      const t = Math.max(0, ...muscles.map((m) => intensity[m] ?? 0));
      return t > 0 ? heat(0.25 + 0.75 * t) : COLOR.idle;
    }
    if (muscles.some((m) => primary.includes(m))) return COLOR.primary;
    if (muscles.some((m) => secondary.includes(m))) return COLOR.secondary;
    return COLOR.idle;
  }

  function figure(shapes: Shape[], dx: number, title: string) {
    return (
      <g transform={`translate(${dx},0)`}>
        <ellipse cx={100} cy={28} rx={16} ry={20} fill={COLOR.skin} />
        {[...BASE_COMMON, ...BASE_COMMON.map(mirror)].map((p, i) => (
          <polygon key={`b${i}`} points={p} fill={COLOR.skin} stroke={COLOR.skin} strokeWidth={4} strokeLinejoin="round" />
        ))}
        <ellipse cx={50} cy={207} rx={8} ry={11} fill={COLOR.skin} />
        <ellipse cx={150} cy={207} rx={8} ry={11} fill={COLOR.skin} />
        {shapes.flatMap((s, i) => {
          const name = s.muscles.map((m) => MUSCLE_BY_ID[m].short).join(", ");
          const props = { fill: fill(s.muscles), stroke: COLOR.outline, strokeWidth: 1.2, strokeLinejoin: "round" as const };
          return [
            <polygon key={`l${i}`} points={s.points} {...props}>
              <title>{name}</title>
            </polygon>,
            <polygon key={`r${i}`} points={mirror(s.points)} {...props}>
              <title>{name}</title>
            </polygon>,
          ];
        })}
        {labels && (
          <text x={100} y={414} textAnchor="middle" fontSize={13} fill="#9aa1ab" fontFamily="inherit">
            {title}
          </text>
        )}
      </g>
    );
  }

  return (
    <svg viewBox={`0 0 ${W * 2 + 20} ${labels ? 422 : 400}`} className={className} role="img" aria-label="Spierkaart">
      {figure(FRONT, 0, "Voorkant")}
      {figure(BACK, W + 20, "Achterkant")}
    </svg>
  );
}

export function BodyMapLegend() {
  return (
    <div className="flex justify-center gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR.primary }} />
        Hoofdspier
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR.secondary }} />
        Helpt mee
      </span>
    </div>
  );
}
