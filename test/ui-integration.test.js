'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('the Pro row has one owner and wide tables can scroll', () => {
  const extension = fs.readFileSync(path.join(root, 'src', 'extension-common.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'media', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'media', 'app.css'), 'utf8');
  assert.match(extension, /reach\.headHtml\(nonce\)/);
  assert.doesNotMatch(extension, /reach:\s*reach\.rowHtml\(\)/);
  assert.match(app, /<div id=\"reach\"><\/div>/);
  assert.doesNotMatch(app, /zovoReach1/);
  assert.match(css, /\.scroll table\{width:max-content;min-width:100%\}/);
});
