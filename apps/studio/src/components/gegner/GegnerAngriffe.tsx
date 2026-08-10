/**
 * GegnerAngriffe — Tab „Angriffe" (gegner.md Sektion 4):
 * Kartenliste (dragbar, Reorder.Group) mit Effekt-Baukasten aus der
 * geschlossenen MS11-Taxonomie (Ziel/Effekt-Art/Stärke/Element/Status/
 * Trefferquote/Kosten — keine Freitexte) und live generierter deutscher
 * Vorschauzeile pro Angriff. Mako-Primär-CTA: „Angriff hinzufügen".
 */
import { useRef } from 'react';
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { GripVertical, Info, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EFFECT_ARTEN, STATUSWERTE } from '@webmidgar/studio-core';
import type { EffectArt, EffectZiel, Element, StatusWert } from '@webmidgar/studio-core';
import {
  EFFECT_ART_LABELS,
  EFFECT_ZIEL_LABELS,
  ELEMENT_LABELS,
  GEGNER_ZIELE,
  MATRIX_ELEMENTE,
  STATUS_LABELS,
  angriffsVorschau,
} from '@/lib/gegner';
import type { AngriffUi, GegnerUi, StaerkeModus } from '@/lib/gegner';
import { cn } from '@/lib/utils';

let angriffZaehler = 1;

interface GegnerAngriffeProps {
  gegner: GegnerUi;
  onPatch: (patch: Partial<GegnerUi>) => void;
}

const MIT_ELEMENT: EffectArt[] = ['schaden', 'heil_hp', 'heil_mp'];

function AngriffKarte({
  angriff,
  onChange,
  onLoeschen,
}: {
  angriff: AngriffUi;
  onChange: (patch: Partial<AngriffUi>) => void;
  onLoeschen: () => void;
}) {
  const dragControls = useDragControls();

  const setArt = (art: EffectArt) => {
    const patch: Partial<AngriffUi> = { art };
    if (!MIT_ELEMENT.includes(art)) patch.element = undefined;
    if (art !== 'status_setzen' && art !== 'status_heilen' && art !== 'schaden') {
      patch.status = undefined;
      patch.trefferquote = undefined;
    }
    if (art === 'status_setzen') {
      patch.status = angriff.status ?? 'blind';
      patch.trefferquote = angriff.trefferquote ?? 0.3;
    }
    onChange(patch);
  };

  const labelCls = 'mb-1 block text-[10px] uppercase tracking-[0.04em] text-muted';

  return (
    <Reorder.Item
      value={angriff}
      dragListener={false}
      dragControls={dragControls}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22 }}
      className="overflow-hidden rounded-lg border border-subtle bg-elevated"
    >
      {/* Kopf */}
      <div className="flex items-center gap-2 border-b border-subtle px-2.5 py-2">
        <button
          type="button"
          aria-label="Angriff verschieben"
          onPointerDown={(e) => dragControls.start(e)}
          className="cursor-grab text-muted transition-colors duration-150 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={angriff.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-7 w-40 border-transparent bg-transparent px-1 text-[13px] font-medium hover:border-subtle focus:border-subtle"
        />
        <code className="hidden truncate font-mono text-[10px] text-muted sm:block">{angriff.id}</code>
        <span className="ml-auto rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[10px] text-secondary">
          {angriff.kosten} MP
        </span>
        <button
          type="button"
          aria-label={`Angriff ${angriff.name} löschen`}
          onClick={onLoeschen}
          className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-panel hover:text-error"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Effekt-Baukasten */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-3 py-2.5 lg:grid-cols-4">
        <div>
          <span className={labelCls}>Ziel</span>
          <Select value={angriff.ziel} onValueChange={(v) => onChange({ ziel: v as EffectZiel })}>
            <SelectTrigger className="h-8 border-subtle bg-inset font-mono text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-subtle bg-popover">
              {GEGNER_ZIELE.map((z) => (
                <SelectItem key={z} value={z} className="font-mono text-[11px]">
                  {z}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="mt-0.5 block text-[10px] text-muted">{EFFECT_ZIEL_LABELS[angriff.ziel]}</span>
        </div>

        <div>
          <span className={cn(labelCls, 'flex items-center gap-1')}>
            Effekt-Art
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 cursor-help text-muted" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-xs">
                  Versioniertes Effekt-Schema — die Engine verweigert unbekannte Einträge mit Diagnose (ADR-020).
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
          <Select value={angriff.art} onValueChange={(v) => setArt(v as EffectArt)}>
            <SelectTrigger className="h-8 border-subtle bg-inset font-mono text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-subtle bg-popover">
              {EFFECT_ARTEN.map((a) => (
                <SelectItem key={a} value={a} className="font-mono text-[11px]">
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="mt-0.5 block text-[10px] text-muted">{EFFECT_ART_LABELS[angriff.art]}</span>
        </div>

        <div>
          <span className={labelCls}>Stärke</span>
          <div className="flex gap-1">
            <div className="flex overflow-hidden rounded border border-subtle">
              {(['fest', 'prozent', 'faktor'] as StaerkeModus[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ staerke: { modus: m, wert: angriff.staerke.wert } })}
                  className={cn(
                    'px-1.5 py-1 font-mono text-[10px] transition-colors duration-150',
                    angriff.staerke.modus === m ? 'bg-mako-dim text-mako' : 'bg-inset text-muted hover:text-secondary',
                  )}
                >
                  {m === 'fest' ? 'fest' : m === 'prozent' ? '%' : '×'}
                </button>
              ))}
            </div>
            <Input
              type="number"
              step={angriff.staerke.modus === 'faktor' ? 0.1 : 1}
              value={angriff.staerke.wert}
              onChange={(e) => onChange({ staerke: { modus: angriff.staerke.modus, wert: Number(e.target.value) || 0 } })}
              className="h-8 min-w-0 flex-1 border-subtle bg-inset px-1.5 font-mono text-[11px]"
            />
          </div>
        </div>

        <div>
          <span className={labelCls}>Kosten (MP)</span>
          <Input
            type="number"
            min={0}
            value={angriff.kosten}
            onChange={(e) => onChange({ kosten: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            className="h-8 border-subtle bg-inset px-1.5 font-mono text-[11px]"
          />
        </div>

        {/* Konditional: Element */}
        <AnimatePresence initial={false}>
          {MIT_ELEMENT.includes(angriff.art) && (
            <motion.div
              key="element"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <span className={labelCls}>Element</span>
              <Select
                value={angriff.element ?? 'keins'}
                onValueChange={(v) => onChange({ element: v === 'keins' ? undefined : (v as Element) })}
              >
                <SelectTrigger className="h-8 border-subtle bg-inset font-mono text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-subtle bg-popover">
                  <SelectItem value="keins" className="text-[11px] text-muted">
                    — keins —
                  </SelectItem>
                  {MATRIX_ELEMENTE.map((el) => (
                    <SelectItem key={el} value={el} className="font-mono text-[11px]">
                      {ELEMENT_LABELS[el]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Konditional: Status + Trefferquote */}
        <AnimatePresence initial={false}>
          {(angriff.art === 'status_setzen' || angriff.art === 'status_heilen') && (
            <motion.div
              key="status"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="col-span-2 overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls}>Status</span>
                  <Select value={angriff.status ?? 'blind'} onValueChange={(v) => onChange({ status: v as StatusWert })}>
                    <SelectTrigger className="h-8 border-subtle bg-inset font-mono text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-subtle bg-popover">
                      {STATUSWERTE.map((s) => (
                        <SelectItem key={s} value={s} className="font-mono text-[11px]">
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {angriff.art === 'status_setzen' && (
                  <div>
                    <span className={labelCls}>
                      Trefferquote <span className="font-mono text-foreground">{Math.round((angriff.trefferquote ?? 0.3) * 100)} %</span>
                    </span>
                    <Slider
                      value={[Math.round((angriff.trefferquote ?? 0.3) * 100)]}
                      min={0}
                      max={100}
                      step={5}
                      onValueChange={([v]) => onChange({ trefferquote: (v ?? 30) / 100 })}
                      className="mt-2.5"
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Vorschauzeile */}
      <div className="border-t border-subtle bg-inset px-3 py-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={angriffsVorschau(angriff)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="text-[13px] text-secondary"
          >
            {angriffsVorschau(angriff)}
          </motion.p>
        </AnimatePresence>
      </div>
    </Reorder.Item>
  );
}

export default function GegnerAngriffe({ gegner, onPatch }: GegnerAngriffeProps) {
  const loeschPuffer = useRef<{ angriff: AngriffUi; index: number } | null>(null);

  const angriffNeu = () => {
    const n = angriffZaehler++;
    const kurz = gegner.id.split('/').pop() ?? 'gegner';
    const neu: AngriffUi = {
      id: `angriff:${kurz}/neu_${n}`,
      name: `Angriff ${n}`,
      art: 'schaden',
      ziel: 'wahl_einzeln',
      staerke: { modus: 'faktor', wert: 1.0 },
      kosten: 0,
    };
    onPatch({ angriffe: [...gegner.angriffe, neu] });
  };

  const angriffAendern = (index: number, patch: Partial<AngriffUi>) => {
    onPatch({ angriffe: gegner.angriffe.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  };

  const angriffLoeschen = (index: number) => {
    const entfernt = gegner.angriffe[index];
    if (!entfernt) return;
    loeschPuffer.current = { angriff: entfernt, index };
    onPatch({ angriffe: gegner.angriffe.filter((_, i) => i !== index) });
    toast(`„${entfernt.name}" entfernt`, {
      action: {
        label: 'Rückgängig',
        onClick: () => {
          const puffer = loeschPuffer.current;
          if (!puffer) return;
          const liste = [...gegner.angriffe];
          liste.splice(Math.min(puffer.index, liste.length), 0, puffer.angriff);
          onPatch({ angriffe: liste });
          loeschPuffer.current = null;
        },
      },
    });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">
          Angriffe · {gegner.angriffe.length}
        </h3>
        <button
          type="button"
          onClick={angriffNeu}
          className="flex items-center gap-1.5 rounded bg-mako px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-mako-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          Angriff hinzufügen
        </button>
      </div>

      <Reorder.Group axis="y" values={gegner.angriffe} onReorder={(neu) => onPatch({ angriffe: neu })} className="flex flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {gegner.angriffe.map((a, i) => (
            <AngriffKarte key={a.id} angriff={a} onChange={(p) => angriffAendern(i, p)} onLoeschen={() => angriffLoeschen(i)} />
          ))}
        </AnimatePresence>
      </Reorder.Group>

      {gegner.angriffe.length === 0 && (
        <p className="mt-2 rounded border border-dashed border-subtle px-3 py-4 text-center text-[12px] text-muted">
          Keine Angriffe — der Gegner kann nicht kämpfen.
        </p>
      )}
    </div>
  );
}
