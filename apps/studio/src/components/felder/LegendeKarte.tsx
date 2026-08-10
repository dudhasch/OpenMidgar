/**
 * LegendeKarte — schwebende Legende des Field-Canvas (felder.md Sektion 4).
 * Nutzt das SVG-Sprite `walkmesh-legend.svg` (192×64, drei 64er-Glyphen,
 * per CSS-Crop ausgeschnitten); einklappbar, Zustand wird gemerkt
 * (localStorage), standardmäßig offen bei erster Benutzung.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';

const ZEILEN = [
  { glyph: 0, titel: 'Valides Dreieck', text: 'Begehbare Fläche, Fläche ≥ 0.5' },
  { glyph: 1, titel: 'Degeneriertes Dreieck', text: 'Fläche ≈ 0 — wird nicht kompiliert' },
  { glyph: 2, titel: 'Gateway', text: 'Übergang in ein anderes Field' },
];

const LS_KEY = 'wm.felder.legende.offen';

export default function LegendeKarte() {
  const [offen, setOffen] = useState(() => localStorage.getItem(LS_KEY) !== 'zu');

  const umschalten = () => {
    setOffen((v) => {
      localStorage.setItem(LS_KEY, v ? 'zu' : 'auf');
      return !v;
    });
  };

  return (
    <div className="w-52 rounded-md border border-subtle bg-panel/90 shadow-elevated backdrop-blur">
      <button
        type="button"
        onClick={umschalten}
        className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-medium text-secondary transition-colors duration-150 hover:text-foreground"
      >
        Legende
        {offen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
      <AnimatePresence initial={false}>
        {offen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <ul className="flex flex-col gap-1 px-2 pb-2">
              {ZEILEN.map((z) => (
                <li key={z.titel} className="flex items-center gap-2">
                  <span className="h-6 w-6 shrink-0 overflow-hidden rounded border border-subtle bg-inset">
                    <img
                      src="./walkmesh-legend.svg"
                      alt=""
                      className="max-w-none"
                      style={{ width: 72, height: 24, marginLeft: -24 * z.glyph }}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] text-foreground">{z.titel}</span>
                    <span className="block truncate text-[10px] text-muted">{z.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
