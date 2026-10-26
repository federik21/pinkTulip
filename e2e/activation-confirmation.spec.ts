import { expect, test, type Page } from '@playwright/test';
import { applyAction, createEnchantmentDeck, createGame, summonEvocation } from '../packages/game-engine/src';
import type { Card, GameAction, GameState } from '../packages/game-engine/src';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { closeControls, selectControlTab, selectSpells } from './layout-ui';

function fixture(name='Torment') {
 const s=createGame(2);s.gameId='activation';s.round=1;s.phase='ACTION';s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 let card:Card|undefined;
 if(name==='Torment'||name==='Cross and Delight') {
  const deck=s.library[0],index=deck.cards.findIndex(c=>c.name===name);card=deck.cards.splice(index,1)[0];
 } else card=createEnchantmentDeck().find(c=>c.name===name);
 s.players[0].prepared.slot1={card:card!,used:false};
 return s;
}

async function mount(page:Page,initial:GameState) {
 let game=initial,publish=()=>{};const actions:GameAction[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await page.routeWebSocket('**',route=>{
  publish=()=>route.send(JSON.stringify({type:'STATE',state:publicState(game,'p1',new ActionHistory())}));
  route.onMessage(data=>{
   const message=JSON.parse(String(data));
   if(message.type==='CREATE_ROOM') {route.send(JSON.stringify({type:'WELCOME',playerId:'p1',roomId:'activation'}));publish();}
   else if(message.action) {
    try {game=applyAction(game,message.action);actions.push(message.action);publish();route.send(JSON.stringify({type:'ACTION_APPLIED',requestId:message.requestId}));}
    catch(error){errors.push(String(error));route.send(JSON.stringify({type:'ERROR',message:String(error)}));}
   }
  });
 });
 await page.goto('/');await page.getByRole('button',{name:'Create room',exact:true}).click();
 await expect(page.locator('.phase-overlay')).toBeVisible();await page.locator('.phase-overlay').click();
 await selectSpells(page);
 return {actions,errors,get state(){return game;},dispatch(action:GameAction){game=applyAction(game,action);publish();},update(next:GameState){game=next;publish();}};
}

for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
 test.describe(`${viewport.width}px target-free activation`,()=>{
  test.use({viewport,reducedMotion:'reduce'});
  for(const name of ['Torment','Mending Ward'])test(`${name} asks only to confirm activation, never for a room`,async({page})=>{
   const wire=await mount(page,fixture(name));
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:name})}).click();
   const dialog=page.getByRole('dialog',{name:`Activate ${name}?`,exact:true});
   await expect(dialog).toBeVisible();
   await expect(dialog).toContainText('No room or target is chosen');
   await expect(dialog.getByRole('combobox')).toHaveCount(0);
   await expect(page.locator('.target-mode')).toHaveCount(0);
   await expect(page.locator('.hex.selected')).toHaveCount(0);
   await expect(page.getByRole('combobox',{name:'Spell target model'})).toHaveCount(0);
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
   expect(wire.actions).toEqual([]);
   await selectSpells(page);
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:name})}).click();
   await dialog.getByRole('button',{name:'Confirm activation',exact:true}).click();
   await expect.poll(()=>wire.actions.length).toBe(1);
   expect(wire.actions[0]).toEqual({type:'ACTIVATE_SPELL',playerId:'p1',slot:'slot1'});
   expect(wire.state.readiedSpells).toHaveLength(1);
   expect(wire.state.readiedSpells![0]).not.toHaveProperty('roomId');
   await expect(dialog).toBeHidden();expect(wire.errors).toEqual([]);
  });

  test('Torment can be kept hidden, then revealed with a target after a later trigger',async({page})=>{
   const wire=await mount(page,fixture());
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Torment'})}).click();
   await page.getByRole('button',{name:'Confirm activation'}).click();
   await expect.poll(()=>wire.actions.length).toBe(1);
   const activeId=wire.state.readiedSpells![0].id;
   wire.dispatch({type:'END_ACTIVATION',playerId:'p1'});
   // Use a deterministic, non-drawing room effect to exercise real interruptions.
   const next=structuredClone(wire.state);next.board.rooms.find(r=>r.id==='room-0,0')!.effect='INSTABILITY';wire.update(next);
   wire.dispatch({type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'EXPLORE'});
   wire.dispatch({type:'ACTIVATE_ROOM',playerId:'p2'});
   const dialog=page.getByRole('dialog',{name:'Reveal an active spell?',exact:true});
   await expect(dialog).toBeVisible();
   await dialog.getByRole('button',{name:'Keep all hidden'}).click();
   await expect(dialog).toBeHidden();expect(wire.state.readiedSpells![0].id).toBe(activeId);
   wire.dispatch({type:'SKIP_PHYSICAL_EFFECTS',playerId:'p2'});
   wire.dispatch({type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'EXPLORE'});
   wire.dispatch({type:'ACTIVATE_ROOM',playerId:'p2'});
   await expect(dialog).toBeVisible();
   await expect(dialog.getByRole('button',{name:'Reveal and resolve'})).toBeDisabled();
   await dialog.getByRole('combobox',{name:'Triggered spell target'}).selectOption('p2');
   await dialog.getByRole('button',{name:'Reveal and resolve'}).click();
   await expect(dialog).toBeHidden();
   expect(wire.state.readiedSpells).toEqual([]);
   expect(wire.state.players[1].wizard.damageCubes).toBe(2);
   expect(wire.state.players[0].discard.some(c=>c.name==='Torment')).toBe(true);
   expect(wire.state.evocations[0]).toMatchObject({name:'Succubus',playerId:'p1'});
   expect(wire.errors).toEqual([]);
  });

    test('Cross and Delight resolves Pain before free player-controlled Succubus activation',async({page})=>{
     const initial=fixture('Cross and Delight'),tokens=initial.players[0].actionTokens;
     const wire=await mount(page,initial);
     const card=page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Cross and Delight'})});
    await expect(card.locator('.spell-effects > span')).toHaveText([/Summon SUCCUBUS/,/Pain 1/,/Activate Succubus/]);
     await card.click();
     await page.locator('.hex[data-room-id="room-0,0"]').click();
     await page.getByRole('button',{name:'Cast Cross and Delight here',exact:true}).click();
     const pain=page.getByRole('dialog',{name:/Let Succubus.*take a damage cube/});
     await expect(pain).toBeVisible();
     expect(wire.state.evocationActivation).toBeNull();
     await pain.getByRole('button',{name:'Take a cube',exact:true}).click();
     await expect(pain).toBeHidden();
    const controls=page.locator('.turn-banner .evocation-controls');
     await expect(controls).toBeVisible();
     await expect(controls).toContainText('2 movement remaining');
     expect(wire.state.evocationActivation?.evocationId).toBe(wire.state.evocations[0].id);
     expect(wire.state.players[0].actionTokens).toBe(tokens);
     expect(wire.state.activation?.actionsUsed).toBe(1);
     await controls.getByRole('button',{name:/^Succubus attack/}).click();
    await expect(controls).toContainText('Attack used');
    await controls.getByRole('button',{name:'Finish evocation movement early',exact:true}).click();
     await expect.poll(()=>wire.state.evocationActivation).toBeNull();
     expect(wire.state.players[1].wizard.damageCubes).toBe(2);
    expect(wire.actions.map(action=>action.type)).toEqual(['CAST_SPELL','RESPOND_SOUL_TITHE','EVOCATION_ATTACK','END_EVOCATION_MOVEMENT']);
     expect(wire.errors).toEqual([]);
    });
  test('shared supply counters update on summons and destruction, and Cadaver effect stays blank',async({page})=>{
   const initial=fixture('Cross and Delight');
   const cadaver=summonEvocation(initial,initial.players[0],'CADAVER',{q:0,r:0})!;
   cadaver.damageCubes=1;
   const wire=await mount(page,initial);
   await selectControlTab(page,'Evocations');
   const supply=page.getByRole('region',{name:'Shared evocation supply',exact:true});
   await expect(supply).toBeVisible();
   await expect(supply.locator('[data-evocation-kind="SUCCUBUS"]')).toContainText('3/3');
   await expect(supply.locator('[data-evocation-kind="CADAVER"]')).toContainText('5/6');
  const cadaverCard=page.locator(`.evocation-card[data-evocation-id="${cadaver.id}"]`);
   await expect(cadaverCard.locator('.model-stats')).toContainText('2 attack');
   await expect(cadaverCard).not.toContainText('Wounded Fury');
   await expect(cadaverCard).not.toContainText('Soul Tithe');
   wire.dispatch({type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
   const prompt=page.getByRole('dialog',{name:/Let Succubus.*take a damage cube/});
   await expect(prompt).toBeVisible();await prompt.getByRole('button',{name:'Take a cube',exact:true}).click();
   await expect(prompt).toBeHidden();
   await expect(supply.locator('[data-evocation-kind="SUCCUBUS"]')).toContainText('2/3');
   await expect(page.locator('.evocation-card').filter({hasText:'Succubus'})).toContainText('Wounded Fury');
   wire.dispatch({type:'END_EVOCATION',playerId:'p1'});
   wire.dispatch({type:'END_ACTIVATION',playerId:'p1'});
   wire.dispatch({type:'PUNCH',playerId:'p2',targetId:cadaver.id});
  await selectControlTab(page,'Evocations');
   await expect(supply.locator('[data-evocation-kind="CADAVER"]')).toContainText('6/6');
   await expect(supply.locator('[data-evocation-kind="SUCCUBUS"]')).toContainText('2/3');
   await expect(cadaverCard).toHaveCount(0);
   expect(wire.errors).toEqual([]);
  });
  test('top-banner evocation buttons allow attack, movement and early finish without reopening controls',async({page})=>{
   const initial=fixture(),evocation=summonEvocation(initial,initial.players[0],'CADAVER',{q:0,r:0})!;
   const wire=await mount(page,initial);
   await selectControlTab(page,'Evocations');
   await page.locator('#retinue-p1').getByRole('button',{name:/^Activate Cadaver #1/}).click();
   const controls=page.locator('.turn-banner .evocation-controls');
   await expect(controls).toBeVisible();await expect(page.locator('.control-banner-slot')).toBeHidden();
   await expect(controls.getByRole('button',{name:/^Cadaver attack/})).toHaveCount(1);
   await expect(page.locator('.turn-banner').getByRole('button',{name:/^End turn/})).toHaveCount(0);
   await controls.getByRole('button',{name:/^Cadaver attack/}).click();
   await expect(controls).toContainText('Attack used');
   await expect(controls.getByRole('button',{name:/^Cadaver attack/})).toHaveCount(0);
   await page.locator('.hex[data-room-id="room-1,0"]').click();
   await expect(controls).toContainText('1 movement remaining');
   expect(wire.state.evocations.find(e=>e.id===evocation.id)!.position).toEqual({q:1,r:0});
   await controls.getByRole('button',{name:'Finish evocation movement early',exact:true}).click();
   await expect(controls).toHaveCount(0);expect(wire.state.evocationActivation).toBeNull();
   expect(wire.state.players[1].wizard.damageCubes).toBe(2);
   expect(wire.actions.map(a=>a.type)).toEqual(['ACTIVATE_EVOCATION','EVOCATION_ATTACK','EVOCATION_STEP','END_EVOCATION_MOVEMENT']);
   expect(wire.errors).toEqual([]);
  });
  test('top-banner evocation can stop moving early then attack, or finish without attacking',async({page})=>{
   const initial=fixture();initial.players[1].wizard.position={q:1,r:0};
   summonEvocation(initial,initial.players[0],'CADAVER',{q:0,r:0});
   const wire=await mount(page,initial);
   await selectControlTab(page,'Evocations');
   await page.locator('#retinue-p1').getByRole('button',{name:/^Activate Cadaver #1/}).click();
   const controls=page.locator('.turn-banner .evocation-controls');
   await page.locator('.hex[data-room-id="room-1,0"]').click();
   await expect(controls).toContainText('1 movement remaining');
   await controls.getByRole('button',{name:'Finish evocation movement early',exact:true}).click();
   await expect(controls).toContainText('0 movement remaining');
   await controls.getByRole('button',{name:/^Cadaver attack/}).click();
   await expect(controls).toHaveCount(0);expect(wire.state.players[1].wizard.damageCubes).toBe(2);
   await selectControlTab(page,'Evocations');
   await page.locator('#retinue-p1').getByRole('button',{name:/^Activate Cadaver #1/}).click();
   await page.locator('.hex[data-room-id="room-0,0"]').click();
   await expect(controls).toContainText('1 movement remaining');
   await controls.getByRole('button',{name:'Finish evocation',exact:true}).click();
   await expect(controls).toHaveCount(0);expect(wire.state.players[1].wizard.damageCubes).toBe(2);
   expect(wire.errors).toEqual([]);
  });
  test('Model healing target choices exclude your own mage but include friendly evocations',async({page})=>{
   const initial=fixture(),e=summonEvocation(initial,initial.players[0],'CADAVER',{q:0,r:0})!;
   initial.players[0].prepared.slot1={used:false,card:{id:'support',name:'Model mending',kind:'SPELL',target:'MODEL',range:1,moments:[{effect:'HEAL',amount:1}]}};
   const wire=await mount(page,initial);
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Model mending'})}).click();
   await page.locator('.hex[data-room-id="room-0,0"]').click();
   const choices=page.getByRole('combobox',{name:'Spell target model'});
   await expect(choices).toBeVisible();
   await expect(choices.locator('option[value="p1"]')).toHaveCount(0);
   await expect(choices.locator('option[value="p2"]')).toHaveCount(1);
   await expect(choices.locator(`option[value="${e.id}"]`)).toHaveCount(1);
   expect(wire.errors).toEqual([]);
  });
  test('a defeat-triggered SELF Protection can heal before any score or respawn',async({page})=>{
   const initial=fixture();initial.currentPlayerId='p2';initial.activation!.playerId='p2';
   initial.players[0].wizard.damageCubes=9;initial.players[0].wizard.damageByPlayer={p2:9};initial.players[0].wizard.damageOrder=Array(9).fill('p2');
   initial.players[1].cubes.available=16;initial.players[1].cubes.onWizard=9;
   initial.players[1].prepared.rapid={used:false,card:{id:'lethal',name:'Lethal',kind:'SPELL',target:'MAGE',range:0,moments:[{effect:'DAMAGE',amount:1}]}};
   initial.readiedSpells=[{id:'rescue',playerId:'p1',card:{id:'rescue-card',name:'Last chance',kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,
    moments:[{effect:'HEAL',amount:2}],trigger:{event:'MAGE_DEFEATED',relation:'ENEMY',scope:'BOUND_MODEL'}}}];initial.activeSpellOrder=['rescue'];
   const wire=await mount(page,initial);await closeControls(page);
   wire.dispatch({type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p1'});
   const dialog=page.getByRole('dialog',{name:'Reveal an active spell?',exact:true});
   await expect(dialog).toBeVisible();expect(wire.state.players[1].victoryPoints).toBe(0);
   await dialog.getByRole('combobox',{name:'Triggered spell target'}).selectOption('p1');
   await dialog.getByRole('button',{name:'Reveal and resolve',exact:true}).click();
   await expect(dialog).toBeHidden();
   expect(wire.state.players[0].wizard.damageCubes).toBe(8);expect(wire.state.players[0].wizard.position).toEqual({q:0,r:0});
   expect(wire.state.players[1]).toMatchObject({victoryPoints:0,kills:0,trophies:[]});expect(wire.errors).toEqual([]);
  });
 });
}