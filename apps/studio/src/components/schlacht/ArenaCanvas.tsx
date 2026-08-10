/**
 * ArenaCanvas — Hauptbereich oben des Battle-Editors (schlacht.md Sektion 3).
 * Stilisierte Draufsicht der normalisierten Arena-Grundfläche (0..1):
 * abgedunkeltes Nutzerbild + Perspektiv-Raster, Gegnerseite oben /
 * Spielerseite unten, Gegner-Palette (Drag aus der Palette oder Plus-Slot),
 * frei positionierbare Gegner-Marker (nur Gegnerseite gültig — sonst
 * animierter Rücksprung + Warn-Befund), Reihen-Gruppierung mit Snap-
 * Führungslinien, `maxGleichzeitig`-Nachrück-Wellen, Hinterhalt-
 * Spiegel-Preview und Zoom/Pan nach dem FieldCanvas-Muster.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Dog, Ghost, Grid3x3, Plus, RefreshCcw, Rows3, Tag } from 'lucide-react';
import { toast } from 'sonner';
import ZoomControls from '@/components/shared/ZoomControls';
import {
  ARENA_ASSET,
  demoGegner,
  markerLabel,
  naechsterFreierSlot,
  naechsterSuffix,
  REIHEN_SNAP,
  reihenGruppieren,
} from '@/lib/schlacht';
import type { FormationMarker } from '@/lib/schlacht';
import type { BattleDoc } from '@webmidgar/studio-core';
import { cn } from '@/lib/utils';

const WELT_W = 640;
const WELT_H = 360;
const MITTE_Z = 0.5;
const MARKER_PX = 44;

interface DragStand {
  id: string;
  /** Start-Position für den animierten Rücksprung. */
  startX: number;
  startZ: number;
  /** Griffer-Offset innerhalb des Markers. */
  dx: number;
  dz: number;
}

interface KontextMenue {
  id: string;
  sx: number;
  sy: number;
}

interface ArenaCanvasProps {
  doc: BattleDoc;
  marker: FormationMarker[];
  setMarker: (m: FormationMarker[]) => void;
  gespiegelt: boolean;
  setGespiegelt: (b: boolean) => void;
  /** Zähler: Wechsel löst die kurze Spiegel-Vorschau aus (Inspektor). */
  spiegelPuls: number;
}

export default function ArenaCanvas({
  doc,
  marker,
  setMarker,
  gespiegelt,
  setGespiegelt,
  spiegelPuls,
}: ArenaCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ tx: 60, ty: 40 });
  const [sanft, setSanft] = useState(false);
  const [drag, setDrag] = useState<DragStand | null>(null);
  const [snapZ, setSnapZ] = useState<number | null>(null);
  const [kontext, setKontext] = useState<KontextMenue | null>(null);
  const [overlays, setOverlays] = useState({ raster: true, reihen: true, namen: true });
  const zaehlerRef = useRef(0);

  const s = zoom / 100;
  const maxGleichzeitig = doc.formation.maxGleichzeitig || 6;
  const hinterhaltAktiv = (doc.regeln.hinterhalt ?? 'keiner') !== 'keiner';

  const reihen = useMemo(() => reihenGruppieren(marker), [marker]);

  /** Wellen-Zuordnung: sortiert nach Reihe, alles über maxGleichzeitig rückt nach. */
  const welleNachMarker = useMemo(() => {
    const sortiert = [...marker].sort((a, b) => a.z - b.z || a.x - b.x);
    const map = new Map<string, number>();
    sortiert.forEach((m, i) => map.set(m.id, Math.floor(i / maxGleichzeitig) + 1));
    return map;
  }, [marker, maxGleichzeitig]);
  const ueberschuss = marker.length > maxGleichzeitig;

  /* Spiegel-Vorschau aus dem Inspektor: 400ms hin, 400ms zurück */
  useEffect(() => {
    if (spiegelPuls === 0 || !hinterhaltAktiv) return;
    setGespiegelt(true);
    const t = window.setTimeout(() => setGespiegelt(false), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spiegelPuls]);

  /* Zoom per Mausrad */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setZoom((alt) => {
        const naechster = Math.min(300, Math.max(50, alt + (e.deltaY < 0 ? 25 : -25)));
        const faktor = naechster / alt;
        setPan((p) => ({ tx: px - (px - p.tx) * faktor, ty: py - (py - p.ty) * faktor }));
        return naechster;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const einpassen = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ziel = Math.min(((rect.width - 160) / WELT_W) * 100, ((rect.height - 60) / WELT_H) * 100);
    const zielS = ziel / 100;
    setSanft(true);
    setZoom(Math.round(ziel));
    setPan({ tx: (rect.width - WELT_W * zielS) / 2, ty: (rect.height - WELT_H * zielS) / 2 });
    window.setTimeout(() => setSanft(false), 450);
  };

  const lokalerPunkt = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const toWorld = (p: { x: number; y: number }) => ({ x: (p.x - pan.tx) / s / WELT_W, z: (p.y - pan.ty) / s / WELT_H });

  const clampWelt = (p: { x: number; z: number }) => ({
    x: Math.min(0.96, Math.max(0.04, p.x)),
    z: Math.min(0.94, Math.max(0.05, p.z)),
  });

  /** Snap auf vorhandene Reihen-Höhenlinien (Toleranz REIHEN_SNAP). */
  const snapReihe = (z: number, ausgenommenId: string): { z: number; snap: number | null } => {
    const kandidaten = marker.filter((m) => m.id !== ausgenommenId);
    for (const m of kandidaten) {
      if (Math.abs(m.z - z) <= REIHEN_SNAP) return { z: m.z, snap: m.z };
    }
    return { z, snap: null };
  };

  /* ---------------- Marker-Drag (nur Gegnerseite gültig) ---------------- */

  const markerDown = (m: FormationMarker, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setKontext(null);
    const welt = toWorld(lokalerPunkt(e));
    setDrag({ id: m.id, startX: m.x, startZ: m.z, dx: welt.x - m.x, dz: welt.z - m.z });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const roh = clampWelt(toWorld(lokalerPunkt(e)));
    const pos = { x: roh.x - drag.dx, z: roh.z - drag.dz };
    const { z, snap } = snapReihe(pos.z, drag.id);
    setSnapZ(snap);
    setMarker(marker.map((m) => (m.id === drag.id ? { ...m, x: pos.x, z } : m)));
  };

  const onPointerUp = () => {
    if (!drag) return;
    const fallen = marker.find((m) => m.id === drag.id);
    if (fallen && fallen.z >= MITTE_Z) {
      // Ungültige Zone: animierter Rücksprung + Warn-Befund
      setMarker(
        marker.map((m) => (m.id === drag.id ? { ...m, x: drag.startX, z: drag.startZ } : m)),
      );
      toast.warning('Position außerhalb der Gegnerseite', {
        description: `${markerLabel(fallen)} ist auf die letzte gültige Position zurückgesprungen.`,
      });
    }
    setDrag(null);
    setSnapZ(null);
  };

  /* ---------------- Palette (nativer Drag & Drop + Plus-Slot) ---------------- */

  const platzieren = (enemyRef: string, pos: { x: number; z: number }) => {
    const { z } = snapReihe(pos.z, '');
    zaehlerRef.current += 1;
    const neu: FormationMarker = {
      id: `m:${Date.now() % 100000}-${zaehlerRef.current}`,
      enemyRef,
      suffix: naechsterSuffix(enemyRef, marker),
      x: pos.x,
      z,
    };
    setMarker([...marker, neu]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const enemyRef = e.dataTransfer.getData('text/enemy-ref');
    if (!enemyRef) return;
    const pos = clampWelt(toWorld(lokalerPunkt(e)));
    if (pos.z >= MITTE_Z) {
      toast.warning('Position außerhalb der Gegnerseite', {
        description: 'Gegner können nur auf der oberen Arenahälfte platziert werden.',
      });
      return;
    }
    platzieren(enemyRef, pos);
  };

  /* ---------------- Kontextmenü ---------------- */

  const entfernen = (id: string) => {
    const m = marker.find((mm) => mm.id === id);
    setMarker(marker.filter((mm) => mm.id !== id));
    setKontext(null);
    if (m) toast(`${markerLabel(m)} entfernt`, { description: 'Formation aktualisiert.' });
  };

  const duplizieren = (id: string) => {
    const m = marker.find((mm) => mm.id === id);
    if (!m) return;
    platzieren(m.enemyRef, clampWelt({ x: m.x + 0.08, z: m.z + 0.06 >= MITTE_Z ? m.z : m.z + 0.06 }));
    setKontext(null);
  };

  const inReiheSetzen = (id: string, nr: number) => {
    const ziel = reihen.find((r) => r.nr === nr);
    const z = ziel ? ziel.z : 0.14 + (nr - 1) * 0.12;
    setMarker(marker.map((m) => (m.id === id ? { ...m, z: Math.min(z, MITTE_Z - 0.04) } : m)));
    setKontext(null);
  };

  const dragMarker = drag ? marker.find((m) => m.id === drag.id) : null;
  const dragUngueltig = !!dragMarker && dragMarker.z >= MITTE_Z;

  const iconFuer = (enemyRef: string) => (enemyRef.includes('rostwolf') ? Dog : Ghost);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-inset"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => kontext && setKontext(null)}
    >
      {/* Nachrück-Wellen-Banner */}
      {ueberschuss && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 border-b border-warn/40 bg-panel/95 px-3 py-1.5 text-[11px] text-warn backdrop-blur">
          <span className="font-mono">{marker.length} Marker</span>
          <span>— maximal {maxGleichzeitig} gleichzeitig. Überschuss wird als Nachrück-Welle geführt.</span>
        </div>
      )}

      {/* Welt (Zoom/Pan) */}
      <div
        className="absolute left-0 top-0"
        style={{
          width: WELT_W,
          height: WELT_H,
          transform: `translate(${pan.tx}px, ${pan.ty}px) scale(${s})`,
          transformOrigin: '0 0',
          transition: sanft ? 'transform 400ms cubic-bezier(.2,.8,.2,1)' : undefined,
        }}
      >
        {/* Arena-Bild, abgedunkelt */}
        <img
          src={`./${doc.arena.art === 'nutzerbild' ? doc.arena.asset : ARENA_ASSET}`}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover opacity-35"
        />

        {/* Perspektiv-Raster + Seiten-Trennung */}
        {overlays.raster && (
          <motion.svg
            className="pointer-events-none absolute inset-0"
            width={WELT_W}
            height={WELT_H}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {[0.125, 0.25, 0.375, 0.625, 0.75, 0.875].map((z) => {
              const einzug = z < 0.5 ? (0.5 - z) * 90 : (z - 0.5) * -60;
              return (
                <line
                  key={z}
                  x1={einzug}
                  y1={z * WELT_H}
                  x2={WELT_W - einzug}
                  y2={z * WELT_H}
                  stroke="var(--border-strong)"
                  strokeOpacity={0.3}
                />
              );
            })}
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((x) => (
              <line
                key={x}
                x1={x * WELT_W}
                y1={0}
                x2={WELT_W / 2 + (x - 0.5) * WELT_W * 0.6}
                y2={WELT_H}
                stroke="var(--border-strong)"
                strokeOpacity={0.22}
              />
            ))}
          </motion.svg>
        )}

        {/* Gültige Zone leuchtet während des Drags (Mako 8 %) */}
        <div
          className="pointer-events-none absolute left-0 top-0 w-full bg-mako transition-opacity duration-150"
          style={{ height: WELT_H * MITTE_Z, opacity: drag ? 0.08 : 0 }}
        />

        {/* Trennlinie + Labels */}
        <div
          className="pointer-events-none absolute left-0 w-full border-t border-dashed border-strong"
          style={{ top: WELT_H * MITTE_Z }}
        />
        <span
          className="pointer-events-none absolute left-2 text-[11px] uppercase tracking-[0.06em] text-muted"
          style={{ top: WELT_H * MITTE_Z - 18 }}
        >
          Gegnerseite
        </span>
        <span
          className="pointer-events-none absolute left-2 text-[11px] uppercase tracking-[0.06em] text-muted"
          style={{ top: WELT_H * MITTE_Z + 6 }}
        >
          Spielerseite
        </span>

        {/* Snap-Führungslinie */}
        {snapZ !== null && (
          <motion.div
            className="pointer-events-none absolute left-0 w-full border-t border-dashed border-mako"
            style={{ top: snapZ * WELT_H }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.8 }}
            transition={{ duration: 0.12 }}
          />
        )}

        {/* Reihen-Verbindungslinien + Reihen-Badges */}
        {overlays.reihen &&
          reihen.map((r) => (
            <div key={r.nr} className="pointer-events-none absolute left-0 w-full" style={{ top: r.z * WELT_H }}>
              {r.marker.length > 1 && <div className="absolute left-[8%] w-[84%] border-t border-mako/40" />}
              <span className="absolute -top-2 left-1 rounded bg-panel/90 px-1 font-mono text-[10px] text-mako">
                R{r.nr}
              </span>
            </div>
          ))}

        {/* Gegner-Marker */}
        {marker.map((m, i) => {
          const g = demoGegner.find((gg) => gg.id === m.enemyRef);
          const Icon = iconFuer(m.enemyRef);
          const anzeigeZ = gespiegelt ? 1 - m.z : m.z;
          const welle = welleNachMarker.get(m.id) ?? 1;
          const wirdGezogen = drag?.id === m.id;
          return (
            <motion.div
              key={m.id}
              className="absolute left-0 top-0"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{
                x: m.x * WELT_W - MARKER_PX / 2,
                y: anzeigeZ * WELT_H - MARKER_PX / 2,
                scale: wirdGezogen ? 1.15 : 1,
                opacity: 1,
              }}
              transition={
                wirdGezogen
                  ? { scale: { duration: 0.12 }, x: { duration: 0 }, y: { duration: 0 } }
                  : { type: 'spring', damping: 18, stiffness: 260 }
              }
              style={{ width: MARKER_PX, transitionDelay: undefined }}
            >
              <motion.div
                initial={false}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.035 }}
                onPointerDown={(e) => markerDown(m, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const lokal = lokalerPunkt(e);
                  setKontext({ id: m.id, sx: lokal.x, sy: lokal.y });
                }}
                title={`${markerLabel(m)} · x ${m.x.toFixed(2)} · z ${m.z.toFixed(2)}`}
                className={cn(
                  'relative flex h-11 w-11 items-center justify-center rounded-full border-2 bg-panel shadow-elevated transition-colors duration-150',
                  dragUngueltig && wirdGezogen
                    ? 'cursor-not-allowed border-error'
                    : 'border-mako/60 hover:border-mako',
                  wirdGezogen && 'shadow-modal',
                  gespiegelt && 'border-engine/60',
                )}
                style={{ cursor: wirdGezogen ? (dragUngueltig ? 'not-allowed' : 'grabbing') : 'grab' }}
              >
                <Icon className="h-5 w-5 text-foreground" strokeWidth={1.5} />
                {welle > 1 && (
                  <span className="absolute -right-3 -top-2 rounded border border-warn bg-panel px-1 font-mono text-[9px] text-warn">
                    Welle {welle}
                  </span>
                )}
              </motion.div>
              {overlays.namen && (
                <div className="mt-1 whitespace-nowrap text-center text-[11px] text-secondary">
                  {g?.name} {m.suffix}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Gegner-Palette (schwebende Leiste links) */}
      <div className="absolute left-2 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2 rounded-lg border border-subtle bg-panel/90 p-2 shadow-elevated backdrop-blur">
        <span className="text-center text-[10px] font-medium uppercase tracking-[0.06em] text-muted">Gegner</span>
        {demoGegner.map((g) => {
          const Icon = iconFuer(g.id);
          return (
            <div
              key={g.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/enemy-ref', g.id)}
              className="flex w-28 cursor-grab items-center gap-2 rounded-md border border-subtle bg-elevated px-2 py-1.5 transition-colors duration-150 hover:border-mako/50 active:cursor-grabbing"
              title={`${g.name} auf die Gegnerseite ziehen`}
            >
              <Icon className="h-4 w-4 shrink-0 text-secondary" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate text-[11px]">{g.name}</span>
              <button
                type="button"
                aria-label={`${g.name} auf nächstem freien Slot platzieren`}
                onClick={() => platzieren(g.id, naechsterFreierSlot(marker))}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-mako-dim hover:text-mako"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Toolbar oben rechts: Zoom + Overlay-Toggles + Spiegel */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-subtle bg-panel/90 p-0.5 backdrop-blur">
          {(
            [
              { key: 'raster' as const, icon: Grid3x3, label: 'Raster' },
              { key: 'reihen' as const, icon: Rows3, label: 'Reihenlinien' },
              { key: 'namen' as const, icon: Tag, label: 'Namen' },
            ]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              aria-label={t.label}
              title={t.label}
              onClick={() => setOverlays((o) => ({ ...o, [t.key]: !o[t.key] }))}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded transition-colors duration-150',
                overlays[t.key] ? 'bg-mako-dim text-mako' : 'text-secondary hover:bg-elevated hover:text-foreground',
              )}
            >
              <t.icon className="h-4 w-4" />
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-subtle" />
          <button
            type="button"
            aria-label="Spielerseite spiegeln (Hinterhalt-Vorschau)"
            title={
              hinterhaltAktiv
                ? 'Hinterhalt-Vorschau: Formation spiegeln'
                : 'Nur aktiv bei Hinterhalt-Regel ≠ „keiner"'
            }
            disabled={!hinterhaltAktiv}
            onClick={() => setGespiegelt(!gespiegelt)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors duration-150',
              gespiegelt ? 'bg-mako-dim text-mako' : 'text-secondary hover:bg-elevated hover:text-foreground',
              !hinterhaltAktiv && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-secondary',
            )}
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
        </div>
        <ZoomControls zoom={zoom} onZoomChange={setZoom} onEinpassen={einpassen} min={50} max={300} />
      </div>

      {/* Live-Koordinaten unten links */}
      <div className="absolute bottom-2 left-2 z-10 rounded border border-subtle bg-panel/90 px-2 py-1 font-mono text-[11px] text-secondary backdrop-blur">
        {dragMarker
          ? `x ${dragMarker.x.toFixed(2)} · z ${dragMarker.z.toFixed(2)}`
          : marker.length > 0
            ? `${marker.length} Gegner · ${reihen.length} Reihe${reihen.length === 1 ? '' : 'n'}`
            : 'Palette → Gegnerseite ziehen'}
      </div>

      {/* Marker-Kontextmenü */}
      {kontext && (
        <div
          className="absolute z-30 w-44 rounded-md border border-subtle bg-popover p-1 shadow-modal"
          style={{ left: Math.min(kontext.sx, (containerRef.current?.clientWidth ?? 800) - 190), top: kontext.sy }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 font-mono text-[10px] text-muted">
            {markerLabel(marker.find((m) => m.id === kontext.id)!)}
          </div>
          {[
            { label: 'Duplizieren', onClick: () => duplizieren(kontext.id) },
            { label: 'In Reihe 1 setzen', onClick: () => inReiheSetzen(kontext.id, 1) },
            { label: 'In Reihe 2 setzen', onClick: () => inReiheSetzen(kontext.id, 2) },
            { label: 'In Reihe 3 setzen', onClick: () => inReiheSetzen(kontext.id, 3) },
          ].map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="w-full rounded px-2 py-1 text-left text-[12px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
            >
              {a.label}
            </button>
          ))}
          <div className="my-1 border-t border-subtle" />
          <button
            type="button"
            onClick={() => entfernen(kontext.id)}
            className="w-full rounded px-2 py-1 text-left text-[12px] text-error transition-colors duration-150 hover:bg-elevated"
          >
            Entfernen
          </button>
        </div>
      )}
    </div>
  );
}
