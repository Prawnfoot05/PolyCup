async (page) => {
 const context=page.context();
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const user={id:id(1),aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord',providers:['discord']},
   user_metadata:{full_name:'Kiki',user_name:'kiki'},created_at:new Date().toISOString()};
 const encoded=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token=encoded({alg:'HS256',typ:'JWT'})+'.'+encoded({sub:id(1),exp:Math.floor(Date.now()/1000)+3600})+'.test-signature';
 const friend={player_id:id(2),display_name:'AlexandriaTheVeryLongRacerName',discord_name:'Alexandria',discord_username:'alexandria',avatar_url:'',rating:25123,
   friendship_id:id(55),direction:'outgoing',status:'accepted',online:true};
 let failure=false,delay=0,requests=[];
 const rows=Array.from({length:23},(_,i)=>({match_id:id(100+i),finished_at:new Date(Date.UTC(2026,9,22,12)-i*86400000).toISOString(),place:i%4+1,
   player_count:4,rounds:19,rating_before:i===22?null:12500,rating_after:12500+(i%2? -492:496),model_version:'btf-6.2.0-t025-softplus-v1'}));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await context.route('https://wqaipijoqqqrwyivajjg.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/profiles'))return route.fulfill({json:{display_name:'Kiki'}});
   if(path.endsWith('/player_ratings'))return route.fulfill({json:{rating:12996}});
   if(path.endsWith('/user'))return route.fulfill({json:user});
   if(path.endsWith('/polycup_friends'))return route.fulfill({json:[friend]});
   if(path.endsWith('/polycup_ranked_history')){
     const args=route.request().postDataJSON();requests.push(args);
     const capturedDelay=delay,capturedFailure=failure;
     if(capturedDelay)await new Promise(r=>setTimeout(r,capturedDelay));
     if(capturedFailure)return route.fulfill({status:503,json:{message:'Synthetic outage'}});
     return route.fulfill({json:args.player_key===id(2)?[]:rows.slice(args.page_offset,args.page_offset+args.page_size)});
   }
   if(path.endsWith('/polycup_ranked_match'))return route.fulfill({json:{match_id:id(100),finished_at:rows[0].finished_at,rounds:19,
     players:[1,2,3,4].map((n,i)=>({player_id:id(n),display_name:n===2?friend.display_name:n===1?'Kiki':'Racer '+n,place:n,rating_before:12500,rating_after:12500+[496,165,-164,-492][i]}))}});
   return route.fulfill({json:[]});
 });
 await context.addInitScript(({user,token})=>localStorage.setItem('polycup.account.v1',JSON.stringify({access_token:token,refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})),{user,token});
 await page.setViewportSize({width:1000,height:800});
 await page.goto('http://127.0.0.1:8847/');
 const own=page.locator('#account-match-history');
 await own.waitFor();await own.click();
 const dialog=page.getByRole('dialog',{name:'Match history',exact:true});
 await dialog.locator('.ranked-history-row').first().waitFor();
 if(await dialog.locator('.ranked-history-row').count()!==20)throw new Error('Wrong first-page size');
 await page.screenshot({path:'output/playwright/ranked-history-list.png'});
 await dialog.getByRole('button',{name:'Next',exact:true}).click();
 await dialog.getByText('Page 2',{exact:true}).waitFor();
 if(await dialog.locator('.ranked-history-row').count()!==3)throw new Error('Wrong second-page size');
 await dialog.getByText('First rating',{exact:true}).waitFor();
 if(!await dialog.getByRole('button',{name:'Next',exact:true}).isDisabled())throw new Error('Next enabled at end');
 await dialog.getByRole('button',{name:'Previous',exact:true}).click();
 await dialog.getByText('Page 1',{exact:true}).waitFor();
 await dialog.locator('.ranked-history-row').first().click();
 const result=page.getByRole('dialog',{name:'Match result',exact:true});
 await result.getByText(friend.display_name,{exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/ranked-history-result.png'});
 await page.setViewportSize({width:360,height:740});
 if(await result.evaluate(e=>e.scrollWidth>e.clientWidth))throw new Error('Narrow dialog overflows');
 await page.screenshot({path:'output/playwright/ranked-history-narrow.png'});
 await result.getByRole('button',{name:'Close match history'}).click();
 await page.setViewportSize({width:1000,height:800});
 await page.getByRole('button',{name:friend.display_name,exact:true}).click();
 await page.locator('.friend-profile').getByRole('button',{name:'Match history',exact:true}).click();
 await dialog.getByText('No rated matches yet.',{exact:true}).waitFor();
 if(requests.at(-1).player_key!==id(2))throw new Error('Friend history loaded wrong account');
 await dialog.getByRole('button',{name:'Close match history'}).click();
 // Failed read must not masquerade as an empty history.
 failure=true;await own.click();
 await dialog.getByRole('alert').waitFor();
 if(await dialog.getByText('No rated matches yet.').count())throw new Error('Failure shown as empty');
 failure=false;await dialog.getByRole('button',{name:'Retry'}).click();
 await dialog.locator('.ranked-history-row').first().waitFor();
 await dialog.getByRole('button',{name:'Close match history'}).click();
 // Closing a slow request and opening another player's history fences the response.
 delay=900;await own.click();
 await dialog.getByText('Loading…',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Close match history'}).click();
 delay=0;
 await page.locator('.friend-profile').getByRole('button',{name:'Match history',exact:true}).click();
 await dialog.getByText('No rated matches yet.',{exact:true}).waitFor();
 await page.waitForTimeout(1100);
 if(await dialog.locator('.ranked-history-row').count())throw new Error('Stale response replaced friend history');
 await page.screenshot({path:'output/playwright/ranked-history-empty.png'});
 console.log(JSON.stringify({passed:true,checks:['own header entry','friend entry','pagination','match detail','first rating','narrow layout','error retry','stale response'],historyRequests:requests.length}));
}
