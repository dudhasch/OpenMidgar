/**
 * QuestProjektion — Meilenstein-Projektion über dem Graphen (quests.md
 * Sektion 4). Der Graph wird zu einer horizontalen Timeline verdichtet:
 * Meilenstein-Karten mit Verbindungspfeilen, darunter Mini-Chips der
 * zugehörigen Knoten. Die Chips teilen layoutIds mit den Canvas-Knoten
 * (framer-motion Morph, gestaffelt 30ms) — Signature-Moment der Seite.
 * Klick auf eine Karte → zurück in die Graph-Sicht, Knoten selektiert.
 */
import { motion } from 'framer-motion';
import { Flag } from 'lucide-react';
import type { ScriptKategorie } from '@webmidgar/studio-core';
import { kategorieFarbe } from '@/lib/quests';
import type { Meilenstein } from '@/lib/quests';

export interface ProjektionsKnoten {
  id: string;
  op: string;
  kategorie: ScriptKategorie;
  blockierend: boolean;
}

export interface ProjektionsMeilenstein extends Meilenstein {
  knoten: ProjektionsKnoten[];
}

interface QuestProjektionProps {
  meilensteine: ProjektionsMeilenstein[];
  onKarteKlick: (ms: ProjektionsMeilenstein) => void;
}

function VerbindungsPfeil({ index }: { index: number }) {
  return (
    <svg width="72" height="24" viewBox="0 0 72 24" className="shrink-0 self-center" aria-hidden>
      <motion.path
        d="M2 12 H62"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        strokeDasharray="60"
        initial={{ strokeDashoffset: 60 }}
        animate={{ strokeDashoffset: 0 }}
        transition={{ duration: 0.4, delay: 0.5 + index * 0.12, ease: 'easeOut' }}
      />
      <motion.path
        d="M56 6 L66 12 L56 18"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.85 + index * 0.12 }}
      />
    </svg>
  );
}

export default function QuestProjektion({ meilensteine, onKarteKlick }: QuestProjektionProps) {
  return (
    <div className="flex h-full flex-col overflow-auto bg-inset p-6">
      <div className="mb-4">
        <h2 className="font-display text-[15px] font-semibold text-foreground">Quest-Projektion</h2>
        <p className="text-[12px] text-secondary">
          Meilenstein-Sicht des Script-Graphen — Klick auf eine Karte kehrt zur Graph-Sicht zurück
          und selektiert die zugehörigen Knoten.
        </p>
      </div>

      {/* Horizontale Timeline-Spalte */}
      <div className="flex min-w-max flex-1 items-stretch gap-0">
        {meilensteine.map((ms, msIndex) => (
          <div key={ms.id} className="flex items-stretch">
            {msIndex > 0 && <VerbindungsPfeil index={msIndex} />}
            <motion.button
              type="button"
              onClick={() => onKarteKlick(ms)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: msIndex * 0.08 }}
              className="group w-64 rounded-lg border border-subtle bg-panel p-4 text-left shadow-elevated transition-colors duration-150 hover:border-mako/50 hover:bg-elevated"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-mako/30 bg-mako-dim">
                  <Flag className="h-3.5 w-3.5 text-mako" />
                </span>
                <span className="font-mono text-[10px] text-muted">MS{msIndex + 1}</span>
              </div>
              <p className="text-[14px] font-medium text-foreground group-hover:text-mako">{ms.titel}</p>
              <p className="mt-0.5 text-[11px] text-muted">{ms.knoten.length} Knoten</p>

              {/* Mini-Chips der zugehörigen Knoten (layoutId-Morph aus dem Graphen) */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ms.knoten.map((k, kIndex) => (
                  <motion.span
                    key={k.id}
                    layoutId={`quest-morph-${k.id}`}
                    transition={{ duration: 0.5, delay: kIndex * 0.03, ease: [0.2, 0.8, 0.2, 1] }}
                    className="inline-flex items-center gap-1 rounded border border-subtle bg-inset px-1.5 py-0.5"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: k.blockierend ? 'var(--warn)' : kategorieFarbe(k.kategorie) }}
                    />
                    <span className="font-mono text-[10px] text-secondary">{k.op}</span>
                  </motion.span>
                ))}
              </div>
            </motion.button>
          </div>
        ))}
      </div>
    </div>
  );
}
