# Satisfactory 2

A first-person, multiplayer factory-building game that runs in your browser, modelled on
[Satisfactory](https://www.satisfactorygame.com/). You land on an alien planet, mine by hand,
build the HUB, automate with miners, conveyor belts, smelters and constructors, power everything
with generators and power lines, then climb the tiers by shipping milestones and delivering parts
to the Space Elevator. You can play solo or with a friend on a different network.

> Fan-made and unofficial. Not affiliated with Coffee Stain Studios. No game assets are used:
> every model, texture, icon and sound is generated procedurally in code.

## Playing

### Option A: GitHub Pages (easiest for you and a friend)

1. Make sure the code is on your default branch (merge this branch if your default branch is
   something else).
2. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**
   (you only do this once).
3. Re-run the `Deploy to GitHub Pages` workflow (**Actions** tab → *Run workflow*), or just push.
   It publishes the game to `https://<your-user>.github.io/satisfactory-2/`. Until Pages is
   enabled, the deploy step is skipped with a notice rather than failing.
4. You and your friend open that URL. Nothing to install.

### Option B: Run it yourself

```bash
npm install
npm start            # serves the game on http://localhost:8080 and runs the relay at /ws
```

Any static file server also works, for example `npx serve .` or `python3 -m http.server`. Opening
`index.html` directly from disk does **not** work, because browsers block ES modules on `file://`.

## Multiplayer with a friend on another network

The host runs the world and the friend joins it. Progress is shared and saved on the host's computer.

1. **Host:** click *New Game* (leave **Open to friends online** ticked) or load a save. A 6-character
   **game code** appears in the top-left corner. You can also press **Esc** and use
   **Copy Invite Link**.
2. **Friend:** open the same game URL, click **Join Friend**, enter the code (or open the invite
   link) and press **Join**.

This uses a direct WebRTC peer-to-peer connection, brokered by the free public PeerJS signalling
server. There's no port forwarding or account to set up, and it works across different home
networks.

**If the Online connection fails** (a few strict corporate or university networks block WebRTC),
use the relay instead:

1. Run `npm start` on a machine you both can reach. That could be a free host such as Render,
   Railway or Fly.io, or your own PC behind a tunnel like `ngrok http 8080` or Tailscale Funnel.
2. Both players enter that address under **Settings → Relay server URL**.
3. The host picks **Esc → Host via Relay Server**, and the friend picks **Connection: Relay server**
   when joining.

You can also paste your own TURN servers (JSON) under **Settings → Extra ICE/TURN servers** to
make peer-to-peer work on difficult networks. If the public PeerJS server is ever down, run your
own (`npx peerjs --port 9000`) and enter its address under
**Settings → Custom PeerJS signalling server**. Both players need the same value.

The host's world keeps running while their tab is in the background, so alt-tabbing won't freeze
the game for the friend.

## Controls

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| WASD | Move | Space | Jump (hold to use the jetpack once unlocked) |
| Shift | Sprint | E | Interact / open a machine |
| Q | Build menu | F | Dismantle mode |
| Tab / I | Inventory | M | Map |
| 1–0 | Hotbar | R / mouse wheel | Rotate hologram |
| PgUp / PgDn | Raise / lower foundations and conveyor poles | Right mouse | Cancel build / belt segment |
| Hold left mouse | Mine ore / harvest plants | V | Flashlight |
| Enter | Chat (multiplayer) | H | Hide HUD |
| Esc | Pause menu | | |

## What's in the game

- **The world:** a procedurally generated 1 km² planet (from a seed) with hills, mountains,
  lakes, forests, a day/night cycle, and resource nodes (Iron, Copper, Limestone, Coal,
  Caterium, Quartz, Sulfur) at Impure, Normal and Pure purity.
- **Gathering:** mine ore nodes by hand, harvest leaves, wood and mycelia, and hand-craft at the
  HUB's Craft Bench or a standalone one.
- **Production:** Miners Mk.1–3, Smelter, Foundry, Constructor, Assembler and Manufacturer, with
  40+ recipes including alternate recipes and overclocking through Power Shards (up to 250%).
- **Logistics:** spline Conveyor Belts Mk.1–5 (60–780 items/min) with items you can see moving,
  Conveyor Poles, Splitters, Mergers, and Storage Containers.
- **Power:** Biomass Burners, Coal Generators, Power Storage, Power Poles Mk.1–3 and Power Lines.
  Grids have production/consumption stats, and the fuse trips when you overload them.
- **Building:** foundations of 1/2/4 m on an 8 m grid, ramps, walls, window walls and street lights.
- **Progression:** HUB Milestones across Tiers 0–5, M.A.M. research (Caterium, Quartz, Sulfur,
  Mycelia, hard-drive alternates), three Space Elevator phases that gate higher tiers, and the
  AWESOME Sink with coupons and the AWESOME Shop. Unlockables include the jetpack, Blade Runners
  and extra inventory slots.
- **Quality of life:** dismantle refunds and Dismantle Crates for overflow, autosave to browser
  storage, export and import of save files, a map, a compass with player markers, and in-game chat.

## How it's built

- Plain ES modules with no build step. Three.js is vendored in `vendor/three.min.js` and PeerJS in
  `vendor/peerjs.min.js`.
- `src/sim/` is a deterministic, DOM-free simulation (entities, belts, machines, power), so the
  same code runs on the host and the clients.
- **Networking model:** the host is authoritative. Clients send *actions* such as "build this" or
  "move these items". The host validates and applies them, then broadcasts *events*. Every client
  also simulates locally for smooth belts and machines, and adopts a full host snapshot once a
  second, so nothing drifts.
- `server/relay.js` is an optional static server and WebSocket relay.

```
src/
  data/      items, recipes, buildings, milestones/research/shop
  world/     seeded terrain, resource nodes and flora
  sim/       factory simulation, placement rules, host-side actions, replication
  render/    Three.js scene, procedural building models and textures
  player/    first-person controller, build gun, interaction
  net/       PeerJS / WebSocket relay / BroadcastChannel transports
  ui/        HUD, panels, map, icons
tests/       headless simulation tests (node tests/sim.test.mjs)
```

## Tests

```bash
node tests/sim.test.mjs
```

These cover world generation, hand gathering and crafting, milestones, a full
miner → belt → smelter → storage line with power, fuse trips and resets, splitters, conveyor
poles, host-to-client replication through events and snapshots, save/load round trips, network
message chunking, and the AWESOME Sink.

For testing in the browser console as host: `sf2.unlockAll()` and `sf2.give('iron_plate', 500)`.
