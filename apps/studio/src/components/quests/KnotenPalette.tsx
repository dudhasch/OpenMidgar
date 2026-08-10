/**
 * KnotenPalette — linke Palette mit 9 Opcode-Kategorien (quests.md
 * Sektion 1, Tab „Palette"). Aufklappbare Gruppen (Accordion, 180ms),
 * Drag & Drop auf den Canvas + Doppelklick = an Canvas-Mitte.
 * Gesperrte Kategorien (Engine-Support ausstehend): Inhalt lesbar,
 * Opacity .55, kein Drag, Cursor not-allowed, warn-Outline-Badge.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Hourglass, Lock, Square } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { KATEGORIEN } from '@/lib/quests';
import type { KategorieMeta, OpcodeVorlage } from '@/lib/quests';
import type { ScriptKategorie } from '@webmidgar/studio-core';
import { cn } from '@/lib/utils';

export interface PaletteDragPayload {
  kategorie: ScriptKategorie;
  op: string;
  blockierend: boolean;
}

export const DRAG_MIME = 'application/x-webmidgar-opcode';

interface KnotenPaletteProps {
  /** Doppelklick auf eine Vorlage → Knoten an Canvas-Mitte. */
  onHinzufuegen: (payload: PaletteDragPayload) => void;
}

function FormMiniatur({ blockierend, farbe }: { blockierend: boolean; farbe: string }) {
  return blockierend ? (
    <Hourglass className="h-3 w-3 shrink-0" style={{ color: 'var(--warn)' }} />
  ) : (
    <Square className="h-3 w-3 shrink-0" style={{ color: farbe }} />
  );
}

function VorlagenKarte({
  kategorie,
  vorlage,
  gesperrt,
  onHinzufuegen,
}: {
  kategorie: ScriptKategorie;
  vorlage: OpcodeVorlage;
  gesperrt: boolean;
  onHinzufuegen: (payload: PaletteDragPayload) => void;
}) {
  const farbe = KATEGORIEN.find((k) => k.id === kategorie)?.farbe ?? 'var(--text-muted)';
  return (
    <div
      draggable={!gesperrt}
      onDragStart={(e) => {
        if (gesperrt) return;
        const payload: PaletteDragPayload = { kategorie, op: vorlage.op, blockierend: vorlage.blockierend };
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDoubleClick={() => !gesperrt && onHinzufuegen({ kategorie, op: vorlage.op, blockierend: vorlage.blockierend })}
      className={cn(
        'flex items-center gap-2 rounded border border-subtle bg-inset px-2 py-1.5 transition-all duration-150',
        gesperrt
          ? 'cursor-not-allowed'
          : 'cursor-grab hover:border-strong hover:bg-elevated active:cursor-grabbing',
      )}
      title={gesperrt ? undefined : `${vorlage.beschreibung} — ziehen oder doppelklicken`}
    >
      <FormMiniatur blockierend={vorlage.blockierend} farbe={farbe} />
      <span className="font-mono text-[11px] font-medium text-foreground">{vorlage.op}</span>
      <span className="ml-auto truncate text-[10px] text-muted">{vorlage.beschreibung}</span>
    </div>
  );
}

function KategorieGruppe({ meta, onHinzufuegen }: { meta: KategorieMeta; onHinzufuegen: (p: PaletteDragPayload) => void }) {
  const [offen, setOffen] = useState(!meta.gesperrt && (meta.id === 'kontrollfluss' || meta.id === 'dialog'));

  const kopf = (
    <button
      type="button"
      onClick={() => setOffen((v) => !v)}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-elevated',
        meta.gesperrt && 'opacity-80',
      )}
    >
      <motion.span animate={{ rotate: offen ? 0 : -90 }} transition={{ duration: 0.18 }}>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </motion.span>
      <span className="h-2 w-2 rounded-full" style={{ background: meta.farbe }} />
      <span className="text-[12px] font-medium text-foreground">{meta.name}</span>
      <span className="font-mono text-[10px] text-muted">{meta.vorlagen.length}</span>
      {meta.gesperrt && (
        <span className="ml-auto inline-flex items-center gap-1 rounded border border-warn px-1 py-px text-[10px] font-medium text-warn">
          <Lock className="h-2.5 w-2.5" />
          Engine-Support ausstehend
        </span>
      )}
    </button>
  );

  return (
    <div className="border-b border-subtle/60 pb-1 last:border-b-0">
      {meta.gesperrt ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-not-allowed">{kopf}</div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-56 text-xs">
              Diese Opcode-Kategorie ist in der Engine noch nicht verdrahtet (Post-MVP).
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        kopf
      )}
      <AnimatePresence initial={false}>
        {offen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className={cn('space-y-1 px-2 pb-1.5 pt-1', meta.gesperrt && 'opacity-55 select-none')}>
              {meta.vorlagen.map((v) => (
                <VorlagenKarte
                  key={v.op}
                  kategorie={meta.id}
                  vorlage={v}
                  gesperrt={meta.gesperrt}
                  onHinzufuegen={onHinzufuegen}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function KnotenPalette({ onHinzufuegen }: KnotenPaletteProps) {
  return (
    <div className="space-y-0.5 p-2">
      <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.06em] text-muted">
        Opcode-Kategorien
      </p>
      {KATEGORIEN.map((meta) => (
        <KategorieGruppe key={meta.id} meta={meta} onHinzufuegen={onHinzufuegen} />
      ))}
    </div>
  );
}
