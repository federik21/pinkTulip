import { expect, test, type Page } from '@playwright/test';
import { applyAction, createGame, summonEvocation } from '../packages/game-engine/src';
import { createEnchantmentFixtures } from '../packages/game-engine/test/enchantment-fixtures';
import type { Card, GameAction, GameState } from '../packages/game-engine/src';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { closeControls, selectControlTab, selectSpells } from './layout-ui';

function fixture(name='Torment') {
 const s=createGame(2);s.gameId='activation';s.round=1;s.phase='ACTION';s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 let card:Card|undefined;
 if(['Torment','Cross and Delight','Submission','Master of Pleasure','Liquefy the Pain'].includes(name)) {
  const deck=s.library[0],index=deck.cards.findIndex(c=>c.name===name);card=deck.cards.splice(index,1)[0];
 } else card=createEnchantmentFixtures().find(c=>c.name===name);
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
  for(const target of ['MODEL','ROOM'] as const)test(`infinite-range ${target} spells reach rooms outside line of sight after WebSocket transport`,async({page})=>{
   const initial=fixture('Submission');initial.players[1].wizard.position={q:1,r:1};
   if(target==='ROOM')Object.assign(initial.players[0].prepared.slot1!.card,{name:'Boundless room',target,moments:[{effect:'INSTABILITY',amount:1}]});
   const name=initial.players[0].prepared.slot1!.card.name;
   const wire=await mount(page,initial);
   const card=page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:name})});
  await expect(card.locator('.hint')).toContainText('Range ∞ · ignores line of sight');
   await card.click();
   const offAxis=page.locator('.hex[data-room-id="room-1,1"]');
   await expect(offAxis).toHaveClass(/\breachable\b/);
   await expect(page.locator('.hex.start-room.reachable')).toHaveCount(0);
   if(target==='ROOM')await expect(page.locator('.hex.reachable')).toHaveCount(initial.board.rooms.filter(r=>!r.startingFor).length);
   await offAxis.click();
   const cast=page.getByRole('button',{name:`Cast ${name} here`,exact:true});
   await expect(cast).toBeEnabled();await cast.click();
   await expect.poll(()=>wire.actions.length).toBe(1);
   expect(wire.actions[0]).toEqual({type:'CAST_SPELL',playerId:'p1',slot:'slot1',...(target==='ROOM'?{roomId:'room-1,1'}:{targetPlayerId:'p2'})});
   if(target==='ROOM')expect(wire.state.board.rooms.find(r=>r.id==='room-1,1')!.instability).toBe(1);
   else expect(wire.state.players[1].wizard.damageCubes).toBe(1);
   expect(wire.state.players[0].prepared.slot1?.used).toBe(true);
   expect(wire.errors).toEqual([]);
  });
  test('finite range still excludes off-axis rooms after WebSocket transport',async({page})=>{
   const initial=fixture('Submission');initial.players[1].wizard.position={q:1,r:1};initial.players[0].prepared.slot1!.card.range=4;
   const wire=await mount(page,initial);
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Submission'})}).click();
   const offAxis=page.locator('.hex[data-room-id="room-1,1"]');
   await expect(offAxis).not.toHaveClass(/\breachable\b/);await offAxis.click();
   await expect(page.getByRole('button',{name:'Cast Submission here',exact:true})).toBeDisabled();
   expect(wire.actions).toEqual([]);expect(wire.errors).toEqual([]);
  });
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

  test('Torment can stay hidden, then reveal against the fixed damage dealer without a target selector',async({page})=>{
   const wire=await mount(page,fixture());
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Torment'})}).click();
   await page.getByRole('button',{name:'Confirm activation'}).click();
   await expect.poll(()=>wire.actions.length).toBe(1);
   const activeId=wire.state.readiedSpells![0].id;
   wire.dispatch({type:'END_ACTIVATION',playerId:'p1'});
  wire.dispatch({type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'ATTACK'});
  wire.dispatch({type:'INFLICT_ATTACK',playerId:'p2',targetId:'p1'});
   const dialog=page.getByRole('dialog',{name:'Reveal an active spell?',exact:true});
   await expect(dialog).toBeVisible();
   await dialog.getByRole('button',{name:'Keep all hidden'}).click();
   await expect(dialog).toBeHidden();expect(wire.state.readiedSpells![0].id).toBe(activeId);
   wire.dispatch({type:'SKIP_PHYSICAL_EFFECTS',playerId:'p2'});
  wire.dispatch({type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'ATTACK'});
  wire.dispatch({type:'INFLICT_ATTACK',playerId:'p2',targetId:'p1'});
   await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'Triggered spell target'})).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText(`Target fixed by trigger: ${wire.state.players[1].name}`);
  await expect(dialog.getByRole('button',{name:'Reveal and resolve'})).toBeEnabled();
   await dialog.getByRole('button',{name:'Reveal and resolve'}).click();
   await expect(dialog).toBeHidden();
   expect(wire.state.readiedSpells).toEqual([]);
   expect(wire.state.players[1].wizard.damageCubes).toBe(2);
  expect(wire.state.players[0].wizard.damageCubes).toBe(4);
   expect(wire.state.players[0].discard.some(c=>c.name==='Torment')).toBe(true);
   expect(wire.state.evocations[0]).toMatchObject({name:'Succubus',playerId:'p1'});
   expect(wire.errors).toEqual([]);
  });

  test('Torment fixes the target to an attacking evocation rather than its controlling mage',async({page})=>{
   const initial=fixture(),dealer=summonEvocation(initial,initial.players[1],'CADAVER',{q:0,r:0})!;
   const wire=await mount(page,initial);
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Torment'})}).click();
   await page.getByRole('button',{name:'Confirm activation'}).click();
   await expect.poll(()=>wire.actions.length).toBe(1);
   wire.dispatch({type:'END_ACTIVATION',playerId:'p1'});
   wire.dispatch({type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:dealer.id});
   wire.dispatch({type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'});
   const dialog=page.getByRole('dialog',{name:'Reveal an active spell?',exact:true});
   await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toContainText('Target fixed by trigger: Cadaver');
   await expect(dialog.getByRole('combobox',{name:'Triggered spell target'})).toHaveCount(0);
   await dialog.getByRole('button',{name:'Reveal and resolve'}).click();
   await expect(dialog).toBeHidden();
   expect(wire.actions.at(-1)).toMatchObject({type:'RESPOND_REACTIVE_SPELL',targetId:dealer.id});
   expect(wire.state.evocations.some(e=>e.id===dealer.id)).toBe(false);
   expect(wire.state.players[1].wizard.damageCubes).toBe(0);
   expect(wire.state.evocations[0]).toMatchObject({kind:'SUCCUBUS',playerId:'p1',position:{q:0,r:0}});
   expect(wire.errors).toEqual([]);
  });

  test('Master of Pleasure fixes its target to the quest-solving mage',async({page})=>{
   const initial=fixture('Master of Pleasure');initial.players[1].wizard.position={q:1,r:1};
   initial.players[1].quest={id:'solved',name:'Solved quest',description:'Complete',kind:'ROOM_ACTIVATE',amount:1,progress:1,completed:true,claimed:false,reward:0};
   const wire=await mount(page,initial);
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Master of Pleasure'})}).click();
   await page.getByRole('button',{name:'Confirm activation'}).click();
   await expect.poll(()=>wire.actions.length).toBe(1);
   wire.dispatch({type:'END_ACTIVATION',playerId:'p1'});
   wire.dispatch({type:'USE_QUEST_REWARD',playerId:'p2',questId:'solved'});
   const dialog=page.getByRole('dialog',{name:'Reveal an active spell?',exact:true});
   await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toContainText(`Target fixed by trigger: ${wire.state.players[1].name}`);
   await expect(dialog.getByRole('combobox',{name:'Triggered spell target'})).toHaveCount(0);
   await expect(dialog.getByRole('button',{name:'Reveal and resolve'})).toBeEnabled();
   await dialog.getByRole('button',{name:'Reveal and resolve'}).click();
   await expect(dialog).toBeHidden();
   expect(wire.actions.at(-1)).toMatchObject({type:'RESPOND_REACTIVE_SPELL',targetId:'p2'});
   expect(wire.state.players[1]).toMatchObject({quest:null,questsCompleted:1,wizard:{damageCubes:2}});
   expect(wire.state.evocations[0]).toMatchObject({kind:'SUCCUBUS',playerId:'p1',position:{q:1,r:1}});
   expect(wire.errors).toEqual([]);
  });

  test('Liquefy the Pain fixes the own defeat room before any score or respawn to the cell',async({page})=>{
   const initial=fixture('Liquefy the Pain');initial.players[0].wizard.position={q:1,r:1};initial.players[0].wizard.health=1;
   initial.players[1].prepared.rapid={used:false,card:{id:'lethal',name:'Lethal',kind:'SPELL',spellType:'COMBAT',target:'MAGE',range:Infinity,moments:[{effect:'DAMAGE',amount:1}]}};
   const wire=await mount(page,initial);
   await page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Liquefy the Pain'})}).click();
   await page.getByRole('button',{name:'Confirm activation'}).click();
   await expect.poll(()=>wire.actions.length).toBe(1);
   wire.dispatch({type:'END_ACTIVATION',playerId:'p1'});
   wire.dispatch({type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p1'});
   const dialog=page.getByRole('dialog',{name:'Reveal an active spell?',exact:true});
   await expect(dialog).toBeVisible();
   const room=initial.board.rooms.find(r=>r.id==='room-1,1')!;
   await expect(dialog.getByRole('status')).toContainText(`Target fixed by trigger: ${room.name}`);
   await expect(dialog.getByRole('combobox',{name:'Triggered spell target'})).toHaveCount(0);
   expect(wire.state.players[0].wizard.position).toEqual({q:1,r:1});expect(wire.state.players[1].victoryPoints).toBe(0);
   await dialog.getByRole('button',{name:'Reveal and resolve'}).click();await expect(dialog).toBeHidden();
   expect(wire.actions.at(-1)).toMatchObject({type:'RESPOND_REACTIVE_SPELL',targetId:'room-1,1'});
   expect(wire.state.evocations[0]).toMatchObject({kind:'SUCCUBUS',playerId:'p1',position:{q:1,r:1}});
   expect(wire.state.players[0].wizard.position).not.toEqual({q:1,r:1});expect(wire.state.players[1].victoryPoints).toBe(5);
   expect(wire.state.feedbackEvents!.map(e=>e.kind)).toEqual(['DAMAGE','SPELL_TRIGGERED','MAGE_DEFEATED']);
  const controls=page.locator('.turn-banner .evocation-controls');await expect(controls).toBeVisible();
  await expect(controls).toContainText('2 movement remaining');expect(wire.state.currentPlayerId).toBe('p1');
  expect(wire.state.evocationActivation).toMatchObject({playerId:'p1',evocationId:wire.state.evocations[0].id});
  const activation=structuredClone(wire.state.activation),tokens=wire.state.players.map(p=>p.actionTokens);
  await page.locator('.hex[data-room-id="room-1,0"]').click();await expect(controls).toContainText('1 movement remaining');
  await page.locator('.hex[data-room-id="room-0,0"]').click();await expect(controls).toContainText('0 movement remaining');
  await controls.getByRole('button',{name:/^Succubus attack/}).click();await expect(controls).toHaveCount(0);
  expect(wire.state.players[1].wizard.damageCubes).toBe(1);expect(wire.state.currentPlayerId).toBe('p2');
  expect(wire.state.activation).toEqual(activation);expect(wire.state.evocationActivation).toBeNull();
  expect(wire.state.players.map(p=>p.actionTokens)).toEqual(tokens);
   expect(wire.errors).toEqual([]);
  });

  for(const phase of ['ACTION','EVOCATION'] as const)test(`Liquefy resumes an interrupted ${phase} evocation after the free Succubus finishes`,async({page})=>{
  const initial=fixture('Liquefy the Pain'),card=initial.players[0].prepared.slot1!.card;initial.players[0].prepared.slot1=null;initial.players[0].wizard.health=1;
  initial.readiedSpells!.push({id:'liquefy',playerId:'p1',card});initial.activeSpellOrder!.push('liquefy');
  initial.phase=phase;initial.currentPlayerId='p2';
  if(phase==='EVOCATION')initial.activation=null;else initial.activation!.playerId='p2';
  const dealer=summonEvocation(initial,initial.players[1],'CADAVER',{q:0,r:0})!,wire=await mount(page,initial);
  wire.dispatch({type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:dealer.id});
  wire.dispatch({type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'});
  const dialog=page.getByRole('dialog',{name:'Reveal an active spell?',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Reveal and resolve'}).click();await expect(dialog).toBeHidden();
  const controls=page.locator('.turn-banner .evocation-controls');await expect(controls).toBeVisible();
  const activation=structuredClone(wire.state.activation),tokens=wire.state.players.map(p=>p.actionTokens);
  await controls.getByRole('button',{name:'Finish evocation',exact:true}).click();
  await expect(controls).toHaveCount(0);expect(wire.state.phase).toBe(phase);expect(wire.state.currentPlayerId).toBe('p2');
  expect(wire.state.evocationActivation).toMatchObject({evocationId:dealer.id,playerId:'p2',movesRemaining:2,attackUsed:true});
  expect(wire.state.activation).toEqual(activation);expect(wire.state.players.map(p=>p.actionTokens)).toEqual(tokens);expect(wire.errors).toEqual([]);
  });

    test('Cross and Delight resolves Pain before free player-controlled Succubus activation',async({page})=>{
     const initial=fixture('Cross and Delight'),tokens=initial.players[0].actionTokens;
     const wire=await mount(page,initial);
     const card=page.locator('.prepared .spell').filter({has:page.locator('strong',{hasText:'Cross and Delight'})});
    await expect(card.locator('.spell-effects > span')).toHaveText([/Summon SUCCUBUS/,/Pain 1/,/It activates/]);
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