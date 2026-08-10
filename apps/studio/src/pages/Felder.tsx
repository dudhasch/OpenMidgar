/**
 * Field-Editor (`#/felder`) — Säule Welt (felder.md).
 * Zwei Modi: „Neues Field" (Hintergrund + Walkmesh-Dreieckseditor mit
 * Live-Invarianten + Kamerapose) und „Original annotieren (Delta)"
 * (Delta-Karte mit Anker/guardHash/Operationen). IDE-Shell: Field-Liste
 * links, 2D-Canvas mitte, Eigenschaften-Inspektor rechts.
 * Zustand lokal (useState), Demo-Daten aus mock-project.ts.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Image as ImageIcon, Map as MapIcon, MapPlus, Shield } from 'lucide-react';
import { toast } from 'sonner';
import FieldCanvas from '@/components/felder/FieldCanvas';
import FieldInspektor from '@/components/felder/FieldInspektor';
import FieldListe from '@/components/felder/FieldListe';
import type { FieldEintrag } from '@/components/felder/FieldListe';
import WizardDialog from '@/components/shared/WizardDialog';
import { wizardSlug } from '@/components/shared/WizardDialog';
import {
  demoFeldMesh,
  demoGateways,
  demoKamera,
  demoTrigger,
  pruefeWalkmesh,
  SLUMKIRCHE_FIELD_ID,
} from '@/lib/charfelder';
import type { CanvasSelektion } from '@/lib/charfelder';
import { demoFieldDelta } from '@/lib/mock-project';
import { cn } from '@/lib/utils';

const DEMO_FELDER: FieldEintrag[] = [
  { id: 'slumkirche', name: 'Slumkirche außen', typ: 'neu', zaehler: { dreiecke: 12, trigger: 1, gateways: 2 } },
  { id: 'sektor8', name: 'Sektor-8-Platz Δ', typ: 'delta', zielField: 'field:md1_1', zaehler: { dreiecke: 0, trigger: 1, gateways: 1 } },
];

export default function FelderPage() {
  const [felder, setFelder] = useState<FieldEintrag[]>(DEMO_FELDER);
  const [aktivId, setAktivId] = useState('slumkirche');
  const [mesh, setMesh] = useState(demoFeldMesh);
  const [trigger, setTrigger] = useState(demoTrigger);
  const [gateways, setGateways] = useState(demoGateways);
  const [kamera, setKamera] = useState(demoKamera);
  const [selektion, setSelektion] = useState<CanvasSelektion>(null);
  const [fokus, setFokus] = useState<{ dreieck: number; n: number } | null>(null);
  const [wizardOffen, setWizardOffen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  /* Schnellaktion (Home) öffnet den Wizard via location.state. */
  useEffect(() => {
    if ((location.state as { wizard?: boolean } | null)?.wizard) {
      setWizardOffen(true);
      navigate('.', { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aktiv = felder.find((f) => f.id === aktivId) ?? felder[0]!;
  const modus = aktiv.typ;
  const befunde = useMemo(() => pruefeWalkmesh(mesh), [mesh]);
  const fehlerDreiecke = useMemo(() => new Set(befunde.map((b) => b.dreieck)).size, [befunde]);

  const fokussieren = (dreieck: number) => {
    setSelektion({ art: 'dreieck', index: dreieck });
    setFokus((f) => ({ dreieck, n: (f?.n ?? 0) + 1 }));
  };

  const modusWechseln = (ziel: 'neu' | 'delta') => {
    const treffer = felder.find((f) => f.typ === ziel);
    if (treffer) {
      setAktivId(treffer.id);
      setSelektion(null);
    }
  };

  const fieldAnlegen = (typ: 'neu' | 'delta', zielField?: string) => {
    const id = `feld-${Date.now() % 10000}`;
    const eintrag: FieldEintrag =
      typ === 'neu'
        ? { id, name: 'Neues Field', typ, zaehler: { dreiecke: 0, trigger: 0, gateways: 0 } }
        : { id, name: `${zielField ?? 'field:md1_1'} Δ`, typ, zielField, zaehler: { dreiecke: 0, trigger: 0, gateways: 0 } };
    setFelder((liste) => [...liste, eintrag]);
    setAktivId(id);
    setSelektion(null);
    if (typ === 'neu') toast.success('Field angelegt', { description: 'Hintergrundbild im Inspektor zuweisen.' });
  };

  /* Wizard-first-Erzeugung (MS17): Kernwahl = Bild-Import / leer / Delta.
     Defaults: Kamerapose = 3/4-Startvorschlag (bleibt demoKamera). */
  const wizardErstellen = ({ name, kern }: { name: string; kern: string }) => {
    const id = `feld-${wizardSlug(name)}`;
    const eintrag: FieldEintrag =
      kern === 'delta'
        ? { id, name, typ: 'delta', zielField: 'field:md1_1', zaehler: { dreiecke: 0, trigger: 0, gateways: 0 } }
        : { id, name, typ: 'neu', zaehler: { dreiecke: 0, trigger: 0, gateways: 0 } };
    setFelder((liste) => [...liste, eintrag]);
    setAktivId(id);
    setSelektion(null);
    toast.success(`„${name}" erstellt`, {
      description:
        kern === 'delta'
          ? 'Delta auf field:md1_1 — Referenz-Anker ist gesetzt.'
          : kern === 'import'
            ? 'Hintergrundbild im Inspektor zuweisen (Map-Importer).'
            : 'Kamerapose: 3/4-Startvorschlag — Walkmesh zeichnen.',
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <FieldListe
        felder={felder}
        aktivId={aktivId}
        onWaehlen={setAktivId}
        onNeu={fieldAnlegen}
        onWizard={() => setWizardOffen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Modus-Umschalter */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-subtle bg-panel px-3">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-secondary">
            {aktiv.name}
          </span>
          <div className="ml-auto flex rounded-md border border-subtle bg-inset p-0.5">
            {(
              [
                { typ: 'neu' as const, label: 'Neues Field' },
                { typ: 'delta' as const, label: 'Original annotieren (Δ)' },
              ]
            ).map((m) => (
              <button
                key={m.typ}
                type="button"
                onClick={() => modusWechseln(m.typ)}
                className={cn(
                  'rounded px-2.5 py-1 text-[11px] transition-colors duration-150',
                  modus === m.typ ? 'bg-mako-dim text-mako' : 'text-secondary hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <FieldCanvas
            modus={modus}
            mesh={mesh}
            setMesh={setMesh}
            trigger={trigger}
            setTrigger={setTrigger}
            gateways={gateways}
            setGateways={setGateways}
            kamera={kamera}
            setKamera={setKamera}
            selektion={selektion}
            setSelektion={setSelektion}
            befunde={befunde}
            fokusDreieck={fokus}
            onBefundKlick={fokussieren}
          />
        </div>
      </div>
      <FieldInspektor
        modus={modus}
        feldName={aktiv.name}
        feldId={aktiv.typ === 'neu' ? SLUMKIRCHE_FIELD_ID : `mod:de.beispiel.nebenquest/field/${aktiv.id}.delta`}
        zielField={aktiv.zielField ?? demoFieldDelta.zielField}
        onRename={(name) => setFelder((liste) => liste.map((f) => (f.id === aktivId ? { ...f, name } : f)))}
        mesh={mesh}
        setMesh={setMesh}
        trigger={trigger}
        setTrigger={setTrigger}
        gateways={gateways}
        setGateways={setGateways}
        kamera={kamera}
        setKamera={setKamera}
        selektion={selektion}
        setSelektion={setSelektion}
        anzahlFehler={fehlerDreiecke}
        onFehlerKlick={() => {
          const erstes = befunde[0];
          if (erstes) fokussieren(erstes.dreieck);
        }}
      />

      {/* Wizard-first-Erzeugung (MS17): Neues Field */}
      <WizardDialog
        offen={wizardOffen}
        onOpenChange={setWizardOffen}
        titel="Neues Field"
        icon={MapPlus}
        nameVorschlag={`Neues Field ${felder.length + 1}`}
        idVorschau={(n) => `mod:de.beispiel.nebenquest/field/${wizardSlug(n)}`}
        kernTitel="Wie möchtest du starten?"
        kernOptionen={[
          { id: 'import', label: 'Aus Bild importieren', beschreibung: 'Hintergrundbild laden, Walkmesh darauf zeichnen (Map-Importer).', icon: ImageIcon },
          { id: 'leer', label: 'Leer beginnen', beschreibung: 'Leeres Field — Hintergrund und Mesh kommen später.', icon: MapIcon },
          { id: 'delta', label: 'Original annotieren (Delta)', beschreibung: 'Original-Field referenzieren und gezielt verändern.', icon: Shield },
        ]}
        defaultsFuer={(kern) => [
          { label: 'Field-Bezug', wert: kern === 'delta' ? 'field:md1_1 (Referenz)' : 'eigenes Field' },
          { label: 'Kamerapose', wert: '3/4-Startvorschlag' },
        ]}
        onErstellen={wizardErstellen}
      />
    </div>
  );
}
