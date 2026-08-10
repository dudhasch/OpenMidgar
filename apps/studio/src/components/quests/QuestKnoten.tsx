/**
 * QuestKnoten — Custom-Node für @xyflow/react (quests.md Sektion 2).
 * Nicht-blockierende Knoten = Rechteck (Radius 6px), blockierende
 * Wartepunkte = Achteck (clip-path) mit warn-Border + Hourglass-Icon.
 * Selektiert: 2px-Mako-Rahmen + Glow. Befund-Fokus: Puls-Ring (2s).
 */
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { Hourglass } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ScriptKategorie, SlotArt } from '@webmidgar/studio-core';
import { OKTAGON_CLIP, kategorieFarbe } from '@/lib/quests';
import { cn } from '@/lib/utils';

export interface QuestKnotenData extends Record<string, unknown> {
  op: string;
  kategorie: ScriptKategorie;
  blockierend: boolean;
  operanden?: Record<string, string | number>;
  slots: SlotArt[];
  fehler?: boolean;
  puls?: 'mako' | 'rot' | null;
}

export type QuestFlowNode = Node<QuestKnotenData, 'quest'>;

const VERZWEIGUNG_OPS = new Set(['JMPF', 'ASK']);

function SlotChips({ slots }: { slots: SlotArt[] }) {
  if (slots.length === 0) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {slots.slice(0, 2).map((s) => (
        <span
          key={s}
          className="rounded border border-mako/30 bg-mako-dim px-1 font-mono text-[9px] leading-4 text-mako"
        >
          {s}
        </span>
      ))}
    </span>
  );
}

function OperandenZeilen({ operanden }: { operanden?: Record<string, string | number> }) {
  const eintraege = Object.entries(operanden ?? {}).slice(0, 2);
  if (eintraege.length === 0) return null;
  return (
    <div className="space-y-0.5 border-t border-subtle/60 px-3 py-1.5">
      {eintraege.map(([key, wert]) => (
        <div key={key} className="truncate font-mono text-[11px] text-secondary" title={`${key}: ${String(wert)}`}>
          <span className="text-muted">{key}</span> {String(wert) || '—'}
        </div>
      ))}
    </div>
  );
}

/** 2s-Puls-Ring bei Befund-Fokus (Mako oder rot). */
function PulsRing({ art }: { art: 'mako' | 'rot' }) {
  return (
    <motion.span
      className="pointer-events-none absolute -inset-2 rounded-[10px]"
      style={{ border: `2px solid ${art === 'rot' ? 'var(--error)' : 'var(--accent-mako)'}` }}
      initial={{ opacity: 0.7, scale: 1 }}
      animate={{ opacity: [0.7, 0, 0.7, 0], scale: [1, 1.12, 1, 1.12] }}
      transition={{ duration: 2, ease: 'easeOut' }}
    />
  );
}

const HANDLE_STIL: React.CSSProperties = {
  width: 8,
  height: 8,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
};

function QuestKnoten({ id, data, selected }: NodeProps<QuestFlowNode>) {
  const farbe = kategorieFarbe(data.kategorie);
  const verzweigung = VERZWEIGUNG_OPS.has(data.op);

  const kopf = (
    <div className="flex items-center gap-1.5 px-3 py-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: farbe }} />
      {data.blockierend && <Hourglass className="h-3 w-3 shrink-0 text-warn" />}
      <span className="truncate font-mono text-[12px] font-bold text-foreground">{data.op}</span>
      <SlotChips slots={data.slots} />
    </div>
  );

  return (
    <motion.div
      layoutId={`quest-morph-${id}`}
      className="relative"
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.18, ease: [0.34, 1.3, 0.64, 1] }}
    >
      {data.puls && <PulsRing art={data.puls} />}

      {/* Fehler-Punkt (mit Befund verknüpft) */}
      {data.fehler && (
        <span
          className={cn(
            'absolute -right-1 -top-1 z-10 h-2.5 w-2.5 rounded-full bg-error',
            data.puls === 'rot' && 'animate-ping',
          )}
        />
      )}

      {data.blockierend ? (
        /* Blockierender Wartepunkt — Achteck (quests.md: auf den ersten
           Blick unterscheidbar, 2px warn-Border, amber Schimmer 8%) */
        <div
          style={{
            filter: selected ? 'drop-shadow(0 0 8px rgba(61,220,151,.4))' : undefined,
          }}
        >
          <div style={{ clipPath: OKTAGON_CLIP, background: selected ? 'var(--accent-mako)' : 'var(--warn)', padding: 2 }}>
            <div
              className="w-[180px]"
              style={{
                clipPath: OKTAGON_CLIP,
                background:
                  'linear-gradient(rgba(255,180,84,.08), rgba(255,180,84,.08)), var(--bg-panel)',
              }}
            >
              {kopf}
              <OperandenZeilen operanden={data.operanden} />
            </div>
          </div>
        </div>
      ) : (
        /* Nicht-blockierend — Rechteck */
        <div
          className={cn(
            'w-[180px] rounded-md border bg-panel shadow-elevated transition-shadow duration-150',
            selected ? 'border-mako shadow-mako-glow' : 'border-strong',
          )}
          style={selected ? { boxShadow: '0 0 12px rgba(61,220,151,.2), 0 0 0 1px var(--accent-mako)' } : undefined}
        >
          {kopf}
          <OperandenZeilen operanden={data.operanden} />
        </div>
      )}

      {/* Ports: links Eingang, rechts Ausgang(e) */}
      <Handle type="target" position={Position.Left} style={HANDLE_STIL} className="quest-handle" />
      {verzweigung ? (
        <>
          <Handle id="wahr" type="source" position={Position.Right} style={{ ...HANDLE_STIL, top: '60%' }} className="quest-handle" />
          <Handle id="falsch" type="source" position={Position.Right} style={{ ...HANDLE_STIL, top: '88%' }} className="quest-handle" />
        </>
      ) : (
        <Handle type="source" position={Position.Right} style={HANDLE_STIL} className="quest-handle" />
      )}
    </motion.div>
  );
}

export default memo(QuestKnoten);
