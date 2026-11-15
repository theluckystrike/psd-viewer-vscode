'use strict';

function fields(buf) {
  const out = []; let p = 0;
  const varint = () => { let n = 0n, shift = 0n; for (let i = 0; i < 10 && p < buf.length; i++) { const b = buf[p++]; n |= BigInt(b & 127) << shift; if (!(b & 128)) return n; shift += 7n; } throw new Error('Invalid protobuf varint.'); };
  while (p < buf.length) {
    const tag = Number(varint()), id = tag >>> 3, wire = tag & 7;
    if (!id) throw new Error('Invalid ONNX protobuf field.');
    if (wire === 0) out.push([id, wire, varint()]);
    else if (wire === 1) { if (p + 8 > buf.length) throw new Error('Truncated ONNX field.'); out.push([id, wire, buf.subarray(p, p + 8)]); p += 8; }
    else if (wire === 2) { const n = Number(varint()); if (n < 0 || p + n > buf.length) throw new Error('Truncated ONNX field.'); out.push([id, wire, buf.subarray(p, p + n)]); p += n; }
    else if (wire === 5) { if (p + 4 > buf.length) throw new Error('Truncated ONNX field.'); out.push([id, wire, buf.subarray(p, p + 4)]); p += 4; }
    else throw new Error(`Unsupported protobuf wire type ${wire}.`);
  }
  return out;
}
const text = b => Buffer.from(b).toString('utf8');
function parseOnnx(buf) {
  const root = fields(buf), graphBytes = root.find(x => x[0] === 7 && x[1] === 2)?.[2];
  if (!graphBytes) throw new Error('No graph found. The file may not be an ONNX model.');
  const gf = fields(graphBytes), nodes = gf.filter(x => x[0] === 1 && x[1] === 2).map(x => {
    const f = fields(x[2]); return { inputs: f.filter(y => y[0] === 1).map(y => text(y[2])), outputs: f.filter(y => y[0] === 2).map(y => text(y[2])), name: text(f.find(y => y[0] === 3)?.[2] || []), op: text(f.find(y => y[0] === 4)?.[2] || []) };
  });
  const names = id => gf.filter(x => x[0] === id && x[1] === 2).map(x => { const f = fields(x[2]); return text(f.find(y => y[0] === 1)?.[2] || []); }).filter(Boolean);
  const opsets = root.filter(x => x[0] === 8 && x[1] === 2).map(x => { const f = fields(x[2]); return { domain: text(f.find(y => y[0] === 1)?.[2] || []), version: String(f.find(y => y[0] === 2)?.[2] || '') }; });
  const init = gf.filter(x => x[0] === 5 && x[1] === 2).map(x => { const f = fields(x[2]); const dims = f.filter(y => y[0] === 1).map(y => String(y[2])); const type = Number(f.find(y => y[0] === 2)?.[2] || 0n); const name = text(f.find(y => y[0] === 8)?.[2] || []); return { name, dims, type, bytes: Number(f.find(y => y[0] === 9)?.[2]?.length || 0) }; });
  return { irVersion: String(root.find(x => x[0] === 1)?.[2] || ''), graphName: text(gf.find(x => x[0] === 2)?.[2] || []), nodes, inputs: names(11), outputs: names(12), initializers: init, opsets, bytes: buf.length };
}
module.exports = { fields, parseOnnx };
