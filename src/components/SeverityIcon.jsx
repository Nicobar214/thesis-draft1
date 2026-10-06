import { ShieldAlert, Waves, Wrench, MessageSquare } from 'lucide-react';

const ICONS = {
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
