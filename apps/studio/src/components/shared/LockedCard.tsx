/**
 * LockedCard — Karte für Post-MVP-Features (design.md 2 „Gesperrt-Zustand",
 * 5.6). Inhalt bleibt lesbar (Opacity .55), Badge „Engine-Support ausstehend"
 * in warn-Outline, Tooltip mit Meilenstein-Hinweis. Nie klickbar.
 */
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface LockedCardProps {
  children: ReactNode;
  /** Meilenstein-/Vertragshinweis für den Tooltip (z. B. „MS6"). */
  hinweis?: string;
  badge?: string;
  className?: string;
}

export default function LockedCard({ children, hinweis, badge = 'Engine-Support ausstehend', className }: LockedCardProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'relative cursor-not-allowed rounded-lg border border-subtle bg-panel p-4 opacity-55 select-none',
              className,
            )}
            aria-disabled="true"
          >
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn">
              <Lock className="h-3 w-3" />
              {badge}
            </span>
            {children}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-xs">
          {hinweis ?? 'Dieses Feature ist für einen späteren Meilenstein geplant — der Zweck bleibt bewusst lesbar.'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
