/**
 * AuditTable — Paket-Audit (paket.md Sektion 5): sortierbare Tabelle
 * (Datei / Herkunft-Chip / Bytes / SHA-256 gekürzt + Copy-Button),
 * Determinismus-Block (Doppellauf-Digest-Vergleich) und einklappbare
 * Provenienz-Erklärung (B.7) mit aggregierten Referenz-Badges.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, CheckCircle2, ChevronDown, Cog, Copy, Fingerprint, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import PaketPanel from '@/components/paket/PaketPanel';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import RefBadge from '@/components/shared/RefBadge';
import { aggregiereOriginalReferenzen, formatiereBytes, kurzDigest, type PaketBuild } from '@/lib/paket';
import type { PaketAudit } from '@webmidgar/studio-compiler';
import { cn } from '@/lib/utils';

type SortKey = 'pfad' | 'herkunft' | 'bytes' | 'sha256';

function HerkunftChip({ herkunft }: { herkunft: PaketAudit['herkunft'] }) {
  if (herkunft === 'user-asset') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-engine/40 px-1.5 py-0.5 text-[10px] font-medium text-engine">
        <Upload className="h-3 w-3" />
        user-asset
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-mako/40 px-1.5 py-0.5 text-[10px] font-medium text-mako">
      <Cog className="h-3 w-3" />
      generated
    </span>
  );
}

export default function AuditTable({ build }: { build: PaketBuild | null }) {
  const [sortKey, setSortKey] = useState<SortKey>('pfad');
  const [sortAsc, setSortAsc] = useState(true);
  const [provenienzOffen, setProvenienzOffen] = useState(true);
  /* Lokale Profi-Disclosure „Determinismus-Details" (MS17): gestreute
     data-profi-Elemente (SHA-256-Spalte, Doppellauf-Digest-Block) — der
     gemeinsame Container trägt data-profi-offen, solange sie offen ist. */
  const [determinismusOffen, setDeterminismusOffen] = useState(false);
  const referenzen = useMemo(aggregiereOriginalReferenzen, []);

  const zeilen = useMemo(() => {
    if (!build) return [];
    const dir = sortAsc ? 1 : -1;
    return [...build.audit].sort((a, b) => {
      if (sortKey === 'bytes') return (a.bytes - b.bytes) * dir;
      return a[sortKey].localeCompare(b[sortKey]) * dir;
    });
  }, [build, sortKey, sortAsc]);

  const sortiere = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const kopiereHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      toast.success('Hash kopiert', { description: hash.slice(0, 24) + '…' });
    } catch {
      toast.error('Zwischenablage nicht verfügbar');
    }
  };

  const kopf = (key: SortKey, label: string, className?: string, profi?: boolean) => (
    <th className={cn('px-2 py-1.5 font-medium', className)} {...(profi ? { 'data-profi': '' } : {})}>
      <button
        type="button"
        onClick={() => sortiere(key)}
        className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors duration-150 hover:text-foreground"
      >
        {label}
        <ArrowUp
          className={cn(
            'h-3 w-3 transition-all duration-200',
            sortKey === key ? 'text-mako' : 'text-transparent',
            sortKey === key && !sortAsc && 'rotate-180',
          )}
        />
      </button>
    </th>
  );

  const deterministisch = build?.digest !== undefined && build.digest === build.digestDoppellauf;

  return (
    <PaketPanel
      titel="Paket-Audit"
      right={build && <span className="font-mono text-[10px] text-muted">Build #{String(build.nr).padStart(2, '0')} · v{build.version}</span>}
    >
      {build === null || build.audit.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-muted">
          {build !== null && !build.ok
            ? 'Dieser Build ist fehlgeschlagen — es wurde kein Paket erzeugt.'
            : 'Noch kein Audit — kompiliere das Projekt, um jede Paketdatei mit Herkunft, Bytes und SHA-256 zu sehen.'}
        </p>
      ) : (
        <>
          {/* data-profi-offen umschließt Tabelle + Digest-Block: die gestreuten
              data-profi-Elemente (SHA-256-Spalte, Doppellauf) werden sichtbar,
              solange die lokale Disclosure offen ist. */}
          <div {...(determinismusOffen ? { 'data-profi-offen': '' } : {})}>
            <div className="overflow-auto rounded-md border border-subtle">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-panel text-[10px] text-muted">
                <tr className="border-b border-strong">
                  {kopf('pfad', 'Datei')}
                  {kopf('herkunft', 'Herkunft')}
                  {kopf('bytes', 'Bytes', 'text-right')}
                  {kopf('sha256', 'SHA-256', undefined, true)}
                </tr>
              </thead>
              <tbody>
                {zeilen.map((eintrag, i) => (
                  <motion.tr
                    key={`${build.nr}-${eintrag.pfad}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: i * 0.025 }}
                    className="border-b border-subtle/60 transition-colors duration-150 hover:bg-elevated"
                  >
                    <td className="max-w-0 truncate px-2 py-1.5 font-mono text-[11px] text-foreground" title={eintrag.pfad}>
                      {eintrag.pfad}
                    </td>
                    <td className="px-2 py-1.5">
                      <HerkunftChip herkunft={eintrag.herkunft} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px] text-secondary">
                      {formatiereBytes(eintrag.bytes)}
                    </td>
                    <td className="px-2 py-1.5" data-profi>
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono text-[11px] text-muted" title={eintrag.sha256}>
                          {eintrag.sha256.slice(0, 12)}
                        </span>
                        <button
                          type="button"
                          aria-label={`SHA-256 von ${eintrag.pfad} kopieren`}
                          onClick={() => void kopiereHash(eintrag.sha256)}
                          className="text-muted transition-colors duration-150 hover:text-mako"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Determinismus-Block (Profi-Element, MS17) */}
          {build.digest !== undefined && (
            <div
              data-profi
              className={cn(
                'mt-2.5 flex items-center gap-2 rounded-md border px-3 py-2 text-[11px]',
                deterministisch ? 'border-mako/30 bg-mako-dim' : 'border-error/40 bg-error/10',
              )}
            >
              <Fingerprint className={cn('h-4 w-4 shrink-0', deterministisch ? 'text-mako' : 'text-error')} />
              <span className="font-mono text-foreground" title={`Lauf 1: ${build.digest}\nLauf 2: ${build.digestDoppellauf ?? '—'}`}>
                Doppellauf-Digest: {kurzDigest(build.digest)} ≡ {build.digestDoppellauf !== undefined ? kurzDigest(build.digestDoppellauf) : '—'}
              </span>
              {deterministisch ? (
                <span className="inline-flex items-center gap-1 text-mako">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  identisch
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-error">
                  <XCircle className="h-3.5 w-3.5" />
                  Abweichung — als Befund melden
                </span>
              )}
            </div>
          )}
          </div>
          <ProfiDisclosure
            panelId="paket-determinismus"
            anzahl={2}
            titel="Determinismus-Details"
            offen={determinismusOffen}
            onToggle={setDeterminismusOffen}
            className="mt-2"
          />
        </>
      )}

      {/* Provenienz-Erklärung (Accordion, standardmäßig offen) */}
      <div className="mt-3 rounded-md border border-subtle">
        <button
          type="button"
          onClick={() => setProvenienzOffen((v) => !v)}
          aria-expanded={provenienzOffen}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-elevated"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-engine" />
          <span className="text-[12px] font-medium text-foreground">Provenienz-Erklärung (B.7)</span>
          <ChevronDown className={cn('ml-auto h-3.5 w-3.5 text-muted transition-transform duration-200', !provenienzOffen && '-rotate-90')} />
        </button>
        <AnimatePresence initial={false}>
          {provenienzOffen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="border-t border-subtle px-3 py-2.5">
                <p className="text-[13px] leading-relaxed text-secondary">
                  Dieses Paket enthält ausschließlich eigene und generierte Inhalte. Originalinhalte des Spiels werden
                  ausschließlich per ID referenziert (<span className="font-mono text-engine">lgp:…</span>,{' '}
                  <span className="font-mono text-engine">field:…</span>) und niemals kopiert oder gespeichert.
                  Verankerungen nutzen guardHashes zur Integritätsprüfung.
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-secondary">
                  Import-Schleuse: Dateiimporte nach <span className="font-mono">assets/</span> werden per SHA-256 gegen
                  die bekannten Original-Hashes der lokalen Installation geprüft — ein byteidentischer Originaltreffer
                  wird verweigert. Deshalb existiert in der Audit-Tabelle kein Herkunft-Chip{' '}
                  <span className="font-mono">original</span>: Originalbytes können strukturell nicht ins Paket gelangen.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {referenzen.map((ref) => (
                    <RefBadge key={`${ref.refId}-${ref.guardHash ?? ''}`} refId={ref.refId} {...(ref.guardHash !== undefined ? { guardHash: ref.guardHash } : {})} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PaketPanel>
  );
}
