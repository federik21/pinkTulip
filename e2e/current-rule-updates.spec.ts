import { expect, test, type Page } from '@playwright/test';
import { areAdjacent, createGame, isInStartingRoom, summonEvocation } from '../packages/game-engine/src';
import type { Card, GameAction, GameState } from '../packages/game-engine/src';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { closeControls, openChronicle, selectControlTab, selectSpells } from './layout-ui';

function fixture() {
 const s=createGame(2);s.gameId='current-rules';s.round=1;s.phase='ACTION';s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false};
 s.players.forEach(p=>{p.connected=true;p.wizard.position={q:0,r:0};});s.players[0].name='Rose Warden';s.players[1].name='Blue Seer';return s;
}
function take(s:GameState,name:string) {
 const index=s.library[0].cards.findIndex(c=>c.name===name);return s.library[0].cards.splice(index,1)[0];
}
async function mount(page:Page,initial:GameState) {
 let game=structuredClone(initial),publish=()=>{};const history=new ActionHistory(),actions:GameAction[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await page.routeWebSocket('**',route=>{
  publish=()=>route.send(JSON.stringify({type:'STATE',state:publicState(game,'p1',history)}));
  route.onMessage(data=>{const msg=JSON.parse(String(data));
   if(msg.type==='CREATE_ROOM'){route.send(JSON.stringify({type:'WELCOME',playerId:'p1',roomId:game.gameId}));publish();}
   else if(msg.action)try{game=history.apply(game,msg.action,'p1');actions.push(msg.action);publish();route.send(JSON.stringify({type:'ACTION_APPLIED',requestId:msg.requestId}));}
   catch(error){errors.push(String(error));route.send(JSON.stringify({type:'ERROR',requestId:msg.requestId,message:String(error)}));}
  });
 });
 await page.goto('/');await page.getByRole('button',{name:'Create room',exact:true}).click();
 await expect(page.locator('.phase-overlay')).toBeVisible();await page.locator('.phase-overlay').click();
 return {actions,errors,get state(){return game;},dispatch(action:GameAction){game=history.apply(game,action,action.playerId);publish();}};
}

for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test.describe(`${viewport.width}px current rules`,()=>{
 test.use({viewport,reducedMotion:'reduce'});
 test('last-action cell exit disables End turn and Explore skip controls until the mage actually leaves',async({page})=>{
  const s=fixture();s.activation!.actionsUsed=1;s.players[0].wizard.position={...s.board.rooms.find(r=>r.startingFor==='p1')!.tiles[0]};
  const destination=s.board.tiles.find(h=>areAdjacent(s.players[0].wizard.position,h)&&!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(t=>t.q===h.q&&t.r===h.r)))!;
  const room=s.board.rooms.find(r=>r.tiles.some(h=>h.q===destination.q&&h.r===destination.r))!;
  const wire=await mount(page,s);await expect(page.locator('.turn-banner')).toContainText('Use your last action to leave the cell.');
  await expect(page.getByRole('button',{name:/^End turn/})).toBeDisabled();await selectControlTab(page,'Physical actions');
  await page.getByRole('region',{name:'Physical actions',exact:true}).getByRole('button',{name:/^Explore/}).click();await closeControls(page);
  await expect(page.locator('.turn-banner').getByRole('button',{name:'Finish action',exact:true})).toBeDisabled();
  await page.locator('.turn-banner').getByRole('button',{name:'Move 2',exact:true}).click();
  await expect(page.locator('.turn-banner').getByRole('button',{name:'Finish moving early',exact:true})).toBeDisabled();
  await page.locator(`.hex[data-room-id="${room.id}"]`).click();
  await expect(page.locator('.turn-banner').getByRole('button',{name:'Finish action',exact:true})).toBeEnabled();
  await page.locator('.turn-banner').getByRole('button',{name:'Finish action',exact:true}).click();
  expect(wire.state.currentPlayerId).toBe('p2');expect(isInStartingRoom(wire.state,wire.state.players[0])).toBe(false);expect(wire.errors).toEqual([]);
 });
 test('a tokenless mage can spend the required action by discarding a card to leave',async({page})=>{
  const s=fixture();s.activation!.actionsUsed=1;s.players[0].actionTokens=0;s.players[0].wizard.position={...s.board.rooms.find(r=>r.startingFor==='p1')!.tiles[0]};
    const preparedready=take(s,'Grim Torment');s.players[0].prepared.slot1={card:preparedready,used:false};
  const dest=s.board.rooms.find(r=>!r.startingFor&&r.tiles.some(h=>areAdjacent(s.players[0].wizard.position,h)))!;
  const wire=await mount(page,s);await selectControlTab(page,'Physical actions');
    await page.getByRole('combobox',{name:'Card to discard to move'}).selectOption(preparedready.id);await closeControls(page);
  await page.locator(`.hex[data-room-id="${dest.id}"]`).click();
    await expect.poll(()=>wire.actions.length).toBe(1);expect(wire.actions[0]).toMatchObject({type:'DISCARD_EXIT',cardId:preparedready.id});
  expect(isInStartingRoom(wire.state,wire.state.players[0])).toBe(false);expect(wire.state.players[0].actionTokens).toBe(0);expect(wire.errors).toEqual([]);
 });
 test('Peak targets a room at range 2, converts caster wounds, resolves Pain and logs all three moments',async({page})=>{
  const s=fixture(),card=take(s,'Peak of Agony');s.players[0].prepared.rapid={used:false,card};
  s.players[1].wizard.position={q:2,r:0};
  s.players[0].wizard.damageCubes=2;s.players[0].wizard.damageByPlayer={p2:2};s.players[0].wizard.damageOrder=['p2','p2'];s.players[1].cubes.available-=2;s.players[1].cubes.onWizard=2;
  const own=summonEvocation(s,s.players[0],'CADAVER',{q:2,r:0})!,enemy=summonEvocation(s,s.players[1],'CADAVER',{q:2,r:0})!;
  const wire=await mount(page,s);await selectSpells(page);const spell=page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Peak of Agony'})});
  await expect(spell.locator('.spell-effects > span')).toHaveText([/Inflict 2 · enemy models in target room/,/Pink Tulip convert 2 · your mage · last damage from other mages/,/Pain 2/]);
  await expect(spell).toContainText('Range 2');await spell.click();
  await page.locator('.hex[data-room-id="room-1,1"]').click();await expect(page.getByRole('button',{name:'Cast Peak of Agony here',exact:true})).toBeDisabled();
  await page.locator('.hex[data-room-id="room-2,0"]').click();await page.getByRole('button',{name:'Cast Peak of Agony here',exact:true}).click();
  await expect.poll(()=>wire.actions.length).toBe(1);expect(wire.actions[0]).toMatchObject({type:'CAST_SPELL',roomId:'room-2,0'});
  expect(wire.state.players[0].wizard).toMatchObject({damageCubes:4,blackDamage:4,damageByPlayer:{}});
  expect(wire.state.players[1].wizard.damageCubes).toBe(2);expect(wire.state.evocations.find(e=>e.id===own.id)!.damageCubes).toBe(0);
  expect(wire.state.evocations.some(e=>e.id===enemy.id)).toBe(false);expect(wire.state.players[1].cubes.available).toBe(25);
  const chronicle=await openChronicle(page);await expect(chronicle.getByRole('log')).toContainText('Rose Warden casts Peak of Agony');
  await expect(chronicle.getByRole('log')).toContainText('Moment 1/3 · Peak of Agony: Deal 2 damage to enemy models in the selected room');
  await expect(chronicle.getByRole('log')).toContainText('Moment 2/3 · Peak of Agony: Convert the last 2 damage cubes received from other mages on the caster’s mage');
  await expect(chronicle.getByRole('log')).toContainText('Moment 3/3 · Peak of Agony: The Pink Tulip inflicts 2 damage cubes');
  expect(wire.errors).toEqual([]);await page.screenshot({path:test.info().outputPath('peak-chronicle.png')});
  const resolved=structuredClone(wire.state);await chronicle.getByRole('button',{name:'Close Chronicle',exact:true}).click();
  await page.getByRole('button',{name:'Undo action',exact:true}).click();await expect.poll(()=>wire.actions.length).toBe(2);expect(wire.state).toEqual(s);
  await page.getByRole('button',{name:'Redo action',exact:true}).click();await expect.poll(()=>wire.actions.length).toBe(3);expect(wire.state).toEqual(resolved);expect(wire.errors).toEqual([]);
 });
 test('Peak offers Soul Tithe for final Pain after converting wounds, never for friendly room damage',async({page})=>{
  const s=fixture(),card=take(s,'Peak of Agony');s.players[0].prepared.rapid={used:false,card};s.players[1].wizard.position={q:2,r:0};
  s.players[0].wizard.damageCubes=2;s.players[0].wizard.damageByPlayer={p2:2};s.players[0].wizard.damageOrder=['p2','p2'];s.players[1].cubes.available-=2;s.players[1].cubes.onWizard=2;
  const own=summonEvocation(s,s.players[0],'SUCCUBUS',{q:0,r:0})!,wire=await mount(page,s);await selectSpells(page);
  await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Peak of Agony'})}).click();
  await page.locator('.hex[data-room-id="room-2,0"]').click();await page.getByRole('button',{name:'Cast Peak of Agony here',exact:true}).click();
  const prompt=page.getByRole('dialog',{name:/Let Succubus.*take a damage cube/});await expect(prompt).toBeVisible();
  await prompt.getByRole('button',{name:'Take a cube',exact:true}).click();await expect(prompt).toBeHidden();
  await expect.poll(()=>wire.actions.length).toBe(2);expect(wire.state.players[0].wizard).toMatchObject({damageCubes:3,blackDamage:3,damageByPlayer:{}});
  expect(wire.state.players[1].wizard.damageCubes).toBe(2);expect(wire.state.evocations.find(e=>e.id===own.id)!.damageCubes).toBe(1);
  const events=wire.state.feedbackEvents!,converted=events.findIndex(e=>e.kind==='CONVERT');
  expect(events[converted]).toMatchObject({target:{id:'p1'},amount:2,total:2});expect(events.slice(converted+1).filter(e=>e.kind==='DAMAGE').map(e=>e.sourceId)).toEqual(['black-rose','black-rose']);
  expect(wire.errors).toEqual([]);
 });
 test('Chronicle keeps face-down names hidden and adds card moments only on reveal',async({page})=>{
  const s=fixture(),card=take(s,'Torment');s.players[0].prepared.rapid={used:false,card};const wire=await mount(page,s);
  await selectSpells(page);await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Torment'})}).click();
  await page.getByRole('button',{name:'Confirm activation',exact:true}).click();await expect.poll(()=>wire.actions.length).toBe(1);
  let chronicle=await openChronicle(page);await expect(chronicle.getByRole('log')).not.toContainText('Torment');await chronicle.getByRole('button',{name:'Close Chronicle',exact:true}).click();
  wire.dispatch({type:'END_ACTIVATION',playerId:'p1'});wire.dispatch({type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'ATTACK'});wire.dispatch({type:'INFLICT_ATTACK',playerId:'p2',targetId:'p1'});
  await page.getByRole('button',{name:'Reveal and resolve',exact:true}).click();await expect(page.getByRole('dialog',{name:'Reveal an active spell?',exact:true})).toBeHidden();
  chronicle=await openChronicle(page);await expect(chronicle.getByRole('log')).toContainText('reveals Torment');await expect(chronicle.getByRole('log')).toContainText('Moment 1/2 · Torment');await expect(chronicle.getByRole('log')).toContainText('Moment 2/2 · Torment');expect(wire.errors).toEqual([]);
 });
 test('an ongoing spell remains visible and bound after the mage is defeated',async({page})=>{
  const s=fixture(),card=take(s,'Pain Mark');s.ongoingSpells!.push({id:'persistent-mark',playerId:'p1',targetPlayerId:'p2',card});s.activeSpellOrder!.push('persistent-mark');
  s.players[1].wizard.health=1;const strike:Card={id:s.library[0].cards.shift()!.id,name:'Strike',kind:'SPELL',target:'MAGE',range:Infinity,moments:[{effect:'DAMAGE',amount:1}]};s.players[0].prepared.rapid={used:false,card:strike};
  const wire=await mount(page,s);wire.dispatch({type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});await selectSpells(page);
  const ongoing=page.locator('.ongoing-spell[data-active-spell-id="persistent-mark"]');await expect(ongoing).toBeVisible();await expect(ongoing).toContainText('Pain Mark');await expect(ongoing).toContainText('Bound to Blue Seer');await expect(ongoing).toContainText('Persists through mage defeat and respawn');
  expect(wire.state.ongoingSpells).toHaveLength(1);expect(wire.state.library[0].discard.some(c=>c.id===card.id)).toBe(false);expect(wire.errors).toEqual([]);
 });
 for(const source of ['PHYSICAL','SPELL','EVOCATION','ROOM','QUEST'] as const)test(`Pain Mark ${source==='PHYSICAL'||source==='SPELL'?'counts':'ignores'} ${source.toLowerCase()} damage through the actual controls`,async({page})=>{
  const s=fixture(),mark=take(s,'Pain Mark');s.ongoingSpells!.push({id:'source-mark',playerId:'p2',targetPlayerId:'p1',card:mark});s.activeSpellOrder!.push('source-mark');
  if(source==='EVOCATION')summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0});
  if(source==='ROOM')s.board.rooms.find(r=>r.id==='room-0,0')!.effect='ROOM_DAMAGE';
  if(source==='SPELL')s.players[0].prepared.rapid={used:false,card:{id:s.library[0].cards.shift()!.id,name:'UI damage',kind:'SPELL',spellType:'COMBAT',range:1,target:'MAGE',moments:[{effect:'DAMAGE',amount:1}]}};
  if(source==='QUEST'){
   const index=s.questDeck.findIndex(q=>q.kind==='INSTABILITY');s.players[0].quest=s.questDeck.splice(index,1)[0];s.players[0].quest!.completed=true;
  }
  const wire=await mount(page,s);
  if(source==='EVOCATION'){
   await selectControlTab(page,'Evocations');await page.locator('#retinue-p1').getByRole('button',{name:/^Activate Cadaver #1/}).click();
   await page.locator('.turn-banner .evocation-controls').getByRole('button',{name:/^Cadaver attack/}).click();
  }else if(source==='ROOM'||source==='PHYSICAL'){
   await selectControlTab(page,'Physical actions');await page.getByRole('region',{name:'Physical actions',exact:true}).getByRole('button',{name:source==='ROOM'?/^Explore/:/^Attack/}).click();await closeControls(page);
   await page.locator('.turn-banner').getByRole('button',{name:source==='ROOM'?'Activate room':'Attack Blue Seer',exact:true}).click();
  }else if(source==='QUEST'){
   const quest=s.players[0].quest!;await selectControlTab(page,'Quests');const panel=page.getByRole('region',{name:'Quests',exact:true});
   await panel.getByRole('combobox',{name:`Reward target for ${quest.name}`}).selectOption('p2');await panel.getByRole('button',{name:`Solve ${quest.name} for free`,exact:true}).click();
  }else{
   await selectSpells(page);await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'UI damage'})}).click();await page.locator('.hex[data-room-id="room-0,0"]').click();await page.getByRole('button',{name:'Cast UI damage here',exact:true}).click();
  }
  await expect.poll(()=>wire.actions.length).toBe(source==='SPELL'||source==='QUEST'?1:2);
  const eligible=source==='PHYSICAL'||source==='SPELL';expect(wire.state.players[0].wizard.damageCubes).toBe(eligible?2:0);
  expect(wire.state.players[1].wizard.damageCubes).toBe(source==='PHYSICAL'||source==='EVOCATION'?2:1);
  expect(wire.state.feedbackEvents!.filter(e=>e.kind==='SPELL_TRIGGERED'&&e.activeSpellId==='source-mark')).toHaveLength(eligible?1:0);
  expect(wire.errors).toEqual([]);
 });
 test('end of Pink Tulip replaces solved-only held quests but preserves completed unsolved rewards',async({page})=>{
  const s=fixture();s.phase='BLACK_ROSE';s.activation=null;s.currentPlayerId=null;
  const solved=s.questDeck.shift()!;Object.assign(solved,{completed:true,claimed:true});s.players[0].quest=solved;
  const ready=s.questDeck.shift()!;Object.assign(ready,{completed:true,claimed:false});s.players[1].quest=ready;
  const wire=await mount(page,s);await page.getByRole('button',{name:'Receive quests & begin Study →',exact:true}).click();
  await expect(page.locator('.phase-overlay')).toBeVisible();await page.locator('.phase-overlay').click();
  expect(wire.state.players[0].quest!.id).not.toBe(solved.id);expect(wire.state.questDiscard.filter(q=>q.id===solved.id)).toHaveLength(1);expect(wire.state.players[1].quest!.id).toBe(ready.id);
  await selectControlTab(page,'Quests');await expect(page.getByRole('region',{name:'Quests',exact:true})).toContainText(wire.state.players[0].quest!.name);expect(wire.errors).toEqual([]);
 });
});