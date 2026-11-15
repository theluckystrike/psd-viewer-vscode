'use strict';
const { unzipSync, strFromU8 } = require('fflate');
const { DOMParser } = require('@xmldom/xmldom');

function parseVsdx(buf) {
  const zip = unzipSync(new Uint8Array(buf));
  const pagesXml = zip['visio/pages/pages.xml'];
  if (!pagesXml) throw new Error('This Visio package has no pages/pages.xml part.');
  const doc = new DOMParser({ errorHandler: { warning() {}, error(m) { throw new Error(m); }, fatalError(m) { throw new Error(m); } } }).parseFromString(strFromU8(pagesXml), 'application/xml');
  const pageEls = Array.from(doc.getElementsByTagName('Page'));
  const pages = pageEls.map((p, i) => {
    const id = p.getAttribute('ID'), name = p.getAttribute('Name') || `Page ${i + 1}`;
    const rels = zip[`visio/pages/_rels/page${id}.xml.rels`];
    let target = `visio/pages/page${id}.xml`;
    if (rels) { const rd = new DOMParser().parseFromString(strFromU8(rels), 'application/xml'); const rel = Array.from(rd.getElementsByTagName('Relationship')).find(x => /\/page$/.test(x.getAttribute('Type') || '')); if (rel) target = `visio/${rel.getAttribute('Target').replace(/^\.\.\//, '')}`; }
    const part = zip[target]; if (!part) return { id, name, shapes: [], error: `Missing page part ${target}` };
    const pd = new DOMParser({ errorHandler: { warning() {}, error(m) { throw new Error(m); }, fatalError(m) { throw new Error(m); } } }).parseFromString(strFromU8(part), 'application/xml');
    const shapes = Array.from(pd.getElementsByTagName('Shape')).map(s => {
      const cells = {}; for (const c of Array.from(s.getElementsByTagName('Cell'))) cells[c.getAttribute('N')] = c.getAttribute('V');
      const x = Number(cells.PinX || 0), y = Number(cells.PinY || 0), w = Number(cells.Width || 1), h = Number(cells.Height || 0.5);
      return { id: s.getAttribute('ID'), name: s.getAttribute('NameU') || s.getAttribute('Name') || '', text: s.getElementsByTagName('Text')[0]?.textContent || '', x, y, w, h, fill: cells.FillForegnd || '#fff', line: cells.LineColor || '#333', type: cells.ShapeType || '' };
    });
    const pageSheet = Array.from(pd.getElementsByTagName('PageSheet'))[0]; let pw = 11, ph = 8.5;
    if (pageSheet) for (const c of Array.from(pageSheet.getElementsByTagName('Cell'))) { if (c.getAttribute('N') === 'PageWidth') pw = Number(c.getAttribute('V')) || pw; if (c.getAttribute('N') === 'PageHeight') ph = Number(c.getAttribute('V')) || ph; }
    return { id, name, width: pw, height: ph, shapes };
  });
  return { pages, masters: Object.keys(zip).filter(k => /^visio\/masters\/master\d+\.xml$/.test(k)).length, files: Object.keys(zip).length };
}
module.exports = { parseVsdx };
