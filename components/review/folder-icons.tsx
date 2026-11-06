import {
  Building2, Bus, Car, Church, Clapperboard, DoorOpen, Drama, House, LayoutGrid, MapPin, MoonStar, Sailboat,
  School, Store, TentTree, Telescope, TreePalm, UserRound, Waves, type LucideIcon,
} from "lucide-react";
import type { ReviewSection } from "@/lib/review-client";

// The folder icons the backend may name (folders[].icon, lucide names in
// kebab case). Each icon is imported by name, so only these ship.
const ICONS: Record<string, LucideIcon> = {
  "tree-palm": TreePalm,
  waves: Waves,
  house: House,
  car: Car,
  church: Church,
  "building-2": Building2,
  "door-open": DoorOpen,
  school: School,
  telescope: Telescope,
  store: Store,
  "moon-star": MoonStar,
  sailboat: Sailboat,
  bus: Bus,
  "tent-tree": TentTree,
  drama: Drama,
};

// A folder without an icon gets its section's generic one.
const FALLBACK: Record<ReviewSection, LucideIcon> = {
  locations: MapPin,
  characters: UserRound,
  scenes: Clapperboard,
};

export function FolderIcon({ name, section }: { name?: string; section: ReviewSection }) {
  const Icon = (name && ICONS[name]) || FALLBACK[section];
  return <Icon className="ic" size={16} strokeWidth={1.75} aria-hidden="true" />;
}

export function AllFoldersIcon() {
  return <LayoutGrid className="ic" size={16} strokeWidth={1.75} aria-hidden="true" />;
}
