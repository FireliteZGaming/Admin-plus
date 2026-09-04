# CLAUDE.md — Admin+ (read every session, it is always loaded)

Bedrock admin addon. **Run `python tools/state.py` first** — it prints the live
version, what is deployed, test count, git state and the last release in one
screen, which re-establishes context faster than reading anything here.

This file holds the STABLE facts. Anything changing lives in memory
(`adminplus-open-bugs`, `adminplus-publishing`) or in `notes/` on this machine.

---

## The loop

```
python tools/setversion.py X.Y.Z   # config.js + every manifest array + both pack names
# write the CHANGELOG.md section NOW, not afterwards
npm test                           # must be green
python tools/verify.py             # must be 0 problems
python mcpack.py                   # -> Admin+.mcaddon
python tools/deploy.py             # into com.mojang, for the user to test
python tools/release.py --alpha    # tag, GitHub pre-release, archived build
```

- **Never hand-edit a version.** Six arrays plus `config.js` plus two pack names
  must agree; `setversion.py` is the only thing that gets that right.
- **Never deploy without asking** unless the user has just said to. They are
  often in the world. Building is always safe.
- **Bump before deploying**, so the user can tell from the pack list what they
  are running.
- After a Minecraft update, run `python tools/genicons.py` — item icons come
  from texture paths read out of the installed game.

## Releases have a channel, and it means how SURE, not how big

`tools/release.py` is the only way to ship. It refuses on a version mismatch, a
missing CHANGELOG section, a red test, a verifier problem, a dirty tree, or an
existing tag — and for anything above alpha it greps the content logs for
`[Admin+] vX.Y.Z loaded` and refuses if the engine has never run this build.
That last gate is the one that matters: a half-fixed storage build reached the
storefront because nobody could tell shipped from played.

- `--alpha` — tests pass, never run in game. GitHub pre-release; keep it OFF
  CurseForge, because MCPEDL mirrors CurseForge and that is the widest audience,
  not the narrowest.
- `--beta` — ran in a world here. CurseForge file type Beta.
- (no flag) — stable. Played by somebody who did not write it.
- `--promote` — an alpha/beta that survived becomes stable. Same tag, same file,
  prerelease flag flipped. **Never renumber to change a claim.**

A Bedrock manifest version is three integers, so the channel lives in the release
metadata, never in the number.

## Who publishes what

Claude owns **GitHub** — commits, tags, releases, uploading the `.mcaddon`.
`gh` is not installed; Git Credential Manager is authenticated, so `git push`
works and the REST API token comes from
`printf "protocol=https\nhost=github.com\n\n" | git credential fill`.

The user owns **CurseForge and MCPEDL**. Prepare copy for them; never upload.

## Reading the game

The content log is the ground truth and has caught bugs nothing else would:
`%APPDATA%/Minecraft Bedrock/logs/ContentLog*.txt`, newest file. Check it after
any playtest. The user's game is **1.26.45**; the pack targets 1.21.130.

---

## Bedrock rules that cost real time

These were each paid for with a playtest. Do not rediscover them.

**`#` is rejected in a command target.** Java-style `#fakeplayer` scoreboard
holders do not exist. Worse, a `.mcfunction` with one unparseable line is
dropped WHOLE, so a single bad character produced two unrelated-looking
symptoms. A test forbids `#` in any function file.

**Custom commands take at most 8 parameters.** Over that the registration is
refused outright and the command silently does not exist. `core/registry.js`
guards this now.

**Item icons: use texture paths, not registry ids.** The numeric id is a
position in the game's item registry and shifts every version — a 1.21.130 table
drew an acacia boat as pink dye on 1.26.45, and the error GREW with the id, so
no offset can fix it. **Do not "fix" this by measuring an offset again; that is
the bug.** Blocks keep the numeric route because their icon is a 3D model render.

**Vanish needs both numbers.** `playanimation ... none 0.5 "true"` re-applied
every tick. The 4th argument is a fade-OUT, not a fade-in — it is the only thing
bridging the gap to the next application. 10 ticks flickered; blend 0 flickered
worse. **Confirmed working; leave it alone.**

**There is exactly one way to remove a player, and it is `/kick`.** Established
2026-09-04 by reading four shipped addons (Minecraft Essentials, its Soulbound
edit, SafeGuard, AdminUtils) and all 46 installed packs that import
`@minecraft/server`. Nobody uses anything else, because there is nothing else:
`@minecraft/server-admin` holds the only real disconnect and exists on dedicated
servers alone. `Player.kick()` is undocumented but returns a **CommandResult**,
which gives away that it runs /kick underneath.

So the old rule here — "never run the /kick command" — was unachievable, and
worse, it steered this pack onto `Player.kick()`: the one route nobody else uses
and the one confirmed to leave a player locked out after an unban.

**What replaced it: `core/moderation.js` tries three routes in order and logs
which one worked.**

1. `self` — `victim.runCommand("kick @s <reason>")`. SafeGuard's. The only route
   where executor and target are the same person, so no operator removes anyone.
   The candidate for why SafeGuard does not lock people out.
2. `api` — `Player.kick()`. Confirmed to cause the lockout. Second on purpose.
3. `server` — `dimension.runCommand('kick "<name>" …')`. AdminUtils'. Bluntest,
   so it runs only after the other two have actually failed.

A route counts as working only if it neither throws nor returns
`successCount: 0`. `kick` stays off the `/cmd` whitelist regardless — that is
about who may type it, not about how this pack removes somebody.

The deeper constraint stands: Bedrock **cannot refuse a connection**. A Java ban
list rejects the login; here the player always joins first, so every ban is a
kick-on-join and inherits whatever kicking does.

**`world.getDynamicProperty` throws during early execution**, which is when
`Table` constructors run - so the first read of every table always fails. A
failed read is NOT an empty world; treating it as one wrote defaults over whole
worlds for six versions. Retry on the first tick, and never seed on a guess.

**A behaviour entity with no CLIENT entity in the RP renders nothing at all** -
no model, no nametag - while every script call reports success. Holograms were
invisible from the day they were written for exactly this.

**Nothing can kick the world host.** They are the server. `ban()` returns
`{ok, kicked}` so callers can say so honestly instead of looking broken.

**`PlayerInputPermissions.setEnabled` was renamed `setPermissionCategory`.**
The old name threw into a catch, so freeze silently did nothing for weeks.

**Forms have no multi-line text field**, no drag slots, and no hook for the
vanilla anvil. The chest-grid inventory is a resource-pack trick, not an API.

**`ModalFormData` label/header/divider elements shift `formValues` indices.**
Avoided deliberately in the config screen — a mis-indexed write would put every
value in the wrong key.

## Standing decisions

- **Panel-first.** Everything in `/admin`; no `/setrank`-style command sprawl.
  Bare command names, vanilla argument grammar, real selectors and enums.
- **No economy or shop**, ever. The `+` means essentials.
- **Homes, `/back`, fly, god, heal, feed, bring: dropped.** Removed on purpose,
  not missing. Do not build them unasked.
- **A node exists only if the code checks it.** A switch that does nothing is
  worse than no switch; a test enforces this.
- **Never punish automatically.** Automod alerts staff and they decide.
- **Anti-grief is UNSETTLED, and was never the user's rule.** This line used to
  read as a standing decision. It was carried over from the sibling Soulbound
  project by me, not stated by them - and it had already been used twice to talk
  them out of features. Ask before citing it. Do not import a sibling project's
  philosophy again just because the folders sit next to each other.
- MIT licensed. Chest-UI is included under CC BY 4.0 — see
  `THIRD-PARTY-NOTICES.md`. Techniques from SafeGuard and UltraVanish were
  reimplemented; no files of theirs ship.

## Working habits that paid off

- **Do not wrap a call in a swallow-everything `safe()` when its failure means
  the feature is broken.** Holograms silently did nothing for a whole playtest
  because the spawn was inside one.
- **A test that restates the rule tests nothing.** Call the real function.
- Shell heredocs mangle backslashes here. For content with `\n`, use the Write
  or Edit tools, or build escapes with `chr(92)`.
- `notes/` is gitignored and holds design docs; never commit it.
