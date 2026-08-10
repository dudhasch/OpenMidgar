/**
 * PaketPage — Paket & Publish (#/paket, paket.md):
 * links Manifest-v2-Formular, rechts abgeleitete Capabilities,
 * Kompilieren (Phasen-Fortschritt → echte Kompilierung via
 * @webmidgar/studio-compiler), Befundliste, .wmmod-Download,
 * Paket-Audit mit Determinismus-Digest, Provenienz-Erklärung und
 * deaktiviertem Testimport. Sidebar: Build-Historie (Sitzungszustand).
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import { toast } from 'sonner';
import AuditTable from '@/components/paket/AuditTable';
import BefundListe from '@/components/paket/BefundListe';
import BuildsSidebar from '@/components/paket/BuildsSidebar';
import CapabilityChips from '@/components/paket/CapabilityChips';
import CompilePanel, { type CompileStatus, type PhaseState } from '@/components/paket/CompilePanel';
import ManifestForm from '@/components/paket/ManifestForm';
import TestImportPanel from '@/components/paket/TestImportPanel';
import EmptyState from '@/components/shared/EmptyState';
import { useAppState } from '@/lib/app-state';
import type { StudioBefund } from '@/lib/mock-project';
import {
  initialManifestForm,
  kompiliereProjekt,
  ladePaketHerunter,
  leiteCapabilitiesAb,
  modIdFehler,
  validiereProjekt,
  type ManifestForm as ManifestFormTyp,
  type PaketBuild,
} from '@/lib/paket';

const PHASEN_TEMPLATE: { id: string; label: string }[] = [
  { id: 'struktur', label: 'Struktur' },
  { id: 'referenzen', label: 'Referenzen' },
  { id: 'semantik', label: 'Semantik' },
  { id: 'manifest', label: 'Manifest' },
  { id: 'paketierung', label: 'Paketierung' },
];

const leerePhasen = (): PhaseState[] => PHASEN_TEMPLATE.map((p, i) => ({ ...p, zustand: i === 0 ? 'aktiv' : 'offen' }));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function PaketPage() {
  const { projektOffen, toggleDock } = useAppState();
  const navigate = useNavigate();

  const [form, setForm] = useState<ManifestFormTyp>(initialManifestForm);
  const [status, setStatus] = useState<CompileStatus>('idle');
  const [phasen, setPhasen] = useState<PhaseState[]>(leerePhasen);
  const [fortschritt, setFortschritt] = useState(0);
  const [ergebnis, setErgebnis] = useState<PaketBuild | null>(null);
  const [builds, setBuilds] = useState<PaketBuild[]>([]);
  const [selectedNr, setSelectedNr] = useState<number | null>(null);
  const [befunde, setBefunde] = useState<StudioBefund[]>([]);
  const [shakeSignal, setShakeSignal] = useState(0);
  const [modIdVersucht, setModIdVersucht] = useState(false);
  const runRef = useRef(0);
  const auditRef = useRef<HTMLDivElement>(null);

  const capabilities = useMemo(leiteCapabilitiesAb, []);
  const selectedBuild = builds.find((b) => b.nr === selectedNr) ?? ergebnis;

  if (!projektOffen) {
    return (
      <EmptyState
        icon={Package}
        titel="Kein Projekt geladen"
        hinweis="Öffne zuerst ein Projekt, um das Manifest zu bearbeiten und ein Paket zu kompilieren."
        ctaLabel="Zum Projekt-Start"
        onCta={() => navigate('/')}
        className="h-full"
      />
    );
  }

  const patchForm = (patch: Partial<ManifestFormTyp>) => setForm((f) => ({ ...f, ...patch }));

  const starteKompilierung = async () => {
    const fehler = modIdFehler(form.modId);
    if (fehler !== null) {
      setModIdVersucht(true);
      setShakeSignal((s) => s + 1);
      setBefunde([
        {
          dokument: 'project.json',
          pfad: 'modId',
          klasse: 'fehler',
          meldung: `modId '${form.modId}' ungültig: ${fehler}`,
          fixHint: 'reverse-DNS-Format, z. B. de.beispiel.nebenquest.',
          quelle: 'kompilierung',
          zielRoute: '/paket',
        },
      ]);
      toast.error('modId ungültig — Kompilierung nicht gestartet.');
      return;
    }
    setModIdVersucht(false);

    const run = ++runRef.current;
    setStatus('laufend');
    setErgebnis(null);
    setBefunde([]);
    setPhasen(leerePhasen());
    setFortschritt(4);

    // Echte Kompilierung läuft parallel zur Phasen-Anzeige; das Ergebnis
    // (Befunde, Manifest, Paket, Audit) kommt vollständig vom Compiler.
    const compilePromise = kompiliereProjekt(form, builds.length + 1);

    for (let i = 0; i < PHASEN_TEMPLATE.length; i++) {
      await sleep(i === 0 ? 260 : 280);
      if (runRef.current !== run) return;
      setPhasen((prev) =>
        prev.map((p, idx) => ({
          ...p,
          zustand: idx <= i ? 'fertig' : idx === i + 1 ? 'aktiv' : 'offen',
        })),
      );
      setFortschritt(Math.round(((i + 1) / PHASEN_TEMPLATE.length) * 100));
    }

    const build = await compilePromise;
    if (runRef.current !== run) return;
    setStatus('fertig');
    setErgebnis(build);
    setBefunde(build.befunde);
    setBuilds((prev) => [build, ...prev]);
    setSelectedNr(build.nr);
    if (build.simuliert) {
      toast.warning('Simulations-Fallback aktiv — echte Kompilierung ist im Browser fehlgeschlagen (siehe Befunde).');
    } else if (!build.ok) {
      toast.error('Kompilierung fehlgeschlagen — Befunde prüfen.');
    }
  };

  const starteValidierung = async () => {
    setModIdVersucht(false);
    const liste = await validiereProjekt(form);
    setBefunde(liste);
    if (liste.length === 0) {
      toast.success('Validierung ohne Befunde — Projekt ist sauber.');
    } else {
      const fehler = liste.filter((b) => b.klasse === 'fehler').length;
      toast.info(`Validierung abgeschlossen: ${liste.length} Befunde${fehler > 0 ? ` (${fehler} Fehler)` : ''}.`);
    }
  };

  const ladeHerunter = (build: PaketBuild) => {
    if (build.paket === undefined) return;
    ladePaketHerunter(build.paket, build.dateiname);
    toast.success(`'${build.dateiname}' gespeichert`, {
      action: { label: 'Erneut herunterladen', onClick: () => ladePaketHerunter(build.paket as Uint8Array, build.dateiname) },
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <BuildsSidebar builds={builds} selectedNr={selectedNr} onSelect={setSelectedNr} />

      <div className="min-w-0 flex-1 overflow-auto">
        <div className="grid items-start gap-4 p-4 xl:grid-cols-2">
          {/* Links: Manifest-Formular */}
          <ManifestForm form={form} onPatch={patchForm} shakeSignal={shakeSignal} modIdVersucht={modIdVersucht} />

          {/* Rechts: Capabilities, Kompilieren, Befunde, Audit, Testimport */}
          <div className="flex min-w-0 flex-col gap-4">
            <CapabilityChips capabilities={capabilities} />
            <CompilePanel
              status={status}
              phasen={phasen}
              fortschritt={fortschritt}
              ergebnis={ergebnis}
              onKompilieren={() => void starteKompilierung()}
              onValidieren={() => void starteValidierung()}
              onDownload={ladeHerunter}
              onBefundeAnzeigen={() => toggleDock()}
              onAuditAnzeigen={() => auditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
            {befunde.length > 0 && <BefundListe befunde={befunde} />}
            <div ref={auditRef} className="scroll-mt-4">
              <AuditTable build={selectedBuild} />
            </div>
            <TestImportPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
