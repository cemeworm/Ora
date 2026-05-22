import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const d = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'evaluation/datasets/causal-intervention-decision-dataset.json'), 'utf8'));

const withReporting = d.filter(item => item.metadata?.reportingViews && item.metadata.reportingViews.length > 0);
console.log('Cases with reportingViews:', withReporting.length);
const byView = {};
withReporting.forEach(item => {
  const key = item.metadata.reportingViews.join(',');
  if (!byView[key]) byView[key] = [];
  byView[key].push(item.id);
});
for (const [k, v] of Object.entries(byView)) console.log(k + ':', v.length, 'cases', JSON.stringify(v));

console.log('');
const freshness = d.filter(item => item.metadata?.freshnessClass === 'freshness_sensitive_query');
console.log('freshness_sensitive_query:', freshness.map(item => item.id));

console.log('');
// Union
const targetIds = new Set([...withReporting.map(i => i.id), ...freshness.map(i => i.id)]);
console.log('Union size:', targetIds.size);
console.log('Union IDs:', [...targetIds].sort());

// Write subset
const subset = d.filter(item => targetIds.has(item.id));
const outPath = path.join(PROJECT_ROOT, 'evaluation/datasets/causal-freshness-regression-subset.json');
fs.writeFileSync(outPath, JSON.stringify(subset, null, 2));
console.log('');
console.log('Written to:', outPath, '(' + subset.length + ' cases)');
