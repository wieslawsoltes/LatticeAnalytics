import { AnalyticsEngine, parseCSV, parseJSON, generateSample } from './core.js';
import { compileExpression, evaluateExpression, expressionFunctions } from './expression.js';
const engine=new AnalyticsEngine();
self.onmessage=async ({data:{id,method,args={}}})=>{
  try{let value;
    switch(method){
      case 'reset':engine.clear();value=true;break;
      case 'sample':value=engine.add(args.id,args.name,generateSample(args.count));break;
      case 'import':value=engine.add(args.id,args.name,args.format==='csv'?parseCSV(args.text).rows:parseJSON(args.text));break;
      case 'add':value=engine.add(args.id,args.name,args.rows,args.schema);break;
      case 'restore':{
        // Restore into a staging engine first. Bad workbooks leave the current data intact.
        const staging=new AnalyticsEngine();for(const s of args.sources){staging.add(s.id,s.name,s.rows,s.schema);staging.table(s.id).setDefinitions(s.definitions??[]);}engine.tables=staging.tables;engine.cache.clear();value=[...engine.tables.keys()].map(k=>engine.describe(k));break;
      }
      case 'describe':value=engine.describe(args.tableId);break;
      case 'query':value=engine.query(args);break;
      case 'preview':{const t=engine.table(args.tableId);value={rows:t.exportRows(args.offset??0,(args.offset??0)+(args.limit??100)),total:t.length,schema:t.schema};break;}
      case 'distinct':value=engine.distinct(args.tableId,args.field);break;
      case 'definitions':engine.table(args.tableId).setDefinitions(args.definitions);value=engine.describe(args.tableId);break;
      case 'validateExpression':{const t=engine.table(args.tableId),c=compileExpression(args.expression,t.schema);value={type:c.type,dependencies:c.dependencies,bytecode:c.code,preview:Array.from({length:Math.min(t.length,5)},(_,i)=>evaluateExpression(c,f=>t.get(f,i))),functions:expressionFunctions};break;}
      case 'join':value=engine.join(args);break;
      case 'append':{const t=engine.table(args.tableId),rows=args.sample?generateSample(args.count??1000,t.length):args.format==='csv'?parseCSV(args.text).rows:parseJSON(args.text);t.append(rows);value=engine.describe(args.tableId);break;}
      case 'snapshot':value=engine.snapshot();break;
      case 'export':{const t=engine.table(args.tableId);value=t.exportRows();break;}
      default:throw new Error(`Unknown worker request ${method}`);
    }
    self.postMessage({id,value});
  }catch(e){self.postMessage({id,error:{message:e.message,name:e.name,stack:e.stack}});}
};
