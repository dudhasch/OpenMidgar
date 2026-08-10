/**
 * GegnerVerhalten — Tab „Verhalten" (gegner.md Sektion 5):
 * deklarative Prioritätenliste (ADR-024, kein Script) über der geschlossenen
 * Bedingungs-Menge. Dragbare Regel-Zeilen „WENN … DANN … Gewicht", toter-
 * Regel-Live-Warnung hinter „immer", Ablauf-Strip mit Auswertungsreihenfolge.
 * Mako-Primär-CTA: „Regel hinzufügen".
 */
import { useState } from 'react';
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { AlertTriangle, GripVertical, Info, Minus, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STATUSWERTE, VERHALTENS_BEDINGUNGEN } from '@webmidgar/studio-core';
import type { StatusWert, VerhaltensBedingungArt, VerhaltensRegel } from '@webmidgar/studio-core';
import {
  BEDINGUNG_PARAMETER,
  STATUS_LABELS,
  bedingungStandard,
  bedingungText,
  immerIndex,
} from '@/lib/gegner';
import type { GegnerUi } from '@/lib/gegner';
import { cn } from '@/lib/utils';

interface GegnerVerhaltenProps {
  gegner: GegnerUi;
  onPatch: (patch: Partial<GegnerUi>) => void;
}

/* Stabile React-Keys für Regel-Objekte (VerhaltensRegel hat keine ID im Vertrag). */
const regelIds = new WeakMap<VerhaltensRegel, string>();
let regelZaehler = 0;
function regelKey(r: VerhaltensRegel): string {
  let id = regelIds.get(r);
  if (!id) {
    id = `regel-${++regelZaehler}`;
    regelIds.set(r, id);
  }
  return id;
}

function RegelZeile({
  regel,
  index,
  tot,
  highlight,
  angriffe,
  onChange,
  onLoeschen,
  onHover,
}: {
  regel: VerhaltensRegel;
  index: number;
  tot: boolean;
  highlight: boolean;
  angriffe: { id: string; name: string }[];
  onChange: (patch: Partial<VerhaltensRegel>) => void;
  onLoeschen: () => void;
  onHover: (index: number | null) => void;
}) {
  const dragControls = useDragControls();
  const param = BEDINGUNG_PARAMETER[regel.wenn.art];

  const setBedingungsArt = (art: VerhaltensBedingungArt) => onChange({ wenn: bedingungStandard(art) });

  return (
    <Reorder.Item
      value={regel}
      dragListener={false}
      dragControls={dragControls}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-elevated transition-colors duration-200',
        highlight ? 'border-mako/60' : 'border-subtle',
      )}
    >
      {/* Toter-Regel-Warnstreifen */}
      <AnimatePresence>
        {tot && (
          <motion.span
            initial={{ x: -4, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -4, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-0 h-full w-1 bg-warn"
          />
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2 px-2.5 py-2">
      <button
        type="button"
        aria-label="Regel verschieben"
        onPointerDown={(e) => dragControls.start(e)}
        className="cursor-grab text-muted transition-colors duration-150 hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-6 shrink-0 text-center font-mono text-[12px] text-muted">#{index + 1}</span>

      <span className="shrink-0 font-mono text-[10px] uppercase text-muted">wenn</span>
      <Select value={regel.wenn.art} onValueChange={(v) => setBedingungsArt(v as VerhaltensBedingungArt)}>
        <SelectTrigger className="h-8 w-44 border-subtle bg-inset font-mono text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-subtle bg-popover">
          {VERHALTENS_BEDINGUNGEN.map((b) => (
            <SelectItem key={b} value={b} className="font-mono text-[11px]">
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Parameter-Input (morpht je Bedingung) */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={regel.wenn.art}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-1"
        >
          {param === 'prozent' && regel.wenn.art !== 'immer' && 'prozent' in regel.wenn && (
            <>
              <Input
                type="number"
                min={0}
                max={100}
                value={regel.wenn.prozent}
                onChange={(e) => onChange({ wenn: { ...regel.wenn, prozent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } as VerhaltensRegel['wenn'] })}
                className="h-8 w-16 border-subtle bg-inset px-1.5 font-mono text-[11px]"
              />
              <span className="font-mono text-[11px] text-muted">%</span>
            </>
          )}
          {param === 'n' && 'n' in regel.wenn && (
            <Input
              type="number"
              min={1}
              value={regel.wenn.n}
              onChange={(e) => onChange({ wenn: { ...regel.wenn, n: Math.max(1, Math.round(Number(e.target.value) || 1)) } as VerhaltensRegel['wenn'] })}
              className="h-8 w-16 border-subtle bg-inset px-1.5 font-mono text-[11px]"
            />
          )}
          {param === 'status' && regel.wenn.art === 'ziel_hat_status' && (
            <Select value={regel.wenn.status} onValueChange={(v) => onChange({ wenn: { art: 'ziel_hat_status', status: v as StatusWert } })}>
              <SelectTrigger className="h-8 w-32 border-subtle bg-inset font-mono text-[11px]">
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
          )}
        </motion.span>
      </AnimatePresence>

      <span className="shrink-0 font-mono text-[10px] uppercase text-muted">dann</span>
      <Select value={regel.dann} onValueChange={(v) => onChange({ dann: v })}>
        <SelectTrigger className="h-8 min-w-0 flex-1 border-subtle bg-inset text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-subtle bg-popover">
          {angriffe.map((a) => (
            <SelectItem key={a.id} value={a.id} className="text-[11px]">
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Gewicht-Stepper (data-profi) */}
      <span data-profi className="flex shrink-0 items-center gap-0.5" title="Gewicht (Tiebreak, deterministisch)">
        <button
          type="button"
          aria-label="Gewicht verringern"
          onClick={() => onChange({ gewicht: Math.max(1, regel.gewicht - 1) })}
          className="flex h-6 w-5 items-center justify-center rounded-l border border-subtle bg-inset text-muted transition-colors duration-150 hover:text-foreground"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="flex h-6 w-7 items-center justify-center border-y border-subtle bg-inset font-mono text-[11px] text-foreground">
          {regel.gewicht}
        </span>
        <button
          type="button"
          aria-label="Gewicht erhöhen"
          onClick={() => onChange({ gewicht: Math.min(10, regel.gewicht + 1) })}
          className="flex h-6 w-5 items-center justify-center rounded-r border border-subtle bg-inset text-muted transition-colors duration-150 hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
        </button>
      </span>

      <button
        type="button"
        aria-label={`Regel ${index + 1} löschen`}
        onClick={onLoeschen}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-panel hover:text-error"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      </div>

      {tot && (
        <div className="flex items-center gap-1 border-t border-warn/30 bg-warn/10 px-2.5 py-1 text-[10px] text-warn">
          <AlertTriangle className="h-2.5 w-2.5" />
          Unerreichbar: „immer" greift vorher
        </div>
      )}
    </Reorder.Item>
  );
}

export default function GegnerVerhalten({ gegner, onPatch }: GegnerVerhaltenProps) {
  const [hoverRegel, setHoverRegel] = useState<number | null>(null);
  const [profiOffen, setProfiOffen] = useState(false);
  const regeln = gegner.verhalten.regeln;
  const immerIdx = immerIndex(regeln);
  const angriffe = gegner.angriffe.map((a) => ({ id: a.id, name: a.name }));

  const regelNeu = () => {
    const fallback = gegner.angriffe[0]?.id ?? '';
    onPatch({
      verhalten: {
        art: 'prioritaeten',
        regeln: [...regeln, { wenn: bedingungStandard('hp_unter'), dann: fallback, gewicht: 5 }],
      },
    });
  };

  const regelAendern = (index: number, patch: Partial<VerhaltensRegel>) => {
    onPatch({
      verhalten: { art: 'prioritaeten', regeln: regeln.map((r, i) => (i === index ? { ...r, ...patch } : r)) },
    });
  };

  const regelLoeschen = (index: number) => {
    onPatch({ verhalten: { art: 'prioritaeten', regeln: regeln.filter((_, i) => i !== index) } });
    toast(`Regel #${index + 1} entfernt`);
  };

  return (
    /* data-profi-offen: geöffnete „Gewichte & Tiebreak"-Disclosure macht die
       Gewicht-Stepper im Einfach-Modus sichtbar (MS17, CSS-Ausnahme). */
    <div {...(profiOffen ? { 'data-profi-offen': '' } : {})}>
      <p className="mb-3 flex items-start gap-1.5 text-[13px] text-secondary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
        Verhalten ist eine geordnete Regelliste — die Engine wertet die <strong>erste zutreffende Regel</strong> aus
        (Tiebreak = Gewicht, deterministisch). Kein Script, keine Programmierung.
      </p>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">
          Prioritätenliste · {regeln.length} Regeln
        </h3>
        <button
          type="button"
          onClick={regelNeu}
          className="flex items-center gap-1.5 rounded bg-mako px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-mako-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          Regel hinzufügen
        </button>
      </div>

      <Reorder.Group
        axis="y"
        values={regeln}
        onReorder={(neu) => onPatch({ verhalten: { art: 'prioritaeten', regeln: neu } })}
        className="flex flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {regeln.map((r, i) => (
            <RegelZeile
              key={regelKey(r)}
              regel={r}
              index={i}
              tot={immerIdx >= 0 && i > immerIdx}
              highlight={hoverRegel === i}
              angriffe={angriffe}
              onChange={(p) => regelAendern(i, p)}
              onLoeschen={() => regelLoeschen(i)}
              onHover={setHoverRegel}
            />
          ))}
        </AnimatePresence>
      </Reorder.Group>

      {regeln.length === 0 && (
        <p className="mt-2 rounded border border-dashed border-subtle px-3 py-4 text-center text-[12px] text-muted">
          Keine Regeln — der Gegner verhält sich passiv.
        </p>
      )}

      {/* Ablauf-Strip */}
      {regeln.length > 0 && (
        <div className="mt-4 rounded-lg border border-subtle bg-inset px-3 py-2.5">
          <div className="mb-2 text-[10px] uppercase tracking-[0.04em] text-muted">Auswertungsreihenfolge</div>
          <div className="flex items-center overflow-x-auto pb-1">
            {regeln.map((r, i) => (
              <div key={i} className="flex shrink-0 items-center">
                <button
                  type="button"
                  onMouseEnter={() => setHoverRegel(i)}
                  onMouseLeave={() => setHoverRegel(null)}
                  title={bedingungText(r.wenn)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[11px] transition-all duration-200',
                    hoverRegel === i
                      ? 'border-mako bg-mako-dim text-mako'
                      : immerIdx >= 0 && i > immerIdx
                        ? 'border-warn/60 text-warn'
                        : 'border-strong text-secondary',
                  )}
                >
                  {i + 1}
                </button>
                {i < regeln.length - 1 && <span className="h-px w-5 bg-strong" />}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-muted">
            Top = höchste Priorität. Auswertung deterministisch: erste zutreffende Regel, Tiebreak = Gewicht.
          </p>
        </div>
      )}

      {/* Panel-Fuß: lokale Disclosure für die Gewicht-Stepper (MS17 §1.4) */}
      <ProfiDisclosure
        panelId="gegner-verhalten"
        titel="Gewichte & Tiebreak"
        anzahl={regeln.length}
        offen={profiOffen}
        onToggle={setProfiOffen}
        className="mt-3"
      />
    </div>
  );
}
