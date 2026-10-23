# Black Rose Wars — online prototype

Two-to-four-mage, unofficial TypeScript prototype with an authoritative WebSocket server, a shared rules engine, and a React client. Card names and effects are original placeholders, not a reproduction of the published card set.

## Start locally

Install dependencies once:

```bash
npm install
```

In **terminal 1**, leave the server running:

```bash
npm run dev -w @brw/server
```

In a **separate terminal 2**, leave the client running:

```bash
npm run dev -w @brw/client -- --host 0.0.0.0
```

Open **http://localhost:5173** in two to four tabs, browser windows, or devices. The WebSocket address `ws://localhost:8080` is not a website to open in a tab.

1. The first mage creates a room and invites up to three other mages to join it.
2. Wait for everyone you intend to play with to join, then each mage clicks **Mark ready**.
3. The battle **starts automatically as soon as all joined mages are ready**, with a minimum of two. A lone ready creator waits for at least one other person. Unused seats do not block a two- or three-mage battle. Invite everyone before the final ready; new seats cannot join a running battle.

Each joined mage receives a separate starting room, grimoire, cube pool, color, and turn. A fifth participant is rejected. Leaving a lobby removes that participant and transfers creator duties if necessary; leaving a running battle preserves the seat and pauses the game until reconnection. Rejoining a disconnected running seat is supported, but is not authenticated.

For a second device on the same Wi-Fi, open the Vite Network URL (for example `http://192.168.1.5:5173`). The client connects to port 8080 on that same host. Allow the ports through the firewall. `VITE_WS_URL` can override the WebSocket endpoint; the server port can be changed with `PORT`.

If startup reports `EADDRINUSE`, another server already owns port 8080. Stop the earlier server with Ctrl+C before restarting; do not run the client command inside the server's running watch process.

## Round flow

**Black Rose → Study → Preparation → Action → Evocation → Cleanup.** The engine, WebSocket API and React client support summoning, model targeting and evocation control.

Every phase has a brief, dismissible announcement. Black Rose and Cleanup remain visible until the creator continues, so players can read the event and scores. Study and Preparation finish automatically once all participating mages submit.

### Black Rose

- Each mage starts with **2 physical tokens**, refreshed to exactly **2** at the beginning of every round; unused tokens do not accumulate.
- Draw and resolve one of 12 event cards: neutral instability in random unfinished rooms, or 1–2 black damage to every mage.
- Black Rose is a neutral **scoring competitor**, with publicly tracked VP and kills. Its black damage competes with player-owned cubes for mage-defeat majorities; its room cubes compete for room rewards. A Black Rose finishing blow credits its kill count, never a player's kill quest. Player-owned damage cubes return on defeat, and the mage respawns in their own starting room.
- When the creator continues, each mage without a quest receives exactly one. Existing quests are retained. This resolution happens once, tracked by `blackRoseResolved`.
- Each mage has **quest limit 2**. If anyone holds more, Black Rose stays visible until each affected owner selects **exactly their overflow** and submits `DISCARD_QUESTS { questIds }`. Selected quests go to the shared quest discard without completion rewards; retained quests stay private.
- While quest selections are pending, the creator cannot continue again and **nobody can begin Study or draw their 2 grimoire cards**. Once all quests fit, Study starts automatically and each mage draws up to 2 personal grimoire cards. With no overflow, the creator's continue proceeds directly to Study; no empty selection is needed.

### Study

- The shared library contains just **Cantrip**, a single **36-spell school** with unique physical card IDs, rather than six identical copies.
- Draw 4 spells from Cantrip and select exactly 2 cards from your hand to discard.
- **Cantrip spells normally return to the shared Cantrip discard pile**, whether discarded during Study, cast, left unused in Preparation, or spent to exit a starting room. Personal spells normally return to the mage's grimoire discard. The mandatory Preparation hand-limit discard below is an explicit exception.
- Powerful spells cannot be discarded during Study or spent on a starting-room exit. Only the mandatory hand-limit selection can put one into personal discard; otherwise keep it until cast.
- Each depleted deck reshuffles only its own discard. Cantrip requires at least 4 available spells across its draw and discard piles; held and prepared cards are never recycled. Study draws up to 2 personal cards if the remaining grimoire cards are already held.

### Preparation

- Each mage has **card limit 7**, checked against their **entire hand before removing prepared spells**. If over, select **exactly the excess number of different held cards** and submit `DISCARD_HAND_LIMIT { cardIds }`, then prepare. Preparation is blocked until the limit is met.
- This mandatory selection sends **every selected card to the owner's PERSONAL discard**, even a school spell or powerful spell. Its ID, `schoolId` and `powerful` flag are preserved; it is not removed from the game. Later retrieval/draw and casting use its normal rules. This exception does not change Study/cast/discard-exit routing.
- Hand-limit selection is available only in Preparation, before that mage has prepared. No overflow means no selection: an empty limit-discard command is rejected, not required to proceed.
- Select three spells in progressive order **1 → 2 → 3**, and one **flexible** spell.
- Numbered spells cannot skip an unused earlier slot, and **only one numbered spell may be cast per turn**. The flexible spell is independent of that ordering, but every cast uses one of the shared two turn actions.
- Unselected cards remain in hand. Uncast ordinary prepared cards go to their origin's discard when the next round starts. **Unused powerful preparations return to hand**, never a discard pile.

### Action

- Each mage's authoritative wizard stats are **maximum HP 10** (`wizard.health`), **attack 2** (`wizard.attack`), and **movement 2** (`wizard.movement`). Wounds are tracked separately in `damageCubes`; health is not remaining HP.
- Each mage has **2 physical action tokens for the entire round**. Beginning **Explore** or **Attack**, and an additional evocation activation, each consume **1 physical token and 1 turn action**. Spells and discard-to-move use a turn action but **no physical token**. Summoning is a **free Grey room effect**, never a separate paid action.
- Alternate turns with **up to 2 actions total**, tracked by `activation.actionsUsed`: Explore, Attack, every spell cast (numbered, flexible, and powerful), discard-to-move, and paid evocation activation all count. **Two Explores leave no spell cast available on that turn.** Numbered plus flexible, spell plus Explore, and discard-to-move plus Explore each use both actions. Choose **End turn** after one action to keep remaining resources. After the second action fully resolves, the turn automatically hands off; unused cards and physical tokens remain for later turns. The turn also ends early if no legal options remain. With no other eligible mage, the same mage can begin a new turn with a refreshed two-action budget.
- Top-level **Explore** and **Attack** open their respective physical-action menus using `BEGIN_PHYSICAL_ACTION { kind }`. The token/action is consumed **only at begin**, not for subsequent primary or room effects.
- Explore's **Perform 2 movements** (`PERFORM_MOVEMENT`; the displayed count follows `wizard.movement`) enables adjacent steps using `EXPLORE_STEP`. **Finish movement early** (`END_EXPLORE`) stops movement early. Completing movement leaves the room effect available if unused; it does not silently close the whole menu.
- Attack's **Inflict attack** (`INFLICT_ATTACK { targetId }`) deals `wizard.attack` damage, normally **2**, to an enemy mage or evocation **in exactly the same hex (distance 0)**. Adjacent targets are not legal mage attacks. Evocation attacks separately require both models to occupy the **same room**.
- Both menus offer **Activate the room** (`ACTIVATE_ROOM`, optionally `roomTargetId` for Emerald) and **Skip remaining effects** (`SKIP_PHYSICAL_EFFECTS`). Resolve primary then room, or room then primary, each at most once. Using both automatically closes the menu. Skip is legal at any point, including during movement, preserves effects already resolved, and never refunds the token.
- While a physical menu is pending, other mage commands—including spells, paid model activation, another physical action, discard exit, End turn and Pass—are locked. A zero-token mage still finishes the pending effects or skips. Room activation waits until movement has ended.
- **Activate a Grey room** through `ACTIVATE_ROOM` to summon **1 Cadaver (Undead) at the mage's position when the effect resolves**. Merely entering or occupying Grey does not summon. A reconstructed Grey room offers **2 Cadavers**, capped by the mage's **3 living owned evocations**: with two already owned, summon only one; at three, summon none. Destroyed models free their owned slots. There is **no extra token or physical-action cost** beyond beginning Explore/Attack.
- Grey replaces the former Ivory color. Its room effect is `SUMMON_CADAVER`, replacing `DRAW_LIBRARY`; it never draws from or recycles Cantrip. **Direct paid summoning has been removed**: `SUMMON_EVOCATION` is not a valid game action, and even a malicious legacy WebSocket payload is rejected with **Unknown game action**, without changing state.
- Every Cadaver has **movement 2, base attack 2, health 2**, and **Wounded Fury**: attack strength is **2 + its current damageCubes**. Evocations persist across rounds until destroyed.
- **Activate evocation** (`ACTIVATE_EVOCATION`) during Action is an additional paid activation of one owned model: 1 token and 1 physical action. It locks all mage commands until `END_EVOCATION` or a successful `EVOCATION_ATTACK` finishes it. A model may receive further paid activations if resources allow; these do **not** spend its later free Evocation-phase activation.
- **Cast spell** costs **1 turn action and no physical token**, including flexible, dummy, and powerful casts. Cast at most one numbered spell per turn; the flexible spell can be the other action if unused. Select a prepared spell, a highlighted target room, then confirm. Ordinary spells deal up to **4 damage** and/or **2 instability**, with ranges 0–4 and model or room targets. **Powerful spells cannot be cast from hand**: save them for a later Preparation and assign a numbered or flexible slot. They obey that slot's ordering and quota. Legacy `CAST_POWERFUL_SPELL` commands are rejected.
- **Spell range follows a straight, contiguous hex line without turning**, not a hex radius. The target must share the caster's `q`, `r`, or `q + r` coordinate, at most the printed number of hex steps away; range 0 permits the caster's hex. This applies to room, mage, evocation, dummy, and powerful-spell targets. From `(0,0)`, range 2 reaches the center and the first two hexes along each of the six directions, but never `(1,-2)`, `(-1,-1)`, `(2,-1)`, `(-2,1)`, `(1,1)`, or `(-1,2)`, even at a higher range. Movement may still turn between adjacent steps; mage and evocation physical attack ranges are unchanged.
- Single-model spells select an enemy mage or evocation. They also offer an explicit **dummy target**: choose any non-starting room within range and resolve non-damage effects there. No model takes damage and no damage cubes are placed, even if the room is occupied.
- **No friendly fire:** model attacks/spells cannot target the controlling mage or any friendly evocation. Room spells and Crimson room damage affect **all enemy mages and evocations** there, never the caster or friendly summons. Instability applies to the target's original room even if damage defeats and respawns them.
- In a **starting room**, a mage cannot cast, begin Attack, activate a room effect, or buy an evocation activation: **Explore** out, or **discard a held/unused prepared card** to move exactly one adjacent space for **1 turn action and no physical token**. The discard exit can be used once per turn. Mages cannot voluntarily enter or reenter any starting room; defeat still respawns them there. Evocations can never enter any starting room. Regular rooms remain revisitable. Starting rooms and models inside them cannot be targeted by spells or physical attacks; Black event damage ignores mage starting-room protection. A mage in a starting room may still control their models during the free Evocation phase.
- Player damage places **1 attacker-owned cube per damage actually inflicted**, limited by the attacker's available supply. Damage still applies if fewer cubes are available; overkill cannot add cubes beyond the victim's remaining health. The supply is shared with room instability.
- All evocation damage is sourced to its **controlling mage**. That owner's `cubes.onWizard` tracks cubes on enemy mages, `cubes.onEvocations` separately tracks cubes on enemy summons, and `cubes.onBoard` tracks committed room instability. These and `cubes.available` share the same 25-cube supply. Victims record ownership in `damageByPlayer`.
- Destroying an evocation returns **all cubes on it to their owners** and removes the model, with **no VP, mage-kill, or kill-quest reward**. An evocation defeating a mage still credits its controller normally, including contribution scoring and final-hitter kill/quest credit below.
- When a mage is defeated, rank positive damage contributions, **including Black Rose's black damage**: base rewards are **4 / 2 / 1 VP** for the first three distinct contribution ranks; later ranks receive zero. Use **dense ranks**: equal counts share a rank, and the next distinct count receives the next rank (1, 1, 2 rather than 1, 1, 3). Each tied positive award is reduced by **exactly 1 VP**, with a minimum of **1 VP**, regardless of tie size. Explicit zero prizes stay zero. For example, contributions of 4 / 4 / 1 yield **3 / 3 / 2 VP**. Zero contributions do not compete.
- Award **+1 VP** to the sole contributor if **all damage on the defeated mage is accounted for by that mage's colored cubes**, with no neutral black damage. Damage inflicted after running out of physical cubes does not qualify as colored cubes. This bonus is separate from rank rewards and kill quests.
- Return all damage cubes on the defeated mage to their respective owners, clear that mage's damage, and respawn them in their starting room. Cubes those owners placed on other mages or in rooms stay committed.
- The final hitter still receives kill and kill-quest credit, but there is **no additional flat kill VP bonus**. Contribution scoring also applies when a neutral event delivers the finishing damage.
- **End turn** keeps unused resources and is available after a completed/skipped physical action, a spell, or a discard exit, but never during a pending physical menu or active evocation. Spending both turn actions hands off automatically. The redundant **Pass for this round button has been removed**. The legacy `PASS_ROUND` API is legal only with **0 physical tokens and no unused prepared spells**; held, unprepared powers do not block passing or automatic exhaustion.
- Exhausted mages with no legal spells, physical actions, or discard exit are automatically skipped; a permanent pass is not needed to drain the round. When everyone has passed or cannot act, enter **Evocation**; if no models exist, it immediately proceeds to Cleanup.

#### Physical-menu examples

1. **Explore → Perform 2 movements → adjacent steps → Finish movement early if needed → Activate the room.** This uses the destination's room effect. Finishing the final movement step does not automatically activate it.
2. **Explore → Activate the room → Perform 2 movements → steps or Finish movement early.** This uses the origin's room effect; a Grey Cadaver stays at the spawn hex instead of following the mage.
3. **Attack → Inflict 2 damage to a model at distance 0 → choose an enemy → Activate the room**, or activate the room before inflicting damage. The attack still needs a legal same-hex enemy when it resolves. If a Crimson effect defeats that target first, skip the remaining attack rather than hitting its respawn.
4. **Skip remaining effects** closes either menu whenever desired, even before using its primary effect. Paid **Activate evocation** is separate: it controls an existing model and never summons or triggers a room effect.

Room activation is unavailable in starting rooms and for a reconstructed special already spent this Action phase. Emerald needs a valid target within distance 1 of the activated room. Legacy engine `EXPLORE`/`PUNCH` commands remain for compatibility, but the client/network smoke use the explicit menus above, not bundled start/end timing flags. Browser verification of the rewritten client is separate from the network smoke.

### Undo and redo

- **Undo action** and **Redo action** restore recent non-drawing commands, including movement, action/token costs, spell use, contributions, damage, scores, completed quests and summoned model identities. Redo restores the exact result, rather than rerunning randomness.
- History is authoritative and private to the server, bounded to 32 command snapshots. Clients receive only their own availability flags and labels, never snapshots or hidden cards.
- Draws, quest draws, random discard retrievals, phase changes and connection/roster changes clear history. Even activating an empty draw source is a barrier. A later movement can be undone without exposing or replaying an earlier draw.
- A same-phase turn handoff can be undone by the previous actor until another player successfully acts. Failed or unauthorized commands do not alter history. New actions discard the redo branch.

### Evocation

- At phase entry, reset **every surviving model's `activated` flag**, independently of any paid Action activations. Each model then receives **one free activation**, costing no mage action or token.
- Alternate **owners**, starting with the first player who owns an unused model. The active owner chooses which unused owned model to activate. Skip owners without unused models; an owner may therefore activate consecutive models after everyone else is exhausted.
- Only **one model may be active at a time**. `EVOCATION_STEP` moves it one adjacent space at a time, up to its movement allowance (Cadaver: 2); no starting-room entry is allowed. Movement is optional.
- With or without moving first, it may attack **once**, targeting an enemy mage ID (player ID or wizard ID) or evocation ID in the **same room it occupies**. Both positions must belong to one common room's `tiles`: distinct hexes within a multi-hex room are legal, but a different room is illegal even when adjacent. This applies to both paid Action activations and free Evocation activations; movement still uses adjacent steps. A successful `EVOCATION_ATTACK` **immediately ends** that activation, so it cannot attack again or move afterward. Friendly models and models in starting rooms are protected.
- `END_EVOCATION` finishes early **without attacking**, even with movement remaining. In Action it resumes the mage's turn (or automatically advances if exhausted); in Evocation it selects the next eligible owner.
- Used models cannot activate again in this phase. When no unused surviving models remain, resolve **Cleanup**. With no evocations, this phase immediately proceeds to Cleanup.
- Each living model has a stable owner-local number **1–3**. Destroying one frees its number without renumbering survivors. Its board circle and detail card share its mage's tint. Use **Show evocations** on an individual mage card to reveal that owner's retinue; opponents' details are read-only. Active own-model controls remain available even with its retinue hidden.

### Rooms and Cleanup

The 18 regular rooms have **6 colors, exactly 3 rooms per color**. The central chamber and four protected starting rooms are separate. Seats p1–p4 use the internal axial positions (3,-2), (-3,2), (-1,-2), and (1,2); unused starts remain protected. Every room has a **unique randomly assigned name**, except the fixed Black Rose Chamber. Names are shared with all players and stay fixed for that battle. The board, target choices, logs, and evocation locations use room names rather than coordinates; internal room IDs and axial coordinates remain unchanged for targeting and range calculations.

Room interiors show **compact, centered instability/capacity badges** with progress segments tinted by contributor, including light-gray Black Rose cubes. Rebuilt rooms show only **READY / USED** for their upgraded action, not completion progress or returned cube counts. Mage and evocation meters show **damage received**, segmented by contributor, rather than remaining health. Wounds inflicted without available physical cubes are separately labeled as unattributed. The physical-action menu sits above the mage list during the owner's Action turn. The board scrolls on small screens rather than shrinking its contents.

Choose **at most one free room effect within each Explore or Attack menu**, before or after its primary effect; it never costs another action/token. `ACTIVATE_ROOM` uses the mage's position when it resolves. Starting rooms have no effect, and discard exits/spells do not trigger room effects.

| Color | Prototype free room effect |
| --- | --- |
| Crimson | Deal 1 damage to every enemy mage and evocation in the activated room, never friendly models; damage cubes and normal mage-defeat rewards apply |
| Azure | Retrieve 1 uniformly random card from your personal discard into your hand; school discards are separate |
| Emerald | Place 1 instability in a chosen non-starting room within distance 1, including the activated room |
| Amber | Draw a new quest in addition to existing quests; every matching quest can complete and award its reward |
| Violet | Draw 1 card from your personal grimoire, reshuffling its discard if needed |
| Grey | Summon 1 Cadaver at the activating mage's position, up to 3 living evocations owned by that mage |

Choose Emerald's target with the room-effect target selector. Its range is measured from the room where the effect activates, so activating after movement uses the destination, not the origin. Crimson can finish a mage before Attack's primary effect; a respawn in a starting room cannot be attacked. Draw effects do nothing if their source has no available cards. Amber recycles the shared quest discard when its deck runs out, never another mage's held quests. Extra quests may exceed the limit during Action; mandatory selection waits until the end of the next Black Rose.

**Reconstructed rooms double all seven effects:** Crimson deals 2 damage per enemy model, Azure retrieves up to 2 random personal-discard spells, Emerald places 2 instability within range 1, Amber draws up to 2 quests, Violet draws up to 2 grimoire spells, Grey summons up to 2 Cadavers without exceeding 3 living owned evocations, and the central chamber grants up to 2 powerful spells. Available supply and instability/cube caps still apply. This reconstructed special may be used **once per room globally across all players during an Action phase**, tracked by `specialUsed`; it is not once per mage or turn. Activating reconstructed Grey at the owned-model cap summons nothing but still spends that room's special. **Cleanup resets `specialUsed`** for the next Action phase. Ordinary unreconstructed room effects remain subject to the one-effect-per-physical-menu rule.

The **central chamber grants one powerful Black Rose spell** from a separate, finite 12-card supply (four of each original prototype spell):

| Powerful spell | Damage | Instability | Range | Target |
| --- | ---: | ---: | ---: | --- |
| Rosefall | 6 | 3 | 3 | Room |
| Sovereign Wrath | 8 | 1 | 4 | Single model |
| Worldbreaker | 4 | 4 | 2 | Room |

Powerful spells **stay in hand for a later Preparation and cannot be cast directly from hand**. Prepare them in an ordered or flexible slot, then cast under normal slot rules for one turn action and no physical token. Held cards persist across Cleanup and future rounds; unused powerful prepared cards return to hand at the next Black Rose. Held powers alone do not prolong Action. **After casting, the physical card is permanently removed from the game**, never discarded or reshuffled. A powerful card selected for mandatory hand-limit overflow instead goes to personal discard and may be retrieved/redrawn before a later preparation. The separate powerful supply does not refill when empty. Standard range, starting-room protection, cube limits and dummy targeting still apply. Held powerful identities remain hidden from opponents until publicly used or discarded. These are original placeholder effects, not official card or room text.

| Room | Count | Instability capacity | First place | Second place | Third place |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary colored rooms | 12 | 5 | 4 VP | 2 VP | 1 VP |
| Violet rooms | 3 | 4 | 2 VP | 1 VP | 0 VP |
| Grey rooms | 3 | 6 | 5 VP | 3 VP | 1 VP |
| Central chamber | 1 | 10 | 6 VP | 3 VP | 1 VP |

- Final cubes are capped at capacity and the player's physical supply (25 cubes initially).
- Full rooms immediately **lock against additional cubes**, including event cubes, but **do not rebuild until Cleanup**. Their ordinary room effect remains available under the normal physical-menu rules; the doubled special is not available yet.
- Completing a room **entirely in your own cube color** grants **+1 VP immediately**, once only. Any neutral or other mage's cubes prevent this bonus. This is additional to quests and the later Cleanup award.
- At Cleanup, rebuild full rooms, unlock their doubled specials, and award their printed three-place prizes using the **same dense-rank and tied-award rules as mage defeats**. **Black Rose competes** using its room cubes. Ties deduct exactly 1 VP from positive prizes, never below 1; explicit zero prizes and ranks beyond the table stay zero. A capacity-5 room with contributions 2 / 2 / 1 awards **3 / 3 / 2 VP**; the center with 4 / 4 / 2 awards **5 / 5 / 3 VP**.
- Cubes return to the physical supply, but contribution records and rebuilt status remain. **A room scores only once.**
- Quests reward **2–3 VP** for a mage kill, placing the last cube in a room, or placing 2 cubes in one room with one spell. Completion is immediate and logged with the quest name and VP; a replacement arrives at the next Black Rose.
- Check endgame **after Cleanup rebuilding, room scoring and cube return**: finish after **round 3**, or when a mage or Black Rose reaches **30 VP**. Before selecting the winner, award positive kill and completed-quest majorities **4 / 2 / 1 VP**, with the same dense-rank tie rule. Black Rose competes for kills, not quests; zero counts earn nothing. Give the first-player token holder **+1 VP**. Final bonuses apply once. Highest final total wins, including Black Rose; ties favor mage seating order, with Black Rose last.
- Otherwise the creator begins the next round, drawing another event and refreshing **2 tokens per mage**.

## Verification

```bash
npm test                 # engine behavior
npm run test:history     # server history, draw barriers, privacy and real-socket lifecycle
npm run test:lobby       # real 2/3/4-mage automatic starts, readiness, privacy, reconnects
npm run test:network     # three real two-client rounds: menus, limits, spells, evocations, privacy
npm run typecheck        # engine + server + client
npm run build            # production client
npx playwright install chromium  # once, for browser tests
npm run test:browser     # separate visible-client validation; rerun after client/menu changes
```

The standalone network scripts are outside the workspace typecheck projects. Check them separately with:

```bash
npx --no-install tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --esModuleInterop --skipLibCheck scripts/multiplayer-smoke.ts scripts/lobby-smoke.ts
```

Browser tests run their own servers on ports 18080 and 15173, without disturbing local games.

The browser suite combines real multiplayer scenarios using visible controls with deterministic WebSocket-fixture presentation regressions. The four-browser scenario verifies the lone-creator wait, all-joined readiness, automatic start, named rooms, compact cube badges, all four mage identities and the first full turn rotation. Other real scenarios verify the shared two-action limit, automatic handoff after two Explores with spells uncast and disabled, one-action flexible/numbered/discard costs without token loss, straight-line spell highlights, complete-round Grey summoning and Evocation combat, both physical-effect orders, pending-menu locks, partial movement and skips, same-hex attack targeting, and all five displayed mage attributes. A three-round retention scenario reaches the real hand-limit selector and checks a school card entering personal discard before slot assignment, then ends at round-three Cleanup. Amber quest overflow is resolved through owner selections whenever random quest completions leave excess quests. Deterministic presentation tests cover segmented room/damage meters, rebuilt readiness, owner-specific numbered retinues, saved powers, Black Rose standings/wins, history controls and desktop/mobile order/geometry. Entry regressions detect uncaught React hook errors during create/join/start. Quest overflow remains conditional in live browser runs; deterministic engine tests cover both owners' selections and delayed Study every run.

The separate lobby smoke covers automatic starts with two, three and four joined mages, fifth-player rejection, unready-player gating, lobby departure and creator transfer, in-progress seat locking, multi-disconnect pausing, running reconnections preserving real cards/cubes/positions, and hidden cards/quests/future draws across all four viewers.

The network smoke starts an isolated ephemeral-port server and always terminates its clients/server. It uses only public WebSocket actions: **no server-state mutation, fixtures, or test-only commands**. Acknowledgements are correlated by request ID; both viewers synchronize to the same public epoch before inspecting private data. Privacy checks run after every command, including opponent hand/preparation/quest masking and hidden future draws.

Its three real rounds spend each mage's actual two-token budget through **12 `BEGIN_PHYSICAL_ACTION` menus**, never successful legacy `EXPLORE`/`PUNCH` commands or bundled timing flags. Coverage includes:

- Public wizard stats **10 maximum HP / 2 attack / 2 movement**, limits **7 cards / 2 quests**, single begin-time costs, independent primary/room effects, full and early-ended movement, both effect orders, automatic menu completion, and skipping after a room effect or midway through movement without refunding costs or undoing completed steps.
- Pending-menu locks on spells, another physical action, turn ending/passing, discard exit and owned-model activation; peer turn/seat ownership, wrong-menu rejection, repeated-effect rejection, and zero-token pending resolution.
- **23 actual prepared casts**, each using a turn action without a physical token: one of the 24 preparations is deliberately spent on a one-action, no-token discard exit. Mixed-action costs, two-action automatic handoffs, post-handoff action rejection, numbered sequencing, future-slot pass rejection and automatic exhaustion remain exercised. Central powerful cards are masked from the peer, rejected when cast from hand, prepared in a later round, and permanently removed after a legal prepared cast. Off-axis prepared and powerful casts are rejected without state changes. Final majorities, Black Rose standings and the first-player bonus are checked after round-three Cleanup.
- Natural **Violet/Azure draws reach a real hand overflow before round 3 Preparation**. Preparation is rejected first; exact overflow IDs are selected, including a school card, and the PERSONAL-discard exception is checked without changing library/removed piles. Under-limit empty selections and wrong-phase/count/unowned selections are rejected.
- Amber retains additional private quests. Whenever natural draws outlast random quest completions, the next Black Rose remains resolved-but-pending, blocks creator re-resolution and Study/grimoire draws, then accepts the exact quest selection without awarding completion rewards. With no overflow, Study proceeds without any empty discard command.
- Grey summons occur only via `ACTIVATE_ROOM`, never entry/begin/movement alone. Rewards check spawn position, printed stats, ownership, cap, unchanged hands/library/cubes and no extra cost. Naturally rebuilt rewards and spent-special rejection are checked when reached. Legacy direct summoning remains rejected.
- Same-hex mage attacks deal **2 damage** with sourced cube ledgers. Free Evocation model choice, movement allowance, ownership, friendly-fire rejection, alternating/empty-owner selection, once-only flags when reachable, enemy summon destruction and cube return without kill rewards are retained.

The script prints actual counters and gaps instead of claiming every random branch ran. **Quest overflow, rebuilt Grey and cap no-ops are not guaranteed in every run**; a spent reconstructed Grey special can prevent one or both Attack room effects, in which case the primary resolves and the rest is skipped. The engine suite covers dense scoring ranks, tie deductions and exclusive-color bonuses, four-mage construction/readiness, the shared turn budget, spell ranges, limits and both menu orders deterministically, including powerful overflow into personal discard, exact/duplicate/foreign selections, all skip stages, configurable stats, adjacent mage-attack rejection, paid evocation activations, Wounded Fury bonus, held powerful persistence, and remaining combat/scoring edge cases. The network scenario prioritizes real draw-driven overflow and new menus over retaining the old fixed 24-cast/12-activation totals.

## Architecture and scope

- `packages/game-engine`: deck definitions, immutable actions, events, quests, phases, combat and scoring.
- `apps/server`: in-memory room authority, readiness, action validation, hidden spells and draw piles, private bounded undo/redo history, state broadcasts.
- `apps/client`: phase-aware lobby and gameplay, spell selection/targeting, hex board, quest tracking, log, animations.

This implementation supports **two to four mages with Cadaver evocations end-to-end**. It does not claim full official rulebook fidelity, other summon archetypes, traps, official card/room text, authentication, or durable persistence. Reloading can reclaim a disconnected running seat by joining the same room; that seat is not authenticated. A battle disconnect pauses actions until the vacant seat is filled. Lobby departures instead free a seat and transfer creator duties if necessary. Rooms are deleted when all participants disconnect or the server restarts.
