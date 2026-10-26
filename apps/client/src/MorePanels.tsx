import React, { useState } from 'react';
import { ENDGAME_REWARDS, GameAction, GameState, Moment, Player, Quest, getQuestRewardTargets, getRoomRewards } from '@brw/game-engine';

function rewardMoment(moment:Moment):string {
 switch(moment.effect) {
  case 'SUMMON':return `Summon ${moment.kind}`;
  case 'ACTIVATE_EVOCATION':return 'Activate the summoned Succubus';
  default:return `${{DAMAGE:'Damage',HEAL:'Heal',CONVERT:'Convert',BLACK_ROSE_CONVERT:'Pink Tulip convert',INSTABILITY:'Instability',PAIN:'Pain'}[moment.effect]} ${moment.amount}`;
 }
}

function QuestEntry({game,me,quest,disabled,send}:{game:GameState;me:Player;quest:Quest;disabled:boolean;send:(action:GameAction)=>void}) {
 const [targetId,setTargetId]=useState('');
 const ready=!!quest.completed&&!quest.claimed,card=quest.rewardAction;
 const targets=card?getQuestRewardTargets(game,me,card):[];
 const self=card?.target==='SELF',target=targets.find(t=>t.id===(self?me.id:targetId));
 const useReward=()=>{
  const targeting=!card||self?{}:target?.kind==='ROOM'?{roomId:target.id}:target?.kind==='EVOCATION'?{targetEvocationId:target.id}:{targetPlayerId:target?.id};
  send({type:'USE_QUEST_REWARD',playerId:me.id,questId:quest.id,...targeting});
 };
 return <article className={`quest-entry${ready?' quest-ready':''}`} aria-label={quest.name}>
  <div className="quest-heading"><h3><span aria-hidden="true">◇ </span>{quest.name}</h3>{ready&&<span className="quest-ready-label"><span aria-hidden="true">✦ </span>Completed · unsolved</span>}</div>
  <p>{quest.description}</p><span className="badge">+{quest.reward} VP when solved</span>
  <p className="hint">{quest.claimed?'Solved':ready?'Objective complete. Your free reward is ready.':`Progress: ${quest.progress??0}/${quest.amount}`}</p>
  {card&&<div className="quest-reward"><strong>{card.name}</strong><p>{card.moments.map(rewardMoment).join(' → ')}{card.rulesText?` · ${card.rulesText}`:''}</p><span className="hint">Free action · no turn action, physical token or spell slot · Range {card.range===Infinity?'∞ · ignores line of sight':card.range}</span></div>}
  {ready&&<>
   {card&&!self&&<label htmlFor={`quest-target-${quest.id}`}>Reward target<select id={`quest-target-${quest.id}`} aria-label={`Reward target for ${quest.name}`} value={target?.id??''} disabled={disabled} onChange={event=>setTargetId(event.target.value)}><option value="">Choose a {card.target==='ROOM'?'room':'model'}</option>{targets.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>}
   {self&&<p className="hint">Target: your mage.</p>}
   {card&&!targets.length&&<p className="hint">No legal reward target is available. Keep this quest until you can resolve it.</p>}
   <button type="button" className="primary" aria-label={`Solve ${quest.name} for free`} disabled={disabled||!!card&&!target} onClick={useReward}>Solve quest · free action</button>
   {disabled&&<p className="hint">Use during your Action turn, after finishing any movement, physical action, evocation or interrupt.</p>}
  </>}
 </article>;
}

export function QuestsPanel({game,me,disabled,send}:{game:GameState;me:Player;disabled:boolean;send:(action:GameAction)=>void}) {
 const quests=[me.quest,...me.additionalQuests].filter((q):q is Quest=>!!q);
 const available=!disabled&&game.phase==='ACTION'&&game.currentPlayerId===me.id&&game.activation?.playerId===me.id&&!game.evocationActivation&&!game.pendingDecision&&!game.activation.exploring&&!game.activation.physicalAction;
 return <section className="quest-panel" aria-labelledby="quests-heading"><span className="eyebrow">Your personal quests</span><h2 id="quests-heading">Your personal quests</h2><p className="hint">Completing an objective readies its reward. Solve it during your turn as a free action, then gain its VP. It does not use either of your two turn actions.</p>{quests.map(quest=><QuestEntry key={quest.id} game={game} me={me} quest={quest} disabled={!available} send={send}/>)}{!quests.length&&<><h3>◇ Awaiting a new purpose</h3><p>You receive a quest at the end of Pink Tulip if you do not have one, or from an Amber room.</p></>}<p className="hint">{me.questsCompleted} quests solved · {me.kills} mages defeated</p></section>;
}

export function QuickReference({game,me}:{game:GameState;me:Player}) {
 return <section className="reference" aria-labelledby="reference-heading"><span className="eyebrow">Quick reference</span><h2 id="reference-heading">Quick reference</h2>
  <p>Endgame follows Cleanup after <b>round 3</b>, or when a mage or the Pink Tulip reaches <b>30 VP</b>. Final scores determine the winner; the Pink Tulip can win. Equal final scores favor mage seating order, then the Pink Tulip.</p>
  <p><b>2 actions total per turn.</b> Explore, Attack, each spell cast (including Quick and Forgotten), discard-to-move, and paid evocation activation each use one. The turn hands off after the second action finishes, unless a usable quest reward is ready: resolve it for free or choose End turn.</p>
   <p><b>2 physical tokens per round.</b> Explore, Attack, and paid evocation activation also use a token. Spells and discard-to-move do not. Resolve a physical action's primary effect and room activation in either order, once each, or skip what remains.</p>
   <p>Mage attacks deal <b>{me.wizard.attack} damage at distance 0</b>. Explore permits up to <b>{me.wizard.movement} movements</b>. Numbered spells are limited to one per turn, within the shared two-action budget.</p>
  <p>Before Preparation, discard to <b>{me.cardLimit} cards</b>; excess goes to personal discard. At the end of Pink Tulip, discard to <b>{me.questLimit} quests</b>.</p>
  <p><b>Cell exit:</b> if you have one turn action left and are still in your cell, spend it to move out with Explore or discard-to-move. You cannot end your turn or skip that Explore before leaving when an exit is available.</p>
  <p><b>Discard to move:</b> any unused prepared numbered or Quick spell, regardless of numbered order or whether you already cast a numbered spell this turn. Hand cards, already cast or activated spells, and Forgotten spells are ineligible. Discarding uses one turn action and no physical token; it does not count as casting a numbered spell.</p>
  <p><b>Ongoing spells persist through death.</b> They follow their bound mage after respawn and are discarded at Cleanup. A destroyed evocation's binding stays inactive rather than moving to a new summon.</p>
  <p><b>Evocations:</b> maximum 3 per mage. All mages share a supply of <b>3 Succubi and 6 Cadavers</b>; destroyed models return to supply. Activate a <b>Grey room</b> to summon an available Cadaver; tokens activate existing models, never directly summon. Cadavers have no special effect for now. Every model activates once after Action; token activations during Action are extra. Use the <b>top banner</b> to attack, stop movement early, or finish. Movement and the single attack can occur in either order, or either may be skipped. Attack one enemy model in the <b>same room</b>, never a neighboring room.</p>
   <p><b>Room effects:</b> once within Explore or Attack. Starting rooms cannot be activated. Full rooms immediately reject cubes, but only rebuild at Cleanup: score once, return cubes once, unlock the <b>double special</b>. Rebuilt specials are usable once per Action phase and refresh at Cleanup.</p>
    <p><b>Capacity → rank rewards:</b>{[4,5,6,10].map(capacity=><React.Fragment key={capacity}><br/>{capacity} cubes · {getRoomRewards(capacity).join(' / ')} VP · {game.board.rooms.filter(room=>!room.startingFor&&room.instabilityLimit===capacity).length} rooms</React.Fragment>)}</p>
  <p>Damage places your available cubes on enemy models. A lethally wounded mage resolves <b>defeat reactions before scoring or respawning</b>. Healing can prevent defeat, giving no defeat points, trophy or kill credit. If still defeated after reactions, contributors score <b>4 / 2 / 1 VP</b> from the final damage ledger and recover their cubes. Destroyed evocations return their cubes without VP.</p>
  <p><b>Dense ranks:</b> positive contributions share ranks when tied; the next different total takes the next rank (1, 1, 2). A tied positive reward is reduced by <b>1 VP, minimum 1</b>. Zero prizes and ranks beyond the reward table stay zero. Pink Tulip cubes and black damage compete for room and defeat rewards.</p>
  <p><b>Endgame:</b> positive kills and completed-quest majorities each award <b>{ENDGAME_REWARDS.join(' / ')} VP</b>, with the same dense-rank tie rule. Pink Tulip competes for kills, not quests. The first-player token grants <b>+1 VP</b>. Bonuses are scored once.</p>
  <p><b>One-color bonus:</b> gain <b>+1 VP</b> if all cubes in a room are yours when it is completed, or all damage cubes on a mage are yours when they are defeated. Pink Tulip cubes, black damage and unattributed wounds prevent a mage’s one-color bonus.</p>
  <p>Normal school discards return to their school; forced hand-limit discards are the exception. Whenever a draw pile runs out, shuffle its own discard into a new draw pile and continue drawing. Held cards and permanently removed Forgotten spells never recycle.</p>
  <p><b>Quests:</b> completing an objective keeps the quest unsolved and lights the small notification on the Quests dock icon. During your Action turn, open Quests and resolve its small reward as a <b>free action</b>: no turn action, physical token, spell slot or numbered-spell quota. Finish pending effects first. Gain the quest VP only when solved; solved quests enter the quest discard and reset when drawn again.</p>
  <p>At the end of Pink Tulip, receive a quest if you have no unsolved quests. Solved quests never prevent a replacement; completed-but-unsolved quests remain available for their free reward.</p>
  <p><b>Transmutation:</b> 12 spells, 3 copies each. <b>Heal</b> removes wounds and returns their cubes to their owners. A room heal affects every mage and evocation there. <b>Convert</b> swaps other-colored damage cubes on an enemy model, or instability cubes in a room, for your available cubes without changing the total. Damage conversion is ignored on your own mage and evocations, including triggered effects; other spell instructions still resolve. Rebuilt room history cannot be converted.</p>
  <p><b>Spell targets:</b> Self = only your mage; Mage = another mage; Evocation = one evocation; Model = another mage or an evocation; Room = the room and all models there. Only Self spells can directly select your mage, including healing, Protection and ongoing spells. Support may select friendly evocations. Your mage and evocations never take your damage or ordinary damage conversion, including triggered effects. <b>Peak of Agony</b> targets a room within <b>range 2</b>: deal <b>2 damage</b> to enemy models there; then convert your mage’s <b>last 2 damage cubes received from other mages</b> into Pink Tulip black, returning the colored cubes without changing wounds; then resolve <b>Pain 2</b>. Its explicitly caster-scoped neutral conversion is separate from normal friendly conversion immunity. Neutral Pain and Pink Tulip events remain neutral damage.</p>
  <p><b>Pain Mark:</b> reacts only when the bound mage deals damage with their own physical attack or spell. Activating or attacking with an evocation, room-effect damage and quest-reward damage never count, even within a physical-action menu.</p>
  <p><b>Spell range:</b> Finite range follows a straight hex line. Infinite range ignores distance and line of sight, allowing any non-starting room or otherwise legal model there. Printed target categories and starting-room protection still apply.</p>
  <p><b>Dummy targets:</b> Only ordinary cast spells can target dummies, never Trap/Protection activation, mage physical attacks or evocation attacks. Mage, Evocation and Model spells may target a dummy in a non-starting room within spell range; infinite range needs no line of sight. Only printed room instability resolves; no model effects or ongoing binding.</p>
    <p><b>Study:</b> draw 2 personal cards, then choose 4 blind library draws across any schools in any combination. Discard exactly 2 of those 4 new library cards; older hand cards and the 2 personal draws are ineligible. In Preparation, choose a card, then tap a numbered slot or the optional Quick slot. Place at least 2 spells to enable Done. Numbered spells cast progressively; Quick is independent of their order.</p>
    <p><b>Spell glossary:</b> unused cards are <b>Ready</b>. Traps and Protections are <b>activated, not cast</b>: confirm activation with no room or target, leave the card face down, and mark it <b>Active</b>. Only its type is public. When its condition occurs, the owner may reveal at the end of the current moment or keep it hidden for later. The spell may fix its target from the trigger; otherwise choose a legal target. The owner chooses their simultaneous spell order; different owners follow play order. Nested reactions finish before the interrupted effect resumes. Defeat cancels remaining physical effects. At Cleanup, unrevealed cards return to Hand unless their owner selects Memories; revealed cards stay in personal discard (Memories).</p>
    <p><b>Agony traps:</b> Torment targets the enemy mage or evocation that just dealt damage. Master of Pleasure targets the other mage that solved a quest. Liquefy the Pain triggers on your own mage's defeat and summons in their defeat room, before scoring or returning to their cell, then gives you a free Succubus activation using the top banner—even during another mage’s turn. Finish it to resume the interrupted turn or evocation. These targets cannot be changed; revealing is still optional.</p>
   <p><b>Forgotten spells:</b> obtain these in the central room and save them for a later Preparation, never cast directly from hand. Prepared forgotten spells cost one turn action and are permanently removed on casting; unused preparations return to hand next round. Held forgotten spells do not keep Action alive.</p>
   <p><b>Cube supply:</b> with zero available cubes you cannot place room instability, but attacks and spells can still wound. Damage bars count received damage, including neutral black damage and separately labeled unattributed wounds, not remaining health.</p>
   <p className="hint">Grimoire {me.personalDeck.length} · Hand {me.hand.length}/{me.cardLimit} · Personal discard {me.discard.length}</p>
    </section>;
}