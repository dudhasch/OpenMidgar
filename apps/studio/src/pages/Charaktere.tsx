/**
 * Charakter-Editor (`#/charaktere`) — Säule Figuren (charaktere.md).
 * IDE-Shell: Charakterliste links, Actor-Viewer (Platzhalter) oben,
 * Platzierungs-Canvas (Auftritte) unten, Eigenschaften-Inspektor rechts.
 * Zustand lokal (useState), Demo-Daten aus mock-project.ts.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Image as ImageIcon, Puzzle, Shield, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import ActorViewer from '@/components/charaktere/ActorViewer';
import CharakterInspektor from '@/components/charaktere/CharakterInspektor';
import CharakterListe from '@/components/charaktere/CharakterListe';
import type { CharakterEintrag } from '@/components/charaktere/CharakterListe';
import PlatzierungsCanvas from '@/components/charaktere/PlatzierungsCanvas';
import type { AuftrittUi } from '@/components/charaktere/PlatzierungsCanvas';
import WizardDialog from '@/components/shared/WizardDialog';
import { wizardSlug } from '@/components/shared/WizardDialog';
import { useUiModus } from '@/lib/ui-modus';
import { SLUMKIRCHE_FIELD_ID } from '@/lib/charfelder';
import { demoCharakter } from '@/lib/mock-project';

let naechsteId = 1;

export default function CharakterePage() {
  const [charaktere, setCharaktere] = useState<CharakterEintrag[]>([
    {
      id: demoCharakter.id,
      name: demoCharakter.name,
      quelle: { art: 'textur', asset: 'assets/textur-lina-gruen.png' },
      auftritte: demoCharakter.auftritte.length,
    },
  ]);
  const [aktivId, setAktivId] = useState<string | null>(demoCharakter.id);
  const [auftritte, setAuftritte] = useState<AuftrittUi[]>([
    { field: SLUMKIRCHE_FIELD_ID, dreieck: 2, x: 316, y: 50, richtung: 90 },
  ]);
  const [aktivAuftritt, setAktivAuftritt] = useState(0);
  const [wizardOffen, setWizardOffen] = useState(false);
  const { istEinfach } = useUiModus();
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

  const aktiverCharakter = charaktere.find((c) => c.id === aktivId) ?? null;

  /* „Leer anlegen (Profi)" — bisherige Direkt-Anlage, bleibt erhalten. */
  const neuerCharakter = () => {
    const id = `mod:de.beispiel.nebenquest/char/npc_${naechsteId++}`;
    setCharaktere((liste) => [...liste, { id, name: `NPC ${naechsteId - 1}`, quelle: { art: 'referenz', ref: 'lgp:char/ACGD' }, auftritte: 0 }]);
    setAktivId(id);
    toast.success('Charakter angelegt', { description: id });
  };

  /* Wizard-first-Erzeugung (MS17): Kernwahl = Modell-Quelle.
     Defaults: Kollisionsradius 12, Skalierung 100 %. */
  const wizardErstellen = ({ name, kern }: { name: string; kern: string }) => {
    const id = `mod:de.beispiel.nebenquest/char/${wizardSlug(name)}`;
    const quelle: CharakterEintrag['quelle'] =
      kern === 'textur' ? { art: 'textur', asset: 'assets/textur-swatches.png' } : { art: 'referenz', ref: 'lgp:char/ACGD' };
    setCharaktere((liste) => [...liste, { id, name, quelle, auftritte: 0 }]);
    setAktivId(id);
    toast.success(`„${name}" erstellt`, { description: 'Defaults: Kollisionsradius 12, Skalierung 100 %.' });
  };

  const charakterLoeschen = (id: string) => {
    setCharaktere((liste) => liste.filter((c) => c.id !== id));
    if (aktivId === id) setAktivId(null);
  };

  const umbenennen = (name: string) => {
    setCharaktere((liste) => liste.map((c) => (c.id === aktivId ? { ...c, name } : c)));
  };

  const auftrittPatch = (index: number, patch: Partial<AuftrittUi>) => {
    setAuftritte((liste) => liste.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const auftrittNeu = () => {
    setAuftritte((liste) => [
      ...liste,
      { field: SLUMKIRCHE_FIELD_ID, dreieck: 0, x: 90, y: 80, richtung: 0 },
    ]);
    setAktivAuftritt(auftritte.length);
    setCharaktere((liste) =>
      liste.map((c) => (c.id === aktivId ? { ...c, auftritte: c.auftritte + 1 } : c)),
    );
  };

  const auftrittLoeschen = (index: number) => {
    setAuftritte((liste) => liste.filter((_, i) => i !== index));
    setAktivAuftritt((a) => Math.max(0, a >= index ? a - 1 : a));
    setCharaktere((liste) =>
      liste.map((c) => (c.id === aktivId ? { ...c, auftritte: Math.max(0, c.auftritte - 1) } : c)),
    );
    toast('Auftritt gelöscht', {
      action: { label: 'Rückgängig', onClick: () => toast.info('Wiederherstellung folgt mit dem Projektspeicher.') },
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <CharakterListe
        charaktere={charaktere}
        aktivId={aktivId}
        onWaehlen={setAktivId}
        onNeu={() => setWizardOffen(true)}
        onLeerAnlegen={istEinfach ? undefined : neuerCharakter}
        onLoeschen={charakterLoeschen}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ActorViewer />
        <PlatzierungsCanvas
          auftritte={auftritte}
          aktivIndex={aktivAuftritt}
          onAktivWaehlen={setAktivAuftritt}
          onAuftrittChange={auftrittPatch}
          onNeu={auftrittNeu}
        />
      </div>
      <CharakterInspektor
        charakter={aktiverCharakter}
        onRename={umbenennen}
        auftritte={auftritte}
        aktivIndex={aktivAuftritt}
        onAktivWaehlen={setAktivAuftritt}
        onAuftrittLoeschen={auftrittLoeschen}
      />

      {/* Wizard-first-Erzeugung (MS17): Neuer NPC */}
      <WizardDialog
        offen={wizardOffen}
        onOpenChange={setWizardOffen}
        titel="Neuer NPC"
        icon={UserRound}
        nameVorschlag={`Neuer NPC ${charaktere.length + 1}`}
        idVorschau={(n) => `mod:de.beispiel.nebenquest/char/${wizardSlug(n)}`}
        kernTitel="Wie soll das Modell entstehen?"
        kernOptionen={[
          { id: 'referenz', label: 'Original-Modell referenzieren', beschreibung: 'Bestehendes Charakter-Modell nutzen — nur referenziert.', icon: Shield },
          { id: 'textur', label: 'Textur-Override', beschreibung: 'Gleiches Modell, eigene Textur (Farbvariante).', icon: ImageIcon },
          { id: 'baukasten', label: 'Baukasten', beschreibung: 'Figur aus Teilen zusammensetzen.', icon: Puzzle, gesperrt: 'MS9' },
          { id: 'gltf', label: 'glTF-Import', beschreibung: 'Eigenes 3D-Modell importieren.', icon: Box, gesperrt: 'MS6' },
        ]}
        defaultsFuer={() => [
          { label: 'Kollisionsradius', wert: '12' },
          { label: 'Skalierung', wert: '100 %' },
        ]}
        onErstellen={wizardErstellen}
      />
    </div>
  );
}
