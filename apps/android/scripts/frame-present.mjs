const PENDING_FENCE = 9223372036854775807n;
const orderedUnique = values => [...new Set(values)].sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
const validTime = time => typeof time === 'bigint' && time >= 0n && time < PENDING_FENCE;

/** Linux CPU-list format; count present logical CPUs, not cores inferred from a model name. */
export function parseCpuPresent(output) {
  const present = output.trim();
  if (present.length > 4096 || !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(present)) throw new Error('Invalid present-CPU list');
  let logicalCount = 0, previousEnd = -1;
  for (const part of present.split(',')) {
    const [first,last=first] = part.split('-').map(Number);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first <= previousEnd || last < first || last > 65535) {
      throw new Error('Invalid present-CPU range');
    }
    logicalCount += last-first+1;
    previousEnd = last;
  }
  return {present,logicalCount};
}

/** Parse only the single active-provider line, never retain a complete service dump. */
export function parseCurrentWebViewPackage(output) {
  const match = /^Current WebView package \(name, version\): \(([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+), ([A-Za-z0-9][A-Za-z0-9.+_-]{0,127})\)$/.exec(output.trim());
  if (!match) throw new Error('Active WebView package/version unavailable or invalid');
  return {packageName:match[1],versionName:match[2]};
}

/** SurfaceFlinger FrameTracker: desired, actual-present, frame-ready nanoseconds. */
export function parsePresentHistory(output) {
  const lines = output.trim().split(/\r?\n/);
  if (!/^\d+$/.test(lines[0] ?? '')) throw new Error('Missing display refresh period');
  const refreshPeriodNs = BigInt(lines.shift());
  if (refreshPeriodNs <= 0n) throw new Error('Invalid display refresh period');
  const records = lines.map(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 3 || fields.some(field => !/^\d+$/.test(field))) throw new Error('Invalid frame-history row');
    return fields.map(BigInt);
  });
  const timestamps = orderedUnique(records.map(row => row[1]).filter(time => time > 0n && time < PENDING_FENCE));
  return {refreshPeriodNs, timestamps, records};
}

function validateWindow(windowStartNs, windowEndNs) {
  if (!validTime(windowStartNs) || !validTime(windowEndNs) || windowEndNs <= windowStartNs) {
    throw new Error('An explicit increasing device-monotonic observation window is required');
  }
}

/** Reject missing ring-history coverage instead of misreporting missing samples as low FPS. */
export function assessHistoryCoverage(snapshots, {windowStartNs,windowEndNs}) {
  validateWindow(windowStartNs,windowEndNs);
  const fail = reason => ({pass:false,reason});
  if (snapshots.length < 2 || snapshots[0].collectedAtNs > windowStartNs || snapshots.at(-1).collectedAfterNs < windowEndNs) {
    return fail('observation_window_not_covered');
  }
  const pending = new Set(), resolved = new Set();
  let previous;
  for (const snapshot of snapshots) {
    const {history,collectedAfterNs,collectedAtNs} = snapshot;
    if (!validTime(collectedAfterNs) || !validTime(collectedAtNs) || collectedAfterNs > collectedAtNs ||
      (previous && collectedAfterNs < previous.collectedAtNs) || history.timestamps.some(time => time > collectedAtNs)) {
      return fail('device_clock_mismatch');
    }
    if (history.refreshPeriodNs !== snapshots[0].history.refreshPeriodNs) return fail('display_refresh_changed');
    if (previous) {
      const before = previous.history.timestamps, after = new Set(history.timestamps);
      if (before.length && !before.some(time => after.has(time))) return fail('frame_history_coverage_gap');
      // An initially empty ring is safe only while zero padding proves it has not wrapped.
      if (!before.length && history.timestamps.length && !history.records.some(row => row.every(time => time === 0n))) {
        return fail('initial_frame_history_may_have_wrapped');
      }
    }
    for (const [desired,actual,ready] of history.records) {
      const key = desired > 0n && desired < PENDING_FENCE ? `desired:${desired}` : ready > 0n && ready < PENDING_FENCE ? `ready:${ready}` : null;
      if (actual > 0n && actual < PENDING_FENCE && key) resolved.add(key);
      // A ready fence at/after the end cannot present inside the window. Other
      // unresolved records remain ambiguous even when first observed during drain.
      const cannotPresentInWindow = ready >= windowEndNs && ready < PENDING_FENCE;
      if ((actual === PENDING_FENCE || (actual === 0n && (desired > 0n || ready > 0n))) && !cannotPresentInWindow) {
        if (!key) return fail('unidentifiable_pending_fence');
        pending.add(key);
      }
    }
    previous = snapshot;
  }
  if ([...pending].some(key => !resolved.has(key))) return fail('unresolved_present_fence');
  return {pass:true,reason:'continuous_frame_history'};
}

/** Count only [start,end), with both idle boundaries retained. No nominal-Hz tolerance. */
export function assessPresentRate(timestamps, {targetFps,minimumDurationMs,windowStartNs,windowEndNs}) {
  if (![60,120].includes(targetFps)) throw new Error('The publication target must be 60 or 120 FPS');
  if (!Number.isFinite(minimumDurationMs) || minimumDurationMs < 1000) throw new Error('Invalid measurement duration');
  validateWindow(windowStartNs,windowEndNs);
  if (timestamps.some(time => !validTime(time))) throw new Error('Invalid actual-present timestamp');
  const ordered = orderedUnique(timestamps).filter(time => time >= windowStartNs && time < windowEndNs);
  const durationMs = Number(windowEndNs - windowStartNs) / 1e6;
  const fps = ordered.length * 1000 / durationMs;
  const intervals = ordered.slice(1).map((time,index) => Number(time - ordered[index]) / 1e6).sort((a,b) => a-b);
  const intervalFps = ordered.length > 1 ? (ordered.length - 1) * 1e9 / Number(ordered.at(-1) - ordered[0]) : null;
  const leadingIdleMs = ordered.length ? Number(ordered[0] - windowStartNs) / 1e6 : durationMs;
  const trailingIdleMs = ordered.length ? Number(windowEndNs - ordered.at(-1)) / 1e6 : durationMs;
  const p95FrameMs = intervals.length ? intervals[Math.ceil(intervals.length * .95) - 1] : null;
  const maxFrameMs = intervals.at(-1) ?? null;
  const reason = durationMs < minimumDurationMs ? 'insufficient_measurement_duration'
    : ordered.length < 2 ? 'insufficient_presented_frames'
    : fps < targetFps || intervalFps < targetFps ? 'below_requested_fps' : 'requested_present_rate_met';
  return {pass:reason === 'requested_present_rate_met',reason,frames:ordered.length,durationMs,fps,intervalFps,
    leadingIdleMs,trailingIdleMs,p95FrameMs,maxFrameMs,maxObservedGapMs:Math.max(leadingIdleMs,trailingIdleMs,maxFrameMs ?? 0)};
}

export function assessSurfacePresentation(snapshots, options) {
  const {mode='active'} = options;
  if (!['active','static-advisory'].includes(mode)) throw new Error('Invalid surface measurement mode');
  const coverage = assessHistoryCoverage(snapshots,options);
  const observation = assessPresentRate(snapshots.flatMap(snapshot => snapshot.history.timestamps),options);
  return {mode,coverage,observation,pass:!coverage.pass ? false : mode === 'static-advisory' ? null : observation.pass,
    reason:!coverage.pass ? coverage.reason : mode === 'static-advisory' ? 'static_surface_no_fps_claim' : observation.reason};
}
