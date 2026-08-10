/**
 * ToolbarSegment — horizontale Icon-Button-Gruppen mit 1px-Trennern,
 * 28px-Buttons, Tooltips mit 150ms Delay (design.md 5.6).
 */
import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface ToolbarAktion {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  aktiv?: boolean;
  deaktiviert?: boolean;
}

interface ToolbarSegmentProps {
  /** Gruppen von Aktionen, durch 1px-Trenner getrennt. */
  gruppen: ToolbarAktion[][];
  className?: string;
}

export default function ToolbarSegment({ gruppen, className }: ToolbarSegmentProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('flex items-center gap-0 rounded-md border border-subtle bg-panel p-0.5', className)}>
        {gruppen.map((gruppe, gi) => (
          <div key={gi} className="flex items-center">
            {gi > 0 && <span className="mx-1 h-4 w-px bg-subtle" />}
            {gruppe.map((aktion, ai) => (
              <Tooltip key={ai}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={aktion.deaktiviert}
                    onClick={aktion.onClick}
                    aria-label={aktion.label}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded transition-colors duration-150',
                      aktion.aktiv
                        ? 'bg-mako-dim text-mako'
                        : 'text-secondary hover:bg-elevated hover:text-foreground',
                      aktion.deaktiviert && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-secondary',
                    )}
                  >
                    <aktion.icon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{aktion.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
