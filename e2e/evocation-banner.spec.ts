import { expect, test, type Page } from '@playwright/test';
import { applyAction, createGame, summonEvocation } from '../packages/game-engine/src';
import type { GameAction, GameState } from '../packages/game-engine/src';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { selectControlTab } from './layout-ui';

function fixture(crowded:boolean,phase:'ACTION'|'EVOCATION'='ACTION') {
 const game=createGame(crowded?4:2);game.gameId='evocation-banner';game.round=1;game.phase=phase;game.currentPlayerId='p1';game.firstPlayerId='p1';
 game.activation=phase==='ACTION'?{playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false}:null;
 for(const p of game.players){p.connected=true;p.wizard.position={q:0,r:0};}
 game.players[0].name='Rose Warden of the Ancient Lodge';game.players[1].name='BlueSeerWithAnUnbrokenLongName';
 summonEvocation(game,game.players[0],'CADAVER',{q:0,r:0});
 if(crowded) {
  for(let i=0;i<3;i++)summonEvocation(game,game.players[1],'CADAVER',{q:0,r:0});
  for(let i=0;i<2;i++)summonEvocation(game,game.players[2],'CADAVER',{q:0,r:0});
  summonEvocation(game,game.players[2],'SUCCUBUS',{q:0,r:0});
  for(let i=0;i<2;i++)summonEvocation(game,game.players[3],'SUCCUBUS',{q:0,r:0});
 }
 return game;
}

async function mount(page:Page,initial:GameState) {
 let game=initial;const history=new ActionHistory(),actions:GameAction[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await page.routeWebSocket('**',route=>route.onMessage(data=>{
  const message=JSON.parse(String(data));
  const publish=()=>route.send(JSON.stringify({type:'STATE',state:publicState(game,'p1',history)}));
  if(message.type==='CREATE_ROOM'){route.send(JSON.stringify({type:'WELCOME',playerId:'p1',roomId:game.gameId}));publish();}
  else if(message.action) {
   try{game=history.apply(game,message.action,'p1');actions.push(message.action);publish();route.send(JSON.stringify({type:'ACTION_APPLIED',requestId:message.requestId}));}
   catch(error){errors.push(String(error));route.send(JSON.stringify({type:'ERROR',message:String(error)}));}
  }
 }));
 await page.goto('/');await page.getByRole('button',{name:'Create room',exact:true}).click();
 await expect(page.locator('.phase-overlay')).toBeVisible();await page.locator('.phase-overlay').click();
 await selectControlTab(page,'Evocations');
 await page.locator('#retinue-p1').getByRole('button',{name:/^Activate Cadaver #1/}).click();
 await expect(page.getByRole('region',{name:'Active evocation controls',exact:true})).toBeVisible();
 return {actions,errors,get state(){return game;}};
}

async function expectContainedBanner(page:Page) {
 const geometry=await page.locator('.turn-banner').evaluate(banner=>{
  const rect=banner.getBoundingClientRect();
  const bounds=(node:Element)=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width};};
  return {width:innerWidth,height:innerHeight,left:rect.left,right:rect.right,bannerHeight:rect.height,
   scrollWidth:banner.scrollWidth,clientWidth:banner.clientWidth,status:bounds(banner.querySelector('.turn-banner-text')!),
   controls:[...banner.querySelectorAll('button')].map(bounds)};
 });
 expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.width);
 expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth+1);
 expect(geometry.status.width).toBeGreaterThanOrEqual(100);
 expect(geometry.bannerHeight).toBeLessThan(geometry.height*.6);
 for(const button of geometry.controls){expect(button.left).toBeGreaterThanOrEqual(geometry.left);expect(button.right).toBeLessThanOrEqual(geometry.right);}
}

for(const viewport of [{width:1440,height:1000},{width:1024,height:768},{width:768,height:1024},{width:390,height:844},{width:320,height:740},{width:844,height:390}]) {
 test.describe(`${viewport.width}x${viewport.height} evocation banner`,()=>{
  test.use({viewport,reducedMotion:'reduce'});
  for(const crowded of [false,true])test(`${crowded?'crowded':'single-target'} activation keeps status, history and every control within the banner`,async({page},info)=>{
   const wire=await mount(page,fixture(crowded));
   await expectContainedBanner(page);
   const controls=page.getByRole('region',{name:'Active evocation controls',exact:true});
   await expect(page.locator('.turn-banner-text')).toContainText('Rose Warden of the Ancient Lodge');
   await expect(page.getByRole('button',{name:'Undo action',exact:true})).toBeEnabled();
   await expect(page.getByRole('button',{name:/^End turn/})).toHaveCount(0);
   await page.locator('.turn-banner').screenshot({path:info.outputPath('active-banner.png'),animations:'disabled'});
   await controls.getByRole('button',{name:'Finish evocation movement early',exact:true}).click();
   await expect(controls).toContainText('0 movement remaining');await expectContainedBanner(page);
  if(crowded) {
   const last=controls.getByRole('group',{name:'Evocation attack targets',exact:true}).getByRole('button').last();
   const target=wire.state.evocations.filter(e=>e.playerId!=='p1').at(-1)!;
   await last.focus();await last.press('Enter');
   expect(wire.actions.at(-1)).toMatchObject({type:'EVOCATION_ATTACK',targetId:target.id});
   expect(wire.state.evocations.find(e=>e.id===target.id)!.damageCubes).toBe(2);
  } else await controls.getByRole('button',{name:'Finish evocation',exact:true}).click();
   await expect(controls).toHaveCount(0);expect(wire.state.evocationActivation).toBeNull();
  await expectContainedBanner(page);
   expect(wire.errors).toEqual([]);
  });
 });
}

test('free activation keeps the sticky banner compact and movement, attacks and history usable after scrolling',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const wire=await mount(page,fixture(false,'EVOCATION'));
 await expectContainedBanner(page);
 await page.evaluate(()=>window.scrollTo(0,300));
 await expect.poll(()=>page.locator('.turn-banner').evaluate(element=>Math.round(element.getBoundingClientRect().top))).toBe(0);
 const controls=page.getByRole('region',{name:'Active evocation controls',exact:true});
 await page.locator('.hex[data-room-id="room-1,0"]').click();
 await expect(controls).toContainText('1 movement remaining');
 await page.getByRole('button',{name:'Undo action',exact:true}).click();
 await expect(controls).toContainText('2 movement remaining');
 await controls.getByRole('button',{name:/^Cadaver attack BlueSeer/}).click();
 await expect(controls).toContainText('Attack used');await expectContainedBanner(page);
 await controls.getByRole('button',{name:'Finish evocation movement early',exact:true}).click();
 await expect(controls).toHaveCount(0);expect(wire.state.players[1].wizard.damageCubes).toBe(2);
 expect(wire.errors).toEqual([]);
});