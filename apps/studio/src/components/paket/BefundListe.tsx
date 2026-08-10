/**
 * BefundListe — Kompilierungs-/Validierungsbefunde der Paket-Seite:
 * klickbare Zeilen (Klasse-Punkt, Dokument Mono, Pfad, Meldung,
 * Fix-Hint) — Klick springt zur zielRoute des jeweiligen Editors.
 */
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import PaketPanel from '@/components/paket/PaketPanel';
import type { StudioBefund } from '@/lib/mock-project';
import { cn } from '@/lib/utils';

const KLASSE_FARBE: Record<StudioBefund['klasse'], string> = {
  fehler: 'bg-error',
  warnung: 'bg-warn',
  info: 'bg-info',
};

interface BefundListeProps {
  befunde: StudioBefund[];
  titel?: string;
}

export default function BefundListe({ befunde, titel = 'Befunde (Kompilierung)' }: BefundListeProps) {
  const navigate = useNavigate();
  const fehler = befunde.filter((b) => b.klasse === 'fehler').length;
  const warnungen = befunde.filter((b) => b.klasse === 'warnung').length;

  return (
    <PaketPanel
      titel={titel}
      right={
        <span className="flex items-center gap-2 font-mono text-[10px]">
          {fehler > 0 && <span className="text-error">{fehler} Fehler</span>}
          {warnungen > 0 && <span className="text-warn">{warnungen} Warnungen</span>}
          <span className="text-muted">{befunde.length} gesamt</span>
        </span>
      }
    >
      <ul className="flex flex-col overflow-hidden rounded-md border border-subtle">
        {befunde.map((b, i) => (
          <motion.li
            key={`${b.dokument}-${b.pfad}-${i}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: i * 0.03 }}
          >
            <button
              type="button"
              onClick={() => navigate(b.zielRoute)}
              className="flex w-full items-start gap-2.5 border-b border-subtle/60 px-3 py-2 text-left transition-colors duration-150 last:border-b-0 hover:bg-elevated"
              title={`Zum Editor: ${b.zielRoute}`}
            >
              <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', KLASSE_FARBE[b.klasse])} />
              <span className="min-w-0 flex-1">
                <span className="block">
                  <span className="font-mono text-[11px] text-engine">{b.dokument}</span>
                  {b.pfad && <span className="ml-2 font-mono text-[11px] text-muted">{b.pfad}</span>}
                </span>
                <span className="block text-[12px] text-foreground">{b.meldung}</span>
                {b.fixHint && <span className="block text-[11px] italic text-secondary">{b.fixHint}</span>}
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
    </PaketPanel>
  );
}
