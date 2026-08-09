import { describe, expect, it } from 'vitest';
import {
  composeFieldContainer,
  composeMaplist,
  composeTriggersSection,
  composeWalkmeshSection,
  type TriggersSpec,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer, parseMaplist, type FieldBundle } from '@webmidgar/formats-field';
import { FieldSession } from './session.js';
import { planTransition, resolveGatewayTarget } from './transition.js';

/**
 * S11: Field-Wechsel. Die Zielfield-Nummer kommt aus der `maplist`, die
 * Ankunftsposition aus dem Gegen-Gateway des Zielfields — der Zielpunkt im
 * Record ist realdaten-seitig widerlegt und wird bewusst nicht benutzt.
 */

const rect = (x0: number, y0: number, x1: number, y1: number): WalkmeshSpec => ({
  triangles: [
    { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]] },
    { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]] },
  ],
});

function bundle(fieldId: string, walkmesh: WalkmeshSpec, triggers: TriggersSpec): FieldBundle {
  const layout = composeFieldContainer({
    sections: { 5: composeWalkmeshSection(walkmesh), 8: composeTriggersSection(triggers) },
  });
  const result = parseFieldContainer(layout.bytes, fieldId);
  if (!result.ok || !result.bundle) throw new Error('Fixture nicht parsebar');
  return result.bundle;
}

/**
 * Zwei Fields, die über je ein Gateway aufeinander zeigen.
 * A liegt bei x 0…600, B bei x 0…600 — die Rückkante in B steht bei x = 100.
 */
function pairFixture(): { maplistBytes: Uint8Array; a: FieldBundle; b: FieldBundle } {
  const names = ['felda', 'feldb'];
  const a = bundle('felda', rect(0, 0, 600, 400), {
    name: 'a',
    // Zeigt auf Index 1 = feldb.
    gateways: [{ exitLine: [[500, -200, 0], [500, 600, 0]], destMaplistIndex: 1 }],
  });
  const b = bundle('feldb', rect(0, 0, 600, 400), {
    name: 'b',
    // Rückkante bei x = 100, zeigt auf Index 0 = felda.
    gateways: [{ exitLine: [[100, -200, 0], [100, 600, 0]], destMaplistIndex: 0 }],
  });
  return { maplistBytes: composeMaplist(names), a, b };
}

describe('Field-Wechsel', () => {
  it('löst den Zielfieldnamen über den maplist-Index auf', () => {
    const { maplistBytes } = pairFixture();
    const maplist = parseMaplist(maplistBytes, 'maplist', [])!;
    expect(resolveGatewayTarget({ gatewayIndex: 0, destMaplistIndex: 1 }, maplist)).toBe('feldb');
    expect(resolveGatewayTarget({ gatewayIndex: 0, destMaplistIndex: 9 }, maplist)).toBeNull();
  });

  it('setzt die Ankunft neben das Gegen-Gateway, nicht darauf', () => {
    const { maplistBytes, a, b } = pairFixture();
    const maplist = parseMaplist(maplistBytes, 'maplist', [])!;
    const plan = planTransition({ gatewayIndex: 0, destMaplistIndex: 1 }, maplist, b, a.fieldId)!;
    expect(plan.targetField).toBe('feldb');
    expect(plan.returnGatewayIndex).toBe(0);
    expect(plan.arrival).not.toBeNull();
    // Neben der Linie bei x = 100, nicht darauf — sonst feuerte sie sofort.
    expect(Math.abs(plan.arrival!.x - 100)).toBeGreaterThan(1);
    // Und im begehbaren Bereich.
    const session = new FieldSession(b, { runScript: false, start: plan.arrival! });
    expect(session.player).not.toBeNull();
  });

  it('die Ankunft löst beim ersten Schritt kein Gateway aus', () => {
    const { maplistBytes, a, b } = pairFixture();
    const maplist = parseMaplist(maplistBytes, 'maplist', [])!;
    const plan = planTransition({ gatewayIndex: 0, destMaplistIndex: 1 }, maplist, b, a.fieldId)!;
    for (const [mx, my] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const session = new FieldSession(b, { runScript: false, start: plan.arrival! });
      const result = session.tick({ moveX: mx, moveY: my, confirm: false, cancel: false });
      expect(result.fieldChange, `Richtung ${mx},${my}`).toBeNull();
    }
  });

  it('meldet fehlendes Gegen-Gateway, statt zu raten', () => {
    const { maplistBytes, a } = pairFixture();
    const maplist = parseMaplist(maplistBytes, 'maplist', [])!;
    // Zielfield ohne jedes Gateway.
    const lonely = bundle('feldb', rect(0, 0, 600, 400), { name: 'b' });
    const plan = planTransition({ gatewayIndex: 0, destMaplistIndex: 1 }, maplist, lonely, a.fieldId)!;
    expect(plan.targetField).toBe('feldb');
    expect(plan.returnGatewayIndex).toBeNull();
    expect(plan.arrival).toBeNull();
    expect(plan.reason).toContain('Gegen-Gateway');
  });

  it('meldet ungeladenes Zielfield ohne Ausnahme', () => {
    const { maplistBytes, a } = pairFixture();
    const maplist = parseMaplist(maplistBytes, 'maplist', [])!;
    const plan = planTransition({ gatewayIndex: 0, destMaplistIndex: 1 }, maplist, null, a.fieldId)!;
    expect(plan.targetField).toBe('feldb');
    expect(plan.arrival).toBeNull();
    expect(plan.reason).toBe('Zielfield nicht geladen');
  });
});
