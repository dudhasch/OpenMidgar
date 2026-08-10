/**
 * Hero — Kopfbereich der Startseite (home.md Sektion 1).
 * GSAP-Intro (SplitText-Wortstagger, Tagline, Engine-Status-Zeilen),
 * kein Loop. Bei geöffnetem Projekt schrumpft der Hero per
 * framer-motion Layout-Animation zur einzeiligen Kopfleiste.
 */
import { useRef } from 'react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { studioVersionen } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';
import { cn } from '@/lib/utils';

gsap.registerPlugin(SplitText, useGSAP);

const ENGINE_STATUS = ['Dokumentmodell bereit', 'Command-Bus aktiv', 'IndexedDB verbunden'];

export default function Hero() {
  const { projektOffen } = useAppState();
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (projektOffen) return;
      const split = new SplitText('.hero-wortmarke', { type: 'words' });
      gsap.from(split.words, {
        y: 24,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: 'power2.out',
      });
      gsap.from('.hero-tagline, .hero-meta', {
        y: 12,
        opacity: 0,
        duration: 0.4,
        delay: 0.3,
        stagger: 0.1,
        ease: 'power2.out',
      });
      gsap.from('.hero-status-zeile', {
        opacity: 0,
        scale: 0.6,
        duration: 0.35,
        delay: 0.5,
        stagger: 0.1,
        ease: 'power2.out',
      });
      return () => split.revert();
    },
    { scope, dependencies: [projektOffen] },
  );

  return (
    <motion.div
      ref={scope}
      layout
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex items-start justify-between gap-8"
    >
      <div className="min-w-0">
        <div className={cn('flex items-center', projektOffen ? 'gap-3' : 'gap-4')}>
          <motion.img
            layout
            src="./logo-mark.svg"
            alt="WebMidgar Studio Logo"
            className={projektOffen ? 'h-8 w-8' : 'h-14 w-14'}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          />
          <h1
            className={cn(
              'hero-wortmarke font-display font-bold tracking-[-0.02em] text-foreground',
              projektOffen ? 'text-2xl' : 'text-[40px] leading-tight',
            )}
          >
            WebMidgar{' '}
            <span className="font-semibold tracking-[0.08em] text-mako">STUDIO</span>
          </h1>
        </div>
        {!projektOffen && (
          <>
            <p className="hero-tagline mt-3 max-w-xl text-sm text-secondary">
              Die Modding-Suite für die WebMidgar-Engine. Baue Story-Mods, Charaktere, Dialoge und Felder — ohne
              Binärformate, ohne Bytecode, ohne Abstürze.
            </p>
            <p className="hero-meta mt-2 font-mono text-[11px] text-muted">{studioVersionen}</p>
          </>
        )}
      </div>

      {/* Engine-Status-Panel (Desktop, nur ohne geöffnetes Projekt) */}
      {!projektOffen && (
        <motion.aside
          layout
          initial={false}
          className="hidden w-60 shrink-0 rounded-md border border-subtle bg-panel p-3 lg:block"
          aria-label="Engine-Status"
        >
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.06em] text-muted">Engine-Status</p>
          <div className="flex flex-col gap-1.5">
            {ENGINE_STATUS.map((zeile) => (
              <div key={zeile} className="hero-status-zeile flex items-center gap-2 text-xs text-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-mako" />
                {zeile}
              </div>
            ))}
          </div>
        </motion.aside>
      )}
    </motion.div>
  );
}
