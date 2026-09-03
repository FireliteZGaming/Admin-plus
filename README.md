# Admin+

**Everything you need to run a Minecraft Bedrock world, in one menu.**

Ranks, banning and muting, warps, teleport requests, staff chat — all from a
single `/admin` screen instead of a pile of commands nobody remembers.

[**Download the latest version →**](https://github.com/FireliteZGaming/Admin-Minecraft-Bedrock-/releases/latest)

---

## ⚠️ Read this first

Admin+ needs **Beta APIs** switched on, or it does nothing at all.

In your world settings: **Game ▸ Experiments ▸ Beta APIs** → on → then leave the
world and come back.

If you forget, Admin+ tells you a couple of seconds after you join. (It has to
warn you in an unusual way, because when Beta APIs is off the addon isn't
running and can't speak for itself.)

## Installing

1. Download `Admin+.mcaddon` from the [releases page](https://github.com/FireliteZGaming/Admin-Minecraft-Bedrock-/releases/latest).
2. Open the file — Minecraft imports it automatically.
3. In your world settings, add **Admin+ BP** (behaviour) and **Admin+ RP**
   (resources). Both are needed.
4. Turn on Beta APIs, reload the world, and type `/admin`.

---

## What you get

### Ranks that make sense
Drag ranks into the order you want and that order *is* the pecking order — no
numbers to fiddle with. A Mod can't ban someone above them, and Admin+ hides
buttons a rank isn't allowed to press, so nobody sees a control that just says
"no". Comes with ready-made ladders (Server, Realm, SMP) if you'd rather not
build one.

### Moderation
Kick, ban (for an hour, a week, or forever), mute, and freeze someone on the
spot. Everything is written down, and you can look it up two ways: *what was
done to this player* (for appeals) or *what has this moderator been doing* (for
checking up). Most actions can be undone.

### Chat channels
A staff channel other players genuinely can't see, plus any channels you make
yourself. Ranks show as coloured tags in chat and above heads.

### Warps, spawn and teleport requests
Set warps, protect spawn, and let players ask to teleport to each other — with
waiting times and cooldowns you control, or turned off entirely.

### Watching for trouble
Admin+ quietly tells staff when someone digs out a big vein of diamonds, breaks
blocks impossibly fast, or floods chat. It never punishes anyone by itself — it
tells you, and you decide.

### Floating text and leaderboards
Hang a sign in the air anywhere, or a live top-10 from any scoreboard. If
something deletes it, it puts itself back.

### Odds and ends
See inside a player's inventory and take things out of it. Go invisible properly
— armour and held items included. Clear the chat, clear laggy dropped items,
speak as another player, broadcast to everyone.

---

## Common questions

**Do I need to be the world owner?** You need operator status for most of it.
The panel adapts to whatever rank you hold.

**Will it work on a Realm?** Yes, as long as Beta APIs is on for that world.

**Does it delete my builds?** No. Nothing in Admin+ breaks blocks.

**Does it add an economy or shop?** No, and it won't. The `+` means the
essentials — warps, teleports, ranks — not a whole server suite.

**Something looks wrong.** Type `/function check` and it will tell you whether
Admin+ is running.

---

## For developers

<details>
<summary>Building, testing and the tools</summary>

```sh
npm test                # 23 suites, ~875 assertions, no dependencies
python mcpack.py        # -> Admin+.mcaddon
python tools/verify.py  # full pre-release sweep; exits non-zero on a problem
```

Tests run the real scripts under Node against hand-written stand-ins for
`@minecraft/server` in `node_modules/`. Those four files are source, not
installed packages.

| Tool | What it does |
|---|---|
| `tools/setversion.py 1.1.0` | the version, in every manifest array, `config.js` and both pack names, from one place |
| `tools/verify.py` | manifests, version lockstep, syntax, imports, JSON, functions, entity references, command parameter limits, archive integrity |
| `tools/genicons.py` | regenerates `core/itemTextures.js` from the installed game — **run after a Minecraft update** |
| `tools/deploy.py` | installs into the local `com.mojang` folders for testing |
| `tools/newuuids.py` | rotates pack UUIDs; read its warning first, it is not the normal update path |

**Two Bedrock things that cost real time.**

*Item icons come from texture paths, not registry ids.* The chest-grid `/invsee`
could identify an item by its index in the game's item registry, but that index
shifts every version — a table built for 1.21.130 drew an acacia boat as pink
dye on 1.26.45, and the error grew with the id, so no single offset could
correct it. `tools/genicons.py` reads the installed game's own resource packs
and writes a texture path per item instead. Paths don't drift. Blocks keep the
numeric route, because a block icon is a 3D render of its model.

*The command parser rejects `#` in a target.* Java-style `#fakeplayer` scoreboard
holders don't exist here, and a `.mcfunction` with one unparseable line is
dropped *whole* — which once produced two unrelated-looking symptoms from a
single character.

</details>

---

## Credits

Built by **FireliteZGaming**.

Admin+ is MIT licensed. It also includes the **Chest-UI / ChestFormData**
module by LeGend077, Herobrine64 and Aex66, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and modified — that is
what lets `/invsee` draw a real chest window. Full details, and what was
changed, are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Techniques learned from other packs and reimplemented here — no files or assets
of theirs are included:

- **SafeGuard** — warning players when Beta APIs is off, using `.mcfunction`
  data that still runs when a beta-gated script never starts.
- **UltraVanish** — that invisibility doesn't hide armour, and a bone-scaling
  animation does.
(The chest-grid format above is the one exception — that is real code, used
under its licence rather than reimplemented.)
