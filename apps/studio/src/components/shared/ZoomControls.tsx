/**
 * ZoomControls — Canvas-Ecke unten rechts (design.md 5.6):
 * „-", Prozentanzeige (Klick = Reset 100%), „+", Maximize (Einpassen).
 */
import { Maximize, Minus, Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ZoomControlsProps {
  /** Zoom in Prozent (100 = 1:1). */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onEinpassen?: () => void;
  min?: number;
  max?: number;
  schritt?: number;
  className?: string;
}

export default function ZoomControls({
  zoom,
  onZoomChange,
  onEinpassen,
  min = 25,
  max = 400,
  schritt = 25,
  className,
}: ZoomControlsProps) {
  const clamp = (z: number) => Math.min(max, Math.max(min, z));
  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-md border border-subtle bg-panel/90 p-0.5 shadow-elevated backdrop-blur',
          className,
        )}
      >
        <button
          type="button"
          aria-label="Verkleinern"
          onClick={() => onZoomChange(clamp(zoom - schritt))}
          className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="h-7 min-w-12 rounded px-1 font-mono text-[11px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
              aria-label="Zoom zurücksetzen"
            >
              {zoom}%
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Auf 100% zurücksetzen</TooltipContent>
        </Tooltip>
        <button
          type="button"
          aria-label="Vergrößern"
          onClick={() => onZoomChange(clamp(zoom + schritt))}
          className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-subtle" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Einpassen"
              onClick={onEinpassen}
              className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
            >
              <Maximize className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Ansicht einpassen</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
