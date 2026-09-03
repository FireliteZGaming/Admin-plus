# Admin+

A complete admin toolkit for Minecraft Bedrock: rank ladders, moderation, warps,
TPA and chat channels, all run from a single `/admin` panel.

> **Requires Beta APIs.** Turn on *Settings ▸ Game ▸ Experiments ▸ Beta APIs* in
> the world you are using this on, then reload it. Nothing in the pack runs
> without it — the scripts are never started, so the addon cannot even tell you
> itself. A watchdog built from `.mcfunction` files does that instead, because
> functions are data and keep running when scripts do not.

---

## What it does

**Ranks.** A ladder where the order *is* the hierarchy — no weight numbers to
juggle. Ranks inherit, wildcards (`admin.*`) grant a whole branch, and a leading
`-` denies. A rank never sees a control it would be refused: the panel is drawn
from the permission nodes, so it gets smaller further down the ladder rather
than filling with locked buttons.

**Moderation.** Kick, ban (timed or permanent), mute, freeze, and a per-player
actions screen. Bans are the addon's own list, re-applied on rejoin — vanilla
Bedrock has no `/ban`. Everything is logged, indexed by both who did it and who
it happened to, so "what was done to me" and "what has this moderator been
doing" are separate questions with separate answers.

**Chat channels.** Named rooms with their own permission node. You type in one
and receive one, unless your rank holds *View All Chats* — which only ever
widens you to channels you already have access to.

**Warps, spawn and TPA**, with warmups, cooldowns and per-rank overrides.

**Automod** that alerts rather than punishes: ore veins grouped as one find,
break-rate, chat flooding. No fly or speed checks — on Bedrock those fire on
elytra, riptide, ice and lag, and an alert nobody trusts is worse than none.

**Holograms.** Floating text and scoreboard leaderboards. The definition lives
in world storage and a loop rebuilds the entity, so one that gets killed comes
back on its own.

**Server presets.** One preset sets the ladder, the config and the chats
together — Server, Realm, SMP, Lockdown, Quiet. Change any part and it reads
*Custom*, because that is the honest answer.

---

## Building

```sh
npm test                       # 23 suites, ~875 assertions, no dependencies
python mcpack.py               # -> Admin+.mcaddon
python tools/verify.py         # full pre-release sweep, exits non-zero on a problem
```

`npm test` runs the real scripts under Node against hand-written stand-ins for
`@minecraft/server` in `node_modules/`. Those four files are source, not
installed packages.

### Tools

| | |
|---|---|
| `tools/setversion.py 1.1.0` | the version, in every manifest array, `config.js` and both pack names, from one place |
| `tools/verify.py` | manifests, version lockstep, syntax, imports, JSON, functions, entity references, command parameter limits, archive integrity |
| `tools/genicons.py` | regenerates `core/itemTextures.js` from the installed game — **run this after a Minecraft update** |
| `tools/deploy.py` | installs into the local `com.mojang` folders for testing |
| `tools/newuuids.py` | rotates pack UUIDs. Read its warning first; it is not the normal update path |

---

## Two Bedrock things worth knowing

**Item icons come from texture paths, not registry ids.** The chest-grid
`/invsee` could identify an item by its index in the game's item registry, and
that index shifts with every version — a table built for 1.21.130 drew an acacia
boat as pink dye on a 1.26.45 client, and the error grew with the id, so no
offset could correct it. `tools/genicons.py` reads the installed game's own
resource packs and writes a texture path for each item instead. Paths do not
drift. Blocks keep the numeric route, because a block icon is a 3D render of its
model that a flat texture cannot stand in for.

**The command parser rejects `#` in a target.** Java-style `#fakeplayer`
scoreboard holders do not exist here, and a `.mcfunction` with one unparseable
line is dropped *whole* — which once produced two unrelated-looking symptoms
from a single character. The watchdog keeps its counters on real players.

---

## Credits

Built by **FireliteZGaming**.

Techniques learned from other packs, reimplemented here — no files or assets of
theirs are included:

- **SafeGuard** — warning players when Beta APIs is off, from `.mcfunction` data
  that still runs when a beta-gated script never starts.
- **UltraVanish** — that invisibility does not hide armour, and a bone-scaling
  animation does.
- **ChestFormData** (Herobrine64, LeGend077) — the wire format that turns a form
  into a chest grid. Admin+ speaks the same sentinels on purpose, so its windows
  still render under another pack that implements the same protocol.
