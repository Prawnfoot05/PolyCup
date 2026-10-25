import type { ChatLine } from './chat.ts';

/** Display seconds from the shared announcement time, without per-second RPC writes. */
export function waitingRoomChatLines(lines: ChatLine[], now = Date.now()): ChatLine[] {
  const output: ChatLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Also tolerate snapshots written by the previous polling-driven countdown.
    if (line.system && /^Match starting in [1-4]…$/.test(line.text)) continue;
    output.push(line);
    if (!line.system || line.text !== 'Match starting in 5…') continue;
    const end =
      lines
        .slice(i + 1)
        .find((next) => next.system && !/^Match starting in [1-4]…$/.test(next.text))?.at ??
      Infinity;
    for (let second = 4; second >= 1; second--) {
      const at = line.at + (5 - second) * 1000;
      if (at <= now && at < end) output.push({ ...line, at, text: `Match starting in ${second}…` });
    }
  }
  return output.sort((a, b) => a.at - b.at).map((line, index) => ({ ...line, seq: index + 1 }));
}
