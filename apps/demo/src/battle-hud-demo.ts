/**
 * Sichtnachweis für K6/N7 — Kampf-HUD und Ergebnisbildschirm auf einer
 * 640×480-Fläche, unskaliert, mit denselben Zahlen wie die Referenzaufnahmen.
 *
 * 🔵 Warum eine eigene Seite und nicht nur `game.html`: Der Vergleich mit dem
 * Original braucht eine Fläche OHNE 3D-Bühne und ohne Ladeabhängigkeiten —
 * so ist das HUD deterministisch und lässt sich Pixel für Pixel gegen
 * `apps/demo/.shots/ref/…` legen. Dieselbe Rolle, die `window-skin.html` für
 * die Fensterschale spielt.
 *
 * Der Bericht unten nennt die berechneten Kanten neben den am Original
 * abgelesenen — wer die Seite öffnet, sieht die Abweichung als ZAHL und muss
 * sie nicht schätzen.
 */

import {
  ATB_MAX,
  DEFAULT_COMMANDS,
  HUD_COMMAND_WINDOW,
  HUD_GAUGE_WINDOW,
  HUD_STATUS_WINDOW,
  domPaintHost,
  hudBoxes,
  paintBoxes,
  resultBoxes,
  resultMessages,
  type HudModel,
  type ResultScreenModel,
} from '@webmidgar/ui-battle-hud';

const $ = (id: string) => document.getElementById(id)!;
const hudHost = domPaintHost($('hud') as unknown as Parameters<typeof domPaintHost>[0]);
const resultHost = domPaintHost($('result') as unknown as Parameters<typeof domPaintHost>[0]);

let atbVoll = false;
let kommando = false;
let treffer = false;

/** Zahlen aus `20260810223335_1.jpg`: Cloud allein, HP 287/302, MP 54. */
function modell(): HudModel {
  const model: HudModel = {
    members: [
      {
        id: 'cloud',
        name: 'Ex-SOLDIER',
        hp: 287,
        maxHp: 302,
        mp: 54,
        maxMp: 54,
        atb: atbVoll ? ATB_MAX : Math.round(ATB_MAX * 0.36),
        alive: true,
        awaiting: atbVoll,
        limit: 96,
      },
    ],
    message: kommando ? '' : 'Machine Gun',
    command: kommando ? { entries: DEFAULT_COMMANDS, selected: 0, row: 0 } : null,
    floaters: treffer
      ? [{ actorId: 'cloud', text: '4', kind: 'damage', progress: 0.3, anchor: { x: 520, y: 230 } }]
      : [],
    effectCoverage: { covered: 0, substituted: 3 },
  };
  return model;
}

/** Zahlen aus `20260810223347_1.jpg` bzw. `…223349_1.jpg` (LEVEL UP). */
const ergebnis: ResultScreenModel = {
  messages: resultMessages(0, []),
  page: 0,
  gainedExp: 32,
  gainedAp: 4,
  members: [{ name: 'Ex-SOLDIER', level: 7, exp: 642, toNextLevel: 307, levelProgress: 0.12, levelsGained: 1 }],
};

function bericht(): string {
  const gemessen: [string, number[], number[]][] = [
    [
      'linkes HUD-Fenster',
      [HUD_STATUS_WINDOW.x, HUD_STATUS_WINDOW.y, HUD_STATUS_WINDOW.x + HUD_STATUS_WINDOW.w - 1, HUD_STATUS_WINDOW.y + HUD_STATUS_WINDOW.h - 1],
      [1, 333, 270, 442],
    ],
    [
      'rechtes HUD-Fenster',
      [HUD_GAUGE_WINDOW.x, HUD_GAUGE_WINDOW.y, HUD_GAUGE_WINDOW.x + HUD_GAUGE_WINDOW.w - 1, HUD_GAUGE_WINDOW.y + HUD_GAUGE_WINDOW.h - 1],
      [275, 333, 637, 442],
    ],
    [
      'Kommandofenster',
      [HUD_COMMAND_WINDOW.x, HUD_COMMAND_WINDOW.y, HUD_COMMAND_WINDOW.x + HUD_COMMAND_WINDOW.w - 1, HUD_COMMAND_WINDOW.y + HUD_COMMAND_WINDOW.h - 1],
      [145, 341, 261, 450],
    ],
  ];
  const zeilen = gemessen.map(([name, ist, soll]) => {
    const delta = ist.map((v, i) => v - soll[i]!);
    return `${name.padEnd(22)} berechnet (${ist.join(',')})  Referenz (${soll.join(',')})  Δ ${delta.join(',')}`;
  });
  const balken = hudBoxes(modell()).filter((b) => b.id.endsWith('.frame') && b.kind === 'barFrame');
  zeilen.push('');
  for (const b of balken) {
    zeilen.push(
      `${b.id.padEnd(22)} x=${b.rect.x} y=${b.rect.y} ${b.rect.w}×${b.rect.h}` +
        `   (Referenz BARRIER x=190 · LIMIT x=476 · TIME x=554, alle y=351, 74×16)`,
    );
  }
  return zeilen.join('\n');
}

function zeichne(): void {
  paintBoxes(hudHost, hudBoxes(modell()));
  paintBoxes(resultHost, resultBoxes(ergebnis));
  $('report').textContent = bericht();
}

$('toggleAtb').addEventListener('click', () => {
  atbVoll = !atbVoll;
  zeichne();
});
$('toggleCmd').addEventListener('click', () => {
  kommando = !kommando;
  zeichne();
});
$('toggleFloat').addEventListener('click', () => {
  treffer = !treffer;
  zeichne();
});

zeichne();

// Automatisierbar wie die anderen Diagnoseseiten.
(window as unknown as Record<string, unknown>)['hudDebug'] = {
  setze: (a: boolean, k: boolean, t: boolean): void => {
    atbVoll = a;
    kommando = k;
    treffer = t;
    zeichne();
  },
  kanten: (): object => ({
    status: HUD_STATUS_WINDOW,
    gauge: HUD_GAUGE_WINDOW,
    command: HUD_COMMAND_WINDOW,
    kaesten: hudBoxes(modell()).length,
  }),
};
