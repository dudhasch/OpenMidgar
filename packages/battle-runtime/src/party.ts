import type { CharacterRecord, Savemap } from '@webmidgar/formats-save';
import type { PartyMemberSpec } from './session.js';

/**
 * Party-Brücke Savemap → Kampf (Gegenstück zum BattleStarter): Die belegten
 * Gruppenplätze des Spielstands werden zu Kampfwerten der `BattleSession`.
 *
 * Quellenlage (S21-Leser, `formats-save/savemap.ts`): Level, HP/MP samt
 * Maxima sind realdaten-belegt (✅). Die sechs Grundwerte @0x02 sind nur als
 * Block belegt; ihre REIHENFOLGE ist 🟡 Community-Deutung
 * [strength, vitality, magic, spirit, dexterity, luck] — hier an genau EINER
 * Stelle (`specFromRecord`) gekapselt, wie `fromEnemyRecordStats` auf der
 * Gegnerseite.
 *
 * 🔵 Abgeleitete Felder (dokumentiert, keine Originalformel): `defense` =
 * vitality und `mdefense` = spirit. Das Original verrechnet zusätzlich die
 * Ausrüstung (Waffen-/Rüstungstabellen der kernel-Sektionen sind noch nicht
 * gedeutet) — bis dahin gehen die Grundwerte unverstärkt in den 🔵-Formelsatz.
 */

/** Kapselt die 🟡-Reihenfolge-Deutung des stats-Blocks an genau EINER Stelle. */
export function specFromRecord(record: CharacterRecord): PartyMemberSpec {
  const [strength = 0, vitality = 0, magic = 0, spirit = 0, dexterity = 0, luck = 0] = record.stats;
  return {
    id: record.name,
    level: record.level,
    maxHp: record.hpMax,
    hp: record.hp,
    maxMp: record.mpMax,
    mp: record.mp,
    strength,
    defense: vitality,
    magic,
    mdefense: spirit,
    dexterity,
    luck,
  };
}

/**
 * Belegte Party-Slots des Spielstands → Kampfwerte. Unbesetzte Plätze (null)
 * und Kennungen ohne benutzten Record fallen still heraus — ein Spielstand mit
 * leerer Gruppe liefert schlicht ein leeres Array (der Aufrufer entscheidet,
 * ob er dann `defaultParty()` nimmt).
 */
export function partyFromSavemap(savemap: Savemap): PartyMemberSpec[] {
  const out: PartyMemberSpec[] = [];
  for (const slot of savemap.party) {
    if (slot === null) continue;
    const record = savemap.characters.find((c) => c.id === slot && c.used);
    if (!record) continue;
    out.push(specFromRecord(record));
  }
  return out;
}

/**
 * 🔵 Startaufstellung ohne Spielstand: zwei Kämpfer mit Werten in der
 * Größenordnung des Spielbeginns (Cloud-artig/Barret-artig, Level 7).
 * Die Zahlen sind SINNVOLLE ERFINDUNG dieses Projekts — plausibel gegen die
 * belegten Wertebereiche, aber ausdrücklich KEINE Originaldaten (die stünden
 * in der Start-Savemap der EXE, die nicht Formatgegenstand ist).
 */
export function defaultParty(): PartyMemberSpec[] {
  return [
    { id: 'cloud', level: 7, maxHp: 314, maxMp: 54, strength: 20, defense: 16, magic: 19, mdefense: 17, dexterity: 9, luck: 14 },
    { id: 'barret', level: 7, maxHp: 352, maxMp: 33, strength: 22, defense: 18, magic: 14, mdefense: 13, dexterity: 7, luck: 12 },
  ];
}
