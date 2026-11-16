import https from 'node:https';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export class ApiClient{
  constructor(){this.runtime=path.dirname(process.env.TRUSTGUARD_IDENTITIES_FILE);this.agents=new Map();}
  async agent(who){
    if(!this.agents.has(who)){
      const [org,role]=who.split('-'),base=path.join(this.runtime,'organizations',org,'users',role);
      this.agents.set(who,new https.Agent({cert:await readFile(path.join(base,'api.crt')),key:await readFile(path.join(base,'api.key')),ca:await readFile(path.join(this.runtime,'server-ca/ca.crt'))}));
    }return this.agents.get(who);
  }
  async call(who,method,route,body){
    const agent=await this.agent(who),payload=body===undefined?undefined:JSON.stringify(body);
    return new Promise((resolve,reject)=>{
      const req=https.request('https://localhost:13000/api/v1'+route,{method,agent,timeout:120000,headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}},res=>{
        const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>{const data=Buffer.concat(parts);resolve({status:res.statusCode,body:res.headers['content-type']?.includes('application/json')?JSON.parse(data.toString()):data});});
      });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('LOCAL_API_TIMEOUT')));req.end(payload);
    });
  }
  async ready(){for(let i=0;i<60;i++){try{const r=await this.call('cell-viewer','GET','/health');if(r.status===200)return;}catch(error){if(error.code!=='ECONNREFUSED')throw error;}await delay(250);}throw new Error('API_NOT_READY');}
  close(){for(const agent of this.agents.values())agent.destroy();}
}
