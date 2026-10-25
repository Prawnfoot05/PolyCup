async (page) => {
 const origin='http://127.0.0.1:8796', api='http://127.0.0.1:8811';
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
 const contexts=[],clients=[],tokens=[];let step='setup';
 try{
  for(let n=1;n<=3;n++){
   const user={id:id(n),aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},
     user_metadata:{full_name:['Alice','Bob','Charlie'][n-1],custom_claims:{global_name:['Alice display','Bob display','Charlie display'][n-1]}},created_at:new Date().toISOString()};
   const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})}.test-signature`;
   tokens.push(token);
   const session={access_token:token,refresh_token:'test-refresh-'+n,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
   const context=await page.context().browser().newContext({viewport:{width:1100,height:850},storageState:{cookies:[],origins:[{origin,localStorage:[{name:'polycup.account.v1',value:JSON.stringify(session)}]}]}});
   contexts.push(context);
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'||(url.hostname==='cdn.polymodloader.com'&&route.request().method()==='GET'))return route.continue();
    if(url.hostname==='wqaipijoqqqrwyivajjg.supabase.co'){
      const response=await context.request.fetch(api+url.pathname+url.search,{method:route.request().method(),headers:{authorization:route.request().headers().authorization??'','content-type':'application/json'},data:route.request().postData()??undefined});
      return route.fulfill({response});
    }
    return route.abort();
   });
   await context.routeWebSocket('**/*',socket=>socket.close());
   const client=await context.newPage();clients.push(client);
   const presence=client.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/polycup_presence_touch'));
   await client.goto(origin);await client.locator('#polytrack-world-cup').waitFor({state:'attached'});
   // Presence must begin before the Account panel is opened.
   await presence;
   await client.keyboard.press('F8');await client.getByRole('button',{name:'Account',exact:true}).click();
   await client.getByRole('button',{name:'Add friend',exact:true}).waitFor();
  }
  const [a,b,c]=clients;
  for(let i=0;i<contexts.length;i++) {
   const headers={authorization:'Bearer '+tokens[i]};
   const existing=await contexts[i].request.post(api+'/rest/v1/rpc/polycup_friends',{headers,data:{}});
   for(const rel of await existing.json())await contexts[i].request.delete(api+`/rest/v1/friendships?id=eq.${rel.friendship_id}&status=eq.${rel.status}`,{headers});
  }
  step='send and decline';
  const view=async(client,name)=>{await client.locator('.account-tabs').getByRole('button',{name,exact:true}).click();};
  const requests=async(client)=>{await client.getByRole('button',{name:/^Requests(?: \(\d+\))?$/}).click();};
  const find=async(client,query)=>{
   await view(client,'Add friend');await client.getByRole('textbox',{name:'Player name or friend code',exact:true}).fill(query);
   await client.getByRole('button',{name:'Search',exact:true}).click();
  };
  const row=(client,person)=>client.locator(`.friend-row[data-player-id="${person}"]`);
  await find(a,'Bob');await row(a,id(2)).getByRole('button',{name:'Add friend',exact:true}).click();
  await row(a,id(2)).getByText('Request sent',{exact:true}).waitFor();
  await requests(b);await row(b,id(1)).getByRole('button',{name:'Decline',exact:true}).click();
  await row(b,id(1)).waitFor({state:'hidden'});
  await requests(a);await a.getByRole('heading',{name:'Sent 0',exact:true}).waitFor();
  step='accept';
  await find(a,id(2));await row(a,id(2)).getByRole('button',{name:'Add friend',exact:true}).click();
  await row(a,id(2)).getByText('Request sent',{exact:true}).waitFor();
  await requests(b);await row(b,id(1)).getByRole('button',{name:'Accept',exact:true}).click();
  await view(a,'Friends');await row(a,id(2)).getByText('Online',{exact:true}).waitFor();
  await view(b,'Friends');await row(b,id(1)).getByText('Online',{exact:true}).waitFor();
  await view(c,'Friends');await c.getByRole('heading',{name:'Online (0)',exact:true}).waitFor();
  if(await c.locator('.friend-row').count())throw new Error('Outsider saw friendship');
  await row(a,id(2)).getByRole('button',{name:'Bob',exact:true}).click();
  await row(a,id(2)).getByText('Bob display',{exact:true}).waitFor();
  await row(a,id(2)).getByText('Rank: Unranked',{exact:true}).waitFor();
  await a.screenshot({path:'output/account-preview/friends-profile.png',animations:'disabled'});
  await a.setViewportSize({width:390,height:800});
  await a.screenshot({path:'output/account-preview/friends-mobile.png',animations:'disabled'});
  step='multiple windows';
  const secondBob=await contexts[1].newPage();await secondBob.goto(origin);
  await secondBob.locator('#polytrack-world-cup').waitFor({state:'attached'});
  await secondBob.keyboard.press('F8');await secondBob.getByRole('button',{name:'Account',exact:true}).click();
  await secondBob.getByRole('button',{name:'Friends',exact:true}).click();
  const count=await page.request.post(api+'/test/count',{data:{user:id(2)}});
  if((await count.json()).n<2)throw new Error('Second window did not establish independent presence');
  await secondBob.close();await view(a,'Friends');await row(a,id(2)).getByText('Online',{exact:true}).waitFor();
  step='offline and reconnect';
  await contexts[1].setOffline(true);
  await page.request.post(api+'/test/expire',{data:{user:id(2)}});
  await view(a,'Friends');await row(a,id(2)).getByText('Offline',{exact:true}).waitFor();
  await contexts[1].setOffline(false);await b.evaluate(()=>window.dispatchEvent(new Event('online')));
  await view(b,'Friends');await row(b,id(1)).getByText('Online',{exact:true}).waitFor();
  await view(a,'Friends');await row(a,id(2)).getByText('Online',{exact:true}).waitFor();
  step='remove and cancel';
  // Closing and reopening the dialog does not tear down background presence.
  await a.keyboard.press('F8');await a.getByRole('button',{name:'Account',exact:true}).click();await view(a,'Friends');
  if(!await row(a,id(2)).getByRole('button',{name:'Remove friend',exact:true}).count())await row(a,id(2)).getByRole('button',{name:'Bob',exact:true}).click();
  await row(a,id(2)).getByRole('button',{name:'Remove friend',exact:true}).click();
  await row(a,id(2)).getByRole('button',{name:'Remove',exact:true}).click();
  await row(a,id(2)).waitFor({state:'hidden'});
  await view(b,'Friends');await row(b,id(1)).waitFor({state:'hidden'});
  await find(a,'Bob');await row(a,id(2)).getByRole('button',{name:'Add friend',exact:true}).click();
  await row(a,id(2)).getByRole('button',{name:'Cancel request',exact:true}).click();
  await row(a,id(2)).getByRole('button',{name:'Add friend',exact:true}).waitFor();
  await a.getByRole('button',{name:'Sign out',exact:true}).click();
  await a.getByRole('button',{name:'Sign in with Discord',exact:true}).waitFor();
  const after=await page.request.post(api+'/test/count',{data:{user:id(1)}});
  if((await after.json()).n!==0)throw new Error('Sign-out left presence behind');
  return {passed:true,accounts:3,database:'isolated PostgreSQL with actual migrations and RLS',checks:['search by name and code','send','decline','accept','cancel','remove confirmation','profile identity and rank','outsider privacy','online before opening panel','multiple windows','stale expiry','reconnect','sign-out cleanup','mobile layout'],liveAccountWrites:0};
 } catch(error) {
   for(let i=0;i<clients.length;i++) {
    await clients[i].screenshot({path:`output/account-preview/friends-failure-${i}.png`,animations:'disabled'}).catch(()=>{});
    console.log('Failure phase '+step+' client '+i+': '+await clients[i].getByRole('dialog',{name:'PolyCup account',exact:true}).ariaSnapshot().catch(()=>''));
   }
   throw new Error(step+': '+error.message);
 } finally {for(const context of contexts)await context.close();}
}
