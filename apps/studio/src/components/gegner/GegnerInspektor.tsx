/**
 * GegnerInspektor — rechter Inspektor des Gegner-Editors (gegner.md Sektion 7),
 * kontextabhängig zum aktiven Tab: Stat-Profil + Beschreibung (Allgemein),
 * Taxonomie-Hilfe (Angriffe), Bedingungs-Referenz + Determinismus (Verhalten),
 * Item-Quellen-Legende (Beute).
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import { Textarea } from '@/components/ui/textarea';
import { EFFECT_ARTEN } from '@webmidgar/studio-core';
import type { EffectArt } from '@webmidgar/studio-core';
import {
  BEDINGUNG_REFERENZ,
  EFFECT_ART_HILFE,
  MOCK_ITEMS,
  ORIENTIERUNGS_BAND,
  bandStatus,
  ffZeichensatzOk,
  staerkeHeuristik,
} from '@/lib/gegner';
import type { GegnerUi } from '@/lib/gegner';
import { cn } from '@/lib/utils';

export type GegnerTab = 'allgemein' | 'angriffe' | 'verhalten' | 'beute';

interface GegnerInspektorProps {
  gegner: GegnerUi | null;
  tab: GegnerTab;
  onPatch: (patch: Partial<GegnerUi>) => void;
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

const PROFIL_ACHSEN = [
  { key: 'staerke', label: 'Stärke' },
  { key: 'abwehr', label: 'Abwehr' },
  { key: 'magie', label: 'Magie' },
  { key: 'magAbwehr', label: 'M-Abwehr' },
  { key: 'geschick', label: 'Geschick' },
  { key: 'glueck', label: 'Glück' },
] as const;

export default function GegnerInspektor({ gegner, tab, onPatch }: GegnerInspektorProps) {
  const [offeneArt, setOffeneArt] = useState<EffectArt | null>('schaden');
  /* Lokale Profi-Disclosure „Bedingungs-Referenz" (MS17, Tab Verhalten). */
  const [bedingungOffen, setBedingungOffen] = useState(false);

  if (!gegner) {
    return (
      <aside className="flex w-[280px] shrink-0 items-center justify-center border-l border-subtle bg-panel p-6 text-center text-[13px] text-secondary">
        Kein Gegner ausgewählt.
      </aside>
    );
  }

  const band = bandStatus(gegner.stats);
  const heuristik = staerkeHeuristik(gegner.stats);
  const beschreibungOk = ffZeichensatzOk(gegner.beschreibung ?? '');

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-subtle bg-panel">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'allgemein' && (
            <>
              <Block titel="Stat-Profil">
                <div className="flex flex-col gap-1.5">
                  {PROFIL_ACHSEN.map((achse) => {
                    const wert = gegner.stats[achse.key];
                    return (
                      <div key={achse.key} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[11px] text-muted">{achse.label}</span>
                        <div className="h-1.5 min-w-0 flex-1 rounded bg-inset">
                          <motion.div
                            className="h-full rounded bg-mako"
                            animate={{ width: `${Math.min(100, (wert / 255) * 100)}%` }}
                            transition={{ duration: 0.2 }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-secondary">{wert}</span>
                      </div>
                    );
                  })}
                </div>
                <div
                  className={cn(
                    'mt-2.5 rounded border px-2 py-1.5 text-[11px]',
                    band === 'im-band' ? 'border-mako/40 bg-mako-dim text-mako' : 'border-warn/50 bg-warn/10 text-warn',
                  )}
                >
                  {band === 'im-band'
                    ? `Im Orientierungsband (${ORIENTIERUNGS_BAND.label})`
                    : `Außerhalb des Bands (${ORIENTIERUNGS_BAND.label})`}
                  {' · '}Σ {heuristik}
                </div>
              </Block>
              <Block titel="Beschreibung">
                <Textarea
                  value={gegner.beschreibung ?? ''}
                  onChange={(e) => onPatch({ beschreibung: e.target.value })}
                  rows={5}
                  placeholder="Kurzbeschreibung (optional)…"
                  className={cn('border-subtle bg-inset text-sm', !beschreibungOk && 'border-error focus-visible:outline-error')}
                />
                {!beschreibungOk && <p className="mt-1 text-[11px] text-error">Zeichen nicht im FF-Zeichensatz.</p>}
                <p className="mt-1 text-[10px] text-muted">FF-Zeichensatz · wird paketiert, Aktivierung mit Battle-Modul.</p>
              </Block>
            </>
          )}

          {tab === 'angriffe' && (
            <Block titel="Taxonomie-Hilfe">
              <p className="mb-2 text-[11px] text-muted">
                Geschlossene Effekt-Taxonomie (MS11/ADR-020) — unbekannte Einträge verweigert die Engine mit Diagnose.
              </p>
              <div className="flex flex-col">
                {EFFECT_ARTEN.map((art) => {
                  const offen = offeneArt === art;
                  return (
                    <div key={art} className="border-b border-subtle last:border-0">
                      <button
                        type="button"
                        onClick={() => setOffeneArt(offen ? null : art)}
                        className="flex w-full items-center gap-1.5 py-1.5 text-left transition-colors duration-150 hover:text-foreground"
                      >
                        <motion.span animate={{ rotate: offen ? 90 : 0 }} transition={{ duration: 0.2 }}>
                          <ChevronRight className="h-3 w-3 text-muted" />
                        </motion.span>
                        <code className="font-mono text-[11px] text-mako">{art}</code>
                      </button>
                      <AnimatePresence initial={false}>
                        {offen && (
                          <motion.p
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden pl-5 pr-1 text-[11px] leading-snug text-secondary"
                          >
                            {EFFECT_ART_HILFE[art]}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </Block>
          )}

          {tab === 'verhalten' && (
            /* data-profi-offen: geöffnete „Bedingungs-Referenz"-Disclosure
               macht die Tabelle im Einfach-Modus sichtbar (MS17). */
            <div {...(bedingungOffen ? { 'data-profi-offen': '' } : {})}>
              <Block titel="Bedingungs-Referenz">
                <table data-profi className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-strong text-muted">
                      <th className="pb-1 font-medium">Name</th>
                      <th className="pb-1 font-medium">Parameter</th>
                      <th className="pb-1 font-medium">Beispiel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BEDINGUNG_REFERENZ.map((b) => (
                      <tr key={b.art} className="border-b border-subtle">
                        <td className="py-1 pr-1 font-mono text-mako">{b.art}</td>
                        <td className="py-1 pr-1 text-secondary">{b.parameter}</td>
                        <td className="py-1 font-mono text-[10px] text-muted">{b.beispiel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Block>
              <Block titel="Determinismus">
                <p className="flex items-start gap-1.5 rounded border border-mako/40 bg-mako-dim px-2 py-1.5 text-[11px] text-mako">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Auswertung deterministisch: erste zutreffende Regel, Tiebreak = Gewicht, feste Seed-Ableitung.
                </p>
              </Block>
              <div className="px-3 py-2">
                <ProfiDisclosure
                  panelId="gegner-bedingungs-referenz"
                  anzahl={1}
                  titel="Bedingungs-Referenz"
                  offen={bedingungOffen}
                  onToggle={setBedingungOffen}
                />
              </div>
            </div>
          )}

          {tab === 'beute' && (
            <Block titel="Item-Quellen">
              <div className="flex flex-col gap-2">
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] text-secondary">
                    <span className="rounded border border-mako/50 bg-mako-dim px-1 font-mono text-[9px] text-mako">eigen</span>
                    Eigene MS11-Items (werden paketiert)
                  </div>
                  {MOCK_ITEMS.filter((i) => i.eigen).map((i) => (
                    <div key={i.ref} className="ml-1 flex items-baseline justify-between gap-2 py-0.5">
                      <span className="text-[12px] text-foreground">{i.name}</span>
                      <code className="truncate font-mono text-[9px] text-muted">{i.ref}</code>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] text-secondary">
                    <span className="rounded border border-engine/40 px-1 font-mono text-[9px] text-engine">kernel:item/…</span>
                    Original-Referenzen (nur referenziert)
                  </div>
                  {MOCK_ITEMS.filter((i) => !i.eigen).map((i) => (
                    <div key={i.ref} className="ml-1 flex items-baseline justify-between gap-2 py-0.5">
                      <span className="text-[12px] text-foreground">{i.name}</span>
                      <code className="font-mono text-[9px] text-engine">{i.ref}</code>
                    </div>
                  ))}
                </div>
              </div>
            </Block>
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
