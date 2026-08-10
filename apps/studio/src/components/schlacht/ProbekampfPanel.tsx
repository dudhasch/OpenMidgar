/**
 * ProbekampfPanel — unteres, einklappbares Panel des Battle-Editors
 * (schlacht.md Sektion 4). Deterministische Runden-Timeline (Daten-Timeline,
 * keine Engine): Ereignis-Chips je Runde, HP-Balken je Teilnehmer,
 * Ergebnis-Karte und prominentes Heuristik-Badge „Vorschau ohne Gewähr"
 * (A-ST-17: fester Erwartungsablauf aus Stats + Effekt-Taxonomie +
 * Verhaltensregeln — erscheint nicht im Paket).
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Play,
  Square,
} from 'lucide-react';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import { PARTY_REFERENZ, simuliereProbekampf } from '@/lib/schlacht';
import type { FormationMarker, PartyAnnahme } from '@/lib/schlacht';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ProbekampfPanelProps {
  marker: FormationMarker[];
  offen: boolean;
  setOffen: (b: boolean) => void;
  /** Zähler: jede Erhöhung startet die Timeline (Primär-CTA der Kopfzeile). */
  startSignal: number;
}

export default function ProbekampfPanel({ marker, offen, setOffen, startSignal }: ProbekampfPanelProps) {
  const [annahme, setAnnahme] = useState<PartyAnnahme>(PARTY_REFERENZ);
  const [aktiveRunde, setAktiveRunde] = useState(0); // 0 = Ausgangslage
  const [laeuft, setLaeuft] = useState(false);
  const [tempo, setTempo] = useState(1);
  const [fertig, setFertig] = useState(false);
  /* Lokale Profi-Disclosure „Party-Annahme" (MS17). */
  const [annahmeOffen, setAnnahmeOffen] = useState(false);

  const ergebnis = useMemo(() => simuliereProbekampf(marker, annahme), [marker, annahme]);
  const runden = ergebnis.runden;
  const hpStand = aktiveRunde === 0 ? null : runden[Math.min(aktiveRunde, runden.length) - 1]?.hp;

  /* Primär-CTA: Panel öffnen + Timeline starten */
  useEffect(() => {
    if (startSignal === 0) return;
    setOffen(true);
    setAktiveRunde(0);
    setFertig(false);
    setLaeuft(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  /* Abspielen: aktiver Runden-Marker wandert, Tempo 1×/2×/4× */
  useEffect(() => {
    if (!laeuft) return;
    if (aktiveRunde >= runden.length) {
      setLaeuft(false);
      setFertig(true);
      return;
    }
    const t = window.setTimeout(() => setAktiveRunde((r) => r + 1), 1000 / tempo);
    return () => window.clearTimeout(t);
  }, [laeuft, aktiveRunde, tempo, runden.length]);

  /* Formation/Annahme geändert → Abspielstand zurücksetzen */
  useEffect(() => {
    setAktiveRunde(0);
    setLaeuft(false);
    setFertig(false);
  }, [ergebnis]);

  const stopp = () => {
    setLaeuft(false);
    setAktiveRunde(0);
    setFertig(false);
  };

  const schritt = (delta: number) => {
    setLaeuft(false);
    setFertig(false);
    setAktiveRunde((r) => Math.min(runden.length, Math.max(0, r + delta)));
  };

  return (
    <div className="shrink-0 border-t border-subtle bg-panel">
      {/* Kopfzeile (32px, immer sichtbar) */}
      <div className="flex h-8 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setOffen(!offen)}
          className="flex items-center gap-1.5 text-[12px] font-medium text-foreground transition-colors duration-150 hover:text-mako"
        >
          <motion.span animate={{ rotate: offen ? 0 : -90 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.span>
          Probekampf
        </button>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-default items-center gap-1 rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn">
                <FlaskConical className="h-3 w-3" />
                Vorschau ohne Gewähr — Heuristik, nicht die Engine
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72 text-xs">
              A-ST-17: deterministischer Erwartungsablauf aus Stats + Effekt-Taxonomie +
              Verhaltensregeln. Erscheint <b>nicht</b> im Paket.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="rounded border border-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">
          deterministisch · feste Seed · Gewichts-Max-Regel
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Runde zurück"
            disabled={aktiveRunde === 0}
            onClick={() => schritt(-1)}
            className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-14 text-center font-mono text-[11px] text-secondary">
            {aktiveRunde}/{runden.length}
          </span>
          <button
            type="button"
            aria-label="Runde vor"
            disabled={aktiveRunde >= runden.length}
            onClick={() => schritt(1)}
            className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <select
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            aria-label="Abspielgeschwindigkeit"
            className="ml-1 h-6 rounded border border-subtle bg-inset px-1 font-mono text-[11px] text-secondary outline-none"
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
          <button
            type="button"
            aria-label="Stopp"
            onClick={stopp}
            className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
          >
            <Square className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              setOffen(true);
              setAktiveRunde(0);
              setFertig(false);
              setLaeuft(true);
            }}
            disabled={runden.length === 0}
            /* Sekundär (MS17 §4): Die einzige Mako-Primär-CTA der Ansicht ist
               „Probekampf starten" in der Seiten-Kopfzeile. */
            className="ml-1 flex h-6 items-center gap-1 rounded border border-subtle px-2 text-[11px] font-medium text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            Abspielen
          </button>
        </div>
      </div>

      {/* Körper (einklappbar, 220px) */}
      <motion.div
        initial={false}
        animate={{ height: offen ? 220 : 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
        className="overflow-hidden"
      >
        <div className="flex h-[220px] gap-3 border-t border-subtle p-3">
          {/* Linke Seite: Annahme + Timeline + HP-Balken */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {/* Party-Annahme: data-profi-offen macht die Profi-Inputs sichtbar,
                solange die lokale Disclosure offen ist (MS17). */}
            <div
              className="flex items-center gap-2 text-[12px] text-secondary"
              {...(annahmeOffen ? { 'data-profi-offen': '' } : {})}
            >
              <span>
                Angenommene Party: 3× Lvl {annahme.level} (Referenz-Profil)
              </span>
              <span className="flex items-center gap-1" data-profi>
                {(
                  [
                    { key: 'level' as const, label: 'Lvl' },
                    { key: 'staerke' as const, label: 'Stk' },
                    { key: 'abwehr' as const, label: 'Abw' },
                  ]
                ).map((f) => (
                  <label key={f.key} className="flex items-center gap-1 font-mono text-[10px] text-muted">
                    {f.label}
                    <input
                      type="number"
                      value={annahme[f.key]}
                      min={1}
                      max={f.key === 'level' ? 99 : 255}
                      onChange={(e) => setAnnahme((a) => ({ ...a, [f.key]: Math.max(1, Number(e.target.value) || 1) }))}
                      className="h-5 w-12 rounded border border-subtle bg-inset px-1 font-mono text-[10px] text-foreground outline-none"
                    />
                  </label>
                ))}
              </span>
              <ProfiDisclosure
                panelId="probekampf-party-annahme"
                anzahl={1}
                titel="Party-Annahme"
                offen={annahmeOffen}
                onToggle={setAnnahmeOffen}
                className="ml-auto"
              />
            </div>

            {/* Runden-Timeline */}
            <div className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-md border border-subtle bg-inset p-2">
              {runden.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-muted">
                  Keine Formation — platziere Gegner, um den Probekampf zu sehen.
                </p>
              ) : (
                <div className="flex h-full gap-2">
                  {runden.map((r) => {
                    const aktiv = aktiveRunde >= r.nr;
                    const aktuell = aktiveRunde === r.nr;
                    return (
                      <div
                        key={r.nr}
                        className={cn(
                          'flex w-[120px] shrink-0 flex-col rounded border p-1.5 transition-colors duration-200',
                          aktuell
                            ? 'border-mako bg-mako-dim'
                            : aktiv
                              ? 'border-strong bg-panel'
                              : 'border-subtle bg-panel/50 opacity-55',
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className={cn('font-mono text-[10px]', aktuell ? 'text-mako' : 'text-muted')}>
                            R{r.nr}
                          </span>
                          {aktuell && <span className="h-1.5 w-1.5 animate-mako-pulse rounded-full bg-mako" />}
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                          {aktiv &&
                            r.ereignisse.map((ev, i) => (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: i * 0.25 }}
                                className="rounded border border-subtle bg-elevated px-1 py-0.5 text-[9.5px] leading-snug text-secondary"
                              >
                                <span className="text-foreground">{ev.akteur}</span>:{' '}
                                {ev.schaden === undefined && ev.hinweis ? (
                                  ev.hinweis
                                ) : (
                                  <>
                                    {ev.aktion}
                                    {ev.ziel && <> → {ev.ziel}</>}
                                    {ev.schaden !== undefined && (
                                      <span className={ev.akteur === 'Party' ? 'text-mako' : 'text-error'}>
                                        {' '}
                                        (−{ev.schaden} HP)
                                      </span>
                                    )}
                                    {ev.hinweis && <span className="text-mako"> · {ev.hinweis}</span>}
                                  </>
                                )}
                              </motion.div>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Runden-Fortschrittsbalken */}
              {runden.length > 0 && (
                <div className="absolute bottom-0 left-0 h-0.5 w-full bg-subtle/40">
                  <motion.div
                    className="h-full bg-mako"
                    animate={{ width: `${(aktiveRunde / runden.length) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
            </div>

            {/* HP-Balken-Spur */}
            <div className="grid shrink-0 grid-cols-3 gap-x-3 gap-y-1">
              {ergebnis.teilnehmer.map((t) => {
                const anteil = hpStand ? (hpStand[t.name] ?? 0) : 1;
                const party = t.seite === 'party';
                return (
                  <div key={t.name} className="flex items-center gap-1.5">
                    <span className="w-20 truncate font-mono text-[9.5px] text-muted">{t.name}</span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
                      <motion.div
                        className={cn('h-full rounded-full', party ? 'bg-mako' : 'bg-error')}
                        initial={false}
                        animate={{ width: `${Math.max(0, anteil) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-[9.5px] text-muted">
                      {Math.round(Math.max(0, anteil) * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ergebnis-Karte (rechts, 200px) */}
          <div className="relative w-[200px] shrink-0 rounded-md border border-subtle bg-inset p-3">
            {fertig && ergebnis.ausgang === 'sieg' && (
              <motion.span
                key={`puls-${aktiveRunde}`}
                className="pointer-events-none absolute inset-0 rounded-md border-2 border-mako"
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 1.05, opacity: 0 }}
                transition={{ duration: 0.5 }}
              />
            )}
            <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted">
              Wahrscheinlicher Ausgang
            </div>
            <div
              className={cn(
                'mt-1 font-display text-[14px] font-semibold',
                ergebnis.ausgang === 'sieg' ? 'text-mako' : ergebnis.ausgang === 'niederlage' ? 'text-error' : 'text-secondary',
              )}
            >
              {ergebnis.ausgangText}
            </div>
            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <dt className="text-muted">Erwartete HP-Rest</dt>
                <dd className="font-mono text-foreground">{ergebnis.hpRestProzent} %</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Härteste Runde</dt>
                <dd className="font-mono text-foreground">R{ergebnis.haertesteRunde}</dd>
              </div>
            </dl>
            {ergebnis.regelAusloesungen.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ergebnis.regelAusloesungen.map((r) => (
                  <span key={r.name} className="rounded border border-info/40 px-1 py-px text-[10px] text-info">
                    {r.name} ×{r.anzahl}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-[9.5px] leading-snug text-muted">
              Heuristik-Erwartung — gleiche Eingaben ergeben stets denselben Ablauf.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
