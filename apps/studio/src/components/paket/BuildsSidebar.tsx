/**
 * BuildsSidebar — Paket-Historie (paket.md Sektion 1, 240px):
 * Build-Zeilen (Status-Icon, Version + Build-Nr. Mono, Relativzeit,
 * Größe), neue Builds sliden mit Mako-Flash oben ein, Klick lädt die
 * Audit-Tabelle des Builds. Darunter Determinismus-Hinweiskarte.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, History, XCircle } from 'lucide-react';
import { formatiereBytes, relativZeit, type PaketBuild } from '@/lib/paket';
import { cn } from '@/lib/utils';

interface BuildsSidebarProps {
  builds: PaketBuild[];
  selectedNr: number | null;
  onSelect: (nr: number) => void;
}

function StatusIcon({ build }: { build: PaketBuild }) {
  if (!build.ok) return <XCircle className="h-3.5 w-3.5 shrink-0 text-error" />;
  if (build.mitWarnungen) return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />;
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-mako" />;
}

export default function BuildsSidebar({ builds, selectedNr, onSelect }: BuildsSidebarProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-subtle bg-panel">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-subtle px-3">
        <History className="h-3.5 w-3.5 text-muted" />
        <h2 className="font-display text-[15px] font-semibold tracking-tight">Builds</h2>
        <span className="ml-auto font-mono text-[10px] text-muted">{builds.length}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {builds.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-muted">
            Noch keine Builds in dieser Sitzung — kompiliere das Projekt, um die Historie zu füllen.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {builds.map((build) => (
                <motion.li
                  key={build.nr}
                  initial={{ opacity: 0, height: 0, backgroundColor: 'rgba(61,220,151,0.18)' }}
                  animate={{ opacity: 1, height: 'auto', backgroundColor: 'rgba(61,220,151,0)' }}
                  transition={{ height: { duration: 0.22 }, opacity: { duration: 0.22 }, backgroundColor: { duration: 1.2 } }}
                  className="overflow-hidden rounded-md"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(build.nr)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors duration-150',
                      selectedNr === build.nr
                        ? 'border-mako/40 bg-mako-dim'
                        : 'border-transparent hover:bg-elevated',
                    )}
                  >
                    <StatusIcon build={build} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-foreground">
                        v{build.version} · #{String(build.nr).padStart(2, '0')}
                        {build.simuliert && <span className="ml-1 text-error">(sim)</span>}
                      </span>
                      <span className="block text-[10px] text-muted">
                        {relativZeit(build.zeitpunkt)}
                        {build.ok && ` · ${formatiereBytes(build.groesseBytes)}`}
                      </span>
                    </span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <p className="shrink-0 border-t border-subtle p-3 text-[11px] leading-relaxed text-muted">
        Builds sind deterministisch — gleicher Projektstand ergibt identische SHA-256-Digests.
      </p>
    </aside>
  );
}
