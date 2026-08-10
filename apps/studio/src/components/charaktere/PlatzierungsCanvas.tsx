/**
 * PlatzierungsCanvas — „Auftritte" des Charakter-Editors
 * (charaktere.md Sektion 3). 2D-Top-Down des Ziel-Fields mit
 * Walkmesh-Dreiecksnetz, dragbarem Charakter-Marker (Kreis + Richtungs-
 * pfeil mit drehbarem Griff, 15°-Raster), Live-Koordinaten in Mono und
 * Warn-Befund bei Drop außerhalb des Walkmeshs (Marker springt zurück).
 */
import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Plus } from 'lucide-react';
import RefBadge from '@/components/shared/RefBadge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { demoCharMesh, dreieckBei, ORIGINAL_FIELDS, SLUMKIRCHE_FIELD_ID } from '@/lib/charfelder';
import type { Pt } from '@/lib/charfelder';

export interface AuftrittUi {
  field: string;
  dreieck: number;
  x: number;
  y: number;
  richtung: number;
}

interface PlatzierungsCanvasProps {
  auftritte: AuftrittUi[];
  aktivIndex: number;
  onAktivWaehlen: (index: number) => void;
  onAuftrittChange: (index: number, patch: Partial<AuftrittUi>) => void;
  onNeu: () => void;
}

const VIEW_W = 800;
const VIEW_H = 460;
const PAD = 26;

export default function PlatzierungsCanvas({
  auftritte,
  aktivIndex,
  onAktivWaehlen,
  onAuftrittChange,
  onNeu,
}: PlatzierungsCanvasProps) {
  const [mesh] = useState(demoCharMesh);
  const [feldId, setFeldId] = useState(SLUMKIRCHE_FIELD_ID);
  const [drag, setDrag] = useState<'marker' | 'richtung' | null>(null);
  const [ueberWalkmesh, setUeberWalkmesh] = useState(true);
  const [warnung, setWarnung] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const letzterStand = useRef<{ p: Pt; dreieck: number } | null>(null);

  const aktiv = auftritte[aktivIndex] ?? null;

  const transform = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    mesh.forEach((d) =>
      [d.a, d.b, d.c].forEach((p) => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }),
    );
    const s = Math.min((VIEW_W - PAD * 2) / (maxX - minX), (VIEW_H - PAD * 2) / (maxY - minY));
    return { s, ox: PAD - minX * s, oy: PAD - minY * s };
  }, [mesh]);

  const toScreen = (p: Pt): Pt => ({ x: transform.ox + p.x * transform.s, y: transform.oy + p.y * transform.s });
  const toWorld = (p: Pt): Pt => ({ x: (p.x - transform.ox) / transform.s, y: (p.y - transform.oy) / transform.s });

  const svgPunkt = (clientX: number, clientY: number): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_W,
      y: ((clientY - rect.top) / rect.height) * VIEW_H,
    };
  };

  const markerDragStart = (e: React.PointerEvent) => {
    if (!aktiv) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    letzterStand.current = { p: { x: aktiv.x, y: aktiv.y }, dreieck: aktiv.dreieck };
    setDrag('marker');
    setWarnung(false);
    onAktivWaehlen(aktivIndex);
  };

  const richtungDragStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag('richtung');
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !aktiv) return;
    const welt = toWorld(svgPunkt(e.clientX, e.clientY));
    if (drag === 'marker') {
      const idx = dreieckBei(welt, mesh);
      setUeberWalkmesh(idx >= 0);
      onAuftrittChange(aktivIndex, {
        x: Math.round(welt.x),
        y: Math.round(welt.y),
        dreieck: idx >= 0 ? idx : aktiv.dreieck,
      });
    } else {
      const winkel = (Math.atan2(welt.x - aktiv.x, -(welt.y - aktiv.y)) * 180) / Math.PI;
      const gerastert = ((Math.round(winkel / 15) * 15) % 360 + 360) % 360;
      onAuftrittChange(aktivIndex, { richtung: gerastert });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag === 'marker' && aktiv) {
      const idx = dreieckBei({ x: aktiv.x, y: aktiv.y }, mesh);
      if (idx < 0 && letzterStand.current) {
        // Ungültig: Marker springt animiert zurück + Warn-Befund
        onAuftrittChange(aktivIndex, {
          x: letzterStand.current.p.x,
          y: letzterStand.current.p.y,
          dreieck: letzterStand.current.dreieck,
        });
        setWarnung(true);
      } else {
        onAuftrittChange(aktivIndex, { dreieck: idx });
        setWarnung(false);
      }
    }
    setDrag(null);
    setUeberWalkmesh(true);
  };

  const istOriginal = feldId.startsWith('field:');

  return (
    <section className="flex min-h-0 flex-[55] flex-col" aria-label="Auftritte">
      {/* Titelzeile */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-subtle px-3">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-secondary">
          Auftritte
        </span>
        <Select value={feldId} onValueChange={setFeldId}>
          <SelectTrigger className="h-7 w-52 border-subtle bg-inset text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-subtle bg-popover">
            <SelectItem value={SLUMKIRCHE_FIELD_ID} className="text-xs">
              Slumkirche außen
            </SelectItem>
            {ORIGINAL_FIELDS.map((f) => (
              <SelectItem key={f} value={f} className="font-mono text-xs">
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {istOriginal && <RefBadge refId={feldId} guardHash="a3f9…c1" />}
        {/* Einzige Mako-Primär-CTA der Ansicht (MS17 §4): „Auftritt hinzufügen" */}
        <button
          type="button"
          onClick={onNeu}
          className="ml-auto flex h-7 items-center gap-1.5 rounded bg-mako px-2.5 text-[11px] font-semibold text-primary-foreground transition-colors duration-150 hover:bg-mako-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          Auftritt hinzufügen
        </button>
      </div>

      {/* Canvas */}
      <div className="relative m-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-subtle bg-inset">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-full w-full"
          style={{ cursor: drag === 'marker' && !ueberWalkmesh ? 'not-allowed' : 'default' }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* Walkmesh-Dreiecke */}
          {mesh.map((d, i) => {
            const pts = [d.a, d.b, d.c].map(toScreen).map((p) => `${p.x},${p.y}`).join(' ');
            const istAktiv = aktiv !== null && i === aktiv.dreieck;
            return (
              <polygon
                key={i}
                points={pts}
                fill="var(--accent-mako)"
                fillOpacity={drag === 'marker' ? 0.12 : istAktiv ? 0.1 : 0.06}
                stroke="var(--accent-mako)"
                strokeOpacity={istAktiv ? 0.75 : 0.35}
                strokeWidth={1}
                style={{ transition: 'fill-opacity 120ms ease-out, stroke-opacity 120ms ease-out' }}
              />
            );
          })}

          {/* Marker je Auftritt */}
          {auftritte.map((a, i) => {
            const p = toScreen({ x: a.x, y: a.y });
            const rad = (a.richtung * Math.PI) / 180;
            const tip = { x: p.x + Math.sin(rad) * 26, y: p.y - Math.cos(rad) * 26 };
            const istAktiv = i === aktivIndex;
            return (
              <motion.g
                key={i}
                initial={false}
                animate={{ x: p.x, y: p.y, scale: drag === 'marker' && istAktiv ? 1.15 : 1 }}
                transition={
                  drag && istAktiv
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 260, damping: 22 }
                }
                style={{ x: 0, y: 0 }}
                opacity={istAktiv ? 1 : 0.45}
              >
                {/* Positionen relativ zum Ursprung; Gruppe wird via transform verschoben */}
                <g transform={`translate(${-p.x} ${-p.y})`}>
                  <line
                    x1={p.x}
                    y1={p.y}
                    x2={tip.x}
                    y2={tip.y}
                    stroke="var(--accent-mako)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={9}
                    fill="var(--accent-mako)"
                    stroke="var(--bg-inset)"
                    strokeWidth={2}
                    style={{
                      cursor: 'grab',
                      filter: drag === 'marker' && istAktiv ? 'drop-shadow(0 4px 8px rgba(0,0,0,.5))' : undefined,
                    }}
                    onPointerDown={i === aktivIndex ? markerDragStart : () => onAktivWaehlen(i)}
                  />
                  <circle cx={p.x} cy={p.y} r={3} fill="var(--bg-inset)" pointerEvents="none" />
                  {istAktiv && (
                    <circle
                      cx={tip.x}
                      cy={tip.y}
                      r={6}
                      fill="var(--bg-elevated)"
                      stroke="var(--accent-mako)"
                      strokeWidth={1.5}
                      style={{ cursor: 'grab' }}
                      onPointerDown={richtungDragStart}
                    >
                      <title>{`Richtung: ${a.richtung}°`}</title>
                    </circle>
                  )}
                  {istAktiv && drag === 'richtung' && (
                    <text
                      x={tip.x + 10}
                      y={tip.y - 8}
                      fill="var(--text-primary)"
                      fontSize={11}
                      fontFamily="var(--font-mono, monospace)"
                    >
                      {a.richtung}°
                    </text>
                  )}
                </g>
              </motion.g>
            );
          })}
        </svg>

        {/* Warn-Befund */}
        {warnung && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 rounded border border-warn/60 bg-panel/95 px-2.5 py-1 text-[11px] text-warn shadow-elevated"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Auftritt liegt nicht auf dem Walkmesh — Marker zurückgesetzt.
          </motion.div>
        )}

        {/* Live-Koordinaten */}
        {aktiv && (
          <div className="absolute bottom-2 left-2 rounded border border-subtle bg-panel/90 px-2 py-1 font-mono text-[11px] text-secondary backdrop-blur">
            {aktiv.dreieck >= 0 ? `Dreieck #${String(aktiv.dreieck).padStart(2, '0')}` : 'außerhalb'} · x {aktiv.x} ·
            y {aktiv.y} · r {aktiv.richtung}°
          </div>
        )}
      </div>
    </section>
  );
}
