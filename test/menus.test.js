'use strict';
// FIXNEW2: Explorer right-click Pro entries must be the "Zovo Pro: <tool>" wrapper commands registered by reach.registerCtx()
// (VS Code ignores a "title" on a menu item), hidden from the Command Palette, one per product tool.
const test = require('node:test'), assert = require('node:assert/strict');
const pkg = require('../package.json'), product = require('../src/product');
const cmds = new Map(pkg.contributes.commands.map(c => [c.command, c.title]));
test('Explorer Pro entries use the Zovo Pro wrapper commands', () => {
  const pro = pkg.contributes.menus['explorer/context'].filter(m => m.group && m.group.startsWith('zovoPro'));
  assert.ok(pro.length >= product.tools.length);
  for (const m of pro) {
    assert.equal(m.title, undefined);
    assert.match(m.command, new RegExp(`^${product.prefix}\\.zovoPro\\.`));
    assert.match(cmds.get(m.command), /^Zovo Pro: /);
  }
  for (const t of product.tools) {
    const id = `${product.prefix}.zovoPro.${t.id}`;
    assert.equal(cmds.get(id), `Zovo Pro: ${t.title}`);
    assert.ok(pro.some(m => m.command === id), id);
  }
});
test('wrapper commands are hidden from the Command Palette', () => {
  const pal = new Map((pkg.contributes.menus.commandPalette || []).map(m => [m.command, m.when]));
  for (const t of product.tools) assert.equal(pal.get(`${product.prefix}.zovoPro.${t.id}`), 'false');
});
test('README screenshot is a file, not a data: URI', () => {
  const md = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(!md.includes('data:image'));
  assert.match(md, /!\[[^\]]+\]\(images\/screenshot\.png\)/);
});
