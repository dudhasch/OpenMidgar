/**
 * CharakterListe — Sidebar des Charakter-Editors (charaktere.md Sektion 1).
 * Zeilen mit Avatar-Quadrat, Modell-Quellen-Chip und Auftritte-Zähler;
 * Stagger beim Laden, aktive Zeile mit Mako-Kante; EmptyState bei leerer
 * Liste; Löschen mit AlertDialog + Undo-Toast.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Trash2, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import EmptyState from '@/components/shared/EmptyState';
import RefBadge from '@/components/shared/RefBadge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface CharakterEintrag {
  id: string;
  name: string;
  /** Modell-Quelle: lgp-Referenz oder Textur-Override. */
  quelle: { art: 'referenz'; ref: string } | { art: 'textur'; asset: string };
  auftritte: number;
}

interface CharakterListeProps {
  charaktere: CharakterEintrag[];
  aktivId: string | null;
  onWaehlen: (id: string) => void;
  /** Öffnet den Erzeugungs-Wizard (MS17 — Default-Einstieg in beiden Modi). */
  onNeu: () => void;
  /** Nur im Profi-Modus gesetzt: Plus-Button erhält Dropdown mit „Leer anlegen (Profi)". */
  onLeerAnlegen?: () => void;
  onLoeschen: (id: string) => void;
}

export default function CharakterListe({ charaktere, aktivId, onWaehlen, onNeu, onLeerAnlegen, onLoeschen }: CharakterListeProps) {
  const [loeschKandidat, setLoeschKandidat] = useState<CharakterEintrag | null>(null);

  const bestaetigeLoeschen = () => {
    if (!loeschKandidat) return;
    const geloescht = loeschKandidat;
    onLoeschen(geloescht.id);
    setLoeschKandidat(null);
    toast(`Charakter „${geloescht.name}" gelöscht`, {
      description: `${geloescht.auftritte} Auftritt${geloescht.auftritte === 1 ? '' : 'e'} entfernt.`,
      action: { label: 'Rückgängig', onClick: () => toast.info('Wiederherstellung folgt mit dem Projektspeicher.') },
    });
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-subtle bg-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-subtle px-3">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-secondary">
          Charaktere
        </span>
        {onLeerAnlegen ? (
          /* Profi-Modus: Wizard bleibt Default, „Leer anlegen" im Dropdown (MS17 §2) */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Neuer Charakter"
                className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-mako"
              >
                <Plus className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-subtle bg-popover">
              <DropdownMenuItem onClick={onNeu}>Wizard starten</DropdownMenuItem>
              <DropdownMenuItem onClick={onLeerAnlegen}>Leer anlegen (Profi)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            onClick={onNeu}
            aria-label="Neuer Charakter"
            title="Neuer NPC (Wizard)"
            className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-mako"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {charaktere.length === 0 ? (
          <EmptyState
            icon={UserRound}
            titel="Keine Charaktere"
            hinweis="Lege einen NPC an — als Referenz auf ein Original-Modell oder mit eigener Textur."
            ctaLabel="Ersten Charakter anlegen"
            onCta={onNeu}
            className="py-10"
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            <AnimatePresence initial={false}>
              {charaktere.map((c, i) => {
                const aktiv = c.id === aktivId;
                return (
                  <motion.li
                    key={c.id}
                    initial={{ opacity: 0, y: 8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, delay: i * 0.04 }}
                    className="overflow-hidden"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onWaehlen(c.id)}
                      onKeyDown={(e) => e.key === 'Enter' && onWaehlen(c.id)}
                      className={cn(
                        'group relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150',
                        aktiv ? 'bg-mako-dim' : 'hover:bg-elevated',
                      )}
                    >
                      {aktiv && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-0.5 rounded-full bg-mako" />}
                      <motion.span
                        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-subtle bg-inset"
                        animate={aktiv ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                        transition={{ duration: 0.4 }}
                      >
                        {c.id.endsWith('/lina') ? (
                          <img src="./char-silhouette-lina.png" alt="" className="h-full w-full object-cover object-top" />
                        ) : (
                          <UserRound className="h-4 w-4 text-muted" />
                        )}
                      </motion.span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">{c.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          {c.quelle.art === 'referenz' ? (
                            <RefBadge refId={c.quelle.ref} guardHash="a3f9…c1" />
                          ) : (
                            <span className="inline-flex items-center rounded border border-mako/40 bg-mako-dim px-1.5 py-0.5 text-[10px] font-medium text-mako">
                              Textur-Override
                            </span>
                          )}
                          <span className="text-[11px] text-muted">
                            {c.auftritte} Auftritt{c.auftritte === 1 ? '' : 'e'}
                          </span>
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Charakter ${c.name} löschen`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLoeschKandidat(c);
                        }}
                        className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-error group-hover:flex"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <AlertDialog open={loeschKandidat !== null} onOpenChange={(offen) => !offen && setLoeschKandidat(null)}>
        <AlertDialogContent className="border-subtle bg-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>Charakter löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {loeschKandidat
                ? `Auch alle ${loeschKandidat.auftritte} Auftritte von „${loeschKandidat.name}" werden entfernt.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-subtle bg-transparent hover:bg-elevated">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={bestaetigeLoeschen}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
