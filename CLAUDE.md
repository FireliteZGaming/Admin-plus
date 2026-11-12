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
- **What each version position means** (revised 2026-09-04): patch `2.0.x` is the
  day-to-day — a command, a fix, a tweak, most work. Minor `2.x.0` is a whole new
  SECTION behind its own toggle (the troll section is the archetype), not one
  feature. Major `x.0.0` is truly major or a milestone. This is orthogonal to the
  release CHANNEL: the number says how BIG, alpha/beta/stable says how SURE.
  **2.0.0** is the milestone consolidating everything since the last stable (1.7.3).
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

**UPDATE 2026-09-05, from a content log: `Player.kick` DOES NOT EXIST on
1.26.45.** A real kick attempt logged `api: unavailable`, which is this pack's
own words for `typeof target.kick !== "function"`. So on the game actually being
played the chain is two routes, not three, and the lockout that route was blamed
for cannot even be reproduced there. Leave the route in — it costs an
availability check and the API has moved before — but do not reason as though it
runs.

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

**Scripts have NO network access here.** `@minecraft/server-net` is the only
HTTP API and the docs are explicit: it "can only be used on Bedrock Dedicated
Server" and does "not function within the Minecraft game client or within
Minecraft Realms." So anything needing a service — translating what a player
typed, a webhook, fetching anything — cannot work on a realm or a local world.
Checked 2026-09-05 against the API reference, not assumed.

What IS possible for language: `rawtext` + `translate` keys render in EACH
CLIENT'S own language, and `Admin+ RP/texts/` already ships 29 `.lang` files
carrying only the six join/leave silencing lines. Localising the pack's own
strings is therefore a real option (~400 message calls, ~250 form strings) and
needs no network at all. Raised and shelved 2026-09-05.

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

**Forms have no drag slots and no hook for the vanilla anvil.** The chest-grid
inventory is a resource-pack trick, not an API.

**CORRECTED 2026-09-04 — forms CAN have a multi-line text field, and Admin+ has
shipped the ability to draw one since v1.1.0 without ever using it.** This file
used to say they could not, and that was wrong for months: it is why `< Code >`
was unrolled into ~55 one-line fields.

The SCRIPT API has no multiline option. A resource pack overriding
`ui/server_form.json` switches one on anyway, by pointing the custom form's
input control at `npc_interact.multiline_text_edit_control` — a control vanilla
already has for the NPC dialogue editor.

**`Admin+ RP/ui/server_form.json` already contains that whole chain**, because
it came from Chest-UI (CC BY 4.0, see `THIRD-PARTY-NOTICES.md`) and upstream
carries it: `custom_form_switch` → `custom_multiline_form` →
`custom_multiline_input` → `option_multiline_text_edit` →
`multiline_dialog_text_edit`, with `$max_text_edit_length: 32767`.

**How it triggers:** `custom_form_switch` matches the form TITLE against
`$flag_form_title`. Since 2.0.0 that is `§c§o§d§e` — a `§` before each letter,
which the renderer eats, in the style the chest UI already uses. Upstream's
printable `JavaScript REPL` is kept as `$flag_form_title_alt` and both bindings
consult the pair, so a pack speaking the older protocol still renders. Scripts
get it from `core/theme.js`: `MULTILINE` and `multilineTitle(hub, text)`. It
goes at the END of a title — a prefix restyles the words after it.

**Never hardcode that sentinel.** It lives in two files, in two languages, and a
disagreement does not throw — the form quietly opens a one-line box again, which
is exactly the state this replaced. `tests/multiline.test.js` pins them equal,
along with the control chain, the two bindings being exact complements, and the
config block fitting `$max_text_edit_length` (past the cap a truncated document
parses FINE and reverts every key after the cut).

**Anything editing a whole config as text needs an empty-document guard.**
Submitting `< Code >` replaces the override table with what came back, so an
empty field is an unconfirmed factory reset. `blockHasNoConfig()` refuses it; a
shrunken document still saves, because deleting a line is how you default a key.

Unverified in game. See memory `bedrock-multiline-forms`.

The general lesson: **"the API cannot do X" is not "X is impossible."** The
resource-pack layer has been the answer three times now — the chest grid,
vanish hiding armour, and this.

**`ModalFormData` label/header/divider elements shift `formValues` indices.**
Avoided deliberately in the config screen — a mis-indexed write would put every
value in the wrong key.

## Standing decisions

- **Panel-first.** Everything in `/admin`; no `/setrank`-style command sprawl.
  Bare command names, vanilla argument grammar, real selectors and enums.
- **The layout (2.7.9, the user delegated it on 2026-11-11: "organize it in a
  way you think is honestly best for a human user").** `/admin` is six choices:
  Players, Ranks, Places, Logs, Server, Help. `/menu` is Travel, People, Land
  claims, My settings, Help. Personal things (your homes, your claims) live in
  `/menu`; staff tools in `/admin`. Rarely used config sits in Server ▸
  Advanced. Keep new screens inside this shape rather than adding root buttons.
- **Server is Settings, Automod, Server presets, Advanced (2.8.3, the user's
  layout, 2026-11-12).** Settings is every switch, in five groups whose buttons
  list what they hold: Travel, Chat, Names and tags, Moderation, Player extras
  (`GROUPS` in `features/settingsUI.js`). Each thing has ONE page with its
  switch and its numbers ("Tpa... covers all Tpa things"). A new feature switch
  gets a page there; `tests/config.test.js` fails until it does.
- **A rank is Basics and Permissions (2.8.0, the user's own split, 2026-11-11),
  and it has a TYPE (2.8.1).** Basics: a TYPED name (`§` codes, never `&`: the user, 2026-11-12; Bold and
  Italic switches that read the codes and only rewrite them when flipped), a
  font with three switches (rank tag, their name, their messages), the type,
  name colour, typed chat colour, starting rank. Permissions: Member (use,
  limits, cooldowns) and Administrative (Staff type only). There is no colour
  LIST for names: people type codes, the user's call.
- **The four types (the user's, modelled on Discord roles).** Default and Staff
  are IN THE ORDER. Cosmetic (a tag, no permissions) and Unlisted (permissions,
  no tag) weigh 0 and are never in `ladder()`; weight 0 is what keeps them out
  of authority, so never give one a weight. The Ranks list shows the two
  groups as separate sections, and every rank button names its type.
- **Players ▸ a player ▸ Basics is Display (display name and font) and Ranks**
  (2.8.1, asked for 2026-11-11). A player's own font beats a rank's.
- **Player-facing text follows the 7 C's** (clear, concise, concrete, correct,
  coherent, complete, courteous). Name things by what a player recognises, not
  by how the code is built: "What it can do", not "Permissions" or "nodes".
- **Three command rules, and `core/registry.js` applies them to every command**
  (2.7.8, asked for 2026-11-11: "one command might have a list you can choose
  from but the other might not, which is wrong"):
  1. **Leave an argument off and it is asked for.** A spec's `mandatory` list
     means "needed", not "must be typed". `core/ask.js` turns a player into the
     one shared pick list, an Enum into buttons, text into a box. A parameter
     with its own list (warps, bans) supplies `ask`.
  2. **A player argument offers the game's player list.** That is the default.
     `picker: false` opts out to typed text (`me`, `all`, `@a`), and
     `tests/registry.test.js` demands a written reason for each one.
  3. **A `rest: true` text argument takes a sentence**, no quotes.

  **Never hand-roll a prompt, a player list or word slots in a command file.**
  Declare the parameter and let the registry do it; that is what keeps two
  commands from disagreeing.
- **Admin tools only (2.8.2, the user's call, 2026-11-11/12).** /items holds
  the Ban Hammer, Teleport compass, Ender Eye and Knockback stick. The Orbital
  Strike, Spectral Trident, Mirror Totem and all 54 vanilla command wrappers
  were removed as "not actually admin items" and "excessive op commands". Do
  not add them back unasked. Time and weather are Admin+'s own `/clock` and
  `/sky` (2.8.4, `features/timeweather.js`), set through the script API: the
  six times are a word list the game suggests, a number goes after `set`. A
  new admin need gets a purpose-built Admin+ command like these, never a
  vanilla wrapper. No Admin+ command may take a name in `core/gameowned.js`.
  The Creator & Dev console runs Admin+ commands only.
- **Server presets are on hold (2.8.6, the user, 2026-11-12).** The screen asks
  people to suggest ideas on the Discord instead of offering presets. The old
  four stay in `core/serverPresets.js` (scriptevent still applies them) so
  presets can return. The Discord link is `CONFIG.brand.discord`, printed by
  `core/links.js`; empty means "coming soon".
- **Nobody gives out a permission they don't have (2.8.7, the user asked for
  the rank gap to be fixed, 2026-11-12).** Switches, ready-made sets, "Also
  gets permissions from", a new rank's starting rank, and giving ranks are all
  limited to what the editor has (`canGiveNode`, `nodesBeyond` in
  `core/ranks.js`). Any other rank change a limited player makes is checked
  with `gainedBy`, a "what if" that saves nothing, and refused if it would
  raise them. Templates and the whole-list undo need `canReplaceRankList`.
  Logs undo needs the action's own permission (`UNDO_NEEDS` in
  `features/logsUI.js`). Owners and operators are not limited. Any new way to
  change ranks goes through these; `tests/rankgap.test.js` tries every door.
- **No economy or shop**, ever. The `+` means essentials.
- **Fly, god, heal, feed: dropped.** Removed on purpose, not missing. Do not
  build them unasked. Three things came OFF this list because the user asked
  for them back, and are not lapses: `bring` (2026-09-11, an entry in the Ender
  Eye's player menu), homes (2.7.0) and `/back` (2.7.4). Do not re-remove them.
- **A node exists only if the code checks it.** A switch that does nothing is
  worse than no switch; a test enforces this.
- **Automod PUNISHES SPAM, and only spam** (changed 2026-09-11, the user asked
  for it). The old rule was "never punish automatically", and it still holds for
  everything automod only GUESSES at — ore veins and break rates alert staff and
  stay their call. Flooding chat is counted rather than inferred, and the ladder
  is a talking-to, then 1m, 5m, 10m. It speaks as **[Automod]**, never as
  [Admin+], so nobody blames the staff who are online.
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
