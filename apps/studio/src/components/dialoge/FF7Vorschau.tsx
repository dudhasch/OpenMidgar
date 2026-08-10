/**
 * FF7Vorschau — live FF7-Dialogbox (dialoge.md 3.3).
 * Authentische Box (.ff7-box-Gradient, Press Start 2P), Sprecher-Anhängebox,
 * Wort-Umbruch auf Engine-Zeilenbreite, aufgelöste Token (Variable → Demo-Wert,
 * Farbe → Textfarbe, Pause → Tipp-Verzögerung). Tipp-Animation (30 ms/Zeichen),
 * interaktiver ▶-Cursor bei Auswahlmenüs (Pfeiltasten ↑/↓), Überlaufwarnung
 * live (rote Puls-Kante + Warn-Chip + gestrichelte Abschneide-Linie).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { DialogEintrag } from '@/lib/dialoge';
import { MS_PRO_FRAME, TIPP_MS_PRO_ZEICHEN, ZEILEN_PRO_SEITE, loeseSeiteAuf } from '@/lib/dialoge';
import { cn } from '@/lib/utils';

interface FF7VorschauProps {
  eintrag: DialogEintrag;
  seite: number;
  onSeite: (idx: number) => void;
}

export default function FF7Vorschau({ eintrag, seite, onSeite }: FF7VorschauProps) {
  const seitenZahl = eintrag.seiten.length;
  const seiteIdx = Math.min(seite, seitenZahl - 1);
  const aufgeloest = useMemo(() => loeseSeiteAuf(eintrag.seiten[seiteIdx] ?? { text: '' }), [eintrag, seiteIdx]);

  const [getippt, setGetippt] = useState(aufgeloest.zeichenGesamt);
  const [spielend, setSpielend] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [ueberlaufSchonGemeldet, setUeberlaufSchonGemeldet] = useState(false);
  const timer = useRef<number | null>(null);

  const ueberlauf = aufgeloest.zeilen.length > ZEILEN_PRO_SEITE;
  const sichtbareZeilen = aufgeloest.zeilen.slice(0, ZEILEN_PRO_SEITE);

  /* Tipp-Animation: Zeichen für Zeichen, Pause-Token verzögern. */
  const stoppeTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!spielend) return;
    if (getippt >= aufgeloest.zeichenGesamt) {
      setSpielend(false);
      return;
    }
    const pause = aufgeloest.pausen.find((p) => p.nachZeichen === getippt);
    const delay = pause ? pause.frames * MS_PRO_FRAME : TIPP_MS_PRO_ZEICHEN;
    timer.current = window.setTimeout(() => setGetippt((g) => g + 1), delay);
    return stoppeTimer;
  }, [spielend, getippt, aufgeloest, stoppeTimer]);

  const abspielen = useCallback(() => {
    stoppeTimer();
    setGetippt(0);
    setCursor(0);
    setSpielend(true);
  }, [stoppeTimer]);

  /* Bei Text- oder Seitenwechsel: sofort voll rendern (Live-Vorschau). */
  useEffect(() => {
    stoppeTimer();
    setSpielend(false);
    setGetippt(aufgeloest.zeichenGesamt);
    setCursor(0);
  }, [aufgeloest, stoppeTimer]);

  useEffect(() => stoppeTimer, [stoppeTimer]);

  /* Überlauf-Status für Shake-Animation (nur beim ersten Auftreten). */
  useEffect(() => {
    if (ueberlauf && !ueberlaufSchonGemeldet) setUeberlaufSchonGemeldet(true);
    if (!ueberlauf && ueberlaufSchonGemeldet) setUeberlaufSchonGemeldet(false);
  }, [ueberlauf, ueberlaufSchonGemeldet]);

  /* Pfeiltasten bewegen den Auswahl-Cursor (echte Interaktion). */
  const onTastatur = (e: React.KeyboardEvent) => {
    if (aufgeloest.optionen.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(aufgeloest.optionen.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    }
  };

  /* Zeichen bis zur Zeile X verbraucht (für partielles Rendern). */
  const zeilenStart = useMemo(() => {
    const starts: number[] = [];
    let summe = 0;
    for (const z of aufgeloest.zeilen) {
      starts.push(summe);
      summe += z.length;
    }
    return starts;
  }, [aufgeloest]);

  const tippenFertig = getippt >= aufgeloest.zeichenGesamt;

  return (
    <div
      className="flex min-h-0 flex-col bg-inset p-3 focus:outline-none"
      tabIndex={0}
      onKeyDown={onTastatur}
      aria-label="FF7-Dialogbox-Vorschau"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <motion.div
          key={`${eintrag.id}-${seiteIdx}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md"
        >
          {/* Sprecher-Anhängebox */}
          {eintrag.sprecher && (
            <div className="ff7-box relative z-10 -mb-1 ml-3 inline-block px-2.5 py-1">
              <span className="font-ff7 text-[9px] text-white">{eintrag.sprecher}</span>
            </div>
          )}

          {/* Warn-Chip bei Überlauf */}
          <AnimatePresence>
            {ueberlauf && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1, x: ueberlaufSchonGemeldet ? 0 : [0, -4, 4, -2, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute -top-3 right-2 z-20 flex items-center gap-1 rounded border border-error/60 bg-panel px-1.5 py-0.5 text-[10px] font-medium text-error"
              >
                <AlertTriangle className="h-3 w-3" />
                Überlauf: Seite {seiteIdx + 1} hat {aufgeloest.zeilen.length} Zeilen
              </motion.span>
            )}
          </AnimatePresence>

          {/* Dialogbox */}
          <div
            className={cn(
              'ff7-box relative px-4 py-3 transition-shadow duration-200',
              ueberlauf && 'animate-mako-pulse shadow-[0_2px_0_0_var(--error),0_0_12px_rgba(246,107,107,.35)]',
            )}
          >
            <div className="font-ff7 text-[11px] leading-[1.9] text-white">
              {sichtbareZeilen.map((zeile, zi) => {
                const ab = zeilenStart[zi] ?? 0;
                const istOption = aufgeloest.optionen.includes(zi);
                const optionIdx = aufgeloest.optionen.indexOf(zi);
                return (
                  <div key={zi} className="flex min-h-[1.9em] items-baseline">
                    {/* Auswahl-Cursor ▶ */}
                    {istOption ? (
                      <span
                        className={cn(
                          'mr-2 inline-block w-3 shrink-0 transition-opacity duration-150',
                          tippenFertig && cursor === optionIdx ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      >
                        ▶
                      </span>
                    ) : (
                      aufgeloest.optionen.length > 0 && <span className="mr-2 inline-block w-3 shrink-0" aria-hidden />
                    )}
                    <span>
                      {zeile.map((z, ci) =>
                        ab + ci < getippt ? (
                          <span key={ci} style={{ color: z.farbe }}>
                            {z.char}
                          </span>
                        ) : null,
                      )}
                    </span>
                  </div>
                );
              })}
              {/* Leere Box auffüllen, damit die Höhe stabil bleibt */}
              {Array.from({ length: Math.max(0, ZEILEN_PRO_SEITE - sichtbareZeilen.length) }).map((_, i) => (
                <div key={`leer-${i}`} className="min-h-[1.9em]" />
              ))}

              {/* Gestrichelte Abschneide-Linie ab der 4. Zeile */}
              {ueberlauf && (
                <div
                  className="pointer-events-none absolute inset-x-2 border-t border-dashed border-error"
                  style={{ top: `calc(12px + ${ZEILEN_PRO_SEITE} * 1.9em)` }}
                  aria-hidden
                />
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Steuerung unter der Box */}
      <div className="mt-2 flex shrink-0 items-center justify-center gap-1.5">
        <VorschauButton label="Tipp-Animation abspielen" onClick={abspielen} deaktiviert={spielend}>
          <Play className="h-3.5 w-3.5" />
        </VorschauButton>
        <VorschauButton
          label="Nächste Seite"
          onClick={() => onSeite(Math.min(seitenZahl - 1, seiteIdx + 1))}
          deaktiviert={seiteIdx >= seitenZahl - 1}
        >
          <SkipForward className="h-3.5 w-3.5" />
        </VorschauButton>
        <VorschauButton label="Neustart" onClick={abspielen}>
          <RotateCcw className="h-3.5 w-3.5" />
        </VorschauButton>
        <span className="ml-2 font-mono text-[11px] text-muted">
          Seite {seiteIdx + 1}/{seitenZahl}
        </span>
        {aufgeloest.optionen.length > 0 && (
          <span className="ml-3 text-[11px] text-secondary">↑/↓ bewegt den ▶-Cursor</span>
        )}
        {ueberlauf && <span className="ml-3 text-[11px] text-error">Befund (Warnung) wurde ans Dock gemeldet</span>}
      </div>
    </div>
  );
}

function VorschauButton({
  children,
  label,
  onClick,
  deaktiviert,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  deaktiviert?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={deaktiviert}
      className="flex h-7 w-7 items-center justify-center rounded border border-subtle bg-panel text-secondary transition-colors duration-150 hover:border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
