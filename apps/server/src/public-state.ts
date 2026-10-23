import type { Card, GameState, PlayerId } from '@brw/game-engine';
import type { ActionHistory } from './action-history';

const hiddenCard = (index: number): Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL', damage:0, instability:0, range:0, target:'MODEL' });

export function publicState(game: GameState, viewer: PlayerId | null, history: ActionHistory): GameState {
 const copy=structuredClone(game);
 // Replace any stale metadata with this viewer's flags/labels, never snapshots.
 copy.history=history.status(game,viewer);
 // Never expose future draws, even to the owning player.
 copy.eventDeck=[]; copy.questDeck=[];
 copy.powerfulDeck=copy.powerfulDeck.map((_,i)=>hiddenCard(i));
 for(const deck of copy.library) deck.cards=deck.cards.map((_,i)=>hiddenCard(i));
 for(const p of copy.players) {
  p.personalDeck=p.personalDeck.map((_,i)=>hiddenCard(i));
  if(p.id===viewer) continue;
  p.hand=p.hand.map((_,i)=>hiddenCard(i)); p.quest=null;p.additionalQuests=[];
  for(const key of ['rapid','slot1','slot2','slot3'] as const) {
   if(p.prepared[key]) p.prepared[key]={card:hiddenCard(0),used:p.prepared[key]!.used};
  }
 }
 return copy;
}