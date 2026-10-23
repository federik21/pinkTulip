# Black Rose Wars — online prototype

Two-player, unofficial TypeScript prototype with an authoritative WebSocket server, a shared rules engine, and a React client. Card names and effects are original placeholders, not a reproduction of the published card set.

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

Open **http://localhost:5173** in two tabs or browser windows. The WebSocket address `ws://localhost:8080` is not a website to open in a tab.

1. The first mage creates a room and clicks **Mark ready**.
2. The other mage joins the same room and clicks **Mark ready**.
3. The creator clicks **Start game**. Both occupied seats must be ready.

For a second device on the same Wi-Fi, open the Vite Network URL (for example `http://192.168.1.5:5173`). The client connects to port 8080 on that same host. Allow the ports through the firewall. `VITE_WS_URL` can override the WebSocket endpoint; the server port can be changed with `PORT`.

If startup reports `EADDRINUSE`, another server already owns port 8080. Stop the earlier server with Ctrl+C before restarting; do not run the client command inside the server's running watch process.

## Round flow

**Black Rose → Study → Preparation → Action → Evocation → Cleanup.** The engine, WebSocket API and React client support summoning, model targeting and evocation control.

Every phase has a brief, dismissible announcement. Black Rose and Cleanup remain visible until the creator continues, so players can read the event and scores. Study and Preparation finish automatically once both players submit.

### Black Rose

- Each mage starts with **2 physical tokens**, refreshed to exactly **2** at the beginning of every round; unused tokens do not accumulate.
- Draw and resolve one of 12 event cards: neutral instability in random unfinished rooms, or 1–2 black damage to every mage.
- Black damage is neutral and does not award a player kill/quest credit. If it defeats a mage with player-owned damage cubes, those existing contributions still score and their cubes return; the mage respawns in their own starting room.
- At the end of Black Rose, each mage without a quest receives exactly one. Existing quests are retained.
- Start Study and draw 2 personal grimoire cards for each mage.

### Study

- Choose one of **6 shared schools**, initially **36 spells each**. For now all schools use identical effect distributions, but every physical card has a unique ID.
- Draw 4 spells from that school and select exactly 2 cards from your hand to discard.
- **School spells always return to their own school's discard pile**, whether discarded during Study, cast, left unused in Preparation, or spent to exit a starting room. Personal spells return to the mage's grimoire discard.
- Powerful spells cannot be discarded or spent on a starting-room exit; keep them until cast.
- Each depleted deck reshuffles only its own discard. Choose another school if the selected one has fewer than 4 cards across its draw and discard piles. Study draws up to 2 personal cards if the remaining grimoire cards are already held.

### Preparation

- Select three spells in progressive order **1 → 2 → 3**, and one **flexible** spell.
- Numbered spells cannot skip an unused earlier slot, and **only one numbered spell may be cast per turn**. The flexible spell is independent and may also be cast in that turn.
- Unselected cards remain in hand. Uncast ordinary prepared cards go to their origin's discard when the next round starts. **Unused powerful preparations return to hand**, never a discard pile.

### Action

- Each mage has **2 physical action tokens for the entire round**, separate from spells. Explore, Punch, and an additional evocation activation each consume **1 token and 1 physical action**. Summoning is a **free Grey room effect**, never a separate paid action.
- Alternate turns with **up to 2 physical actions**, plus free spell casts. Choose **End turn** when finished; after both physical actions, any eligible free spells remain available. The turn automatically finishes only when no legal options remain.
- **Begin movement** starts Explore, consuming 1 token and 1 action. Move **one adjacent hex at a time**, up to 2 steps. **Finish movement** stops early; it does not cost another action.
- **Punch** costs 1 token, dealing 1 damage to an enemy mage or evocation in the same or an adjacent space.
- **Activate a Grey room** as the optional start/end effect of Explore or Punch to summon **1 Cadaver (Undead) at the mage's position when the effect resolves**. Merely entering or occupying Grey does not summon. A reconstructed Grey room offers **2 Cadavers**, capped by the mage's **3 living owned evocations**: with two already owned, summon only one; at three, summon none. Destroyed models free their owned slots. There is **no extra token or physical-action cost** beyond the Explore/Punch itself.
- Grey replaces the former Ivory color. Its room effect is `SUMMON_CADAVER`, replacing `DRAW_LIBRARY`; it never draws from or recycles School 6. **Direct paid summoning has been removed**: `SUMMON_EVOCATION` is not a valid game action, and even a malicious legacy WebSocket payload is rejected with **Unknown game action**, without changing state.
- Every Cadaver has **movement 2, base attack 2, health 2**, and **Wounded Fury**: attack strength is **2 + its current damageCubes**. Evocations persist across rounds until destroyed.
- **Activate evocation** (`ACTIVATE_EVOCATION`) during Action is an additional paid activation of one owned model: 1 token and 1 physical action. It locks all mage commands until `END_EVOCATION` or a successful `EVOCATION_ATTACK` finishes it. A model may receive further paid activations if resources allow; these do **not** spend its later free Evocation-phase activation.
- **Cast spell** costs **no action and no token**. Cast at most one numbered spell per turn, plus the flexible spell if unused. Select a prepared spell, a highlighted target room, then confirm. Ordinary spells deal up to **4 damage** and/or **2 instability**, with ranges 0–4 and model or room targets. Powerful spells held in hand may also be cast directly for free, independently of the numbered-spell quota; preparing one in a numbered slot instead uses that slot's normal ordering and quota.
- Single-model spells select an enemy mage or evocation. They also offer an explicit **dummy target**: choose any non-starting room within range and resolve non-damage effects there. No model takes damage and no damage cubes are placed, even if the room is occupied.
- **No friendly fire:** model attacks/spells cannot target the controlling mage or any friendly evocation. Room spells and Crimson room damage affect **all enemy mages and evocations** there, never the caster or friendly summons. Instability applies to the target's original room even if damage defeats and respawns them.
- In a **starting room**, a mage cannot cast, punch, activate a room effect, or buy an evocation activation: **Explore** out, or **discard a held/unused prepared card** to move exactly one adjacent space for no action or token. The discard exit can be used once per turn. Mages cannot voluntarily enter or reenter any starting room; defeat still respawns them there. Evocations can never enter any starting room. Regular rooms remain revisitable. Starting rooms and models inside them cannot be targeted by spells or physical attacks; Black event damage ignores mage starting-room protection. A mage in a starting room may still control their models during the free Evocation phase.
- Player damage places **1 attacker-owned cube per damage actually inflicted**, limited by the attacker's available supply. Damage still applies if fewer cubes are available; overkill cannot add cubes beyond the victim's remaining health. The supply is shared with room instability.
- All evocation damage is sourced to its **controlling mage**. That owner's `cubes.onWizard` tracks cubes on enemy mages, `cubes.onEvocations` separately tracks cubes on enemy summons, and `cubes.onBoard` tracks committed room instability. These and `cubes.available` share the same 25-cube supply. Victims record ownership in `damageByPlayer`.
- Destroying an evocation returns **all cubes on it to their owners** and removes the model, with **no VP, mage-kill, or kill-quest reward**. An evocation defeating a mage still credits its controller normally, including contribution scoring and final-hitter kill/quest credit below.
- When a mage is defeated, rank only players with cubes on that mage: **4 VP for first, 2 VP for second, 1 VP for every other contributor**. Equal counts share the same competition rank (two tied leaders each get 4 VP; the next contributor is third and gets 1). Black damage and players with zero cubes do not compete.
- Return all damage cubes on the defeated mage to their respective owners, clear that mage's damage, and respawn them in their starting room. Cubes those owners placed on other mages or in rooms stay committed.
- The final hitter still receives kill and kill-quest credit, but there is **no additional flat kill VP bonus**. Contribution scoring also applies when a neutral event delivers the finishing damage.
- **End turn** keeps unused resources and is available after a physical action, a free spell, or a discard exit, but never during Explore or an active evocation. **Pass for this round** (`PASS_ROUND`) is legal **only with 0 physical tokens AND no unused prepared spells or held powerful spells**. Unused numbered slots still block passing even when this turn's numbered quota is already spent; end the turn and cast them on later turns. Passing is also forbidden during Explore or an active evocation. Ordinary unprepared hand cards do not block passing.
- Exhausted mages with no legal spells, physical actions, or discard exit are automatically skipped; a permanent pass is not needed to drain the round. When everyone has passed or cannot act, enter **Evocation**, not Cleanup directly.

#### Movement and room-activation buttons

Use explicit **Begin movement** and **Activate room** buttons instead of a room-effect timing dropdown or a paid summon button.

1. Choose **Begin movement** to start Explore, paying its single token/action. Select highlighted adjacent hexes, up to two steps. Movement alone does not activate any room.
2. To use the origin's room effect, choose **Activate room** before beginning movement; it starts Explore with the current room's effect, then allows movement. In Grey, the Cadaver appears at the origin and does not follow the mage.
3. If no effect was used at the start, choose **Activate room & finish movement** while exploring to finish with the current room's effect. Choose **Finish movement** to stop early without activating. When selecting the final movement destination, choose **Move here without activating** or **Move here & activate room** before the move is sent; **Choose another destination** cancels this local choice. An end effect uses the mage's destination, not the origin; at most one effect may resolve for that Explore.
4. Choosing a Punch target offers **Punch only**, **Activate room, then punch**, or **Punch, then activate room**. The effect is part of Punch, not an independent activation action. Paid **Activate evocation** controls an existing model and never summons or triggers a room effect.

Room activation is disabled in starting rooms and for a reconstructed special already spent this Action phase. Emerald still needs a valid target within distance 1 of the activated room. The acting mage is identified by a **glow and gentle scale pulse** on the board and player card, alongside a named turn banner; the highlight follows the acting owner in both clients. Reduced-motion preferences disable animation while retaining the static glow and labels.

### Evocation

- At phase entry, reset **every surviving model's `activated` flag**, independently of any paid Action activations. Each model then receives **one free activation**, costing no mage action or token.
- Alternate **owners**, starting with the first player who owns an unused model. The active owner chooses which unused owned model to activate. Skip owners without unused models; an owner may therefore activate consecutive models after everyone else is exhausted.
- Only **one model may be active at a time**. `EVOCATION_STEP` moves it one adjacent space at a time, up to its movement allowance (Cadaver: 2); no starting-room entry is allowed. Movement is optional.
- After moving, it may attack **once**, targeting an enemy mage ID (player ID or wizard ID) or evocation ID in the **same or an adjacent space**. A successful `EVOCATION_ATTACK` **immediately ends** that activation, so it cannot attack again or move afterward. Friendly models and models in starting rooms are protected.
- `END_EVOCATION` finishes early **without attacking**, even with movement remaining. In Action it resumes the mage's turn (or automatically advances if exhausted); in Evocation it selects the next eligible owner.
- Used models cannot activate again in this phase. When no unused surviving models remain, resolve **Cleanup**. With no evocations, this phase immediately proceeds to Cleanup.

### Rooms and Cleanup

The 18 regular rooms have **6 colors, exactly 3 rooms per color**. The central chamber and the **four protected starting rooms at (-1,-2), (3,-2), (-3,2), and (1,2)** are separate. The two current mages start at (3,-2) and (-3,2); the other starts remain unoccupied and protected. Choose **one optional free room effect at the start OR the end of each Explore or Punch**; it never costs another action/token. An end-of-Explore effect uses the destination room. Starting rooms have no effect, and discard exits/spells do not trigger room effects.

| Color | Prototype free room effect |
| --- | --- |
| Crimson | Deal 1 damage to every enemy mage and evocation in the activated room, never friendly models; damage cubes and normal mage-defeat rewards apply |
| Azure | Retrieve 1 uniformly random card from your personal discard into your hand; school discards are separate |
| Emerald | Place 1 instability in a chosen non-starting room within distance 1, including the activated room |
| Amber | Draw a new quest in addition to existing quests; every matching quest can complete and award its reward |
| Violet | Draw 1 card from your personal grimoire, reshuffling its discard if needed |
| Grey | Summon 1 Cadaver at the activating mage's position, up to 3 living evocations owned by that mage |

Choose Emerald's target with the room-effect target selector. Its range is measured from the room where the effect activates, so an end-of-Explore effect uses the destination, not the origin. Crimson's start effect can finish a mage before a Punch; the respawned mage is not hit again. Draw effects do nothing if their source has no available cards. Amber recycles completed quests when its deck runs out, never another mage's held quests.

**Reconstructed rooms double all seven effects:** Crimson deals 2 damage per enemy model, Azure retrieves up to 2 random personal-discard spells, Emerald places 2 instability within range 1, Amber draws up to 2 quests, Violet draws up to 2 grimoire spells, Grey summons up to 2 Cadavers without exceeding 3 living owned evocations, and the central chamber grants up to 2 powerful spells. Available supply and instability/cube caps still apply. This reconstructed special may be used **once per room globally across all players during an Action phase**, tracked by `specialUsed`; it is not once per mage or turn. Activating reconstructed Grey at the owned-model cap summons nothing but still spends that room's special. **Cleanup resets `specialUsed`** for the next Action phase. Ordinary unreconstructed room effects remain subject to the one-effect-per-Explore/Punch rule.

The **central chamber grants one powerful Black Rose spell** from a separate, finite 12-card supply (four of each original prototype spell):

| Powerful spell | Damage | Instability | Range | Target |
| --- | ---: | ---: | ---: | --- |
| Rosefall | 6 | 3 | 3 | Room |
| Sovereign Wrath | 8 | 1 | 4 | Single model |
| Worldbreaker | 4 | 4 | 2 | Room |

Powerful spells can be cast from hand as soon as Explore/Punch finishes. Held cards persist across Cleanup and future rounds; unused powerful prepared cards return to hand at the next Black Rose. **After casting, the physical card is permanently removed from the game**, never discarded or reshuffled. The powerful supply does not refill when empty. Standard range, starting-room protection, cube limits and dummy targeting still apply. Powerful spell identities remain hidden from opponents until used. These are original placeholder effects, not official card or room text.

| Room | Instability capacity | First place | Second place |
| --- | ---: | ---: | ---: |
| Central chamber | 10 | 6 VP | 3 VP |
| Other playable rooms | 5 | 3 VP | 1 VP |

- Final cubes are capped at capacity and the player's physical supply (25 cubes initially).
- Full rooms are immediately **rebuilt/locked** and accept no more cubes, including from events.
- At Cleanup, each newly rebuilt room awards points to players ranked by their contribution. Tied leaders each receive first prize; neutral Black Rose cubes never compete for points.
- Cubes return to the physical supply, but contribution records and rebuilt status remain. **A room scores only once.**
- Quests reward **2–3 VP** for a mage kill, placing the last cube in a room, or placing 2 cubes in one room with one spell. Completion is immediate; a replacement arrives at the next Black Rose.
- Victory is checked **only at Cleanup**, at **30 VP or more**. Highest total wins; tied highest totals use player order as the prototype tiebreaker.
- Otherwise the creator begins the next round, drawing another event and refreshing **2 tokens per mage**.

## Verification

```bash
npm test                 # engine behavior
npm run test:network     # three real two-client rounds: tokens, spells, summons, evocations, privacy
npm run typecheck        # engine + server + client
npm run build            # production client
npx playwright install chromium  # once, for browser tests
npm run test:browser     # two browsers play a round, plus mobile layout
```

The standalone network script is outside the workspace typecheck projects. Check it separately with:

```bash
npx --no-install tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --esModuleInterop --skipLibCheck scripts/multiplayer-smoke.ts
```

Browser tests run their own servers on ports 18080 and 15173, without disturbing local games.

The browser suite uses only visible controls in two real clients. It checks explicit movement/room choices, final-step confirmation/cancellation, Grey summons at origin and destination, no automatic summon on entry, starting-room activation protection, paid activation without summoning, free spells, and the complete Evocation combat flow into the next round. Both clients verify the named turn banner, glowing/pulsing acting mage and highlight handoff; reduced-motion and mobile no-overflow checks are included. Model cards show their owner's damage cubes and current Wounded Fury attack value. Rebuilt room details show double-special readiness and whether this Action phase's activation has been spent.

The network smoke starts an isolated ephemeral-port server and always terminates its clients/server. It uses only public WebSocket actions: **no server-state mutation, fixtures, or test-only commands**. It correlates each acknowledgement by request ID and synchronizes the peer to that acknowledged public state (including log length) before inspecting its private hand. It casts all **24 prepared spells over three rounds**, retains **12 free Evocation activations**, and spends the actual two-token budgets rather than passing with resources left.

Coverage includes premature-pass rejection (tokens, Explore, future ordered slots), automatic exhaustion, Grey summoning via **Explore start, the final movement step, and Finish Explore**, no automatic summon on entering Grey, one room effect per Explore, and a **Punch-end Grey activation at the three-model cap that legally summons nothing**. Every Grey reward checks spawn position, printed stats, ownership/cap, no extra action/token, and unchanged hands/library; legacy `SUMMON_EVOCATION` payloads must return exactly **Unknown game action** in the lobby, starting room, during Explore, on Grey with resources available, at capacity, and during an active evocation. Paid activation still spends one token/action without summoning or using the room special.

Retained checks cover paid activation locking, free Evocation model choice/alternation/once-only/owner skipping, movement and starting-room protection, friendly-fire rejection, enemy mage and summon attacks, Wounded Fury, separate cube ledgers, and destroyed-model cube return without scoring. Amber extra-quest privacy and central powerful-card privacy, free casting and permanent removal are also checked. Events and draws remain random: when Grey is naturally reconstructed, the smoke checks its doubled/capped reward and special consumption, and avoids illegal reuse. **Reconstructed Grey is not guaranteed in every network run**; deterministic double-reward, global-lock/reset, cap/refill, and both Punch timings are covered by engine tests, along with held powerful-card persistence and the remaining strict-pass/combat/scoring edge cases.

## Architecture and scope

- `packages/game-engine`: deck definitions, immutable actions, events, quests, phases, combat and scoring.
- `apps/server`: in-memory room authority, readiness, action validation, hidden spells and draw piles, state broadcasts.
- `apps/client`: phase-aware lobby and gameplay, spell selection/targeting, hex board, quest tracking, log, animations.

This implementation is **two-player with Cadaver evocations supported end-to-end**. It does not claim full official rulebook fidelity, other summon archetypes, traps, official card/room text, authentication, or durable persistence. Reloading can reclaim a vacant seat by joining the same room; that seat is not authenticated. A disconnect pauses actions until the vacant seat is filled. Rooms are deleted when both players disconnect or the server restarts.
