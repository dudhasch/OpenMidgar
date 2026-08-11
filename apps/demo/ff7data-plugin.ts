import { createReadStream, existsSync, statSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-only: stellt eine lokale FF7-Installation unter `/ff7data/*` bereit,
 * damit die integrierte Demo (`game.html`) ohne Directory-Picker-Nutzergeste
 * automatisiert getestet werden kann. Es werden ausschließlich die Unterbäume
 * `data/` und `save/` angeboten (keine Programmdateien, keine Mod-Backups).
 * Quelle über die Umgebungsvariable FF7_DATA_DIR; ohne sie ist das Plugin
 * inaktiv und die Seite fällt auf die File-System-Access-Wahl zurück.
 */

const SUBTREES = ['data', 'save'];

/**
 * Zusätzlich freigegebene EINZELDATEIEN der Wurzel.
 *
 * 🔵 Grund (F11b): Die Zuordnung `textureId` → Texturdatei der Weltkarte steht
 * als Zeigerfeld in der Spiel-EXE (`ff7.exe`, Dateiversatz 0x5686E8) — nicht in
 * `data/`. Ohne diese eine Datei bleibt die Weltkarte bei der
 * Klassenfarben-Diagnose. Bewusst eine NAMENSLISTE und kein Unterbaum: der
 * Rest der Installation (Mod-Backups, DLLs, Spielstände außerhalb `save/`)
 * bleibt unerreichbar. Der Produktionspfad braucht das nicht — dort wählt der
 * Nutzer ohnehin das Spielverzeichnis.
 */
const ROOT_FILES = ['ff7.exe', 'ff7_en.exe'];

interface ManifestEntry {
  path: string; // relativ zur Wurzel, '/'-Trenner
  size: number;
  lastModified: number;
}

function collectFiles(root: string): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, name.name);
      const rel = prefix ? `${prefix}/${name.name}` : name.name;
      if (name.isDirectory()) walk(abs, rel);
      else if (name.isFile()) {
        const st = statSync(abs);
        out.push({ path: rel, size: st.size, lastModified: Math.round(st.mtimeMs) });
      }
    }
  };
  for (const sub of SUBTREES) {
    const abs = join(root, sub);
    if (existsSync(abs)) walk(abs, sub);
  }
  // ROOT_FILES stehen BEWUSST NICHT im Manifest: das Manifest speist den
  // IndexService, der jede Datei darin auf LGP-Signaturen absucht. Eine 8-MB-
  // EXE dort einzureihen kostet Bootzeit und bringt nichts — sie wird über
  // `fetchRawFile` direkt geholt, genau wie KERNEL.BIN und WM0.MAP.
  return out;
}

function resolveRoot(configDir: string): string {
  if (process.env['FF7_DATA_DIR']) return process.env['FF7_DATA_DIR'];
  // Lokale, nicht eingecheckte Konfiguration: apps/demo/ff7data.local.json
  const localCfg = join(configDir, 'ff7data.local.json');
  if (existsSync(localCfg)) {
    try {
      const parsed = JSON.parse(readFileSync(localCfg, 'utf8')) as { root?: string };
      if (typeof parsed.root === 'string') return parsed.root;
    } catch {
      // absichtlich still: fehlerhafte lokale Konfiguration = Plugin inaktiv
    }
  }
  return '';
}

export function ff7DataPlugin(configDir: string): Plugin {
  const root = resolveRoot(configDir);
  return {
    name: 'webmidgar-ff7data',
    configureServer(server) {
      server.middlewares.use('/ff7data', (req, res) => {
        if (!root || !existsSync(root)) {
          res.statusCode = 503;
          res.end('FF7_DATA_DIR ist nicht gesetzt oder existiert nicht.');
          return;
        }
        const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        if (url === '/__shot' && req.method === 'POST') {
          // Dev-Werkzeug: Canvas-Screenshots der Demo als Datei ablegen
          // (Sichtprüfung ohne komponierendes Browserfenster).
          const name = (new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('name') ?? 'shot')
            .replace(/[^a-z0-9_-]/gi, '_');
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const b64 = body.replace(/^data:image\/\w+;base64,/, '');
            const dir = join(configDir, '.shots');
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `${name}.jpg`);
            writeFileSync(file, Buffer.from(b64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ file }));
          });
          return;
        }
        if (url === '/__manifest') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(collectFiles(root)));
          return;
        }
        const rel = url.replace(/^\/+/, '');
        // Pfad-Härtung: nur die freigegebenen Unterbäume, keine Ausbrüche.
        const abs = resolve(root, rel);
        const inSubtree = SUBTREES.some((s) => abs.startsWith(resolve(root, s) + sep) || abs === resolve(root, s));
        // Die Wurzeldateien werden über den EXAKTEN Namen freigegeben, nicht
        // über ein Präfix — sonst wäre jede Datei mit demselben Anfang mit drin.
        const isRootFile = ROOT_FILES.some((n) => abs === resolve(root, n));
        if ((!inSubtree && !isRootFile) || !abs.startsWith(resolve(root) + sep) || !existsSync(abs) || !statSync(abs).isFile()) {
          res.statusCode = 404;
          res.end('nicht gefunden');
          return;
        }
        const size = statSync(abs).size;
        const range = /bytes=(\d+)-(\d+)?/.exec(req.headers['range'] ?? '');
        res.setHeader('accept-ranges', 'bytes');
        res.setHeader('content-type', 'application/octet-stream');
        if (range) {
          const start = Number(range[1]);
          const end = range[2] !== undefined ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start >= size || end < start) {
            res.statusCode = 416;
            res.setHeader('content-range', `bytes */${size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
          res.setHeader('content-length', String(end - start + 1));
          createReadStream(abs, { start, end }).pipe(res);
        } else {
          res.setHeader('content-length', String(size));
          createReadStream(abs).pipe(res);
        }
      });
    },
  };
}
