/**
 * ActorViewer — Platzhalter-Viewport des Charakter-Editors
 * (charaktere.md Sektion 2). Silhouette im Viewport-Rahmen (--bg-inset)
 * mit Punktraster + langsam rotierendem Ring, Steuer-Chips (Drehansicht,
 * Bodenraster), Vertrags-Hinweisleiste (A-ST-7) und Animationsliste mit
 * topologyHash-Badges.
 */
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Grid3x3, Info, Rotate3D } from 'lucide-react';
import { DEMO_ANIMATIONEN } from '@/lib/charfelder';
import { cn } from '@/lib/utils';

export default function ActorViewer() {
  const reduzierteBewegung = useReducedMotion();
  const [drehung, setDrehung] = useState(0);
  const [raster, setRaster] = useState(true);
  const [aktiveAnimation, setAktiveAnimation] = useState('idle');

  return (
    <section className="flex min-h-0 flex-[45] flex-col border-b border-subtle" aria-label="Actor-Viewer">
      {/* Viewport */}
      <div className="relative m-3 mb-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-subtle bg-inset">
        {/* Punktraster-Hintergrund */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(43,57,71,0.5) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        {/* Bodenraster (perspektivische Linien) */}
        {raster && (
          <div
            className="absolute inset-x-0 bottom-0 h-1/3 opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(rgba(61,220,151,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(61,220,151,0.10) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              transform: 'perspective(300px) rotateX(52deg)',
              transformOrigin: 'bottom',
            }}
          />
        )}
        {/* Langsam rotierender Ring (40s, pausiert bei prefers-reduced-motion) */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <motion.div
            className="h-24 w-64 rounded-[50%] border border-strong"
            animate={reduzierteBewegung ? { rotate: 0 } : { rotate: 360 }}
            transition={reduzierteBewegung ? { duration: 0 } : { duration: 40, ease: 'linear', repeat: Infinity }}
          />
        </div>

        {/* Silhouette (max 70% Höhe, Eintritt scale .92→1) */}
        <div className="absolute inset-0 flex items-end justify-center pb-6" style={{ perspective: 800 }}>
          <motion.img
            src="./char-silhouette-lina.png"
            alt="Platzhalter-Silhouette des Charakters"
            className="max-h-[70%] object-contain"
            style={{ transformStyle: 'preserve-3d' }}
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, rotateY: drehung }}
            transition={{
              scale: { duration: 0.3 },
              opacity: { duration: 0.3 },
              rotateY: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] },
            }}
          />
        </div>

        {/* Steuer-Chips oben links */}
        <div className="absolute left-2 top-2 flex gap-1">
          <motion.button
            type="button"
            onClick={() => setDrehung((d) => d + 360)}
            aria-label="Drehansicht"
            title="Drehansicht (360°)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-subtle bg-panel/90 text-secondary backdrop-blur transition-colors duration-150 hover:bg-elevated hover:text-mako"
          >
            <motion.span
              animate={{ rotate: drehung }}
              transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex"
            >
              <Rotate3D className="h-4 w-4" />
            </motion.span>
          </motion.button>
          <button
            type="button"
            onClick={() => setRaster((r) => !r)}
            aria-label="Bodenraster an/aus"
            title="Bodenraster an/aus"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur transition-colors duration-150',
              raster
                ? 'border-mako/40 bg-mako-dim text-mako'
                : 'border-subtle bg-panel/90 text-secondary hover:bg-elevated hover:text-foreground',
            )}
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
        </div>

        {/* Vertrags-Hinweisleiste */}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-subtle bg-panel/85 px-3 py-1.5 backdrop-blur">
          <Info className="h-3.5 w-3.5 shrink-0 text-info" />
          <p className="min-w-0 flex-1 truncate text-[11px] text-secondary">
            Platzhalter-Ansicht — die echte Runtime-Vorschau folgt mit der glTF-/Runtime-Anbindung. Modell-Referenz
            und Textur sind bereits verdrahtet.
          </p>
          <span className="shrink-0 rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[10px] text-muted">
            A-ST-7
          </span>
        </div>
      </div>

      {/* Animationsliste mit topologyHash-Badges */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 pb-2.5">
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Animationen</span>
        {DEMO_ANIMATIONEN.map((a) => {
          const aktiv = a.name === aktiveAnimation;
          return (
            <button
              key={a.name}
              type="button"
              onClick={() => setAktiveAnimation(a.name)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 transition-colors duration-150',
                aktiv
                  ? 'border-mako/40 bg-mako-dim text-mako'
                  : 'border-subtle bg-panel text-secondary hover:bg-elevated hover:text-foreground',
              )}
            >
              <span className="font-mono text-[11px]">{a.name}</span>
              <span
                className={cn(
                  'rounded border px-1 py-px font-mono text-[9px]',
                  aktiv ? 'border-mako/30 text-mako/80' : 'border-subtle text-muted',
                )}
              >
                {a.hash}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
