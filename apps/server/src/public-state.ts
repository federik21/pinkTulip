import type { Card, GameState, PlayerId } from '@brw/game-engine';
import type { ActionHistory } from './action-history';

const hiddenCard = (index: number): Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL', moments:[], range:0, target:'MODEL' });

export function publicState(game: GameState, viewer: PlayerId | null, history: ActionHistory): GameState {
 const copy=structuredClone(game);
 // Replace any stale metadata with this viewer's flags/labels, never snapshots.
 copy.history=history.status(game,viewer);
 // Never expose future draws, even to the owning player.
 copy.eventDeck=[]; copy.questDeck=[];
 // The paused action may embed private cards (e.g. a cast spell); only the prompt is public.
 if(copy.pendingDecision) {
  delete copy.pendingDecision.resume;
  // A trigger opportunity must not reveal the identity/condition of a hidden
  // card, even if the owner chooses to ignore it.
  if(copy.pendingDecision.kind==='REACTIVE_SPELL' && copy.pendingDecision.playerId!==viewer)
   copy.pendingDecision={kind:'WAITING',playerId:copy.pendingDecision.playerId,key:'waiting'};
 }
 copy.powerfulDeck=copy.powerfulDeck.map((_,i)=>hiddenCard(i));
 for(const deck of copy.library) deck.cards=deck.cards.map((_,i)=>hiddenCard(i));
 // Mask the whole hidden instance: only its actual active type is public.
 // Never copy card metadata or bindings from the original instance.
 if(copy.readiedSpells) copy.readiedSpells=copy.readiedSpells.map((active,i)=>active.playerId===viewer
  ? active : {id:active.id,playerId:active.playerId,card:{...hiddenCard(i),
   ...(active.card.spellType ? {spellType:active.card.spellType} : {})}});
 for(const p of copy.players) {
  // The school choice and personal discard are public. Future personal cards
  // stay hidden even from their owner; only the owner's hand is private-visible.
  p.personalDeck=p.personalDeck.map((_,i)=>hiddenCard(i));
  if(p.id===viewer) continue;
  // All four library eligibility IDs remain private, even after Study ends.
  delete p.studyCardIds;
  p.hand=p.hand.map((_,i)=>hiddenCard(i)); p.quest=null;p.additionalQuests=[];
  for(const key of ['rapid','slot1','slot2','slot3'] as const) {
   if(p.prepared[key]) p.prepared[key]={card:hiddenCard(0),used:p.prepared[key]!.used};
  }
 }
 return copy;
}