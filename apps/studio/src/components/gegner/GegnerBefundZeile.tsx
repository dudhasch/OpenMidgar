/**
 * GegnerBefundZeile — Live-Befundzeile unten im Gegner-Editor
 * (gegner.md „Interaktionen & Zustände"): Stats-Band-Verletzung, tote
 * Regeln hinter „immer", tote Item-Verweise, leere Angriffsliste,
 * Drop-Summe > 100 %, Formation-Hinweis. Niemals blockierend.
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { bandStatus, immerIndex, itemRefTot } from '@/lib/gegner';
import type { GegnerUi } from '@/lib/gegner';
import { cn } from '@/lib/utils';

interface Befund {
  klasse: 'fehler' | 'warnung' | 'info';
  meldung: string;
}

export function gegnerBefunde(g: GegnerUi): Befund[] {
  const befunde: Befund[] = [];
  const band = bandStatus(g.stats);
  if (band !== 'im-band') {
    befunde.push({
      klasse: 'warnung',
      meldung: `Stats ${band === 'darueber' ? 'oberhalb' : 'unterhalb'} des Orientierungsbands (Lvl 8–12)`,
    });
  }
  if (g.angriffe.length === 0) {
    befunde.push({ klasse: 'fehler', meldung: 'Leere Angriffsliste — Gegner kann nicht kämpfen' });
  }
  const immerIdx = immerIndex(g.verhalten.regeln);
  if (immerIdx >= 0) {
    g.verhalten.regeln.forEach((_, i) => {
      if (i > immerIdx) {
        befunde.push({ klasse: 'warnung', meldung: `Regel #${i + 1} unerreichbar („immer" greift vorher)` });
      }
    });
  }
  [...g.beute.drops, ...g.beute.stehlen].forEach((e) => {
    if (itemRefTot(e.itemRef)) {
      befunde.push({ klasse: 'fehler', meldung: `Toter Item-Verweis ${e.itemRef} in Beute` });
    }
  });
  if (g.beute.morph && itemRefTot(g.beute.morph)) {
    befunde.push({ klasse: 'fehler', meldung: `Toter Item-Verweis ${g.beute.morph} in Morph` });
  }
  const dropSumme = g.beute.drops.reduce((s, d) => s + d.rate, 0);
  if (dropSumme > 1) {
    befunde.push({ klasse: 'warnung', meldung: `Summe aller Drop-Raten über 100 % (${Math.round(dropSumme * 100)} %)` });
  }
  if (g.formationTags.length === 0) {
    befunde.push({ klasse: 'info', meldung: `Gegner „${g.name}" in keiner Formation verwendet` });
  }
  return befunde;
}

const KLASSE_STILE = {
  fehler: { icon: XCircle, text: 'text-error', punkt: 'bg-error' },
  warnung: { icon: AlertTriangle, text: 'text-warn', punkt: 'bg-warn' },
  info: { icon: Info, text: 'text-info', punkt: 'bg-info' },
} as const;

export default function GegnerBefundZeile({ gegner }: { gegner: GegnerUi | null }) {
  if (!gegner) return null;
  const befunde = gegnerBefunde(gegner);
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 overflow-x-auto border-t border-subtle bg-panel px-3">
      <span className="shrink-0 font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-secondary">
        Befunde
      </span>
      {befunde.length === 0 ? (
        <span className="flex items-center gap-1.5 text-[11px] text-mako">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Keine Befunde — Gegner ist paketierbar.
        </span>
      ) : (
        befunde.map((b, i) => {
          const stil = KLASSE_STILE[b.klasse];
          const Icon = stil.icon;
          return (
            <span key={i} className={cn('flex shrink-0 items-center gap-1.5 text-[11px]', stil.text)}>
              <Icon className="h-3.5 w-3.5" />
              {b.meldung}
            </span>
          );
        })
      )}
    </div>
  );
}
