import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function CollapsibleHeader({
  title,
  summary,
  expanded,
  onToggle,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className="collapsible-section-header"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      <span>{title}</span>
      <small>{summary}</small>
    </Button>
  );
}
