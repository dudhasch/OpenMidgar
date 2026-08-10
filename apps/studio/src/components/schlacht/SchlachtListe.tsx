/**
 * SchlachtListe — Sidebar des Battle-Editors (schlacht.md Sektion 1, 240px).
 * Kopfzeile mit „Neue Schlacht", Suchfeld, Szenen-Zeilen (Arena-Thumb,
 * Gegner-Zusammenfassung, Arena-Badge, Verknüpfungs-Punkt) und
 * Aktivierungs-Hinweis „Battle-Modul ausstehend" am Listenende.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Plus, Search, Swords } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ARENA_ASSET, gegnerNachId, markerLabel } from '@/lib/schlacht';
import type { FormationMarker } from '@/lib/schlacht';
import type { BattleDoc } from '@webmidgar/studio-core';
import { cn } from '@/lib/utils';

export interface SchlachtEintrag {
  doc: BattleDoc;
  marker: FormationMarker[];
}

interface SchlachtListeProps {
  eintraege: SchlachtEintrag[];
  aktivId: string | null;
  onWaehlen: (id: string) => void;
  /** Öffnet den Erzeugungs-Wizard (MS17 — Default-Einstieg in beiden Modi). */
  onNeu: () => void;
  /** Nur im Profi-Modus gesetzt: Plus-Button erhält Dropdown mit „Leer anlegen (Profi)". */
  onLeerAnlegen?: () => void;
}

function gegnerZusammenfassung(marker: FormationMarker[]): string {
  const jeArt = new Map<string, number>();
  for (const m of marker) jeArt.set(m.enemyRef, (jeArt.get(m.enemyRef) ?? 0) + 1);
  const teile = [...jeArt.entries()].map(([ref, n]) => `${n}× ${gegnerNachId(ref)?.name ?? ref}`);
  return teile.length > 0 ? teile.join(', ') : 'Keine Gegner';
}

export default function SchlachtListe({ eintraege, aktivId, onWaehlen, onNeu, onLeerAnlegen }: SchlachtListeProps) {
  const [suche, setSuche] = useState('');
  const gefiltert = eintraege.filter((e) => e.doc.name.toLowerCase().includes(suche.toLowerCase()));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-subtle bg-panel">
      {/* Kopfzeile */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-subtle px-3">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-secondary">
          Schlachten
        </span>
        {onLeerAnlegen ? (
          /* Profi-Modus (MS17, vereinfachung.md §2): Plus-Button mit Dropdown —
             Wizard bleibt Default, „Leer anlegen" als Profi-Pfad. */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Neue Schlacht"
                title="Neue Schlacht (Wizard, MS17)"
                className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-subtle bg-popover">
              <DropdownMenuItem className="text-xs" onClick={onNeu}>
                Neue Schlacht (Wizard)
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={onLeerAnlegen}>
                Leer anlegen (Profi)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            onClick={onNeu}
            aria-label="Neue Schlacht"
            title="Neue Schlacht (Wizard, MS17)"
            className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Suche */}
      <div className="shrink-0 border-b border-subtle p-2">
        <div className="flex items-center gap-2 rounded-md border border-subtle bg-inset px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Schlacht suchen…"
            className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* Zeilen */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {gefiltert.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-muted">
            {eintraege.length === 0 ? 'Noch keine Schlachten.' : 'Keine Treffer.'}
          </p>
        )}
        {gefiltert.map((e, i) => {
          const aktiv = e.doc.id === aktivId;
          const verknuepft = !!e.doc.verknuepfung;
          return (
            <motion.button
              key={e.doc.id}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04, ease: 'easeOut' }}
              onClick={() => onWaehlen(e.doc.id)}
              className={cn(
                'relative mb-1 flex w-full items-center gap-2.5 rounded-md border px-2 py-2 text-left transition-colors duration-150',
                aktiv
                  ? 'border-mako/30 bg-mako-dim'
                  : 'border-transparent hover:bg-elevated',
              )}
            >
              {aktiv && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-0.5 rounded-full bg-mako" />}
              {/* Arena-Thumb 36×36 */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-subtle bg-inset">
                {e.doc.arena.art === 'nutzerbild' ? (
                  <img src={`./${ARENA_ASSET}`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Swords className="h-4 w-4 text-muted" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-foreground">{e.doc.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="truncate">{gegnerZusammenfassung(e.marker)}</span>
                  {e.doc.arena.art === 'nutzerbild' ? (
                    <span className="shrink-0 rounded border border-mako/50 px-1 py-px text-[10px] text-mako">
                      Nutzerbild
                    </span>
                  ) : (
                    <span className="shrink-0 rounded border border-engine/40 px-1 py-px font-mono text-[10px] text-engine">
                      field:…/battle-arena
                    </span>
                  )}
                  <span
                    title={verknuepft ? 'Verknüpft' : 'Nicht verknüpft'}
                    className={cn(
                      'ml-auto h-1.5 w-1.5 shrink-0 rounded-full',
                      verknuepft ? 'bg-mako' : 'border border-warn bg-transparent',
                    )}
                  />
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Aktivierungs-Hinweis */}
      <div className="shrink-0 border-t border-subtle p-3">
        <p className="text-[11px] leading-snug text-muted">
          Szenen werden paketiert; die Kampf-Aktivierung folgt mit dem Battle-Modul.
        </p>
        <span className="mt-2 inline-flex items-center gap-1 rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn">
          <Lock className="h-3 w-3" />
          Battle-Modul ausstehend
        </span>
      </div>
    </aside>
  );
}

export { markerLabel };
