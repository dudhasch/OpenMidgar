/**
 * EintragsListe — Hauptbereich links (dialoge.md Sektion 2).
 * Zeilen (56px) mit Index, Sprecher-Chip, Textvorschau und Steuerelement-
 * Mini-Icons. Original-Referenzzeilen schreibgeschützt (Schloss-Optik) mit
 * „Ersetzen"-Flow: verwandelt sich animiert in einen Delta-Eintrag
 * (guardHash-Chip, Hinweis „Originaltext wird nicht gespeichert").
 * Umsortieren per Framer Motion Reorder (Drag-Handle).
 */
import { useState } from 'react';
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { ArrowUpDown, GripVertical, List, Lock, MessageSquarePlus, MoreHorizontal, Palette, Pause, Variable } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import EmptyState from '@/components/shared/EmptyState';
import RefBadge from '@/components/shared/RefBadge';
import type { DialogDokument, DialogEintrag, OriginalZeile } from '@/lib/dialoge';
import { ersteZeile, kurzHash, tokenDesEintrags } from '@/lib/dialoge';
import { cn } from '@/lib/utils';

export type Zeile = { typ: 'eintrag'; eintrag: DialogEintrag } | { typ: 'referenz'; ref: OriginalZeile };

export function zeilenId(z: Zeile): string {
  return z.typ === 'eintrag' ? z.eintrag.id : z.ref.id;
}

interface EintragsListeProps {
  doc: DialogDokument;
  zeilen: Zeile[];
  aktivId: string | null;
  onWaehlen: (id: string) => void;
  onReorder: (zeilen: Zeile[]) => void;
  onErsetzen: (refId: string) => void;
  onNeu: () => void;
  onSortieren: () => void;
  sortiert: boolean;
  onDuplizieren: (id: string) => void;
  onLoeschen: (id: string) => void;
}

const TOKEN_ICON = { farbe: Palette, pause: Pause, variable: Variable, auswahl: List } as const;

export default function EintragsListe({
  doc,
  zeilen,
  aktivId,
  onWaehlen,
  onReorder,
  onErsetzen,
  onNeu,
  onSortieren,
  sortiert,
  onDuplizieren,
  onLoeschen,
}: EintragsListeProps) {
  const [loeschZiel, setLoeschZiel] = useState<DialogEintrag | null>(null);

  return (
    <section className="flex h-full min-w-0 flex-col bg-app" aria-label="Eintragsliste">
      {/* Kopfzeile */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-subtle bg-panel px-3">
        <span className="truncate font-mono text-xs text-engine" title={`${doc.pfad}/${doc.locale}`}>
          {doc.pfad}/{doc.locale}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Einzige Mako-Primär-CTA der Ansicht (MS17 §4): „Neuer Eintrag" */}
                <button
                  type="button"
                  onClick={onNeu}
                  className="flex h-6 items-center gap-1 rounded bg-mako px-2 text-[11px] font-semibold text-primary-foreground transition-colors duration-150 hover:bg-mako-hover"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" /> Neuer Eintrag
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Neuen Eintrag anlegen</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onSortieren}
                  aria-pressed={sortiert}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded transition-colors duration-150',
                    sortiert ? 'bg-mako-dim text-mako' : 'text-secondary hover:bg-elevated hover:text-foreground',
                  )}
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{sortiert ? 'Original-Reihenfolge' : 'Nach Sprecher sortieren'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Weitere Aktionen"
                className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-subtle bg-popover text-foreground">
              <DropdownMenuItem
                disabled={!aktivId}
                onClick={() => aktivId && onDuplizieren(aktivId)}
                className="text-xs focus:bg-elevated"
              >
                Aktiven Eintrag duplizieren
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!aktivId}
                onClick={() => {
                  const z = zeilen.find((zl) => zl.typ === 'eintrag' && zl.eintrag.id === aktivId);
                  if (z && z.typ === 'eintrag') setLoeschZiel(z.eintrag);
                }}
                className="text-xs text-error focus:bg-elevated focus:text-error"
              >
                Aktiven Eintrag löschen
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-subtle" />
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <DropdownMenuItem disabled className="text-xs">
                        Export CSV
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">Export folgt</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Zeilen */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {zeilen.length === 0 ? (
          <EmptyState
            icon={MessageSquarePlus}
            titel="Noch keine Einträge"
            hinweis="Lege den ersten Dialog-Eintrag an — er erscheint sofort in der FF7-Vorschau."
            ctaLabel="Ersten Eintrag anlegen"
            onCta={onNeu}
          />
        ) : (
          <Reorder.Group axis="y" values={zeilen} onReorder={onReorder} className="py-1">
            <AnimatePresence initial={false}>
              {zeilen.map((z, i) => (
                <EintragsZeile
                  key={zeilenId(z)}
                  zeile={z}
                  index={i}
                  aktiv={z.typ === 'eintrag' && z.eintrag.id === aktivId}
                  doc={doc}
                  onWaehlen={onWaehlen}
                  onErsetzen={onErsetzen}
                  onLoeschen={(e) => setLoeschZiel(e)}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}
      </div>

      {/* Lösch-Dialog (Delta) */}
      <AlertDialog open={!!loeschZiel} onOpenChange={(offen) => !offen && setLoeschZiel(null)}>
        <AlertDialogContent className="border-subtle bg-panel text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-[15px]">
              {loeschZiel?.delta ? 'Delta entfernen?' : 'Eintrag löschen?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-secondary">
              {loeschZiel?.delta
                ? 'Das Original wird wieder angezeigt. Dein Delta-Text geht verloren — das Spielarchiv bleibt unverändert.'
                : `„${loeschZiel ? ersteZeile(loeschZiel).slice(0, 48) : ''}“ wird endgültig entfernt.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-subtle bg-transparent text-foreground hover:bg-elevated">
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-error text-white hover:bg-error/90"
              onClick={() => {
                if (loeschZiel) onLoeschen(loeschZiel.id);
                setLoeschZiel(null);
              }}
            >
              {loeschZiel?.delta ? 'Delta entfernen' : 'Löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ------------------------------------------------------------------ */

interface EintragsZeileProps {
  zeile: Zeile;
  index: number;
  aktiv: boolean;
  doc: DialogDokument;
  onWaehlen: (id: string) => void;
  onErsetzen: (refId: string) => void;
  onLoeschen: (e: DialogEintrag) => void;
}

function EintragsZeile({ zeile, index, aktiv, doc, onWaehlen, onErsetzen }: EintragsZeileProps) {
  const dragControls = useDragControls();

  /* --- Schreibgeschützte Original-Referenzzeile --------------------- */
  if (zeile.typ === 'referenz') {
    const { ref } = zeile;
    return (
      <Reorder.Item
        value={zeile}
        dragListener={false}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25 }}
        className="list-none px-1"
      >
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex h-14 cursor-default items-center gap-2 rounded border border-engine/15 bg-engine/[0.06] px-2"
                aria-label={`Original-Dialog #${ref.originalIndex} (schreibgeschützt)`}
              >
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-elevated px-1.5 py-px text-[10px] font-medium text-muted">{ref.sprecher}</span>
                    <span className="font-mono text-[11px] text-muted">#{String(ref.originalIndex).padStart(3, '0')}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] italic text-muted">Originaltext — nur referenziert, nicht gespeichert</p>
                </div>
                <RefBadge refId={`${doc.field.replace('field:', 'field:')}`} guardHash={ref.guardHash} className="shrink-0" />
                <button
                  type="button"
                  onClick={() => onErsetzen(ref.id)}
                  className="shrink-0 rounded border border-engine/40 px-2 py-1 text-[11px] font-medium text-engine transition-colors duration-150 hover:bg-engine/10"
                >
                  Ersetzen
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-xs">
              Originaltext — schreibgeschützt. Mit „Ersetzen“ legst du ein Delta an.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Reorder.Item>
    );
  }

  /* --- Editable Eintragszeile (ggf. frisch erzeugtes Delta) ---------- */
  const { eintrag } = zeile;
  const tokens = tokenDesEintrags(eintrag);
  const miniIcons = [...new Set(tokens.map((t) => t.art))];
  const istLeeresDelta = eintrag.delta && eintrag.seiten.every((s) => s.text.trim() === '');

  return (
    <Reorder.Item
      value={zeile}
      dragListener={false}
      dragControls={dragControls}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
      whileDrag={{ scale: 1.01, boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}
      className="list-none px-1"
    >
      <motion.div
        layout
        onClick={() => onWaehlen(eintrag.id)}
        className={cn(
          'flex min-h-14 cursor-pointer items-start gap-1.5 rounded border border-transparent px-1.5 py-1.5 transition-colors duration-150',
          aktiv ? 'border-subtle bg-mako-dim' : 'hover:bg-elevated',
          eintrag.delta && !istLeeresDelta && 'border-engine/25',
        )}
        animate={{ backgroundColor: aktiv ? 'rgba(61,220,151,0.12)' : 'rgba(0,0,0,0)' }}
        transition={{ duration: 0.25 }}
      >
        {/* Drag-Handle */}
        <button
          type="button"
          aria-label="Eintrag umsortieren"
          onPointerDown={(e) => dragControls.start(e)}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted transition-colors duration-150 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <span className="mt-0.5 w-7 shrink-0 font-mono text-[11px] text-muted">#{String(index).padStart(3, '0')}</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {eintrag.sprecher ? (
              <span className="rounded bg-mako-dim px-1.5 py-px text-[10px] font-medium text-mako">{eintrag.sprecher}</span>
            ) : (
              <span className="rounded bg-elevated px-1.5 py-px text-[10px] font-medium text-muted">Erzähler</span>
            )}
            {eintrag.delta && (
              <span className="rounded border border-engine/40 px-1 py-px font-mono text-[9px] text-engine">
                Δ {kurzHash(eintrag.delta.guardHash)}
              </span>
            )}
          </div>

          {istLeeresDelta ? (
            /* Frisch per „Ersetzen" angelegtes Delta: Hinweis statt Text */
            <div className="mt-1">
              <p className="text-[13px] italic text-secondary">Neuer Delta-Text — im Editor rechts schreiben …</p>
              <p className="mt-0.5 text-[11px] text-muted">
                Delta auf <span className="font-mono">{doc.field}</span> · Anker guardHash{' '}
                <span className="rounded bg-elevated px-1 py-px font-mono text-[10px]">{kurzHash(eintrag.delta?.guardHash ?? '')}</span>{' '}
                · Originaltext wird nicht gespeichert.
              </p>
            </div>
          ) : (
            <p className="mt-0.5 truncate text-[13px] text-foreground">{ersteZeile(eintrag) || <span className="italic text-muted">Leerer Eintrag</span>}</p>
          )}
        </div>

        {/* Steuerelement-Mini-Icons */}
        {miniIcons.length > 0 && (
          <span className="mt-0.5 flex shrink-0 items-center gap-1">
            {miniIcons.map((art) => {
              const Icon = TOKEN_ICON[art];
              return <Icon key={art} className="h-3 w-3 text-muted" aria-label={art} />;
            })}
          </span>
        )}
      </motion.div>
    </Reorder.Item>
  );
}
