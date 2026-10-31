import { test, expect, type Page } from '@playwright/test';
import { MAGE_DRAFT_POOL } from '../packages/game-engine/src';
import type { GameState } from '../packages/game-engine/src';

function observeState(page:Page) {
 let latest:GameState|undefined;
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  const message=JSON.parse(String(frame.payload));
  if(message.type==='STATE')latest=message.state as GameState;
 }));
 return ()=> {
  expect(latest,'A genuine authoritative state must have arrived').toBeDefined();
  return latest!;
 };
}

async function dismissOverlay(page:Page) {
 const overlay=page.locator('.phase-overlay');
 if(await overlay.isVisible())await overlay.click();
 await expect(overlay).toBeHidden();
}

test('readying starts randomized school and reverse-order mage drafts',async({browser},info)=>{
 test.setTimeout(120_000);
 const pages=await Promise.all([0,1].map(()=>browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'})));
 const states=pages.map(observeState);
 const roomId=`draft-${info.workerIndex}-${info.retry}-${Date.now()}`;
 try {
  for(const [index,page] of pages.entries()) {
   await page.goto('/');
   await page.getByLabel('Mage name').fill(index?'Draft Guest':'Draft Host');
   await page.getByLabel('Room name').fill(roomId);
   await page.getByRole('button',{name:index?'Join room':'Create room',exact:true}).click();
   await expect(page.locator('.lobby-panel')).toBeVisible();
   await expect(page.getByRole('combobox',{name:'Starting magic school'})).toHaveCount(0);
   await page.getByRole('button',{name:'Mark ready',exact:true}).click();
  }
  await expect.poll(()=>states[0]().phase).toBe('SETUP');
  await expect.poll(()=>states[1]().phase).toBe('SETUP');
  for(const page of pages)await dismissOverlay(page);
  let state=states[0]();
  expect(state.setupOrder).toHaveLength(2);
  expect(state.firstPlayerId).toBe(state.setupOrder![0]);
  expect(new Set(state.players.map(player=>player.wizard.startingRoomId)).size).toBe(2);

  for(const playerId of state.setupOrder!) {
   const page=pages[state.players.findIndex(player=>player.id===playerId)];
   const school=state.library.find(deck=>!state.players.some(player=>player.startingSchoolId===deck.id))!;
   await page.getByRole('button',{name:new RegExp(`^${school.name}`)}).click();
   await expect.poll(()=>states[0]().players.find(player=>player.id===playerId)?.startingSchoolId).toBe(school.id);
   state=states[0]();
  }

  for(const playerId of [...state.setupOrder!].reverse()) {
   const page=pages[state.players.findIndex(player=>player.id===playerId)];
   const mage=MAGE_DRAFT_POOL.find(candidate=>!state.players.some(player=>player.mageId===candidate.id))!;
   await page.getByRole('button',{name:new RegExp(`^${mage.name}`)}).click();
   await expect.poll(()=>states[0]().players.find(player=>player.id===playerId)?.mageId).toBe(mage.id);
   state=states[0]();
  }
  await expect.poll(()=>states[0]().phase).toBe('BLACK_ROSE');
  state=states[0]();
  expect(state.round).toBe(1);
  expect(state.players.every(player=>player.personalDeck.length===6&&player.discard.length===1&&player.hand.length===0)).toBe(true);
  expect(new Set(state.players.map(player=>player.startingSchoolId)).size).toBe(2);
  expect(new Set(state.players.map(player=>player.mageId)).size).toBe(2);
  for(const page of pages) {
   await dismissOverlay(page);
   await expect(page.locator('.phase-track .current span')).toHaveText('BR');
  }
 } finally {
  await Promise.all(pages.map(page=>page.close()));
 }
});
