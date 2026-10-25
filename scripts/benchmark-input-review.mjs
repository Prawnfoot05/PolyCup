import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {decodeRecording,compare,POLICY,digest} from '../supabase/input-review/matcher.ts';
import {loadCorpus} from '../supabase/input-review/processor.ts';
const folder='output/input-review/references',corpus=await loadCorpus(folder),started=performance.now();
let wholeEligible=0,wholeDetected=0,segmentEligible=0,segmentDetected=0,holdouts=0,negativeComparisons=0,referencePairs=0;
const candidateMatches=[],sample=[];
for(const track of corpus.manifest.tracks){
 const data=JSON.parse(await readFile(folder+'/'+track.track+'.json','utf8')),refs=corpus.references.filter(r=>r.track===track.track);
 for(const r of refs){
  const whole=compare(r,r);if(whole){wholeEligible++;assert.equal(whole.kind,'whole');wholeDetected++;}
  // Exact contiguous source sequence inserted after an unrelated lead-in.
  const first=Math.floor(r.events.length*.15),last=Math.floor(r.events.length*.85),slice=r.events.slice(first,last);
  if(slice.length>POLICY.transitions){
   const shifted=slice.map(([t,m])=>[t-slice[0][0]+1753,m]),run={events:[[0,0],...shifted],finish:shifted.at(-1)[0]+733};
   const baseline={...r,events:slice.map(([t,m])=>[t-slice[0][0],m]),finish:slice.at(-1)[0]-slice[0][0]+733};
   if(compare(run,baseline)){segmentEligible++;const hit=compare(run,r);assert.ok(hit,'Qualifying inserted segment missed');assert.equal(hit.kind,'segment');segmentDetected++;if(sample.length<3)sample.push({source:r.id,track:r.track,...hit});}
  }
 }
 for(let i=0;i<refs.length;i++)for(let j=i+1;j<refs.length;j++){referencePairs++;const f=compare(refs[i],refs[j]);if(f)candidateMatches.push({cohort:'independent public reference pair',track:track.track,left:refs[i].id,right:refs[j].id,...f});}
 for(const e of data.entries.filter(e=>e.available&&e.rank>10)){
  holdouts++;const run=decodeRecording(e.recording,e.frames);
  for(const r of refs){negativeComparisons++;const f=compare(run,r);if(f)candidateMatches.push({cohort:'held-out public submission',track:track.track,left:e.id,right:r.id,...f});}
 }
}
const report={at:new Date().toISOString(),policy:POLICY,corpus:corpus.digest,tracks:corpus.manifest.tracks.length,references:corpus.references.length,wholeEligible,wholeDetected,wholeNotFlaggedAsSimple:corpus.references.length-wholeEligible,segmentEligible,segmentDetected,holdouts,negativeComparisons,referencePairs,candidateMatches,sample,elapsedMs:performance.now()-started,scope:'Copied full runs and inserted exact segments are synthetic positives. Independent public verified submissions are comparison controls, not proof of human input. No bans, rating changes, or accusations.'};
await mkdir('output/input-review',{recursive:true});await writeFile('output/input-review/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,sample:undefined,candidateMatches:candidateMatches.length}));
