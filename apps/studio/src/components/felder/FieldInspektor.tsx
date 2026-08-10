/**
 * FieldInspektor — rechter Inspektor des Field-Editors (felder.md Sektion 3).
 * Modus „Neues Field": Metadaten, Hintergrundbild-Dropzone, Tiefenmaske,
 * Kamerapose mit Mini-Vorschau, Statistik-Zeile. Selektierte Elemente
 * (Dreieck / Trigger / Gateway / Kamera) mit editierbaren Werten.
 * Modus „Original annotieren": Delta-Karte mit Anker, guardHash,
 * Operations-Liste und „Neu verankern"-Aktion (Zeichen-Shuffle).
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, ImagePlus, Replace } from 'lucide-react';
import { toast } from 'sonner';
import RefBadge from '@/components/shared/RefBadge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { FIELD_DELTA_OPS } from '@webmidgar/studio-core';
import type { FieldDeltaOp } from '@webmidgar/studio-core';
import { istDegeneriert, ORIGINAL_FIELDS, SCRIPT_GRAPHEN, SLUMKIRCHE_FIELD_ID } from '@/lib/charfelder';
import type { CanvasSelektion, Dreieck2D, GatewayMark, KameraPose, TriggerZone } from '@/lib/charfelder';
import { demoFieldDelta } from '@/lib/mock-project';
import { cn } from '@/lib/utils';

interface FieldInspektorProps {
  modus: 'neu' | 'delta';
  feldName: string;
  feldId: string;
  zielField: string;
  onRename: (name: string) => void;
  mesh: Dreieck2D[];
  setMesh: (m: Dreieck2D[]) => void;
  trigger: TriggerZone[];
  setTrigger: (t: TriggerZone[]) => void;
  gateways: GatewayMark[];
  setGateways: (g: GatewayMark[]) => void;
  kamera: KameraPose;
  setKamera: (k: KameraPose) => void;
  selektion: CanvasSelektion;
  setSelektion: (s: CanvasSelektion) => void;
  anzahlFehler: number;
  onFehlerKlick: () => void;
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

function MonoFeld({ label, wert, onChange, schritt = 1 }: { label: string; wert: number; onChange: (v: number) => void; schritt?: number }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted">{label}</span>
      <Input
        type="number"
        value={wert}
        step={schritt}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-20 border-subtle bg-inset px-1.5 py-0 text-right font-mono text-[11px]"
      />
    </label>
  );
}

const HASH_ZEICHEN = '0123456789abcdef';

export default function FieldInspektor({
  modus,
  feldName,
  feldId,
  zielField,
  onRename,
  mesh,
  setMesh,
  trigger,
  setTrigger,
  gateways,
  setGateways,
  kamera,
  setKamera,
  selektion,
  setSelektion,
  anzahlFehler,
  onFehlerKlick,
}: FieldInspektorProps) {
  const [tiefeQuelle, setTiefeQuelle] = useState('ableiten');
  const [tiefeDeckkraft, setTiefeDeckkraft] = useState(60);
  const [deltaOps, setDeltaOps] = useState(() =>
    demoFieldDelta.operationen.map((o) => ({ ...o, anker: { ...o.anker }, veraltet: o.guardHash === '77c0d2ef' })),
  );
  const [shuffle, setShuffle] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);

  const kopieren = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success('In Zwischenablage kopiert', { description: text });
  };

  /** „Neu verankern": Hash morpht per Zeichen-Shuffle zum neuen Wert, dann Mako-Flash. */
  const neuVerankern = (index: number) => {
    if (shuffle !== null) return;
    setShuffle(index);
    const start = Date.now();
    const timer = window.setInterval(() => {
      const fortschritt = (Date.now() - start) / 300;
      setDeltaOps((ops) =>
        ops.map((o, i) => {
          if (i !== index) return o;
          if (fortschritt >= 1) return { ...o, guardHash: 'e51d90aa', veraltet: false };
          const zufall = Array.from({ length: 8 }, (_, zi) =>
            zi / 8 < fortschritt ? 'e51d90aa'[zi] : HASH_ZEICHEN[Math.floor(Math.random() * 16)],
          ).join('');
          return { ...o, guardHash: zufall };
        }),
      );
      if (fortschritt >= 1) {
        window.clearInterval(timer);
        setShuffle(null);
        setFlash(index);
        window.setTimeout(() => setFlash(null), 600);
        toast.success('Delta neu verankert', { description: 'guardHash e51d90aa — Anker wieder valide.' });
      }
    }, 40);
  };

  const selDreieck = selektion?.art === 'dreieck' ? mesh[selektion.index] : null;
  const selTrigger = selektion?.art === 'trigger' ? trigger.find((t) => t.id === selektion.id) : null;
  const selGateway = selektion?.art === 'gateway' ? gateways.find((g) => g.id === selektion.id) : null;
  const selKamera = selektion?.art === 'kamera';

  const kameraFelder = (
    <div className="flex flex-col gap-1.5">
      <MonoFeld label="Position x" wert={kamera.posX} onChange={(v) => setKamera({ ...kamera, posX: v })} />
      <MonoFeld label="Position y" wert={kamera.posY} onChange={(v) => setKamera({ ...kamera, posY: v })} />
      <MonoFeld label="Ziel x" wert={kamera.zielX} onChange={(v) => setKamera({ ...kamera, zielX: v })} />
      <MonoFeld label="Ziel y" wert={kamera.zielY} onChange={(v) => setKamera({ ...kamera, zielY: v })} />
      <MonoFeld label="Zoom" wert={kamera.zoom} schritt={0.1} onChange={(v) => setKamera({ ...kamera, zoom: v })} />
      <MonoFeld label="Rotation (°)" wert={kamera.rotation} onChange={(v) => setKamera({ ...kamera, rotation: v })} />
      <MonoFeld label="FOV-Basis" wert={kamera.fovBasis} schritt={10} onChange={(v) => setKamera({ ...kamera, fovBasis: v })} />
    </div>
  );

  const kameraVorschau = (
    <div className="mt-2 h-[60px] w-20 overflow-hidden rounded border border-subtle bg-inset">
      <svg viewBox="0 0 80 60" className="h-full w-full">
        <rect width="80" height="60" fill="none" stroke="var(--border-subtle)" />
        <path
          d={`M40 52 L${40 - kamera.fovBasis / 12} 8 L${40 + kamera.fovBasis / 12} 8 Z`}
          fill="var(--info)"
          fillOpacity={0.15}
          stroke="var(--info)"
          strokeWidth={1}
          transform={`rotate(${kamera.rotation} 40 52)`}
        />
        <circle cx={40} cy={52} r={2.5} fill="var(--info)" />
      </svg>
    </div>
  );

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-subtle bg-panel">
      {/* Delta-Karte (nur Modus „Original annotieren") */}
      {modus === 'delta' && (
        <Block titel="Delta-Dokument">
          <div className="rounded-lg border border-engine/40 bg-panel p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <RefBadge refId={zielField} guardHash="a3f9…c1" />
              <span className="text-[11px] text-muted">2 Operationen</span>
            </div>
            <div className="flex flex-col gap-2">
              {deltaOps.map((o, i) => (
                <motion.div
                  key={i}
                  animate={{ backgroundColor: flash === i ? 'rgba(61,220,151,0.15)' : 'rgba(61,220,151,0)' }}
                  transition={{ duration: 0.3 }}
                  className="rounded border border-subtle bg-inset p-2"
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Select
                      value={o.op}
                      onValueChange={(v) =>
                        setDeltaOps((ops) => ops.map((x, xi) => (xi === i ? { ...x, op: v as FieldDeltaOp } : x)))
                      }
                    >
                      <SelectTrigger className="h-6 w-36 border-subtle bg-panel font-mono text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-subtle bg-popover">
                        {FIELD_DELTA_OPS.map((op) => (
                          <SelectItem key={op} value={op} className="font-mono text-[11px]">
                            {op}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {o.veraltet ? (
                      <button
                        type="button"
                        onClick={() => neuVerankern(i)}
                        disabled={shuffle !== null}
                        className="ml-auto rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn transition-colors duration-150 hover:bg-warn/10 disabled:opacity-50"
                      >
                        Neu verankern
                      </button>
                    ) : (
                      <span className="ml-auto flex items-center gap-1 text-[10px] text-mako">
                        <Check className="h-3 w-3" />
                        Anker valide
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] leading-relaxed text-secondary">
                    anker {'{'}
                    <span className="text-foreground">{o.anker.entity}</span> ·{' '}
                    <span className="text-foreground">{o.anker.slot}</span> · ip{' '}
                    <span className="text-foreground">0x{o.anker.ipOffset.toString(16).padStart(2, '0')}</span>
                    {'}'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px]">
                    <span className="text-muted">guardHash</span>
                    <span className={cn(o.veraltet ? 'text-warn' : 'text-mako')}>{o.guardHash}</span>
                    <button
                      type="button"
                      aria-label="guardHash kopieren"
                      onClick={() => kopieren(o.guardHash)}
                      className="text-muted transition-colors duration-150 hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  {o.payload && <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{o.payload}</div>}
                  {o.veraltet && (
                    <p className="mt-1 text-[10px] text-warn">
                      Anker veraltet — Originalversion hat sich geändert.
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Dieses Dokument enthält nur Ergänzungen. Originalinhalte werden nie gespeichert.
            </p>
          </div>
        </Block>
      )}

      {/* Selektionswechsel: Inhalt animiert */}
      <motion.div
        key={selektion ? `${selektion.art}-${'index' in selektion ? selektion.index : 'id' in selektion ? selektion.id : 'k'}` : `leer-${modus}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {/* --- Selektiertes Element --- */}
        {selDreieck && selektion?.art === 'dreieck' && (
          <Block titel={`Dreieck #${selektion.index}`}>
            <div className="mb-2 flex flex-col gap-1">
              {(['a', 'b', 'c'] as const).map((vi) => (
                <div key={vi} className="flex items-center gap-1.5">
                  <span className="w-4 font-mono text-[11px] text-muted">{vi}</span>
                  {(['x', 'y'] as const).map((achse) => (
                    <Input
                      key={achse}
                      type="number"
                      value={selDreieck[vi][achse]}
                      onChange={(e) =>
                        setMesh(
                          mesh.map((d, di) =>
                            di === selektion.index
                              ? { ...d, [vi]: { ...d[vi], [achse]: Number(e.target.value) } }
                              : d,
                          ),
                        )
                      }
                      className="h-6 w-16 border-subtle bg-inset px-1.5 py-0 font-mono text-[11px]"
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-muted">Nachbarn:</span>
              {selDreieck.adjazent.map((n, k) =>
                n !== null ? (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSelektion({ art: 'dreieck', index: n })}
                    className="rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[10px] text-secondary transition-colors duration-150 hover:border-mako/40 hover:text-mako"
                  >
                    #{n}
                  </button>
                ) : null,
              )}
              {selDreieck.adjazent.every((n) => n === null) && (
                <span className="text-[11px] text-muted">keine (Rand)</span>
              )}
            </div>
            {istDegeneriert(selDreieck) ? (
              <p className="flex items-center gap-1.5 text-[11px] text-error">
                <span className="h-1.5 w-1.5 rounded-full bg-error" />
                degeneriert — Fläche &lt; 0.5
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-mako">
                <Check className="h-3.5 w-3.5" />
                valide
              </p>
            )}
          </Block>
        )}

        {selTrigger && (
          <Block titel="Trigger">
            <label className="mb-1 block text-[11px] text-muted">Name</label>
            <Input
              value={selTrigger.name}
              onChange={(e) =>
                setTrigger(trigger.map((t) => (t.id === selTrigger.id ? { ...t, name: e.target.value } : t)))
              }
              className="mb-2 h-7 border-subtle bg-inset text-[12px]"
            />
            <label className="mb-1 block text-[11px] text-muted">Auslöser</label>
            <Select
              value={selTrigger.ausloeser}
              onValueChange={(v) =>
                setTrigger(
                  trigger.map((t) =>
                    t.id === selTrigger.id ? { ...t, ausloeser: v as TriggerZone['ausloeser'] } : t,
                  ),
                )
              }
            >
              <SelectTrigger className="mb-2 h-7 border-subtle bg-inset font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-subtle bg-popover">
                <SelectItem value="beruehrung" className="font-mono text-[11px]">beruehrung</SelectItem>
                <SelectItem value="interaktion" className="font-mono text-[11px]">interaktion</SelectItem>
              </SelectContent>
            </Select>
            <label className="mb-1 block text-[11px] text-muted">Script</label>
            <Select
              value={selTrigger.scriptRef || 'kein'}
              onValueChange={(v) =>
                setTrigger(
                  trigger.map((t) => (t.id === selTrigger.id ? { ...t, scriptRef: v === 'kein' ? '' : v } : t)),
                )
              }
            >
              <SelectTrigger className="mb-2 h-7 border-subtle bg-inset text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-subtle bg-popover">
                <SelectItem value="kein" className="text-[11px] text-muted">— kein —</SelectItem>
                {SCRIPT_GRAPHEN.map((s) => (
                  <SelectItem key={s.ref} value={s.ref} className="text-[11px]">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-[12px] text-secondary">
              <Checkbox
                checked={selTrigger.einmalig}
                onCheckedChange={(v) =>
                  setTrigger(trigger.map((t) => (t.id === selTrigger.id ? { ...t, einmalig: v === true } : t)))
                }
              />
              Einmalig auslösen
            </label>
            {!selTrigger.scriptRef && (
              <p className="mt-2 text-[11px] text-warn">Trigger ohne Script-Verdrahtung.</p>
            )}
          </Block>
        )}

        {selGateway && (
          <Block titel="Gateway">
            <label className="mb-1 block text-[11px] text-muted">Ziel-Field</label>
            <Select
              value={selGateway.zielField}
              onValueChange={(v) => setGateways(gateways.map((g) => (g.id === selGateway.id ? { ...g, zielField: v } : g)))}
            >
              <SelectTrigger className="mb-1.5 h-7 border-subtle bg-inset font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-subtle bg-popover">
                <SelectItem value={SLUMKIRCHE_FIELD_ID} className="text-[11px]">Slumkirche außen (Mod)</SelectItem>
                <SelectItem value="mod:de.beispiel.nebenquest/field/slumkirche_innen" className="text-[11px]">
                  Slumkirche innen (Mod)
                </SelectItem>
                {ORIGINAL_FIELDS.map((f) => (
                  <SelectItem key={f} value={f} className="font-mono text-[11px]">{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selGateway.zielField.startsWith('field:') && (
              <div className="mb-2">
                <RefBadge refId={selGateway.zielField} guardHash="a3f9…c1" />
              </div>
            )}
            <div className="mb-2 flex gap-1.5">
              <MonoFeld label="Spawn x" wert={selGateway.spawnX} onChange={(v) => setGateways(gateways.map((g) => (g.id === selGateway.id ? { ...g, spawnX: v } : g)))} />
              <MonoFeld label="y" wert={selGateway.spawnY} onChange={(v) => setGateways(gateways.map((g) => (g.id === selGateway.id ? { ...g, spawnY: v } : g)))} />
            </div>
            <label className="mb-1 block text-[11px] text-muted">Richtung (8-Wege)</label>
            <div className="relative mx-auto h-20 w-20">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((w) => {
                const rad = ((w - 90) * Math.PI) / 180;
                const aktiv = selGateway.richtung === w;
                return (
                  <button
                    key={w}
                    type="button"
                    aria-label={`Richtung ${w}°`}
                    onClick={() => setGateways(gateways.map((g) => (g.id === selGateway.id ? { ...g, richtung: w } : g)))}
                    className={cn(
                      'absolute h-4 w-4 rotate-45 border transition-colors duration-150',
                      aktiv ? 'border-mako bg-mako-dim' : 'border-subtle bg-inset hover:border-strong',
                    )}
                    style={{ left: 32 + Math.cos(rad) * 28 - 8, top: 32 + Math.sin(rad) * 28 - 8 }}
                  />
                );
              })}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] text-secondary">
                {selGateway.richtung}°
              </span>
            </div>
          </Block>
        )}

        {selKamera && (
          <Block titel="Kamerapose">
            {kameraFelder}
            {kameraVorschau}
          </Block>
        )}

        {/* --- Nichts selektiert: Field-Metadaten --- */}
        {!selektion && modus === 'neu' && (
          <>
            <Block titel="Field">
              <label className="mb-1 block text-[11px] text-muted">Name</label>
              <Input
                value={feldName}
                onChange={(e) => onRename(e.target.value)}
                className="mb-2 h-7 border-subtle bg-inset text-[12px]"
              />
              <label className="mb-1 block text-[11px] text-muted">Field-ID</label>
              <div className="flex items-center gap-1">
                <code className="min-w-0 flex-1 truncate rounded border border-subtle bg-inset px-2 py-1 font-mono text-[10px] text-secondary">
                  {feldId}
                </code>
                <button
                  type="button"
                  aria-label="ID kopieren"
                  onClick={() => kopieren(feldId)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </Block>

            <Block titel="Hintergrundbild">
              <div className="rounded-lg border border-dashed border-strong bg-inset p-2.5 text-center">
                <img
                  src="./field-bg-slumkirche.png"
                  alt="Hintergrund des Fields"
                  className="mb-1.5 h-20 w-full rounded border border-subtle object-cover"
                />
                <div className="flex items-center justify-center gap-2">
                  <ImagePlus className="h-3.5 w-3.5 text-muted" />
                  <code className="font-mono text-[10px] text-secondary">field-bg-slumkirche.png</code>
                  <button
                    type="button"
                    onClick={() => toast('Datei-Import folgt mit dem Projektspeicher (IndexedDB).')}
                    className="flex items-center gap-1 rounded border border-subtle px-1.5 py-0.5 text-[10px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                  >
                    <Replace className="h-3 w-3" />
                    Ersetzen
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted">
                  PNG hierher ziehen — wird als <code className="font-mono">user-asset</code> ins Paket kopiert.
                </p>
              </div>
            </Block>

            <Block titel="Tiefen-/Layermaske">
              <label className="mb-1 block text-[11px] text-muted">Quelle</label>
              <Select value={tiefeQuelle} onValueChange={setTiefeQuelle}>
                <SelectTrigger className="mb-2 h-7 border-subtle bg-inset text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-subtle bg-popover">
                  <SelectItem value="ableiten" className="text-[11px]">Aus Hintergrund ableiten</SelectItem>
                  <SelectItem value="manuell" className="text-[11px]">Manuell zeichnen</SelectItem>
                </SelectContent>
              </Select>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] text-muted">Deckkraft</label>
                <span className="font-mono text-[11px] text-foreground">{tiefeDeckkraft}%</span>
              </div>
              <Slider value={[tiefeDeckkraft]} min={0} max={100} step={1} onValueChange={([v]) => setTiefeDeckkraft(v ?? 0)} />
              {tiefeQuelle === 'manuell' && (
                <p className="mt-1.5 text-[10px] text-muted">Pinsel-Werkzeug in der Werkzeugleiste aktiviert.</p>
              )}
            </Block>

            <Block titel="Kamerapose">
              {kameraFelder}
              {kameraVorschau}
            </Block>

            <Block titel="Statistik">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-secondary">{mesh.length} Dreiecke</span>
                <span className="text-muted">·</span>
                <span className="text-mako">{mesh.length - anzahlFehler} valide</span>
                <span className="text-muted">·</span>
                <button
                  type="button"
                  onClick={anzahlFehler > 0 ? onFehlerKlick : undefined}
                  className={cn(
                    'rounded px-1 transition-colors duration-150',
                    anzahlFehler > 0 ? 'text-error hover:bg-error/10' : 'text-muted',
                  )}
                >
                  {anzahlFehler} Fehler
                </button>
              </div>
            </Block>
          </>
        )}

        {!selektion && modus === 'delta' && (
          <Block titel="Field">
            <label className="mb-1 block text-[11px] text-muted">Name</label>
            <Input
              value={feldName}
              onChange={(e) => onRename(e.target.value)}
              className="mb-2 h-7 border-subtle bg-inset text-[12px]"
            />
            <p className="text-[11px] text-muted">
              Delta auf <code className="font-mono text-engine">{zielField}</code> — Trigger und Gateways ergänzen
              das Original, Walkmesh ist schreibgeschützt.
            </p>
          </Block>
        )}
      </motion.div>
    </aside>
  );
}
