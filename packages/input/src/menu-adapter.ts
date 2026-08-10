import type { ActionFrame } from './actions.js';

/**
 * Brücke Aktionsstrom → menüartige Sitzungen (Hauptmenü, Kampf-Kommandowahl).
 *
 * Dieselbe Bauform wie `field-adapter.ts`: input bildet nur ab. Und wie dort
 * gilt die Abhängigkeitsrichtung — input darf NICHT von menu abhängen, deshalb
 * ist die Eingabeform hier als EIGENES strukturelles Interface dupliziert
 * (strukturgleich zu `MenuInput` aus `packages/menu/src/session.ts`; die
 * Verträglichkeit prüft der Test, nicht ein Import).
 *
 * Pegel statt Flanken: Menü- und Kampfsitzungen werten die Flanken selbst
 * (Vergleich mit dem Vor-Tick) — hier wird deshalb `held` durchgereicht, nie
 * `pressed`. Die Richtungsaktionen sind im Sampler bereits aus der FINALEN
 * Achse normalisiert (Stick und Pfeiltaste erzeugen denselben Rahmen).
 */
export interface MenuInputFrame {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
  toggle: boolean;
}

export function toMenuInput(frame: ActionFrame): MenuInputFrame {
  return {
    up: frame.held.includes('up'),
    down: frame.held.includes('down'),
    left: frame.held.includes('left'),
    right: frame.held.includes('right'),
    confirm: frame.held.includes('ok'),
    cancel: frame.held.includes('cancel'),
    toggle: frame.held.includes('menu'),
  };
}
