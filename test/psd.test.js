'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {parsePsd}=require('../src/psd');
test('reads PSD dimensions, depth, composite and pixel layers',()=>{const p=parsePsd(fs.readFileSync('samples/sample-layers.psd'));assert.equal(p.width,16);assert.equal(p.height,12);assert.equal(p.bitsPerChannel,8);assert.equal(p.composite.data.length,768);assert.equal(p.layers.length,2);assert.equal(p.layers[0].pixel.data.length,256)});
test('rejects a non-PSD header',()=>assert.throws(()=>parsePsd(Buffer.from('broken'))));
