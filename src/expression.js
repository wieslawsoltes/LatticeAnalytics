/** Lattice's non-eval expression compiler: tokenizer -> typed AST -> bytecode VM. */
export class ExpressionError extends Error {
  constructor(message, position = 0) { super(`${message} (at ${position + 1})`); this.name = 'ExpressionError'; this.position = position; }
}
const dateValue = v => v == null ? null : typeof v === 'number' ? v : Date.parse(v);
const fn = (min, max, args, result, run) => ({ min, max, args, result, run });
const numberArgs = ['number'];
const textArgs = ['string'];
const funcs = {
  ABS: fn(1,1,numberArgs,'number',Math.abs), FLOOR: fn(1,1,numberArgs,'number',Math.floor),
  CEIL: fn(1,1,numberArgs,'number',Math.ceil), SQRT: fn(1,1,numberArgs,'number',Math.sqrt),
  LOG: fn(1,1,numberArgs,'number',Math.log), POWER: fn(2,2,numberArgs,'number',Math.pow),
  ROUND: fn(1,2,numberArgs,'number',(v,n=0)=>Math.round((v+Number.EPSILON)*10**n)/10**n),
  MIN: fn(2,32,numberArgs,'number',Math.min), MAX: fn(2,32,numberArgs,'number',Math.max),
  UPPER: fn(1,1,textArgs,'string',s=>s.toUpperCase()), LOWER: fn(1,1,textArgs,'string',s=>s.toLowerCase()),
  TRIM: fn(1,1,textArgs,'string',s=>s.trim()), LEN: fn(1,1,textArgs,'number',s=>s.length),
  CONTAINS: fn(2,2,textArgs,'boolean',(s,t)=>s.includes(t)), STARTSWITH: fn(2,2,textArgs,'boolean',(s,t)=>s.startsWith(t)),
  ENDSWITH: fn(2,2,textArgs,'boolean',(s,t)=>s.endsWith(t)), CONCAT: fn(2,32,['any'],'string',(...x)=>x.join('')),
  LEFT: fn(2,2,['string','number'],'string',(s,n)=>s.slice(0,n)), RIGHT: fn(2,2,['string','number'],'string',(s,n)=>n<=0?'':s.slice(-n)),
  REPLACE: fn(3,3,textArgs,'string',(s,a,b)=>s.split(a).join(b)),
  STR: fn(1,1,['any'],'string',String), FLOAT: fn(1,1,['any'],'number',v=>v===''?null:Number(v)),
  YEAR: fn(1,1,['date|string'],'number',v=>new Date(dateValue(v)).getUTCFullYear()),
  QUARTER: fn(1,1,['date|string'],'number',v=>Math.floor(new Date(dateValue(v)).getUTCMonth()/3)+1),
  MONTH: fn(1,1,['date|string'],'number',v=>new Date(dateValue(v)).getUTCMonth()+1),
  DAY: fn(1,1,['date|string'],'number',v=>new Date(dateValue(v)).getUTCDate()),
  DATE: fn(1,1,['date|string'],'date',dateValue),
  DATETRUNC: fn(2,2,['string','date|string'],'date',(part,v)=>{
    const d=new Date(dateValue(v)); const p=part.toLowerCase();
    if(!['year','quarter','month','day','hour'].includes(p)) return null;
    if(p==='year') d.setUTCMonth(0,1);
    if(p==='quarter') d.setUTCMonth(Math.floor(d.getUTCMonth()/3)*3,1);
    if(p==='month') d.setUTCDate(1);
    if(p!=='hour') d.setUTCHours(0); d.setUTCMinutes(0,0,0); return +d;
  }),
  DATEDIFF: fn(3,3,['string','date|string','date|string'],'number',(part,a,b)=>{
    const x=new Date(dateValue(a)), y=new Date(dateValue(b));
    if(part.toLowerCase()==='year')return y.getUTCFullYear()-x.getUTCFullYear();
    if(part.toLowerCase()==='month')return (y.getUTCFullYear()-x.getUTCFullYear())*12+y.getUTCMonth()-x.getUTCMonth();
    const scales={day:86400000,hour:3600000,minute:60000,second:1000};return scales[part.toLowerCase()]?Math.trunc((y-x)/scales[part.toLowerCase()]):null;
  }),
  ISNULL: fn(1,1,['any'],'boolean',v=>v==null),
  IFNULL: fn(2,2,['any'],'same',(a,b)=>a??b), COALESCE: fn(2,32,['any'],'same',(...a)=>a.find(v=>v!=null)??null),
  IIF: fn(3,3,['boolean','any','any'],'branch',(c,a,b)=>c?a:b)
};
const precedence = { OR:1, AND:2, '=':3, '==':3, '!=':3, '<>':3, '<':3, '>':3, '<=':3, '>=':3, '+':4, '-':4, '*':5, '/':5, '%':5, '^':6 };
function tokenize(source) {
  const out=[]; let i=0;
  while(i<source.length){
    const p=i,c=source[i];
    if(/\s/.test(c)){i++;continue;}
    if(c==='['){let name='';i++;let closed=false;while(i<source.length){if(source[i]===']'){if(source[i+1]===']'){name+=']';i+=2;}else{i++;closed=true;break;}}else name+=source[i++];}if(!closed)throw new ExpressionError('Unclosed field reference',p);out.push({k:'field',v:name,p});continue;}
    if(c==='"'||c==="'"){let s='';i++;let closed=false;while(i<source.length){if(source[i]===c){if(source[i+1]===c){s+=c;i+=2;}else{i++;closed=true;break;}}else if(source[i]==='\\'){i++;const t=source[i++];s+=({n:'\n',t:'\t',r:'\r'}[t]??t);}else s+=source[i++];}if(!closed)throw new ExpressionError('Unclosed string',p);out.push({k:'literal',v:s,p});continue;}
    const n=source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if(n){out.push({k:'literal',v:Number(n[0]),p});i+=n[0].length;continue;}
    const id=source.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if(id){const v=id[0].toUpperCase();out.push(v==='TRUE'||v==='FALSE'||v==='NULL'?{k:'literal',v:v==='NULL'?null:v==='TRUE',p}:{k:'id',v,p});i+=id[0].length;continue;}
    const op=source.slice(i,i+2);if(['<=','>=','!=','<>','=='].includes(op)){out.push({k:'op',v:op,p});i+=2;continue;}
    if('+-*/%^=<>(),'.includes(c)){out.push({k:'op',v:c,p});i++;continue;}
    throw new ExpressionError(`Unexpected character ${JSON.stringify(c)}`,p);
  }
  out.push({k:'eof',v:'EOF',p:i});return out;
}
const compatible=(actual,wanted)=>actual==='null'||wanted==='any'||wanted.split('|').includes(actual);
function mergeType(types,p){const valid=[...new Set(types.filter(t=>t!=='null'))];if(valid.length>1)throw new ExpressionError(`Incompatible result types: ${valid.join(', ')}`,p);return valid[0]??'null';}
export function compileExpression(source,schema){
  if(typeof source!=='string'||source.length>16000)throw new ExpressionError('Expression must be text, at most 16,000 characters');
  const fields=new Map(schema.map(s=>[s.name,s.type]));const tokens=tokenize(source);let at=0,depth=0;const dependencies=new Set();
  const peek=()=>tokens[at],take=()=>tokens[at++];
  const expect=v=>{const t=take();if(t.v!==v)throw new ExpressionError(`Expected ${v}, received ${t.v}`,t.p);};
  function parse(min=0){if(++depth>128)throw new ExpressionError('Expression nesting exceeds 128 levels',peek().p);let n;const t=take();
    if(t.k==='literal')n={kind:'literal',value:t.v,type:t.v===null?'null':typeof t.v,p:t.p};
    else if(t.k==='field'){if(!fields.has(t.v))throw new ExpressionError(`Unknown field [${t.v}]`,t.p);dependencies.add(t.v);n={kind:'field',name:t.v,type:fields.get(t.v),p:t.p};}
    else if(t.v==='('){n=parse();expect(')');}
    else if(['+','-','NOT'].includes(t.v)){const a=parse(t.v==='NOT'?3:7);const want=t.v==='NOT'?'boolean':'number';if(!compatible(a.type,want))throw new ExpressionError(`${t.v} expects ${want}`,t.p);n={kind:'unary',op:t.v,a,type:want,p:t.p};}
    else if(t.v==='IF'){const condition=parse();expect('THEN');const yes=parse();expect('ELSE');const no=parse();expect('END');if(!compatible(condition.type,'boolean'))throw new ExpressionError('IF condition must be boolean',t.p);n={kind:'if',condition,yes,no,type:mergeType([yes.type,no.type],t.p),p:t.p};}
    else if(t.k==='id'){const f=funcs[t.v];if(!f)throw new ExpressionError(`Unknown function ${t.v}`,t.p);expect('(');const args=[];if(peek().v!==')'){do{args.push(parse());if(peek().v!==',')break;take();}while(true);}expect(')');
      if(args.length<f.min||args.length>f.max)throw new ExpressionError(`${t.v} expects ${f.min===f.max?f.min:`${f.min}–${f.max}`} arguments`,t.p);
      args.forEach((a,i)=>{const wanted=f.args[Math.min(i,f.args.length-1)];if(!compatible(a.type,wanted))throw new ExpressionError(`${t.v} argument ${i+1} expects ${wanted}, received ${a.type}`,a.p);});
      const type=f.result==='same'?mergeType(args.map(a=>a.type),t.p):f.result==='branch'?mergeType(args.slice(1).map(a=>a.type),t.p):f.result;
      n=t.v==='IIF'?{kind:'if',condition:args[0],yes:args[1],no:args[2],type,p:t.p}:{kind:'call',name:t.v,args,type,p:t.p};
    }else throw new ExpressionError(`Expected a value, received ${t.v}`,t.p);
    while(precedence[peek().v]>=min){const op=take();const b=parse(precedence[op.v]+(op.v==='^'?0:1));let type;
      if(['AND','OR'].includes(op.v)){if(!compatible(n.type,'boolean')||!compatible(b.type,'boolean'))throw new ExpressionError(`${op.v} expects booleans`,op.p);type='boolean';}
      else if(precedence[op.v]===3){if(n.type!==b.type&&n.type!=='null'&&b.type!=='null')throw new ExpressionError('Comparison operands have different types',op.p);type='boolean';}
      else {if(!compatible(n.type,'number')||!compatible(b.type,'number'))throw new ExpressionError('Arithmetic expects numeric operands; use CONCAT for text',op.p);type='number';}
      n={kind:'binary',op:op.v,a:n,b,type,p:op.p};
    }depth--;return n;
  }
  const ast=parse();if(peek().k!=='eof')throw new ExpressionError(`Unexpected token ${peek().v}`,peek().p);
  const code=[];function emit(n){if(n.kind==='literal')code.push(['const',n.value]);else if(n.kind==='field')code.push(['load',n.name]);else if(n.kind==='unary'){emit(n.a);code.push(['unary',n.op]);}else if(n.kind==='binary'){emit(n.a);emit(n.b);code.push(['binary',n.op]);}else if(n.kind==='call'){n.args.forEach(emit);code.push(['call',n.name,n.args.length]);}else{emit(n.condition);const a=code.length;code.push(['branch',0]);emit(n.yes);const b=code.length;code.push(['jump',0]);code[a][1]=code.length;emit(n.no);code[b][1]=code.length;}}emit(ast);
  return {source,type:ast.type==='null'?'number':ast.type,dependencies:[...dependencies],code};
}
function binary(op,a,b){
  if(op==='AND')return a===false||b===false?false:a==null||b==null?null:true;
  if(op==='OR')return a===true||b===true?true:a==null||b==null?null:false;
  if(a==null||b==null)return null;
  switch(op){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return b===0?null:a/b;case '%':return b===0?null:a%b;case '^':return a**b;case '=':case '==':return a===b;case '!=':case '<>':return a!==b;case '<':return a<b;case '<=':return a<=b;case '>':return a>b;case '>=':return a>=b;default:throw new Error(`Unknown operator ${op}`);}
}
export function evaluateExpression(compiled,get){
  const stack=[];const code=compiled.code;let ip=0;
  while(ip<code.length){const [op,arg,n]=code[ip++];
    if(op==='const')stack.push(arg);else if(op==='load')stack.push(get(arg));
    else if(op==='unary'){const v=stack.pop();stack.push(v==null?null:arg==='NOT'?!v:arg==='-'?-v:+v);}
    else if(op==='binary'){const b=stack.pop(),a=stack.pop();stack.push(binary(arg,a,b));}
    else if(op==='call'){const args=stack.splice(stack.length-n,n);stack.push(!['ISNULL','IFNULL','COALESCE'].includes(arg)&&args.some(v=>v==null)?null:funcs[arg].run(...args));}
    else if(op==='branch'){if(!stack.pop())ip=arg;}else if(op==='jump')ip=arg;
  }
  const v=stack[0];return typeof v==='number'&&!Number.isFinite(v)?null:v;
}
export const expressionFunctions=Object.keys(funcs);
