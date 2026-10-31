import { test, expect, Page, WebSocketRoute } from '@playwright/test';
import { BLACK_ROSE_ID, Card, Evocation, GameAction, GameState, MAGE_COLORS, applyAction, createGame, moment } from '../packages/game-engine/src/index';
import { expectSpellIcon, expectSpellType } from './spell-ui';
import { assignPreparationCard, closeControls, expectReference, pressHistory, selectControlTab, selectSpells, viewRetinue } from './layout-ui';

const errors=new WeakMap<Page,string[]>();
test.beforeEach(async ({page})=>{
 const messages:string[]=[];errors.set(page,messages);
 page.on('pageerror',error=>messages.push(error.message));
 // Keep fixtures independent of external font services.
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
});
test.afterEach(async ({page})=>expect(errors.get(page)??[],'No uncaught React/browser errors').toEqual([]));

const preparedSpell:Card={id:'fixture-spell',name:'Fixture Ember',kind:'SPELL',moments:[moment.instability(1),moment.damage(2)],range:3,target:'MODEL'};
function fixtureState(count=2):GameState {
 const game=createGame(count);
 game.gameId='rule-polish';game.round=1;game.phase='ACTION';game.firstPlayerId='p1';
 game.currentPlayerId='p1';
 game.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false,physicalAction:null};
 game.players.forEach((p,i)=>{p.name=['Rose Warden','Blue Seer','Amber Sage','Green Mage'][i];p.connected=true;p.ready=true;p.wizard.position={q:i%2,r:Math.floor(i/2)};});
 game.board.rooms.forEach((room,i)=>{room.name=room.id==='room-0,0'?'Pink Tulip Chamber':`Chamber ${i+1}`;});
 return game;
}
function model(id:string,playerId:string,number:number,position={q:0,r:0}):Evocation {
 return {id,playerId,number,name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position,damageCubes:0,damageByPlayer:{},activated:false};
}

async function mount(page:Page,game:GameState) {
 let socket:WebSocketRoute;
 const commands:Array<{action:GameAction;requestId:string}>=[];
 await page.routeWebSocket('**',route=>{
  socket=route;
  route.onMessage(data=>{
   const message=JSON.parse(String(data));
   if(message.type==='CREATE_ROOM') {
    route.send(JSON.stringify({type:'WELCOME',playerId:'p1',roomId:'rule-polish'}));
    route.send(JSON.stringify({type:'STATE',state:game}));
   } else if(message.action)commands.push(message);
  });
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Create room',exact:true}).click();
 await expect(page.locator('.app')).toBeVisible();
 await dismissOverlay(page);
 if(game.phase==='ACTION'&&(Object.values(game.players[0].prepared).some(Boolean)||game.players[0].hand.some(card=>card.powerful)))await selectSpells(page);
 return {
  commands,
  update:(state:GameState)=>socket.send(JSON.stringify({type:'STATE',state})),
  ack:(index=commands.length-1)=>socket.send(JSON.stringify({type:'ACTION_APPLIED',requestId:commands[index].requestId})),
  close:()=>socket.close({code:1000,reason:'Fixture offline'}),
 };
}
async function dismissOverlay(page:Page) {
 const overlay=page.locator('.phase-overlay');
 if(await overlay.count())await overlay.click();
}
const hex=(page:Page,id:string)=>page.locator(`.hex[data-room-id="${id}"]`);
const player=(page:Page,id:string)=>page.locator(`.player[data-player-id="${id}"]`);
const rgb=(color:string)=>`rgb(${[1,3,5].map(start=>parseInt(color.slice(start,start+2),16)).join(', ')})`;
const colorFor=(id:string)=>rgb(MAGE_COLORS[id]??'#d4cedd');

// Presentation fixtures still use one finite physical pool. Used preparations
// are references to cards already in a discard/active zone, not extra copies.
function physicalCardIds(game:GameState):string[] {
 return [...game.library.flatMap(deck=>[...deck.cards,...deck.discard]),...game.powerfulDeck,...game.removedCards,
  ...[...game.readiedSpells??[],...game.ongoingSpells??[]].map(active=>active.card),
  ...game.players.flatMap(p=>[...p.hand,...p.personalDeck,...p.discard,
  ...Object.values(p.prepared).flatMap(slot=>slot&&!slot.used?[slot.card]:[])])].map(card=>card.id).sort();
}

for(const viewport of [{width:1440,height:1200},{width:390,height:844}]) {
 test(`later hand overflow selects exactly the excess and preserves school-origin cards in personal discard at ${viewport.width}px`,async ({page},testInfo)=>{
  await page.setViewportSize(viewport);
  let game=fixtureState();game.phase='PREPARATION';game.activation=null;game.currentPlayerId=null;game.round=3;
  const cantrip=game.library.find(deck=>deck.id==='cantrip')!;
  const transmutation=game.library.find(deck=>deck.id==='transmutation')!;
  const enchantment=game.library.find(deck=>deck.id==='enchantment')!;
  // Model a later overflowing hand, not the corrected four-card first Study.
  // Every card comes out of its actual school stock, including the prior discard.
  game.players[0].hand.push(...cantrip.cards.splice(0,6),...transmutation.cards.splice(0,3));
  game.players[0].discard.push(...enchantment.cards.splice(0,1));
  game.players[1].hand.push(...enchantment.cards.splice(0,4));
  const beforeIds=physicalCardIds(game),hand=structuredClone(game.players[0].hand);
  const discardBefore=structuredClone(game.players[0].discard);
  const schoolDiscards=structuredClone(game.library.map(deck=>deck.discard));
  expect(beforeIds).toHaveLength(120);expect(new Set(beforeIds).size).toBe(120);
  const wire=await mount(page,game),panel=page.locator('.hand-limit-panel'),cards=panel.locator('.spell');
  await expect(panel.getByRole('heading',{name:'Reduce your hand to 7 cards',exact:true})).toBeVisible();
  await expect(page.locator('.preparation-panel')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);
  await expect(cards).toHaveCount(9);await expect(panel.locator('.spell:disabled')).toHaveCount(0);
  const confirm=panel.getByRole('button',{name:/^Discard excess cards/});
  await expect(confirm).toHaveText('Discard excess cards (0/2)');await expect(confirm).toBeDisabled();
  const discardIndices=[0,8],discards=discardIndices.map(index=>hand[index]);
  expect(discards.map(card=>card.schoolId)).toEqual(['cantrip','transmutation']);
  for(const index of discardIndices)await cards.nth(index).click();
  await cards.nth(1).click();await expect(panel.locator('.spell.chosen')).toHaveCount(2);
  await expect(confirm).toHaveText('Discard excess cards (2/2)');
  await cards.nth(8).click();await expect(confirm).toBeDisabled();await cards.nth(8).click();
  // A peer can finish slots, but cannot advance Action past our unresolved limit.
  const peer=game.players[1];
  game=applyAction(game,{type:'PREPARE_CARDS',playerId:peer.id,
  preparedCardIds:peer.hand.slice(0,3).map(card=>card.id),rapidCardId:peer.hand[3].id});
  wire.update(game);await expect(page.locator('.phase-track .current span')).toHaveText('Preparation');
  await expect(confirm).toBeEnabled();
  await testInfo.attach(`later-overflow-${viewport.width}`,{body:await panel.screenshot(),contentType:'image/png'});
  await confirm.click();await expect.poll(()=>wire.commands.length).toBe(1);
  expect(wire.commands[0].action).toEqual({type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:discards.map(card=>card.id)});
  game=applyAction(game,wire.commands[0].action);wire.update(game);wire.ack();
  await expect(panel).toHaveCount(0);
  expect(game.players[0].discard).toEqual([...discardBefore,...discards]);
  expect(game.library.map(deck=>deck.discard)).toEqual(schoolDiscards);
  expect(physicalCardIds(game)).toEqual(beforeIds);
  const retained=hand.filter((_,index)=>!discardIndices.includes(index));
  await expect(page.locator('.preparation-panel .cards .spell strong')).toHaveText(retained.map(card=>card.name));
  await expectReference(page,'Hand 7/7 · Personal discard 3');
  for(const [index,slot] of ([1,2,3,'Quick'] as const).entries())await assignPreparationCard(page,page.locator('.preparation-panel .cards .spell').nth(index),slot);
  await page.locator('.preparation-panel').getByRole('button',{name:'Done',exact:true}).click();
  await expect.poll(()=>wire.commands.length).toBe(2);
  expect(wire.commands[1].action).toEqual({type:'PREPARE_CARDS',playerId:'p1',
  preparedCardIds:retained.slice(0,3).map(card=>card.id),rapidCardId:retained[3].id});
  game=applyAction(game,wire.commands[1].action);wire.update(game);wire.ack();
  await dismissOverlay(page);await expect(page.locator('.phase-track .current span')).toHaveText('Action');
  expect(game.players[0].hand).toHaveLength(3);expect(physicalCardIds(game)).toEqual(beforeIds);
  expect(game.players[0].discard).toEqual([...discardBefore,...discards]);
  expect(game.library.map(deck=>deck.discard)).toEqual(schoolDiscards);
  await expect(page.getByRole('alert')).toHaveCount(0);
 });
}

for(const viewport of [{width:1440,height:1200},{width:390,height:844}]) {
 for(const schoolId of ['cantrip','transmutation']) {
 test(`Study offers independent school supplies and draws/discards ${schoolId} at ${viewport.width}px`,async ({page},testInfo)=>{
  await page.setViewportSize(viewport);
  let game=fixtureState(4);game.phase='STUDY';game.activation=null;game.currentPlayerId=null;
  // Keep both tested schools full; seed hands from real third-school stock.
  for(const p of game.players)p.hand.push(...game.library.find(d=>d.id==='enchantment')!.cards.splice(0,2));
  const beforeIds=physicalCardIds(game);
  expect(beforeIds).toHaveLength(120);expect(new Set(beforeIds).size).toBe(120);
  const wire=await mount(page,game);
  const panel=page.locator('.phase-panel'),schools=panel.locator('.schools button');
  const chosen=panel.locator(`.schools button[data-school-id="${schoolId}"]`);
  const otherId=schoolId==='cantrip'?'transmutation':'cantrip';
  const other=panel.locator(`.schools button[data-school-id="${otherId}"]`);
  const deck=game.library.find(d=>d.id===schoolId)!;
  const otherDeck=game.library.find(d=>d.id===otherId)!;
  await expect(panel.getByRole('heading',{name:'Schools of magic',exact:true})).toBeVisible();
  await expect.poll(()=>schools.count()).toBeGreaterThanOrEqual(2);
  for(const [id,name] of [['cantrip','Cantrip'],['transmutation','Transmutation']]) {
   await expect(panel.locator(`.schools button[data-school-id="${id}"] strong`)).toHaveText(name);
   const supply=game.library.find(d=>d.id===id)!;
   expect(supply.cards).toHaveLength(36);
   const patterns=new Set(supply.cards.map(card=>card.name));expect(patterns.size).toBe(12);
   for(const pattern of patterns)expect(supply.cards.filter(card=>card.name===pattern)).toHaveLength(3);
  }
  for(const button of [chosen,other]) {
   await expect(button).toContainText('36 draw · 0 discard');
   await expect(button).toBeEnabled();
  }
  await expect(panel).toContainText('Each school has 12 spells with 3 copies each.');
  await expect(chosen).toContainText(schoolId==='transmutation'?'Heal wounds · Convert cubes':'Damage · Instability');
  await testInfo.attach(`schools-${schoolId}-${viewport.width}`,{body:await panel.screenshot({path:testInfo.outputPath('schools.png')}),contentType:'image/png'});

  // Availability is per school, never the combined stock or opponents' hands.
  game.players[1].hand.push(...deck.cards.splice(3));wire.update(game);
  await expect(chosen).toContainText('3 draw · 0 discard');
  await expect(chosen).toBeEnabled();await expect(other).toBeEnabled();
  game.players[2].hand.push(...otherDeck.cards.splice(3));wire.update(game);
  await expect(other).toBeEnabled();
  const draw=panel.getByRole('button',{name:/^Draw selected cards/});
  for(let index=0;index<3;index++)await chosen.click();
  await expect(chosen).toBeDisabled();await expect(other).toBeEnabled();
  await expect(draw).toBeDisabled();expect(wire.commands).toEqual([]);
  deck.discard.push(game.players[1].hand.pop()!);wire.update(game);
  await expect(chosen).toContainText('3 draw · 1 discard');
  await expect(chosen).toBeEnabled();await expect(other).toBeEnabled();
  const untouched=structuredClone(game.library.filter(d=>d.id!==schoolId));
  const schoolIds=game.library.map(d=>d.id);
  await chosen.click();
  expect(wire.commands).toEqual([]);
  await expect(draw).toBeEnabled();await draw.click();
  await expect.poll(()=>wire.commands.length).toBe(1);
  expect(wire.commands[0].action).toEqual({type:'DRAW_STUDY',playerId:'p1',deckIds:Array(4).fill(schoolId)});
  await expect(chosen).toBeDisabled();
  game=applyAction(game,wire.commands[0].action);wire.update(game);wire.ack();
  expect(physicalCardIds(game)).toEqual(beforeIds);
  expect(game.players[0].hand.filter(c=>c.schoolId===schoolId)).toHaveLength(4);
  expect(game.library.filter(d=>d.id!==schoolId)).toEqual(untouched);
  await expect(panel.locator('.spell')).toHaveCount(6);
  await expect(panel.locator('.spell:enabled')).toHaveCount(4);
  await expect(panel.locator('.spell:disabled')).toHaveCount(2);
  expect(game.players[0].studyCardIds).toEqual(game.players[0].hand.slice(2).map(card=>card.id));
  await expect(panel).toContainText('Discard exactly 2 of the 4 new library cards.');
  await expectReference(page,'Normal school discards return to their school; forced hand-limit discards are the exception.');
  await expect(panel.locator('.schools')).toHaveCount(0);

  const discards=game.players[0].hand.filter(c=>c.schoolId===schoolId).slice(0,2);
  for(const card of discards)await panel.locator('.spell').nth(game.players[0].hand.findIndex(c=>c.id===card.id)).click();
  await panel.getByRole('button',{name:'Discard selected (2/2)',exact:true}).click();
  await expect.poll(()=>wire.commands.length).toBe(2);
  expect(wire.commands[1].action).toEqual({type:'DISCARD_STUDY',playerId:'p1',cardIds:discards.map(c=>c.id)});
  game=applyAction(game,wire.commands[1].action);wire.update(game);wire.ack();
  expect(physicalCardIds(game)).toEqual(beforeIds);
  expect(game.library.map(d=>d.id)).toEqual(schoolIds);expect(game.library.find(d=>d.id===schoolId)!.discard).toEqual(discards);
  expect(game.library.filter(d=>d.id!==schoolId)).toEqual(untouched);
  await expect(page.getByText('✓ Study complete. Waiting for the other mages.',{exact:true})).toBeVisible();
 });
 }
}

test('mage card counts show current hand size over the limit and update for every player',async ({page})=>{
 const game=fixtureState(4);
 const counts=[0,3,7,9];
 for(const [index,p] of game.players.entries()) {
  p.hand=Array.from({length:counts[index]},(_,card)=>({...preparedSpell,id:`held-${p.id}-${card}`,name:'Hidden spell'}));
 }
 const wire=await mount(page,game);
 const cardCount=(id:string)=>player(page,id).locator('.mage-attributes > div').filter({has:page.locator('dt',{hasText:/^Cards$/})}).locator('dd');
 for(const [index,p] of game.players.entries())await expect(cardCount(p.id)).toHaveText(`${counts[index]}/7`);

 // State broadcasts also update peers' masked hands without exposing card identities.
 game.players[0].hand=[{...preparedSpell,id:'new-draw'}];
 game.players[1].hand=[];
 game.players[2].hand.splice(0,4);
 game.players[3].cardLimit=10;
 wire.update(game);
 for(const [index,expected] of ['1/7','0/7','3/7','9/10'].entries())await expect(cardCount(game.players[index].id)).toHaveText(expected);
});

for(const viewport of [{width:1440,height:1200},{width:390,height:844}]) {
 test(`room segments, local badge geometry and physical order at ${viewport.width}px`,async ({page},testInfo)=>{
  await page.setViewportSize(viewport);
  const game=fixtureState(4);
  const seen:Record<number,number>={};
  for(const room of game.board.rooms.filter(r=>!r.startingFor)) {
   const index=seen[room.instabilityLimit]??0;seen[room.instabilityLimit]=index+1;
   if(index===1) {room.cubesByPlayer={p1:1,p2:1,[BLACK_ROSE_ID]:1};room.instability=3;}
   if(index>=2||room.instabilityLimit===10) {room.cubesByPlayer={p1:room.instabilityLimit-2,p2:1,[BLACK_ROSE_ID]:1};room.instability=room.instabilityLimit;}
  }
  game.players[0].cubes.available=0;
  const wire=await mount(page,game);
  await page.evaluate(()=>document.fonts.ready);
  const measurements=await page.locator('.hex:not(.start-room)').evaluateAll(rooms=>rooms.map(room=>{
   const polygon=room.querySelector<SVGPolygonElement>('polygon')!;
   const badge=room.querySelector<SVGGElement>('.capacity-badge')!;
   const background=badge.querySelector<SVGRectElement>('.capacity-background')!;
   const text=badge.querySelector<SVGTextElement>('.cube-count')!;
   const bounds=background.getBBox(),label=text.getBBox();
   const transform=polygon.getScreenCTM()!.inverse().multiply(background.getScreenCTM()!);
   const corners=[[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y],[bounds.x,bounds.y+bounds.height],[bounds.x+bounds.width,bounds.y+bounds.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(transform));
   return {
    id:room.getAttribute('data-room-id')!,
    local:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},
    inside:corners.every(point=>polygon.isPointInFill(point)),
    labelInside:label.x>=bounds.x&&label.x+label.width<=bounds.x+bounds.width&&label.y>=bounds.y&&label.y+label.height<=bounds.y+bounds.height,
    transform:getComputedStyle(badge).transform,
    contrast:{fill:getComputedStyle(text).fill,stroke:getComputedStyle(text).stroke,order:getComputedStyle(text).paintOrder},
    fills:Array.from(badge.querySelectorAll<SVGRectElement>('.capacity-fill')).map(rect=>({owner:rect.getAttribute('data-owner-id'),x:rect.x.baseVal.value,y:rect.y.baseVal.value,width:rect.width.baseVal.value,height:rect.height.baseVal.value,color:getComputedStyle(rect).fill})),
   };
  }));
  for(const result of measurements) {
   const room=game.board.rooms.find(r=>r.id===result.id)!;
   expect(result.local).toEqual({x:-18,y:10,width:36,height:12});
   expect(result.inside,room.id).toBe(true);expect(result.labelInside,room.id).toBe(true);
   expect(result.transform).toBe('none');
   expect(result.contrast.fill).toBe('rgb(255, 255, 255)');expect(result.contrast.stroke).not.toBe('none');expect(result.contrast.order).toContain('stroke');
   expect(result.fills.reduce((sum,fill)=>sum+fill.width,0)).toBeCloseTo(34*room.instability/room.instabilityLimit,4);
   let end=-17;
   for(const fill of result.fills) {
    expect(fill.x).toBeCloseTo(end,4);expect(fill.y).toBe(11);expect(fill.height).toBe(10);
    expect(fill.x+fill.width).toBeLessThanOrEqual(17.0001);
    if(fill.owner) {expect(fill.width).toBeCloseTo(34*room.cubesByPlayer[fill.owner]/room.instabilityLimit,4);expect(fill.color).toBe(colorFor(fill.owner));}
    end+=fill.width;
   }
  }
  expect(measurements.some(m=>m.fills.every(f=>f.width===0))).toBe(true);
  await expect(page.locator('.actions-panel')).toBeHidden();
  await selectControlTab(page,'Physical actions');
  await expect(page.locator('.control-banner .actions-panel')).toHaveCount(1);
  await expect(page.locator('.actions-panel')).toContainText('No cubes available');
  await closeControls(page);
  await expect(page.getByRole('button',{name:/pass/i})).toHaveCount(0);
  // Scroll and hit-test the badge itself, not the group's bounding rectangle.
  await page.locator('.board-viewport').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  const last=page.locator('.capacity-badge').last();await last.scrollIntoViewIfNeeded();
  expect(await last.evaluate(badge=>{
   const b=badge.querySelector('.capacity-background')!.getBoundingClientRect();
   return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.hex')===badge.closest('.hex');
  })).toBe(true);
    await testInfo.attach(`segmented-board-${viewport.width}`,{body:await page.locator('.board-viewport').screenshot({path:testInfo.outputPath('segmented-board.png')}),contentType:'image/png'});
  game.currentPlayerId='p2';game.activation!.playerId='p2';wire.update(game);
  await expect(page.locator('.actions-panel')).toHaveCount(0);
  game.phase='EVOCATION';game.activation=null;wire.update(game);await dismissOverlay(page);
  await expect(page.locator('.actions-panel')).toHaveCount(0);
 });
}

test('full rooms wait for Cleanup; rebuilt rooms expose only READY / USED, not historical cubes',async ({page})=>{
 const game=fixtureState();
 const [ready,used,pending]=game.board.rooms.filter(r=>!r.startingFor&&r.color==='crimson');
 for(const room of [ready,used,pending]){room.instability=room.instabilityLimit;room.cubesByPlayer={p1:3,[BLACK_ROSE_ID]:2};}
 ready.reconstructed=ready.scored=used.reconstructed=used.scored=true;used.specialUsed=true;
 await mount(page,game);
 for(const room of [ready,used]) {
  const tile=hex(page,room.id),status=room.specialUsed?'USED':'READY';
  await expect(tile.locator('.rebuilt-badge text')).toHaveText(status);
  await expect(tile).toHaveAttribute('aria-label',`${room.name}, ${status}`);
  await expect(tile.locator('.capacity-badge,.capacity-fill,.cube-count,.cube-owner')).toHaveCount(0);
  await tile.click();
  await expect(page.locator('.room-detail')).toContainText(status);
  await expect(page.locator('.room-detail')).not.toContainText('instability');
  await expect(page.locator('.room-detail .contributions')).toHaveCount(0);
 }
 await hex(page,pending.id).click();
 await expect(hex(page,pending.id).locator('.cube-count')).toHaveText(`◆ ${pending.instabilityLimit}/${pending.instabilityLimit}`);
 await expect(page.locator('.room-detail')).toContainText('Full: locked to new cubes; rebuilds at Cleanup');
 await expect(page.locator('.room-detail')).toContainText(`Rewards ${pending.rewards.join(' / ')} VP`);
 await expect(hex(page,pending.id).locator('.rebuilt-badge')).toHaveCount(0);
});

test('damage bars count wounds with owner, Pink Tulip and unattributed segments, including zero and full',async ({page})=>{
 const game=fixtureState(4);
 Object.assign(game.players[1].wizard,{damageCubes:4,damageByPlayer:{p1:1,p3:1},blackDamage:1});
 Object.assign(game.players[2].wizard,{damageCubes:10,damageByPlayer:{p1:4,p2:3},blackDamage:3});
 Object.assign(game.players[3].wizard,{damageCubes:2});
 game.evocations=[{...model('wounded-model','p1',2),damageCubes:1},{...model('attributed-model','p2',3),damageCubes:1,damageByPlayer:{p1:1}}];
 const wire=await mount(page,game);
 for(const p of game.players) {
  const card=player(page,p.id),meter=card.getByRole('meter');
  await expect(meter).toHaveAttribute('aria-valuenow',String(p.wizard.damageCubes));
  await expect(card.locator('.damage-count')).toHaveText(`${p.wizard.damageCubes} damage cubes / 10 capacity`);
  const segments=await meter.locator('i').evaluateAll(items=>items.map(item=>({owner:item.getAttribute('data-owner-id')!,width:parseFloat(item.style.width),color:getComputedStyle(item).backgroundColor})));
  expect(segments.reduce((sum,s)=>sum+s.width,0)).toBe(p.wizard.damageCubes*10);
  for(const segment of segments)expect(segment.color).toBe(colorFor(segment.owner));
 }
 await expect(player(page,'p1').locator('.damage-segment')).toHaveCount(0);
 await expect(player(page,'p2')).toContainText('Unattributed wounds (no cube available): 1');
 await expect(player(page,'p2').locator('[data-owner-id="p1"]')).toHaveCSS('width',await player(page,'p2').locator('[data-owner-id="p3"]').evaluate(el=>getComputedStyle(el).width));
 await selectControlTab(page,'Evocations');
 const evoc=page.locator('#retinue-p1 .evocation-card');
 await expect(evoc.locator('.damage-count')).toHaveText('1 damage cubes / 2 capacity');
 await expect(evoc.locator('.damage-segment')).toHaveAttribute('style',/width: 50%/);
 await expect(evoc).toContainText('Unattributed wounds');
 await page.getByRole('button',{name:'Show evocations for Blue Seer (1)',exact:true}).click();
 await expect(page.locator('.evocation-card[data-evocation-id="attributed-model"] .damage-segment')).toHaveCSS('background-color',colorFor('p1'));
 Object.assign(game.players[1].wizard,{damageCubes:0,damageByPlayer:{},blackDamage:0});wire.update(game);
 await expect(player(page,'p2').locator('.damage-segment')).toHaveCount(0);
 await expect(player(page,'p2').locator('.damage-count')).toHaveText('0 damage cubes / 10 capacity');
});

test('held powers cannot target or cast; prepared powers use the normal slot command',async ({page})=>{
 const game=fixtureState();
 const power=game.powerfulDeck.find(c=>c.target==='ROOM')!;
 game.players[0].hand=[power];
 game.players[0].prepared.slot1={card:{...power,id:'prepared-power',name:'Prepared Rosefall'},used:false};
 const wire=await mount(page,game);
 const held=page.locator('.powerful-panel .spell');
 await expect(held).toBeDisabled();await expect(held).toContainText('Prepare in a later round');
 await held.dispatchEvent('click');await hex(page,'room-0,0').click();
 await expect(page.locator('.room-detail button')).toHaveCount(0);
 expect(wire.commands).toEqual([]);
 await page.locator('.prepared .spell').click();await hex(page,'room-0,0').click();
 await page.getByRole('button',{name:'Cast Prepared Rosefall here',exact:true}).click();
 await expect.poll(()=>wire.commands.length).toBe(1);
 expect(wire.commands[0].action).toEqual({type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
 expect(wire.commands.some(command=>command.action.type==='CAST_POWERFUL_SPELL')).toBe(false);
});

test('Preparation permits powers in slots and explains permanent removal and return of unused powers',async ({page})=>{
 const game=fixtureState();game.phase='PREPARATION';game.currentPlayerId=null;game.activation=null;
 const power=game.powerfulDeck[0];
 game.players[0].hand=[power,...[1,2,3].map(n=>({...preparedSpell,id:`prepare-${n}`,name:`Study ${n}`}))];
 const wire=await mount(page,game);
 const panel=page.locator('.phase-panel').filter({has:page.getByRole('heading',{name:'Prepare 2–4 spells',exact:true})});
 await expect(panel).toContainText('Forgotten spells must be prepared before casting.');
 await expectReference(page,'Prepared forgotten spells cost one turn action and are permanently removed on casting; unused preparations return to hand next round.');
 for(const [index,slot] of ([1,2,3,'Quick'] as const).entries())await assignPreparationCard(page,panel.locator('.cards .spell').nth(index),slot);
 await panel.getByRole('button',{name:'Done',exact:true}).click();
 await expect.poll(()=>wire.commands.length).toBe(1);
 expect(wire.commands[0].action).toEqual({type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:game.players[0].hand.slice(0,3).map(c=>c.id),rapidCardId:'prepare-3'});
 // Four placements do not bypass the enclosing single-flight network gate.
 await expect(panel.getByRole('button',{name:'Done',exact:true})).toBeDisabled();
 await expect(panel.locator('.cards .spell').first()).toBeDisabled();
 await expect(panel.getByRole('button',{name:'Reset selection',exact:true})).toBeDisabled();
 wire.update(game); // An unrelated STATE is not the matching request ACK.
 await expect(panel.getByRole('button',{name:'Done',exact:true})).toBeDisabled();
 wire.ack();
 await expect(panel.getByRole('button',{name:'Done',exact:true})).toBeEnabled();
 expect(wire.commands).toHaveLength(1);
});

test('mage view controls show retinues, map icons, stable slot numbers and owner colors; opponents remain read-only',async ({page})=>{
 const game=fixtureState();
 game.evocations=[model('own-three','p1',3),model('own-one','p1',1),{...model('enemy-two','p2',2),archetype:'DEMON'}];
 const wire=await mount(page,game);
 await expect(page.locator('.evocations-panel:visible')).toHaveCount(0);
 await viewRetinue(page,'p1');
 await expect(page.locator('#retinue-p1')).toBeVisible();
 await expect(page.locator('#retinue-p2')).toBeHidden();
 const otherToggle=page.getByRole('button',{name:'Show evocations for Blue Seer (1)',exact:true});
 await expect(otherToggle).toHaveAttribute('aria-expanded','false');
 await otherToggle.click();
 await expect(page.getByRole('button',{name:'Hide evocations for Blue Seer (1)',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(page.locator('.evocations-panel:visible')).toHaveCount(2);
 for(const evoc of game.evocations) {
  const marker=page.locator(`.evocation-marker[data-evocation-id="${evoc.id}"]`),card=page.locator(`.evocation-card[data-evocation-id="${evoc.id}"]`);
  await expect(marker.locator('text')).toHaveText(evoc.archetype==='DEMON'?'♆':'☠');
  await expect(marker.locator('circle')).toHaveCSS('fill','rgb(24, 18, 31)');
  await expect(marker.locator('circle')).toHaveCSS('stroke',colorFor(evoc.playerId));
  await expect(marker.locator('circle')).toHaveAttribute('r','5');
  await expect(marker.locator('circle')).toHaveClass(/mage-token-disc/);
  await expect(card.locator('.evocation-number')).toHaveText(`#${evoc.number}`);
  await expect(card).toHaveCSS('border-left-color',colorFor(evoc.playerId));
  await expect(card.locator('.evocation-portrait')).toHaveCSS('border-top-color',colorFor(evoc.playerId));
  await expect(card.locator('.evocation-portrait')).toHaveCSS('border-radius','50%');
 }
 await expect(page.locator('#retinue-p2 button')).toHaveCount(0);
 await expect(page.locator('#retinue-p2')).toContainText('Read-only');
 await page.getByRole('button',{name:/^Activate Cadaver #3/}).click();
 await expect.poll(()=>wire.commands.length).toBe(1);
 expect(wire.commands[0].action).toEqual({type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own-three'});wire.ack();
 await expect(page.getByRole('button',{name:'Hide evocations for Rose Warden (2)',exact:true})).toHaveCount(0);
 await selectControlTab(page,'Evocations');
 await page.getByRole('button',{name:'Hide evocations for Blue Seer (1)',exact:true}).click();
 await expect(page.locator('#retinue-p2')).toBeHidden();
 await expect(page.locator('#retinue-p1')).toBeVisible();
 await selectControlTab(page,'Actions');
 await expect(page.locator('.evocations-panel:visible')).toHaveCount(0);
 game.phase='EVOCATION';game.activation=null;game.evocations.reverse();wire.update(game);await dismissOverlay(page);
 await selectControlTab(page,'Evocations');
 await expect(page.locator('.evocations-panel:visible')).toHaveCount(1);
 await expect(page.locator('.evocation-card[data-evocation-id="own-three"] .evocation-number')).toHaveText('#3');
 await expect(page.locator('#retinue-p2')).toBeHidden();
 // Losing #1 must never renumber the survivor.
 game.evocations=game.evocations.filter(e=>e.id!=='own-one');wire.update(game);
 await expect(page.locator('.evocation-card[data-evocation-id="own-three"] .evocation-number')).toHaveText('#3');
 await expect(page.locator('.evocation-marker[data-evocation-id="own-three"] text')).toHaveText('☠');
});

test('map puts the active mage first, crowns the order marker, scales mages and shows public played cards',async ({page})=>{
 const game=fixtureState();game.players[1].isBot=true;game.currentPlayerId='p2';
 game.activation={playerId:'p2',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false,physicalAction:null};
 game.players[1].wizard.position={q:0,r:0};game.turnRecapDraft={playerId:'p2',logStart:0,cards:[]};
 const wire=await mount(page,game);
 const order=page.locator('.map-player-order');
 await expect(order.locator('li').first()).toHaveAttribute('data-player-id','p2');
 await expect(order.locator('li').first().locator('.map-first-crown')).toBeVisible();
 await expect(order.locator('li').first()).toHaveClass(/map-player-active/);
 await expect(hex(page,'room-0,0').locator('[data-mage-id="p2"] .mage-token-disc')).toHaveAttribute('r',/^5\.6/);
 game.turnRecapDraft={playerId:'p2',logStart:0,cards:[{at:1,role:'CAST',ownerId:'p2',card:preparedSpell}]};
 wire.update(game);
 await expect(page.locator('.map-played-card')).toContainText('Fixture Ember');
 await expect(page.locator('.map-played-card')).toContainText('Blue Seer');
});

test('active own evocation can attack or finish with mage details and opponent retinues closed',async ({page})=>{
 const game=fixtureState();game.phase='EVOCATION';game.activation=null;
 game.players[1].wizard.position={q:0,r:0};
 game.evocations=[model('active-own','p1',2)];
 game.evocationActivation={evocationId:'active-own',playerId:'p1',movesRemaining:2,returnToAction:false};
 const wire=await mount(page,game);
 for(const summary of await page.locator('.player summary').all())await summary.click();
 await expect(page.locator('.player[open]')).toHaveCount(0);
 await selectControlTab(page,'Evocations');
 await expect(page.locator('#retinue-p1')).toBeVisible();
 await expect(page.locator('#retinue-p2')).toBeHidden();
 await expect(page.locator('.evocation-controls')).toContainText('Cadaver #2');
 const attack=page.getByRole('button',{name:/Cadaver attack Blue Seer/});await expect(attack).toBeEnabled();
 await attack.click();await expect.poll(()=>wire.commands.length).toBe(1);
 expect(wire.commands[0].action).toEqual({type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
 await expect(page.getByRole('button',{name:'Finish evocation',exact:true})).toBeDisabled();wire.ack();
 await page.getByRole('button',{name:'Finish evocation',exact:true}).click();await expect.poll(()=>wire.commands.length).toBe(2);
 expect(wire.commands[1].action).toEqual({type:'END_EVOCATION',playerId:'p1'});wire.ack();
 game.evocations=[model('active-enemy','p2',1)];game.currentPlayerId='p2';game.evocationActivation={evocationId:'active-enemy',playerId:'p2',movesRemaining:2,returnToAction:false};wire.update(game);
 await expect(page.locator('.evocation-controls')).toHaveCount(0);
});

for(const viewport of [{width:1440,height:1200},{width:390,height:844}]) {
test(`twelve evocations and four mages fit as matching circular tokens at ${viewport.width}px`,async ({page},testInfo)=>{
 const game=fixtureState(4);
 game.players.forEach(p=>{p.wizard.position={q:0,r:0};});
 game.evocations=game.players.flatMap(p=>[1,2,3].map(n=>model(`${p.id}-${n}`,p.id,n)));
 await page.setViewportSize(viewport);await mount(page,game);await page.evaluate(()=>document.fonts.ready);
 const geometry=await hex(page,'room-0,0').evaluate(room=>{
  const polygon=room.querySelector<SVGPolygonElement>('polygon')!;
  const badge=room.querySelector<SVGGElement>('.capacity-badge')!.getBBox();
  const name=room.querySelector<SVGTextElement>('.room-name')!.getBBox();
  const toLocal=(el:SVGGraphicsElement)=>polygon.getScreenCTM()!.inverse().multiply(el.getScreenCTM()!);
  const circles=Array.from(room.querySelectorAll<SVGCircleElement>('.mage-token-disc')).map(circle=>{
   const point=new DOMPoint().matrixTransform(toLocal(circle));return {x:point.x,y:point.y,r:circle.r.baseVal.value};
  });
  return {
   inside:circles.every(c=>[[c.x-c.r,c.y],[c.x+c.r,c.y],[c.x,c.y-c.r],[c.x,c.y+c.r]].every(([x,y])=>polygon.isPointInFill(new DOMPoint(x,y)))),
   clear:circles.every(c=>c.y+c.r<badge.y&&c.y-c.r>name.y+name.height),
   separated:circles.every((c,i)=>circles.slice(i+1).every(other=>Math.hypot(c.x-other.x,c.y-other.y)>c.r+other.r)),
   matchingSize:circles.every(c=>c.r===circles[0].r),
  };
 });
 await expect(page.locator('.evocation-marker')).toHaveCount(12);
 await expect(hex(page,'room-0,0').locator('.mage-token-disc')).toHaveCount(16);
 expect(geometry).toEqual({inside:true,clear:true,separated:true,matchingSize:true});
 await testInfo.attach(`evocation-circles-${viewport.width}`,{body:await page.locator('.board-viewport').screenshot({path:testInfo.outputPath('evocation-circles.png')}),contentType:'image/png'});
});
}

test('evocation targets include only enemy models in the same room and update after movement',async ({page})=>{
 const game=fixtureState(4);game.phase='EVOCATION';game.activation=null;
 game.players[1].wizard.position={q:0,r:0};
 game.players[2].wizard.position={q:1,r:0};
 game.players[3].wizard.position={q:-1,r:0};
 game.evocations=[model('own-active','p1',1),model('own-friendly','p1',2),model('same-room-enemy','p2',1),model('adjacent-enemy','p3',1,{q:1,r:0})];
 game.evocationActivation={evocationId:'own-active',playerId:'p1',movesRemaining:2,returnToAction:false};
 const wire=await mount(page,game);
 await selectControlTab(page,'Evocations');
 const controls=page.locator('.evocation-controls');
 await expect(controls.getByRole('button',{name:/^Cadaver attack/})).toHaveCount(2);
 await expect(controls.getByRole('button',{name:/^Cadaver attack Blue Seer/})).toBeEnabled();
 await expect(controls.getByRole('button',{name:/^Cadaver attack Cadaver #1 \(Blue Seer\)/})).toBeEnabled();
 await expect(controls.getByRole('button',{name:/Cadaver attack.*(Rose Warden|Amber Sage|Green Mage)/})).toHaveCount(0);
 await expect(controls).toContainText('one enemy model in this room');

 game.evocations[0].position={q:1,r:0};game.evocationActivation.movesRemaining=1;wire.update(game);
 await expect(controls.getByRole('button',{name:/^Cadaver attack/})).toHaveCount(2);
 await expect(controls.getByRole('button',{name:/Cadaver attack.*Blue Seer/})).toHaveCount(0);
 await expect(controls.getByRole('button',{name:/^Cadaver attack Amber Sage/})).toBeEnabled();
 await controls.getByRole('button',{name:/^Cadaver attack Cadaver #1 \(Amber Sage\)/}).click();
 await expect.poll(()=>wire.commands.length).toBe(1);
 expect(wire.commands[0].action).toEqual({type:'EVOCATION_ATTACK',playerId:'p1',targetId:'adjacent-enemy'});wire.ack();

 game.evocations[0].position={q:0,r:-1};game.evocationActivation.movesRemaining=0;wire.update(game);
 await expect(controls.getByRole('button',{name:/^Cadaver attack/})).toHaveCount(0);
 await expect(controls).toContainText('No enemy models in this room');
 await expect(controls.getByRole('button',{name:'Finish evocation',exact:true})).toBeEnabled();
});

test('evocation UI recognizes different tiles belonging to one room, not just equal coordinates',async ({page})=>{
 const game=fixtureState();game.phase='EVOCATION';game.activation=null;
 const source=game.board.rooms.find(r=>r.id==='room-0,0')!;
 source.tiles.push({q:1,r:0});game.board.rooms=game.board.rooms.filter(r=>r.id!=='room-1,0');
 game.evocations=[model('room-attacker','p1',1)];
 game.evocationActivation={evocationId:'room-attacker',playerId:'p1',movesRemaining:0,returnToAction:false};
 await mount(page,game);
 await selectControlTab(page,'Evocations');
 await expect(page.locator('.evocation-controls').getByRole('button',{name:/^Cadaver attack Blue Seer/})).toBeEnabled();
});

test('history clears targeting, stays available after handoff, and is disabled pending or offline',async ({page})=>{
 const game=fixtureState();game.history={canUndo:true,canRedo:true,undoLabel:'Move a mage',redoLabel:'Attack'};
 game.players[0].prepared.slot1={card:preparedSpell,used:false};
 const wire=await mount(page,game);
 const history=(name:'Undo action'|'Redo action')=>page.getByRole('button',{name,exact:true,includeHidden:true});
 await selectSpells(page);await page.locator('.prepared .spell').click();await page.getByRole('button',{name:'Target dummy · no damage',exact:true}).click();await hex(page,'room-0,0').click();
 await expect(page.locator('.room-detail button').filter({hasNotText:/Target (model|dummy)/})).toHaveCount(1);
 await pressHistory(page,'Undo action');await expect.poll(()=>wire.commands.length).toBe(1);
 expect(wire.commands[0].action).toEqual({type:'UNDO_ACTION',playerId:'p1'});
 await expect(page.locator('.room-detail,.spell.chosen,.target-mode')).toHaveCount(0);
 await expect(history('Undo action')).toBeDisabled();
 await expect(history('Redo action')).toBeDisabled();
 await expect(history('Undo action')).toHaveAttribute('title','Undo: Move a mage');
 await expect(history('Redo action')).toHaveAttribute('title','Redo: Attack');wire.ack();
 game.currentPlayerId='p2';game.activation!.playerId='p2';wire.update(game);
 await expect(page.locator('.actions-panel')).toHaveCount(0);
 await expect(history('Undo action')).toBeEnabled();
 await pressHistory(page,'Undo action');await expect.poll(()=>wire.commands.length).toBe(2);
 expect(wire.commands[1].action).toEqual({type:'UNDO_ACTION',playerId:'p1'});wire.ack();
 await pressHistory(page,'Redo action');await expect.poll(()=>wire.commands.length).toBe(3);
 expect(wire.commands[2].action).toEqual({type:'REDO_ACTION',playerId:'p1'});wire.ack();
 wire.close();await expect(page.locator('.header-meta')).toContainText('Offline');
 await expect(history('Undo action')).toHaveCount(0);
 await expect(history('Redo action')).toHaveCount(0);
});

test('history clears discard-exit choice; missing or false metadata never creates usable history controls',async ({page})=>{
 const game=fixtureState();game.players[0].wizard.position={q:3,r:-2};game.players[0].hand=[preparedSpell];
 const wire=await mount(page,game);
 await expect(page.locator('.turn-banner .turn-history')).toHaveCount(0);
 game.history={canUndo:false,canRedo:false};wire.update(game);await expect(page.locator('.turn-banner .turn-history')).toHaveCount(0);
 game.history={canUndo:true,canRedo:false};wire.update(game);
 await selectControlTab(page,'Physical actions');
 await page.getByLabel('Card to discard to move').selectOption(preparedSpell.id);
 await expect(page.locator('.board-panel h2')).toHaveText('Discard to move · choose an adjacent space');
 await page.getByRole('button',{name:'Undo action',exact:true}).click();await expect.poll(()=>wire.commands.length).toBe(1);
 await expect(page.getByLabel('Card to discard to move')).toHaveValue('');
 await expect(page.locator('.board-panel h2')).toHaveText('Chambers of the Pink Tulip');
});

test('Pink Tulip score, first player and Pink Tulip game-over winner are public without extra mage rows',async ({page})=>{
 const game=fixtureState();game.blackRose={victoryPoints:35,kills:3};
 const wire=await mount(page,game);
 await expect(page.locator('.players-panel .player')).toHaveCount(2);
 await expect(page.locator('.black-rose-score')).toContainText('35 VP');
 await expect(page.locator('.black-rose-score')).toContainText('3 kills');
 await expect(player(page,'p1').getByRole('img',{name:'First player',exact:true})).toBeVisible();
 await expectReference(page,'round 3');
 for(const text of ['4 cubes · 2 / 1 / 0 VP','5 cubes · 4 / 2 / 1 VP','6 cubes · 5 / 3 / 1 VP','10 cubes · 6 / 3 / 1 VP','Pink Tulip competes for kills, not quests'])await expectReference(page,text);
 game.phase='GAME_OVER';game.currentPlayerId=null;game.activation=null;game.winner=BLACK_ROSE_ID;game.endgameScored=true;wire.update(game);await dismissOverlay(page);
 await expect(page.locator('.victory h2')).toHaveText('♛ Pink Tulip wins');
 await expect(page.locator('.victory')).toContainText('Pink Tulip: 35 VP · 3 kills');
 await expect(page.locator('.victory')).toContainText('Final majorities and first-player bonus included');
 await expect(page.locator('.players-panel .player')).toHaveCount(2);
 await expect(page.locator('.actions-panel')).toHaveCount(0);
});

for(const viewport of [{width:1440,height:1200},{width:390,height:844}]) {
test(`glossary, Ready versus Active and accessible spell-type icons at ${viewport.width}px`,async ({page},testInfo)=>{
 const game=fixtureState();
 const take=(name:string)=>{
  const deck=game.library.find(d=>d.cards.some(c=>c.name===name))!;
  return deck.cards.splice(deck.cards.findIndex(c=>c.name===name),1)[0];
 };
 const cases=[
  {slot:'slot1',name:'Arcane Bolt',type:'COMBAT',label:'Combat'},
  {slot:'slot2',name:'Mending Light',type:'CONTINGENCY',label:'Contingency'},
  {slot:'slot3',name:'Threshold Snare',type:'TRAP',label:'Trap'},
  {slot:'rapid',name:'Thorn Retort',type:'PROTECTION',label:'Protection'},
 ] as const;
 for(const item of cases)game.players[0].prepared[item.slot]={card:take(item.name),used:false};
 const own=take('Threshold Snare'),foreign=take('Mending Ward'),ongoing=take("Pilgrim's Mark");
 game.readiedSpells=[{id:'own-active',playerId:'p1',card:own,roomId:'room-1,0'},
  {id:'foreign-active',playerId:'p2',card:foreign,targetPlayerId:'p2'}];
 game.ongoingSpells=[{id:'ongoing-active',playerId:'p1',card:ongoing,targetPlayerId:'p1'}];
 game.activeSpellOrder=['own-active','foreign-active','ongoing-active'];
 game.players[0].hand=[game.powerfulDeck.pop()!];
 Object.assign(game.players[1].wizard,{damageCubes:1,damageByPlayer:{[BLACK_ROSE_ID]:1}});
 Object.assign(game.board.rooms.find(r=>r.id==='room-0,0')!,{instability:1,cubesByPlayer:{[BLACK_ROSE_ID]:1}});
 await page.setViewportSize(viewport);await mount(page,game);
 await expect(page.locator('.brand')).toContainText(/PINK TULIP BATTLES/i);
 await expect(page.locator('footer')).toContainText(/PINK TULIP BATTLES/i);
 await expect(page.locator('.black-rose-score')).toHaveAttribute('aria-label','Pink Tulip score');
 await expect(page.locator('.black-rose-score')).toContainText('Pink Tulip');
 await expect(player(page,'p2').locator('.damage-contributions')).toContainText('Pink Tulip: 1');
 await expect(page.locator('.board-panel .room-legend,.board-panel .mage-legend')).toHaveCount(0);
 await closeControls(page);
 await page.getByRole('button',{name:'Lodge information',exact:true}).click();
 const information=page.getByRole('dialog',{name:'Lodge information',exact:true});
 await expect(information.locator('.mage-legend')).toBeVisible();
 await expect(information.locator('.mage-legend')).toContainText('Pink Tulip · neutral');
 await information.getByRole('button',{name:'Close',exact:true}).click();
 await expect(information).toBeHidden();
 await hex(page,'room-0,0').click();
 await expect(page.locator('.room-detail .contributions')).toContainText('Pink Tulip: 1');
 await selectSpells(page);
 await expect(page.locator('.powerful-panel').getByRole('heading',{name:'Forgotten spells',exact:true})).toBeVisible();
 await expectReference(page,'Forgotten spells:');
 await expect(page.locator('.app')).not.toContainText(/Central powers|Readied & ongoing|Readied and ongoing|Hidden ready spell|Ready secretly|Offensive/);
 expect(await page.locator('.app').textContent()).not.toMatch(/black\s*rose|\(not\)/i);
 for(const item of cases) {
  const card=page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:new RegExp(`^${item.name}$`)})});
  await expect(card.locator('.spell-type')).toHaveAttribute('data-spell-type',item.type);
  await expectSpellType(card.locator('.spell-type'),item.label);
  await expect(card).toContainText('Ready');
  await expectSpellIcon(card,item.label);
 }
 const active=page.getByRole('region',{name:'Active and ongoing spells',exact:true});
 await expect(active.getByRole('heading',{name:'Active & ongoing',exact:true})).toBeVisible();
 await expectSpellType(active.locator('.own-spell .spell-type'),'Trap · Active');
 await expect(active.locator('.own-spell strong')).toHaveText(own.name);
 const hidden=active.locator('.hidden-spell');
 await expect(hidden.locator('strong')).toHaveText('Hidden active spell');
 await expect(hidden.locator('.spell-type')).toHaveAttribute('data-spell-type','PROTECTION');
 await expectSpellType(hidden.locator('.spell-type'),'Protection · Active');
 await expectSpellIcon(hidden,'Protection');
 await expect(hidden.locator('small')).toHaveText('Blue Seer');
 await expect(hidden.locator('p')).toHaveText('Only its type is public. Its name, binding and trigger stay hidden until it reveals.');
 const markup=await hidden.evaluate(element=>element.outerHTML);
 for(const secret of [foreign.id,foreign.name,foreign.rulesText!,'targetPlayerId','DAMAGE_TAKEN','BOUND_MODEL'])expect(markup).not.toContain(secret);
 await expect(active.locator('.ongoing-spell strong')).toHaveText(ongoing.name);
 await expectSpellType(active.locator('.ongoing-spell .spell-type'),'Contingency · Ongoing');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await testInfo.attach(`spell-types-${viewport.width}`,{body:await page.locator('.cards.prepared').screenshot({path:testInfo.outputPath('spell-types.png')}),contentType:'image/png'});
 await testInfo.attach(`active-spells-${viewport.width}`,{body:await active.screenshot({path:testInfo.outputPath('active-spells.png')}),contentType:'image/png'});
});
}