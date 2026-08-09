import type { IoRequest, IoResponse, IoWorkerInit, OpenSourceResult } from '@webmidgar/io';

/** Minimale S1-Diagnoseliste: Verzeichniswahl → IO/Index-Worker → Ergebnistabelle. */

const worker = new Worker(new URL('../../../packages/io/src/io-worker.ts', import.meta.url), {
  type: 'module',
});
let nextRequestId = 1;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function request(msg: DistributiveOmit<IoRequest, 'v' | 'requestId'>): Promise<IoResponse> {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<IoResponse>) => {
      if (ev.data.requestId !== requestId) return;
      worker.removeEventListener('message', onMessage);
      if (ev.data.kind === 'fault') reject(new Error(`${ev.data.code}: ${ev.data.message}`));
      else resolve(ev.data);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ v: 1, requestId, ...msg } as IoRequest);
  });
}

const $ = (id: string) => document.getElementById(id)!;

$('pick').addEventListener('click', async () => {
  const status = $('status');
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker(opts?: { mode: string }): Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: 'read' });
    worker.postMessage({ v: 1, kind: 'init', directoryHandle: handle } satisfies IoWorkerInit);

    status.textContent = 'Scanne …';
    const deep = ($('deep') as HTMLInputElement).checked;
    const t0 = performance.now();
    const res = await request({ kind: 'open-source', deep });
    const total = Math.round(performance.now() - t0);
    const result = res.kind === 'result' ? (res.payload as OpenSourceResult) : null;
    if (!result) throw new Error('Unerwartete Antwort');
    status.textContent = `Fertig in ${total} ms — Quelle ${result.sourceFingerprint.slice(0, 12)}…`;
    render(result);
  } catch (err) {
    status.textContent = `Fehler: ${(err as Error).message}`;
  }
});

function render(result: OpenSourceResult): void {
  const rows = result.archives
    .map(
      (a) => `<tr>
        <td>${a.archiveName}</td>
        <td>${a.path}</td>
        <td>${a.fatal ? '<span class="fatal">FATAL</span>' : a.fromCache ? '<span class="ok">Warm (S0)</span>' : 'Cold Scan'}</td>
        <td>${a.entryCount}</td>
        <td>${a.resolvable}</td>
        <td>${a.quarantined ? `<span class="warn">${a.quarantined}</span>` : '0'}</td>
        <td>${Math.round(result.timings.perArchiveMs[a.archiveName] ?? 0)} ms</td>
        <td><code>${a.fingerprint.slice(0, 12)}…</code></td>
      </tr>`,
    )
    .join('');
  $('result').innerHTML = `<table>
    <tr><th>Archiv</th><th>Pfad</th><th>Status</th><th>Einträge</th><th>Auflösbar</th><th>Quarantäne</th><th>Zeit</th><th>Fingerprint</th></tr>
    ${rows}
  </table>`;
  const diags = result.diagnostics.length
    ? result.diagnostics
        .slice(0, 200)
        .map((d) => `<li class="${d.severity === 'warning' ? 'warn' : 'fatal'}">[${d.code}] ${d.archive}${d.entry ? `/${d.entry}` : ''} — ${d.detail}</li>`)
        .join('')
    : '<li class="ok">Keine Diagnosen — Struktur sauber.</li>';
  $('diagnostics').innerHTML = diags;
}
