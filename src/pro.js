'use strict';
const { createLicense } = require('./license');
const { withSurface } = require('./reach');
const product = require('./product');
const SKU = `${product.kind}-viewer-pro`, TRIAL_USES = 3, TRIAL_KEY = `${product.prefix}.proTrial`;
const details = {
  summary: 'Builds a report from the opened file and saves it for review.', compare: 'Compares two files of this type and saves the changes.', export: 'Writes a reusable output file from the opened file.',
  extract: 'Extracts text and structured fields into a file.', layers: 'Writes each named layer to its own PNG file.', text: 'Collects text content and its layout into a report.', structure: 'Writes field definitions and table counts to a report.', edit: 'Changes one DBF cell after validation and keeps a backup of the original file.',
};
const FEATURES = Object.fromEntries(product.tools.map(t => [t.feature, { title: t.title, detail: details[t.feature] || 'Runs a professional check and saves its report.' }]));
const TOOLS = Object.values(FEATURES).map(x => x.title);
function createPro({ vscode, context, prefix, productName }) {
  const lic = createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: productName, commandPrefix: prefix, proTools: TOOLS }), seen = {};
  const used = k => Math.max(Number((context.globalState.get(TRIAL_KEY) || {})[k]) || 0, seen[k] || 0);
  const allowed = async (k, arg) => lic.isPro(SKU) || used(k) < TRIAL_USES || !!(await lic.requirePro(FEATURES[k].title, withSurface({ detail: FEATURES[k].detail, triesUsed: used(k), tools: TOOLS, surface: arg?.surface })));
  const produced = async k => { if (lic.isPro(SKU)) return; const s = { ...(context.globalState.get(TRIAL_KEY) || {}), [k]: used(k) + 1 }; seen[k] = s[k]; await context.globalState.update(TRIAL_KEY, s); };
  return { allowed, produced, tries: () => Object.fromEntries(Object.keys(FEATURES).map(k => [k, Math.max(0, TRIAL_USES - used(k))])), licensed: () => lic.isPro(SKU), license: lic };
}
module.exports = { createPro, FEATURES, SKU, TRIAL_USES, TRIAL_KEY, TOOLS };
