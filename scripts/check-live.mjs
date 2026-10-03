import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
await mkdir('artifacts',{recursive:true});
const directory=await mkdtemp(path.resolve('artifacts/live-test-'));
const base='http://localhost:4184';
let server;
async function start() {
  server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4184',DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
  let output=''; server.stdout.on('data',chunk=>{output+=chunk;}); server.stderr.on('data',chunk=>{output+=chunk;});
  for(let attempt=0;attempt<100;attempt++) {
    if(server.exitCode!==null)throw new Error(output);
    try{if((await fetch(base+'/api/health')).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Server did not start: '+output);
}
async function stop(){if(server && server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}}
let browser;
try {
  await start();
  browser=await chromium.launch({channel:'chrome',headless:true});
  const clients=[];
  for(const name of ['נועה','דנה','אורי']) {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#display-name').fill(name);await page.locator('#profile-submit').click();
    await page.waitForFunction(()=>document.querySelector('#live-status').textContent==='מחוברים לקהילה');
    const profile=await page.evaluate(()=>JSON.parse(localStorage.getItem('beyachad.profile.v1')));
    clients.push({context,page,profile});
  }
  const [a,b,c]=clients;
  async function call(client,route,body){return fetch(base+route,{method:body?'POST':'GET',headers:{'x-user-id':client.profile.id,...(body && !(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});}
  async function badge(client,selector,count){await client.page.waitForFunction(([selector,count])=>{const badge=document.querySelector(selector);return count ? !badge.hidden && badge.textContent===String(count):badge.hidden;},[selector,count]);}
  await a.page.getByRole('button',{name:/אני צריך עזרה/}).click();
  await a.page.locator('#gallery-input').setInputFiles('public/icons/icon-192.png');
  await a.page.locator('#question-text').fill('שאלה ראשונה עם תמונה');
  await a.page.getByRole('button',{name:'שאל את הקהילה',exact:true}).click();
  await a.page.waitForURL('**/#inbox');
  await badge(b,'#help-badge',1);await badge(c,'#help-badge',1);await badge(a,'#help-badge',0);
  await b.page.locator('#live-toast').waitFor({state:'visible'});
  const first=(await (await call(a,'/api/state')).json()).mine[0];
  assert.equal(first.senderId,a.profile.id);assert.equal(first.images.length,1);
  const image=await fetch(base+first.images[0]);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  await a.page.locator('#new-question').click();await a.page.locator('#question-text').fill('שאלה שנייה');
  await a.page.getByRole('button',{name:'שאל את הקהילה',exact:true}).click();await a.page.waitForURL('**/#inbox');
  await badge(b,'#help-badge',2);await badge(c,'#help-badge',2);
  await a.page.locator('#back-inbox').click();
  await b.page.getByRole('button',{name:/אני רוצה לעזור/}).click();
  const cards=b.page.locator('#question-list .live-question');
  assert.equal(await cards.count(),2);assert.match(await cards.nth(0).innerText(),/שאלה שנייה/);assert.match(await cards.nth(1).innerText(),/שאלה ראשונה/);
  assert.equal(await cards.nth(0).evaluate(card=>card.classList.contains('is-active')),true);
  assert.equal(await cards.nth(0).locator('.card-question-side').evaluate(face=>getComputedStyle(face).backgroundColor),'rgb(53, 84, 65)');
  assert.match(await cards.nth(0).innerText(),new RegExp(a.profile.id));
  await cards.nth(1).locator('.question-gallery img').click();
  await b.page.locator('#photo-viewer').waitFor({state:'visible'});
  await b.page.waitForFunction(()=>document.querySelector('#full-photo').complete && document.querySelector('#full-photo').naturalWidth>0);
  assert.equal(await b.page.locator('#full-photo').evaluate(image=>image.getBoundingClientRect().width),192);
  const fit=await b.page.locator('#full-photo').evaluate(image=>{const rect=image.getBoundingClientRect();const canvas=image.parentElement.getBoundingClientRect();return {centered:Math.abs(rect.left+rect.width/2-canvas.left-canvas.width/2)<1 && Math.abs(rect.top+rect.height/2-canvas.top-canvas.height/2)<1,fits:rect.width<=canvas.width && rect.height<=canvas.height};});
  assert.equal(fit.centered,true);assert.equal(fit.fits,true);
  assert.equal(await b.page.locator('#close-photo').innerText(),'×');
  const viewportAlignment=await b.page.locator('#photo-viewer').evaluate(viewer=>{const rect=viewer.getBoundingClientRect();const image=document.querySelector('#full-photo').getBoundingClientRect();const close=document.querySelector('#close-photo').getBoundingClientRect();return {left:rect.left,width:rect.width,viewport:innerWidth,center:image.left+image.width/2,closeInside:close.right<=innerWidth && close.left>=0};});
  assert.equal(viewportAlignment.left,0);assert.equal(viewportAlignment.width,viewportAlignment.viewport);assert.equal(viewportAlignment.center,viewportAlignment.viewport/2);assert.equal(viewportAlignment.closeInside,true);
  await b.page.screenshot({path:'artifacts/photo-viewer-mobile.png'});
  const photoCanvas=b.page.locator('.photo-canvas');
  await photoCanvas.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',clientX:120,clientY:350});
  await photoCanvas.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',clientX:220,clientY:350});
  await photoCanvas.dispatchEvent('pointermove',{pointerId:2,pointerType:'touch',clientX:320,clientY:350});
  assert.equal(await b.page.locator('#photo-zoom-reset').innerText(),'200%');
  await photoCanvas.dispatchEvent('pointermove',{pointerId:2,pointerType:'touch',clientX:220,clientY:350});
  assert.equal(await b.page.locator('#photo-zoom-reset').innerText(),'100%');
  await photoCanvas.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch'});await photoCanvas.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch'});
  await b.page.locator('#photo-zoom-in').click();assert.equal(await b.page.locator('#photo-zoom-reset').innerText(),'130%');
  await b.page.locator('#photo-zoom-reset').click();assert.equal(await b.page.locator('#photo-zoom-reset').innerText(),'100%');
  await b.page.getByRole('button',{name:'סגירת התמונה'}).click();
  await b.page.locator('#photo-viewer').waitFor({state:'hidden'});
  await cards.nth(1).locator('.question-gallery img').focus();
  await b.page.keyboard.press('Enter');await b.page.locator('#photo-viewer').waitFor({state:'visible'});
  await b.page.keyboard.press('Escape');await b.page.locator('#photo-viewer').waitFor({state:'hidden'});
  assert.equal(await b.page.evaluate(()=>document.body.style.overflow),'');
  await cards.nth(0).getByRole('button',{name:'לעבור לתשובה',exact:true}).click();
  assert.equal(await cards.nth(0).getAttribute('data-side'),'answer');
  await b.page.waitForFunction(()=>{
    const rotor=document.querySelector('#question-list .card-flip-rotor');
    return Math.abs(new DOMMatrix(getComputedStyle(rotor).transform).m11+1)<0.001;
  });
  assert.equal(await cards.nth(0).locator('.card-question-side').evaluate(face=>face.inert),true);
  assert.equal(await cards.nth(0).locator('.card-answer-side').evaluate(face=>face.inert),false);
  await cards.nth(0).getByRole('button',{name:'חזרה לשאלה',exact:true}).click();
  assert.equal(await cards.nth(0).getAttribute('data-side'),'question');
  await cards.nth(0).dispatchEvent('pointerdown',{pointerId:12,pointerType:'touch',clientX:300,clientY:400});
  await cards.nth(0).dispatchEvent('pointerup',{pointerId:12,pointerType:'touch',clientX:120,clientY:405});
  assert.equal(await cards.nth(0).getAttribute('data-side'),'answer');
  await cards.nth(0).dispatchEvent('pointerdown',{pointerId:13,pointerType:'touch',clientX:120,clientY:400});
  await cards.nth(0).dispatchEvent('pointerup',{pointerId:13,pointerType:'touch',clientX:300,clientY:405});
  assert.equal(await cards.nth(0).getAttribute('data-side'),'question');
  await cards.nth(1).getByRole('button',{name:'לעבור לתשובה',exact:true}).click();
  await cards.nth(1).getByRole('button',{name:'כתוב על האריזה / יש סימון'}).click();
  await b.page.locator('#answer-text').fill('בדקתי את הסימון על האריזה.');
  await b.page.getByRole('button',{name:'ענה',exact:true}).click();await b.page.locator('#answer-dialog').waitFor({state:'hidden'});
  await badge(a,'#reply-badge',1);await badge(b,'#help-badge',1);await badge(c,'#help-badge',2);await badge(c,'#reply-badge',0);
  assert.equal(await b.page.locator(`[data-question-id="${first.id}"]`).evaluate(card=>card.classList.contains('is-active')),false);
  const mine=await (await call(a,'/api/state')).json();assert.equal(mine.answers.length,1);
  const duplicate=await call(b,'/api/answers',{id:crypto.randomUUID(),questionId:first.id,choice:'לא מכיר',text:''});assert.equal(duplicate.status,200);
  assert.equal((await (await call(a,'/api/state')).json()).answers.length,1);
  const selfAnswer=await call(a,'/api/answers',{id:crypto.randomUUID(),questionId:first.id,choice:'לא מכיר',text:''});assert.equal(selfAnswer.status,400);
  const outsiders=await (await call(c,'/api/state')).json();assert.equal(outsiders.answers.length,0);
  await c.page.evaluate(async ids=>{const profile=JSON.parse(localStorage.getItem('beyachad.profile.v1'));await fetch('/api/read',{method:'POST',headers:{'content-type':'application/json','x-user-id':profile.id},body:JSON.stringify({ids})});},[mine.answers[0].id]);
  assert.equal((await (await call(a,'/api/state')).json()).unread,1);
  await a.page.getByRole('button',{name:/אני צריך עזרה/}).click();await a.page.waitForURL('**/#inbox');
  await a.page.locator('.live-answer').waitFor();assert.match(await a.page.locator('.live-answer').innerText(),/دנה|דנה/);
  assert.match(await a.page.locator('.live-answer').innerText(),/בדקתי/);await badge(a,'#reply-badge',0);
  await b.page.screenshot({path:'artifacts/live-help-mobile.png',fullPage:true});await a.page.screenshot({path:'artifacts/live-inbox-mobile.png',fullPage:true});
  console.log('Three-device delivery, photo persistence, own-question exclusion, chronological list, answer routing, both badges and read acknowledgments passed.');
  await c.context.setOffline(true);await a.page.locator('#new-question').click();await a.page.locator('#question-text').fill('שאלה בזמן ניתוק');
  await a.page.getByRole('button',{name:'שאל את הקהילה',exact:true}).click();await a.page.waitForURL('**/#inbox');
  await c.context.setOffline(false);await c.page.reload({waitUntil:'networkidle'});await badge(c,'#help-badge',3);
  await b.page.waitForFunction(()=>document.querySelector('#question-list .live-question .live-question-text')?.textContent==='שאלה בזמן ניתוק');
  const retained=b.page.locator(`[data-question-id="${first.id}"]`);
  assert.equal(await retained.getAttribute('data-side'),'answer');
  assert.equal(await b.page.locator('#question-list .live-question').first().getAttribute('data-side'),'question');
  await c.page.getByRole('button',{name:/אני רוצה לעזור/}).click();
  await c.page.screenshot({path:'artifacts/question-cards-mobile.png',fullPage:true,animations:'disabled'});
  await c.page.locator('#question-list .live-question').first().getByRole('button',{name:'לעבור לתשובה',exact:true}).click();
  await c.page.screenshot({path:'artifacts/question-answer-card-mobile.png',fullPage:true,animations:'disabled'});
  console.log('Newest-first live insertion, two-way mouse controls, swipe handling and side preservation passed.');
  await stop();await start();
  for(const client of clients){await client.page.reload({waitUntil:'networkidle'});await client.page.waitForFunction(()=>document.querySelector('#live-status').textContent==='מחוברים לקהילה');}
  await badge(b,'#help-badge',2);await badge(c,'#help-badge',3);
  const restored=await (await call(a,'/api/state')).json();assert.equal(restored.mine.length,3);assert.equal(restored.answers.length,1);assert.equal(restored.unread,0);
  await a.page.locator('#new-question').click();
  const history=a.page.locator('#ask-history-list .history-card');
  assert.equal(await history.count(),3);
  assert.match(await history.nth(0).innerText(),/שאלה בזמן ניתוק/);
  assert.match(await history.nth(2).innerText(),/שאלה ראשונה/);
  assert.equal(await a.page.locator('.ask-history').evaluate(section=>getComputedStyle(section).borderTopStyle),'solid');
  await a.page.screenshot({path:'artifacts/ask-history-mobile.png',fullPage:true,animations:'disabled'});
  await history.nth(2).getByRole('button',{name:'צפייה בתשובות (1)',exact:true}).click();
  await a.page.waitForURL('**/#inbox');
  console.log('Active dark-green cards, answered styling, descending ask history and reply navigation passed.');
  assert.equal((await fetch(base+first.images[0])).status,200);
  for(const client of clients){assert.equal(await client.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  console.log('Reconnect catch-up, database restart, persistent photos/answers/read status and mobile overflow checks passed.');
} finally {if(browser)await browser.close();await stop();}
