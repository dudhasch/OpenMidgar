import { describe, expect, it } from 'vitest';
import { defaultBindings } from './bindings.js';
import { GamepadFeed, KeyboardFeed, TouchFeed } from './sources.js';
import { InputSampler } from './sampler.js';
import { DEFAULT_TOUCH_LAYOUT, resolveTouchLayout, type Viewport } from './layout.js';

/**
 * Sampler-Fixtures (S27): Flanken entstehen aus der Tick-Differenz, nicht aus
 * Events; Quellen werden je Tick genau einmal abgetastet; reservierte
 * Kontexte liefern die leere Abtastung; Verbindungswechsel eines Gamepads
 * mitten im Lauf erzeugt saubere Flanken (die „falsche Suchmenge"-Grenze der
 * Abnahme: genau dieser Fall liegt sonst außerhalb jedes Tests).
 */

const VIEWPORT: Viewport = { width: 800, height: 480, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };

describe('InputSampler — Flanken und Verschmelzung', () => {
  it('bildet pressed/held/released aus dem Vergleich zweier Tick-Abtastungen', () => {
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(defaultBindings(), [kb]);

    kb.handleKey('Enter', true);
    const t1 = sampler.sampleTick();
    expect(t1.pressed).toEqual(['ok']);
    expect(t1.held).toEqual(['ok']);
    expect(t1.released).toEqual([]);

    const t2 = sampler.sampleTick();
    expect(t2.pressed).toEqual([]);
    expect(t2.held).toEqual(['ok']);

    kb.handleKey('Enter', false);
    const t3 = sampler.sampleTick();
    expect(t3.held).toEqual([]);
    expect(t3.released).toEqual(['ok']);
  });

  it('macht ein Ereignis ZWISCHEN zwei Ticks unsichtbar — was der Takt nicht sieht, existiert nicht', () => {
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(defaultBindings(), [kb]);
    sampler.sampleTick();
    // Taste kurz gedrückt und vor der nächsten Abtastung wieder losgelassen:
    kb.handleKey('Enter', true);
    kb.handleKey('Enter', false);
    const t = sampler.sampleTick();
    expect(t.pressed).toEqual([]);
    expect(t.held).toEqual([]);
  });

  it('leitet Richtungsaktionen aus der finalen Achse ab — Stick und Pfeiltaste erzeugen denselben Rahmen', () => {
    const kb = new KeyboardFeed();
    const kbSampler = new InputSampler(defaultBindings(), [kb]);
    kb.handleKey('ArrowRight', true);
    const kbFrame = kbSampler.sampleTick();

    const gp = new GamepadFeed();
    const gpSampler = new InputSampler(defaultBindings(), [gp]);
    gp.setConnected(true);
    gp.setState({ buttons: [], axes: [1, 0] });
    const gpFrame = gpSampler.sampleTick();

    expect(gpFrame.held).toEqual(kbFrame.held);
    expect(gpFrame.axisX).toBe(kbFrame.axisX);
    expect(gpFrame.axisY).toBe(kbFrame.axisY);
  });

  it('invertiert die Gamepad-Y-Achse laut Belegungsdatum (Stick oben ⇒ Aktion up, +y)', () => {
    const gp = new GamepadFeed();
    const sampler = new InputSampler(defaultBindings(), [gp]);
    gp.setConnected(true);
    gp.setState({ buttons: [], axes: [0, -1] }); // Stick nach oben = Rohwert −1
    const frame = sampler.sampleTick();
    expect(frame.axisY).toBeGreaterThan(0);
    expect(frame.held).toEqual(['up']);
  });

  it('Gegenrichtungen heben sich auf und erzeugen KEINE Richtungsaktion', () => {
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(defaultBindings(), [kb]);
    kb.handleKey('ArrowLeft', true);
    kb.handleKey('ArrowRight', true);
    const frame = sampler.sampleTick();
    expect(frame.axisX).toBe(0);
    expect(frame.held).toEqual([]);
  });

  it('liefert im reservierten Kontext die leere Abtastung und schließt offene Aktionen mit released ab', () => {
    const kb = new KeyboardFeed();
    const sampler = new InputSampler(defaultBindings(), [kb]);
    kb.handleKey('Enter', true);
    sampler.sampleTick();
    sampler.setContext('battle'); // reserviert (null)
    const t = sampler.sampleTick();
    expect(t.held).toEqual([]);
    expect(t.released).toEqual(['ok']);
  });
});

describe('InputSampler — Gamepad-Lebenszyklus', () => {
  it('Trennung mitten im Lauf lässt Aktionen am nächsten Tick los; Wiederverbindung nimmt sie wieder auf', () => {
    const gp = new GamepadFeed();
    const sampler = new InputSampler(defaultBindings(), [gp]);
    gp.setConnected(true);
    gp.setState({ buttons: [true], axes: [0, 0] }); // Knopf 0 = ok
    expect(sampler.sampleTick().held).toEqual(['ok']);

    gp.setConnected(false);
    const afterDisconnect = sampler.sampleTick();
    expect(afterDisconnect.held).toEqual([]);
    expect(afterDisconnect.released).toEqual(['ok']);

    // Zustand VOR der Wiederverbindung wird verworfen, nicht eingefroren.
    gp.setState({ buttons: [true], axes: [0, 0] });
    expect(sampler.sampleTick().held).toEqual([]);

    gp.setConnected(true);
    gp.setState({ buttons: [true], axes: [0, 0] });
    const afterReconnect = sampler.sampleTick();
    expect(afterReconnect.pressed).toEqual(['ok']);
  });
});

describe('InputSampler — Touch', () => {
  it('tastet Zeiger gegen das aufgelöste Layout ab (Steuerkreuz rechts ⇒ Aktion right)', () => {
    const controls = resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, VIEWPORT);
    const right = controls.find((c) => c.id === 'dpad-right')!;
    const touch = new TouchFeed(controls);
    const sampler = new InputSampler(defaultBindings(), [touch]);
    touch.pointerDown(1, right.x + right.width / 2, right.y + right.height / 2);
    const frame = sampler.sampleTick();
    expect(frame.held).toEqual(['right']);
    expect(frame.axisX).toBeGreaterThan(0);
    touch.pointerUp(1);
    expect(sampler.sampleTick().released).toEqual(['right']);
  });
});
