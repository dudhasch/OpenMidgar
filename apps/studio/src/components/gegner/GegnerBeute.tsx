/**
 * GegnerBeute — Tab „Beute" (gegner.md Sektion 6):
 * Drops / Stehlen / Morph mit Item-Autocomplete (eigene MS11-Items +
 * kernel:item/<id>-Referenzen mit RefBadge), Raten-Slidern (0–100 %),
 * Erwartungswert-Karte (live aus Raten × Gil) und Befunden (tote
 * itemRefs, Drop-Summe > 100 %). Mako-Primär-CTA: „Beute hinzufügen".
 */
import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import RefBadge from '@/components/shared/RefBadge';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import type { BeuteEintrag } from '@webmidgar/studio-core';
import { MOCK_ITEMS, itemName, itemRefTot } from '@/lib/gegner';
import type { GegnerUi, MockItem } from '@/lib/gegner';
import { cn } from '@/lib/utils';

type BlockArt = 'drops' | 'stehlen';

interface GegnerBeuteProps {
  gegner: GegnerUi;
  onPatch: (patch: Partial<GegnerUi>) => void;
}

function ItemAutocomplete({
  wert,
  onWaehlen,
}: {
  wert: string;
  onWaehlen: (ref: string) => void;
}) {
  const [offen, setOffen] = useState(false);
  const item = MOCK_ITEMS.find((i) => i.ref === wert);
  const tot = itemRefTot(wert);
  const vorschlaege: MockItem[] = useMemo(() => {
    const q = (item ? item.name : wert).toLowerCase();
    return MOCK_ITEMS.filter(
      (i) => i.ref !== wert && (i.name.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q)),
    );
  }, [wert, item]);

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        value={item ? item.name : wert}
        onChange={(e) => {
          const treffer = MOCK_ITEMS.find((i) => i.name.toLowerCase() === e.target.value.toLowerCase());
          onWaehlen(treffer ? treffer.ref : e.target.value);
          setOffen(true);
        }}
        onFocus={() => setOffen(true)}
        onBlur={() => window.setTimeout(() => setOffen(false), 150)}
        placeholder="Item oder kernel:item/…"
        className={cn(
          'h-8 border-subtle bg-inset text-[12px]',
          tot && 'border-error focus-visible:outline-error',
          !item && 'font-mono text-[11px]',
        )}
      />
      {offen && vorschlaege.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-subtle bg-popover py-1 shadow-modal">
          {vorschlaege.map((i) => (
            <li key={i.ref}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onWaehlen(i.ref);
                  setOffen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left transition-colors duration-150 hover:bg-elevated"
              >
                <span className="text-[12px] text-foreground">{i.name}</span>
                <span className={cn('font-mono text-[9px]', i.eigen ? 'text-mako' : 'text-engine')}>
                  {i.eigen ? 'eigen' : i.ref}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex items-center gap-1.5">
        {item ? (
          item.eigen ? (
            <span className="rounded border border-mako/50 bg-mako-dim px-1 font-mono text-[9px] text-mako">eigen</span>
          ) : (
            <RefBadge refId={item.ref} guardHash="c41a…f0" />
          )
        ) : tot ? (
          <span className="flex items-center gap-1 text-[10px] text-error">
            <AlertTriangle className="h-2.5 w-2.5" />
            Toter Item-Verweis
          </span>
        ) : (
          <RefBadge refId={wert} />
        )}
      </div>
    </div>
  );
}

function BeuteZeile({
  eintrag,
  onChange,
  onLoeschen,
}: {
  eintrag: BeuteEintrag;
  onChange: (patch: Partial<BeuteEintrag>) => void;
  onLoeschen: () => void;
}) {
  const tot = itemRefTot(eintrag.itemRef);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className={cn(
        'overflow-hidden rounded-lg border bg-elevated p-2',
        tot ? 'border-error/70' : 'border-subtle',
      )}
    >
      <div className="flex items-start gap-2">
        <ItemAutocomplete wert={eintrag.itemRef} onWaehlen={(ref) => onChange({ itemRef: ref })} />
        <span className="mt-1 w-10 shrink-0 text-right font-mono text-[11px] text-foreground">
          {Math.round(eintrag.rate * 100)} %
        </span>
        <button
          type="button"
          aria-label="Beute-Eintrag löschen"
          onClick={onLoeschen}
          className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-panel hover:text-error"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <Slider
        value={[Math.round(eintrag.rate * 100)]}
        min={0}
        max={100}
        step={1}
        onValueChange={([v]) => onChange({ rate: (v ?? 0) / 100 })}
        className="mt-1.5"
      />
    </motion.div>
  );
}

export default function GegnerBeute({ gegner, onPatch }: GegnerBeuteProps) {
  const [fokusBlock, setFokusBlock] = useState<BlockArt>('drops');
  const loeschPuffer = useRef<{ block: BlockArt; eintrag: BeuteEintrag; index: number } | null>(null);

  const beute = gegner.beute;
  const dropSumme = beute.drops.reduce((s, d) => s + d.rate, 0);

  const setBlock = (block: BlockArt, liste: BeuteEintrag[]) => onPatch({ beute: { ...beute, [block]: liste } });

  const zeileNeu = () => {
    const block = fokusBlock;
    const fallback = MOCK_ITEMS.find((i) => !i.eigen)?.ref ?? MOCK_ITEMS[0]!.ref;
    setBlock(block, [...beute[block], { itemRef: fallback, rate: 0.25 }]);
  };

  const zeileAendern = (block: BlockArt, index: number, patch: Partial<BeuteEintrag>) => {
    setBlock(block, beute[block].map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const zeileLoeschen = (block: BlockArt, index: number) => {
    const entfernt = beute[block][index];
    if (!entfernt) return;
    loeschPuffer.current = { block, eintrag: entfernt, index };
    setBlock(block, beute[block].filter((_, i) => i !== index));
    toast('Beute entfernt', {
      action: {
        label: 'Rückgängig',
        onClick: () => {
          const puffer = loeschPuffer.current;
          if (!puffer) return;
          const liste = [...beute[puffer.block]];
          liste.splice(Math.min(puffer.index, liste.length), 0, puffer.eintrag);
          setBlock(puffer.block, liste);
          loeschPuffer.current = null;
        },
      },
    });
  };

  // Erwartungswert pro Kampf (Richtwert, kein Engine-Versprechen)
  const erwartung = [
    ...beute.drops.map((d) => ({ name: itemName(d.itemRef), wert: d.rate })),
    ...beute.stehlen.map((s) => ({ name: `${itemName(s.itemRef)} (Stehlen)`, wert: s.rate })),
  ];

  const blockTitel = (titel: string, block: BlockArt) => (
    <div className="mb-2 flex items-center justify-between">
      <h4 className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">{titel}</h4>
      <span className="font-mono text-[10px] text-muted">{beute[block].length}</span>
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">Beute</h3>
        <button
          type="button"
          onClick={zeileNeu}
          className="flex items-center gap-1.5 rounded bg-mako px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-mako-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          Beute hinzufügen
        </button>
      </div>

      {dropSumme > 1 && (
        <p className="mb-3 flex items-center gap-1.5 rounded border border-warn/50 bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn">
          <AlertTriangle className="h-3 w-3" />
          Summe aller Drop-Raten über 100 % ({Math.round(dropSumme * 100)} %) — die Engine kappt zur Laufzeit.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Drops */}
        <section onFocusCapture={() => setFokusBlock('drops')} onClick={() => setFokusBlock('drops')}>
          {blockTitel('Drops', 'drops')}
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {beute.drops.map((d, i) => (
                <BeuteZeile
                  key={`drop-${i}-${d.itemRef}`}
                  eintrag={d}
                  onChange={(p) => zeileAendern('drops', i, p)}
                  onLoeschen={() => zeileLoeschen('drops', i)}
                />
              ))}
            </AnimatePresence>
            {beute.drops.length === 0 && (
              <p className="rounded border border-dashed border-subtle px-2 py-3 text-center text-[11px] text-muted">
                Keine Drops.
              </p>
            )}
          </div>
        </section>

        {/* Stehlen */}
        <section onFocusCapture={() => setFokusBlock('stehlen')} onClick={() => setFokusBlock('stehlen')}>
          {blockTitel('Stehlen', 'stehlen')}
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {beute.stehlen.map((s, i) => (
                <BeuteZeile
                  key={`stehl-${i}-${s.itemRef}`}
                  eintrag={s}
                  onChange={(p) => zeileAendern('stehlen', i, p)}
                  onLoeschen={() => zeileLoeschen('stehlen', i)}
                />
              ))}
            </AnimatePresence>
            {beute.stehlen.length === 0 && (
              <p className="rounded border border-dashed border-subtle px-2 py-3 text-center text-[11px] text-muted">
                Nichts zu stehlen.
              </p>
            )}
          </div>
        </section>

        {/* Morph */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">Morph</h4>
          </div>
          {beute.morph ? (
            <div className="rounded-lg border border-subtle bg-elevated p-2">
              <div className="flex items-start gap-2">
                <ItemAutocomplete wert={beute.morph} onWaehlen={(ref) => onPatch({ beute: { ...beute, morph: ref } })} />
                <button
                  type="button"
                  aria-label="Morph entfernen"
                  onClick={() => onPatch({ beute: { ...beute, morph: undefined } })}
                  className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-panel hover:text-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onPatch({ beute: { ...beute, morph: MOCK_ITEMS.find((i) => !i.eigen)?.ref } })}
              className="w-full rounded-lg border border-dashed border-subtle px-2 py-3 text-[11px] text-muted transition-colors duration-150 hover:border-strong hover:text-secondary"
            >
              — nicht gesetzt — (Klick zum Setzen)
            </button>
          )}
          <p className="mt-1.5 text-[10px] text-muted">Optional: Item, in das sich der Gegner morphen lässt.</p>
        </section>
      </div>

      {/* Erwartungswert-Karte */}
      <div className="mt-4 rounded-lg border border-subtle bg-elevated p-3">
        <div className="mb-1 text-[10px] uppercase tracking-[0.04em] text-muted">Erwartungswert pro Kampf</div>
        <motion.p key={JSON.stringify(erwartung) + gegner.stats.gil} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="text-[13px] text-foreground">
          {erwartung.length > 0
            ? erwartung.map((e) => `${String(Math.round(e.wert * 100) / 100).replace('.', ',')}× ${e.name}`).join(' · ')
            : 'keine Beute'}
          {' · '}
          Gil {gegner.stats.gil}
        </motion.p>
        <p className="mt-1 text-[11px] text-muted">Richtwert für Balancing — kein Engine-Versprechen.</p>
      </div>
    </div>
  );
}
