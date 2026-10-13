import type { CupState } from './types.ts';
import { banEntries } from './draft.ts';
import { chosenTracks } from './cup.ts';
import { rulesFor } from './presets.ts';

export const DRAFT_SLOT_MS = 220;
export class DraftSlotMotion {
  #cup = '';
  #slots = new Map<string, { track: string | null; at: number | null }>();
  sync(state: CupState | null, now = performance.now()) {
    if (!state || state.phase !== 'registration' || state.draft?.stage === 'roster') {
      this.#cup = state?.id ?? '';
      this.#slots.clear();
      return;
    }
    const fresh = state.id !== this.#cup;
    this.#cup = state.id;
    const next = new Map<string, { track: string | null; at: number | null }>();
    const rules = rulesFor(state),
      bans = banEntries(state);
    for (const racer of state.roster) {
      const choices = {
        ban: bans.filter((b) => b.racerId === racer.id).map((b) => b.track.id),
        pick: chosenTracks(state, racer.id),
      };
      for (const [kind, count] of [
        ['ban', rules.bansPerRacer],
        ['pick', rules.picksPerRacer],
      ] as const)
        for (let index = 0; index < count; index++) {
          const key = `${racer.id}:${kind}:${index}`,
            track = choices[kind][index] ?? null;
          const previous = this.#slots.get(key);
          next.set(key, {
            track,
            at:
              !fresh && previous && previous.track !== track && track
                ? now
                : previous?.track === track
                  ? previous.at
                  : null,
          });
        }
    }
    this.#slots = next;
  }
  age(id: number, kind: 'ban' | 'pick', index: number, now = performance.now()) {
    const at = this.#slots.get(`${id}:${kind}:${index}`)?.at;
    if (at == null) return null;
    const age = now - at;
    return age >= 0 && age < DRAFT_SLOT_MS ? age : null;
  }
}
