import { expect, test, type Page } from '@playwright/test';
import { createGame, summonEvocation } from '../packages/game-engine/src';
import type { GameAction, GameState, Quest } from '../packages/game-engine/src';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { selectControlTab } from './layout-ui';

function take(s:GameState,kind:Quest['kind']='ROOM_ACTIVATE',ready=true) {
 const index=s.questDeck.findIndex(q=>q.kind===kind),quest=s.questDeck.splice(index,1)[0];
 Object.assign(quest,{completed:ready,claimed:false,progress:ready?quest.amount:0});return quest;
}
function fixture(kind:Quest['kind']='ROOM_ACTIVATE') {
 const s=createGame(2);s.gameId='quest-rewards';s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:1,exploring:0,spellsCast:1,sequencedSpellUsed:true,discardedExit:false,roomEffectUsed:false};
 s.players.forEach(p=>{p.connected=true;p.wizard.position={q:0,r:0};});
 s.players[0].name='Rose Warden';s.players[1].name='Blue Seer';s.players[0].quest=take(s,kind);
 s.players[0].wizard.damageCubes=3;s.players[0].wizard.blackDamage=3;
 return s;
}
async function mount(page:Page,initial:GameState) {
 let game=structuredClone(initial),publish=()=>{};const history=new ActionHistory(),actions:GameAction[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await page.routeWebSocket('**',route=>{
  publish=()=>route.send(JSON.stringify({type:'STATE',state:publicState(game,'p1',history)}));
  route.onMessage(data=>{
   const message=JSON.parse(String(data));
   if(message.type==='CREATE_ROOM'){route.send(JSON.stringify({type:'WELCOME',playerId:'p1',roomId:game.gameId}));publish();}
   else if(message.action)try{
    game=history.apply(game,message.action,'p1');actions.push(message.action);publish();
    route.send(JSON.stringify({type:'ACTION_APPLIED',requestId:message.requestId}));
   }catch(error){errors.push(String(error));route.send(JSON.stringify({type:'ERROR',requestId:message.requestId,message:String(error)}));}
  });
 });
 await page.goto('/');await page.getByRole('button',{name:'Create room',exact:true}).click();
 await expect(page.locator('.phase-overlay')).toBeVisible();await page.locator('.phase-overlay').click();
 return {actions,errors,get state(){return game;},update(next:GameState){game=structuredClone(next);history.clear();publish();},
  dispatch(action:GameAction){game=history.apply(game,action,action.playerId);publish();}};
}
const quests=(page:Page)=>page.getByRole('region',{name:'Quests',exact:true});
const dock=(page:Page)=>page.getByRole('button',{name:'Open quests',exact:true});

for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:740}])test.describe(`${viewport.width}px quest-ready rewards`,()=>{
 test.use({viewport,reducedMotion:'reduce'});
 test('small dock notification opens a completed unsolved quest and solves its Self reward for free',async({page})=>{
  const initial=fixture(),quest=initial.players[0].quest!,wire=await mount(page,initial);
  await expect(dock(page).locator('.quest-notification')).toHaveText('1');
  await expect(dock(page)).toHaveAccessibleDescription(/1 completed, unsolved quest/);
  await dock(page).click();const panel=quests(page);
  await expect(panel).toContainText('Completed · unsolved');await expect(panel).toContainText('Heal 2');
  const solve=panel.getByRole('button',{name:`Solve ${quest.name} for free`,exact:true});
  await expect(solve).toBeEnabled();await solve.click();
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);await expect(panel).toContainText('1 quest completed');
  expect(wire.actions).toEqual([{type:'USE_QUEST_REWARD',playerId:'p1',questId:quest.id}]);
  expect(wire.state.activation).toEqual(initial.activation);expect(wire.state.players[0].actionTokens).toBe(initial.players[0].actionTokens);
  expect(wire.state.players[0].wizard.damageCubes).toBe(1);expect(wire.state.players[0].victoryPoints).toBe(quest.reward);
  expect(wire.state.questDiscard.filter(q=>q.id===quest.id)).toHaveLength(1);expect(wire.errors).toEqual([]);
  await expect(page.locator('.quick-access')).toBeInViewport();
  await page.screenshot({path:test.info().outputPath('quest-reward-solved.png')});
 });
 test('counts additional ready quests, ignores incomplete/claimed quests, and removes only the solved badge count',async({page})=>{
  const initial=fixture(),additional=take(initial);additional.name='Second Warden';initial.players[0].additionalQuests.push(additional);
  initial.players[1].quest=take(initial); // A peer's hidden quest must never add to the owner's badge.
  const wire=await mount(page,initial);await expect(dock(page).locator('.quest-notification')).toHaveText('2');
  await dock(page).click();await quests(page).getByRole('button',{name:'Solve Second Warden for free',exact:true}).click();
  await expect(dock(page).locator('.quest-notification')).toHaveText('1');
  expect(wire.state.players[0].quest!.id).toBe(initial.players[0].quest!.id);
  const next=structuredClone(wire.state);next.players[0].quest!.completed=false;wire.update(next);
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);await expect(quests(page)).toContainText('Progress:');
  next.players[0].quest!.completed=true;next.players[0].quest!.claimed=true;wire.update(next);
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);expect(wire.errors).toEqual([]);
 });
 test('requires an explicit legal room target for its free reward',async({page})=>{
  const initial=fixture('REBUILD'),quest=initial.players[0].quest!,wire=await mount(page,initial);
  await dock(page).click();const panel=quests(page),solve=panel.getByRole('button',{name:`Solve ${quest.name} for free`,exact:true});
  await expect(solve).toBeDisabled();const target=panel.getByRole('combobox',{name:`Reward target for ${quest.name}`});
  await expect(target.locator('option[value="room-1,1"]')).toHaveCount(0);
  for(const room of initial.board.rooms.filter(r=>r.startingFor))await expect(target.locator(`option[value="${room.id}"]`)).toHaveCount(0);
  await target.selectOption('room-1,0');await expect(solve).toBeEnabled();
  await solve.scrollIntoViewIfNeeded();await expect(solve).toBeInViewport();
  await page.screenshot({path:test.info().outputPath('quest-reward-ready.png')});await solve.click();
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);
  expect(wire.actions[0]).toEqual({type:'USE_QUEST_REWARD',playerId:'p1',questId:quest.id,roomId:'room-1,0'});
  expect(wire.state.board.rooms.find(r=>r.id==='room-1,0')!.instability).toBe(1);expect(wire.state.activation).toEqual(initial.activation);expect(wire.errors).toEqual([]);
 });
 test('offers real enemy model targets without permitting own mage or friendly damage',async({page})=>{
  const initial=fixture('INSTABILITY'),quest=initial.players[0].quest!;
  const own=summonEvocation(initial,initial.players[0],'CADAVER',{q:0,r:0})!;
  const enemy=summonEvocation(initial,initial.players[1],'CADAVER',{q:0,r:0})!;
  const wire=await mount(page,initial);await dock(page).click();const panel=quests(page),target=panel.getByRole('combobox',{name:`Reward target for ${quest.name}`});
  await expect(target.locator('option[value="p1"]')).toHaveCount(0);await expect(target.locator(`option[value="${own.id}"]`)).toHaveCount(0);
  await target.selectOption(enemy.id);await panel.getByRole('button',{name:`Solve ${quest.name} for free`,exact:true}).click();
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);
  expect(wire.actions[0]).toMatchObject({type:'USE_QUEST_REWARD',targetEvocationId:enemy.id});
  expect(wire.state.evocations.find(e=>e.id===enemy.id)!.damageCubes).toBe(1);expect(wire.state.activation).toEqual(initial.activation);expect(wire.errors).toEqual([]);
 });
 test('retains the notification on peer turns but gates rewards during movement, physical effects, evocations, interrupts and disconnection',async({page})=>{
  const initial=fixture();initial.currentPlayerId='p2';initial.activation!.playerId='p2';
  const wire=await mount(page,initial);await dock(page).click();const panel=quests(page),solve=panel.getByRole('button',{name:/^Solve .* for free$/});
  await expect(dock(page).locator('.quest-notification')).toHaveText('1');await expect(solve).toBeDisabled();
  for(const lock of ['moving','physical','evocation','interrupt','disconnected'] as const){
   const state=fixture();
   if(lock==='moving')state.activation!.exploring=1;
   if(lock==='physical')state.activation!.physicalAction={kind:'ATTACK',mainEffectUsed:false,movementStarted:false};
   if(lock==='evocation'){const e=summonEvocation(state,state.players[0],'CADAVER',{q:0,r:0})!;state.evocationActivation={playerId:'p1',evocationId:e.id,movesRemaining:2,returnToAction:true};}
   if(lock==='interrupt')state.pendingDecision={kind:'WAITING',playerId:'p2',key:'waiting'};
   if(lock==='disconnected')state.players[1].connected=false;
   wire.update(state);await selectControlTab(page,'Quests');await expect(solve).toBeDisabled();
  }
  wire.update(fixture());await selectControlTab(page,'Quests');await expect(solve).toBeEnabled();
  expect(wire.actions).toEqual([]);expect(wire.errors).toEqual([]);
 });
 test('updates the notification on actual objective completion but waits for pending physical effects before solving',async({page})=>{
  const initial=fixture(),quest=initial.players[0].quest!;Object.assign(quest,{progress:2,completed:false});
  initial.activation!.physicalAction={kind:'EXPLORE',mainEffectUsed:false,movementStarted:false};
  initial.board.rooms.find(r=>r.id==='room-0,0')!.effect='DRAW_GRIMOIRE';const wire=await mount(page,initial);
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);
  wire.dispatch({type:'ACTIVATE_ROOM',playerId:'p1'});await expect(dock(page).locator('.quest-notification')).toHaveText('1');
  await dock(page).click();const solve=quests(page).getByRole('button',{name:`Solve ${quest.name} for free`,exact:true});await expect(solve).toBeDisabled();
  wire.dispatch({type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'});await expect(solve).toBeEnabled();await solve.click();
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);expect(wire.state.activation!.actionsUsed).toBe(1);expect(wire.errors).toEqual([]);
 });
 test('can solve the reward earned by the second paid action before the turn hands off',async({page})=>{
  const initial=fixture('INSTABILITY'),quest=initial.players[0].quest!;Object.assign(quest,{completed:false,progress:0});
  initial.players[0].prepared.rapid={used:false,card:{id:initial.library[0].cards.shift()!.id,name:'Final action',kind:'SPELL',spellType:'COMBAT',target:'ROOM',range:2,moments:[{effect:'INSTABILITY',amount:2}]}};
  const wire=await mount(page,initial);wire.dispatch({type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  await expect(dock(page).locator('.quest-notification')).toHaveText('1');expect(wire.state.activation!.actionsUsed).toBe(2);
  expect(wire.state.currentPlayerId).toBe('p1');await dock(page).click();const panel=quests(page);
  await panel.getByRole('combobox',{name:`Reward target for ${quest.name}`}).selectOption('p2');
  await panel.getByRole('button',{name:`Solve ${quest.name} for free`,exact:true}).click();
  await expect(dock(page).locator('.quest-notification')).toHaveCount(0);expect(wire.state.currentPlayerId).toBe('p2');
  expect(wire.state.players[0].questsCompleted).toBe(1);expect(wire.state.players[0].actionTokens).toBe(initial.players[0].actionTokens);expect(wire.errors).toEqual([]);
 });
});