import { describe, expect, it } from 'vitest';
import {
  composeFieldContainer,
  composeWalkmeshSection,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer, type FieldBundle } from '@webmidgar/formats-field';
import { FieldSession } from '@webmidgar/field-runtime';
import { defaultBindings } from './bindings.js';
import { GamepadFeed, KeyboardFeed, TouchFeed } from './sources.js';
import { InputSampler } from './sampler.js';
import { ActionRecorder, inputTicksDigest, recordingDigest, shiftRecording, type ActionRecording } from './recording.js';
import { fieldInputPlan, toFieldInput } from './field-adapter.js';
import { DEFAULT_TOUCH_LAYOUT, resolveTouchLayout, type ResolvedControl, type Viewport } from './layout.js';

/**
 * DER zentrale S27-Nachweis (ROADMAP-S27-S36, Akzeptanzkriterien):
 *
 * Kontrollhypothese „die Quelle ist irrelevant": Dieselbe semantische
 * Eingabefolge wird aus Tastatur-, Gamepad- und Touch-Ereignissen erzeugt —
 * die Digests (Aktionsstrom UND FieldSession) müssen identisch sein.
 *
 * Gegenprobe gegen die blinde Gütefunktion: Ein um einen Takt verschobener
 * Strom MUSS einen anderen Digest liefern. Ohne diese Gegenprobe wäre die
 * Gleichheit wertlos — ein Digest, der die Eingabewirkung gar nicht enthält,
 * wäre gegen Quelle und Verschiebung gleichermaßen invariant und trivial grün.
 * Damit die Verschiebung auch die SESSION treffen kann, läuft die Bewegung
 * bis zum letzten Takt der Aufzeichnung: Der verschobene Strom verliert
 * seinen letzten Bewegungstakt und endet auf einer anderen Position.
 *
 * Nullwert-Zweitrechnung: Die Gleichheit wird zusätzlich NUR über die Takte
 * mit tatsächlicher Eingabe gerechnet („keine Eingabe" ist trivial
 * deterministisch) — und die Anzahl dieser Takte muss > 0 sein.
 */

const TICKS = 30;

function flatGrid(nx: number, ny: number, cell: number): WalkmeshSpec {
  const triangles: WalkmeshSpec['triangles'] = [];
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const x0 = gx * cell;
      const x1 = (gx + 1) * cell;
      const y0 = gy * cell;
      const y1 = (gy + 1) * cell;
      triangles.push(
        { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]] },
        { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]] },
      );
    }
  }
  return { triangles };
}

function buildBundle(): FieldBundle {
  const layout = composeFieldContainer({ sections: { 5: composeWalkmeshSection(flatGrid(6, 6, 100)) } });
  const result = parseFieldContainer(layout.bytes, 'input-fx');
  if (!result.ok || !result.bundle) throw new Error('Fixture nicht parsebar');
  return result.bundle;
}

/**
 * Der Sollverlauf als Gerätefahrplan: rechts in 1–10, OK in 12–13, rechts in
 * 15–30 (bis zum LETZTEN Takt — s. Kopfkommentar). Jede Quelle setzt diesen
 * Fahrplan mit ihren eigenen Mitteln um.
 */
interface Run {
  recording: ActionRecording;
  sessionDigest: string;
}

function runWith(
  apply: (tick: number) => void,
  sampler: InputSampler,
  recorder: ActionRecorder,
): Run {
  const session = new FieldSession(buildBundle(), { start: { x: 250, y: 250 } });
  for (let t = 1; t <= TICKS; t++) {
    apply(t);
    const frame = sampler.sampleTick();
    recorder.record(frame);
    session.tick(toFieldInput(frame));
  }
  return { recording: recorder.finish(), sessionDigest: session.digest() };
}

function keyboardRun(): Run {
  const kb = new KeyboardFeed();
  const sampler = new InputSampler(defaultBindings(), [kb]);
  return runWith(
    (t) => {
      if (t === 1) kb.handleKey('ArrowRight', true);
      if (t === 11) kb.handleKey('ArrowRight', false);
      if (t === 12) kb.handleKey('Space', true);
      if (t === 14) kb.handleKey('Space', false);
      if (t === 15) kb.handleKey('ArrowRight', true);
    },
    sampler,
    new ActionRecorder(['keyboard']),
  );
}

function gamepadRun(shiftBy = 0): Run {
  const gp = new GamepadFeed();
  const sampler = new InputSampler(defaultBindings(), [gp]);
  gp.setConnected(true);
  return runWith(
    (t0) => {
      const t = t0 - shiftBy;
      const move = (t >= 1 && t <= 10) || t >= 15;
      const ok = t === 12 || t === 13;
      gp.setState({ buttons: [ok], axes: [move ? 1 : 0, 0] });
    },
    sampler,
    new ActionRecorder(['gamepad']),
  );
}

function touchRun(): Run {
  const viewport: Viewport = { width: 800, height: 480, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };
  const controls: ResolvedControl[] = resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, viewport);
  const center = (id: string): { x: number; y: number } => {
    const c = controls.find((k) => k.id === id)!;
    return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  };
  const touch = new TouchFeed(controls);
  const sampler = new InputSampler(defaultBindings(), [touch]);
  const dpadRight = center('dpad-right');
  const ok = center('btn-ok');
  return runWith(
    (t) => {
      if (t === 1) touch.pointerDown(1, dpadRight.x, dpadRight.y);
      if (t === 11) touch.pointerUp(1);
      if (t === 12) touch.pointerDown(2, ok.x, ok.y);
      if (t === 14) touch.pointerUp(2);
      if (t === 15) touch.pointerDown(3, dpadRight.x, dpadRight.y);
    },
    sampler,
    new ActionRecorder(['touch']),
  );
}

describe('S27 — Dreifach-Replay über Tastatur, Gamepad und Touch', () => {
  it('liefert quellunabhängig identische Strom- und Session-Digests; die Quelle bleibt Metadatum', () => {
    const kb = keyboardRun();
    const gp = gamepadRun();
    const tc = touchRun();

    // Aktionsstrom: bitgleich über alle drei Quellen.
    const d1 = recordingDigest(kb.recording);
    expect(recordingDigest(gp.recording)).toBe(d1);
    expect(recordingDigest(tc.recording)).toBe(d1);

    // Sitzung: bitgleich über alle drei Quellen.
    expect(gp.sessionDigest).toBe(kb.sessionDigest);
    expect(tc.sessionDigest).toBe(kb.sessionDigest);

    // Die Herkunft ist unterscheidbar — aber nur als Metadatum.
    expect(kb.recording.meta.sourceKinds).toEqual(['keyboard']);
    expect(gp.recording.meta.sourceKinds).toEqual(['gamepad']);
    expect(tc.recording.meta.sourceKinds).toEqual(['touch']);
  });

  it('Nullwert-Zweitrechnung: Gleichheit gilt auch NUR über die Takte mit Eingabe, und davon gibt es welche', () => {
    const kb = inputTicksDigest(keyboardRun().recording);
    const gp = inputTicksDigest(gamepadRun().recording);
    expect(kb.inputTicks).toBeGreaterThan(0);
    expect(gp.inputTicks).toBe(kb.inputTicks);
    expect(gp.digest).toBe(kb.digest);
  });

  it('Gegenprobe: ein um einen Takt verschobener Strom ändert Strom- UND Session-Digest', () => {
    const original = gamepadRun();
    const shifted = gamepadRun(1);
    expect(recordingDigest(shifted.recording)).not.toBe(recordingDigest(original.recording));
    expect(shifted.sessionDigest).not.toBe(original.sessionDigest);
  });

  it('shiftRecording (Werkzeugweg der Gegenprobe) ändert den Stromdigest ebenfalls', () => {
    const rec = gamepadRun().recording;
    expect(recordingDigest(shiftRecording(rec, 1))).not.toBe(recordingDigest(rec));
  });

  it('Replay einer Aufzeichnung reproduziert den Session-Digest bitidentisch — ohne die Belegung zu kennen', () => {
    const kb = keyboardRun();
    const plan = fieldInputPlan(kb.recording);
    const session = new FieldSession(buildBundle(), { start: { x: 250, y: 250 } });
    for (let t = 1; t <= kb.recording.ticks; t++) session.tick(plan(t));
    expect(session.digest()).toBe(kb.sessionDigest);
  });

  it('Belegungsänderung ist im Replay wirkungsfrei: andere Taste, gleiche Aktion, gleicher Digest', () => {
    // Umbelegte Tastatur: KeyL löst `right` aus, KeyJ löst `ok` aus.
    const bindings = defaultBindings();
    bindings.field!.keyboard = { KeyL: 'right', KeyJ: 'ok' };
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(bindings, [kb]);
    const remapped = runWith(
      (t) => {
        if (t === 1) kb.handleKey('KeyL', true);
        if (t === 11) kb.handleKey('KeyL', false);
        if (t === 12) kb.handleKey('KeyJ', true);
        if (t === 14) kb.handleKey('KeyJ', false);
        if (t === 15) kb.handleKey('KeyL', true);
      },
      sampler,
      new ActionRecorder(['keyboard']),
    );
    const reference = keyboardRun();
    expect(recordingDigest(remapped.recording)).toBe(recordingDigest(reference.recording));
    expect(remapped.sessionDigest).toBe(reference.sessionDigest);
  });
});
