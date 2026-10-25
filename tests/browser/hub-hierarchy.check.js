async page => {
 const check=(ok,label)=>{if(!ok)throw new Error(label);};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:960});
 await page.goto('http://127.0.0.1:8848/');
 await page.locator('.ranked-rating-badge.is-grandmaster').waitFor();
 await page.getByRole('button',{name:'Find ranked',exact:true}).waitFor();
 const layout=await page.locator('.cup-hub').evaluate(el=>{
   const box=s=>el.querySelector(s).getBoundingClientRect();const social=box('.hub-social'),content=box('.hub-content'),host=box('.hub-host'),ranked=box('.ranked-queue-bar'),hb=box('.hub-host button'),rb=box('.ranked-queue-controls button'),input=box('.hub-host input'),badge=box('.ranked-rating-badge'),empty=box('.hub-empty'),list=box('.hub-list');
   return {ratio:social.width/content.width,rows:[host.height,ranked.height],buttons:[hb.width,rb.width,hb.height,rb.height,hb.right,rb.right],aligned:Math.abs(input.left-badge.left)<1,badgeWidth:badge.width,bold:getComputedStyle(el.querySelector('.ranked-rating-value')).fontWeight,center:Math.abs(empty.x+empty.width/2-list.x-list.width/2)<5&&Math.abs(empty.y+empty.height/2-list.y-list.height/2)<5};
 });
 check(layout.ratio>=.20&&layout.ratio<=.22,'Sidebar ratio');check(Math.abs(layout.rows[0]-layout.rows[1])<=2,'Row heights');check(layout.buttons[0]===layout.buttons[1]&&layout.buttons[2]===layout.buttons[3]&&layout.buttons[4]===layout.buttons[5],'Button alignment');check(layout.aligned&&layout.badgeWidth===140&&layout.bold==='700','Badge alignment/weight');check(layout.center,'Empty state centering');
 check(await page.locator('.hub-header').getByRole('button',{name:'Refresh'}).count()===0,'Refresh still in header');
 await page.screenshot({path:'output/playwright/hub-refine-final-empty.png'});
 await page.getByRole('textbox',{name:'Cup name',exact:true}).fill('Weekend Cup');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();check(await page.getByRole('textbox',{name:'Cup name',exact:true}).inputValue()==='Weekend Cup','Refresh erased name');
 await page.getByRole('button',{name:'Host Cup',exact:true}).click();const modal=page.getByRole('dialog',{name:'Host Cup',exact:true});await modal.waitFor();check(await modal.getByRole('radio',{name:'Private',exact:true}).isChecked(),'Private default');await modal.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Find ranked',exact:true}).click();await page.locator('.ranked-queue-bar').getByRole('button',{name:'Cancel',exact:true}).waitFor();check(await page.getByRole('button',{name:'Host Cup',exact:true}).isDisabled(),'Queue admission guard');await page.locator('.ranked-queue-bar').getByRole('button',{name:'Cancel',exact:true}).click();
 await page.goto('http://127.0.0.1:8848/?master&populated');await page.getByText('Friday Night Cup',{exact:true}).waitFor();check(await page.locator('.hub-empty').count()===0,'Empty state alongside rooms');await page.screenshot({path:'output/playwright/hub-refine-final-populated.png'});
 for(const [width,height] of [[1100,850],[850,760],[390,800],[320,640]]) {
  await page.setViewportSize({width,height});await page.locator('.hub-activities').scrollIntoViewIfNeeded();
  const overflow=await page.locator('.cup-hub').evaluate(el=>[el,...el.querySelectorAll('.hub-main,.hub-activities,.hub-host,.ranked-queue-bar,.hub-header,.hub-social,.account-tabs')].filter(n=>n.clientWidth).filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.className));check(!overflow.length,`Overflow ${width}: ${overflow}`);
  await page.screenshot({path:`output/playwright/hub-refine-final-${width}.png`});
 }
 await page.setViewportSize({width:1100,height:850});await page.goto('http://127.0.0.1:8848/?disabled');await page.locator('.ranked-rating-badge.is-grandmaster').waitFor();await page.getByRole('button',{name:'Refresh',exact:true}).click();check(await page.getByRole('button',{name:'Find ranked',exact:true}).isDisabled(),'Refresh enabled disabled queue');
 await page.goto('http://127.0.0.1:8848/?guest');await page.getByRole('button',{name:'Find ranked',exact:true}).waitFor();check(await page.getByRole('button',{name:'Find ranked',exact:true}).isDisabled(),'Guest ranked access');
 await page.goto('http://127.0.0.1:8848/');await page.setViewportSize({width:1440,height:960});await page.locator('.ranked-rating-badge.is-grandmaster').waitFor();
 check(!errors.length,JSON.stringify(errors));return {passed:true,layout,checks:['empty and populated views','1440/1100/850/390/320 widths','cup name preserved on refresh','private hosting dialog','queue/cancel','disabled queue remains disabled after refresh','guest access'],browserErrors:errors.length};
}
