/**
 * CharakterInspektor — rechter Inspektor des Charakter-Editors
 * (charaktere.md Sektionen 4+5): Identität, Modell-Quelle (zwei
 * exklusive Radio-Karten: Original-Referenz mit lgp-Autocomplete /
 * Textur-Override mit Swatches), Kollision & Skalierung mit
 * Live-Visualisierung, Script-Slots, glTF-Import (LockedCard „MS6")
 * und die kompakte Auftritte-Tabelle.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Box, Check, Copy, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import LockedCard from '@/components/shared/LockedCard';
import RefBadge from '@/components/shared/RefBadge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { CHAR_SLOTS, LGP_CHAR_IDS, SCRIPT_GRAPHEN, TEXTUR_VARIANTEN } from '@/lib/charfelder';
import type { CharakterEintrag } from '@/components/charaktere/CharakterListe';
import type { AuftrittUi } from '@/components/charaktere/PlatzierungsCanvas';
import { cn } from '@/lib/utils';

const ASSET_PFADE = [
  'assets/textur-lina-gruen.png',
  'assets/textur-lina-rost.png',
  'assets/textur-lina-nacht.png',
  'assets/textur-lina-asch.png',
];

interface CharakterInspektorProps {
  charakter: CharakterEintrag | null;
  onRename: (name: string) => void;
  auftritte: AuftrittUi[];
  aktivIndex: number;
  onAktivWaehlen: (index: number) => void;
  onAuftrittLoeschen: (index: number) => void;
}

function Block({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-subtle px-3 py-3">
      <h3 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">
        {titel}
      </h3>
      {children}
    </section>
  );
}

export default function CharakterInspektor({
  charakter,
  onRename,
  auftritte,
  aktivIndex,
  onAktivWaehlen,
  onAuftrittLoeschen,
}: CharakterInspektorProps) {
  const [beschreibung, setBeschreibung] = useState(
    'Hält die Slumkirche zusammen. Weist den Spieler auf den brüchigen Plattenboden hin.',
  );
  const [modellArt, setModellArt] = useState<'referenz' | 'textur'>('referenz');
  const [lgpRef, setLgpRef] = useState('lgp:char/ACGD');
  const [autoOffen, setAutoOffen] = useState(false);
  const [swatch, setSwatch] = useState(0);
  const [assetPfad, setAssetPfad] = useState(ASSET_PFADE[0]);
  const [radius, setRadius] = useState(24);
  const [skalierung, setSkalierung] = useState(100);
  const [slots, setSlots] = useState<Record<string, string>>({
    init: '',
    interaktion: 'scripts/lina.interaktion.json',
    beruehrung: '',
  });
  const [flashSlot, setFlashSlot] = useState<string | null>(null);

  const lgpGueltig = LGP_CHAR_IDS.includes(lgpRef);
  const vorschlaege = useMemo(
    () => LGP_CHAR_IDS.filter((id) => id.toLowerCase().includes(lgpRef.toLowerCase()) && id !== lgpRef),
    [lgpRef],
  );

  const kopieren = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success('In Zwischenablage kopiert', { description: text });
  };

  const setSlot = (slot: string, ref: string) => {
    setSlots((s) => ({ ...s, [slot]: ref === 'kein' ? '' : ref }));
    setFlashSlot(slot);
    window.setTimeout(() => setFlashSlot(null), 320);
  };

  if (!charakter) {
    return (
      <aside className="flex w-[280px] shrink-0 items-center justify-center border-l border-subtle bg-panel p-6 text-center text-[13px] text-secondary">
        Kein Charakter ausgewählt.
      </aside>
    );
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-subtle bg-panel">
      {/* Identität */}
      <Block titel="Identität">
        <label className="mb-1 block text-[11px] text-muted">Name</label>
        <Input
          value={charakter.name}
          onChange={(e) => onRename(e.target.value)}
          className="mb-2 h-8 border-subtle bg-inset text-sm"
        />
        <label className="mb-1 block text-[11px] text-muted">Charakter-ID</label>
        <div className="mb-2 flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded border border-subtle bg-inset px-2 py-1.5 font-mono text-[11px] text-secondary">
            {charakter.id}
          </code>
          <button
            type="button"
            aria-label="ID kopieren"
            onClick={() => kopieren(charakter.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
        <label className="mb-1 block text-[11px] text-muted">Beschreibung</label>
        <Textarea
          value={beschreibung}
          onChange={(e) => setBeschreibung(e.target.value)}
          rows={3}
          className="border-subtle bg-inset text-sm"
        />
      </Block>

      {/* Modell */}
      <Block titel="Modell">
        <div className="flex flex-col gap-2">
          {/* Karte 1: Original-Modell referenzieren */}
          <div
            role="radio"
            aria-checked={modellArt === 'referenz'}
            tabIndex={0}
            onClick={() => setModellArt('referenz')}
            onKeyDown={(e) => e.key === 'Enter' && setModellArt('referenz')}
            className={cn(
              'relative cursor-pointer rounded-lg border bg-panel p-2.5 transition-opacity duration-200',
              modellArt === 'referenz' ? 'border-mako/60' : 'border-subtle opacity-60 hover:opacity-90',
            )}
          >
            {modellArt === 'referenz' && (
              <motion.span layoutId="modell-rahmen" className="absolute inset-0 rounded-lg border border-mako/60" transition={{ duration: 0.2 }} />
            )}
            <div className="mb-1.5 text-[13px] font-medium text-foreground">Original-Modell referenzieren</div>
            <div className="relative">
              <Input
                value={lgpRef}
                onChange={(e) => {
                  setLgpRef(e.target.value);
                  setAutoOffen(true);
                }}
                onFocus={() => setAutoOffen(true)}
                onBlur={() => window.setTimeout(() => setAutoOffen(false), 150)}
                placeholder="lgp:char/…"
                className={cn(
                  'h-8 border-subtle bg-inset font-mono text-[12px]',
                  lgpRef && !lgpGueltig && 'border-error focus-visible:outline-error',
                )}
              />
              {autoOffen && vorschlaege.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-36 w-full overflow-y-auto rounded-md border border-subtle bg-popover py-1 shadow-modal">
                  {vorschlaege.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setLgpRef(id);
                          setAutoOffen(false);
                        }}
                        className="w-full px-2 py-1 text-left font-mono text-[11px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                      >
                        {id}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {lgpRef && !lgpGueltig && (
              <p className="mt-1.5 text-[11px] text-error">Unbekannte Modell-ID „{lgpRef}".</p>
            )}
            {lgpGueltig && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <RefBadge refId={lgpRef} guardHash="a3f9…c1" />
                <span className="text-[11px] text-muted">Nur referenziert, nichts wird kopiert.</span>
              </div>
            )}
          </div>

          {/* Karte 2: Textur-Override */}
          <div
            role="radio"
            aria-checked={modellArt === 'textur'}
            tabIndex={0}
            onClick={() => setModellArt('textur')}
            onKeyDown={(e) => e.key === 'Enter' && setModellArt('textur')}
            className={cn(
              'relative cursor-pointer rounded-lg border bg-panel p-2.5 transition-opacity duration-200',
              modellArt === 'textur' ? 'border-mako/60' : 'border-subtle opacity-60 hover:opacity-90',
            )}
          >
            {modellArt === 'textur' && (
              <motion.span layoutId="modell-rahmen" className="absolute inset-0 rounded-lg border border-mako/60" transition={{ duration: 0.2 }} />
            )}
            <div className="mb-1.5 text-[13px] font-medium text-foreground">Umfärben / Varianten (Textur-Override)</div>
            <div className="mb-2 flex gap-1.5">
              {TEXTUR_VARIANTEN.map((v, i) => {
                const aktiv = swatch === i;
                return (
                  <button
                    key={v.name}
                    type="button"
                    title={v.name}
                    onClick={() => {
                      setSwatch(i);
                      setAssetPfad(ASSET_PFADE[i]);
                    }}
                    className={cn(
                      'relative h-12 w-12 overflow-hidden rounded border transition-colors duration-150',
                      aktiv ? 'border-mako' : 'border-subtle hover:border-strong',
                    )}
                  >
                    <img
                      src="./texture-swatches.png"
                      alt={`Texturvariante ${v.name}`}
                      className="max-w-none"
                      style={{ width: 192, height: 48, marginLeft: -48 * v.offset }}
                    />
                    {aktiv && (
                      <motion.span
                        initial={{ scale: 0.5 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                        className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-mako text-primary-foreground"
                      >
                        <Check className="h-3 w-3" />
                      </motion.span>
                    )}
                  </button>
                );
              })}
            </div>
            <Select value={assetPfad} onValueChange={setAssetPfad}>
              <SelectTrigger className="h-8 border-subtle bg-inset font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-subtle bg-popover">
                {ASSET_PFADE.map((p) => (
                  <SelectItem key={p} value={p} className="font-mono text-[11px]">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-[11px] text-muted">
              Nutzerasset — wird ins Paket kopiert und im Audit als <code className="font-mono">user-asset</code>{' '}
              geführt.
            </p>
          </div>
        </div>
      </Block>

      {/* Kollision & Skalierung */}
      <Block titel="Kollision & Skalierung">
        {[
          { label: 'Kollisionsradius (px)', wert: radius, set: setRadius, min: 4, max: 64 },
          { label: 'Skalierung (%)', wert: skalierung, set: setSkalierung, min: 50, max: 200 },
        ].map((zeile) => (
          <div key={zeile.label} className="mb-2">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] text-muted">{zeile.label}</label>
              <span className="rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                {zeile.wert}
              </span>
            </div>
            <Slider
              value={[zeile.wert]}
              min={zeile.min}
              max={zeile.max}
              step={1}
              onValueChange={([v]) => zeile.set(v ?? zeile.wert)}
            />
          </div>
        ))}
        {/* Live-Visualisierung */}
        <div className="mt-2 h-16 w-full overflow-hidden rounded border border-subtle bg-inset">
          <svg viewBox="0 0 248 64" className="h-full w-full">
            {/* Referenz-Männchen (100 %) */}
            <g stroke="var(--text-muted)" strokeWidth={1.2} fill="none" opacity={0.7}>
              <circle cx={40} cy={14} r={5} />
              <line x1={40} y1={19} x2={40} y2={42} />
              <line x1={40} y1={24} x2={28} y2={34} />
              <line x1={40} y1={24} x2={52} y2={34} />
              <line x1={40} y1={42} x2={30} y2={58} />
              <line x1={40} y1={42} x2={50} y2={58} />
            </g>
            {/* Kollisionskreis relativ zum Männchen, mit Skalierung */}
            <circle
              cx={140}
              cy={34}
              r={Math.min(30, (radius * skalierung) / 100 / 2)}
              fill="var(--accent-mako)"
              fillOpacity={0.12}
              stroke="var(--accent-mako)"
              strokeWidth={1.5}
              style={{ transition: 'r 120ms ease-out' }}
            />
            <g
              stroke="var(--accent-mako)"
              strokeWidth={1.2}
              fill="none"
              transform={`translate(140 34) scale(${skalierung / 100})`}
              style={{ transition: 'transform 120ms ease-out' }}
            >
              <circle cx={0} cy={-18} r={4.5} />
              <line x1={0} y1={-13.5} x2={0} y2={7} />
              <line x1={0} y1={-9} x2={-10} y2={0} />
              <line x1={0} y1={-9} x2={10} y2={0} />
              <line x1={0} y1={7} x2={-8} y2={22} />
              <line x1={0} y1={7} x2={8} y2={22} />
            </g>
            <text x={216} y={60} textAnchor="end" fill="var(--text-muted)" fontSize={9} fontFamily="monospace">
              r {radius}px · {skalierung}%
            </text>
          </svg>
        </div>
      </Block>

      {/* Script-Slots */}
      <Block titel="Script-Slots">
        <div className="flex flex-col gap-1.5">
          {CHAR_SLOTS.map((slot) => {
            const gesetzt = Boolean(slots[slot]);
            return (
              <motion.div
                key={slot}
                animate={{ backgroundColor: flashSlot === slot ? 'rgba(61,220,151,0.12)' : 'rgba(61,220,151,0)' }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-2 rounded px-1 py-0.5"
              >
                <span className="w-20 shrink-0 rounded border border-subtle bg-inset px-1.5 py-0.5 text-center font-mono text-[10px] text-secondary">
                  {slot}
                </span>
                <Select value={slots[slot] || 'kein'} onValueChange={(v) => setSlot(slot, v)}>
                  <SelectTrigger
                    className={cn(
                      'h-7 flex-1 border-subtle bg-inset text-[11px]',
                      !gesetzt && 'border-dashed text-muted',
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-subtle bg-popover">
                    <SelectItem value="kein" className="text-[11px] text-muted">
                      — kein —
                    </SelectItem>
                    {SCRIPT_GRAPHEN.map((s) => (
                      <SelectItem key={s.ref} value={s.ref} className="text-[11px]">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </motion.div>
            );
          })}
        </div>
        {!slots['interaktion'] && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-info">
            <AlertTriangle className="h-3 w-3" />
            Kein <code className="font-mono">interaktion</code>-Script verdrahtet — NPC ist stumm.
          </p>
        )}
      </Block>

      {/* glTF-Import (gesperrt) */}
      <Block titel="glTF-Import">
        <LockedCard
          badge="MS6"
          hinweis="Post-MVP — der Manifest-Vertrag (capability: model.gltf) ist bereits reserviert."
          className="p-3"
        >
          <div className="flex items-start gap-2 pr-16">
            <Box className="mt-0.5 h-4 w-4 shrink-0 text-locked" />
            <div>
              <div className="text-[13px] font-medium text-foreground">Eigenes Modell importieren (glTF)</div>
              <p className="mt-0.5 text-[11px] text-muted">
                Eigene 3D-Modelle folgen mit Meilenstein MS6 (Runtime-Modellpipeline).
              </p>
            </div>
          </div>
        </LockedCard>
      </Block>

      {/* Auftritte-Tabelle */}
      <Block titel="Auftritte">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-strong text-muted">
              <th className="pb-1 font-medium">Field</th>
              <th className="pb-1 font-medium">△#</th>
              <th className="pb-1 font-medium">x/y</th>
              <th className="pb-1 font-medium">r</th>
              <th className="pb-1 text-right font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {auftritte.map((a, i) => (
                <motion.tr
                  key={`${a.field}-${i}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => onAktivWaehlen(i)}
                  className={cn(
                    'cursor-pointer border-b border-subtle transition-colors duration-150',
                    i === aktivIndex ? 'bg-mako-dim' : 'hover:bg-elevated',
                  )}
                >
                  <td className="max-w-0 truncate py-1.5 pr-1">
                    {a.field.startsWith('field:') ? (
                      <span className="font-mono text-engine">{a.field}</span>
                    ) : (
                      'Slumkirche außen'
                    )}
                  </td>
                  <td className="py-1.5 pr-1 font-mono">{a.dreieck}</td>
                  <td className="py-1.5 pr-1 font-mono text-secondary">
                    {a.x}/{a.y}
                  </td>
                  <td className="py-1.5 pr-1 font-mono text-secondary">{a.richtung}°</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      aria-label="Auftritt bearbeiten"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAktivWaehlen(i);
                      }}
                      className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Auftritt löschen"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAuftrittLoeschen(i);
                      }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-error"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        {auftritte.length === 0 && (
          <p className="py-2 text-center text-[11px] text-muted">Keine Auftritte — Marker im Canvas platzieren.</p>
        )}
      </Block>
    </aside>
  );
}
