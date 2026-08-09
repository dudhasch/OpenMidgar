import { IndexService } from '@webmidgar/io';
import { PipelineClient, workerEndpoint, type ParseFieldPayload } from '@webmidgar/pipeline';
import { Telemetry, observeLongTasks, startLagProbe } from '@webmidgar/telemetry';
import type { FieldParseResult } from '@webmidgar/formats-field';
import {
  atlasBytes,
  baueFakeInstallation,
  berechneReplayVektoren,
  bewerte,
  bilanziere,
  fuehreKampagneAus,
  istFieldEintrag,
  jetzt,
  kontrollLauf,
  messeMathExposition,
  perzentile,
  vergleicheGegenErwartung,
} from '@webmidgar/nfr-run';

/**
 * S20 — Browserseitiger NFR-Messlauf.
 *
 * Drei Dinge lassen sich nur hier messen und nirgends in Node:
 *  1. **Long Tasks am Hauptthread**, während die Parser laut ADR-002 im Worker
 *     laufen. Der Node-Lauf kann das nur modellieren; hier ist es echt.
 *  2. **GPU-Upload-Budget** — `texImage2D` mit einem realen WebGL2-Kontext.
 *  3. **Speicherkontingent** (R7): `navigator.storage.estimate()`.
 *
 * Und ein viertes: derselbe Replay-Vektor läuft hier in einer anderen
 * JavaScript-Engine-Instanz als in Node. Stimmt der Digest, ist die
 * Portabilität für dieses Paar belegt (R9).
 *
 * `navigator.storage.persist()` wird bewusst **nicht** aufgerufen — das wäre
 * eine Zustandsänderung am Browserprofil. Gemessen wird nur der Ist-Stand.
 */

const status = document.getElementById('status')!;
const ausgabe = document.getElementById('ergebnis')!;

const runde = (n: number, s = 2): number => +n.toFixed(s);
const rundeP = (p: { n: number; p50: number; p95: number; max: number; summeMs: number }): Record<string, number> => ({
  n: p.n,
  p50: runde(p.p50),
  p95: runde(p.p95),
  max: runde(p.max),
  summeMs: runde(p.summeMs, 1),
});

/** GPU-Upload eines Atlas-Blocks über einen echten WebGL2-Kontext. */
function messeGpuUpload(seiten: number, kante: number): { proSeiteMs: number[]; fehler: string | null } {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { proSeiteMs: [], fehler: 'WebGL2 nicht verfügbar' };
  const daten = musterDaten(kante * kante * 4);
  const zeiten: number[] = [];
  const texturen: WebGLTexture[] = [];
  for (let s = 0; s < seiten; s++) {
    const tex = gl.createTexture()!;
    texturen.push(tex);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const t0 = performance.now();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, kante, kante, 0, gl.RGBA, gl.UNSIGNED_BYTE, daten);
    // `finish()` erzwingt, dass der Treiber die Übertragung wirklich abschließt.
    // Ohne diesen Zwang misst man nur die Zeit bis zum Einreihen des Befehls —
    // eine Zahl, die immer gut aussieht und nichts bedeutet.
    gl.finish();
    zeiten.push(performance.now() - t0);
  }
  for (const t of texturen) gl.deleteTexture(t);
  return { proSeiteMs: zeiten, fehler: null };
}

/**
 * Gestückelter Upload: Der Masterplan verlangt „Uploads getaktet/gestückelt"
 * — hier wird gemessen, ob das Stückeln das Frame-Budget tatsächlich hält.
 * Eine 2048er-Seite wird in horizontale Streifen zerlegt und jeder Streifen
 * als eigener `texSubImage2D`-Aufruf hochgeladen; gemessen wird die Zeit je
 * Streifen, denn das ist die Einheit, die in ein Frame fällt.
 */
function messeGpuUploadGestueckelt(
  kante: number,
  streifen: number,
): { proStreifenMs: number[]; jeSeiteMs: number; fehler: string | null } {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { proStreifenMs: [], jeSeiteMs: NaN, fehler: 'WebGL2 nicht verfügbar' };
  const hoehe = Math.floor(kante / streifen);
  const block = musterDaten(kante * hoehe * 4);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, kante, kante, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.finish();
  const zeiten: number[] = [];
  const tGesamt = performance.now();
  for (let s = 0; s < streifen; s++) {
    const t0 = performance.now();
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, s * hoehe, kante, hoehe, gl.RGBA, gl.UNSIGNED_BYTE, block);
    gl.finish();
    zeiten.push(performance.now() - t0);
  }
  const jeSeiteMs = performance.now() - tGesamt;
  gl.deleteTexture(tex);
  return { proStreifenMs: zeiten, jeSeiteMs, fehler: null };
}

function musterDaten(bytes: number): Uint8Array {
  const daten = new Uint8Array(bytes);
  for (let i = 0; i < daten.length; i += 4) {
    daten[i] = i & 0xff;
    daten[i + 1] = (i >> 8) & 0xff;
    daten[i + 2] = (i >> 16) & 0xff;
    daten[i + 3] = 255;
  }
  return daten;
}

async function lauf(): Promise<void> {
  const install = baueFakeInstallation({ fields: 12, kacheln: 512, gitter: 6 });

  // --- R9: Replay-Vektoren in dieser Engine --------------------------------
  const vektoren = berechneReplayVektoren();
  const vergleich = vergleicheGegenErwartung(vektoren);
  const { exposition } = messeMathExposition(() => berechneReplayVektoren());
  const { exposition: kontrolle } = messeMathExposition(() => kontrollLauf());

  // --- Hauptthread-Long-Tasks bei Parsen im Worker -------------------------
  const telemetrie = new Telemetry();
  const stopObserver = observeLongTasks(telemetrie);
  const stopLag = startLagProbe(telemetrie, { intervalMs: 20, thresholdMs: 50 });

  // Eigener Observer mit Details: „ein Long Task" ist als Zahl wertlos, wenn
  // man nicht weiß, in welcher Phase er lag. Ohne Zuordnung wäre der Befund
  // nicht behebbar, sondern nur beunruhigend.
  // 'messgeruest' = Aufbau der Fake-Installation (LZS-Kompression der eigenen
  // Writer). Das ist Testwerkzeug, keine Engine-Arbeit — der NFR-Sollwert
  // spricht ausdrücklich von „Main-Thread-Task durch Engine-Arbeit". Die Phase
  // wird trotzdem mitgeschrieben, damit der Long Task nicht unerklärt bleibt.
  let phase = 'messgeruest';
  const longTaskDetails: { phase: string; dauerMs: number }[] = [];
  let detailObserver: PerformanceObserver | null = null;
  try {
    detailObserver = new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) longTaskDetails.push({ phase, dauerMs: +e.duration.toFixed(1) });
    });
    detailObserver.observe({ type: 'longtask', buffered: false });
  } catch {
    detailObserver = null;
  }

  const worker = new Worker(new URL('../../../packages/pipeline/src/pipeline-worker.ts', import.meta.url), {
    type: 'module',
  });
  const client = new PipelineClient(workerEndpoint(worker), { telemetry: telemetrie });
  const index = new IndexService();
  await index.openSource(install.quelle, { deep: false });
  const eintraege = index.listEntries('flevel').filter((e) => istFieldEintrag(e.name));

  phase = 'worker-parse';
  const workerLatenzen: number[] = [];
  let workerFehler = 0;
  for (const eintrag of eintraege) {
    const roh = await index.readEntry(eintrag.canonicalId);
    const puffer = roh.slice().buffer as ArrayBuffer;
    const t0 = jetzt();
    try {
      const ergebnis = (await client.request(
        'parse-field',
        { fieldId: eintrag.name, bytes: puffer } satisfies ParseFieldPayload,
        { transfer: [puffer] },
      )) as FieldParseResult;
      if (!ergebnis.ok) workerFehler++;
    } catch {
      workerFehler++;
    }
    workerLatenzen.push(jetzt() - t0);
  }
  const workerLongTasks = longTaskDetails.filter((d) => d.phase === 'worker-parse').length;
  stopLag();
  stopObserver();
  detailObserver?.disconnect();
  worker.terminate();

  // --- Hauptthread-Kampagne (Vergleichsgröße, alles im selben Thread) ------
  const kampagne = await fuehreKampagneAus({
    quelle: install.quelle,
    archiv: 'flevel',
    atlasGroesse: 1024,
    ticksJeSitzung: 60,
  });

  // --- GPU-Upload-Budget ----------------------------------------------------
  const upload2048 = messeGpuUpload(8, 2048);
  const upload1024 = messeGpuUpload(8, 1024);
  const gestueckelt = messeGpuUploadGestueckelt(2048, 8);

  // --- R7: Speicherkontingent (nur lesen) ----------------------------------
  let speicher: Record<string, number | boolean | string> = { verfuegbar: false };
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    speicher = {
      verfuegbar: true,
      kontingentMB: runde((est.quota ?? 0) / (1024 * 1024), 1),
      belegtMB: runde((est.usage ?? 0) / (1024 * 1024), 2),
      persistent: (await navigator.storage.persisted?.()) ?? false,
      hinweis: 'persist() wurde bewusst nicht angefordert',
    };
  }

  const uploadP = perzentile(upload2048.proSeiteMs);
  const gestueckeltP = perzentile(gestueckelt.proStreifenMs);
  const befunde = [
    bewerte('ttff-cold', kampagne.ttffKaltMs, 'desktop', 'Browser, Fake-Installation'),
    bewerte('ttff-warm', kampagne.ttffWarmMs, 'desktop', 'Browser, S0-Treffer'),
    bewerte('field-wechsel-warm', kampagne.etappen.wechselGesamt.p95, 'desktop', 'p95, Hauptthread-Kampagne'),
    bewerte('long-tasks', workerLongTasks, 'desktop', 'PerformanceObserver, Parsen im Worker'),
    bewerte('gpu-upload-frame', gestueckeltP.p95, 'desktop', 'texSubImage2D, 2048² in 8 Streifen + finish(), p95'),
    bewerte('vram-schaetzung', kampagne.vramHoechststandMB, 'desktop', 'Atlas-Buchführung'),
  ];
  const bilanz = bilanziere(befunde);

  const ergebnis = {
    umgebung: {
      // Nur der UA-String — er beschreibt die Engine, nicht den Nutzer.
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      webgl2: upload2048.fehler === null,
    },
    r9: {
      vektoren: vergleich,
      alleGleich: vergleich.every((v) => v.gleich),
      mathexposition: {
        unsicher: exposition.unsicher,
        summeUnsicher: exposition.summeUnsicher,
        summeSicher: exposition.summeSicher,
        anteilUnsicherProzent: runde(exposition.anteilUnsicherProzent),
      },
      kontrolllaufUnsicher: kontrolle.summeUnsicher,
    },
    workerPfad: {
      fields: eintraege.length,
      fehler: workerFehler,
      latenzMs: rundeP(perzentile(workerLatenzen)),
      longTasksHauptthread: workerLongTasks,
    },
    hauptthreadKampagne: {
      ttffKaltMs: runde(kampagne.ttffKaltMs, 1),
      ttffWarmMs: runde(kampagne.ttffWarmMs, 1),
      wechsel: rundeP(kampagne.etappen.wechselGesamt),
      lzs: rundeP(kampagne.etappen.lzs),
      parse: rundeP(kampagne.etappen.parse),
      atlas: rundeP(kampagne.etappen.atlas),
      ticks: rundeP(kampagne.etappen.ticks),
      longTasks: kampagne.longTasks,
      longTaskMaxMs: runde(kampagne.longTaskMaxMs, 1),
      vramHoechststandMB: runde(kampagne.vramHoechststandMB),
      vramEndeBytes: kampagne.vram.bytes,
    },
    gpuUpload: {
      atlas2048Ganz: { ...rundeP(uploadP), bytesJeSeite: atlasBytes(1, 2048) },
      atlas1024Ganz: { ...rundeP(perzentile(upload1024.proSeiteMs)), bytesJeSeite: atlasBytes(1, 1024) },
      atlas2048Gestueckelt: {
        streifen: 8,
        ...rundeP(gestueckeltP),
        summeJeSeiteMs: runde(gestueckelt.jeSeiteMs),
      },
      fehler: upload2048.fehler,
    },
    longTaskDetails,
    speicher,
    bilanz: {
      erfuellt: bilanz.erfuellt,
      grenzwertig: bilanz.grenzwertig,
      verfehlt: bilanz.verfehlt,
      ungemessen: bilanz.ungemessen,
      urteile: befunde.map((b) => ({
        id: b.id,
        soll: b.sollwert,
        ist: b.messwert === null ? null : runde(b.messwert),
        urteil: b.urteil,
      })),
    },
  };

  (window as unknown as { __nfr: unknown }).__nfr = ergebnis;
  ausgabe.textContent = JSON.stringify(ergebnis, null, 2);
  const gut = ergebnis.r9.alleGleich && bilanz.verfehlt === 0;
  status.innerHTML = gut
    ? '<span class="ok">Messung abgeschlossen — Replay-Digests identisch, kein Sollwert verfehlt.</span>'
    : `<span class="fail">Messung abgeschlossen — ${bilanz.verfehlt} Sollwert(e) verfehlt, Digests gleich: ${ergebnis.r9.alleGleich}.</span>`;
  console.log('S20-NFR-Browserlauf:', JSON.stringify(ergebnis));
}

void lauf().catch((err: unknown) => {
  status.innerHTML = `<span class="fail">Fehler: ${String(err)}</span>`;
  console.error(err);
});
