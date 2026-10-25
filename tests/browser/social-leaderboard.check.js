async page=>{
 const board=page.getByRole('dialog',{name:'Leaderboards',exact:true});
 if(await board.locator('tbody tr').count()!==25)throw Error('Global page size');
 await board.getByRole('button',{name:'Next',exact:true}).click();await board.getByText('Page 2',{exact:true}).waitFor();
 if(await board.locator('tbody tr').first().locator('td').first().textContent()!=='26')throw Error('Global pagination');
 await board.getByRole('tab',{name:'Friends',exact:true}).click();await board.getByText('Page 1',{exact:true}).waitFor();
 if(await board.locator('tbody tr').count()!==3)throw Error('Friends scope');
 await page.screenshot({path:'output/playwright/leaderboard-friends.png'});
 await board.getByRole('button',{name:'Match history for kiki',exact:true}).click();await page.getByRole('dialog',{name:'Match history',exact:true}).waitFor();
 await page.getByRole('button',{name:'Close match history',exact:true}).click();await board.getByRole('button',{name:'Close leaderboards',exact:true}).click();
 const first=page.locator('.friend-row').first();const before=await first.boundingBox();
 await page.getByRole('button',{name:'Actions for Frostbitten',exact:true}).click();const menu=page.getByRole('menu',{name:'Frostbitten actions'});await menu.waitFor();
 if(!await menu.getByRole('menuitem',{name:'Join game',exact:true}).isVisible())throw Error('Public friend Join game missing');
 const after=await first.boundingBox();if(before.y!==after.y||before.height!==after.height)throw Error('Menu shifted friend list');
 const box=await menu.boundingBox();if(box.x<0||box.x+box.width>page.viewportSize().width||box.y+box.height>page.viewportSize().height)throw Error('Menu clipped');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Actions for Monstrosity',exact:true}).click();const offline=page.getByRole('menu',{name:'Monstrosity actions'});await offline.waitFor();if(await offline.getByRole('menuitem',{name:'Join game',exact:true}).count())throw Error('Offline friend join');
 await offline.getByRole('menuitem',{name:'Remove friend',exact:true}).click();await page.getByRole('menu',{name:'Monstrosity actions'}).getByRole('menuitem',{name:'Keep friend',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:900,height:720});await page.getByRole('button',{name:'Actions for Frostbitten',exact:true}).click();await page.getByRole('menu',{name:'Frostbitten actions'}).waitFor();await page.screenshot({path:'output/playwright/social-menu-narrow.png'});await page.keyboard.press('Escape');
 await page.goto('http://127.0.0.1:8851/?guest');await page.getByRole('button',{name:'Leaderboards',exact:true}).click();await page.getByRole('dialog',{name:'Leaderboards',exact:true}).locator('tbody tr').first().waitFor();await page.getByRole('tab',{name:'Friends',exact:true}).click();await page.getByText('Sign in with Discord to view your friends’ standings.',{exact:true}).waitFor();
 return {passed:true,checks:['global pagination','friends scope','history link','guest global access','guest friends sign-in prompt','menu outside scroll area','no list shift','keyboard close','offline join hidden','remove confirmation','narrow sidebar'],scope:'Real UI components, synthetic intercepted data'};
}