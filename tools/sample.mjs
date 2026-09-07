import { readFile, writeFile } from 'node:fs/promises';
import { AnalyticsEngine, generateSample } from '../src/core.js';
const workbook = JSON.parse(await readFile(new URL('./sample-template.json', import.meta.url), 'utf8'));
const engine = new AnalyticsEngine();
for (const dataset of workbook.datasets) {
  engine.add(dataset.id, dataset.name, dataset.id === 'example_retail' ? generateSample(7200) : dataset.rows, dataset.schema);
}
workbook.datasets = engine.snapshot();
await writeFile(new URL('../examples/commerce.lattice', import.meta.url), JSON.stringify(workbook));
console.log('Generated the portable 7,200-row Commerce workbook.');
