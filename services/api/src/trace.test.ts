import test from 'node:test';
import assert from 'node:assert/strict';
import { affectedPacks, type AssemblyEdge } from './trace.js';
import type { Asset } from './types.js';

test('batch trace includes overlapping history and excludes temporally impossible ancestors',()=>{
  const cell={id:'c',type:'CELL'} as Asset,module={id:'m',type:'MODULE'} as Asset,old={id:'old',type:'PACK'} as Asset,future={id:'future',type:'PACK'} as Asset;
  const edge=(id:string,parentId:string,childId:string,activeFrom:string,activeTo:string|null):AssemblyEdge=>({id,parentId,childId,activeFrom,activeTo,revision:1,txId:'tx'});
  const edges=[edge('cm','m','c','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z'),
    edge('mp','old','m','2026-01-05T00:00:00Z','2026-02-01T00:00:00Z'),
    edge('new','future','m','2026-03-01T00:00:00Z',null)];
  assert.deepEqual(affectedPacks([cell],[cell,module,old,future],edges,true).packIds,['old']);
  assert.deepEqual(affectedPacks([cell],[cell,module,old,future],edges,false).packIds,[]);
  assert.deepEqual(affectedPacks([cell],[future,old,module,cell],[...edges].reverse(),true),affectedPacks([cell],[cell,module,old,future],edges,true));
});
