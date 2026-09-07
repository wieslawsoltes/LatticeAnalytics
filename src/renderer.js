/** Instanced WebGPU primitives, Canvas2D fallback, chart layout, and spatial picking. */
export const chartPalette=['#7561d4','#279f98','#e7aa58','#538bd1','#c36a92','#7aa15a','#8c81a4','#d97b58'];
const namedColors={Technology:'#7561d4',Furniture:'#279f98','Office Supplies':'#e7aa58',West:'#7561d4',East:'#279f98',Central:'#538bd1',South:'#e7aa58',Consumer:'#7561d4',Corporate:'#279f98','Home Office':'#e7aa58'};
export function colorFor(value){if(namedColors[value])return namedColors[value];let h=2166136261;for(const c of String(value??'All'))h=Math.imul(h^c.charCodeAt(0),16777619);return chartPalette[(h>>>0)%chartPalette.length];}
const rgb=hex=>[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255];
const escapeXML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fullNumberFormatter=new Intl.NumberFormat('en-US',{maximumFractionDigits:2}),compactNumberFormatter=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
export function formatNumber(n,compact=false){if(n==null||!Number.isFinite(+n))return '—';return (compact?compactNumberFormatter:fullNumberFormatter).format(n);}
export function displayValue(v,type){return v==null?'(Null)':type==='date'?new Date(v).toISOString().slice(0,10):typeof v==='number'?formatNumber(v):String(v);}
function niceDomain(values,zero=true){let min=Infinity,max=-Infinity;for(const n of values)if(n!=null&&Number.isFinite(+n)){min=Math.min(min,+n);max=Math.max(max,+n);}if(!Number.isFinite(min))return [0,1];if(zero){min=Math.min(0,min);max=Math.max(0,max);}if(min===max){min-=Math.abs(min)*.1||1;max+=Math.abs(max)*.1||1;}const raw=(max-min)/5,p=10**Math.floor(Math.log10(raw)),step=[1,2,2.5,5,10].find(n=>n*p>=raw)*p;return [Math.floor(min/step)*step,Math.ceil(max/step)*step];}
const mapRange=(v,domain,a,b)=>a+(v-domain[0])/(domain[1]-domain[0])*(b-a);
const shader=`
struct View { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> view: View;
struct VOut { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) color: vec4f, @location(2) @interpolate(flat) kind: f32 };
@vertex fn vs(@builtin(vertex_index) vi:u32, @location(0) p0:vec2f, @location(1) p1:vec2f, @location(2) color:vec4f, @location(3) flags:vec4f)->VOut {
  var q=array<vec2f,6>(vec2f(-.5,-.5),vec2f(.5,-.5),vec2f(-.5,.5),vec2f(-.5,.5),vec2f(.5,-.5),vec2f(.5,.5));
  let local=q[vi]; var pixel=p0+local*p1;
  if(flags.x==2.0){let d=p1-p0;let len=max(length(d),.001);let u=d/len;let n=vec2f(-u.y,u.x);pixel=mix(p0,p1,local.x+.5)+n*local.y*flags.y;}
  var o:VOut;o.position=vec4f(pixel.x/view.size.x*2.-1.,1.-pixel.y/view.size.y*2.,0.,1.);o.local=local;o.color=color;o.kind=flags.x;return o;
}
@fragment fn fs(i:VOut)->@location(0) vec4f {
  var alpha=i.color.a;
  if(i.kind==1.0){let d=length(i.local)*2.;let aa=fwidth(d);alpha*=1.-smoothstep(1.-aa,1.,d);if(d>1.){discard;}}
  return vec4f(i.color.rgb*alpha,alpha);
}`;
class GPUShared {
  static promise;
  static async acquire(){if(!this.promise)this.promise=this.create();return this.promise;}
  static async create(){
    if(!globalThis.navigator?.gpu)return null;
    try{const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)return null;const device=await adapter.requestDevice();const format=navigator.gpu.getPreferredCanvasFormat();const module=device.createShaderModule({code:shader,label:'Lattice instanced marks'});const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
      device.pushErrorScope('validation');const pipeline=await device.createRenderPipelineAsync({label:'Lattice chart primitives',layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:48,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x2'},{shaderLocation:2,offset:16,format:'float32x4'},{shaderLocation:3,offset:32,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});const error=await device.popErrorScope();if(error)throw new Error(error.message);
      const state={device,format,pipeline,lost:false,listeners:new Set()};device.lost.then(info=>{state.lost=true;state.listeners.forEach(f=>f(info));GPUShared.promise=null;});return state;
    }catch(error){console.warn('Lattice: WebGPU unavailable; using Canvas2D.',error);return null;}
  }
}
class MarkSurface {
  constructor(host,onMode){this.host=host;this.onMode=onMode;this.canvas=document.createElement('canvas');this.canvas.className='chart-marks';host.append(this.canvas);this.mode='Canvas2D';this.ctx=null;this.capacity=0;this.disposed=false;this.ready=this.init();}
  async init(){const gpu=await GPUShared.acquire();if(this.disposed)return;if(gpu&&!gpu.lost){try{this.gpu=gpu;this.context=this.canvas.getContext('webgpu');this.context.configure({device:gpu.device,format:gpu.format,alphaMode:'premultiplied'});this.uniform=gpu.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.bind=gpu.device.createBindGroup({layout:gpu.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});this.lost=()=>{this.fallback();if(this.last)this.draw(...this.last);};gpu.listeners.add(this.lost);this.mode='WebGPU';}catch(e){console.warn(e);this.fallback();}}else this.fallback();this.onMode?.(this.mode);if(this.last)this.draw(...this.last);}
  fallback(){this.gpu?.listeners.delete(this.lost);this.buffer?.destroy();this.uniform?.destroy();this.context?.unconfigure();const fresh=document.createElement('canvas');fresh.className=this.canvas.className;this.canvas.replaceWith(fresh);this.canvas=fresh;this.gpu=null;this.context=null;this.ctx=fresh.getContext('2d');this.mode='Canvas2D';this.onMode?.(this.mode);}
  draw(primitives,width,height){this.last=[primitives,width,height];if(this.disposed)return;const dpr=Math.min(devicePixelRatio||1,2.5);const w=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr));if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
    if(this.gpu&&!this.gpu.lost){const {device,pipeline}=this.gpu;const data=new Float32Array(primitives.length*12);for(let i=0;i<primitives.length;i++){const p=primitives[i],c=rgb(p.color);data.set([p.x,p.y,p.w,p.h,...c,p.alpha??1,p.kind,p.lineWidth??1,0,0],i*12);}
      if(data.byteLength>this.capacity){this.buffer?.destroy();this.capacity=Math.max(4096,2**Math.ceil(Math.log2(data.byteLength)));this.buffer=device.createBuffer({size:this.capacity,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
      device.queue.writeBuffer(this.uniform,0,new Float32Array([width,height,0,0]));if(data.length)device.queue.writeBuffer(this.buffer,0,data);
      const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});if(primitives.length){pass.setPipeline(pipeline);pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,this.buffer);pass.draw(6,primitives.length);}pass.end();device.queue.submit([encoder.finish()]);
    }else if(this.ctx){const c=this.ctx;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);for(const p of primitives){c.globalAlpha=p.alpha??1;c.fillStyle=p.color;c.strokeStyle=p.color;if(p.kind===0)c.fillRect(p.x-p.w/2,p.y-p.h/2,p.w,p.h);else if(p.kind===1){c.beginPath();c.ellipse(p.x,p.y,p.w/2,p.h/2,0,0,Math.PI*2);c.fill();}else {c.lineWidth=p.lineWidth??1;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.w,p.h);c.stroke();}}c.globalAlpha=1;}
  }
  dispose(){this.disposed=true;this.gpu?.listeners.delete(this.lost);this.context?.unconfigure();this.buffer?.destroy();this.uniform?.destroy();this.canvas.remove();}
}
export class SpatialGrid {
  constructor(size=32){this.size=size;this.cells=new Map();this.large=[];}
  insert(bounds,item){const [x,y,w,h]=bounds,a=Math.floor(x/this.size),b=Math.floor(y/this.size),c=Math.floor((x+w)/this.size),d=Math.floor((y+h)/this.size);if((c-a+1)*(d-b+1)>256){this.large.push(item);return;}for(let i=a;i<=c;i++)for(let j=b;j<=d;j++){const key=`${i},${j}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(item);}}
  at(x,y){return [...(this.cells.get(`${Math.floor(x/this.size)},${Math.floor(y/this.size)}`)??[]),...this.large];}
}
export class ChartView {
  constructor(host,{onSelect,onMode}={}){
    this.host=host;this.onSelect=onSelect;this.onMode=onMode;this.id=crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(12))).join('');host.classList.add('chart-view');
    this.axes=document.createElement('canvas');this.axes.className='chart-axes';host.append(this.axes);this.surface=new MarkSurface(host,onMode);
    this.overlay=document.createElement('div');this.overlay.className='chart-brush';this.overlay.hidden=true;host.append(this.overlay);this.tooltip=document.createElement('div');this.tooltip.className='chart-tooltip';this.tooltip.hidden=true;host.append(this.tooltip);
    this.resize=new ResizeObserver(()=>this.schedule());this.resize.observe(host);
    this.move=e=>this.pointerMove(e);this.down=e=>this.pointerDown(e);this.up=e=>this.pointerUp(e);this.leave=()=>{if(!this.drag)this.tooltip.hidden=true;};
    host.addEventListener('pointermove',this.move);host.addEventListener('pointerdown',this.down);host.addEventListener('pointerup',this.up);host.addEventListener('pointerleave',this.leave);host.addEventListener('pointercancel',this.up);
  }
  set(model){this.model=model;this.schedule();}
  schedule(){if(this.disposed||this.pending)return;this.pending=requestAnimationFrame(()=>{this.pending=0;this.draw();});}
  addMark(p,record){this.primitives.push(p);if(record){const item={p,record};this.hits.push(item);const bounds=p.kind===2?[Math.min(p.x,p.w)-4,Math.min(p.y,p.h)-4,Math.abs(p.w-p.x)+8,Math.abs(p.h-p.y)+8]:[p.x-p.w/2-3,p.y-p.h/2-3,p.w+6,p.h+6];this.spatial.insert(bounds,item);}}
  text(s,x,y,{align='left',color='#7b8190',size=11,weight=400}={}){const c=this.ax;c.font=`${weight} ${size}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';c.fillText(String(s),x,y);this.svgAxes.push(`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${align==='center'?'middle':align==='right'?'end':'start'}" dominant-baseline="middle">${escapeXML(s)}</text>`);}
  line(x,y,x2,y2,color='#edf0f4',width=1){const c=this.ax;c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();this.svgAxes.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`);}
  shorten(s,n=19){s=String(s??'(Null)');return s.length>n?s.slice(0,n-1)+'…':s;}
  numericAxis(domain,horizontal,plot){for(let i=0;i<=5;i++){const value=domain[0]+(domain[1]-domain[0])*i/5;if(horizontal){const x=mapRange(value,domain,plot.x,plot.x+plot.w);this.line(x,plot.y,x,plot.y+plot.h);this.text(formatNumber(value,true),x,plot.y+plot.h+18,{align:'center'});}else{const y=mapRange(value,domain,plot.y+plot.h,plot.y);this.line(plot.x,y,plot.x+plot.w,y);this.text(formatNumber(value,true),plot.x-12,y,{align:'right'});}}}
  draw(){
    if(this.disposed||!this.model)return;const width=this.host.clientWidth,height=this.host.clientHeight;if(width<30||height<30)return;this.width=width;this.height=height;
    const dpr=Math.min(devicePixelRatio||1,2.5);this.axes.width=Math.round(width*dpr);this.axes.height=Math.round(height*dpr);this.ax=this.axes.getContext('2d');this.ax.setTransform(dpr,0,0,dpr,0,0);this.ax.clearRect(0,0,width,height);
    this.primitives=[];this.svgAxes=[];this.hits=[];this.spatial=new SpatialGrid();const m=this.model;if(this.heatLabels&&m.type!=='heatmap')this.heatLabels.innerHTML='';const records=m.records.filter(r=>m.type==='heatmap'?r.value!=null:m.type==='scatter'?r.x!=null&&r.y!=null:r.y!=null);this.plot=null;
    if(!records.length){this.text('No marks to display',width/2,height/2-8,{align:'center',size:14,color:'#596275',weight:500});this.text('Add fields to the shelves or adjust your filters.',width/2,height/2+17,{align:'center',size:12});this.surface.draw([],width,height);return;}
    if(m.type==='bar')this.drawBars(records,width,height);else if(m.type==='line')this.drawLines(records,width,height);else if(m.type==='scatter')this.drawScatter(records,width,height);else if(m.type==='heatmap')this.drawHeatmap(records,width,height);else this.drawTable(records,width,height);
    this.surface.draw(this.primitives,width,height);
  }
  markColor(r){return r.color??colorFor(r.series??'All');}
  markAlpha(r){const select=this.model.selected;if(select?.length&&!select.includes(r.key))return .23;return this.model.opacity??.88;}
  drawBars(records,w,h){
    const horizontal=this.model.horizontal;const categories=[...new Set(records.map(r=>r.label))],categoryIndex=new Map(categories.map((v,i)=>[v,i])),localSeries=new Map();for(const r of records){if(!localSeries.has(r.label))localSeries.set(r.label,new Map());const values=localSeries.get(r.label);if(!values.has(r.series??''))values.set(r.series??'',values.size);}
    const p={x:horizontal?Math.min(150,w*.28):68,y:17,w:w-(horizontal?Math.min(150,w*.28):68)-38,h:h-66};this.plot=p;const domain=niceDomain(records.map(r=>r.y));this.numericAxis(domain,!!horizontal,p);
    const band=(horizontal?p.h:p.w)/categories.length,inner=band*.68;const zero=mapRange(0,domain,horizontal?p.x:p.y+p.h,horizontal?p.x+p.w:p.y);
    categories.forEach((label,i)=>{if(horizontal&&i%Math.max(1,Math.ceil(categories.length/(p.h/16)))===0)this.text(this.shorten(label,23),p.x-12,p.y+(i+.5)*band,{align:'right',size:11});else if(!horizontal&&(categories.length<25||i%Math.ceil(categories.length/15)===0))this.text(this.shorten(label,categories.length>8?9:18),p.x+(i+.5)*band,p.y+p.h+18,{align:'center',size:10});});
    for(const r of records){const i=categoryIndex.get(r.label),values=localSeries.get(r.label),j=values.get(r.series??''),slots=values.size,position=(horizontal?p.y:p.x)+i*band+(band-inner)/2+(j+.5)*inner/slots,value=mapRange(r.y,domain,horizontal?p.x:p.y+p.h,horizontal?p.x+p.w:p.y);const size=Math.max(1,inner/slots-2);this.addMark(horizontal?{kind:0,x:(zero+value)/2,y:position,w:Math.max(.8,Math.abs(value-zero)),h:size,color:this.markColor(r),alpha:this.markAlpha(r)}:{kind:0,x:position,y:(zero+value)/2,w:size,h:Math.max(.8,Math.abs(value-zero)),color:this.markColor(r),alpha:this.markAlpha(r)},r);
      if(this.model.showLabels&&records.length<35){if(horizontal)this.text(formatNumber(r.y,true),value+(r.y>=0?7:-7),position,{align:r.y>=0?'left':'right',color:'#5e667b',size:10});else this.text(formatNumber(r.y,true),position,value-10,{align:'center',color:'#5e667b',size:10});}
    }
    this.text(this.model.valueLabel??'Value',horizontal?p.x+p.w/2:15,h-12,{align:horizontal?'center':'left',size:10});
  }
  drawLines(records,w,h){
    const labels=[...new Set(records.map(r=>r.label))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true})),p={x:66,y:18,w:w-94,h:h-64};this.plot=p;const domain=niceDomain(records.map(r=>r.y));this.numericAxis(domain,false,p);const labelIndex=new Map(labels.map((v,i)=>[v,i]));
    const sx=i=>p.x+(labels.length===1?.5:i/(labels.length-1))*p.w;
    labels.forEach((label,i)=>{if(i%Math.max(1,Math.ceil(labels.length/(w/78)))===0||i===labels.length-1){let text=String(label);if(/^\d{4}-\d{2}$/.test(text)){const d=new Date(`${text}-01T00:00:00Z`);text=d.toLocaleDateString('en-US',{month:'short',year:i===0||text.endsWith('-01')?'2-digit':undefined,timeZone:'UTC'});}this.text(this.shorten(text,12),sx(i),p.y+p.h+20,{align:'center',size:10});}});
    const series=new Map();for(const r of records){const key=r.series??'';if(!series.has(key))series.set(key,[]);series.get(key).push(r);}for(const group of series.values()){group.sort((a,b)=>labelIndex.get(a.label)-labelIndex.get(b.label));let last=null;for(const r of group){const x=sx(labelIndex.get(r.label)),y=mapRange(r.y,domain,p.y+p.h,p.y);if(last)this.addMark({kind:2,x:last.x,y:last.y,w:x,h:y,lineWidth:2.4,color:this.markColor(r),alpha:this.markAlpha(r)},null);this.addMark({kind:1,x,y,w:records.length>150?5:6,h:records.length>150?5:6,color:this.markColor(r),alpha:this.markAlpha(r)},r);last={x,y};}}
  }
  drawScatter(records,w,h){
    const p={x:70,y:19,w:w-100,h:h-79};this.plot=p;this.xDomain=niceDomain(records.map(r=>r.x));this.yDomain=niceDomain(records.map(r=>r.y));this.numericAxis(this.xDomain,true,p);this.numericAxis(this.yDomain,false,p);
    const sizeDomain=niceDomain(records.map(r=>r.size??1),false);
    for(const r of records){const x=mapRange(r.x,this.xDomain,p.x,p.x+p.w),y=mapRange(r.y,this.yDomain,p.y+p.h,p.y),size=r.size==null?(this.model.pointSize??5):Math.max(3,Math.min(18,mapRange(r.size,sizeDomain,3,13)));this.addMark({kind:1,x,y,w:size,h:size,color:this.markColor(r),alpha:this.model.selected?.length?this.markAlpha(r):Math.min(this.model.opacity??.58,.68)},r);}
    this.text(this.model.xLabel??'X',p.x+p.w/2,h-13,{align:'center',size:11});this.text(this.model.yLabel??'Y',p.x,8,{size:10});
  }
  drawHeatmap(records,w,h){
    const xs=[...new Set(records.map(r=>r.label))],ys=[...new Set(records.map(r=>r.row))];const p={x:Math.min(119,w*.27),y:18,w:w-Math.min(119,w*.27)-24,h:h-55};this.plot=p;const cw=p.w/xs.length,ch=p.h/ys.length;let min=Infinity,max=-Infinity;for(const r of records){min=Math.min(min,r.value);max=Math.max(max,r.value);}
    xs.forEach((x,i)=>this.text(this.shorten(x,Math.max(5,Math.floor(cw/7))),p.x+(i+.5)*cw,p.y+p.h+19,{align:'center',size:10}));ys.forEach((y,i)=>this.text(this.shorten(y,17),p.x-12,p.y+(i+.5)*ch,{align:'right',size:11}));
    for(const r of records){const x=p.x+(xs.indexOf(r.label)+.5)*cw,y=p.y+(ys.indexOf(r.row)+.5)*ch,t=max===min?.65:(r.value-min)/(max-min),a=[239,235,253],b=[105,79,195],color='#'+a.map((v,i)=>Math.round(v+(b[i]-v)*t).toString(16).padStart(2,'0')).join('');this.addMark({kind:0,x,y,w:Math.max(1,cw-5),h:Math.max(1,ch-5),color,alpha:this.markAlpha(r)},r);if(this.model.showLabels&&cw>58&&ch>22){/* Labels above WebGPU in a tiny HTML overlay, generated below. */}}
    // Label text must sit above opaque marks; keep it in a vector-exportable HTML overlay.
    if(!this.heatLabels){this.heatLabels=document.createElement('div');this.heatLabels.className='heat-labels';this.host.append(this.heatLabels);}this.heatLabels.innerHTML=this.model.showLabels?records.filter(()=>cw>55&&ch>22).map(r=>{const x=p.x+(xs.indexOf(r.label)+.5)*cw,y=p.y+(ys.indexOf(r.row)+.5)*ch,t=max===min?.65:(r.value-min)/(max-min),color=t>.5?'#ffffff':'#706483';return `<span style="left:${x}px;top:${y}px;color:${color}">${escapeXML(formatNumber(r.value,true))}</span>`;}).join(''):'';
  }
  drawTable(records,w,h){const p={x:22,y:20,w:w-44,h:h-40};let y=32;this.text(this.model.dimensionLabel??'Dimension',p.x,y,{weight:600,color:'#4d5365'});this.text(this.model.valueLabel??'Value',p.x+p.w,y,{align:'right',weight:600});for(const r of records){y+=29;if(y>h-10)break;this.line(p.x,y-13,p.x+p.w,y-13);this.text(this.shorten(r.label,50),p.x,y);this.text(formatNumber(r.y),p.x+p.w,y,{align:'right'});this.spatial.insert([p.x,y-14,p.w,29],{p:{kind:0,x:p.x+p.w/2,y,w:p.w,h:29},record:r});}}
  point(e){const b=this.host.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};}
  pick(x,y){let result=null,distance=Infinity;for(const hit of this.spatial?.at(x,y)??[]){const p=hit.p;if(p.kind===0){if(Math.abs(x-p.x)<=p.w/2+3&&Math.abs(y-p.y)<=p.h/2+3)return hit.record;}else if(p.kind===1){const d=Math.hypot(x-p.x,y-p.y);if(d<=Math.max(6,p.w/2+3)&&d<distance){distance=d;result=hit.record;}}}return result;}
  pointerDown(e){if(e.button!==0)return;const p=this.point(e);if(e.shiftKey&&this.model?.type==='scatter'){this.drag=p;this.host.setPointerCapture(e.pointerId);this.tooltip.hidden=true;e.preventDefault();}else this.pressed=p;}
  pointerMove(e){const p=this.point(e);if(this.drag){this.overlay.hidden=false;Object.assign(this.overlay.style,{left:Math.min(p.x,this.drag.x)+'px',top:Math.min(p.y,this.drag.y)+'px',width:Math.abs(p.x-this.drag.x)+'px',height:Math.abs(p.y-this.drag.y)+'px'});return;}const r=this.pick(p.x,p.y);this.host.style.cursor=r?'pointer':'default';if(!r){this.tooltip.hidden=true;return;}this.tooltip.hidden=false;this.tooltip.innerHTML=`<strong>${escapeXML(r.label??'Mark')}</strong>${r.tooltip.map(([k,v])=>`<div><span>${escapeXML(k)}</span><b>${escapeXML(v)}</b></div>`).join('')}<small>Click to filter linked views${this.model.type==='scatter'?' · Shift-drag to brush':''}</small>`;this.tooltip.style.left=Math.max(8,Math.min(p.x+15,this.width-240))+'px';this.tooltip.style.top=Math.max(8,Math.min(p.y+16,this.height-this.tooltip.offsetHeight-8))+'px';}
  pointerUp(e){const p=this.point(e);if(this.drag){const start=this.drag;this.drag=null;this.overlay.hidden=true;if(Math.abs(p.x-start.x)>5&&Math.abs(p.y-start.y)>5){const q=this.plot,clamp=(v,a,b)=>Math.max(a,Math.min(v,b)),inverseX=x=>mapRange(clamp(x,q.x,q.x+q.w),[q.x,q.x+q.w],...this.xDomain),inverseY=y=>mapRange(clamp(y,q.y,q.y+q.h),[q.y+q.h,q.y],...this.yDomain);this.onSelect?.({brush:{x:[inverseX(Math.min(start.x,p.x)),inverseX(Math.max(start.x,p.x))],y:[inverseY(Math.max(start.y,p.y)),inverseY(Math.min(start.y,p.y))]}});}if(this.host.hasPointerCapture(e.pointerId))this.host.releasePointerCapture(e.pointerId);}else if(this.pressed&&Math.hypot(p.x-this.pressed.x,p.y-this.pressed.y)<5){const record=this.pick(p.x,p.y);this.onSelect?.({record,multi:e.ctrlKey||e.metaKey});}this.pressed=null;}
  toSVG(title='Lattice Analytics'){const marks=this.primitives.map(p=>p.kind===0?`<rect x="${p.x-p.w/2}" y="${p.y-p.h/2}" width="${p.w}" height="${p.h}" fill="${p.color}" opacity="${p.alpha??1}"/>`:p.kind===1?`<circle cx="${p.x}" cy="${p.y}" r="${p.w/2}" fill="${p.color}" opacity="${p.alpha??1}"/>`:`<line x1="${p.x}" y1="${p.y}" x2="${p.w}" y2="${p.h}" stroke="${p.color}" stroke-width="${p.lineWidth??1}" opacity="${p.alpha??1}"/>`).join('');const labels=[...(this.heatLabels?.children??[])].map(el=>`<text x="${parseFloat(el.style.left)}" y="${parseFloat(el.style.top)}" text-anchor="middle" dominant-baseline="middle" fill="${el.style.color}" font-size="11">${escapeXML(el.textContent)}</text>`).join('');return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><title>${escapeXML(title)}</title><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif">${this.svgAxes.join('')}${marks}${labels}</g></svg>`;}
  dispose(){this.disposed=true;cancelAnimationFrame(this.pending);this.resize.disconnect();this.surface.dispose();this.host.removeEventListener('pointermove',this.move);this.host.removeEventListener('pointerdown',this.down);this.host.removeEventListener('pointerup',this.up);this.host.removeEventListener('pointercancel',this.up);this.host.removeEventListener('pointerleave',this.leave);this.host.replaceChildren();}
}
