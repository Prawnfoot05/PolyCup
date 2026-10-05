import * as Cup from './cup.mjs';
export function standings(s) {
  const m = Cup.currentMatch(s); if (!m) return [];
  const ranking = Cup.rankMatch(s, m), live = s.phase === 'racing';
  const last = m.roundsLog.at(-1), scored = !s.runtime && !!last;
  const finishes = live ? s.runtime.finishes : scored ? last.finishes : {};
  const finishOrder = m.players.filter(id => id in finishes).sort((a,b) => finishes[a] - finishes[b]);
  const order = live ? [...finishOrder, ...ranking.filter(id => !finishOrder.includes(id))] : ranking;
  const best = finishOrder.length ? finishes[finishOrder[0]] : null;
  return order.map(id => {
    const finishPlace = finishOrder.findIndex(other => finishes[other] === finishes[id]) + 1;
    const gain = live && finishPlace > 0 && !(id in m.finalists) ? Math.min(m.target - m.scores[id], Cup.RULES.points[finishPlace - 1]) : scored ? last.points[id] ?? 0 : 0;
    return { id, position: live && finishPlace ? finishPlace : order.indexOf(id) + 1,
      score: m.scores[id], finalist: id in m.finalists, winner: m.winners.includes(id), gain, provisional: live,
      movement: scored ? last.beforeRanking.indexOf(id) - ranking.indexOf(id) : 0,
      frames: finishes[id], delta: finishes[id] === undefined || best === null ? null : finishes[id] - best,
      dnf: (live ? s.runtime.dnfs : scored ? last.dnfs : []).includes(id) };
  });
}
export function recordTrack(s) { const m = Cup.currentMatch(s); return s.runtime?.trackId ?? m?.roundsLog.at(-1)?.trackId ?? Cup.nextTrack(s); }
export function sessionRecord(s, trackId) {
  const existing = s.records[trackId]?.tr;
  const values = s.runtime?.trackId === trackId && s.phase === 'racing' ? Object.entries(s.runtime.finishes) : [];
  let record = existing ? structuredClone(existing) : null;
  for (const [id, frames] of values) {
    if (!record || frames < record.frames) record = { frames, ids: [Number(id)], provisional: true };
    else if (frames === record.frames && !record.ids.includes(Number(id))) record.ids.push(Number(id));
  }
  return record;
}
