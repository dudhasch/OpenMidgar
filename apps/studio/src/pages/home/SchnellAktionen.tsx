/**
 * SchnellAktionen — Schnellaktions-Leiste auf Projekt-Start (MS17,
 * vereinfachung.md §3). Fünf Karten (Neuer Dialog / Neuer NPC / Neues
 * Field / Neuer Gegner / Neue Schlacht) direkt unter der Hero-/Projekt-
 * Zeile, plus eine abgesetzte Ghost-Karte „Paket erstellen".
 *
 * Jede Karte navigiert zum Editor und startet dort den jeweiligen
 * Erzeugungs-Wizard (Übergabe via location.state `{ wizard: true }`).
 * Ohne offenes Projekt: Hinweis-Toast statt Navigation.
 *
 * Die Leiste ist selbst KEIN Profi-Element — sie ist der Einfach-Einstieg
 * schlechthin und bleibt in beiden Modi sichtbar. Gestaltung sekundär
 * (Elevated-Karten, kein Mako-Fill) — die Primär-CTA der Home-Ansicht
 * bleibt „Neues Projekt" (MS17 §4).
 */
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPlus, MessageSquarePlus, Package, Skull, Swords, UserRoundPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAppState } from '@/lib/app-state';

interface SchnellAktion {
  route: string;
  icon: LucideIcon;
  label: string;
  unterzeile: string;
}

const AKTIONEN: SchnellAktion[] = [
  { route: '/dialoge', icon: MessageSquarePlus, label: 'Neuer Dialog', unterzeile: 'Text schreiben' },
  { route: '/charaktere', icon: UserRoundPlus, label: 'Neuer NPC', unterzeile: 'Figur anlegen' },
  { route: '/felder', icon: MapPlus, label: 'Neues Field', unterzeile: 'Ort bauen' },
  { route: '/gegner', icon: Skull, label: 'Neuer Gegner', unterzeile: 'Gegner entwerfen' },
  { route: '/schlacht', icon: Swords, label: 'Neue Schlacht', unterzeile: 'Kampf stellen' },
];

export default function SchnellAktionen() {
  const { projektOffen } = useAppState();
  const navigate = useNavigate();

  const starteWizard = (aktion: SchnellAktion) => {
    if (!projektOffen) {
      toast.info('Öffne zuerst ein Projekt', {
        description: `„${aktion.label}" braucht ein aktives Projekt — lege eines an oder öffne die Demo.`,
      });
      return;
    }
    navigate(aktion.route, { state: { wizard: true } });
  };

  return (
    <section aria-label="Schnellaktionen" className="flex flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Schnellaktionen</p>
      <div className="flex flex-wrap gap-3">
        {AKTIONEN.map((aktion, i) => {
          const Icon = aktion.icon;
          return (
            <motion.button
              key={aktion.route}
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => starteWizard(aktion)}
              className="group flex h-[88px] w-40 flex-col justify-center gap-0.5 rounded-lg border border-subtle bg-elevated px-3 text-left shadow-elevated transition-colors duration-150 hover:border-strong"
            >
              <Icon className="h-5 w-5 text-secondary transition-colors duration-150 group-hover:text-mako" />
              <span className="mt-1 text-[13px] font-medium text-foreground">{aktion.label}</span>
              <span className="text-[11px] text-muted">{aktion.unterzeile}</span>
            </motion.button>
          );
        })}
        {/* Abgesetzte Ghost-Karte: Paket erstellen */}
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: AKTIONEN.length * 0.05 }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/paket')}
          className="group flex h-[88px] w-40 flex-col justify-center gap-0.5 rounded-lg border border-dashed border-subtle px-3 text-left transition-colors duration-150 hover:border-strong hover:bg-elevated"
        >
          <Package className="h-5 w-5 text-muted transition-colors duration-150 group-hover:text-mako" />
          <span className="mt-1 text-[13px] font-medium text-secondary group-hover:text-foreground">Paket erstellen</span>
          <span className="text-[11px] text-muted">.wmmod bauen</span>
        </motion.button>
      </div>
    </section>
  );
}
