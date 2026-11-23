import type {ClientIdentity} from './types.js';
import type {FabricService} from './gateway.js';
export function reportSubject(fabric: FabricService, identity: ClientIdentity, subject: string) {
  const batch = subject.startsWith('batch:');
  return fabric.query<{inspectionVersion:number; holderMSP:string}>(identity, batch ? 'batchStatus' : 'asset', batch ? subject.slice(6) : subject);
}
