const records: { label: string; elapsed: number }[] = [];
let currentBatch: { label: string; start: number }[] = [];

export function timeStart(label: string) {
  currentBatch.push({ label, start: performance.now() });
}

export function timeEnd(label: string) {
  const idx = currentBatch.findIndex((t) => t.label === label);
  if (idx === -1) return;
  const { start } = currentBatch[idx];
  currentBatch.splice(idx, 1);
  const elapsed = performance.now() - start;
  records.push({ label, elapsed });
  // Keep only last 30 records
  if (records.length > 30) records.shift();
  console.log(`⏱ ${label}: ${elapsed.toFixed(1)}ms`);
}

export function getRecords() {
  return [...records];
}

export function recordTiming(label: string, elapsed: number) {
  records.push({ label, elapsed });
  if (records.length > 30) records.shift();
}

export function clearRecords() {
  records.length = 0;
}
