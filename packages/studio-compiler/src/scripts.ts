/**
 * Script-Graph-Analyse und -Assemblierung (B.3, C.2): der typisierte
 * Graph wird in eine deterministische Mnemonic-Op-Liste übersetzt
 * (topologisch sortiert, Sprungziele auf Knoten-IDs aufgelöst) und auf
 * Erreichbarkeit sowie Wartezyklen geprüft. Die Semantik der einzelnen
 * Mnemonics validiert später der geteilte Script-Assembler (MS4);
 * hier liegt nur die Graph-Ebene.
 */

import type { ScriptEdge, ScriptGraphDoc, ScriptNode } from '@webmidgar/studio-core';

/** Ausgehende Kanten je Knoten, deterministisch sortiert (zu, bedingung). */
export function outgoingEdges(doc: ScriptGraphDoc): Map<string, ScriptEdge[]> {
  const out = new Map<string, ScriptEdge[]>();
  const sorted = [...doc.kanten].sort(
    (a, b) => a.von.localeCompare(b.von) || a.zu.localeCompare(b.zu) || (a.bedingung ?? '').localeCompare(b.bedingung ?? ''),
  );
  for (const kante of sorted) {
    const list = out.get(kante.von) ?? [];
    list.push(kante);
    out.set(kante.von, list);
  }
  return out;
}

/** Eingehende Kantenzahl je Knoten-ID. */
export function incomingCounts(doc: ScriptGraphDoc): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of doc.knoten) counts.set(n.id, 0);
  for (const k of doc.kanten) {
    if (counts.has(k.zu)) counts.set(k.zu, (counts.get(k.zu) ?? 0) + 1);
  }
  return counts;
}

/**
 * Startknoten-Bestimmung: der lexikografisch erste Knoten ohne
 * eingehende Kante; existiert keiner (reiner Zyklus), der erste Knoten
 * nach ID (der Validator meldet den fehlenden Start separat).
 */
export function startKnoten(doc: ScriptGraphDoc): ScriptNode | null {
  if (doc.knoten.length === 0) return null;
  const incoming = incomingCounts(doc);
  const kandidaten = doc.knoten.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id).sort();
  const id = kandidaten[0] ?? [...doc.knoten.map((n) => n.id)].sort()[0]!;
  return doc.knoten.find((n) => n.id === id) ?? null;
}

/** Vom Startknoten erreichbare Knoten-IDs (BFS, deterministisch). */
export function erreichbareKnoten(doc: ScriptGraphDoc): Set<string> {
  const start = startKnoten(doc);
  const out = outgoingEdges(doc);
  const seen = new Set<string>();
  if (start === null) return seen;
  const queue = [start.id];
  seen.add(start.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const kante of out.get(id) ?? []) {
      if (!seen.has(kante.zu)) {
        seen.add(kante.zu);
        queue.push(kante.zu);
      }
    }
  }
  return seen;
}

/**
 * Zyklen, in denen alle Knoten blockierend sind (Wartezyklen-Heuristik,
 * einfach: SCC per Tarjan; SCC mit > 1 Knoten oder Selbstkante, in dem
 * jeder Knoten blockierend ist, gilt als Wartezyklus).
 */
export function wartezyklen(doc: ScriptGraphDoc): string[][] {
  const out = outgoingEdges(doc);
  const byId = new Map(doc.knoten.map((n) => [n.id, n]));
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  const strongconnect = (v: string): void => {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const kante of out.get(v) ?? []) {
      const w = kante.zu;
      if (!byId.has(w)) continue;
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc.sort());
    }
  };

  for (const id of [...byId.keys()].sort()) {
    if (!index.has(id)) strongconnect(id);
  }

  return sccs
    .filter((scc) => {
      const zyklisch =
        scc.length > 1 || (out.get(scc[0]!) ?? []).some((k) => k.zu === scc[0]);
      if (!zyklisch) return false;
      return scc.every((id) => byId.get(id)?.blockierend === true);
    })
    .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}

/**
 * Deterministische topologische Sortierung (Kahn, Gleichstand nach
 * Knoten-ID). Knoten in Zyklen, die Kahn nicht abbaut, werden stabil
 * nach ID angehängt — die Assemblierung bleibt total.
 */
export function topologischeReihenfolge(doc: ScriptGraphDoc): ScriptNode[] {
  const byId = new Map(doc.knoten.map((n) => [n.id, n]));
  const out = outgoingEdges(doc);
  const indeg = incomingCounts(doc);
  const bereit = doc.knoten
    .filter((n) => (indeg.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
    .sort();
  const reihenfolge: ScriptNode[] = [];
  const besucht = new Set<string>();
  while (bereit.length > 0) {
    const id = bereit.shift()!;
    if (besucht.has(id)) continue;
    besucht.add(id);
    reihenfolge.push(byId.get(id)!);
    const neu: string[] = [];
    for (const kante of out.get(id) ?? []) {
      if (!byId.has(kante.zu)) continue;
      const rest = (indeg.get(kante.zu) ?? 0) - 1;
      indeg.set(kante.zu, rest);
      if (rest === 0) neu.push(kante.zu);
    }
    if (neu.length > 0) {
      bereit.push(...neu);
      bereit.sort();
    }
  }
  // Rest (Zyklusknoten) stabil anhängen.
  const rest = [...byId.keys()].filter((id) => !besucht.has(id)).sort();
  for (const id of rest) reihenfolge.push(byId.get(id)!);
  return reihenfolge;
}

function operandenSuffix(node: ScriptNode): string {
  const ops = node.operanden;
  if (!ops) return '';
  const teile = Object.keys(ops)
    .sort()
    .map((k) => `${k}=${String(ops[k])}`);
  return teile.length > 0 ? ` ${teile.join(' ')}` : '';
}

/**
 * Assembliert den Graph zur Mnemonic-Payload: eine Op-Zeile je Knoten
 * in topologischer Reihenfolge; ausgehende Kanten werden als Sprünge
 * auf Knoten-IDs aufgelöst — unbedingte Kante auf den direkt folgenden
 * Knoten ist impliziter Fallthrough und erzeugt keine Zeile.
 */
export function assembleScript(doc: ScriptGraphDoc): string[] {
  const reihenfolge = topologischeReihenfolge(doc);
  const out = outgoingEdges(doc);
  const byId = new Set(doc.knoten.map((n) => n.id));
  const zeilen: string[] = [];
  reihenfolge.forEach((node, i) => {
    zeilen.push(`${node.id}: ${node.op}${operandenSuffix(node)}`);
    const naechster = reihenfolge[i + 1];
    for (const kante of out.get(node.id) ?? []) {
      if (!byId.has(kante.zu)) continue; // toter Sprung: Validator meldet die Kante
      if (kante.bedingung === undefined && naechster !== undefined && kante.zu === naechster.id) continue;
      const bedingung = kante.bedingung !== undefined ? ` wenn ${kante.bedingung}` : '';
      zeilen.push(`${node.id} -> ${kante.zu}${bedingung}`);
    }
  });
  return zeilen;
}
