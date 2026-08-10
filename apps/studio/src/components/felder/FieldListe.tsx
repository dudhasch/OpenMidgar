/**
 * FieldListe — Sidebar des Field-Editors (felder.md Sektion 1).
 * Gruppierte Zeilen („Mod-Felder" / „Original-Deltas") mit Thumbnails,
 * Typ-Chips (Neu = Mako, Δ Delta = Engine-Blau) und Zählerzeilen;
 * Plus-Popover mit den zwei Anlage-Modi (leer / Original annotieren
 * mit field-ID-Autocomplete).
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Map as MapIcon, Plus } from 'lucide-react';
import { toast } from 'sonner';
import RefBadge from '@/components/shared/RefBadge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ORIGINAL_FIELDS } from '@/lib/charfelder';
import { useUiModus } from '@/lib/ui-modus';
import { cn } from '@/lib/utils';

export interface FieldEintrag {
  id: string;
  name: string;
  typ: 'neu' | 'delta';
  /** Nur bei Delta: referenziertes Original-Field. */
  zielField?: string;
  zaehler: { dreiecke: number; trigger: number; gateways: number };
}

interface FieldListeProps {
  felder: FieldEintrag[];
  aktivId: string;
  onWaehlen: (id: string) => void;
  onNeu: (typ: 'neu' | 'delta', zielField?: string) => void;
  /** Öffnet den Erzeugungs-Wizard (MS17 — Einstieg im Einfach-Modus,
      im Profi-Modus erste Option des Plus-Popovers). */
  onWizard: () => void;
}

function Gruppe({ titel, children }: { titel: string; children: React.ReactNode }) {
  const [offen, setOffen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOffen(!offen)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted transition-colors duration-150 hover:text-secondary"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform duration-150', !offen && '-rotate-90')} />
        {titel}
      </button>
      <AnimatePresence initial={false}>
        {offen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FieldListe({ felder, aktivId, onWaehlen, onNeu, onWizard }: FieldListeProps) {
  const [popoverOffen, setPopoverOffen] = useState(false);
  const [idPicker, setIdPicker] = useState(false);
  const [idFilter, setIdFilter] = useState('');
  const { istEinfach } = useUiModus();

  const modFelder = felder.filter((f) => f.typ === 'neu');
  const deltas = felder.filter((f) => f.typ === 'delta');
  const vorschlaege = ORIGINAL_FIELDS.filter((f) => f.toLowerCase().includes(idFilter.toLowerCase()));

  const zeile = (f: FieldEintrag, i: number) => {
    const aktiv = f.id === aktivId;
    return (
      <motion.button
        key={f.id}
        type="button"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, delay: i * 0.04 }}
        onClick={() => onWaehlen(f.id)}
        className={cn(
          'relative flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors duration-150',
          aktiv ? 'bg-mako-dim' : 'hover:bg-elevated',
        )}
      >
        {aktiv && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-0.5 rounded-full bg-mako" />}
        {f.typ === 'neu' ? (
          <img
            src="./field-bg-slumkirche.png"
            alt=""
            className="h-9 w-12 shrink-0 rounded border border-subtle object-cover"
          />
        ) : (
          <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded border border-subtle bg-inset">
            <MapIcon className="h-4 w-4 text-engine" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] text-foreground">{f.name}</span>
            {f.typ === 'neu' ? (
              <span className="shrink-0 rounded border border-mako/40 bg-mako-dim px-1 py-px text-[9px] font-medium text-mako">
                Neu
              </span>
            ) : (
              <span className="shrink-0 rounded border border-engine/40 px-1 py-px text-[9px] font-medium text-engine">
                Δ Delta
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
            {f.typ === 'delta' && f.zielField && <RefBadge refId={f.zielField} className="scale-90" />}
            <span>
              {f.zaehler.dreiecke} Dreiecke · {f.zaehler.trigger} Trigger · {f.zaehler.gateways} Gateways
            </span>
          </span>
        </span>
      </motion.button>
    );
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-subtle bg-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-subtle px-3">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-secondary">Felder</span>
        {istEinfach ? (
          /* Einfach-Modus: Plus startet direkt den Wizard (MS17 §2) */
          <button
            type="button"
            aria-label="Neues Field"
            title="Neues Field (Wizard)"
            onClick={onWizard}
            className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-mako"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : (
        <Popover open={popoverOffen} onOpenChange={setPopoverOffen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Field hinzufügen"
              className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-mako"
            >
              <Plus className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 border-subtle bg-popover p-1.5">
            {!idPicker ? (
              <div className="flex flex-col">
                {/* Profi-Modus: Wizard bleibt Default-Einstieg (MS17 §2) */}
                <button
                  type="button"
                  onClick={() => {
                    onWizard();
                    setPopoverOffen(false);
                  }}
                  className="rounded px-2 py-1.5 text-left text-[12px] text-foreground transition-colors duration-150 hover:bg-elevated"
                >
                  Wizard starten
                  <span className="block text-[11px] text-muted">Geführte Anlage in drei Schritten</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onNeu('neu');
                    setPopoverOffen(false);
                  }}
                  className="rounded px-2 py-1.5 text-left text-[12px] text-foreground transition-colors duration-150 hover:bg-elevated"
                >
                  Neues Field (leer)
                  <span className="block text-[11px] text-muted">Eigenes Hintergrundbild + Walkmesh zeichnen</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIdPicker(true)}
                  className="rounded px-2 py-1.5 text-left text-[12px] text-foreground transition-colors duration-150 hover:bg-elevated"
                >
                  Original-Field annotieren…
                  <span className="block text-[11px] text-muted">Delta-Dokument auf ein Original-Field</span>
                </button>
              </div>
            ) : (
              <div className="p-1">
                <Input
                  autoFocus
                  value={idFilter}
                  onChange={(e) => setIdFilter(e.target.value)}
                  placeholder="field:md1_1"
                  className="mb-1 h-7 border-subtle bg-inset font-mono text-[11px]"
                />
                <ul className="max-h-40 overflow-y-auto">
                  {vorschlaege.map((f) => (
                    <li key={f}>
                      <button
                        type="button"
                        onClick={() => {
                          onNeu('delta', f);
                          setPopoverOffen(false);
                          setIdPicker(false);
                          toast.success('Delta angelegt', { description: `Delta-Dokument auf ${f}` });
                        }}
                        className="w-full rounded px-2 py-1 text-left font-mono text-[11px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                      >
                        {f}
                      </button>
                    </li>
                  ))}
                  {vorschlaege.length === 0 && (
                    <li className="px-2 py-1 text-[11px] text-muted">Keine bekannte Field-ID.</li>
                  )}
                </ul>
              </div>
            )}
          </PopoverContent>
        </Popover>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <Gruppe titel="Mod-Felder">
          <div className="flex flex-col gap-0.5">{modFelder.map((f, i) => zeile(f, i))}</div>
        </Gruppe>
        <div className="mt-2">
          <Gruppe titel="Original-Deltas">
            <div className="flex flex-col gap-0.5">{deltas.map((f, i) => zeile(f, i))}</div>
          </Gruppe>
        </div>
      </div>
    </aside>
  );
}
