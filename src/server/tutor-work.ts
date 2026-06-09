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
  const out: Interval[] = [sorted[0]!];
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

export function applyDailyCap(buckets: WorkBuckets, capSeconds: number): WorkBuckets {
  if (buckets.total_s <= capSeconds) return buckets;
  const ratio = capSeconds / buckets.total_s;
  const recording_s = Math.round(buckets.recording_s * ratio);
  const playback_s = Math.round(buckets.playback_s * ratio);
  const active_s = capSeconds - recording_s - playback_s;
  return { recording_s, playback_s, active_s, total_s: capSeconds };
}
