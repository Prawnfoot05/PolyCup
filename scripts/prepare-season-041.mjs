// Builds the reviewed first-season catalog from native collection metadata.
import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile('.research/PolyModLoader/main.bundle.js','utf8');
const catalog=JSON.parse(await readFile('supabase/catalogs/polytrack-0.6.3.json','utf8'));
const groups=new Map([...source.matchAll(/id: "([a-f0-9]{64})",\s+group: "([^"]+)",\s+trackMetadata: \{\s+name: "([^"]+)"/g)].map(m=>[m[1],{collection:m[2],name:m[3]}]));
const community=catalog.entries.filter(t=>t.category==='community');
if(community.some(t=>!groups.has(t.id)))throw Error('Native community collection metadata incomplete');
const latest=[...new Set(community.map(t=>groups.get(t.id).collection))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1);
const entries=catalog.entries.filter(t=>t.category==='official'||groups.get(t.id).collection===latest);
await writeFile('supabase/catalogs/season-1.json',JSON.stringify({id:'season-1',name:'Season 1',gameVersion:'0.6.3',communityCollection:latest,source:'Native bundled track collection metadata; main tracks plus latest CT collection',entries,tracks:entries.map(t=>({id:t.id,...groups.get(t.id)}))},null,2)+'\n');
console.log(JSON.stringify({communityCollection:latest,main:entries.filter(t=>t.category==='official').length,community:entries.filter(t=>t.category==='community').length}));
