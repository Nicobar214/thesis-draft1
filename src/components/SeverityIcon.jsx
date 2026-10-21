import { Construction, Landmark, TreePine, Signpost, ShieldAlert, Waves, Wrench, MessageSquare } from 'lucide-react';

const ICONS = {
  road_damage: Construction,
  structural: Landmark,
  obstruction: TreePine,
  roadside: Signpost,
  // Old type keys, for anything still passing them.
  safety: ShieldAlert,
  flood: Waves,
  issue: Wrench,
  general: MessageSquare,
};

export default function SeverityIcon({ category, className = 'size-3.5' }) {
  const Icon = ICONS[category];
  if (!Icon) return null;
  return <Icon className={`${className} shrink-0`} aria-hidden="true" />;
}
