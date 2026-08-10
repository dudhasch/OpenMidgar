/**
 * GegnerAllgemein — Tab „Allgemein" (gegner.md Sektion 3):
 * Block Modell (vier exklusive Radio-Karten: Referenz mit lgp-Autocomplete,
 * Textur-Override, Baukasten MS9 + glTF MS6 als LockedCard), Block Werte
 * (Stats-Slider mit Budget-Band ENEMY_STAT_BAND-Orientierung) und Block
 * Elemente & Status (5-Zustände-Cycler-Matrix + Immunitäts-Chips).
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Box, Puzzle } from 'lucide-react';
import LockedCard from '@/components/shared/LockedCard';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import RefBadge from '@/components/shared/RefBadge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { GESPERRTE_ENEMY_MODELLARTEN } from '@webmidgar/studio-core';
import type { Element, ElementAffinitaet, EnemyStats } from '@webmidgar/studio-core';
import {
  AFFINITAET_LABELS,
  AFFINITAET_STILE,
  BELOHNUNG_FELDER,
  ELEMENT_LABELS,
  LGP_BATTLE_IDS,
  MATRIX_ELEMENTE,
  ORIENTIERUNGS_BAND,
  STAT_FELDER,
  STATUS_LABELS,
  STATUS_UI_REIHENFOLGE,
  TEXTUR_ASSETS,
  bandStatus,
  naechsteAffinitaet,
  staerkeHeuristik,
} from '@/lib/gegner';
import type { GegnerUi } from '@/lib/gegner';
import { cn } from '@/lib/utils';

const TEXTUR_SWATCHES = [
  { name: 'Grün', offset: 0 },
  { name: 'Rostrot', offset: 1 },
  { name: 'Nachtblau', offset: 2 },
  { name: 'Aschgrau', offset: 3 },
];

interface GegnerAllgemeinProps {
  gegner: GegnerUi;
  onPatch: (patch: Partial<GegnerUi>) => void;
}

function Sektion({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-secondary">
        {titel}
      </h3>
      {children}
    </section>
  );
}

export default function GegnerAllgemein({ gegner, onPatch }: GegnerAllgemeinProps) {
  const [autoOffen, setAutoOffen] = useState(false);
  /* Lokale Profi-Disclosure „Mono-Rohwerte" (MS17). */
  const [rohwerteOffen, setRohwerteOffen] = useState(false);

  const modellArt = gegner.modell.art;
  const lgpRef = gegner.modell.art === 'referenz' || gegner.modell.art === 'textur-override' ? gegner.modell.ref : '';
  const lgpGueltig = LGP_BATTLE_IDS.includes(lgpRef);
  const vorschlaege = useMemo(
    () => LGP_BATTLE_IDS.filter((id) => id.toLowerCase().includes(lgpRef.toLowerCase()) && id !== lgpRef),
    [lgpRef],
  );

  const setModellArt = (art: 'referenz' | 'textur-override') => {
    if (art === modellArt) return;
    const ref = lgpGueltig ? lgpRef : 'lgp:battle/rostwolf';
    onPatch({
      modell:
        art === 'referenz'
          ? { art: 'referenz', ref }
          : { art: 'textur-override', ref, texturAsset: TEXTUR_ASSETS[0] as string },
    });
  };

  const setStat = (key: keyof EnemyStats, wert: number) => {
    onPatch({ stats: { ...gegner.stats, [key]: Math.max(0, Math.round(wert)) } });
  };

  const setAffinitaet = (el: Element, zustand: ElementAffinitaet) => {
    const elemente = { ...gegner.affinitaeten.elemente };
    if (zustand === 'normal') delete elemente[el];
    else elemente[el] = zustand;
    onPatch({ affinitaeten: { ...gegner.affinitaeten, elemente } });
  };

  const toggleStatus = (status: (typeof STATUS_UI_REIHENFOLGE)[number]) => {
    const liste = gegner.affinitaeten.statusImmunitaeten;
    const neu = liste.includes(status) ? liste.filter((s) => s !== status) : [...liste, status];
    onPatch({ affinitaeten: { ...gegner.affinitaeten, statusImmunitaeten: neu } });
  };

  const heuristik = staerkeHeuristik(gegner.stats);
  const band = bandStatus(gegner.stats);
  const zeigerProzent = Math.min(100, (heuristik / ORIENTIERUNGS_BAND.skalaMax) * 100);
  const bandVon = (ORIENTIERUNGS_BAND.min / ORIENTIERUNGS_BAND.skalaMax) * 100;
  const bandBreite = ((ORIENTIERUNGS_BAND.max - ORIENTIERUNGS_BAND.min) / ORIENTIERUNGS_BAND.skalaMax) * 100;

  const kartenBasis = 'relative cursor-pointer rounded-lg border bg-panel p-3 transition-opacity duration-200';

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------- Block Modell ------------------------- */}
      <Sektion titel="Modell">
        <div className="flex gap-4">
          {/* Silhouetten-Vorschau */}
          <div className="flex w-36 shrink-0 flex-col items-center gap-1.5">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-inset p-2">
              <motion.img
                key={gegner.avatar}
                src={gegner.avatar}
                alt={`Silhouette ${gegner.name}`}
                className="max-h-full max-w-full object-contain"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
              />
            </div>
            <span className="text-[10px] text-muted">Platzhalter-Silhouette</span>
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-2">
            {/* Karte 1: Original-Modell referenzieren */}
            <div
              role="radio"
              aria-checked={modellArt === 'referenz'}
              tabIndex={0}
              onClick={() => setModellArt('referenz')}
              onKeyDown={(e) => e.key === 'Enter' && setModellArt('referenz')}
              className={cn(kartenBasis, modellArt === 'referenz' ? 'border-mako/60' : 'border-subtle opacity-60 hover:opacity-90')}
            >
              {modellArt === 'referenz' && (
                <motion.span layoutId="gegner-modell-rahmen" className="absolute inset-0 rounded-lg border border-mako/60" transition={{ duration: 0.2 }} />
              )}
              <div className="mb-1.5 text-[13px] font-medium text-foreground">Original-Modell referenzieren</div>
              <div className="relative">
                <Input
                  value={lgpRef}
                  onChange={(e) => {
                    const ref = e.target.value;
                    onPatch(
                      gegner.modell.art === 'textur-override'
                        ? { modell: { ...gegner.modell, ref } }
                        : { modell: { art: 'referenz', ref } },
                    );
                    setAutoOffen(true);
                  }}
                  onFocus={() => setAutoOffen(true)}
                  onBlur={() => window.setTimeout(() => setAutoOffen(false), 150)}
                  placeholder="lgp:battle/…"
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
                            onPatch(
                              gegner.modell.art === 'textur-override'
                                ? { modell: { ...gegner.modell, ref: id } }
                                : { modell: { art: 'referenz', ref: id } },
                            );
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
              {lgpRef && !lgpGueltig && <p className="mt-1.5 text-[11px] text-error">Unbekannte Modell-ID „{lgpRef}".</p>}
              {lgpGueltig && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <RefBadge refId={lgpRef} guardHash="b7e2…9d" />
                  <span className="text-[11px] text-muted">Nur referenziert, nichts wird kopiert.</span>
                </div>
              )}
            </div>

            {/* Karte 2: Textur-Override */}
            <div
              role="radio"
              aria-checked={modellArt === 'textur-override'}
              tabIndex={0}
              onClick={() => setModellArt('textur-override')}
              onKeyDown={(e) => e.key === 'Enter' && setModellArt('textur-override')}
              className={cn(kartenBasis, modellArt === 'textur-override' ? 'border-mako/60' : 'border-subtle opacity-60 hover:opacity-90')}
            >
              {modellArt === 'textur-override' && (
                <motion.span layoutId="gegner-modell-rahmen" className="absolute inset-0 rounded-lg border border-mako/60" transition={{ duration: 0.2 }} />
              )}
              <div className="mb-1.5 text-[13px] font-medium text-foreground">Textur-Override (Varianten)</div>
              <div className="mb-2 flex gap-1.5">
                {TEXTUR_SWATCHES.map((v, i) => {
                  const aktivAsset = gegner.modell.art === 'textur-override' ? gegner.modell.texturAsset : '';
                  const aktiv = aktivAsset === TEXTUR_ASSETS[i];
                  return (
                    <button
                      key={v.name}
                      type="button"
                      title={v.name}
                      onClick={() =>
                        onPatch({
                          modell: {
                            art: 'textur-override',
                            ref: lgpGueltig ? lgpRef : 'lgp:battle/mako-schwarm',
                            texturAsset: TEXTUR_ASSETS[i] as string,
                          },
                        })
                      }
                      className={cn(
                        'relative h-10 w-10 overflow-hidden rounded border transition-colors duration-150',
                        aktiv && modellArt === 'textur-override' ? 'border-mako' : 'border-subtle hover:border-strong',
                      )}
                    >
                      <img
                        src="./texture-swatches.png"
                        alt={`Texturvariante ${v.name}`}
                        className="max-w-none"
                        style={{ width: 160, height: 40, marginLeft: -40 * v.offset }}
                      />
                    </button>
                  );
                })}
              </div>
              <Select
                value={gegner.modell.art === 'textur-override' ? gegner.modell.texturAsset : TEXTUR_ASSETS[0]}
                onValueChange={(asset) =>
                  onPatch({
                    modell: {
                      art: 'textur-override',
                      ref: lgpGueltig ? lgpRef : 'lgp:battle/mako-schwarm',
                      texturAsset: asset,
                    },
                  })
                }
              >
                <SelectTrigger className="h-8 border-subtle bg-inset font-mono text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-subtle bg-popover">
                  {TEXTUR_ASSETS.map((p) => (
                    <SelectItem key={p} value={p} className="font-mono text-[11px]">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-muted">
                Nutzerasset — wird ins Paket kopiert (<code className="font-mono">user-asset</code>).
              </p>
            </div>

            {/* Karte 3: Baukasten (MS9, gesperrt) */}
            <LockedCard
              badge={GESPERRTE_ENEMY_MODELLARTEN['baukasten']}
              hinweis="Figuren-Baukasten folgt mit dem Char-Creator (MS9) — reserviertes String-Literal im EnemyDoc-Typ."
              className="p-3"
            >
              <div className="flex items-start gap-2 pr-16">
                <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-locked" />
                <div>
                  <div className="text-[13px] font-medium text-foreground">Baukasten (MS9)</div>
                  <p className="mt-0.5 text-[11px] text-muted">Figuren-Baukasten folgt mit dem Char-Creator.</p>
                </div>
              </div>
            </LockedCard>

            {/* Karte 4: glTF-Import (MS6, gesperrt) */}
            <LockedCard
              badge={GESPERRTE_ENEMY_MODELLARTEN['gltf']}
              hinweis="Post-MVP — der Manifest-Vertrag (capability: model.gltf) ist bereits reserviert."
              className="p-3"
            >
              <div className="flex items-start gap-2 pr-16">
                <Box className="mt-0.5 h-4 w-4 shrink-0 text-locked" />
                <div>
                  <div className="text-[13px] font-medium text-foreground">glTF-Import (MS6)</div>
                  <p className="mt-0.5 text-[11px] text-muted">Eigene 3D-Modelle folgen mit der Runtime-Modellpipeline.</p>
                </div>
              </div>
            </LockedCard>
          </div>
        </div>
      </Sektion>

      {/* ------------------------- Block Werte -------------------------- */}
      <Sektion titel="Werte">
        {/* Budget-Band */}
        <div className="mb-3 rounded-lg border border-subtle bg-panel p-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-secondary">
              Original-Level-Band <span className="font-mono text-foreground">{ORIENTIERUNGS_BAND.label}</span>
            </span>
            <span className="font-mono text-muted">
              Stärke {heuristik} / Band {ORIENTIERUNGS_BAND.min}–{ORIENTIERUNGS_BAND.max}
            </span>
          </div>
          <div className="relative h-2.5 rounded bg-inset">
            <span className="absolute top-0 h-full rounded bg-mako/30" style={{ left: `${bandVon}%`, width: `${bandBreite}%` }} />
            <motion.span
              className={cn('absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded', band === 'im-band' ? 'bg-mako' : 'bg-warn')}
              animate={{ left: `calc(${zeigerProzent}% - 2px)` }}
              transition={{ duration: 0.12 }}
            />
          </div>
          {band !== 'im-band' && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-1.5 flex items-center gap-1.5 text-[11px] text-warn"
            >
              <AlertTriangle className="h-3 w-3" />
              Stats {band === 'darueber' ? 'oberhalb' : 'unterhalb'} des Orientierungsbands ({ORIENTIERUNGS_BAND.label})
            </motion.p>
          )}
        </div>

        {/* Stats-Grid */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          {[...STAT_FELDER, ...BELOHNUNG_FELDER].map((feld) => {
            const wert = gegner.stats[feld.key];
            return (
              <div key={feld.key} className="flex items-center gap-2">
                <label className="w-24 shrink-0 text-[12px] text-secondary">{feld.label}</label>
                <Slider
                  value={[Math.min(wert, feld.max)]}
                  min={0}
                  max={feld.max}
                  step={1}
                  onValueChange={([v]) => setStat(feld.key, v ?? wert)}
                  className="min-w-0 flex-1"
                />
                <Input
                  type="number"
                  value={wert}
                  min={0}
                  max={feld.max}
                  onChange={(e) => setStat(feld.key, Math.min(feld.max, Number(e.target.value) || 0))}
                  className="h-7 w-[70px] shrink-0 border-subtle bg-inset px-1.5 font-mono text-[12px]"
                />
              </div>
            );
          })}
        </div>

        {/* Mono-Rohwerte (data-profi) — lokal aufklappbar (MS17) */}
        <div {...(rohwerteOffen ? { 'data-profi-offen': '' } : {})}>
          <div data-profi className="mt-2 rounded border border-subtle bg-inset px-2 py-1.5 font-mono text-[10px] text-muted">
            Σ {heuristik} · hp {gegner.stats.hp} · mp {gegner.stats.mp} · st {gegner.stats.staerke} · ab {gegner.stats.abwehr} ·
            ma {gegner.stats.magie} · mab {gegner.stats.magAbwehr} · ge {gegner.stats.geschick} · gl {gegner.stats.glueck} ·
            lvl {gegner.stats.level}
          </div>
        </div>
        <ProfiDisclosure
          panelId="gegner-mono-rohwerte"
          anzahl={1}
          titel="Mono-Rohwerte"
          offen={rohwerteOffen}
          onToggle={setRohwerteOffen}
          className="mt-1"
        />
      </Sektion>

      {/* ------------------- Block Elemente & Status -------------------- */}
      <Sektion titel="Elemente & Status">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {MATRIX_ELEMENTE.map((el) => {
            const zustand = (gegner.affinitaeten.elemente[el] ?? 'normal') as ElementAffinitaet;
            return (
              <div key={el} className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-[12px] text-secondary">{ELEMENT_LABELS[el]}</span>
                <motion.button
                  type="button"
                  onClick={(e) => setAffinitaet(el, naechsteAffinitaet(zustand, e.shiftKey ? -1 : 1))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setAffinitaet(el, naechsteAffinitaet(zustand, -1));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && setAffinitaet(el, naechsteAffinitaet(zustand))}
                  whileTap={{ scale: 1.12 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  title={`${ELEMENT_LABELS[el]}: ${AFFINITAET_LABELS[zustand]} — Klick/Enter cyclet, Shift-Klick/Rechtsklick rückwärts`}
                  className={cn(
                    'w-[86px] shrink-0 rounded border px-1.5 py-1 text-center text-[10px] font-medium transition-colors duration-150',
                    AFFINITAET_STILE[zustand],
                  )}
                >
                  {AFFINITAET_LABELS[zustand]}
                </motion.button>
              </div>
            );
          })}
        </div>

        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-muted">Status-Immunitäten</div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_UI_REIHENFOLGE.map((s) => {
              const immun = gegner.affinitaeten.statusImmunitaeten.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={immun}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    'rounded border px-1.5 py-1 text-[10px] font-medium transition-colors duration-150',
                    immun
                      ? 'border-engine/60 bg-engine/20 text-engine'
                      : 'border-subtle text-muted hover:border-strong hover:text-secondary',
                  )}
                >
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Legende */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          {(Object.keys(AFFINITAET_LABELS) as ElementAffinitaet[]).map((z) => (
            <span key={z} className={cn('rounded border px-1.5 py-0.5 text-[10px]', AFFINITAET_STILE[z])}>
              {AFFINITAET_LABELS[z]}
            </span>
          ))}
          <span>· Klick cyclet, Shift-Klick/Rechtsklick rückwärts</span>
        </div>
      </Sektion>
    </div>
  );
}
