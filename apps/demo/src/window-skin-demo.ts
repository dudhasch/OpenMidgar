import {
  applyWindowSkin,
  windowSkinCss,
  WindowDisplayMode,
  FF7_WINDOW_SKIN,
} from '@webmidgar/ui-window';

/**
 * Regressionsvergleich der Fensterschale.
 *
 * Der Sinn: Die Dialogoptik der Demo war handgeschriebenes CSS. Beim Umzug in
 * ein Paket darf sie sich **nicht** verändern. Ein Screenshot allein würde
 * kleine Abweichungen (ein Pixel Polsterung, ein Farbton) verschlucken —
 * deshalb wird hier zusätzlich jede berechnete CSS-Eigenschaft der alten und
 * der neuen Box verglichen. Ausgabe: die Liste der Unterschiede, im Idealfall
 * leer.
 */

const alt = document.getElementById('alt') as HTMLElement;
const neu = document.getElementById('neu') as HTMLElement;
const diffEl = document.getElementById('diff') as HTMLElement;

applyWindowSkin(neu, WindowDisplayMode.Normal);

/** Eigenschaften, die die Schale setzt — nur die sind Gegenstand des Vergleichs. */
const RELEVANT = [
  'color',
  'font-family',
  'font-size',
  'line-height',
  'text-shadow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-radius',
  'background-image',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'outline-width',
  'outline-style',
  'outline-color',
  'box-shadow',
  'opacity',
];

function vergleich(): { gleich: string[]; verschieden: { prop: string; alt: string; neu: string }[] } {
  const a = getComputedStyle(alt);
  const n = getComputedStyle(neu);
  const gleich: string[] = [];
  const verschieden: { prop: string; alt: string; neu: string }[] = [];
  for (const prop of RELEVANT) {
    const va = a.getPropertyValue(prop).trim();
    const vn = n.getPropertyValue(prop).trim();
    if (va === vn) gleich.push(prop);
    else verschieden.push({ prop, alt: va, neu: vn });
  }
  return { gleich, verschieden };
}

/** Zusätzlich: Kastengröße muss auf das Pixel übereinstimmen. */
function masse(): { alt: [number, number]; neu: [number, number]; gleich: boolean } {
  const a = alt.getBoundingClientRect();
  const n = neu.getBoundingClientRect();
  const ra: [number, number] = [Math.round(a.width), Math.round(a.height)];
  const rn: [number, number] = [Math.round(n.width), Math.round(n.height)];
  return { alt: ra, neu: rn, gleich: ra[0] === rn[0] && ra[1] === rn[1] };
}

function render(): void {
  const v = vergleich();
  const m = masse();
  diffEl.textContent =
    `${v.gleich.length} von ${RELEVANT.length} Eigenschaften identisch\n` +
    `Kastenmaß alt ${m.alt[0]}×${m.alt[1]} · neu ${m.neu[0]}×${m.neu[1]} · ${m.gleich ? 'gleich' : 'ABWEICHUNG'}\n` +
    (v.verschieden.length === 0
      ? 'Keine Abweichung.'
      : v.verschieden.map((d) => `ABWEICHUNG ${d.prop}\n  alt: ${d.alt}\n  neu: ${d.neu}`).join('\n'));
}

// Die vier WMODE-Darstellungsarten zum Ansehen.
const modesEl = document.getElementById('modes') as HTMLElement;
for (const [name, mode] of [
  ['0 Normal', WindowDisplayMode.Normal],
  ['1 ohne Rahmen+Hintergrund', WindowDisplayMode.NoFrameNoBackground],
  ['2 durchsichtig', WindowDisplayMode.Transparent],
  ['3 ohne Rahmen', WindowDisplayMode.NoFrame],
] as const) {
  const stage = document.createElement('div');
  stage.className = 'stage';
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const box = document.createElement('div');
  box.className = 'box-neu';
  box.textContent = name;
  applyWindowSkin(box, mode);
  overlay.append(box);
  stage.append(overlay);
  modesEl.append(stage);
}

render();
document.fonts?.ready.then(render);

(window as unknown as { skinDebug: unknown }).skinDebug = {
  vergleich,
  masse,
  css: (mode: WindowDisplayMode = WindowDisplayMode.Normal) => windowSkinCss(mode),
  skin: () => FF7_WINDOW_SKIN,
};
