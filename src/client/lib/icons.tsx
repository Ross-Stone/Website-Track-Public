// Lucide icons (TECH-01). Activity types store a Lucide name from ACTIVITY_ICONS; this maps names to
// components so only the icons we use are bundled.
import {
  Apple,
  Backpack,
  Baby,
  Bath,
  BedDouble,
  Bike,
  BookOpen,
  Carrot,
  Clock,
  Cookie,
  Droplet,
  Footprints,
  GlassWater,
  Heart,
  Milk,
  Moon,
  Music,
  Paintbrush,
  Pill,
  Puzzle,
  Ruler,
  School,
  Shirt,
  Soup,
  Star,
  Sun,
  Thermometer,
  Ticket,
  Trophy,
  Utensils,
  Waves,
  Weight,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import type { ActivityIcon } from '../../shared/constants';

export const ACTIVITY_ICON_COMPONENTS: Record<ActivityIcon, LucideIcon> = {
  'bed-double': BedDouble,
  moon: Moon,
  sun: Sun,
  soup: Soup,
  milk: Milk,
  apple: Apple,
  carrot: Carrot,
  utensils: Utensils,
  cookie: Cookie,
  'glass-water': GlassWater,
  bath: Bath,
  school: School,
  backpack: Backpack,
  trophy: Trophy,
  ticket: Ticket,
  droplet: Droplet,
  shirt: Shirt,
  pill: Pill,
  thermometer: Thermometer,
  weight: Weight,
  ruler: Ruler,
  baby: Baby,
  music: Music,
  bike: Bike,
  footprints: Footprints,
  'book-open': BookOpen,
  paintbrush: Paintbrush,
  waves: Waves,
  puzzle: Puzzle,
  heart: Heart,
  star: Star,
  clock: Clock,
};

/** Human label for an icon name, for the icon picker's accessible names. */
export function iconLabel(name: string): string {
  return name
    .split('-')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function activityIcon(name: string): LucideIcon {
  return ACTIVITY_ICON_COMPONENTS[name as ActivityIcon] ?? Star;
}

/** Renders the Lucide icon for an activity's icon name. */
export function ActivityGlyph({
  name,
  size,
  strokeWidth = 1.9,
}: {
  name: string;
  size: number;
  strokeWidth?: number;
}) {
  return createElement(activityIcon(name), { size, strokeWidth, 'aria-hidden': true });
}
