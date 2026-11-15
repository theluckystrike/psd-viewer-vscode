'use strict';
const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');
const product = require('./product');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris } = require('./support');
const { createReach } = require('./reach');
const parsers = { onnx: require('./onnx').parseOnnx, vsdx: require('./vsdx').parseVsdx, psd: require('./psd').parsePsd, dbf: require('./dbf').parseDbf };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const csv = rows => { const cols = [...new Set(rows.flatMap(r => Object.keys(r)))]; return [cols.map(esc).join(','), ...rows.map(r => cols.map(k => `"${String(r[k] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n'); };
function activate(context) {
  const { id, prefix, kind, name, tools } = product, viewType = `${prefix}.preview`;
  let activeUri = null;
  const pro = createPro({ vscode, context, prefix, productName: name });
  const rating = createRatingPrompt({ vscode, context, extensionId: id, section: prefix, name });
  registerSupport({ vscode, context, prefix, selfId: id });
  const reach = createReach({ vscode, context, prefix, triesKey: `${prefix}.proTrial`, slot: '#reach', licensed: pro.licensed, tools: tools.map(t => ({ id: t.id, title: t.title, command: `${prefix}.${t.id}` })) });
  const parse = async (uri,options={}) => parsers[kind](await fs.readFile(uri.fsPath),options);
  const provider = {
    openCustomDocument(uri) { return { uri, dispose() {} }; },
    async resolveCustomEditor(document, panel) {
      const uri = document.uri; activeUri = uri; const media = vscode.Uri.joinPath(context.extensionUri, 'media');
      const nonce = require('crypto').randomBytes(16).toString('base64');
      panel.webview.options = { enableScripts: true, localResourceRoots: [media], enableCommandUris: [...commandUris(prefix), ...reach.commandIds()] };
      panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${panel.webview.cspSource}"><link rel="stylesheet" href="${panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'app.css'))}">${reach.headHtml(nonce)}</head><body><main id="app"><p class="loading">Reading ${esc(path.basename(uri.fsPath))}…</p></main><script nonce="${nonce}" src="${panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'app.js'))}"></script></body></html>`;
      reach.attach(panel.webview, panel);
      const receiver = panel.webview.onDidReceiveMessage(async msg => {
        if (reach.onMessage(msg)) return;
        if (msg.type !== 'ready') return;
        try { const result = await parse(uri); await panel.webview.postMessage({ type: 'data', kind, name: path.basename(uri.fsPath), result, tries: pro.tries(), reach: '' }); rating.success(uri); }
        catch (e) { rating.failure(); await panel.webview.postMessage({ type: 'error', message: e.message || String(e) }); }
      });
      panel.onDidDispose(() => receiver.dispose());
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(viewType, provider, { webviewOptions: { retainContextWhenHidden: true } }));
  tools.forEach(tool => context.subscriptions.push(vscode.commands.registerCommand(`${prefix}.${tool.id}`, reach.wrap(async uri => {
    const target = uri || vscode.window.activeTextEditor?.document.uri || activeUri;
    if (!target || target.scheme !== 'file' || !await pro.allowed(tool.feature, { surface: reach.currentSurface?.() || 'palette' })) return;
    try {
      const data = await parse(target,{includeData:kind==='onnx'&&(tool.feature==='export'||tool.feature==='compare')}); let output, ext;
      if (kind === 'dbf' && tool.feature === 'edit') {
        const rowText=await vscode.window.showInputBox({prompt:`Row number, 1 to ${data.rows.length}`,validateInput:v=>/^\d+$/.test(v||'')&&Number(v)>0&&Number(v)<=data.rows.length?null:'Enter a row number in the file.'});
        if (rowText===undefined) return; const rowIndex=Number(rowText)-1, row=data.rows[rowIndex]; if (!row) throw new Error('That DBF row is not available.');
        if (row._deleted) throw new Error('Recall or pack deleted records in a DBF tool before editing them.');
        const field=await vscode.window.showQuickPick(data.fields.map(f=>({label:f.name,description:`${f.type}, ${f.length} bytes`,field:f})),{placeHolder:'Choose a field'}); if (!field) return;
        const value=await vscode.window.showInputBox({prompt:`New value for ${field.field.name}`,value:String(row[field.field.name]||''),validateInput:v=>Buffer.byteLength(v||'','latin1')<=field.field.length?null:`Keep the value within ${field.field.length} bytes.`}); if (value===undefined) return;
        if (['N','F'].includes(field.field.type)&&value.trim()&&!/^-?\d+(\.\d+)?$/.test(value.trim())) throw new Error('This field needs a number.');
        if (field.field.type==='D'&&value.trim()&&!/^\d{8}$/.test(value.trim())) throw new Error('Date values use YYYYMMDD.');
        if (field.field.type==='L'&&value.trim()&&!/^[TtFfYyNn]$/.test(value.trim())) throw new Error('Logical values use T, F, Y or N.');
        const bytes=await fs.readFile(target.fsPath), encoded=Buffer.from(value,'latin1');
        const offset=row._offset+field.field.offset; bytes.fill(0x20,offset,offset+field.field.length); encoded.copy(bytes,offset);
        let backup=`${target.fsPath}.bak`; for(let n=1;await fs.stat(backup).then(()=>true,()=>false);n++) backup=`${target.fsPath}.bak.${n}`;
        await fs.copyFile(target.fsPath,backup); await fs.writeFile(target.fsPath,bytes); await pro.produced(tool.feature); vscode.window.showInformationMessage(`Updated ${field.field.name}. Backup saved as ${path.basename(backup)}.`); return;
      }
      if (kind === 'psd' && tool.feature === 'layers') {
        const layers=data.layers.filter(x=>x.pixel&&!x.group); if(!layers.length)throw new Error('This document has no decoded pixel layers.');
        const folder=(await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'Choose export folder'}))?.[0]; if(!folder)return;
        const {PNG}=require('pngjs'); let count=0;
        for(const [i,l] of layers.entries()){const png=new PNG({width:l.pixel.width,height:l.pixel.height});png.data=Buffer.from(l.pixel.data);const safe=l.name.replace(/[^\w.-]+/g,'-').replace(/^-|-$/g,'')||`layer-${i+1}`;await fs.writeFile(path.join(folder.fsPath,`${String(i+1).padStart(3,'0')}-${safe}.png`),PNG.sync.write(png));count++}
        await pro.produced(tool.feature); vscode.window.showInformationMessage(`Exported ${count} PSD layers as PNG files.`); return;
      }
      if (tool.feature === 'compare') {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { [name]: product.selector } }); if (!picked?.[0]) return;
        const other = await parse(picked[0]);
        const summarize = d => kind === 'onnx' ? ({ nodes: d.nodes.length, ops: [...new Set(d.nodes.map(x => x.op))].sort(), inputs: d.inputs, outputs: d.outputs, initializers:d.initializers.map(x=>({name:x.name,dims:x.dims,dtype:x.dtype})) }) : kind === 'dbf' ? ({ fields: d.fields, rows: d.rows.length }) : kind === 'vsdx' ? ({ pages: d.pages.map(p => ({ name:p.name,shapes:p.shapes.map(s=>s.text) })) }) : ({ width:d.width,height:d.height,layers:d.layers.map(l=>l.path) });
        output = JSON.stringify({ first: path.basename(target.fsPath), second: path.basename(picked[0].fsPath), firstSummary: summarize(data), secondSummary: summarize(other), ...(kind==='dbf'?{rowChanges:compareRows(data.rows,other.rows)}:{}) }, null, 2); ext = 'json';
      } else if (tool.feature === 'export' || tool.feature === 'extract' || tool.feature === 'layers' || tool.feature === 'text') {
        if (kind === 'dbf') { output = csv(data.rows.filter(r => !r._deleted)); ext = 'csv'; }
        else if (kind === 'onnx') {
          const folder=(await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'Choose export folder'}))?.[0];if(!folder)return;
          const graph=onnxSvg(data),graphPath=path.join(folder.fsPath,'onnx-graph.svg');await fs.writeFile(graphPath,graph);let count=0;
          for(const tensor of data.initializers){if(!tensor.name||!tensor.dtype||tensor.dtype.startsWith('type '))continue;let raw=tensor.rawData;
            if(!raw&&tensor.externalData?.location){const external=path.resolve(path.dirname(target.fsPath),tensor.externalData.location),relative=path.relative(path.dirname(target.fsPath),external);if(relative.startsWith('..')||path.isAbsolute(relative))continue;const extBuf=await fs.readFile(external),offset=Number(tensor.externalData.offset||0),length=Number(tensor.externalData.length||extBuf.length-offset);if(offset+length>extBuf.length)continue;raw=extBuf.subarray(offset,offset+length)}
            if(!raw?.length)continue;const npy=makeNpy(raw,tensor.dtype,tensor.dims);if(!npy)continue;const safe=tensor.name.replace(/[^\w.-]+/g,'-')||`tensor-${count+1}`;await fs.writeFile(path.join(folder.fsPath,`${safe}.npy`),npy);count++;
          }
          await pro.produced(tool.feature);vscode.window.showInformationMessage(`Saved the graph and ${count} initializer tensors.`);return;
        }
        else if (kind === 'vsdx' && tool.feature === 'export') { const folder=(await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'Choose export folder'}))?.[0];if(!folder)return;for(const [i,page]of data.pages.entries()){const width=Math.max(200,page.width*80),height=Math.max(160,page.height*80),shapes=page.shapes.map(s=>{const w=Math.max(30,s.w*80),h=Math.max(24,s.h*80),x=(s.x-s.w/2)*80,y=(page.height-s.y-s.h/2)*80;return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#263548" stroke="#69b7ff"/><text x="${x+w/2}" y="${y+h/2}" text-anchor="middle" dominant-baseline="middle" fill="white">${esc(s.text||s.name)}</text>`}).join('');await fs.writeFile(path.join(folder.fsPath,`page-${i+1}-${page.name.replace(/[^\w.-]+/g,'-')}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes}</svg>`)}await pro.produced(tool.feature);vscode.window.showInformationMessage(`Exported ${data.pages.length} SVG pages.`);return; }
        else if (kind === 'vsdx') { const rows = data.pages.flatMap(p => p.shapes.map(s => ({ page:p.name, id:s.id, name:s.name, text:s.text, x:s.x,y:s.y,width:s.w,height:s.h }))); output = csv(rows); ext = 'csv'; }
        else if (tool.feature === 'text') { output = csv(data.layers.filter(x=>x.text).map(x=>({layer:x.path,text:x.text,left:x.left,top:x.top,right:x.right,bottom:x.bottom,css:`position:absolute;left:${x.left}px;top:${x.top}px;width:${x.right-x.left}px;height:${x.bottom-x.top}px`}))); ext = 'csv'; }
        else { output = JSON.stringify({ width:data.width,height:data.height,colorMode:data.colorMode,bitsPerChannel:data.bitsPerChannel,layers:data.layers }, null, 2); ext = 'json'; }
      } else if (kind === 'onnx' && tool.feature === 'summary') { const counts=data.nodes.reduce((a,n)=>(a[n.op]=(a[n.op]||0)+1,a),{}),params=data.initializers.reduce((n,t)=>n+t.dims.reduce((a,d)=>a*BigInt(d||1),1n),0n);output=`# ${data.graphName||path.basename(target.fsPath)}\n\nNodes: ${data.nodes.length}\nParameters: ${params}\nInitializers: ${data.initializers.length}\nModel size: ${data.bytes} bytes\nIR version: ${data.irVersion}\nOpsets: ${data.opsets.map(x=>`${x.domain||'ai.onnx'} ${x.version}`).join(', ')}\n\n## Operator counts\n\n${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([op,n])=>`- ${op}: ${n}`).join('\n')}\n`;ext='md';
      } else if (kind === 'dbf' && tool.feature === 'structure') { output = JSON.stringify({ version:data.version,records:data.records,parsedRows:data.rows.length,headerLength:data.headerLength,recordLength:data.recordLength,fields:data.fields.map(({name,type,length,decimals,offset})=>({name,type,length,decimals,offset})) },null,2); ext='json';
      } else {
        output = JSON.stringify(data, (k,v) => k === 'composite' ? { width:v.width,height:v.height } : v, 2); ext = 'json';
      }
      const out = await vscode.window.showSaveDialog({ defaultUri: target.with({ path: target.fsPath.replace(/\.[^.]+$/, `-${tool.id}.${ext}`) }), filters: { [ext.toUpperCase()]: [ext] } });
      if (!out) return; await fs.writeFile(out.fsPath, output); await pro.produced(tool.feature); vscode.window.showInformationMessage(`Saved ${path.basename(out.fsPath)}`);
    } catch (e) { vscode.window.showErrorMessage(e.message || String(e)); }
  }))));
  reach.registerCtx();
  context.subscriptions.push(vscode.commands.registerCommand(`${prefix}.openWith`, uri => uri && vscode.commands.executeCommand('vscode.openWith', uri, viewType)));
}
function deactivate() {}
function compareRows(a,b){const key=r=>JSON.stringify(r);const left=new Set(a.map(key)),right=new Set(b.map(key));return{added:[...right].filter(x=>!left.has(x)).length,removed:[...left].filter(x=>!right.has(x)).length};}
function onnxSvg(model){const nodes=model.nodes.slice(0,200),producer=new Map();for(const [i,n]of nodes.entries())for(const out of n.outputs)producer.set(out,i);const rank=[];for(let i=0;i<nodes.length;i++)rank[i]=Math.min(7,Math.max(0,...nodes[i].inputs.map(x=>producer.has(x)&&producer.get(x)<i?rank[producer.get(x)]+1:0)));const counts=[];const pos=nodes.map((n,i)=>{const x=50+rank[i]*270,y=40+(counts[rank[i]]||0)*90;counts[rank[i]]=(counts[rank[i]]||0)+1;return{x,y}}),height=Math.max(180,...pos.map(p=>p.y+90));const links=[];for(let i=0;i<nodes.length;i++)for(const input of nodes[i].inputs){const j=producer.get(input);if(j!==undefined&&j<i&&pos[j])links.push(`<path d="M ${pos[j].x+220} ${pos[j].y+26} C ${pos[j].x+245} ${pos[j].y+26}, ${pos[i].x-25} ${pos[i].y+26}, ${pos[i].x} ${pos[i].y+26}" fill="none" stroke="#789" marker-end="url(#a)"/>`)}return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 2200 ${height}"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#789"/></marker></defs><style>text{font:13px sans-serif}.n{fill:#202a3b;stroke:#69b7ff;stroke-width:2}</style>${links.join('')}${nodes.map((n,i)=>`<rect class="n" x="${pos[i].x}" y="${pos[i].y}" width="220" height="54" rx="8"/><text fill="white" x="${pos[i].x+110}" y="${pos[i].y+22}" text-anchor="middle">${esc(n.name||n.op)}</text><text fill="#bbc" x="${pos[i].x+110}" y="${pos[i].y+42}" text-anchor="middle">${esc(n.op)}</text>`).join('')}</svg>`;}
const NPY_TYPES={float32:'<f4',uint8:'|u1',int8:'|i1',uint16:'<u2',int16:'<i2',int32:'<i4',int64:'<i8',bool:'|b1',float16:'<f2',float64:'<f8',uint32:'<u4',uint64:'<u8',bfloat16:'<u2'};
function makeNpy(raw,dtype,dims){const descr=NPY_TYPES[dtype],sizes={float32:4,uint8:1,int8:1,uint16:2,int16:2,int32:4,int64:8,bool:1,float16:2,float64:8,uint32:4,uint64:8,bfloat16:2};if(!descr||!Array.isArray(dims))return null;let count=1;for(const d of dims){if(!/^\d+$/.test(String(d)))return null;count*=Number(d);if(!Number.isSafeInteger(count))return null}if(count*sizes[dtype]!==raw.length)return null;const shape=dims.length===1?`(${dims[0]},)`:dims.length?`(${dims.join(', ')})`:'()';let head=`{'descr': '${descr}', 'fortran_order': False, 'shape': ${shape}, }`;const pad=(16-((10+head.length+1)%16))%16;head+=' '.repeat(pad)+'\n';const h=Buffer.from(head,'ascii'),prefix=Buffer.alloc(10);prefix.set([0x93,0x4e,0x55,0x4d,0x50,0x59,1,0]);prefix.writeUInt16LE(h.length,8);return Buffer.concat([prefix,h,Buffer.from(raw)]);}
module.exports = { activate, deactivate };
