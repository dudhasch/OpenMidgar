/**
 * SchlachtInspektor — rechter Inspektor des Battle-Editors (280px,
 * schlacht.md Sektion 5) mit den Tabs „Regeln", „Belohnung", „Verknüpfung".
 *
 * - Regeln: Flucht-/Hinterhalt-Selects, gesperrte Siegbedingung
 *   (LockedCard-Muster), Musik-Platzhalter (MS12),
 * - Belohnung: Modifikator-Slider + live berechnete Summen (Σ Gegner-Stats
 *   × Modifikator) + garantierte Drops inkl. Flucht-Warnlogik,
 * - Verknüpfung: Encounter-Zonen-Karte (Mod- + Original-Fields) oder
 *   Script-Start-Verweis-Chip. Doppel-Verknüpfung erlaubt.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link2, Lock, Music, Plus, Workflow, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import RefBadge from '@/components/shared/RefBadge';
import {
  belohnungsSummen,
  DEMO_ITEMS,
  DEMO_SCRIPT_VERWEIS,
  ENCOUNTER_FELDER,
  FLUCHT_LABELS,
  HINTERHALT_LABELS,
  itemName,
  MUSIK_IM_PROJEKT,
} from '@/lib/schlacht';
import type { FormationMarker } from '@/lib/schlacht';
import type { BattleDoc, FluchtRegel, HinterhaltArt } from '@webmidgar/studio-core';
import { cn } from '@/lib/utils';

interface SchlachtInspektorProps {
  doc: BattleDoc;
  setDoc: (d: BattleDoc) => void;
  marker: FormationMarker[];
  /** Löst die kurze Spiegel-Vorschau im Canvas aus (Hinterhalt-Wechsel). */
  onSpiegelPuls: () => void;
}

function FeldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em] text-muted">{children}</div>
  );
}

const selectKlasse =
  'h-8 w-full rounded-md border border-subtle bg-inset px-2 text-[13px] text-foreground outline-none transition-colors duration-150 focus:border-mako';

export default function SchlachtInspektor({ doc, setDoc, marker, onSpiegelPuls }: SchlachtInspektorProps) {
  /* Lokale Profi-Disclosure „Rohwerte" (MS17): Flucht-Bedingung +
     Formation-Rohwerte sind gestreute data-profi-Elemente im Regeln-Tab. */
  const [rohwerteOffen, setRohwerteOffen] = useState(false);
  const summen = useMemo(() => belohnungsSummen(doc, marker), [doc, marker]);
  const drops = doc.belohnung.garantierteDrops ?? [];
  const fluchtWarnung = doc.regeln.flucht === 'verboten' && drops.length === 0;
  const musikTot = !!doc.musikRef && !MUSIK_IM_PROJEKT.includes(doc.musikRef);

  const patchRegeln = (p: Partial<BattleDoc['regeln']>) => setDoc({ ...doc, regeln: { ...doc.regeln, ...p } });
  const patchBelohnung = (p: Partial<BattleDoc['belohnung']>) =>
    setDoc({ ...doc, belohnung: { ...doc.belohnung, ...p } });

  const aktivFeld = doc.verknuepfung && 'feldRef' in doc.verknuepfung ? doc.verknuepfung.feldRef : ENCOUNTER_FELDER[0]!.feldRef;
  const aktivZone = doc.verknuepfung && 'feldRef' in doc.verknuepfung ? doc.verknuepfung.encounterZone : '';
  const feld = ENCOUNTER_FELDER.find((f) => f.feldRef === aktivFeld) ?? ENCOUNTER_FELDER[0]!;
  const zone = feld.zonen.find((z) => z.id === aktivZone);
  const scriptVerknuepft = !!doc.verknuepfung && 'scriptStart' in doc.verknuepfung;

  const modZeile = (
    key: 'expMod' | 'apMod' | 'gilMod',
    label: string,
  ) => {
    const wert = doc.belohnung[key] ?? 1;
    return (
      <div className="mb-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] text-secondary">{label}</span>
          <span className="font-mono text-[11px] text-foreground">×{wert.toFixed(1)}</span>
        </div>
        <Slider
          value={[wert]}
          min={0.5}
          max={3}
          step={0.1}
          onValueChange={([v]) => patchBelohnung({ [key]: v })}
          aria-label={`${label}-Modifikator`}
        />
      </div>
    );
  };

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-subtle bg-panel">
      <Tabs defaultValue="regeln" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-2 mt-2 grid h-8 shrink-0 grid-cols-3 bg-inset">
          <TabsTrigger value="regeln" className="text-[11px]">Regeln</TabsTrigger>
          <TabsTrigger value="belohnung" className="text-[11px]">Belohnung</TabsTrigger>
          <TabsTrigger value="verknuepfung" className="text-[11px]">Verknüpfung</TabsTrigger>
        </TabsList>

        {/* ---------------- Tab Regeln ---------------- */}
        <TabsContent value="regeln" className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* data-profi-offen: geöffnete „Rohwerte"-Disclosure macht die
              data-profi-Blöcke dieses Tabs im Einfach-Modus sichtbar. */}
          <div className="space-y-4" {...(rohwerteOffen ? { 'data-profi-offen': '' } : {})}>
            <div>
              <FeldLabel>Flucht</FeldLabel>
              <select
                value={doc.regeln.flucht}
                onChange={(e) => patchRegeln({ flucht: e.target.value as FluchtRegel })}
                className={selectKlasse}
              >
                {(Object.keys(FLUCHT_LABELS) as FluchtRegel[]).map((f) => (
                  <option key={f} value={f}>
                    {FLUCHT_LABELS[f]}
                  </option>
                ))}
              </select>
              {doc.regeln.flucht === 'bedingt' && (
                <div className="mt-2" data-profi>
                  <FeldLabel>Bedingung (Profi)</FeldLabel>
                  <select className={selectKlasse} defaultValue="hp_unter">
                    <option value="hp_unter">hp_unter — Party-HP unter Schwelle</option>
                    <option value="runde_jede">runde_jede — ab Runde n</option>
                    <option value="gruppenmitglieder_unter">gruppenmitglieder_unter</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <FeldLabel>Hinterhalt</FeldLabel>
              <select
                value={doc.regeln.hinterhalt ?? 'keiner'}
                onChange={(e) => {
                  patchRegeln({ hinterhalt: e.target.value as HinterhaltArt });
                  if (e.target.value !== 'keiner') onSpiegelPuls();
                }}
                className={selectKlasse}
              >
                {(Object.keys(HINTERHALT_LABELS) as HinterhaltArt[]).map((h) => (
                  <option key={h} value={h}>
                    {HINTERHALT_LABELS[h]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted">
                Steuert die Spiegel-Vorschau im Arena-Canvas.
              </p>
            </div>

            {/* Siegbedingung: gesperrt, aber lesbar (LockedCard-Muster) */}
            <div>
              <FeldLabel>Siegbedingung</FeldLabel>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex cursor-not-allowed items-center gap-2 rounded-md border border-subtle bg-inset px-2 py-1.5 opacity-55 select-none">
                      <Lock className="h-3.5 w-3.5 text-muted" />
                      <span className="flex-1 text-[13px] text-secondary">alle besiegt</span>
                      <span className="rounded border border-warn px-1 py-px text-[10px] text-warn">
                        MVP geschlossen
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64 text-xs">
                    Weitere Siegbedingungen folgen mit dem Battle-Modul.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div>
              <FeldLabel>Musik</FeldLabel>
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5',
                  musikTot ? 'border-error' : 'border-subtle bg-inset',
                )}
              >
                <Music className="h-3.5 w-3.5 text-muted" />
                <span className="flex-1 text-[12px] text-secondary">
                  {doc.musikRef ?? 'Keine Musik im Projekt — Musik-Importer (MS12)'}
                </span>
              </div>
              {musikTot && (
                <p className="mt-1 text-[10px] text-error">
                  Toter musicRef — Musik-Dokument existiert nicht.
                </p>
              )}
              <button
                type="button"
                className="mt-1.5 text-[11px] text-engine transition-colors duration-150 hover:text-foreground"
                onClick={() => undefined}
              >
                Zum Musik-Importer →
              </button>
            </div>

            {/* Profi: Roh-Anzahl + maxGleichzeitig */}
            <div data-profi>
              <FeldLabel>Formation (Rohwerte, Profi)</FeldLabel>
              <label className="flex items-center justify-between gap-2 text-[12px] text-secondary">
                maxGleichzeitig
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={doc.formation.maxGleichzeitig}
                  onChange={(e) =>
                    setDoc({
                      ...doc,
                      formation: { ...doc.formation, maxGleichzeitig: Math.max(1, Number(e.target.value) || 1) },
                    })
                  }
                  className="h-7 w-16 rounded border border-subtle bg-inset px-1.5 font-mono text-[12px] text-foreground outline-none"
                />
              </label>
              <p className="mt-1 text-[10px] text-muted">
                Roh-anzahl je Gegnerart wird aus den Canvas-Markern abgeleitet (Einfach-Modus).
              </p>
            </div>
          </div>
          <ProfiDisclosure
            panelId="schlacht-inspektor-rohwerte"
            anzahl={2}
            titel="Rohwerte"
            offen={rohwerteOffen}
            onToggle={setRohwerteOffen}
            className="mt-4"
          />
        </TabsContent>

        {/* ---------------- Tab Belohnung ---------------- */}
        <TabsContent value="belohnung" className="min-h-0 flex-1 overflow-y-auto p-3">
          <FeldLabel>Modifikatoren</FeldLabel>
          {modZeile('expMod', 'EXP ×')}
          {modZeile('apMod', 'AP ×')}
          {modZeile('gilMod', 'Gil ×')}

          <div className="mt-3 rounded-md border border-subtle bg-inset p-3">
            <FeldLabel>Summen (live)</FeldLabel>
            <div className="space-y-1">
              {(
                [
                  { label: 'EXP', wert: summen.exp },
                  { label: 'AP', wert: summen.ap },
                  { label: 'Gil', wert: summen.gil },
                ]
              ).map((z) => (
                <div key={z.label} className="flex items-baseline justify-between">
                  <span className="text-[12px] text-secondary">{z.label}</span>
                  <motion.span
                    key={z.wert}
                    initial={{ opacity: 0.4 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="font-mono text-[15px] font-medium text-foreground"
                  >
                    {z.wert}
                  </motion.span>
                </div>
              ))}
            </div>
            <p className="mt-2 border-t border-subtle pt-2 text-[11px] leading-snug text-muted">
              {summen.aufschluesselung}
            </p>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <FeldLabel>Garantierte Drops</FeldLabel>
              <button
                type="button"
                aria-label="Drop hinzufügen"
                onClick={() =>
                  patchBelohnung({ garantierteDrops: [...drops, { itemRef: DEMO_ITEMS[0]!.ref }] })
                }
                className="flex h-5 w-5 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-mako-dim hover:text-mako"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {drops.length === 0 && (
              <p className="rounded border border-dashed border-subtle px-2 py-2 text-center text-[11px] text-muted">
                Keine garantierten Drops.
              </p>
            )}
            <div className="space-y-1.5">
              {drops.map((d, i) => {
                const tot = !DEMO_ITEMS.some((it) => it.ref === d.itemRef);
                return (
                  <motion.div
                    key={`${d.itemRef}-${i}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-1.5 py-1',
                      tot ? 'border-error' : 'border-subtle bg-inset',
                    )}
                  >
                    <select
                      value={d.itemRef}
                      onChange={(e) =>
                        patchBelohnung({
                          garantierteDrops: drops.map((dd, j) => (j === i ? { itemRef: e.target.value } : dd)),
                        })
                      }
                      className="h-6 min-w-0 flex-1 rounded border border-subtle bg-panel px-1 font-mono text-[11px] text-foreground outline-none"
                    >
                      {DEMO_ITEMS.map((it) => (
                        <option key={it.ref} value={it.ref}>
                          {itemName(it.ref)}
                        </option>
                      ))}
                      {tot && <option value={d.itemRef}>{d.itemRef}</option>}
                    </select>
                    <button
                      type="button"
                      aria-label="Drop entfernen"
                      onClick={() => patchBelohnung({ garantierteDrops: drops.filter((_, j) => j !== i) })}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-error"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </motion.div>
                );
              })}
            </div>
            {fluchtWarnung && (
              <p className="mt-2 rounded border border-warn/50 bg-warn/5 px-2 py-1.5 text-[11px] leading-snug text-warn">
                Flucht verboten ohne garantierte Drops — Spieler können festhängen (Balancing-Risiko).
              </p>
            )}
          </div>
        </TabsContent>

        {/* ---------------- Tab Verknüpfung ---------------- */}
        <TabsContent value="verknuepfung" className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-4">
            {/* Encounter-Zone */}
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <FeldLabel>Encounter-Zone</FeldLabel>
                {doc.verknuepfung && 'feldRef' in doc.verknuepfung ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-mako" title="Verknüpft" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full border border-warn" title="Unverknüpft" />
                )}
              </div>

              {/* Mini-Top-Down-Karte */}
              <div className="relative h-[160px] overflow-hidden rounded-md border border-subtle bg-inset">
                <svg className="absolute inset-0 h-full w-full">
                  <defs>
                    <pattern id="feld-raster" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M20 0H0V20" fill="none" stroke="var(--border-strong)" strokeOpacity="0.25" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#feld-raster)" />
                </svg>
                {feld.zonen.map((z) => {
                  const aktivZ = z.id === aktivZone;
                  return (
                    <motion.button
                      key={z.id}
                      type="button"
                      onClick={() => setDoc({ ...doc, verknuepfung: { feldRef: feld.feldRef, encounterZone: z.id } })}
                      className={cn(
                        'absolute rounded border text-[9.5px] transition-colors duration-200',
                        aktivZ
                          ? 'border-mako bg-mako/15 text-mako'
                          : 'border-strong bg-panel/60 text-muted hover:border-mako/50 hover:text-secondary',
                      )}
                      style={{
                        left: `${z.rect.x * 100}%`,
                        top: `${z.rect.y * 100}%`,
                        width: `${z.rect.w * 100}%`,
                        height: `${z.rect.h * 100}%`,
                      }}
                      initial={false}
                      animate={aktivZ ? { boxShadow: '0 0 0 1px rgba(61,220,151,.4)' } : { boxShadow: 'none' }}
                      transition={{ duration: 0.2 }}
                    >
                      {z.name}
                    </motion.button>
                  );
                })}
              </div>

              <div className="mt-2 space-y-2">
                <div>
                  <FeldLabel>Field</FeldLabel>
                  <select
                    value={aktivFeld}
                    onChange={(e) => {
                      const ziel = ENCOUNTER_FELDER.find((f) => f.feldRef === e.target.value)!;
                      setDoc({ ...doc, verknuepfung: { feldRef: ziel.feldRef, encounterZone: ziel.zonen[0]?.id ?? '' } });
                    }}
                    className={selectKlasse}
                  >
                    {ENCOUNTER_FELDER.map((f) => (
                      <option key={f.feldRef} value={f.feldRef}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1">
                    {feld.original ? (
                      <RefBadge refId={feld.feldRef} guardHash="a3f9…c1" />
                    ) : (
                      <span className="font-mono text-[10px] text-muted">{feld.feldRef}</span>
                    )}
                  </div>
                </div>
                <div>
                  <FeldLabel>Zone</FeldLabel>
                  {feld.zonen.length > 0 ? (
                    <select
                      value={aktivZone}
                      onChange={(e) => setDoc({ ...doc, verknuepfung: { feldRef: feld.feldRef, encounterZone: e.target.value } })}
                      className={selectKlasse}
                    >
                      {feld.zonen.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Link to="/felder" className="text-[11px] text-engine hover:text-foreground">
                      Zone im Field-Editor anlegen →
                    </Link>
                  )}
                  {zone && (
                    <p className="mt-1 text-[10px] text-muted">
                      Zone „{zone.name}" ist auf der Karte markiert (Mako-Outline).
                    </p>
                  )}
                </div>
                {doc.verknuepfung && 'feldRef' in doc.verknuepfung && (
                  <button
                    type="button"
                    onClick={() => setDoc({ ...doc, verknuepfung: undefined })}
                    className="text-[11px] text-muted transition-colors duration-150 hover:text-error"
                  >
                    Verknüpfung lösen
                  </button>
                )}
              </div>
            </div>

            <div className="border-t border-subtle" />

            {/* Script-Start */}
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <FeldLabel>Script-Start</FeldLabel>
                {scriptVerknuepft ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-mako" title="Verknüpft" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full border border-warn" title="Unverknüpft" />
                )}
              </div>
              <p className="mb-2 text-[11px] leading-snug text-secondary">
                Ein Battle-Knoten „Kampf starten" im Quest-Editor kann diese Szene referenzieren.
              </p>
              {scriptVerknuepft ? (
                <Link
                  to="/quests"
                  className="flex items-center gap-2 rounded-md border border-subtle bg-inset px-2 py-1.5 transition-colors duration-150 hover:border-mako/50"
                >
                  <Workflow className="h-3.5 w-3.5 shrink-0 text-engine" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-foreground">{DEMO_SCRIPT_VERWEIS.knotenName}</span>
                    <span className="block truncate font-mono text-[10px] text-muted">
                      {DEMO_SCRIPT_VERWEIS.scriptRef}
                    </span>
                  </span>
                </Link>
              ) : (
                <div className="rounded-md border border-dashed border-subtle px-2 py-2.5 text-center text-[11px] text-muted">
                  Noch kein Script-Knoten verweist auf diese Szene
                </div>
              )}
              <p className="mt-2 flex items-start gap-1 text-[10px] leading-snug text-muted">
                <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
                Doppel-Verknüpfung erlaubt: Zone und Script zeigen ihren Status unabhängig.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
