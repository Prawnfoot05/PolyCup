// From project root: node supabase/worker/tests/run-edge-qa.mjs
// Creates disposable containers only, bound to loopback. No hosted services.
import { execFile as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,writeFile,copyFile,unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
const execFile=promisify(execCallback);
const docker=(...args)=>execFile('docker',args,{timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
const pgImage='public.ecr.aws/supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00';
const edgeImage='public.ecr.aws/supabase/edge-runtime:v1.77.4@sha256:ad45164b7548bf5820ed7be714789c17ac2865edce79a09cfb4c3756c3d365a8';
const dbName='polycup-edge-qa-db-'+process.pid,edgeName='polycup-edge-qa-runtime-'+process.pid;
const root=path.resolve('output/edge-runtime-qa');
const psql=sql=>docker('exec',dbName,'psql','-U','supabase_admin','-d','polycup_worker_test','-v','ON_ERROR_STOP=1','-c',sql);
let dbStarted=false,edgeStarted=false;
try{
 await execFile(process.execPath,['build-edge.mjs'],{cwd:path.resolve('supabase/worker'),windowsHide:true});
 for(const dir of ['supabase/functions/polycup-results','supabase/functions/_shared','supabase/worker/tests/edge-main'])await mkdir(path.join(root,dir),{recursive:true});
 for(const f of ['supabase/functions/polycup-results/index.ts','supabase/functions/polycup-results/deno.json','supabase/functions/_shared/ranked-worker.mjs','supabase/worker/tests/edge-main/index.ts'])await copyFile(f,path.join(root,f));
 await writeFile(path.join(root,'qa.env'),'POLYCUP_RESULT_CRON_TOKEN='+randomBytes(32).toString('hex')+'\nPOLYCUP_RESULT_WORKER_ENABLED=1\nPOLYCUP_RESULT_LOCAL_TEST=1\nPOLYCUP_RESULT_DATABASE_URL=postgresql://worker_login@127.0.0.1:5432/polycup_worker_test\n');
 await docker('run','--detach','--rm','--name',dbName,'--label','polycup.qa=edge-results','--publish','127.0.0.1:55439:5432','--publish','127.0.0.1:8831:9000',
   '--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=polycup_worker_test',pgImage,'postgres','-c','config_file=/etc/postgresql/postgresql.conf','-c','cron.database_name=polycup_worker_test','-c','pg_net.database_name=polycup_worker_test');dbStarted=true;
 let ready=false,lastState='starting';
 for(let n=0;n<60;n++){try{const startup=await docker('logs',dbName);lastState='initialization';if(!(startup.stdout+startup.stderr).includes('PostgreSQL init process complete'))throw Error('Still initializing');await psql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
 if(!ready)throw Error('Disposable database did not start: '+lastState);
 // Only this newly created, loopback-bound container gets trust authentication
 // and a synthetic auth schema. Never apply these fixture steps to any host DB.
 await docker('exec',dbName,'sh','-c',"printf 'local all all trust\\nhost all all all trust\\n' > /etc/postgresql/pg_hba.conf");
 await psql('select pg_reload_conf()');
 await psql('alter database polycup_worker_test owner to postgres');
 await psql('drop schema auth cascade;create schema auth authorization postgres');
 await docker('run','--detach','--rm','--name',edgeName,'--label','polycup.qa=edge-results','--network','container:'+dbName,
   '--mount','type=bind,source='+root+',target=/workspace,readonly','--env-file',path.join(root,'qa.env'),edgeImage,
   'start','--main-service','/workspace/supabase/worker/tests/edge-main','--policy','per_request');edgeStarted=true;
 for(let n=0;n<60;n++){try{if((await fetch('http://127.0.0.1:8831/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 console.log('Testing isolated Supabase Edge Runtime, Cron, pg_net and Vault.');
 const result=await execFile(process.execPath,['--test','--test-force-exit',...(process.env.POLYCUP_EDGE_WAKE_ONLY==='1'?['--test-skip-pattern=four ordinary|normal and 1,000-round']:[]),'supabase/worker/tests/edge-runtime.test.mjs'],{timeout:180000,maxBuffer:4*1024*1024,windowsHide:true});
 await writeFile('output/edge-runtime-tests.log',result.stdout+result.stderr);process.stdout.write(result.stdout);
}catch(error){
 await writeFile('output/edge-runtime-verification.json',JSON.stringify({passed:false,scope:'Local Edge QA; see edge-runtime-tests.log for failures.'}));
 if(error.stdout){await writeFile('output/edge-runtime-tests.log',error.stdout+(error.stderr??''));process.stdout.write(error.stdout);}
 else console.error('Local Edge QA setup failed:',String(error.stderr??error.code??error.message??'unknown').slice(0,800));
 process.exitCode=1;
}finally{
 if(edgeStarted)await docker('stop',edgeName).catch(()=>{});
 if(dbStarted)await docker('stop',dbName).catch(()=>{});
 await unlink(path.join(root,'qa.env')).catch(()=>{});
}
