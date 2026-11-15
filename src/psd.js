'use strict';
const { readPsd, initializeCanvas } = require('ag-psd');
initializeCanvas((width,height)=>({width,height}),null,(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
function rgba(source, mode) {
  if (!source) return null; const pixels=source.width*source.height, src=source.data, out=new Uint8ClampedArray(pixels*4), channels=src.length/pixels;
  const byte=v=>src instanceof Uint16Array?Math.round(v/257):src instanceof Float32Array?Math.round(v*255):v;
  for(let i=0;i<pixels;i++){
    if(channels===4){for(let c=0;c<4;c++)out[i*4+c]=byte(src[i*4+c])}
    else if(channels===5){const c=byte(src[i*5]),m=byte(src[i*5+1]),y=byte(src[i*5+2]),k=byte(src[i*5+3]);out[i*4]=255-Math.min(255,c+k);out[i*4+1]=255-Math.min(255,m+k);out[i*4+2]=255-Math.min(255,y+k);out[i*4+3]=byte(src[i*5+4])}
    else if(channels===1){out[i*4]=out[i*4+1]=out[i*4+2]=byte(src[i]);out[i*4+3]=255}
  }
  return {width:source.width,height:source.height,data:Array.from(out)};
}
function parsePsd(buf) {
  const psd = readPsd(buf, { skipLayerImageData: false, skipCompositeImageData: false, useImageData: true });
  const layers = [];
  function walk(items, parent = '') { for (const l of items || []) { const path = parent ? `${parent}/${l.name || '(unnamed)'}` : (l.name || '(unnamed)'); layers.push({ name: l.name || '(unnamed)', path, left: l.left || 0, top: l.top || 0, right: l.right || 0, bottom: l.bottom || 0, opacity: l.opacity ?? 1, hidden: !!l.hidden, text: l.text?.text || '', group: !!l.children, pixel: rgba(l.imageData,psd.colorMode) }); if (l.children) walk(l.children, path); } }
  walk(psd.children);
  const image = psd.imageData;
  return { width: psd.width, height: psd.height, colorMode: psd.colorMode, bitsPerChannel: psd.bitsPerChannel, channels: psd.channels, layers, composite: rgba(image,psd.colorMode), warnings: psd.warnings || [] };
}
module.exports = { parsePsd };
