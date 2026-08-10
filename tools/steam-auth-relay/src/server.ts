import { createServer } from 'node:http';
import { loadConfig } from './config.ts';
import { createRelayHandler } from './relay.ts';

/**
 * Einstiegspunkt für den Standalone-Server:
 *   node --experimental-strip-types src/server.ts   (Node ≥ 23.6)
 *
 * Das Startlog nennt bewusst keine Secrets — nur Port, Realm und AppIDs.
 */
const config = loadConfig(process.env);
const handler = createRelayHandler(config);

const server = createServer((req, res) => {
  handler(req, res).catch((err: unknown) => {
    console.error('[steam-auth-relay] unbehandelter Fehler im Handler:', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal-error' }));
  });
});

server.listen(config.port, () => {
  console.log(
    `[steam-auth-relay] lauscht auf Port ${config.port} ` +
      `(realm=${config.realm}, appIds=${config.appIds.join(',')}, ` +
      `publisher-key=${config.steamPublisherKey !== undefined ? 'konfiguriert' : 'nicht konfiguriert'})`,
  );
});
