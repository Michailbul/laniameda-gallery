import type { Verdict } from "@/lib/review-client";

// Who left feedback: the owner ("owner"), each reviewer ("r1", "r2" …) and
// the studio agent ("agent"). Faces on frames, names in the open view.
// One shape for everyone (feedback().people rows fit it).

export type Person = {
  who: string;
  name: string;
  initials: string;
  title?: string;
  pictureUrl?: string;
  role: string;
  isYou: boolean;
};

const AGENT: Person = { who: "agent", name: "Studio agent", initials: "SA", title: "Michael's assistant", role: "agent", isYou: false };

// Soft tints that sit well on the night ground (teal, copper, amber, blue, rose, green).
const HUES = [192, 18, 40, 214, 352, 158, 262];
const hueOf = (who: string) => {
  let hash = 0;
  for (const char of who) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length]!;
};

export const personOf = (people: Map<string, Person>, who?: string): Person | undefined =>
  who === "agent" ? AGENT : who ? people.get(who) : undefined;

export const describe = (person: Person) =>
  `${person.isYou ? `${person.name} (you)` : person.name}${person.title ? ` · ${person.title}` : ""}`;

export function Avatar({ person, verdict, large }: { person?: Person; verdict?: Verdict; large?: boolean }) {
  const who = person?.who ?? "?";
  return (
    <span
      className={`rv-av${large ? " lg" : ""}`}
      data-v={verdict}
      style={{ "--h": hueOf(who) } as React.CSSProperties}
      aria-hidden="true"
    >
      {person?.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny avatar from Google, also served on another domain
        <img src={person.pictureUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        person?.initials ?? "?"
      )}
    </span>
  );
}

/** "Liked by A (Director · X), B" / "Disliked by C" for a frame's faces. */
export const facesTitle = (faces: Array<{ person?: Person; verdict: Verdict }>) => {
  const line = (verdict: Verdict) => {
    const names = faces.filter((face) => face.verdict === verdict && face.person).map((face) => describe(face.person!));
    return names.length ? `${verdict === "like" ? "Liked" : "Disliked"} by ${names.join(", ")}` : "";
  };
  return [line("like"), line("dislike")].filter(Boolean).join("\n");
};
