/**
 * RefBadge — Referenz-/Provenienz-Chip (design.md 5.5).
 * Zeigt eine Original-ID (Mono, Engine-Blau) mit Shield-Icon.
 * Tooltip erklärt: nur referenziert, nie kopiert + guardHash-Anker.
 */
import { Shield } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface RefBadgeProps {
  /** Original-ID, z. B. `lgp:char/ACGD` oder `field:md1_1`. */
  refId: string;
  /** Restore-Guard-Anker (gekürzt, z. B. `a3f9…c1`). */
  guardHash?: string;
  className?: string;
}

export default function RefBadge({ refId, guardHash, className }: RefBadgeProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex cursor-default items-center gap-1 rounded border border-engine/40 px-1.5 py-0.5 font-mono text-[10px] text-engine',
              className,
            )}
          >
            <Shield className="h-3 w-3" />
            {refId}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-xs">
          Originalinhalt — nur referenziert, nie kopiert.
          {guardHash && (
            <>
              {' '}
              Anker: guardHash <span className="font-mono">{guardHash}</span>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
