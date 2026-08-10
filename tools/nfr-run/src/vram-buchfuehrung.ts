/**
 * VRAM-/GPU-Registry-Buchführung als **Messinstrument** (nicht als Engine-
 * Bestandteil). Masterplan 2.2 beschreibt eine refcount-geführte GPU-Registry
 * mit Generationsbindung; die Renderschicht besitzt sie noch nicht (sie
 * entsteht mit der Renderer-Integration). Für den Soak-Test aus der
 * Teststrategie — „Heap- und GPU-Registry-Buchführung müssen nach 500
 * Field-Wechseln auf Baseline zurückkehren" — wird die Buchführung hier
 * modelliert und gegen die tatsächlich erzeugten Atlas-Bytes geführt.
 *
 * Der Unterschied ist wichtig und wird im Bericht auch so benannt: gemessen
 * wird, ob der **Lebenszyklus** (Erwerb je Field-Generation, Freigabe beim
 * Wechsel) leckfrei ist. Ob ein späterer WebGL-Renderer die Texturen wirklich
 * freigibt, beweist dieser Test nicht.
 */

export interface VramEintrag {
  schluessel: string;
  bytes: number;
  refs: number;
  generation: number;
}

export interface VramStand {
  bytes: number;
  eintraege: number;
  erwerbe: number;
  freigaben: number;
  hoechststandBytes: number;
  hoechststandEintraege: number;
  /** Anzahl der Freigaben, die auf einen unbekannten Schlüssel trafen. */
  fehlfreigaben: number;
}

export class VramBuchfuehrung {
  #eintraege = new Map<string, VramEintrag>();
  #bytes = 0;
  #erwerbe = 0;
  #freigaben = 0;
  #hoechstBytes = 0;
  #hoechstEintraege = 0;
  #fehlfreigaben = 0;

  /**
   * Erwirbt eine Ressource. Ein zweiter Erwerb desselben Schlüssels erhöht
   * nur den Refcount — die Bytes zählen genau einmal, sonst wäre die
   * Buchführung schon bei geteilten Atlanten falsch.
   */
  erwirb(schluessel: string, bytes: number, generation: number): void {
    this.#erwerbe++;
    const vorhanden = this.#eintraege.get(schluessel);
    if (vorhanden) {
      vorhanden.refs++;
      vorhanden.generation = generation;
      return;
    }
    this.#eintraege.set(schluessel, { schluessel, bytes, refs: 1, generation });
    this.#bytes += bytes;
    this.#hoechstBytes = Math.max(this.#hoechstBytes, this.#bytes);
    this.#hoechstEintraege = Math.max(this.#hoechstEintraege, this.#eintraege.size);
  }

  gibFrei(schluessel: string): void {
    this.#freigaben++;
    const eintrag = this.#eintraege.get(schluessel);
    if (!eintrag) {
      this.#fehlfreigaben++;
      return;
    }
    eintrag.refs--;
    if (eintrag.refs <= 0) {
      this.#eintraege.delete(schluessel);
      this.#bytes -= eintrag.bytes;
    }
  }

  /** Gibt alle Ressourcen einer alten Generation frei (Field-Wechsel). */
  gibGenerationFrei(generation: number): number {
    let befreit = 0;
    for (const eintrag of [...this.#eintraege.values()]) {
      if (eintrag.generation !== generation) continue;
      befreit += eintrag.bytes;
      this.#freigaben += eintrag.refs;
      this.#eintraege.delete(eintrag.schluessel);
      this.#bytes -= eintrag.bytes;
    }
    return befreit;
  }

  /** Gibt alles frei, was NICHT zur aktuellen Generation gehört. */
  gibFremdeGenerationenFrei(aktuelleGeneration: number): number {
    let befreit = 0;
    for (const eintrag of [...this.#eintraege.values()]) {
      if (eintrag.generation === aktuelleGeneration) continue;
      befreit += eintrag.bytes;
      this.#freigaben += eintrag.refs;
      this.#eintraege.delete(eintrag.schluessel);
      this.#bytes -= eintrag.bytes;
    }
    return befreit;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get eintraege(): number {
    return this.#eintraege.size;
  }

  stand(): VramStand {
    return {
      bytes: this.#bytes,
      eintraege: this.#eintraege.size,
      erwerbe: this.#erwerbe,
      freigaben: this.#freigaben,
      hoechststandBytes: this.#hoechstBytes,
      hoechststandEintraege: this.#hoechstEintraege,
      fehlfreigaben: this.#fehlfreigaben,
    };
  }
}

/**
 * Schätzt die GPU-Bytes eines Atlas-Satzes: Seitenzahl × Kantenlänge² × RGBA8.
 * Das ist genau die Größe, die ein `texImage2D` hochlädt — deshalb taugt sie
 * gleichermaßen als VRAM-Schätzung und als Upload-Budget-Grundlage.
 */
export function atlasBytes(seiten: number, kantenlaenge: number): number {
  return seiten * kantenlaenge * kantenlaenge * 4;
}
