/**
 * Projekt-Übersicht (home.md Sektion 4, Zustand: Projekt geöffnet).
 * Statistik-Kacheln mit GSAP-Count-Up, segmentierter Befund-Balken,
 * gruppierte Dokumentliste + Schnellzugriff.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  ArrowRight,
  FileText,
  Image,
  Map,
  MessageSquare,
  Pencil,
  UserRound,
  Variable,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import RefBadge from '@/components/shared/RefBadge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  befundCounts,
  demoBefunde,
  demoDokumente,
  demoProject,
  demoStatistiken,
  demoZuletztBearbeitet,
} from '@/lib/mock-project';
import type { DokumentEintrag } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP);

const STAT_ICONS: Record<string, LucideIcon> = {
  dialoge: MessageSquare,
  eintraege: FileText,
  knoten: Workflow,
  charaktere: UserRound,
  felder: Map,
  variablen: Variable,
};

const TYP_ICONS: Record<DokumentEintrag['typ'], LucideIcon> = {
  dialogue: MessageSquare,
  scriptGraph: Workflow,
  character: UserRound,
  field: Map,
  fieldDelta: Map,
  asset: Image,
};

const SCHNELLZUGRIFF = [
  { label: 'Neuen Dialog anlegen', route: '/dialoge' },
  { label: 'Neuen Script-Graph', route: '/quests' },
  { label: 'Neuen Charakter', route: '/charaktere' },
  { label: 'Neues Field', route: '/felder' },
  { label: 'Paket kompilieren', route: '/paket' },
];

const KLASSE_FARBE = { fehler: 'bg-error', warnung: 'bg-warn', info: 'bg-info' } as const;

export default function ProjektUebersicht() {
  const navigate = useNavigate();
  const { toggleDock } = useAppState();
  const [settingsOffen, setSettingsOffen] = useState(false);
  const scope = useRef<HTMLDivElement>(null);
  const counts = befundCounts();

  /* GSAP: Count-Up der Statistik-Zahlen beim Eintritt */
  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>('.stat-zahl').forEach((el, i) => {
        const ziel = Number(el.dataset.ziel ?? 0);
        const stand = { v: 0 };
        gsap.to(stand, {
          v: ziel,
          duration: 0.8,
          delay: i * 0.06,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = String(Math.round(stand.v));
          },
        });
      });
      gsap.from('.stat-kachel', { y: 12, opacity: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out' });
      gsap.from('.befund-segment', {
        scaleX: 0,
        transformOrigin: 'left center',
        duration: 0.6,
        stagger: 0.1,
        delay: 0.2,
        ease: 'power2.out',
      });
    },
    { scope },
  );

  /* Segment-Balken: jedes Befund zählt 1, „valide" füllt den Rest auf
     (Gewicht, damit der Balken überwiegend Mako bleibt). */
  const gesamt = counts.fehler + counts.warnung + counts.info;
  const valideGewicht = Math.max(gesamt * 4, 24);
  const balkenGesamt = gesamt + valideGewicht;
  const seg = (n: number) => `${(n / balkenGesamt) * 100}%`;

  return (
    <div ref={scope} className="flex flex-col gap-6">
      {/* Kopfzeile */}
      <div className="flex items-center gap-3">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{demoProject.name}</h2>
        <span className="rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[11px] text-engine">
          {demoProject.modId}
        </span>
        <button
          type="button"
          onClick={() => setSettingsOffen(true)}
          className="rounded p-1 text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground"
          aria-label="Projekt-Einstellungen bearbeiten"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      {/* 4.1 Statistik-Kacheln */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {demoStatistiken.map((s) => {
          const Icon = STAT_ICONS[s.icon] ?? FileText;
          return (
            <div key={s.label} className="stat-kachel relative rounded-md border border-subtle bg-panel p-4">
              <Icon className="absolute right-3 top-3 h-4 w-4 text-muted" />
              <p className="font-display text-[28px] font-semibold leading-none text-foreground">
                <span className="stat-zahl" data-ziel={s.wert}>
                  0
                </span>
                {s.suffix && <span className="ml-1 text-sm font-medium text-muted">{s.suffix}</span>}
              </p>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* 4.2 Befund-Zusammenfassung */}
      <section className="rounded-md border border-subtle bg-panel p-4" aria-label="Projektgesundheit">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-[15px] font-semibold">Projektgesundheit</h3>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-secondary hover:text-foreground" onClick={() => toggleDock('alle')}>
            Alle Befunde
          </Button>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded">
          <span className="befund-segment bg-error" style={{ width: seg(counts.fehler) }} />
          <span className="befund-segment bg-warn" style={{ width: seg(counts.warnung) }} />
          <span className="befund-segment bg-info" style={{ width: seg(counts.info) }} />
          <span className="befund-segment flex-1 bg-mako/25" />
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {counts.fehler} Fehler · {counts.warnung} Warnungen · {counts.info} Info — Rest valide
        </p>
        <div className="mt-3 flex flex-col">
          {demoBefunde.slice(0, 3).map((b, i) => (
            <motion.button
              key={i}
              type="button"
              initial={{ x: -8, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.4 + i * 0.06, duration: 0.25 }}
              onClick={() => navigate(b.zielRoute)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-elevated"
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', KLASSE_FARBE[b.klasse])} />
              <span className="shrink-0 font-mono text-[11px] text-engine">{b.dokument}</span>
              <span className="truncate text-xs text-secondary">{b.meldung}</span>
            </motion.button>
          ))}
        </div>
      </section>

      {/* 4.3 Dokumentliste + Schnellzugriff */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-md border border-subtle bg-panel lg:col-span-2" aria-label="Dokumente">
          <h3 className="border-b border-subtle px-4 py-3 font-display text-[15px] font-semibold">Dokumente</h3>
          <div className="p-2">
            {demoDokumente.map((gruppe, gi) => (
              <motion.div
                key={gruppe.gruppe}
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 + gi * 0.07, duration: 0.25 }}
              >
                <p className="px-2 pb-1 pt-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                  {gruppe.gruppe}
                  <span className="ml-1.5 normal-case tracking-normal">({gruppe.eintraege.length})</span>
                </p>
                {gruppe.eintraege.map((d, di) => {
                  const Icon = TYP_ICONS[d.typ];
                  return (
                    <motion.button
                      key={d.pfad}
                      type="button"
                      initial={{ y: 8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.32 + gi * 0.07 + di * 0.03, duration: 0.2 }}
                      onClick={() => navigate(d.route)}
                      className="group flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-elevated"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      <span className="text-[13px] text-foreground">{d.name}</span>
                      {d.originalRef && <RefBadge refId={d.originalRef} guardHash={d.guardHash} />}
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-engine/70 transition-colors duration-150 group-hover:text-engine">
                        {d.pfad}
                      </span>
                      {d.hatBefund && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
                      <span className="w-20 shrink-0 text-right text-[11px] text-muted">{d.geaendert}</span>
                    </motion.button>
                  );
                })}
              </motion.div>
            ))}
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-md border border-subtle bg-panel" aria-label="Schnellzugriff">
            <h3 className="border-b border-subtle px-4 py-3 font-display text-[15px] font-semibold">Schnellzugriff</h3>
            <div className="flex flex-col p-2">
              {SCHNELLZUGRIFF.map((e) => (
                <button
                  key={e.label}
                  type="button"
                  onClick={() => navigate(e.route)}
                  className="group flex items-center justify-between rounded px-2 py-2 text-[13px] text-secondary transition-all duration-150 hover:translate-x-1 hover:bg-elevated hover:text-foreground"
                >
                  {e.label}
                  <ArrowRight className="h-3.5 w-3.5 text-muted transition-colors duration-150 group-hover:text-mako" />
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-subtle bg-panel" aria-label="Zuletzt bearbeitet">
            <h3 className="border-b border-subtle px-4 py-3 font-display text-[15px] font-semibold">
              Zuletzt bearbeitet
            </h3>
            <div className="flex flex-col p-2">
              {demoZuletztBearbeitet.map((e) => (
                <button
                  key={e.dokument}
                  type="button"
                  onClick={() => navigate(e.route)}
                  className="flex items-center justify-between gap-2 rounded px-2 py-2 transition-colors duration-150 hover:bg-elevated"
                >
                  <span className="truncate font-mono text-[11px] text-engine">{e.dokument}</span>
                  <span className="shrink-0 text-[11px] text-muted">{e.zeit}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Projekt-Einstellungen (Platzhalter-Sheet) */}
      <Sheet open={settingsOffen} onOpenChange={setSettingsOffen}>
        <SheetContent className="border-subtle bg-popover">
          <SheetHeader>
            <SheetTitle className="font-display">Projekt-Einstellungen</SheetTitle>
            <SheetDescription className="text-secondary">
              Name, modId und engineCompat des Projekts (Mock — Projektspeicher folgt).
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input defaultValue={demoProject.name} className="border-subtle bg-inset" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>modId</Label>
              <Input defaultValue={demoProject.modId} className="border-subtle bg-inset font-mono" />
            </div>
            <Button
              className="mt-2 bg-mako text-primary-foreground hover:bg-mako-hover"
              onClick={() => {
                setSettingsOffen(false);
                toast.success('Projekt-Einstellungen gespeichert (Mock).');
              }}
            >
              Speichern
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
