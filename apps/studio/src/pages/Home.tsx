/**
 * Home — Projekt-Start (`#/`), komplette Seite nach design/home.md.
 * Zentrierte Inhaltsspalte (max 1080px) auf --bg-app mit bg-grain.png.
 * Zustand „kein Projekt": Banner + Hero + Aktionskarten + Letzte Projekte.
 * Zustand „Projekt offen": kompakter Hero + Projekt-Übersicht.
 */
import { AnimatePresence, motion } from 'framer-motion';
import RecoveryBanner from '@/pages/home/RecoveryBanner';
import Hero from '@/pages/home/Hero';
import SchnellAktionen from '@/pages/home/SchnellAktionen';
import AktionsKarten from '@/pages/home/AktionsKarten';
import LetzteProjekte from '@/pages/home/LetzteProjekte';
import ProjektUebersicht from '@/pages/home/ProjektUebersicht';
import HomeFooter from '@/pages/home/HomeFooter';
import { useAppState } from '@/lib/app-state';

export default function Home() {
  const { projektOffen } = useAppState();

  return (
    <div
      className="min-h-full"
      style={{
        backgroundImage: 'url(./bg-grain.png)',
        backgroundRepeat: 'repeat',
        backgroundSize: '512px 512px',
      }}
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-8 py-8">
        <RecoveryBanner />
        <Hero />

        {/* Schnellaktions-Leiste (MS17 §3): direkt unter der Hero-Zeile,
            in beiden Modi sichtbar, startet die Erzeugungs-Wizards. */}
        <SchnellAktionen />

        <AnimatePresence mode="wait">
          {projektOffen ? (
            <motion.div
              key="uebersicht"
              initial={{ x: 8, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -8, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <ProjektUebersicht />
            </motion.div>
          ) : (
            <motion.div
              key="aktionen"
              initial={{ x: 8, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -8, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex flex-col gap-10"
            >
              <AktionsKarten />
              <LetzteProjekte />
            </motion.div>
          )}
        </AnimatePresence>

        <HomeFooter />
      </div>
    </div>
  );
}
