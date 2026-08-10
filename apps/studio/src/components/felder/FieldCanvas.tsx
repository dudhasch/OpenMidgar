/**
 * FieldCanvas — 2D-Top-Down-Canvas des Field-Editors (felder.md Sektion 2).
 * Zoom/Pan (ZoomControls shared), Hintergrundbild bzw. Blueprint-Platzhalter
 * (Delta-Modus), Walkmesh-Dreieckseditor mit Live-Invarianten (degeneriert /
 * Adjazenz rot + Befund-Zeile), Overlay-Toggles (Walkmesh/Trigger/Gateways/
 * Tiefenmaske), Trigger-Volumen, Gateway-Diamanten, Kamerapose-Glyph,
 * Legende und Live-Koordinaten.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  DoorOpen,
  Eraser,
  Layers,
  MousePointer2,
  PenTool,
  Plus,
  Triangle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import ToolbarSegment from '@/components/shared/ToolbarSegment';
import type { ToolbarAktion } from '@/components/shared/ToolbarSegment';
import ZoomControls from '@/components/shared/ZoomControls';
import LegendeKarte from '@/components/felder/LegendeKarte';
import {
  adjazenzFehlerKanten,
  DEMO_TIEFENMASKE,
  dreieckKanten,
  dreieckZentrum,
  entferneDreieck,
  istDegeneriert,
  ORIGINAL_FIELDS,
  SLUMKIRCHE_FIELD_ID,
} from '@/lib/charfelder';
import type {
  CanvasSelektion,
  Dreieck2D,
  GatewayMark,
  KameraPose,
  MeshBefund,
  Pt,
  TriggerZone,
  Werkzeug,
} from '@/lib/charfelder';
import { cn } from '@/lib/utils';

const WELT_W = 640;
const WELT_H = 480;
const SNAP = 8;

type Drag =
  | { art: 'pan'; startX: number; startY: number; tx0: number; ty0: number }
  | { art: 'vertex'; tri: number; vi: 'a' | 'b' | 'c' }
  | { art: 'trigger'; id: string; dx: number; dy: number }
  | { art: 'gateway'; id: string; dx: number; dy: number }
  | { art: 'kamera'; dx: number; dy: number }
  | null;

interface FieldCanvasProps {
  modus: 'neu' | 'delta';
  mesh: Dreieck2D[];
  setMesh: (m: Dreieck2D[]) => void;
  trigger: TriggerZone[];
  setTrigger: (t: TriggerZone[]) => void;
  gateways: GatewayMark[];
  setGateways: (g: GatewayMark[]) => void;
  kamera: KameraPose;
  setKamera: (k: KameraPose) => void;
  selektion: CanvasSelektion;
  setSelektion: (s: CanvasSelektion) => void;
  befunde: MeshBefund[];
  /** Zoom-Ziel aus der Statistik-Zeile (n = Aufruf-Zähler für erneutes Auslösen). */
  fokusDreieck: { dreieck: number; n: number } | null;
  onBefundKlick: (dreieck: number) => void;
}

export default function FieldCanvas({
  modus,
  mesh,
  setMesh,
  trigger,
  setTrigger,
  gateways,
  setGateways,
  kamera,
  setKamera,
  selektion,
  setSelektion,
  befunde,
  fokusDreieck,
  onBefundKlick,
}: FieldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [werkzeug, setWerkzeug] = useState<Werkzeug>('auswaehlen');
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ tx: 40, ty: 30 });
  const [sanft, setSanft] = useState(false);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [overlays, setOverlays] = useState({ walkmesh: true, trigger: true, gateways: true, tiefe: true });
  const [zeichnung, setZeichnung] = useState<Pt[]>([]);
  const [snapPunkt, setSnapPunkt] = useState<Pt | null>(null);
  const [triggerZug, setTriggerZug] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [gwPopover, setGwPopover] = useState<{ id: string; sx: number; sy: number } | null>(null);
  const [hoverLoeschen, setHoverLoeschen] = useState<string | null>(null);
  const dragRef = useRef<Drag>(null);

  const s = zoom / 100;
  const toWorld = (p: Pt): Pt => ({ x: (p.x - pan.tx) / s, y: (p.y - pan.ty) / s });

  const fehlerKanten = useMemo(() => adjazenzFehlerKanten(mesh), [mesh]);
  const fehlerDreiecke = useMemo(() => new Set(befunde.map((b) => b.dreieck)), [befunde]);

  const allePunkte = useMemo(() => mesh.flatMap((d) => [d.a, d.b, d.c]), [mesh]);

  const snap = (p: Pt): Pt => {
    const treffer = allePunkte.find((q) => Math.abs(q.x - p.x) < SNAP && Math.abs(q.y - p.y) < SNAP);
    return treffer ? { ...treffer } : p;
  };

  /* Zoom per Mausrad (nicht-passiv, um das Seiten-Scrollen zu verhindern) */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setZoom((alt) => {
        const naechster = Math.min(400, Math.max(25, alt + (e.deltaY < 0 ? 25 : -25)));
        const faktor = naechster / alt;
        setPan((p) => ({ tx: px - (px - p.tx) * faktor, ty: py - (py - p.ty) * faktor }));
        return naechster;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* Zum Fehler/Element zoomen (Statistik/Befund-Zeile, Tween 400ms) */
  useEffect(() => {
    if (fokusDreieck === null || !mesh[fokusDreieck.dreieck]) return;
    const el = containerRef.current;
    const zentrum = dreieckZentrum(mesh[fokusDreieck.dreieck]);
    const rect = el?.getBoundingClientRect();
    const zielZoom = 175;
    const zielS = zielZoom / 100;
    setSanft(true);
    setZoom(zielZoom);
    setPan({
      tx: (rect?.width ?? 800) / 2 - zentrum.x * zielS,
      ty: (rect?.height ?? 600) / 2 - zentrum.y * zielS,
    });
    const t = window.setTimeout(() => setSanft(false), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusDreieck]);

  const einpassen = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ziel = Math.min(((rect.width - 60) / WELT_W) * 100, ((rect.height - 60) / WELT_H) * 100);
    const zielS = ziel / 100;
    setSanft(true);
    setZoom(Math.round(ziel));
    setPan({
      tx: (rect.width - WELT_W * zielS) / 2,
      ty: (rect.height - WELT_H * zielS) / 2,
    });
    window.setTimeout(() => setSanft(false), 450);
  };

  const lokalerPunkt = (e: React.PointerEvent | PointerEvent): Pt => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /* ---------------- Pointer-Handling ---------------- */

  const onBackgroundDown = (e: React.PointerEvent) => {
    const lokal = lokalerPunkt(e);
    const welt = toWorld(lokal);
    if (e.button === 1 || (werkzeug === 'auswaehlen' && e.button === 0)) {
      dragRef.current = { art: 'pan', startX: lokal.x, startY: lokal.y, tx0: pan.tx, ty0: pan.ty };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setSelektion(null);
      return;
    }
    if (werkzeug === 'dreieck') {
      const p = snap(welt);
      if (zeichnung.length === 2) {
        const neu: Dreieck2D = { a: zeichnung[0]!, b: zeichnung[1]!, c: p, adjazent: [null, null, null] };
        setMesh([...mesh, neu]);
        setSelektion({ art: 'dreieck', index: mesh.length });
        setZeichnung([]);
        if (istDegeneriert(neu)) {
          toast.error(`Dreieck #${mesh.length} degeneriert`, { description: 'Fläche < 0.5 — Punkte weiter auseinander ziehen.' });
        }
      } else {
        setZeichnung([...zeichnung, p]);
      }
      return;
    }
    if (werkzeug === 'trigger') {
      setTriggerZug({ x0: welt.x, y0: welt.y, x1: welt.x, y1: welt.y });
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (werkzeug === 'gateway') {
      const id = `gw:neu-${Date.now() % 10000}`;
      setGateways([...gateways, { id, x: Math.round(welt.x), y: Math.round(welt.y), zielField: 'field:md1_1', spawnX: 0, spawnY: 0, richtung: 0 }]);
      setSelektion({ art: 'gateway', id });
      setGwPopover({ id, sx: lokal.x, sy: lokal.y });
      return;
    }
    if (werkzeug === 'kamera') {
      setKamera({ ...kamera, posX: Math.round(welt.x), posY: Math.round(welt.y) });
      setSelektion({ art: 'kamera' });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const lokal = lokalerPunkt(e);
    const welt = toWorld(lokal);
    setCursor(welt);
    if (werkzeug === 'dreieck') setSnapPunkt(snap(welt));
    if (triggerZug) {
      setTriggerZug({ ...triggerZug, x1: welt.x, y1: welt.y });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.art === 'pan') {
      setPan({ tx: drag.tx0 + (lokal.x - drag.startX), ty: drag.ty0 + (lokal.y - drag.startY) });
    } else if (drag.art === 'vertex') {
      // Knotenpunkt ziehen — Invarianten re-evaluieren live (befunde sind useMemo über mesh)
      setMesh(
        mesh.map((d, i) =>
          i === drag.tri ? { ...d, [drag.vi]: { x: Math.round(welt.x), y: Math.round(welt.y) } } : d,
        ),
      );
    } else if (drag.art === 'trigger') {
      setTrigger(
        trigger.map((t) =>
          t.id === drag.id ? { ...t, x: Math.round(welt.x - drag.dx), y: Math.round(welt.y - drag.dy) } : t,
        ),
      );
    } else if (drag.art === 'gateway') {
      setGateways(
        gateways.map((g) =>
          g.id === drag.id ? { ...g, x: Math.round(welt.x - drag.dx), y: Math.round(welt.y - drag.dy) } : g,
        ),
      );
    } else if (drag.art === 'kamera') {
      setKamera({ ...kamera, posX: Math.round(welt.x - drag.dx), posY: Math.round(welt.y - drag.dy) });
    }
  };

  const onPointerUp = () => {
    if (triggerZug) {
      const x = Math.round(Math.min(triggerZug.x0, triggerZug.x1));
      const y = Math.round(Math.min(triggerZug.y0, triggerZug.y1));
      const w = Math.round(Math.abs(triggerZug.x1 - triggerZug.x0));
      const h = Math.round(Math.abs(triggerZug.y1 - triggerZug.y0));
      if (w > 6 && h > 6) {
        const id = `trg:zone-${trigger.length + 1}`;
        setTrigger([
          ...trigger,
          { id, name: `Zone ${trigger.length + 1}`, x, y, w, h, ausloeser: 'beruehrung', scriptRef: '', einmalig: false },
        ]);
        setSelektion({ art: 'trigger', id });
      }
      setTriggerZug(null);
    }
    dragRef.current = null;
  };

  const loescheElement = (s: CanvasSelektion) => {
    if (!s) return;
    if (s.art === 'dreieck') {
      setMesh(entferneDreieck(mesh, s.index));
      toast(`Dreieck #${s.index} gelöscht`, {
        action: { label: 'Rückgängig', onClick: () => toast.info('Wiederherstellung folgt mit dem Projektspeicher.') },
      });
    } else if (s.art === 'trigger') {
      setTrigger(trigger.filter((t) => t.id !== s.id));
    } else if (s.art === 'gateway') {
      setGateways(gateways.filter((g) => g.id !== s.id));
    }
    setSelektion(null);
  };

  const klickDreieck = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    if (werkzeug === 'loeschen') {
      loescheElement({ art: 'dreieck', index: i });
    } else if (werkzeug === 'auswaehlen') {
      setSelektion({ art: 'dreieck', index: i });
    }
  };

  const werkzeugGruppen: ToolbarAktion[][] = [
    [
      { icon: MousePointer2, label: 'Auswählen / Verschieben', aktiv: werkzeug === 'auswaehlen', onClick: () => setWerkzeug('auswaehlen') },
      { icon: PenTool, label: modus === 'delta' ? 'Dreieck zeichnen (nur bei neuen Feldern)' : 'Dreieck zeichnen', aktiv: werkzeug === 'dreieck', deaktiviert: modus === 'delta', onClick: () => setWerkzeug('dreieck') },
      { icon: Plus, label: 'Trigger-Zone', aktiv: werkzeug === 'trigger', onClick: () => setWerkzeug('trigger') },
      { icon: DoorOpen, label: 'Gateway setzen', aktiv: werkzeug === 'gateway', onClick: () => setWerkzeug('gateway') },
      { icon: Camera, label: 'Kamerapose', aktiv: werkzeug === 'kamera', onClick: () => setWerkzeug('kamera') },
      { icon: Eraser, label: 'Löschen', aktiv: werkzeug === 'loeschen', onClick: () => setWerkzeug('loeschen') },
    ],
  ];

  const toggleChip = (key: keyof typeof overlays, icon: React.ReactNode, label: string) => (
    <motion.button
      key={key}
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={() => setOverlays((o) => ({ ...o, [key]: !o[key] }))}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] backdrop-blur transition-colors duration-150',
        overlays[key]
          ? 'border-mako/40 bg-mako-dim text-mako'
          : 'border-subtle bg-panel/90 text-secondary hover:bg-elevated hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </motion.button>
  );

  const kameraWinkel = Math.atan2(kamera.zielX - kamera.posX, -(kamera.zielY - kamera.posY));

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full w-full overflow-hidden bg-inset',
        werkzeug === 'auswaehlen' && (dragRef.current?.art === 'pan' ? 'cursor-grabbing' : 'cursor-grab'),
        (werkzeug === 'dreieck' || werkzeug === 'trigger' || werkzeug === 'gateway' || werkzeug === 'kamera') &&
          'cursor-crosshair',
      )}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="absolute inset-0 h-full w-full" onPointerDown={onBackgroundDown}>
        <defs>
          <pattern id="schraffur" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="var(--error)" fillOpacity="0.08" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--error)" strokeOpacity="0.35" strokeWidth="1.5" />
          </pattern>
          <pattern id="blueprint" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="var(--accent-engine)" strokeOpacity="0.14" strokeWidth="0.5" />
          </pattern>
        </defs>
        <g
          style={{
            transform: `translate(${pan.tx}px, ${pan.ty}px) scale(${s})`,
            transformOrigin: '0 0',
            transition: sanft ? 'transform 400ms cubic-bezier(.2,.8,.2,1)' : undefined,
          }}
        >
          {/* Ebene Hintergrund */}
          {modus === 'neu' ? (
            <>
              <image href="./field-bg-slumkirche.png" x={0} y={0} width={WELT_W} height={WELT_H} />
              <rect x={0} y={0} width={WELT_W} height={WELT_H} fill="var(--bg-inset)" opacity={0.25} />
            </>
          ) : (
            <rect x={0} y={0} width={WELT_W} height={WELT_H} fill="url(#blueprint)" stroke="var(--border-subtle)" />
          )}

          {/* Ebene Tiefenmaske */}
          <motion.polygon
            points={DEMO_TIEFENMASKE.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="#B48CF2"
            initial={false}
            animate={{ opacity: overlays.tiefe ? 0.18 : 0 }}
            transition={{ duration: 0.2 }}
            pointerEvents="none"
          />

          {/* Ebene Walkmesh */}
          <motion.g initial={false} animate={{ opacity: overlays.walkmesh ? 1 : 0 }} transition={{ duration: 0.2 }}>
            {mesh.map((d, i) => {
              const degeneriert = istDegeneriert(d);
              const selektiert = selektion?.art === 'dreieck' && selektion.index === i;
              const wirdGeloescht = werkzeug === 'loeschen' && hoverLoeschen === `d${i}`;
              return (
                <g key={i}>
                  <polygon
                    points={`${d.a.x},${d.a.y} ${d.b.x},${d.b.y} ${d.c.x},${d.c.y}`}
                    fill={degeneriert ? 'url(#schraffur)' : 'var(--accent-mako)'}
                    fillOpacity={degeneriert ? 1 : selektiert ? 0.14 : 0.08}
                    stroke="none"
                    onPointerDown={(e) => klickDreieck(i, e)}
                    onPointerEnter={() => setHoverLoeschen(`d${i}`)}
                    onPointerLeave={() => setHoverLoeschen(null)}
                    style={{ cursor: werkzeug === 'loeschen' ? 'pointer' : undefined, transition: 'fill-opacity 120ms ease-out' }}
                  />
                  {dreieckKanten(d).map((kante, ke) => {
                    const kantenFehler = degeneriert || fehlerKanten[i]?.[ke];
                    return (
                      <line
                        key={ke}
                        x1={kante[0].x}
                        y1={kante[0].y}
                        x2={kante[1].x}
                        y2={kante[1].y}
                        stroke={kantenFehler || wirdGeloescht ? 'var(--error)' : 'var(--accent-mako)'}
                        strokeOpacity={kantenFehler ? 1 : selektiert ? 0.9 : 0.7}
                        strokeWidth={kantenFehler || selektiert ? 2 : 1.5}
                        strokeDasharray={!degeneriert && fehlerKanten[i]?.[ke] ? '5 3' : undefined}
                        pointerEvents="none"
                      />
                    );
                  })}
                  {/* Eckpunkt-Griffe des selektierten Dreiecks */}
                  {selektiert &&
                    werkzeug === 'auswaehlen' &&
                    (['a', 'b', 'c'] as const).map((vi) => (
                      <rect
                        key={vi}
                        x={d[vi].x - 4}
                        y={d[vi].y - 4}
                        width={8}
                        height={8}
                        fill="var(--bg-elevated)"
                        stroke="var(--accent-mako)"
                        strokeWidth={1.5}
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          dragRef.current = { art: 'vertex', tri: i, vi };
                          (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        }}
                      />
                    ))}
                </g>
              );
            })}

            {/* Ghost-Linien beim Dreieck-Zeichnen */}
            {zeichnung.map((p, i) => (
              <motion.circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={4}
                fill="var(--accent-mako)"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              />
            ))}
            {zeichnung.length > 0 && cursor && (
              <line
                x1={zeichnung[zeichnung.length - 1]!.x}
                y1={zeichnung[zeichnung.length - 1]!.y}
                x2={snapPunkt?.x ?? cursor.x}
                y2={snapPunkt?.y ?? cursor.y}
                stroke="var(--accent-mako)"
                strokeOpacity={0.5}
                strokeDasharray="4 3"
              />
            )}
            {zeichnung.length === 2 && (
              <line
                x1={zeichnung[0]!.x}
                y1={zeichnung[0]!.y}
                x2={snapPunkt?.x ?? cursor?.x ?? 0}
                y2={snapPunkt?.y ?? cursor?.y ?? 0}
                stroke="var(--accent-mako)"
                strokeOpacity={0.3}
                strokeDasharray="4 3"
              />
            )}
            {snapPunkt && werkzeug === 'dreieck' && (
              <circle cx={snapPunkt.x} cy={snapPunkt.y} r={7} fill="none" stroke="var(--accent-mako)" strokeWidth={1.5} className="animate-mako-pulse" />
            )}
          </motion.g>

          {/* Ebene Trigger */}
          <motion.g initial={false} animate={{ opacity: overlays.trigger ? 1 : 0 }} transition={{ duration: 0.2 }}>
            {trigger.map((t) => {
              const selektiert = selektion?.art === 'trigger' && selektion.id === t.id;
              const wirdGeloescht = werkzeug === 'loeschen' && hoverLoeschen === `t${t.id}`;
              return (
                <g
                  key={t.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (werkzeug === 'loeschen') return loescheElement({ art: 'trigger', id: t.id });
                    if (werkzeug !== 'auswaehlen') return;
                    setSelektion({ art: 'trigger', id: t.id });
                    const welt = toWorld(lokalerPunkt(e));
                    dragRef.current = { art: 'trigger', id: t.id, dx: welt.x - t.x, dy: welt.y - t.y };
                    (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  }}
                  onPointerEnter={() => setHoverLoeschen(`t${t.id}`)}
                  onPointerLeave={() => setHoverLoeschen(null)}
                  style={{ cursor: werkzeug === 'auswaehlen' ? 'move' : 'pointer' }}
                >
                  <rect
                    x={t.x}
                    y={t.y}
                    width={t.w}
                    height={t.h}
                    fill="var(--warn)"
                    fillOpacity={0.06}
                    stroke={wirdGeloescht ? 'var(--error)' : 'var(--warn)'}
                    strokeWidth={selektiert ? 2 : 1.2}
                    strokeDasharray="6 4"
                  />
                  <text x={t.x + 4} y={t.y - 4} fill="var(--warn)" fontSize={10} fontFamily="monospace">
                    {t.name}
                  </text>
                </g>
              );
            })}
            {triggerZug && (
              <rect
                x={Math.min(triggerZug.x0, triggerZug.x1)}
                y={Math.min(triggerZug.y0, triggerZug.y1)}
                width={Math.abs(triggerZug.x1 - triggerZug.x0)}
                height={Math.abs(triggerZug.y1 - triggerZug.y0)}
                fill="var(--warn)"
                fillOpacity={0.08}
                stroke="var(--warn)"
                strokeDasharray="6 4"
              />
            )}
          </motion.g>

          {/* Ebene Gateways */}
          <motion.g initial={false} animate={{ opacity: overlays.gateways ? 1 : 0 }} transition={{ duration: 0.2 }}>
            {gateways.map((g) => {
              const selektiert = selektion?.art === 'gateway' && selektion.id === g.id;
              const wirdGeloescht = werkzeug === 'loeschen' && hoverLoeschen === `g${g.id}`;
              return (
                <g
                  key={g.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (werkzeug === 'loeschen') return loescheElement({ art: 'gateway', id: g.id });
                    if (werkzeug !== 'auswaehlen') return;
                    setSelektion({ art: 'gateway', id: g.id });
                    const welt = toWorld(lokalerPunkt(e));
                    dragRef.current = { art: 'gateway', id: g.id, dx: welt.x - g.x, dy: welt.y - g.y };
                    (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  }}
                  onPointerEnter={() => setHoverLoeschen(`g${g.id}`)}
                  onPointerLeave={() => setHoverLoeschen(null)}
                  style={{ cursor: werkzeug === 'auswaehlen' ? 'move' : 'pointer' }}
                >
                  {/* Diamant-Glyphe mit Richtungs-Pfeil */}
                  <g transform={`translate(${g.x} ${g.y}) rotate(${g.richtung})`}>
                    <line x1={0} y1={0} x2={0} y2={-20} stroke="var(--accent-engine)" strokeWidth={1.5} />
                    <path
                      d="M0 -12 L10 0 L0 12 L-10 0 Z"
                      fill="var(--accent-engine)"
                      fillOpacity={selektiert ? 0.35 : 0.18}
                      stroke={wirdGeloescht ? 'var(--error)' : 'var(--accent-engine)'}
                      strokeWidth={selektiert ? 2 : 1.5}
                    />
                    <circle r={2.5} fill="var(--accent-engine)" />
                  </g>
                  <text x={g.x + 14} y={g.y + 3} fill="var(--accent-engine)" fontSize={10} fontFamily="monospace">
                    {g.zielField}
                  </text>
                </g>
              );
            })}
          </motion.g>

          {/* Kamerapose-Glyph (Kegel) */}
          <g
            transform={`translate(${kamera.posX} ${kamera.posY}) rotate(${(kameraWinkel * 180) / Math.PI + kamera.rotation})`}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (werkzeug !== 'auswaehlen') return;
              setSelektion({ art: 'kamera' });
              const welt = toWorld(lokalerPunkt(e));
              dragRef.current = { art: 'kamera', dx: welt.x - kamera.posX, dy: welt.y - kamera.posY };
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            }}
            style={{ cursor: 'move' }}
          >
            <path
              d="M0 0 L-14 -34 L14 -34 Z"
              fill="var(--info)"
              fillOpacity={selektion?.art === 'kamera' ? 0.25 : 0.12}
              stroke="var(--info)"
              strokeWidth={1.5}
            />
            <circle r={5} fill="var(--bg-inset)" stroke="var(--info)" strokeWidth={1.5} />
          </g>
        </g>
      </svg>

      {/* Delta-Modus: Hinweis auf Original-Hintergrund */}
      {modus === 'delta' && (
        <div className="pointer-events-none absolute left-1/2 top-16 w-80 -translate-x-1/2 rounded-lg border border-engine/40 bg-panel/90 p-3 text-center backdrop-blur">
          <p className="text-[12px] text-secondary">
            Original-Hintergrund wird zur Laufzeit aus dem Spielarchiv gerendert — nur referenziert.
          </p>
        </div>
      )}

      {/* Overlay-Toggles oben links */}
      <div className="absolute left-2 top-2 flex gap-1">
        {toggleChip('walkmesh', <Triangle className="h-3.5 w-3.5" />, 'Walkmesh')}
        {toggleChip('trigger', <Zap className="h-3.5 w-3.5" />, 'Trigger')}
        {toggleChip('gateways', <DoorOpen className="h-3.5 w-3.5" />, 'Gateways')}
        {toggleChip('tiefe', <Layers className="h-3.5 w-3.5" />, 'Tiefenmaske')}
      </div>

      {/* Werkzeugleiste oben Mitte */}
      <ToolbarSegment gruppen={werkzeugGruppen} className="absolute left-1/2 top-2 -translate-x-1/2" />

      {/* ZoomControls unten rechts */}
      <ZoomControls zoom={zoom} onZoomChange={setZoom} onEinpassen={einpassen} className="absolute bottom-2 right-2" />

      {/* Legende + Koordinaten unten links */}
      <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1.5">
        <LegendeKarte />
        <div className="rounded border border-subtle bg-panel/90 px-2 py-1 font-mono text-[11px] text-secondary backdrop-blur">
          {cursor ? `x ${Math.round(cursor.x)} · y ${Math.round(cursor.y)}` : 'x — · y —'}
        </div>
      </div>

      {/* Gateway-Ziel-Popover (nach dem Platzieren) */}
      {gwPopover && (
        <div
          className="absolute z-10 w-56 rounded-md border border-subtle bg-popover p-1.5 shadow-modal"
          style={{ left: Math.min(gwPopover.sx + 12, 560), top: Math.min(gwPopover.sy + 12, 420) }}
        >
          <div className="mb-1 px-1.5 text-[11px] font-medium text-muted">Gateway-Ziel wählen</div>
          {[SLUMKIRCHE_FIELD_ID, ...ORIGINAL_FIELDS.slice(0, 4)].map((ziel) => (
            <button
              key={ziel}
              type="button"
              onClick={() => {
                setGateways(gateways.map((g) => (g.id === gwPopover.id ? { ...g, zielField: ziel } : g)));
                setGwPopover(null);
              }}
              className="w-full truncate rounded px-1.5 py-1 text-left font-mono text-[11px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
            >
              {ziel}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setGwPopover(null)}
            className="mt-1 w-full rounded border border-subtle px-1.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-elevated"
          >
            Später im Inspektor wählen
          </button>
        </div>
      )}

      {/* Befund-Zeile (Live-Invarianten) */}
      {befunde.length > 0 && (
        <div className="absolute inset-x-2 bottom-12 flex flex-wrap items-center gap-1.5">
          {befunde.map((b, i) => (
            <button
              key={`${b.dreieck}-${i}`}
              type="button"
              onClick={() => onBefundKlick(b.dreieck)}
              className="flex items-center gap-1.5 rounded border border-error/60 bg-panel/95 px-2 py-0.5 text-[11px] text-error shadow-elevated transition-colors duration-150 hover:bg-elevated"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-error" />
              {b.meldung}
            </button>
          ))}
        </div>
      )}

      {/* kurzer Status-Flash: Anzahl fehlerhafter Dreiecke */}
      <div className="pointer-events-none absolute right-2 top-2 rounded border border-subtle bg-panel/90 px-2 py-1 font-mono text-[10px] text-muted backdrop-blur">
        {mesh.length} Dreiecke · <span className={fehlerDreiecke.size > 0 ? 'text-error' : 'text-mako'}>{fehlerDreiecke.size} Fehler</span>
      </div>
    </div>
  );
}
