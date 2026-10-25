import data from './generated/corpus.json';
import { decodeRecording, type Reference } from './matcher.ts';
// LRU bounds warm-isolate memory; only the selected track's ten references decode.
const cache = new Map<string, Reference[]>();
export function trackCorpus(track: string) {
  const entry = (data.tracks as any)[track];
  let references = cache.get(track);
  if (!references) {
    references = entry
      ? entry.entries.map((e: any) => ({
          ...decodeRecording(e.recording, e.finish),
          id: e.id,
          rank: e.rank,
          track,
          gameVersion: data.gameVersion,
        }))
      : [];
    if (cache.size >= 4) cache.delete(cache.keys().next().value!);
    cache.set(track, references!);
  } else {
    cache.delete(track);
    cache.set(track, references);
  }
  return {
    references,
    digest: data.digest,
    manifest: { tracks: entry ? [{ track }] : [] },
    trackDigests: { [track]: entry?.digest },
  };
}
