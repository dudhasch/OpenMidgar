/**
 * GegnerListe — Sidebar des Gegner-Editors (gegner.md Sektion 1):
 * Kopfzeile mit „Neuer Gegner", Suchfeld, Formation-Tag-Filter-Chips,
 * Gegner-Zeilen (Avatar-Silhouette, Modell-Quellen-Chip, Level, Tags)
 * und der Aktivierungs-Hinweis „Battle-Modul ausstehend" am Listenende.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, Lock, Plus, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FORMATION_TAGS } from '@/lib/gegner';
import type { GegnerUi } from '@/lib/gegner';
import { cn } from '@/lib/utils';

interface GegnerListeProps {
  gegner: GegnerUi[];
  aktivId: string | null;
  onWaehlen: (id: string) => void;
  /** Öffnet den Erzeugungs-Wizard (MS17 — Default-Einstieg in beiden Modi). */
  onNeu: () => void;
  /** Nur im Profi-Modus gesetzt: Plus-Button erhält Dropdown mit „Leer anlegen (Profi)". */
  onLeerAnlegen?: () => void;
}

export default function GegnerListe({ gegner, aktivId, onWaehlen, onNeu, onLeerAnlegen }: GegnerListeProps) {
  const [suche, setSuche] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const gefiltert = useMemo(
    () =>
      gegner.filter((g) => {
        if (tagFilter && !g.formationTags.includes(tagFilter)) return false;
        if (suche && !g.name.toLowerCase().includes(suche.toLowerCase())) return false;
        return true;
      }),
    [gegner, suche, tagFilter],
  );

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-subtle bg-panel">
      {/* Kopfzeile */}
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2.5">
        <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">Gegner</h2>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              {onLeerAnlegen ? (
                /* Profi-Modus (MS17, vereinfachung.md §2): Plus-Button mit
                   Dropdown — Wizard bleibt Default, „Leer anlegen" als Profi-Pfad. */
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Neuer Gegner"
                      className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-mako"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-subtle bg-popover">
                    <DropdownMenuItem className="text-xs" onClick={onNeu}>
                      Neuer Gegner (Wizard)
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-xs" onClick={onLeerAnlegen}>
                      Leer anlegen (Profi)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  aria-label="Neuer Gegner"
                  onClick={onNeu}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-mako"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              Neuer Gegner (Wizard aus MS17)
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Suche + Filter */}
      <div className="border-b border-subtle px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Gegner suchen…"
            className="h-7 border-subtle bg-inset pl-7 text-[13px]"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {FORMATION_TAGS.map((tag) => {
            const aktiv = tagFilter === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(aktiv ? null : tag)}
                className={cn(
                  'rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-150',
                  aktiv
                    ? 'border-mako/60 bg-mako-dim text-mako'
                    : 'border-subtle text-muted hover:border-strong hover:text-secondary',
                )}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {/* Zeilen */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <AnimatePresence initial={true}>
          {gefiltert.map((g, i) => {
            const aktiv = g.id === aktivId;
            const tags = g.formationTags.slice(0, 2);
            const rest = g.formationTags.length - tags.length;
            return (
              <motion.button
                key={g.id}
                type="button"
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
                onClick={() => onWaehlen(g.id)}
                className={cn(
                  'relative flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150',
                  aktiv ? 'bg-mako-dim' : 'hover:bg-elevated',
                )}
              >
                {aktiv && <span className="absolute left-0 top-0 h-full w-0.5 bg-mako" />}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-subtle bg-inset">
                  <img src={g.avatar} alt={`Silhouette ${g.name}`} className="h-full w-full object-contain" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">{g.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {g.modell.art === 'referenz' ? (
                      <span className="max-w-[110px] truncate rounded border border-engine/40 px-1 font-mono text-[9px] text-engine">
                        {g.modell.ref}
                      </span>
                    ) : (
                      <span className="rounded border border-mako/50 bg-mako-dim px-1 font-mono text-[9px] text-mako">
                        Textur
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-muted">Lvl {g.stats.level}</span>
                    {tags.map((t) => (
                      <span key={t} className="rounded border border-subtle px-1 font-mono text-[9px] text-muted">
                        {t}
                      </span>
                    ))}
                    {rest > 0 && <span className="font-mono text-[9px] text-muted">+{rest}</span>}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
        {gefiltert.length === 0 && (
          <p className="px-3 py-4 text-center text-[11px] text-muted">Keine Gegner für diesen Filter.</p>
        )}
      </div>

      {/* Aktivierungs-Hinweis */}
      <div className="border-t border-subtle px-3 py-2.5">
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Gegner werden paketiert; die Kampf-Aktivierung folgt mit dem Battle-Modul.
        </p>
        <span className="mt-1.5 inline-flex items-center gap-1 rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn">
          <Lock className="h-3 w-3" />
          Battle-Modul ausstehend
        </span>
      </div>
    </aside>
  );
}
