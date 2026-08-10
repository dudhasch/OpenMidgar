/**
 * SeitenEditor — Text-Editor des Dialog-Editors (dialoge.md 3.2).
 * Mehrzeilige Eingabe je Seite; Token ({FARBE}/{PAUSE}/{VAR}) werden über ein
 * deckungsgleiches Highlight-Overlay als farbige Inline-Chips gerendert
 * (kein Rohtext-Eindruck). Seiten-Trenner gestrichelt mit „Seite N"-Label,
 * „+ Seite"-Button. Token-Einfügung leuchtet kurz Mako auf; der Inspektor
 * kann Token gezielt pulsieren lassen.
 */
import { useImperativeHandle, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import type { DialogEintrag, TextSegment } from '@/lib/dialoge';
import { parseSegmente } from '@/lib/dialoge';
import { cn } from '@/lib/utils';

export interface SeitenEditorHandle {
  /** Fügt ein Snippet an der letzten Cursor-Position ein (oder am Seitenende).
      Gibt Seite + Einfügeposition zurück (für das Mako-Aufleuchten). */
  fuegeEin: (snippet: string) => { seite: number; position: number } | null;
}

export interface TokenBlink {
  /** Seitenindex + Startposition des Tokens, das aufleuchten/pulsieren soll. */
  seite: number;
  position: number;
  /** Wechselnder Schlüssel, damit die Animation erneut startet. */
  key: number;
}

interface SeitenEditorProps {
  eintrag: DialogEintrag;
  aktivSeite: number;
  onSeiteWaehlen: (idx: number) => void;
  onSeiteText: (idx: number, text: string) => void;
  onPlusSeite: () => void;
  /** Mako-Aufleuchten nach Token-Einfügung. */
  flash?: TokenBlink | null;
  /** Doppeltes Pulsieren (Inspektor-Klick). */
  puls?: TokenBlink | null;
  ref?: React.Ref<SeitenEditorHandle>;
}

const EDITOR_KLASSE = 'font-mono text-[13px] leading-6 whitespace-pre-wrap break-words p-3';

export default function SeitenEditor({
  eintrag,
  aktivSeite,
  onSeiteWaehlen,
  onSeiteText,
  onPlusSeite,
  flash,
  puls,
  ref,
}: SeitenEditorProps) {
  const textareas = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  const [letzterFokus, setLetzterFokus] = useState(0);

  useImperativeHandle(ref, () => ({
    fuegeEin: (snippet: string) => {
      const idx = textareas.current.has(letzterFokus) ? letzterFokus : Math.min(aktivSeite, eintrag.seiten.length - 1);
      const seite = eintrag.seiten[Math.max(0, idx)];
      if (!seite) return null;
      const ta = textareas.current.get(idx);
      const start = ta?.selectionStart ?? seite.text.length;
      const ende = ta?.selectionEnd ?? seite.text.length;
      const neu = seite.text.slice(0, start) + snippet + seite.text.slice(ende);
      onSeiteText(idx, neu);
      // Cursor hinter das eingefügte Snippet setzen (nach Re-Render).
      requestAnimationFrame(() => {
        const el = textareas.current.get(idx);
        if (el) {
          el.focus();
          el.setSelectionRange(start + snippet.length, start + snippet.length);
        }
      });
      return { seite: Math.max(0, idx), position: start };
    },
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-inset" aria-label="Seiten-Editor">
      {eintrag.seiten.map((seite, idx) => (
        <div key={idx} className="flex shrink-0 flex-col">
          {idx > 0 && <SeitenTrenner nummer={idx + 1} />}
          <SeitenFeld
            seiteIdx={idx}
            text={seite.text}
            aktiv={idx === aktivSeite}
            flash={flash?.seite === idx ? flash : null}
            puls={puls?.seite === idx ? puls : null}
            onChange={(text) => onSeiteText(idx, text)}
            onFokus={() => {
              setLetzterFokus(idx);
              onSeiteWaehlen(idx);
            }}
            registerRef={(el) => {
              if (el) textareas.current.set(idx, el);
              else textareas.current.delete(idx);
            }}
          />
        </div>
      ))}

      <div className="shrink-0 px-3 py-2">
        <button
          type="button"
          onClick={onPlusSeite}
          className="flex h-7 items-center gap-1 rounded border border-dashed border-strong px-2 text-xs text-secondary transition-colors duration-150 hover:border-mako/50 hover:text-mako"
        >
          <Plus className="h-3.5 w-3.5" /> Seite
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SeitenTrenner({ nummer }: { nummer: number }) {
  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 px-3 py-1">
      <span className="h-px flex-1 border-t border-dashed border-strong" />
      <span className="text-[11px] text-muted">Seite {nummer}</span>
      <span className="h-px flex-1 border-t border-dashed border-strong" />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

interface SeitenFeldProps {
  seiteIdx: number;
  text: string;
  aktiv: boolean;
  flash: TokenBlink | null;
  puls: TokenBlink | null;
  onChange: (text: string) => void;
  onFokus: () => void;
  registerRef: (el: HTMLTextAreaElement | null) => void;
}

function SeitenFeld({ seiteIdx, text, aktiv, flash, puls, onChange, onFokus, registerRef }: SeitenFeldProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const segmente = parseSegmente(text);

  return (
    <div
      className={cn(
        'relative min-h-24 border-l-2 transition-colors duration-150',
        aktiv ? 'border-mako/60' : 'border-transparent',
      )}
      onClick={onFokus}
    >
      {/* Highlight-Overlay (deckungsgleich zur Textarea) */}
      <pre ref={preRef} aria-hidden className={cn(EDITOR_KLASSE, 'pointer-events-none absolute inset-0 overflow-hidden')}>
        {segmente.map((seg, i) => (
          <SegmentSchluessel key={i} seg={seg} flash={flash} puls={puls} />
        ))}
        {/* Trailing-Newline sichtbar halten */}
        {'\n'}
      </pre>
      <textarea
        ref={registerRef}
        value={text}
        rows={Math.max(3, text.split('\n').length + 1)}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFokus}
        onScroll={(e) => {
          if (preRef.current) {
            preRef.current.scrollTop = e.currentTarget.scrollTop;
            preRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
        aria-label={`Seite ${seiteIdx + 1} Text`}
        className={cn(
          EDITOR_KLASSE,
          'relative block h-auto w-full resize-none overflow-hidden bg-transparent text-transparent caret-[#3DDC97] focus:outline-none',
        )}
        style={{ minHeight: 'inherit' }}
      />
    </div>
  );
}

function SegmentSchluessel({ seg, flash, puls }: { seg: TextSegment; flash: TokenBlink | null; puls: TokenBlink | null }) {
  if (seg.typ === 'text') return <span className="text-foreground">{seg.wert}</span>;

  const istFlash = flash !== null && flash.position === seg.position;
  const istPuls = puls !== null && puls.position === seg.position;
  const basis: React.CSSProperties = {
    color: 'var(--accent-engine)',
    backgroundColor: 'rgba(76,141,255,0.16)',
    borderRadius: 3,
    boxShadow: '0 0 0 1px rgba(76,141,255,0.28)',
  };

  if (istFlash || istPuls) {
    return (
      <motion.span
        key={`${istFlash ? flash.key : puls!.key}`}
        style={basis}
        initial={{ backgroundColor: 'rgba(61,220,151,0.55)', scale: 0.8 }}
        animate={
          istPuls
            ? { backgroundColor: 'rgba(76,141,255,0.16)', scale: [1, 1.12, 1, 1.12, 1] }
            : { backgroundColor: 'rgba(76,141,255,0.16)', scale: 1 }
        }
        transition={istPuls ? { duration: 0.6 } : { duration: 0.3 }}
        className="inline-block"
      >
        {seg.roh}
      </motion.span>
    );
  }
  return <span style={basis}>{seg.roh}</span>;
}
