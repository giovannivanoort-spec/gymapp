import { Avatar } from "@/components/Avatar";

/** Overlappende avatars, bijv. wie er bij een training was. */
export function AvatarStack({
  people,
  max = 4,
  size = 22,
}: {
  people: { id: string; name: string }[];
  max?: number;
  size?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center" aria-hidden>
      {shown.map((p, i) => (
        <Avatar
          key={p.id}
          id={p.id}
          name={p.name}
          size={size}
          className={i > 0 ? "-ml-1.5 ring-2 ring-surface" : "ring-2 ring-surface"}
        />
      ))}
      {rest > 0 && (
        <span
          className="-ml-1.5 inline-flex items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted ring-2 ring-surface"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
