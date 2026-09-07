/** Serializable workbook metadata and the shelf -> relational query -> marks boundary. */
export const uid=prefix=>`${prefix}_${globalThis.crypto.randomUUID?.().slice(0,12)??Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)),v=>v.toString(16).padStart(2,'0')).join('')}`;
export function sourceFromDescription(d){return {...d,roles:d.roles??{},definitions:d.definitions??[]};}
export function fieldInfo(source,pill){const name=typeof pill==='string'?pill:pill?.field;const schema=source?.schema.find(c=>c.name===name);if(name==='*')return {name:'*',type:'number',role:'measure'};return schema?{...schema,role:(typeof pill==='object'&&pill.role)||source.roles?.[name]||schema.role}:null;}
export function measurePill(field,agg='sum'){return {field,agg};}
export function newSheet(source,name='Untitled worksheet'){
  return {id:uid('sheet'),name,source:source.id,type:'bar',columns:[],rows:[],marks:{color:null,size:null,label:null,detail:null},filters:[],sort:'desc',showLabels:true,aggregate:true,opacity:.9,pointSize:5,limit:100000};
}
export function defaultWorkbook(source){
  const revenue=newSheet(source,'Revenue by category');Object.assign(revenue,{rows:[{field:'Category'}],columns:[measurePill('Sales')],marks:{color:{field:'Category'},size:null,label:null,detail:null}});
  const trend=newSheet(source,'Revenue over time');Object.assign(trend,{type:'line',columns:[{field:'Month'}],rows:[measurePill('Sales')],marks:{color:{field:'Category'},size:null,label:null,detail:null},sort:'asc',showLabels:false});
  const scatter=newSheet(source,'Sales & profitability');Object.assign(scatter,{type:'scatter',columns:[measurePill('Sales','avg')],rows:[measurePill('Profit','avg')],marks:{color:{field:'Category'},size:null,label:null,detail:{field:'Order ID'}},aggregate:false,opacity:.52,pointSize:4});
  const heat=newSheet(source,'Profit by market');Object.assign(heat,{type:'heatmap',columns:[{field:'Region'}],rows:[{field:'Segment'}],marks:{color:measurePill('Profit'),size:null,label:null,detail:null},sort:'asc'});
  const dashboard={id:uid('dashboard'),name:'Overview',title:'Commerce, in focus.',subtitle:'A complete view of revenue, profitability, and the customers behind them.',source:source.id,linked:true,rowHeight:59,tiles:[{id:uid('tile'),sheetId:revenue.id,x:0,y:0,w:6,h:4},{id:uid('tile'),sheetId:trend.id,x:6,y:0,w:6,h:4},{id:uid('tile'),sheetId:scatter.id,x:0,y:4,w:6,h:4},{id:uid('tile'),sheetId:heat.id,x:6,y:4,w:6,h:4}]};
  return {format:'lattice-workbook',version:1,name:'Commerce workbook',sources:[sourceFromDescription(source)],sheets:[revenue,trend,scatter,heat],dashboards:[dashboard],active:{kind:'dashboard',id:dashboard.id},activeSource:source.id,sample:true};
}
export function genericWorkbook(source){const s=newSheet(source,source.name);const d=source.schema.find(f=>f.role==='dimension'),m=source.schema.find(f=>f.type==='number');if(d)s.rows=[{field:d.name}];if(m)s.columns=[measurePill(m.name)];return {format:'lattice-workbook',version:1,name:`${source.name} workbook`,sources:[sourceFromDescription(source)],sheets:[s],dashboards:[],active:{kind:'sheet',id:s.id},activeSource:source.id,sample:false};}
export function validateWorkbook(wb){
  if(!wb||wb.format!=='lattice-workbook'||wb.version!==1)throw new Error('This is not a supported Lattice workbook (version 1).');
  if(!Array.isArray(wb.sources)||!Array.isArray(wb.sheets)||!Array.isArray(wb.dashboards)||!wb.sources.length)throw new Error('Workbook sources, worksheets, or dashboards are missing.');
  const ids=new Set();for(const item of [...wb.sources,...wb.sheets,...wb.dashboards]){if(typeof item.id!=='string'||ids.has(item.id))throw new Error('Workbook identities are missing or duplicated.');ids.add(item.id);}
  for(const source of wb.sources){if(typeof source.name!=='string'||!Array.isArray(source.schema)||!Array.isArray(source.definitions??[]))throw new Error('A source descriptor has an invalid name, schema, or definitions.');for(const f of source.schema)if(typeof f.name!=='string'||!['number','string','date','boolean'].includes(f.type))throw new Error('A source field has an invalid name or type.');}
  const sources=new Set(wb.sources.map(s=>s.id)),sheets=new Set(wb.sheets.map(s=>s.id));
  for(const s of wb.sheets){if(!sources.has(s.source)||!Array.isArray(s.columns)||!Array.isArray(s.rows)||!Array.isArray(s.filters)||!s.marks||!['bar','line','scatter','heatmap','table'].includes(s.type))throw new Error(`Invalid worksheet: ${s.name??s.id}`);}
  for(const d of wb.dashboards){if(!Array.isArray(d.tiles))throw new Error('Dashboard tiles are missing.');for(const t of d.tiles){if(!sheets.has(t.sheetId)||!['x','y','w','h'].every(k=>Number.isFinite(t[k]))||t.x<0||t.y<0||t.w<2||t.h<2||t.x+t.w>12)throw new Error('Invalid dashboard tile geometry or sheet reference.');}}
  if(!wb.active||!['sheet','dashboard','data'].includes(wb.active.kind))throw new Error('Invalid active workspace.');return wb;
}
export class WorkbookHistory {
  constructor(limit=60){this.limit=limit;this.undoStack=[];this.redoStack=[];}
  push(state,label){this.undoStack.push({state:structuredClone(state),label});if(this.undoStack.length>this.limit)this.undoStack.shift();this.redoStack=[];}
  undo(current){const previous=this.undoStack.pop();if(!previous)return null;this.redoStack.push({state:structuredClone(current),label:previous.label});return previous;}
  redo(current){const next=this.redoStack.pop();if(!next)return null;this.undoStack.push({state:structuredClone(current),label:next.label});return next;}
  clear(){this.undoStack=[];this.redoStack=[];}
}
export function chartQuery(sheet,source,selection){
  const isMeasure=p=>{const f=fieldInfo(source,p);return f&&(f.role==='measure'||['count','countd'].includes(p?.agg));};
  const columns=sheet.columns.filter(p=>fieldInfo(source,p)),rows=sheet.rows.filter(p=>fieldInfo(source,p)),marks=sheet.marks;
  const bindings=[...columns,...rows,...Object.values(marks).filter(Boolean)];const dimensions=[...new Set(bindings.filter(p=>!isMeasure(p)).map(p=>p.field))];
  const measures=[],aliases=new Map();
  const bindMeasure=p=>{if(!p||!isMeasure(p))return null;const f=fieldInfo(source,p),op=p.agg??(f.type==='number'?'sum':'count'),key=`${p.field}|${op}`;if(!aliases.has(key)){const as=`__m${measures.length}`;aliases.set(key,as);measures.push({field:p.field,op,as});}return aliases.get(key);};
  bindings.filter(isMeasure).forEach(bindMeasure);
  let primary=rows.find(isMeasure)??columns.find(isMeasure);if(sheet.type==='heatmap')primary=isMeasure(marks.color)?marks.color:primary;
  if(!primary&&bindings.length){primary={field:'*',agg:'count'};bindMeasure(primary);}
  const raw=sheet.type==='scatter'&&!sheet.aggregate;
  const xMeasure=columns.find(isMeasure),yMeasure=rows.find(isMeasure)??primary;
  const xAlias=bindMeasure(xMeasure),yAlias=bindMeasure(yMeasure),valueAlias=bindMeasure(primary),colorAlias=bindMeasure(marks.color),sizeAlias=bindMeasure(marks.size);
  const colorDimension=marks.color&&!isMeasure(marks.color)?marks.color.field:null;
  const columnDims=columns.filter(p=>!isMeasure(p)).map(p=>p.field),rowDims=rows.filter(p=>!isMeasure(p)).map(p=>p.field);
  const axisDimensions=sheet.type==='heatmap'?columnDims:[...columnDims,...rowDims];
  const filters=[...sheet.filters];if(selection?.tableId===sheet.source&&selection.sheetId!==sheet.id&&selection.filter)filters.push(selection.filter);
  let sort=[];if(!raw){if(sheet.type==='line'||sheet.type==='heatmap'||sheet.sort==='alpha')sort=dimensions.map(field=>({field,direction:'asc'}));else if(valueAlias&&sheet.sort!=='none')sort=[{field:valueAlias,direction:sheet.sort??'desc'}];}
  const axisMeasures=[...new Map([...columns,...rows].filter(isMeasure).map(p=>[bindMeasure(p),{pill:p,alias:bindMeasure(p)}])).values()];
  return {spec:{tableId:sheet.source,dimensions,measures,filters,raw,sort,limit:sheet.limit??100000},layout:{dimensions,axisDimensions,columnDims,rowDims,colorDimension,xAlias,yAlias,valueAlias,colorAlias,sizeAlias,xMeasure,yMeasure,primary,axisMeasures,raw,empty:!bindings.length}};
}
function keyValue(value){return value==null?'(Null)':String(value);}
export function chartModel(sheet,source,result,layout,selection){
  const formatter=new Intl.NumberFormat('en-US',{maximumFractionDigits:2}),types=new Map(source.schema.map(f=>[f.name,f.type]));
  const display=(v,field)=>v==null?'(Null)':types.get(field)==='date'?new Date(v).toISOString().slice(0,10):typeof v==='number'?formatter.format(v):String(v);
  const keys=(r)=>Object.fromEntries(layout.dimensions.map(d=>[d,r[d]]));
  const labelDimensions=layout.axisDimensions.length?layout.axisDimensions:layout.dimensions.filter(d=>d!==layout.colorDimension);
  const label=r=>labelDimensions.length?labelDimensions.map(d=>display(r[d],d)).join(' / '):layout.colorDimension?display(r[layout.colorDimension],layout.colorDimension):'All records';
  const measureLabel=m=>m?`${m.agg?.toUpperCase()??'SUM'}(${m.field==='*'?'Records':m.field})`:'Value';
  let records=result.rows.map((r,i)=>{
    const dimKeys=keys(r),key=JSON.stringify([dimKeys,r.__rowId??null]);let tooltip=layout.dimensions.map(d=>[d,display(r[d],d)]);
    for(const m of result._measures??[]){tooltip.push([layout.raw?(m.field==='*'?'Records':m.field):`${m.op.toUpperCase()}(${m.field==='*'?'Records':m.field})`,display(r[m.as],m.field)]);}
    if(!result._measures?.length){const used=new Set();for(const [alias,pill]of [[layout.xAlias,layout.xMeasure],[layout.yAlias,layout.yMeasure],[layout.valueAlias,layout.primary]])if(alias&&!used.has(alias)){used.add(alias);tooltip.push([measureLabel(pill),display(r[alias],pill?.field)]);}}
    return {label:label(r),row:layout.rowDims.map(d=>display(r[d],d)).join(' / ')||'All records',series:layout.colorDimension?display(r[layout.colorDimension],layout.colorDimension):null,x:r[layout.xAlias],y:r[layout.yAlias??layout.valueAlias],value:r[layout.colorAlias??layout.valueAlias],size:layout.sizeAlias?r[layout.sizeAlias]:null,key,keys:dimKeys,rowId:r.__rowId,tooltip,source:r};
  });
  if(['bar','line','table'].includes(sheet.type)&&layout.axisMeasures.length>1){
    records=records.flatMap(record=>layout.axisMeasures.map(({pill,alias})=>({...record,y:record.source[alias],key:JSON.stringify([record.key,alias]),series:[record.series,measureLabel(pill)].filter(Boolean).join(' · ')})));
  }
  if(layout.colorAlias&&sheet.type!=='heatmap'){
    const values=records.map(r=>r.source[layout.colorAlias]).filter(v=>v!=null&&Number.isFinite(v));let min=Infinity,max=-Infinity;for(const v of values){min=Math.min(min,v);max=Math.max(max,v);}
    records=records.map(r=>{const value=r.source[layout.colorAlias];if(value==null)return {...r,color:'#c8c4d3'};const t=max===min?.65:(value-min)/(max-min),a=[208,219,243],b=[101,72,193];return {...r,color:'#'+a.map((v,i)=>Math.round(v+(b[i]-v)*t).toString(16).padStart(2,'0')).join('')};});
  }
  records=records.filter(r=>sheet.type==='heatmap'?r.value!=null:sheet.type==='scatter'?r.x!=null&&r.y!=null:r.y!=null);
  return {type:sheet.type,records:layout.empty?[]:records,horizontal:sheet.type==='bar'&&layout.rowDims.length>0,showLabels:sheet.showLabels,opacity:sheet.opacity,pointSize:sheet.pointSize,valueLabel:measureLabel(layout.primary),dimensionLabel:labelDimensions.join(' / '),xLabel:layout.xMeasure?.field,yLabel:layout.yMeasure?.field,selected:selection?.sheetId===sheet.id?selection.keys:[],layout};
}
