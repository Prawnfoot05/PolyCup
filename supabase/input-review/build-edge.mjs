// Local build only. Cached public references never enter the game bundle.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {build} from '../worker/node_modules/esbuild/lib/main.js';
import {loadCorpus} from './processor.ts';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const corpus=await loadCorpus(root+'output/input-review/references');
if(corpus.manifest.tracks.length!==87 || corpus.references.length!==870) throw Error('Complete 87 x 10 reference snapshot required');
const tracks={};
for(const t of corpus.manifest.tracks){const data=JSON.parse(await readFile(root+'output/input-review/references/'+t.track+'.json','utf8'));
 tracks[t.track]={digest:data.trackDigest,entries:data.entries.filter(e=>e.available&&e.rank<=10).map(e=>({id:e.id,rank:e.rank,finish:e.frames,recording:e.recording}))};}
const payload={digest:corpus.digest,gameVersion:corpus.manifest.gameVersion,tracks};
await mkdir(root+'supabase/input-review/generated',{recursive:true});
await writeFile(root+'supabase/input-review/generated/corpus.json',JSON.stringify(payload));
await build({entryPoints:[root+'supabase/input-review/edge-handler.ts'],outfile:root+'supabase/functions/_shared/input-review.mjs',bundle:true,platform:'node',target:'es2022',format:'esm',packages:'external',banner:{js:'// Generated locally by input-review/build-edge.mjs. No deployment.'}});
console.log(JSON.stringify({tracks:87,references:870,corpusBytes:Buffer.byteLength(JSON.stringify(payload)),digest:corpus.digest}));
