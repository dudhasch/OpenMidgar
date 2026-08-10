import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, utf8Bytes, utf8Decode } from './json.js';
import { AutoSaver, detectCrashRecovery, StudioProject } from './project.js';
import { MemoryProjectStore } from './store.js';
import type { DialogueDoc, ProjectDoc } from './documents.js';
import { cmdSetText } from './commands.test.js';

const projectDoc: ProjectDoc = {
  schemaVersion: 1,
  modId: 'de.example.midgarquest',
  name: 'Midgar Quest',
  version: '0.1.0',
  engineCompat: '^0.11.0',
  primaersprache: 'de',
  sprachen: ['de'],
  manifestZielversion: 2,
};

const dialogueDoc: DialogueDoc = {
  schemaVersion: 1,
  field: 'field:md1stin',
  locale: 'de',
  eintraege: [{ id: 'intro', seiten: [{ text: 'Original-Text des Mods.' }] }],
};

const JOURNAL_PROJECT = '.journal/project.json.json';
const JOURNAL_DIALOGUE = `.journal/${encodeURIComponent('dialogues/md1stin.de.json')}.json`;

describe('MemoryProjectStore', () => {
  it('roundtrippt Bytes, listet sortiert, löscht', async () => {
    const store = new MemoryProjectStore();
    await store.save('b.json', utf8Bytes('{"b":1}'));
    await store.save('a.json', utf8Bytes('{"a":1}'));
    expect(utf8Decode((await store.load('a.json'))!)).toBe('{"a":1}');
    expect(await store.list()).toEqual(['a.json', 'b.json']);
    await store.delete('a.json');
    expect(await store.load('a.json')).toBeUndefined();
    expect(await store.list()).toEqual(['b.json']);
  });

  it('koppelt den Speicher von Außenmutationen ab', async () => {
    const store = new MemoryProjectStore();
    const bytes = utf8Bytes('x');
    await store.save('f', bytes);
    bytes[0] = 0;
    expect(utf8Decode((await store.load('f'))!)).toBe('x');
  });
});

describe('StudioProject.open', () => {
  it('lädt Dokumente aus dem Store (kanonisches JSON) und ignoriert Journal/build', async () => {
    const store = new MemoryProjectStore();
    await store.save('project.json', utf8Bytes(canonicalJson(projectDoc)));
    await store.save('.journal/alt.json', utf8Bytes('{}'));
    await store.save('build/out.json', utf8Bytes('{}'));
    const project = await StudioProject.open(store);
    expect(project.documents()).toEqual(['project.json']);
    expect(project.getDocument<ProjectDoc>('project.json')!.modId).toBe('de.example.midgarquest');
    expect(project.migrationsBericht).toEqual([]);
    expect(project.dirtyPaths()).toEqual([]);
  });
});

describe('Autosave + Crash-Journal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schreibt debounced ins Projektverzeichnis und räumt das Journal ab', async () => {
    const store = new MemoryProjectStore();
    const project = await StudioProject.open(store);
    const saver = new AutoSaver(project, store, { debounceMs: 100 });

    project.addDocument('project.json', projectDoc);
    await saver.flushPending();

    // Sofort: nur Journal, noch kein persistiertes Dokument.
    expect(await store.load(JOURNAL_PROJECT)).toBeDefined();
    expect(await store.load('project.json')).toBeUndefined();

    await vi.advanceTimersByTimeAsync(150);
    expect(utf8Decode((await store.load('project.json'))!)).toBe(canonicalJson(projectDoc));
    expect(await store.load(JOURNAL_PROJECT)).toBeUndefined();
    expect(project.dirtyPaths()).toEqual([]);
    saver.dispose();
  });

  it('erkennt ungespeicherte Änderungen nach simuliertem Absturz und stellt sie wieder her', async () => {
    const store = new MemoryProjectStore();
    const project = await StudioProject.open(store);
    const saver = new AutoSaver(project, store, { debounceMs: 1000 });

    project.addDocument('project.json', projectDoc);
    project.addDocument('dialogues/md1stin.de.json', dialogueDoc);
    project.mutate<DialogueDoc>(
      'dialogues/md1stin.de.json',
      cmdSetText(0, 0, 'Original-Text des Mods.', 'Ungespeicherter neuer Text.'),
    );
    const ungespeichert = canonicalJson(project.getDocument('dialogues/md1stin.de.json'));
    await saver.flushPending();

    // Simulierter Absturz: Timer verworfen, nie geflusht.
    saver.dispose();
    expect(await store.load('dialogues/md1stin.de.json')).toBeUndefined();

    // Neuer Start auf demselben Store: Dokumente fehlen, Journal schlägt an.
    const wieder = await StudioProject.open(store);
    expect(wieder.getDocument('dialogues/md1stin.de.json')).toBeUndefined();
    const recovery = await detectCrashRecovery(store);
    expect(recovery).not.toBeNull();
    expect(recovery!.pfade).toEqual(['dialogues/md1stin.de.json', 'project.json']);

    await recovery!.restore(wieder);
    expect(canonicalJson(wieder.getDocument('dialogues/md1stin.de.json'))).toBe(ungespeichert);
    expect(wieder.dirtyPaths()).toEqual(['dialogues/md1stin.de.json', 'project.json']);

    // Nach dem nächsten Autosave ist die Wiederherstellung erledigt.
    const saver2 = new AutoSaver(wieder, store, { debounceMs: 100 });
    await saver2.flush();
    expect(await store.load('dialogues/md1stin.de.json')).toBeDefined();
    expect(await detectCrashRecovery(store)).toBeNull();
    saver2.dispose();
  });

  it('löscht entfernte Dokumente auch im Store', async () => {
    const store = new MemoryProjectStore();
    const project = await StudioProject.open(store);
    const saver = new AutoSaver(project, store, { debounceMs: 100 });
    project.addDocument('project.json', projectDoc);
    await vi.advanceTimersByTimeAsync(150);
    expect(await store.load('project.json')).toBeDefined();

    project.removeDocument('project.json');
    await saver.flushPending();
    expect(await store.load('project.json')).toBeUndefined();
    expect(await store.load(JOURNAL_PROJECT)).toBeUndefined();
    saver.dispose();
  });

  it('IndexedDbProjectStore ist in Node nicht instanziierbar (klarer Fehler)', async () => {
    const { IndexedDbProjectStore } = await import('./store.js');
    const store = new IndexedDbProjectStore('test');
    await expect(store.list()).rejects.toThrow(/Browser-Kontext/);
  });
});
