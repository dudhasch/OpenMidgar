/**
 * QuestsPage — Quest-/Script-Editor (`#/quests`, quests.md).
 * Voller visueller Graph-Editor: Knoten-Palette links (9 Opcode-Kategorien,
 * teils gesperrt), Graph-Canvas mit @xyflow/react (blockierende Knoten
 * achteckig, nicht-blockierende rechteckig), Inspektor rechts (280px),
 * Variablen-Panel, Quest-Meilenstein-Projektion (layoutId-Morph) und
 * Logik-Befund-Panel unten. Zustand lokal (useState).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutGroup, motion } from 'framer-motion';
import { FilePlus2, HelpCircle, MessagesSquare, MousePointerClick, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import type { ScriptKategorie, SlotArt } from '@webmidgar/studio-core';

import QuestKnoten from '@/components/quests/QuestKnoten';
import type { QuestFlowNode } from '@/components/quests/QuestKnoten';
import QuestSidebar from '@/components/quests/QuestSidebar';
import type { EditorSicht, SidebarTab } from '@/components/quests/QuestSidebar';
import { DRAG_MIME } from '@/components/quests/KnotenPalette';
import type { PaletteDragPayload } from '@/components/quests/KnotenPalette';
import QuestInspektor from '@/components/quests/QuestInspektor';
import QuestProjektion from '@/components/quests/QuestProjektion';
import type { ProjektionsMeilenstein } from '@/components/quests/QuestProjektion';
import LogikBefunde from '@/components/quests/LogikBefunde';
import ZoomControls from '@/components/shared/ZoomControls';
import EmptyState from '@/components/shared/EmptyState';
import WizardDialog from '@/components/shared/WizardDialog';
import { wizardSlug } from '@/components/shared/WizardDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { demoDialoge, demoScriptGraph } from '@/lib/mock-project';
import {
  demoLogikBefunde,
  demoMeilensteine,
  initialeVariablen,
  standardOperanden,
  vorlageBlockierend,
} from '@/lib/quests';
import type { LogikBefund, ProjektVariable } from '@/lib/quests';

const nodeTypes = { quest: QuestKnoten };

const SCRIPT_ID = 'mod:de.beispiel.nebenquest/scripts/lina_begegnung';

const KANTEN_STIL: CSSProperties = { stroke: 'var(--text-muted)', strokeWidth: 1.5 };

function kantenBasis(id: string, source: string, target: string, bedingung?: string): Edge {
  return {
    id,
    source,
    target,
    label: bedingung,
    type: 'default',
    style: { ...KANTEN_STIL },
    labelStyle: { fill: 'var(--text-primary)', fontFamily: '"JetBrains Mono", monospace', fontSize: 10 },
    labelBgStyle: { fill: 'var(--bg-elevated)', fillOpacity: 0.95 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--text-muted)' },
  };
}

function initialeKanten(): Edge[] {
  return demoScriptGraph.kanten.map((k) => kantenBasis(`e-${k.von}-${k.zu}`, k.von, k.zu, k.bedingung));
}

function initialeKnoten(slots: SlotArt[]): QuestFlowNode[] {
  return demoScriptGraph.knoten.map((k) => ({
    id: k.id,
    type: 'quest',
    position: { x: k.position.x, y: k.position.y },
    data: {
      op: k.op,
      kategorie: k.kategorie,
      blockierend: k.blockierend,
      operanden: { ...(k.operanden ?? {}) },
      slots,
      fehler: k.id === 'n8', // MAPJUMP-Befund aus demoBefunde
      puls: null,
    },
  }));
}

/* Canvas-spezifische xyflow-Theme-Overrides (scoped, ohne index.css). */
const CANVAS_CSS = `
  .quests-canvas .react-flow { background: var(--bg-inset); }
  .quests-canvas .react-flow__node { cursor: pointer; }
  .quests-canvas .react-flow__handle { transition: transform 120ms ease-out, background 120ms ease-out; }
  .quests-canvas .react-flow__handle:hover { transform: scale(1.4); background: var(--accent-mako); border-color: var(--accent-mako); }
  .quests-canvas .react-flow__handle.connectingto { background: var(--accent-mako); }
  .quests-canvas .react-flow__edge:hover .react-flow__edge-path { stroke: var(--accent-mako); }
  .quests-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: var(--accent-mako); }
  .quests-canvas .react-flow__connection-path { stroke: var(--accent-mako); stroke-width: 1.5; stroke-dasharray: 4 3; }
  .quests-canvas .react-flow__minimap { border: 1px solid var(--border-subtle); border-radius: 6px; overflow: hidden; }
  .quests-canvas .react-flow__minimap:hover { border-color: var(--border-strong); }
  .quests-canvas .react-flow__edge-text { font-family: "JetBrains Mono", monospace; }
  .quests-canvas .react-flow__selection { border: 1px solid rgba(61,220,151,.4); background: rgba(61,220,151,.06); }
`;

function QuestsEditor() {
  const { screenToFlowPosition, zoomTo, setCenter, fitView } = useReactFlow();

  /* ------------------------------------------------------------ */
  /* Zustand (lokal)                                               */
  /* ------------------------------------------------------------ */
  const [scriptSlots, setScriptSlots] = useState<SlotArt[]>(['init', 'interaktion']);
  const [nodes, setNodes, onNodesChange] = useNodesState<QuestFlowNode>(initialeKnoten(['init', 'interaktion']));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialeKanten());
  const [sicht, setSicht] = useState<EditorSicht>('graph');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('scripts');
  const [ausgewaehlteId, setAusgewaehlteId] = useState<string | null>(null);
  const [variablen, setVariablen] = useState<ProjektVariable[]>(initialeVariablen);
  const [variablenBlink, setVariablenBlink] = useState(false);
  const [scriptName, setScriptName] = useState('Lina — Begegnung');
  const [scriptBeschreibung, setScriptBeschreibung] = useState(
    'Begegnung mit Lina vor der Slumkirche: Vertrauen aufbauen, Hinterausgang freischalten.',
  );
  const [timerMs, setTimerMs] = useState(500);
  const [zoom, setZoom] = useState(100);
  const [aktiverBefund, setAktiverBefund] = useState<string | null>(null);
  const [hilfeOffen, setHilfeOffen] = useState(false);
  const [wizardOffen, setWizardOffen] = useState(false);
  const idZaehler = useRef(0);
  const befundTimeout = useRef<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  /* Schnellaktion (Home) öffnet den Wizard via location.state. */
  useEffect(() => {
    if ((location.state as { wizard?: boolean } | null)?.wizard) {
      setWizardOffen(true);
      navigate('.', { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dialogRefs = useMemo(
    () => demoDialoge.flatMap((d) => d.eintraege.map((e) => e.id)),
    [],
  );

  const ausgewaehlterKnoten = useMemo(
    () => nodes.find((n) => n.id === ausgewaehlteId) ?? null,
    [nodes, ausgewaehlteId],
  );

  /* ------------------------------------------------------------ */
  /* Knoten hinzufügen / löschen / duplizieren                     */
  /* ------------------------------------------------------------ */
  const knotenHinzufuegen = useCallback(
    (payload: PaletteDragPayload, position?: { x: number; y: number }) => {
      idZaehler.current += 1;
      const id = `n_neu_${idZaehler.current}`;
      const pos = position ?? screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const neu: QuestFlowNode = {
        id,
        type: 'quest',
        position: { x: pos.x - 90, y: pos.y - 24 },
        selected: true,
        data: {
          op: payload.op,
          kategorie: payload.kategorie,
          blockierend: payload.blockierend ?? vorlageBlockierend(payload.kategorie, payload.op),
          operanden: standardOperanden(payload.kategorie, payload.op),
          slots: scriptSlots,
          puls: null,
        },
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), neu]);
      setAusgewaehlteId(id);
    },
    [screenToFlowPosition, setNodes, scriptSlots],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      const payload = JSON.parse(raw) as PaletteDragPayload;
      knotenHinzufuegen(payload, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [knotenHinzufuegen, screenToFlowPosition],
  );

  const knotenLoeschen = useCallback(
    (id: string) => {
      const knoten = nodes.find((n) => n.id === id);
      if (!knoten) return;
      const betroffeneKanten = edges.filter((e) => e.source === id || e.target === id);
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setAusgewaehlteId(null);
      toast(`Knoten ${knoten.data.op} gelöscht`, {
        duration: 6000,
        action: {
          label: 'Rückgängig',
          onClick: () => {
            setNodes((ns) => [...ns, knoten]);
            setEdges((es) => [...es, ...betroffeneKanten]);
          },
        },
      });
    },
    [nodes, edges, setNodes, setEdges],
  );

  const knotenDuplizieren = useCallback(
    (id: string) => {
      const quelle = nodes.find((n) => n.id === id);
      if (!quelle) return;
      idZaehler.current += 1;
      const kopie: QuestFlowNode = {
        ...quelle,
        id: `n_neu_${idZaehler.current}`,
        position: { x: quelle.position.x + 40, y: quelle.position.y + 48 },
        selected: true,
        data: { ...quelle.data, operanden: { ...(quelle.data.operanden ?? {}) }, puls: null },
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), kopie]);
      setAusgewaehlteId(kopie.id);
    },
    [nodes, setNodes],
  );

  const operandAendern = useCallback(
    (knotenId: string, key: string, wert: string | number) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === knotenId
            ? { ...n, data: { ...n.data, operanden: { ...(n.data.operanden ?? {}), [key]: wert } } }
            : n,
        ),
      );
    },
    [setNodes],
  );

  /* ------------------------------------------------------------ */
  /* Variablen                                                     */
  /* ------------------------------------------------------------ */
  const variableAnlegen = useCallback((v: ProjektVariable) => {
    setVariablen((vs) => (vs.some((x) => x.name === v.name) ? vs : [...vs, v]));
  }, []);

  const variableQuickFix = useCallback(
    (name: string) => {
      variableAnlegen({
        name,
        typ: 'Zahl',
        wert: '0',
        bank: 1,
        adresse: Math.max(0, ...variablen.map((v) => v.adresse)) + 1,
      });
      setSidebarTab('scripts');
      setVariablenBlink(true);
      window.setTimeout(() => setVariablenBlink(false), 1300);
    },
    [variableAnlegen, variablen],
  );

  /* ------------------------------------------------------------ */
  /* Slots                                                         */
  /* ------------------------------------------------------------ */
  const toggleSlot = useCallback(
    (slot: SlotArt) => {
      setScriptSlots((alt) => {
        const neu = alt.includes(slot) ? alt.filter((s) => s !== slot) : [...alt, slot];
        setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, slots: neu } })));
        return neu;
      });
    },
    [setNodes],
  );

  /* ------------------------------------------------------------ */
  /* Kanten                                                        */
  /* ------------------------------------------------------------ */
  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      setEdges((es) =>
        addEdge(
          kantenBasis(`e-${params.source}-${params.target}-${es.length}`, params.source, params.target),
          es,
        ),
      );
    },
    [setEdges],
  );

  /* ------------------------------------------------------------ */
  /* Befund-Fokus (Klick → Knoten markieren, 2s Puls)              */
  /* ------------------------------------------------------------ */
  const befundFokus = useCallback(
    (b: LogikBefund) => {
      if (befundTimeout.current) window.clearTimeout(befundTimeout.current);
      setAktiverBefund(b.id);
      setSicht('graph');
      const ziel = b.knotenId ? nodes.find((n) => n.id === b.knotenId) : undefined;
      if (ziel) {
        setAusgewaehlteId(ziel.id);
        setNodes((ns) =>
          ns.map((n) => ({
            ...n,
            selected: n.id === ziel.id,
            data: { ...n.data, puls: n.id === ziel.id ? (b.analyse === 'Erreichbarkeit' ? 'rot' : 'mako') : null },
          })),
        );
        void setCenter(ziel.position.x + 90, ziel.position.y + 28, { zoom: 1.25, duration: 400 });
      }
      if (b.kantenId) {
        setEdges((es) =>
          es.map((e) =>
            e.id === b.kantenId
              ? { ...e, animated: true, style: { ...e.style, stroke: 'var(--warn)', strokeWidth: 2 } }
              : e,
          ),
        );
      }
      befundTimeout.current = window.setTimeout(() => {
        setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, puls: null } })));
        setEdges((es) => es.map((e) => ({ ...e, animated: false, style: { ...KANTEN_STIL } })));
        setAktiverBefund(null);
      }, 2000);
    },
    [nodes, setNodes, setEdges, setCenter],
  );

  useEffect(
    () => () => {
      if (befundTimeout.current) window.clearTimeout(befundTimeout.current);
    },
    [],
  );

  /* ------------------------------------------------------------ */
  /* Quest-Projektion                                              */
  /* ------------------------------------------------------------ */
  const projektionsMeilensteine: ProjektionsMeilenstein[] = useMemo(
    () =>
      demoMeilensteine.map((ms) => ({
        ...ms,
        knoten: ms.knotenIds
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is QuestFlowNode => Boolean(n))
          .map((n) => ({
            id: n.id,
            op: n.data.op,
            kategorie: n.data.kategorie as ScriptKategorie,
            blockierend: n.data.blockierend,
          })),
      })),
    [nodes],
  );

  const meilensteinKlick = useCallback(
    (ms: ProjektionsMeilenstein) => {
      setSicht('graph');
      const ids = new Set(ms.knoten.map((k) => k.id));
      setNodes((ns) => ns.map((n) => ({ ...n, selected: ids.has(n.id) })));
      setAusgewaehlteId(null);
      window.setTimeout(() => {
        void fitView({ nodes: ms.knoten.map((k) => ({ id: k.id })), duration: 400, padding: 0.3 });
      }, 60);
    },
    [fitView, setNodes],
  );

  /* ------------------------------------------------------------ */
  /* Vorlagen für leeren Canvas                                    */
  /* ------------------------------------------------------------ */
  const vorlageLaden = useCallback(
    (art: 'dialog' | 'trigger') => {
      const basis: { kategorie: ScriptKategorie; op: string }[] =
        art === 'dialog'
          ? [
              { kategorie: 'kontrollfluss', op: 'ENTRY' },
              { kategorie: 'dialog', op: 'MESSAGE' },
              { kategorie: 'dialog', op: 'ASK' },
              { kategorie: 'kontrollfluss', op: 'RET' },
            ]
          : [
              { kategorie: 'kontrollfluss', op: 'ENTRY' },
              { kategorie: 'variablen', op: 'LDA' },
              { kategorie: 'kontrollfluss', op: 'JMPF' },
              { kategorie: 'kontrollfluss', op: 'RET' },
            ];
      const neu: QuestFlowNode[] = basis.map((b, i) => ({
        id: `n_vl_${art}_${i}`,
        type: 'quest',
        position: { x: 120, y: 60 + i * 90 },
        data: {
          op: b.op,
          kategorie: b.kategorie,
          blockierend: vorlageBlockierend(b.kategorie, b.op),
          operanden: standardOperanden(b.kategorie, b.op),
          slots: scriptSlots,
          puls: null,
        },
      }));
      const neueKanten: Edge[] = neu
        .slice(0, -1)
        .map((n, i) => kantenBasis(`e-${n.id}-${neu[i + 1]!.id}`, n.id, neu[i + 1]!.id));
      setNodes(neu);
      setEdges(neueKanten);
    },
    [scriptSlots, setNodes, setEdges],
  );

  /* Wizard-first-Erzeugung (MS17): Neues Script — Kernwahl = Start-Vorlage.
     Defaults: Slots init + interaktion; erzeugter Graph ist sofort valide. */
  const wizardErstellen = useCallback(
    ({ name, kern }: { name: string; kern: string }) => {
      setScriptName(name);
      setScriptBeschreibung('');
      setAusgewaehlteId(null);
      if (kern === 'dialog') vorlageLaden('dialog');
      else if (kern === 'trigger') vorlageLaden('trigger');
      else {
        setNodes([]);
        setEdges([]);
      }
      setSidebarTab('scripts');
      setSicht('graph');
      toast(`„${name}" erstellt`, {
        description:
          kern === 'leer'
            ? 'Leerer Graph — ziehe Knoten aus der Palette.'
            : 'Vorlage geladen — Knoten sind frei editierbar.',
      });
    },
    [vorlageLaden, setNodes, setEdges],
  );

  /* Tastenkürzel-Hilfe per „?" */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ziel = e.target as HTMLElement;
      if (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA') return;
      if (e.key === '?') setHilfeOffen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scripts = useMemo(
    () => [{ name: scriptName || 'Lina — Begegnung', slots: scriptSlots, knotenzahl: nodes.length, aktiv: true }],
    [scriptName, scriptSlots, nodes.length],
  );

  /* ------------------------------------------------------------ */
  /* Render                                                        */
  /* ------------------------------------------------------------ */
  return (
    <div className="flex h-full min-h-0">
      <QuestSidebar
        tab={sidebarTab}
        onTab={setSidebarTab}
        sicht={sicht}
        onSicht={setSicht}
        scripts={scripts}
        variablen={variablen}
        onVariableAnlegen={variableAnlegen}
        variablenBlink={variablenBlink}
        onPaletteHinzufuegen={(p) => knotenHinzufuegen(p)}
        onNeuesScript={() => setWizardOffen(true)}
      />

      {/* Hauptbereich: Canvas bzw. Projektion + Logik-Befunde unten */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {sicht === 'graph' ? (
            <motion.div
              key="graph"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.28 }}
              className="quests-canvas absolute inset-0"
            >
              <style>{CANVAS_CSS}</style>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDrop={onDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onSelectionChange={({ nodes: sel }) =>
                  setAusgewaehlteId(sel.length === 1 ? (sel[0]?.id ?? null) : null)
                }
                onPaneClick={() => setAusgewaehlteId(null)}
                onMove={(_, vp) => setZoom(Math.round(vp.zoom * 100))}
                deleteKeyCode={['Backspace', 'Delete']}
                multiSelectionKeyCode="Shift"
                minZoom={0.25}
                maxZoom={2}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#1E2833" />
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-left"
                  style={{ width: 160, height: 110, background: 'var(--bg-panel)', opacity: 0.9 }}
                  maskColor="rgba(8,11,16,.72)"
                  nodeColor={(n) => ((n as QuestFlowNode).data?.blockierend ? '#FFB454' : '#2B3947')}
                />
              </ReactFlow>

              {/* Leerer Canvas: EmptyState zentral + Vorlagen-Chips */}
              {nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
                  <EmptyState
                    icon={Workflow}
                    titel="Leerer Script-Graph"
                    hinweis="Ziehe Knoten aus der Palette oder starte mit einer Vorlage."
                  />
                  <div className="pointer-events-auto -mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => vorlageLaden('dialog')}
                      className="rounded-md border border-mako/40 bg-mako-dim px-3 py-1.5 text-[12px] font-medium text-mako transition-colors duration-150 hover:bg-mako/20"
                    >
                      Dialog mit Verzweigung
                    </button>
                    <button
                      type="button"
                      onClick={() => vorlageLaden('trigger')}
                      className="rounded-md border border-subtle bg-panel px-3 py-1.5 text-[12px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                    >
                      Interaktions-Trigger
                    </button>
                  </div>
                </div>
              )}

              {/* ZoomControls unten rechts */}
              <ZoomControls
                className="absolute bottom-3 right-3 z-10"
                zoom={zoom}
                onZoomChange={(z) => void zoomTo(z / 100, { duration: 150 })}
                onEinpassen={() => void fitView({ duration: 300, padding: 0.2 })}
                min={25}
                max={200}
              />

              {/* Tastenkürzel-Hilfe */}
              <button
                type="button"
                onClick={() => setHilfeOffen(true)}
                className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-subtle bg-panel/90 text-secondary backdrop-blur transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                aria-label="Tastenkürzel-Hilfe"
                title="Tastenkürzel (?)"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="quest"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.28 }}
              className="absolute inset-0"
            >
              <QuestProjektion meilensteine={projektionsMeilensteine} onKarteKlick={meilensteinKlick} />
            </motion.div>
          )}
        </div>

        <LogikBefunde befunde={demoLogikBefunde} aktivId={aktiverBefund} onFokus={befundFokus} />
      </div>

      <QuestInspektor
        knoten={ausgewaehlterKnoten}
        variablen={variablen}
        dialogRefs={dialogRefs}
        scriptName={scriptName}
        onScriptName={setScriptName}
        scriptBeschreibung={scriptBeschreibung}
        onScriptBeschreibung={setScriptBeschreibung}
        scriptId={SCRIPT_ID}
        scriptSlots={scriptSlots}
        onToggleSlot={toggleSlot}
        timerMs={timerMs}
        onTimerMs={setTimerMs}
        onOperandAendern={operandAendern}
        onKnotenLoeschen={knotenLoeschen}
        onKnotenDuplizieren={knotenDuplizieren}
        onVariableQuickFix={variableQuickFix}
      />

      {/* Wizard-first-Erzeugung (MS17): Neues Script */}
      <WizardDialog
        offen={wizardOffen}
        onOpenChange={setWizardOffen}
        titel="Neues Script"
        icon={Workflow}
        nameVorschlag="Neues Script"
        idVorschau={(n) => `mod:de.beispiel.nebenquest/scripts/${wizardSlug(n)}`}
        kernTitel="Womit soll der Graph starten?"
        kernOptionen={[
          { id: 'dialog', label: 'Dialog-Szene', beschreibung: 'Vorlage: Nachricht + Verzweigung (ASK) — sofort valide.', icon: MessagesSquare },
          { id: 'trigger', label: 'Interaktions-Trigger', beschreibung: 'Vorlage: Variable lesen, bedingter Sprung.', icon: MousePointerClick },
          { id: 'leer', label: 'Leer beginnen', beschreibung: 'Leerer Canvas — Knoten aus der Palette ziehen.', icon: FilePlus2 },
        ]}
        defaultsFuer={() => [
          { label: 'Slots', wert: 'init + interaktion' },
          { label: 'Auslöser', wert: 'Init-Slot' },
        ]}
        onErstellen={wizardErstellen}
      />

      <Dialog open={hilfeOffen} onOpenChange={setHilfeOffen}>
        <DialogContent className="border-subtle bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-[15px]">Tastenkürzel</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 text-[12px]">
            {[
              ['Ziehen aus der Palette / Doppelklick', 'Knoten hinzufügen'],
              ['Entf / Rücktaste', 'Auswahl löschen'],
              ['Shift + Klick', 'Mehrfachauswahl'],
              ['Ziehen auf leerer Fläche', 'Canvas verschieben'],
              ['Strg + Mausrad', 'Zoom (25–200 %)'],
              ['?', 'Diese Hilfe ein-/ausblenden'],
            ].map(([kuerzel, aktion]) => (
              <div key={kuerzel} className="flex items-center justify-between gap-4">
                <kbd className="rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[10px] text-secondary">
                  {kuerzel}
                </kbd>
                <span className="text-secondary">{aktion}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function QuestsPage() {
  return (
    <ReactFlowProvider>
      <LayoutGroup>
        <QuestsEditor />
      </LayoutGroup>
    </ReactFlowProvider>
  );
}
