/**
 * Gegner-Editor (`#/gegner`) — MS15 Gegner-Creator (gegner.md).
 * IDE-Shell: Gegnerliste links, Gegner-Karte in Tabs (Allgemein /
 * Angriffe / Verhalten / Beute) in der Mitte, kontextabhängiger
 * Inspektor rechts, Live-Befundzeile unten. Zustand lokal (useState),
 * Demo-Daten aus lib/gegner.ts (getippt gegen EnemyDoc aus studio-core).
 * Die einzige Mako-Primär-CTA sitzt im jeweils aktiven Tab (MS17-Regel).
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Box, Copy, Image as ImageIcon, Lock, MoreHorizontal, Puzzle, Shield, Skull } from 'lucide-react';
import { toast } from 'sonner';
import GegnerAllgemein from '@/components/gegner/GegnerAllgemein';
import GegnerAngriffe from '@/components/gegner/GegnerAngriffe';
import GegnerBefundZeile from '@/components/gegner/GegnerBefundZeile';
import GegnerBeute from '@/components/gegner/GegnerBeute';
import GegnerInspektor from '@/components/gegner/GegnerInspektor';
import type { GegnerTab } from '@/components/gegner/GegnerInspektor';
import GegnerListe from '@/components/gegner/GegnerListe';
import GegnerVerhalten from '@/components/gegner/GegnerVerhalten';
import EmptyState from '@/components/shared/EmptyState';
import WizardDialog from '@/components/shared/WizardDialog';
import { wizardSlug } from '@/components/shared/WizardDialog';
import { useUiModus } from '@/lib/ui-modus';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { demoGegner, ffZeichensatzOk, leererGegner } from '@/lib/gegner';
import type { GegnerUi } from '@/lib/gegner';
import { cn } from '@/lib/utils';

let gegnerZaehler = 1;

export default function GegnerPage() {
  const [gegnerListe, setGegnerListe] = useState<GegnerUi[]>(demoGegner);
  const [aktivId, setAktivId] = useState<string | null>(demoGegner[0]?.id ?? null);
  const [tab, setTab] = useState<GegnerTab>('allgemein');
  const [loeschDialog, setLoeschDialog] = useState(false);
  const [, setLoeschPuffer] = useState<{ gegner: GegnerUi; index: number } | null>(null);
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

  const aktiv = gegnerListe.find((g) => g.id === aktivId) ?? null;

  const patchAktiv = (patch: Partial<GegnerUi>) => {
    setGegnerListe((liste) => liste.map((g) => (g.id === aktivId ? { ...g, ...patch } : g)));
  };

  const kopieren = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success('In Zwischenablage kopiert', { description: text });
  };

  /* „Leer anlegen (Profi)" — bisherige Direkt-Anlage, bleibt erhalten. */
  const neuerGegner = () => {
    const g = leererGegner(gegnerZaehler++);
    setGegnerListe((liste) => [...liste, g]);
    setAktivId(g.id);
    toast.success('Gegner angelegt', { description: 'Leer-Anlage (Profi) — der Wizard bleibt der Standard-Einstieg.' });
  };

  /* Wizard-first-Erzeugung (MS17): Kernwahl = Modell-Quelle. Das erzeugte
     Dokument ist sofort valide (Default-Angriff + Default-Regel). */
  const wizardErstellen = ({ name, kern }: { name: string; kern: string }) => {
    const g = leererGegner(gegnerZaehler++);
    g.name = name;
    g.id = `mod:de.beispiel.nebenquest/enemy/${wizardSlug(name)}`;
    if (kern === 'textur') {
      g.modell = { art: 'textur-override', ref: 'lgp:battle/wachroboter', texturAsset: 'textur:rost' } as GegnerUi['modell'];
    }
    setGegnerListe((liste) => [...liste, g]);
    setAktivId(g.id);
    setTab('allgemein');
    toast.success(`„${name}" erstellt`, { description: 'Defaults: Lvl-8–12-Profil, 1 Angriff, 1 Regel — jetzt im Editor anpassen.' });
  };

  const duplizieren = () => {
    if (!aktiv) return;
    const kopie: GegnerUi = structuredClone(aktiv);
    kopie.id = `${aktiv.id}-2`;
    kopie.name = `${aktiv.name} (Kopie)`;
    setGegnerListe((liste) => [...liste, kopie]);
    setAktivId(kopie.id);
    toast.success(`„${aktiv.name}" dupliziert`, { description: kopie.id });
  };

  const loeschen = () => {
    if (!aktiv) return;
    const index = gegnerListe.findIndex((g) => g.id === aktiv.id);
    setLoeschPuffer({ gegner: aktiv, index });
    setGegnerListe((liste) => liste.filter((g) => g.id !== aktiv.id));
    setAktivId(null);
    setLoeschDialog(false);
    toast(`„${aktiv.name}" gelöscht`, {
      action: {
        label: 'Rückgängig',
        onClick: () => {
          setLoeschPuffer((puffer) => {
            if (!puffer) return null;
            setGegnerListe((liste) => {
              const neu = [...liste];
              neu.splice(Math.min(puffer.index, neu.length), 0, puffer.gegner);
              return neu;
            });
            setAktivId(puffer.gegner.id);
            return null;
          });
        },
      },
    });
  };

  const nameOk = aktiv ? ffZeichensatzOk(aktiv.name) && aktiv.name.trim().length > 0 : true;
  const kurzId = aktiv?.id.split('/').pop() ?? '';
  const breadcrumb = aktiv ? `mod:de.beispiel.nebenquest/enemies/${kurzId}` : '';

  const tabs: { id: GegnerTab; label: string; zaehler?: number }[] = aktiv
    ? [
        { id: 'allgemein', label: 'Allgemein' },
        { id: 'angriffe', label: 'Angriffe', zaehler: aktiv.angriffe.length },
        { id: 'verhalten', label: 'Verhalten', zaehler: aktiv.verhalten.regeln.length },
        { id: 'beute', label: 'Beute' },
      ]
    : [];

  return (
    <div className="flex h-full min-h-0">
      <GegnerListe
        gegner={gegnerListe}
        aktivId={aktivId}
        onWaehlen={setAktivId}
        onNeu={() => setWizardOffen(true)}
        onLeerAnlegen={istEinfach ? undefined : neuerGegner}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {!aktiv ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={Skull}
              titel={gegnerListe.length === 0 ? 'Noch keine Gegner' : 'Kein Gegner ausgewählt'}
              hinweis="Erstelle deinen ersten Gegner — Werte, Angriffe und Verhalten in wenigen Schritten."
              ctaLabel="Gegner erstellen"
              onCta={() => setWizardOffen(true)}
            />
          </div>
        ) : (
          <>
            {/* Kopfzeile der Gegner-Karte */}
            <div className="shrink-0 border-b border-subtle bg-panel px-4 pt-3">
              <div className="mb-1 flex items-center gap-1.5">
                <code className="truncate font-mono text-[12px] text-muted">{breadcrumb}</code>
                <button
                  type="button"
                  aria-label="Dokumentpfad kopieren"
                  onClick={() => kopieren(breadcrumb)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <Input
                    value={aktiv.name}
                    onChange={(e) => patchAktiv({ name: e.target.value })}
                    aria-label="Gegner-Name"
                    className={cn(
                      'h-9 w-64 border-transparent bg-transparent px-1 font-display text-xl font-semibold tracking-[-0.01em] hover:border-subtle focus:border-subtle',
                      !nameOk && 'border-error hover:border-error focus:border-error focus-visible:outline-error',
                    )}
                  />
                  {!nameOk && <p className="px-1 text-[11px] text-error">Zeichen nicht im FF-Zeichensatz.</p>}
                </div>

                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex shrink-0 cursor-default items-center gap-1 rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn">
                        <Lock className="h-3 w-3" />
                        Paketierbar · Aktivierung mit Battle-Modul
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-64 text-xs">
                      Schema-bekannt, Import derzeit verweigert mit Diagnose — S19-Muster.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <div className="ml-auto">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Gegner-Menü"
                        className="flex h-7 w-7 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-subtle bg-popover">
                      <DropdownMenuItem onClick={duplizieren}>Duplizieren</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => kopieren(aktiv.id)}>ID kopieren</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-error focus:text-error" onClick={() => setLoeschDialog(true)}>
                        Löschen
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Tab-Leiste */}
              <div className="mt-1 flex gap-1">
                {tabs.map((t) => {
                  const aktivTab = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={cn(
                        'relative px-3 py-2 text-[13px] transition-colors duration-150',
                        aktivTab ? 'text-foreground' : 'text-muted hover:text-secondary',
                      )}
                    >
                      {t.label}
                      {t.zaehler !== undefined && (
                        <span className="ml-1.5 rounded border border-subtle px-1 py-px font-mono text-[10px] text-muted">
                          {t.zaehler}
                        </span>
                      )}
                      {aktivTab && (
                        <motion.span
                          layoutId="gegner-tab-unterstrich"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-mako"
                          transition={{ duration: 0.2 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tab-Inhalt */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab + aktiv.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {tab === 'allgemein' && <GegnerAllgemein gegner={aktiv} onPatch={patchAktiv} />}
                  {tab === 'angriffe' && <GegnerAngriffe gegner={aktiv} onPatch={patchAktiv} />}
                  {tab === 'verhalten' && <GegnerVerhalten gegner={aktiv} onPatch={patchAktiv} />}
                  {tab === 'beute' && <GegnerBeute gegner={aktiv} onPatch={patchAktiv} />}
                </motion.div>
              </AnimatePresence>
            </div>

            <GegnerBefundZeile gegner={aktiv} />
          </>
        )}
      </div>

      <GegnerInspektor gegner={aktiv} tab={tab} onPatch={patchAktiv} />

      {/* Wizard-first-Erzeugung (MS17): Neuer Gegner */}
      <WizardDialog
        offen={wizardOffen}
        onOpenChange={setWizardOffen}
        titel="Neuer Gegner"
        icon={Skull}
        nameVorschlag={`Neuer Gegner ${gegnerListe.length + 1}`}
        idVorschau={(n) => `mod:de.beispiel.nebenquest/enemies/${wizardSlug(n)}`}
        kernTitel="Wie soll das Modell entstehen?"
        kernOptionen={[
          { id: 'referenz', label: 'Original-Modell referenzieren', beschreibung: 'Bestehendes Battle-Modell nutzen — nur referenziert, nie kopiert.', icon: Shield },
          { id: 'textur', label: 'Textur-Override', beschreibung: 'Gleiches Modell, eigene Textur (z. B. Farbvariante).', icon: ImageIcon },
          { id: 'baukasten', label: 'Baukasten', beschreibung: 'Modell aus Primitive-Teilen zusammensetzen.', icon: Puzzle, gesperrt: 'MS9' },
          { id: 'gltf', label: 'glTF-Import', beschreibung: 'Eigenes 3D-Modell importieren.', icon: Box, gesperrt: 'MS6' },
        ]}
        defaultsFuer={() => [
          { label: 'Stats', wert: 'Level-Band-Profil „Lvl 8–12"' },
          { label: 'Angriff', wert: '„Schlag" (1,0×)' },
          { label: 'Regel', wert: '„immer → Schlag"' },
        ]}
        onErstellen={wizardErstellen}
      />

      {/* Löschen-Dialog */}
      <AlertDialog open={loeschDialog} onOpenChange={setLoeschDialog}>
        <AlertDialogContent className="border-subtle bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>Gegner löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{aktiv?.name}" wird aus 1 Formation entfernt — fortfahren? Das Dokument{' '}
              <code className="font-mono text-[11px]">enemies/{kurzId}.json</code> wird gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-subtle">Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="bg-error text-destructive-foreground hover:bg-error/90" onClick={loeschen}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
