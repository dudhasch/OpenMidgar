/**
 * CompilePanel — „Paket kompilieren" (paket.md Sektion 4):
 * Primary-Button mit Mako-Glow; während des Builds Füllbalken +
 * Prozent + rotierende Phase, darunter Phasenliste mit nacheinander
 * aufpopenden Häkchen. Ergebniszeile (Erfolg Mako / Fehler rot mit
 * Shake), Download-Button, „Audit anzeigen", „Befunde anzeigen".
 */
import { motion } from 'framer-motion';
import { CheckCircle2, Download, ListChecks, Package, Table2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PaketPanel from '@/components/paket/PaketPanel';
import { formatiereBytes, kurzDigest, type PaketBuild } from '@/lib/paket';
import { cn } from '@/lib/utils';

export type CompileStatus = 'idle' | 'laufend' | 'fertig';

export interface PhaseState {
  id: string;
  label: string;
  zustand: 'offen' | 'aktiv' | 'fertig';
}

interface CompilePanelProps {
  status: CompileStatus;
  phasen: PhaseState[];
  fortschritt: number;
  ergebnis: PaketBuild | null;
  onKompilieren: () => void;
  onValidieren: () => void;
  onDownload: (build: PaketBuild) => void;
  onBefundeAnzeigen: () => void;
  onAuditAnzeigen: () => void;
}

export default function CompilePanel({
  status,
  phasen,
  fortschritt,
  ergebnis,
  onKompilieren,
  onValidieren,
  onDownload,
  onBefundeAnzeigen,
  onAuditAnzeigen,
}: CompilePanelProps) {
  const laufend = status === 'laufend';
  const aktivePhase = phasen.find((p) => p.zustand === 'aktiv');
  const fehler = ergebnis !== null && !ergebnis.ok;
  const fehlerAnzahl = ergebnis?.befunde.filter((b) => b.klasse === 'fehler').length ?? 0;

  return (
    <PaketPanel titel="Kompilieren">
      <div className="flex flex-col gap-3">
        {/* Button / Fortschrittsanzeige */}
        {laufend ? (
          <div
            className="relative h-10 w-full overflow-hidden rounded-md border border-mako/40 bg-inset"
            role="progressbar"
            aria-valuenow={fortschritt}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Kompilierung läuft"
          >
            <motion.div
              className="absolute inset-y-0 left-0 bg-mako/25"
              initial={false}
              animate={{ width: `${fortschritt}%` }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            />
            <div className="absolute inset-0 flex items-center justify-between px-3">
              <span className="font-mono text-[11px] text-foreground">{aktivePhase?.label ?? 'Abschluss'} …</span>
              <span className="font-mono text-[11px] text-mako">{fortschritt}%</span>
            </div>
          </div>
        ) : (
          <Button
            onClick={onKompilieren}
            className="h-10 w-full gap-2 bg-mako font-semibold text-primary-foreground shadow-mako-glow transition-colors duration-150 hover:bg-mako-hover"
          >
            <Package className="h-4 w-4" />
            Paket kompilieren
          </Button>
        )}

        {/* Phasenliste (während des Builds) */}
        {laufend && (
          <ul className="flex flex-col gap-1">
            {phasen.map((phase, i) => (
              <li key={phase.id} className="flex items-center gap-2 text-[11px]">
                {phase.zustand === 'fertig' ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.2, delay: i * 0.12, ease: [0.34, 1.56, 0.64, 1] }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-mako" />
                  </motion.span>
                ) : (
                  <span
                    className={cn(
                      'h-3.5 w-3.5 rounded-full border',
                      phase.zustand === 'aktiv' ? 'animate-mako-pulse border-mako bg-mako/30' : 'border-subtle bg-inset',
                    )}
                  />
                )}
                <span className={cn('font-mono', phase.zustand === 'offen' ? 'text-muted' : 'text-foreground')}>{phase.label}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Ergebniszeile */}
        {status === 'fertig' && ergebnis && (
          <motion.div
            key={ergebnis.nr}
            initial={fehler ? { x: 0 } : { opacity: 0, y: 6 }}
            animate={fehler ? { x: [0, -4, 4, -2, 0] } : { opacity: 1, y: 0 }}
            transition={{ duration: fehler ? 0.3 : 0.2 }}
            className="flex flex-col gap-2.5"
          >
            {ergebnis.ok ? (
              <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-mako/30 bg-mako-dim px-3 py-2 text-[12px]">
                {/* Erfolgs-Puls (einmalig, 500ms) */}
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-md border border-mako"
                  initial={{ opacity: 0.6, scale: 1 }}
                  animate={{ opacity: 0, scale: 1.06 }}
                  transition={{ duration: 0.5 }}
                />
                <CheckCircle2 className="h-4 w-4 shrink-0 text-mako" />
                <span className="font-mono text-[11px] text-foreground">
                  .wmmod bereit · {ergebnis.dateiAnzahl} Dateien · {formatiereBytes(ergebnis.groesseBytes)}
                  {ergebnis.digest && <> · Digest {kurzDigest(ergebnis.digest)}</>}
                </span>
                {ergebnis.mitWarnungen && (
                  <span className="rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn">mit Warnungen</span>
                )}
                {ergebnis.simuliert && (
                  <span className="rounded border border-error px-1.5 py-0.5 text-[10px] font-medium text-error">SIMULIERT</span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-[12px]">
                <XCircle className="h-4 w-4 shrink-0 text-error" />
                <span className="text-foreground">
                  Kompilierung fehlgeschlagen — {fehlerAnzahl} {fehlerAnzahl === 1 ? 'Fehler' : 'Fehler'}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {ergebnis.ok && ergebnis.paket !== undefined ? (
                <Button
                  variant="ghost"
                  onClick={() => onDownload(ergebnis)}
                  /* Sekundär (MS17 §4): Paket-Primär-CTA ist „Kompilieren". */
                  className="h-8 gap-1.5 border border-subtle text-[12px] font-semibold text-secondary hover:bg-elevated hover:text-foreground"
                >
                  <Download className="h-3.5 w-3.5" />
                  Herunterladen
                </Button>
              ) : (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button disabled className="h-8 gap-1.5 text-[12px]">
                          <Download className="h-3.5 w-3.5" />
                          Herunterladen
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Fehler beheben, dann erneut kompilieren.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {ergebnis.ok && (
                <Button variant="ghost" onClick={onAuditAnzeigen} className="h-8 gap-1.5 text-[12px] text-secondary hover:text-foreground">
                  <Table2 className="h-3.5 w-3.5" />
                  Audit anzeigen
                </Button>
              )}
              {ergebnis.befunde.length > 0 && (
                <Button variant="ghost" onClick={onBefundeAnzeigen} className="h-8 gap-1.5 text-[12px] text-secondary hover:text-foreground">
                  <ListChecks className="h-3.5 w-3.5" />
                  Befunde anzeigen ({ergebnis.befunde.length})
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* Sekundäraktion */}
        {!laufend && (
          <Button
            variant="ghost"
            onClick={onValidieren}
            className="h-8 w-full border border-subtle text-[12px] text-secondary hover:border-strong hover:text-foreground"
          >
            Nur validieren
          </Button>
        )}
      </div>
    </PaketPanel>
  );
}
