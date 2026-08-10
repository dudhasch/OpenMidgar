/**
 * EmptyState — zentrierter Leerzustand (design.md 5.6):
 * 48px-Outline-Icon (muted), Titel 15px, Hilfetext 13px secondary, Primary-CTA.
 */
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  titel: string;
  hinweis: string;
  ctaLabel?: string;
  onCta?: () => void;
  className?: string;
}

export default function EmptyState({ icon: Icon, titel, hinweis, ctaLabel, onCta, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <Icon className="h-12 w-12 text-muted" strokeWidth={1.25} />
      <h3 className="mt-2 font-display text-[15px] font-semibold">{titel}</h3>
      <p className="max-w-sm text-[13px] text-secondary">{hinweis}</p>
      {ctaLabel && onCta && (
        <Button size="sm" className="mt-3 bg-mako text-primary-foreground hover:bg-mako-hover" onClick={onCta}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}
