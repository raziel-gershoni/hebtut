export type Interval = { start: number; end: number };

type WorkEvent = {
  kind: "active" | "playback" | "recording";
  started_at: Date;
  ended_at: Date;
};

export type WorkBuckets = {
  recording_s: number;
  playback_s: number;
  active_s: number;
  total_s: number;
};

export function mergeIntervals(raw: Interval[]): Interval[] {
  const filtered = raw.filter((i) => i.end > i.start);
  if (filtered.length === 0) return [];
  const sorted = [...filtered].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function subtractIntervals(
  base: Interval[],
  toRemove: Interval[],
): Interval[] {
  if (base.length === 0) return [];
  if (toRemove.length === 0) return base.map((i) => ({ ...i }));
  const removeMerged = mergeIntervals(toRemove);
  const out: Interval[] = [];
  for (const b of base) {
    let cursor = b.start;
    for (const r of removeMerged) {
      if (r.end <= cursor) continue;
      if (r.start >= b.end) break;
      if (r.start > cursor) out.push({ start: cursor, end: Math.min(r.start, b.end) });
      cursor = Math.max(cursor, r.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) out.push({ start: cursor, end: b.end });
  }
  return out;
}

export function intervalsDurationS(ivs: Interval[]): number {
  return ivs.reduce((s, i) => s + (i.end - i.start), 0) / 1000;
}

export function computeWorkBuckets(events: WorkEvent[]): WorkBuckets {
  const toIv = (e: WorkEvent): Interval => ({
    start: e.started_at.getTime(),
    end: e.ended_at.getTime(),
  });
  const byKind = {
    recording: [] as Interval[],
    playback: [] as Interval[],
    active: [] as Interval[],
  };
  for (const e of events) byKind[e.kind].push(toIv(e));

  const recording = mergeIntervals(byKind.recording);
  const playback = subtractIntervals(mergeIntervals(byKind.playback), recording);
  const active = subtractIntervals(
    subtractIntervals(mergeIntervals(byKind.active), recording),
    playback,
  );

  const recording_s = intervalsDurationS(recording);
  const playback_s = intervalsDurationS(playback);
  const active_s = intervalsDurationS(active);
  return {
    recording_s,
    playback_s,
    active_s,
    total_s: recording_s + playback_s + active_s,
  };
}

/**
 * Largest-remainder apportionment of whole display-minutes across buckets.
 *
 * The work buckets are disjoint, so their seconds sum exactly to the total.
 * But flooring each bucket to whole minutes independently drops up to <1min
 * per bucket, so the displayed parts can undershoot the displayed total by up
 * to (n-1) minutes — the "⏱ актив 0м · ▶ прослушка 0м · 🎙 запись 5м" line vs
 * "Сегодня: 7м" mismatch a tutor reported. Instead we floor the TOTAL to
 * minutes and hand the leftover minutes to the buckets with the largest
 * leftover seconds, so the parts always re-sum to the displayed total while
 * staying the closest integer-minute representation. Ties break by index
 * (stable, left-to-right) so the order matches the rendered breakdown.
 */
export function apportionMinutes(partsSeconds: number[]): number[] {
  const totalMin = Math.floor(partsSeconds.reduce((a, b) => a + b, 0) / 60);
  const floors = partsSeconds.map((s) => Math.floor(s / 60));
  const deficit = totalMin - floors.reduce((a, b) => a + b, 0);
  const byRemainder = partsSeconds
    .map((s, i) => ({ i, rem: s - Math.floor(s / 60) * 60 }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const out = [...floors];
  for (let k = 0; k < deficit && k < byRemainder.length; k++) out[byRemainder[k]!.i]!++;
  return out;
}

export function applyDailyCap(buckets: WorkBuckets, capSeconds: number): WorkBuckets {
  if (buckets.total_s <= capSeconds) return buckets;
  const ratio = capSeconds / buckets.total_s;
  const recording_s = Math.round(buckets.recording_s * ratio);
  const playback_s = Math.round(buckets.playback_s * ratio);
  const active_s = Math.max(0, capSeconds - recording_s - playback_s);
  return { recording_s, playback_s, active_s, total_s: capSeconds };
}
