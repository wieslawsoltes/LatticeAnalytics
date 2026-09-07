import { compileExpression, evaluateExpression } from './expression.js';

export const MAX_ROWS = 2_000_000;
const isMissing=v=>v===null||v===undefined||v==='';
const isISO=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d(?:[T ][\d:.+Z-]+)?$/.test(s)&&Number.isFinite(Date.parse(s));
const isNumeric=v=>typeof v==='number'?Number.isFinite(v):typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())&&!/^0\d+/.test(v.trim());
export function inferType(values){
  const clean=values.filter(v=>!isMissing(v));if(!clean.length)return 'string';
  if(clean.every(v=>typeof v==='boolean'||v==='true'||v==='false'))return 'boolean';
  if(clean.every(isNumeric))return 'number';
  if(clean.every(v=>v instanceof Date||isISO(v)))return 'date';
  return 'string';
}
export function parseCSV(text,delimiter){
  if(typeof text!=='string')throw new Error('CSV input must be text.');text=text.replace(/^\uFEFF/,'');
  if(!delimiter){const counts=new Map([[',',0],[';',0],['\t',0],['|',0]]);let quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='\"'){if(quoted&&text[i+1]==='\"')i++;else quoted=!quoted;}else if(!quoted){if(c==='\n'||c==='\r')break;if(counts.has(c))counts.set(c,counts.get(c)+1);}}delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];}
  const matrix=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<=text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else if(c===undefined)throw new Error('CSV has an unterminated quoted field.');else cell+=c;continue;}
    if(c==='"'&&cell.length===0&&!closed){quoted=true;continue;}
    if(c===delimiter||c==='\n'||c==='\r'||c===undefined){row.push(cell);cell='';closed=false;
      if(c!==delimiter){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))matrix.push(row);row=[];if(matrix.length>MAX_ROWS+1)throw new Error(`CSV exceeds ${MAX_ROWS.toLocaleString()} rows.`);}continue;
    }
    if(closed&&!/\s/.test(c))throw new Error('Unexpected text following a quoted CSV field.');
    if(!closed)cell+=c;
  }
  if(!matrix.length)throw new Error('The CSV file is empty.');
  const headers=matrix.shift().map((h,i)=>h.trim()||`Column ${i+1}`);
  if(new Set(headers).size!==headers.length)throw new Error('CSV headers must be unique.');
  const rows=matrix.map((values,i)=>{if(values.length>headers.length)throw new Error(`CSV row ${i+2} has more values than headers.`);return Object.fromEntries(headers.map((h,j)=>[h,values[j]??null]));});
  return {rows,headers,delimiter};
}
export function parseJSON(text){
  const json=typeof text==='string'?JSON.parse(text):text;const rows=Array.isArray(json)?json:json.rows??json.data;
  if(!Array.isArray(rows)||!rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)))throw new Error('JSON must contain an array of records, or an object with a rows/data array.');
  if(rows.length>MAX_ROWS)throw new Error(`JSON exceeds ${MAX_ROWS.toLocaleString()} rows.`);
  return rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v!=null&&typeof v==='object'?JSON.stringify(v):v])));
}
export function toCSV(rows,fields=Object.keys(rows[0]??{})){
  const escape=v=>{const s=v==null?'':String(v);return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
  return [fields.map(escape).join(','),...rows.map(r=>fields.map(f=>escape(r[f])).join(','))].join('\r\n');
}
export class Column {
  constructor(name,type,capacity=16){this.name=name;this.type=type;this.capacity=Math.max(16,capacity);this.values=this.allocate(this.capacity);this.valid=new Uint8Array(this.capacity);this.dictionary=[];this.codes=new Map();}
  allocate(n){return this.type==='number'||this.type==='date'?new Float64Array(n):this.type==='boolean'?new Uint8Array(n):new Uint32Array(n);}
  reserve(n){if(n<=this.capacity)return;this.capacity=Math.max(n,this.capacity*2);const values=this.allocate(this.capacity);values.set(this.values);this.values=values;const valid=new Uint8Array(this.capacity);valid.set(this.valid);this.valid=valid;}
  set(i,value){this.reserve(i+1);if(isMissing(value)){this.valid[i]=0;return;}
    let v=value;
    if(this.type==='number'){v=Number(v);if(!isNumeric(value)||!Number.isFinite(v))throw new Error(`Field “${this.name}” expects a finite number; received “${String(value).slice(0,60)}”.`);}
    else if(this.type==='date'){v=typeof value==='number'?value:Date.parse(value);if(!Number.isFinite(v))throw new Error(`Field “${this.name}” expects an ISO date.`);}
    else if(this.type==='boolean'){if(![true,false,'true','false',0,1].includes(v))throw new Error(`Field “${this.name}” expects a boolean.`);v=v===true||v==='true'||v===1?1:0;}
    else{v=String(v);if(!this.codes.has(v)){this.codes.set(v,this.dictionary.length);this.dictionary.push(v);}v=this.codes.get(v);}
    this.values[i]=v;this.valid[i]=1;
  }
  get(i){if(!this.valid[i])return null;const v=this.values[i];return this.type==='string'?this.dictionary[v]:this.type==='boolean'?!!v:v;}
  json(i){const v=this.get(i);return v!=null&&this.type==='date'?new Date(v).toISOString():v;}
  get bytes(){return this.values.byteLength+this.valid.byteLength+this.dictionary.reduce((a,s)=>a+s.length*2,0);}
}
export class ColumnarTable {
  constructor(id,name,rows=[],schema){
    if(rows.length>MAX_ROWS)throw new Error('Row limit exceeded.');
    this.id=id;this.name=name;this.length=0;this.epoch=0;this.revision=0;this.definitions=[];this.columns=new Map();
    const names=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    const fields=schema??names.map(name=>({name,type:inferType(rows.map(r=>r[name]))}));
    if(fields.length>512)throw new Error('Tables may have at most 512 fields.');
    if(new Set(fields.map(f=>f.name)).size!==fields.length)throw new Error('Duplicate field names are not supported.');
    for(const f of fields){if(!['number','string','date','boolean'].includes(f.type))throw new Error(`Invalid field type ${f.type}`);this.columns.set(f.name,new Column(f.name,f.type,rows.length));}
    this.baseNames=[...this.columns.keys()];this.append(rows);
  }
  get schema(){return [...this.columns.values()].map(c=>({name:c.name,type:c.type,role:c.type==='number'?'measure':'dimension',calculated:!this.baseNames.includes(c.name),nulls:this.length-c.valid.subarray(0,this.length).reduce((a,v)=>a+v,0)}));}
  get bytes(){return [...this.columns.values()].reduce((a,c)=>a+c.bytes,0);}
  get(field,row){const c=this.columns.get(field);if(!c)throw new Error(`Unknown field [${field}] in ${this.name}.`);return c.get(row);}
  exportRows(start=0,end=this.length,baseOnly=false){const cols=(baseOnly?this.baseNames:[...this.columns.keys()]).map(f=>this.columns.get(f));const rows=[];for(let i=start;i<Math.min(end,this.length);i++)rows.push(Object.fromEntries(cols.map(c=>[c.name,c.json(i)])));return rows;}
  append(rows){
    if(this.length+rows.length>MAX_ROWS)throw new Error(`Table row limit is ${MAX_ROWS.toLocaleString()}.`);
    const unknown=[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(n=>!this.columns.has(n));if(unknown.length)throw new Error(`Append has new fields: ${unknown.join(', ')}. Import as a new source instead.`);
    // Validate in temporary columns first: a failed append cannot partially commit data.
    const incoming=new Map(this.baseNames.map(n=>[n,new Column(n,this.columns.get(n).type,rows.length)]));
    rows.forEach((r,i)=>{for(const [n,c]of incoming)c.set(i,r[n]);});
    const start=this.length;for(const [n,c]of incoming){const target=this.columns.get(n);target.reserve(start+rows.length);for(let i=0;i<rows.length;i++)target.set(start+i,c.get(i));}
    this.length+=rows.length;for(const def of this.definitions)this.computeDefinition(def,start);this.revision++;return rows.length;
  }
  computeDefinition(def,start=0){
    let column=this.columns.get(def.name);
    const compiled=def.kind==='calculation'?compileExpression(def.expression,this.schema):null;
    if(!column){column=new Column(def.name,compiled?compiled.type:'string',this.length);this.columns.set(def.name,column);}
    const mapping=def.kind==='group'?new Map(def.members.map(v=>[JSON.stringify(v),def.label])):null;
    for(let i=start;i<this.length;i++){
      const v=compiled?evaluateExpression(compiled,n=>this.get(n,i)):(mapping.get(JSON.stringify(this.get(def.field,i)))??this.get(def.field,i));column.set(i,v);
    }
  }
  setDefinitions(definitions){
    if(JSON.stringify(this.definitions)===JSON.stringify(definitions))return false;
    const oldColumns=this.columns,oldDefinitions=this.definitions;
    this.columns=new Map(this.baseNames.map(n=>[n,oldColumns.get(n)]));
    try{for(const d of definitions){if(!d.name||this.columns.has(d.name))throw new Error(`Field name “${d.name}” is empty or already exists.`);if(d.kind==='group'&&!this.columns.has(d.field))throw new Error(`Unknown grouping field ${d.field}.`);if(!['group','calculation'].includes(d.kind))throw new Error('Unknown derived field kind.');this.computeDefinition(d);}this.definitions=structuredClone(definitions);this.epoch++;this.revision++;return true;}
    catch(e){this.columns=oldColumns;this.definitions=oldDefinitions;throw e;}
  }
}
const canonical=v=>JSON.stringify(v);
function filterValue(value,f){
  switch(f.op){case 'in':return f.values.some(v=>v===value);case 'notin':return !f.values.some(v=>v===value);case 'between':return value!=null&&(f.min==null||value>=f.min)&&(f.max==null||value<=f.max);case 'eq':return value===f.value;case 'neq':return value!==f.value;case 'contains':return value!=null&&String(value).toLowerCase().includes(String(f.value).toLowerCase());case 'gt':return value!=null&&value>f.value;case 'lt':return value!=null&&value<f.value;case 'notnull':return value!=null;case 'isnull':return value==null;default:throw new Error(`Unknown filter operator: ${f.op}`);}
}
function compileFilter(table,f){
  if(f.op==='or'||f.op==='and'){const children=f.filters.map(c=>compileFilter(table,c));return f.op==='or'?i=>children.some(c=>c(i)):i=>children.every(c=>c(i));}
  const col=table.columns.get(f.field);if(!col)throw new Error(`Filter references missing field [${f.field}].`);
  if(f.op==='in'||f.op==='notin'){const set=new Set(f.values);return f.op==='in'?i=>set.has(col.get(i)):i=>!set.has(col.get(i));}
  return i=>filterValue(col.get(i),f);
}
export function buildQueryPlan(table,spec){
  const ops=[{operator:'Scan',table:table.name,rows:table.length,storage:'typed columns + dictionary encoding'}];
  if(table.definitions.length)ops.push({operator:'ComputedColumns',fields:table.definitions.map(d=>d.name),materialized:true});
  if(spec.filters?.length)ops.push({operator:'Filter',predicates:spec.filters});
  if(spec.raw)ops.push({operator:'Project',fields:[...(spec.dimensions??[]),...(spec.measures??[]).map(m=>m.field)]});
  else ops.push({operator:'HashAggregate',groupBy:spec.dimensions??[],measures:spec.measures??[],incremental:'append delta'});
  if(spec.having?.length)ops.push({operator:'Having',predicates:spec.having});
  if(spec.sort?.length)ops.push({operator:'StableSort',keys:spec.sort});
  if(spec.limit)ops.push({operator:'Limit',count:spec.limit});
  return ops;
}
const aggOps=new Set(['sum','avg','min','max','count','countd','stdev']);
function newAccumulator(m){return {n:0,sum:0,correction:0,min:Infinity,max:-Infinity,mean:0,m2:0,distinct:m.op==='countd'?new Set():null};}
function addAccumulator(s,v,m){
  if(v==null&&m.field!=='*')return;
  s.n++;
  if(s.distinct)s.distinct.add(v);
  if(typeof v==='number'){
    const y=v-s.correction,t=s.sum+y;s.correction=(t-s.sum)-y;s.sum=t;s.min=Math.min(s.min,v);s.max=Math.max(s.max,v);
    const delta=v-s.mean;s.mean+=delta/s.n;s.m2+=delta*(v-s.mean);
  }
}
function finishAccumulator(s,m){switch(m.op){case 'sum':return s.n?s.sum:null;case 'avg':return s.n?s.sum/s.n:null;case 'count':return s.n;case 'countd':return s.distinct.size;case 'min':return s.n?s.min:null;case 'max':return s.n?s.max:null;case 'stdev':return s.n>1?Math.sqrt(Math.max(0,s.m2/(s.n-1))):null;}}
export class AnalyticsEngine {
  constructor(){this.tables=new Map();this.cache=new Map();this.cacheLimit=32;this.cacheBudget=64*1024*1024;}
  table(id){const t=this.tables.get(id);if(!t)throw new Error(`Data source not found: ${id}`);return t;}
  add(id,name,rows,schema){if(this.tables.has(id))throw new Error(`Duplicate data source id: ${id}`);const t=new ColumnarTable(id,name,rows,schema);this.tables.set(id,t);return this.describe(id);}
  describe(id){const t=this.table(id);return {id:t.id,name:t.name,rows:t.length,schema:t.schema,bytes:t.bytes,revision:t.revision,definitions:t.definitions};}
  clear(){this.tables.clear();this.cache.clear();}
  query(spec){
    const started=performance.now(),table=this.table(spec.tableId);const dimensions=spec.dimensions??[],measures=spec.measures??[],filters=spec.filters??[];
    for(const name of dimensions)if(!table.columns.has(name))throw new Error(`Missing dimension [${name}].`);
    const aliases=new Set(dimensions);
    for(const m of measures){if(!aggOps.has(m.op))throw new Error(`Unsupported aggregation: ${m.op}`);if(aliases.has(m.as))throw new Error(`Duplicate result alias: ${m.as}`);aliases.add(m.as);const col=table.columns.get(m.field);if(!col&&m.field!=='*')throw new Error(`Missing measure [${m.field}].`);if(!spec.raw&&!['count','countd'].includes(m.op)&&col?.type!=='number')throw new Error(`${m.op.toUpperCase()} requires a numeric field: ${m.field}`);}
    const key=canonical({table:table.id,epoch:table.epoch,dimensions,measures,filters,raw:!!spec.raw});
    let state=this.cache.get(key),mode='full',scanned=0;
    if(!state){state={processed:0,matched:0,groups:new Map(),raw:[]};if(!spec.raw&&!dimensions.length)state.groups.set('[]',{values:[],states:measures.map(newAccumulator)});}
    else mode=state.processed===table.length?'cache hit':'incremental';
    const predicates=filters.map(f=>compileFilter(table,f));const dcols=dimensions.map(n=>table.columns.get(n));const mcols=measures.map(m=>m.field==='*'?null:table.columns.get(m.field));
    for(let i=state.processed;i<table.length;i++){
      scanned++;if(!predicates.every(f=>f(i)))continue;state.matched++;
      if(spec.raw){const r=Object.fromEntries(dimensions.map((n,j)=>[n,dcols[j].get(i)]));measures.forEach((m,j)=>r[m.as]=mcols[j]?mcols[j].get(i):1);r.__rowId=i;state.raw.push(r);}
      else {const values=dcols.map(c=>c.get(i)),k=canonical(values);let group=state.groups.get(k);if(!group){group={values,states:measures.map(newAccumulator)};state.groups.set(k,group);}measures.forEach((m,j)=>addAccumulator(group.states[j],mcols[j]?mcols[j].get(i):1,m));}
    }
    state.processed=table.length;
    // Approximate retained-object accounting complements the entry-count LRU bound.
    state.estimatedBytes=spec.raw?state.raw.length*(64+16*(dimensions.length+measures.length)):state.groups.size*(96+16*dimensions.length+112*measures.length);
    if(!spec.raw)for(const group of state.groups.values())for(const accumulator of group.states)if(accumulator.distinct)state.estimatedBytes+=accumulator.distinct.size*32;
    this.cache.delete(key);this.cache.set(key,state);let retained=[...this.cache.values()].reduce((n,s)=>n+s.estimatedBytes,0);while(this.cache.size>this.cacheLimit||retained>this.cacheBudget){const oldest=this.cache.keys().next().value;retained-=this.cache.get(oldest).estimatedBytes;this.cache.delete(oldest);}
    
    let rows=spec.raw?state.raw.slice():[...state.groups.values()].map(g=>Object.fromEntries([...dimensions.map((n,j)=>[n,g.values[j]]),...measures.map((m,j)=>[m.as,finishAccumulator(g.states[j],m)])]));
    if(spec.having?.length)rows=rows.filter(r=>spec.having.every(f=>filterValue(r[f.field],f)));
    if(spec.sort?.length)rows.sort((a,b)=>{for(const s of spec.sort){const av=a[s.field],bv=b[s.field];let c;if(av==null||bv==null)c=av==null?(bv==null?0:1):-1;else c=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true});if(c)return av==null||bv==null?c:s.direction==='desc'?-c:c;}return 0;});
    const totalMarks=rows.length;if(spec.limit>0)rows=rows.slice(0,spec.limit);
    return {rows,plan:buildQueryPlan(table,spec),stats:{sourceRows:table.length,matchedRows:state.matched,scannedRows:scanned,totalMarks,returned:rows.length,truncated:rows.length<totalMarks,elapsed:performance.now()-started,mode,columnBytes:table.bytes}};
  }
  distinct(id,field){const t=this.table(id),c=t.columns.get(field);if(!c)throw new Error('Unknown field.');const values=new Map();let min=Infinity,max=-Infinity,nulls=0;for(let i=0;i<t.length;i++){const v=c.get(i);if(v==null)nulls++;else if(typeof v==='number'){min=Math.min(min,v);max=Math.max(max,v);}const k=canonical(v);values.set(k,{value:v,count:(values.get(k)?.count??0)+1});}
    return {type:c.type,values:[...values.values()].sort((a,b)=>String(a.value??'').localeCompare(String(b.value??''),undefined,{numeric:true})),min:Number.isFinite(min)?min:null,max:Number.isFinite(max)?max:null,nulls};
  }
  join({id,name,leftId,rightId,leftKeys,rightKeys,kind='left'}){
    if(!['left','inner','full'].includes(kind))throw new Error('Join kind must be left, inner, or full.');
    if(this.tables.has(id))throw new Error('The output source already exists.');
    if(!leftKeys.length||leftKeys.length!==rightKeys.length)throw new Error('Join key lists must have equal, nonzero length.');
    const left=this.table(leftId),right=this.table(rightId);
    leftKeys.forEach((k,i)=>{if(!left.columns.has(k)||!right.columns.has(rightKeys[i]))throw new Error('Join key not found.');if(left.columns.get(k).type!==right.columns.get(rightKeys[i]).type)throw new Error(`Join key types differ: ${k} and ${rightKeys[i]}. Create a typed calculated field first.`);});
    const hash=new Map();const keyAt=(t,keys,i)=>{const values=keys.map(k=>t.get(k,i));return values.some(v=>v==null)?null:canonical(values);};
    for(let i=0;i<right.length;i++){const k=keyAt(right,rightKeys,i);if(k!==null){if(!hash.has(k))hash.set(k,[]);hash.get(k).push(i);}}
    const used=new Uint8Array(right.length),output=[];const lnames=[...left.columns.keys()],rnames=[...right.columns.keys()],names=new Set(lnames);const rightNames=rnames.map(n=>{let x=names.has(n)?`${right.name}.${n}`:n;while(names.has(x))x+=' (right)';names.add(x);return x;});
    const schema=[...left.schema.map(({name,type})=>({name,type})),...right.schema.map((c,i)=>({name:rightNames[i],type:c.type}))];
    const emit=(l,r)=>{if(output.length>=MAX_ROWS)throw new Error(`Join exceeds ${MAX_ROWS.toLocaleString()} rows. Check key cardinality.`);output.push(Object.fromEntries([...lnames.map(n=>[n,l===null?null:left.get(n,l)]),...rnames.map((n,i)=>[rightNames[i],r===null?null:right.get(n,r)])]));};
    let matchedLeft=0;
    for(let l=0;l<left.length;l++){const k=keyAt(left,leftKeys,l),matches=k===null?null:hash.get(k);if(matches?.length){matchedLeft++;for(const r of matches){used[r]=1;emit(l,r);}}else if(kind!=='inner')emit(l,null);}
    if(kind==='full')for(let r=0;r<right.length;r++)if(!used[r])emit(null,r);
    const result=this.add(id,name,output,schema);return {...result,joinStats:{leftRows:left.length,rightRows:right.length,outputRows:output.length,matchedLeft,unmatchedLeft:left.length-matchedLeft,unmatchedRight:used.reduce((n,v)=>n+!v,0)}};
  }
  snapshot(){return [...this.tables.values()].map(t=>({id:t.id,name:t.name,schema:t.schema.filter(c=>t.baseNames.includes(c.name)).map(({name,type})=>({name,type})),rows:t.exportRows(0,t.length,true),definitions:t.definitions}));}
}
export function generateSample(count=7200,offset=0){
  let seed=730201+offset;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  const categories={Technology:['Accessories','Copiers','Machines','Phones'],Furniture:['Bookcases','Chairs','Furnishings','Tables'],'Office Supplies':['Appliances','Art','Binders','Envelopes','Fasteners','Labels','Paper','Storage','Supplies']};
  const regions=['West','East','Central','South'],segments=['Consumer','Corporate','Home Office'];const rows=[];
  for(let i=0;i<count;i++){const category=Object.keys(categories)[Math.floor(random()*3)],sub=categories[category][Math.floor(random()*categories[category].length)],region=regions[Math.floor(random()*4)],segment=segments[Math.floor(random()*3)];
    const month=Math.floor(random()*24),day=1+Math.floor(random()*28),date=new Date(Date.UTC(2024+Math.floor(month/12),month%12,day));const quantity=1+Math.floor(random()*8),discount=random()<.28?[.1,.15,.2,.3][Math.floor(random()*4)]:0;
    const unit=(category==='Technology'?175:category==='Furniture'?135:24)*(0.35+random()*1.8)*(1+month*.012)*(region==='West'?1.12:1);
    const sales=Math.round(unit*quantity*(1-discount)*100)/100,profit=Math.round(sales*(.06+random()*.3-discount*.65)*100)/100;
    rows.push({'Order ID':`LA-${String(offset+i+1).padStart(7,'0')}`,'Order Date':date.toISOString().slice(0,10),Month:date.toISOString().slice(0,7),Category:category,'Sub-Category':sub,Region:region,Segment:segment,'Customer ID':`C-${String(1+Math.floor(random()*1100)).padStart(4,'0')}`,Sales:sales,Profit:profit,Quantity:quantity,Discount:discount,'Shipping Days':1+Math.floor(random()*7)});
  }
  return rows;
}
