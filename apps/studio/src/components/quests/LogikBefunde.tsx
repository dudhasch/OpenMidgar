/**
 * LogikBefunde — Befund-Panel unten im Editor (quests.md Sektion 5).
 * Beispielbefunde der Logik-Analysen (Erreichbarkeit, Wartezyklen,
 * Trigger). Klick auf einen Befund zoomt/markiert den betroffenen Knoten
 * (2s Puls-Ring) bzw. lässt die betroffene Kante amber blinken.
 */
import { AlertTriangle, Crosshair, Info } from 'lucide-react';
import type { LogikBefund } from '@/lib/quests';
import { cn } from '@/lib/utils';

interface LogikBefundeProps {
  befunde: LogikBefund[];
  aktivId: string | null;
  onFokus: (b: LogikBefund) => void;
}

const KLASSE_STIL: Record<LogikBefund['klasse'], { punkt: string; text: string }> = {
  fehler: { punkt: 'bg-error', text: 'text-error' },
  warnung: { punkt: 'bg-warn', text: 'text-warn' },
  info: { punkt: 'bg-info', text: 'text-info' },
};

export default function LogikBefunde({ befunde, aktivId, onFokus }: LogikBefundeProps) {
  return (
    <section className="flex h-32 shrink-0 flex-col border-t border-subtle bg-panel" aria-label="Logik-Befunde">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-subtle px-3">
        <span className="text-[11px] font-semibold text-foreground">Logik-Befunde</span>
        <span className="font-mono text-[10px] text-muted">
          {befunde.filter((b) => b.klasse === 'warnung').length} Warnungen ·{' '}
          {befunde.filter((b) => b.klasse === 'info').length} Info
        </span>
        <span className="ml-auto text-[10px] text-muted">Erreichbarkeit · Wartezyklen · Trigger</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {befunde.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onFokus(b)}
            className={cn(
              'flex w-full items-center gap-2.5 border-b border-subtle/50 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-elevated',
              aktivId === b.id && 'bg-mako-dim',
            )}
          >
            <span className={cn('h-2 w-2 shrink-0 rounded-full', KLASSE_STIL[b.klasse].punkt)} />
            {b.klasse === 'info' ? (
              <Info className="h-3.5 w-3.5 shrink-0 text-info" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
            )}
            <span
              className={cn(
                'shrink-0 rounded border border-subtle bg-inset px-1.5 py-px text-[10px] font-medium',
                KLASSE_STIL[b.klasse].text,
              )}
            >
              {b.analyse}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={b.meldung}>
              {b.meldung}
            </span>
            <Crosshair
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-colors duration-150',
                aktivId === b.id ? 'text-mako' : 'text-muted',
              )}
            />
          </button>
        ))}
      </div>
    </section>
  );
}
