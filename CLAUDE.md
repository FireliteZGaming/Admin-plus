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
- **Run `setversion.py` before the first `verify.py` of a version.**
  `verify.py` rebuilds `Admin+.mcaddon`, and the user installs by opening that
  file whenever they like; the game unpacks it into `behavior_packs/Admin+v2(N)`.
  A mid-work build carrying 2.12.8's code ran under 2.12.7 that way
  (2026-11-14). `deploy.py`'s folder is not where the user's builds go, so
  `state.py` reports both ("deployed" and "imported").
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
  from texture paths read out of the installed game. Then
  `python tools/gendisguise.py` (`--report` first): the 76 disguise look files
  name the game's own models, textures and animations, read the same way.

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
any playtest. It also holds every chat line, which is the fastest way to read
what testers said.

**After every playtest, run `python tools/chatarchive.py`.** Minecraft does not
keep its logs forever. The tool copies every chat line into
`notes/chat-archive/chat.jsonl` (gitignored), never twice and unfiltered: the
user wants all of it, harassment included, to train moderation later
(2026-11-12). Other players wrote it, so it never leaves this PC. The user's game is **1.26.45**; the pack targets 1.21.130.

---

## Bedrock rules that cost real time

These were each paid for with a playtest. Do not rediscover them.

**Resource-pack menus: what the in-game tests of Admin+'s own look taught
(2.11.0 onward, 2026-11-13, the user's screenshots).**
1. **A picture keeps its texture's shape unless it says `"keep_ratio":
   false`.** The flat-colour panel drew as a square, its fill as a thin strip
   and the BETA LOOK badge as a line through the words. The game's own files
   set it false 29 times. `tests/look.test.js` demands it on every picture of
   ours that stretches; the button faces use `adminplus_beta.button_fill`.
2. **Percentage sizes under a server form collapsed.** The frame came out at
   exactly its `min_size` (225 by 200), so the panels above it reported no
   size. 2.11.1 sizes `main_screen_content/server_form_factory` and
   `long_form` at 100%. Keep a `min_size` on anything sized in percent.
3. **A grid bound to `form_buttons` drew nothing on 1.26.45**, with no line in
   the content log. Tiles are now two factory columns built like the game's
   own list (`#form_button_contents` to `#collection_length`); every tile is
   made in both and shown in one, by the hidden `TILE_LEFT` code at the end of
   its text.
4. **The content log shows no menu errors at all.** A broken menu is silent;
   only a screenshot tells.
5. **Side by side, a `100%c` height ADDS the children's heights (2.12.1).**
   The four Template cards made a row 720 tall and drew in its top 180; the
   screenshot's scroll bar measured it. Size a horizontal stack's height, or
   a vertical stack's width, with `100%cm` (the tallest child), as the
   game's files do 102 times. Hidden children take no room at all, so the
   made-in-both, shown-in-one trick is sound. `tests/look.test.js` checks
   every stack of ours.

**Font-page pictures draw at one game pixel per picture pixel, centred on
the line, and are never shrunk (2.11.4, the user's screenshots).** A badge
that filled its 32-pixel cell drew four chat lines tall. The game's own icons
(`glyph_E0`, a 512 sheet) are 9 to 23 pixels centred in 32-pixel cells, and
its letters are 8 by 12 cells with 7-pixel capitals (`default8.json`). Badges
are `BADGE_PX` (10) in `tools/genbadges.py`; `tests/badges.test.js` holds it.
`--preview` draws them at real size. **And a colour code does NOT end bold in
Bedrock:** `§l` runs on, across lines, until `§r`.

**Subpacks: the game starts on the LAST subpack when they tie.** 2.10.1 put
Default first on a higher `memory_tier` and the user's world started on Beta
(2026-11-13). The game now ranks subpacks by `memory_performance_tier`, which
needs manifest version 3 (experimental), so ours tie, and Microsoft's docs say
"In the case of a tie, the system selects the last subpack listed of that
tier." Default is listed last, both on `memory_tier` 0, so the slider reads
Beta, then Default. `tests/channel.test.js`.

**A form cannot show a literal `§`.** The game hides `§` and the character
after it, so `§§` shows nothing at all (seen in game, 2026-11-12; 2.8.5 had
assumed it printed one `§`). Since 2.9.2 help explains codes the way
Minecraft Essentials does, at the user's request: an example in the box
("Example: §eHelper") and the "!" tooltip `COLOUR_CODE_TIP` in
`core/theme.js`, which ENDS in `§`. A `§` with nothing after it has nothing
to hide, and Essentials' own "Use §" tooltip relies on that. Unverified here.
Every box that takes codes gets the tooltip; `tests/hold.test.js` checks.

**Never put `{ header }` in a menu.** It draws far too big between dividers
(the user, 2026-11-12). Section titles are bold labels: `{ label: "§lTitle" }`.
A test fails on any header.

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

**A script can't read a block that isn't loaded, and ground far away isn't
loaded until a player is near it (2.12.16).** /rtp searched from where the
player stood, so with its defaults (256 to 4,000 blocks out) nearly every
spot was unloaded and it almost always said it couldn't find anywhere. It
now moves the player high over the spot with slow falling, waits for the
ground to load, and lands them (`features/rtp.js`). Anything that needs to
read a far place goes there first.

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
value in the wrong key. Since 2.11.4 `modal()` takes `{ type: "label" |
"header" | "divider" }` fields and reads the answers either way: one per
field, or (on a game that drew no labels) one per input.

## Standing decisions

- **Panel-first.** Everything in `/admin`; no `/setrank`-style command sprawl.
  Bare command names, vanilla argument grammar, real selectors and enums.
- **The layout (2.7.9, the user delegated it on 2026-11-11: "organize it in a
  way you think is honestly best for a human user").** `/admin` is six choices:
  Players, Ranks, Places, Logs, Server, Help. `/menu` is Travel, People, Land
  claims, My settings, Help. Personal things (your homes, your claims) live in
  `/menu`; staff tools in `/admin`. Rarely used config sits in Server ▸
  Advanced. Keep new screens inside this shape rather than adding root buttons.
- **Server is Settings, Automod, Automation, Server presets, Advanced** (2.8.3,
  the user's layout, 2026-11-12; Automation added in 2.10.0 because the user
  asked for "our own automation setting under server"; Server presets hidden
  since 2.12.9, see below). Settings is every switch, in groups whose buttons
  list what they hold: Teleportation (id `travel`, renamed from Travel in
  2.12.16), Chat, Names and tags, Moderation, Player extras, Omnitool,
  Automation (`GROUPS` in `features/settingsUI.js`). Teleportation ▸ Wait
  times covers every teleport, /rtp included. Each thing has ONE page with its
  switch and its numbers ("Tpa... covers all Tpa things"). A new feature switch
  gets a page there; `tests/config.test.js` fails until it does.
- **The server settings overhaul (2.12.7, Beta, the user: "an absurd list of
  buttons that can be edited, which is what confuses people").** In Beta a
  Settings group is ONE page in sections (`groupPageScreen`: a bold label
  and a divider per page, `strict`, Save), and every setting has one home:
  the formats, word lists and fine-tuning numbers sit in their section as
  fields marked `beta` (Default filters them out, so it stays as it was),
  Automod ▸ Checks has `CHECK_PAGES`, Chat screening has `WORD_FIELDS` and
  `HOLD_FIELD`. Only `creator.identity`, `creator.console` and
  `ranks.permissionEditor` are < Code >-only. Beta's Advanced has no Every
  setting, and Vanilla shows as "Back to defaults". Realm, Strict and Quiet
  are gone in both looks ("shouldn't actually exist"). A switch, slider or
  text box saves through `core/settingFields.js` (`fieldFor`, `applyField`:
  unanswered keeps, unmoved writes nothing, a refused format says why, a
  padded default such as the one-space `format.tagJoin` is never trimmed).
  A new setting needs a home on a page; `tests/settingspages.test.js` fails
  until it has one.
- **Hiding is one layer (2.12.8, `core/hiding.js`).** Vanish and disguise
  are each a REASON to hide a player; they show again only when no reason is
  left, so coming out of vanish leaves a disguise on. Effects are BORROWED:
  the invisibility and night vision a player had before (a potion) are given
  back with the time they had left, never just removed (the user: "using
  /vanish to disappear and appear should not affect your current effects or
  invisibility"). The every-tick animation stamp and the blank nametag live
  there, and `refreshNameTag` skips hidden players. Anything new that hides a
  player is a new reason, not its own copy of the effects.
- **/disguise (2.12.8, Beta, the user: "disguise as anything. Sorta like a
  morph mod ... skip flying mobs").** `features/disguise.js`. The player is
  hidden (reason `disguise`) and a BODY follows them: `adminplus:disguise_<mob>`,
  Admin+'s own entity with no AI, no damage, no pushing, family
  `adminplus_disguise`, a 0.01 hitbox so hits reach the player. Never a real
  mob: a script can't switch a mob's AI off. The body is PUSHED to the player
  every tick (`clearVelocity` + `applyImpulse`), because the game animates legs
  from distance actually travelled and a teleport travels none; it is snapped
  when more than 4 blocks away or behind for 5 ticks, remade if it vanishes,
  and removed while its player is vanished. Bodies carry `ap:disguise:<id>`;
  strays are swept. It ends with `off`, factory reset or leaving (`onJoin`
  ends a disguise left on the books). The 76 mobs and their look files come
  from `tools/gendisguise.py`, which reads the installed game: references to
  the game's own models, textures, animations and render controllers, plus
  the molang that feeds them; a `minecraft:*` property reads as the mob's
  default, and engine-supplied variables start at rest. Flying mobs stay off
  the list. `tests/disguise.test.js`. **The content log is the check for the
  look files** (2.12.9): the game derives a neck locator per geometry and
  logs an error when two differ, so geometries a disguise never draws (baby,
  coats, sheared, a plain look's poses) point at the default (`NEVER_DRAWN`);
  and it asks some vanilla render controllers for names no vanilla file
  defines, which `GAME_ASKS_FOR` supplies from the content log's own words.
  After a game update, load a world and read the log for `adminplus:disguise_`.
- **< Code > is JavaScript in Beta (2.12.7, the user: "we actually make that
  JavaScript too").** `const setup = "..."` and `const settings = { ... }`,
  one heading per group (`toScript`/`fromScript` in `features/code.js`).
  **It is read, never run:** `core/jsconfig.js` is a small reader (comments,
  quotes, numbers, true/false, lists, objects, optional commas,
  `settings.a.b = x`), and nothing in this pack may ever `eval`,
  `new Function` or otherwise execute what a player typed, because it would
  run with the pack's full power past every rank rule. A mistake names its
  line and saves nothing; a name written twice in one `{ }` is a mistake
  (JavaScript would drop the first). Save rules match the block's, and a
  setup named in the document loads with changed lines on top
  (`scriptResult`). Default keeps `key = value`. `tests/jsconfig.test.js`.
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
- **One main tag (2.10.0, the user, 2026-11-12: "if you have multiple staff
  ranks ... it'll only show 1, and it'll show the highest one ... Cosmetic is
  what you would make if you want extra tags").** `displayRanks` shows the
  heaviest Default or Staff rank, then Cosmetic ranks in the holder's order.
  Never two tags from the order. Authority still comes from every rank.
- **Automation (2.10.0, the user's idea, design in Obsidian ▸ Automation).**
  `core/automation.js` is the language and touches no game object;
  `features/automation.js` stores, starts and acts. An automation can only do
  what its saver can do (`PERMISSION_FOR`), checked on save AND on every run;
  it never changes the saver's own ranks. In a chat before-event nothing is
  written: actions queue for the next tick. `first join` reads the holder
  record BEFORE the join handler writes it. `tests/automation.test.js`.
- **Players ▸ a player ▸ Basics is Display (display name and font) and Ranks**
  (2.8.1, asked for 2026-11-11). A player's own font beats a rank's.
- **Player-facing text follows the 7 C's** (clear, concise, concrete, correct,
  coherent, complete, courteous). Name things by what a player recognises, not
  by how the code is built: "What it can do", not "Permissions" or "nodes".
  **One word per thing (2.8.8, the user asked for every line to follow the
  7 C's):** display name (not nickname), chat room (not channel), settings
  (not config or values), rank list or order (not ladder), a player (not
  somebody), expires (not lapses), Saved setups. One message per situation:
  "Nobody matched that name.", "Skipped because they outrank you: ...",
  "Couldn't read your position. Try again.", "That ... no longer exists."
  No " — " joining two thoughts in anything a player reads. The Beta APIs
  warning in `core/health.js` is the user's own wording from 1.1.0: leave it.
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
  `core/links.js`; empty means "coming soon". **Hidden since 2.12.9** (the
  user: "since presets won't be here, not dropping it but hiding"):
  `SERVER_PRESETS_ON_HOLD` in `core/hold.js` is true, which takes away the
  Server button, the `presets.apply` switch (ranks keep the permission), its
  place in the Server shape set, the Manager card's tick, the `/version`
  preset line and Credits' "ideas for new presets". Flip it to bring them all
  back. `tests/ranks.test.js` lets `presets.apply` be checked without a switch
  only while it is true. Anything else put on hold gets a line there too.
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
- **World tools (2.9.0, the user's design, 2026-11-12).** `/wts` holds the
  Omnitool (admin, `admin.omnitool`) and land claims (everyone, while claims
  are on). The Omnitool SELECTS like WorldEdit and never edits blocks: "WorldEdit
  is its own existing mod ... and a great one". Its state lives on the player
  (`features/worldtools.js` sessions), never on the item, because the item
  swaps between three looks. Spawn as an area is `core/omnitool.js`: turning
  it on sets simple spawn aside, and Delete or the switch puts it back
  exactly. The switch can change anywhere, so `reconcileSpawn()` catches up
  every 30 ticks; it writes, so never call it from a before-event. The full
  design is in Obsidian: Firelite ▸ Projects ▸ Minecraft ▸ Bedrock ▸ Mods ▸
  Admin+ ▸ World Tools.
- **3.0.0 was cut on 2026-11-20 at the user's word** ("i want to publish
  this stuff", "any fixes can go in 3.0.1 after we post"), before the setup
  screen (with its optional password), which is still to come. It was
  approved, not played: 2.12.13 to 3.0.0 had not run in a world when it was
  cut, so release.py allows only --alpha until the user loads it once.
  Plan: Obsidian ▸ Admin+ ▸ Before 3.0.0.
- **Timed grants give things back (2.12.16, the user's design).** When a timed
  grant ends they ALWAYS go back to the gamemode they had; two switches on the
  Grant screen add their inventory from right before the rank and a trip to
  spawn (the world's spawn when none is set). It keeps across leaving: owed
  actions wait in `grantDue` until they join. What they had is noted in
  `grantKeep` (the real items in memory too, like staff mode). Taken away
  early counts as ending; staff mode makes it wait; the staff-lost survival
  rule steps aside (`gamemodeComingBack`). `tests/grantend.test.js`.
- **Lag clear thinks before it removes (2.12.17, the user: "super complex and
  advanced behind the scenes while simple to use").** `core/cleanup.js` is
  the thinking and touches no game object; `features/cleanup.js` does the
  work. It is still a WHITELIST of types (`GROUPS`). Thrown tridents, ender
  pearls and fishing hooks are off it on purpose: each is somebody's (a
  trident, a stasis chamber, AFK fishing). A clear merges identical plain
  drops first (lossless), then removes only what `judge()` allows: never
  named, renamed, enchanted, lore, valuable or keep-tagged things, items a
  script can't copy exactly (`HIDDEN_DATA_ITEMS`), drops younger than
  `cleanup.minAge`, or death drops (items and XP) for `cleanup.deathKeep`
  minutes, whichever order the game reports the death and the drops. Every
  removed item is saved for Bring back (`lagclearUndo`, 3,000 stacks). It
  clears by itself by default (`cleanup.auto`), never twice in 5 minutes and
  always after a countdown. Anything new that removes entities goes through
  `judge()`. `tests/lagclear.test.js`. **3.0.0, from research (Obsidian ▸
  Admin+ ▸ Research):** hidden data is a RULE (`keepsHiddenData`: shulkers,
  any bundle, bee nests, armour, enchanted books, other packs' unstackables,
  anything with `minecraft:inventory`) that a server's list can't switch
  off; shields also ride on the item as `ap:keepuntil:<ms>` tags; an item
  never seen counts as new; slow-server clears back off (`nextSlowLevel`);
  bring back keeps the newest 3,000 across clears and the real ItemStacks
  in memory, like staff mode. **3.0.3 (the user: "simplify things on lag
  clear, so it actually clears lag"; they picked these three):** the mob
  limit is ON, 20 of one kind per chunk (the common server cap), farthest
  from players first (`planMobLimit(mobs, cap, players)`); it clears by
  itself at 500, or at 100 on a server slow for a minute, extra mobs
  counted (`crowdedMobs()`). Merging always happens when dropped items are
  taken (no switch). They did NOT pick fewer keep rules: every protection
  above stays. **`/lagclear` is ONE DROPDOWN, then Submit** (the user, after
  a list of toggles and then level buttons were tried the same day: "a
  high lag clear, or a minor lag clear or like in between", "Have it be a
  dropdown instead then you press submit. Toggles are too weird"): Minor
  (items and XP), Medium (the settings, what a clear by itself does; the
  default), High (every group, mobs to half the limit), and Bring back the
  last clear when there is one (`lagForm`, `clearPlan(level)`,
  `runClear({ level })`, `judge(entity, now, types)`). Don't offer
  per-type toggles again.
- **Bot Guard is Automod's first check back (3.0.1 as bot detection, the
  user: "the first semi-introduction to automod, an emergency
  introduction"; named Bot Guard in 3.0.3, their pick).**
  `core/botcheck.js` scores a half-joined account: it JOINED but never had
  a first spawn (the 2026-11-20 ad bot sat in the player list where no
  selector could find it). Nothing is judged inside the LEVEL's wait
  (`automod.botLevel`, 3.0.3, the user's levels "like for servers or
  verification": Low 2 minutes for slow servers, Medium 60 s by default,
  High 20 s; Max, "almost instant", is in progress and not offered), and
  anyone who spawned, a player on the death screen included, can't match.
  Alerts tells staff; at `automod.botActAt` it does `automod.botAction`
  (none by default, kick or ban) by NAME, through moderation.js's server
  route. Flags and actions go to the content log too. **Proven in game by
  the user (2026-11-25):** at a 60-second wait "it only caught bots", but
  the bots "had time to do something", hence High. `AUTOMOD_ON_HOLD`
  still holds the old checks; `AUTOMOD_SECTION_ON_HOLD` shows the section
  and /automod. `tests/bots.test.js`.
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
  [Admin+], so nobody blames the staff who are online. **Since 3.1.4 swearing
  is counted too** (Chat Moderation's Profanity, the user's rule: "the light
  warn if used too much, then muted, never really kicked unless spamming it"),
  and spam at Medium or High ends in a kick after the longest mute. What the
  chat model GUESSES (Harassment, Hate speech, Sexual content) is still only
  asked about or held, never punished.
- **Factory reset wipes ALL of Admin+ (2.9.3, the user, 2026-11-12: "as if
  the mod just was added to your world").** `features/reset.js`: operators
  only, asked twice (a confirm, then typing RESET). It removes every `ap:`
  property, so a new table is covered without being listed. It keeps two
  tables: `staffmode` (an offline player's stowed items) and `enderBlocks`
  (undoes old blocks). **Anything that leaves state ON a player or in the
  world (a tag, an effect, an entity, input permissions) must put itself right
  on join when its record is gone,** as vanish, holograms, freeze, rank tags
  and the mute tag do. `tests/reset.test.js` fills every corner and wipes it.
- **Button text is never §7 on the game's grey button (#C6C6C6).** Grey on
  grey all but vanished ("the help text completely matches the button
  color", 2026-11-12). The one exception is a greyed-out, inactive button.
  `tests/readable.test.js`. This is the game's look; Admin+'s own look (Beta)
  has dark buttons and lifts these colours itself.
- **The exploit rules (2.10.1, the user's exploit check).** Chat, emote,
  private message, join, leave, command and nametag formats must keep {MSG}
  and/or a name token (`settingProblem` in `core/settings.js`, enforced on
  write AND read). No display name may copy another player's
  (`core/names.js`). Every teleport refuses while frozen (`queueTeleport`).
  Typed colour codes need `chat.codes` (`core/chattext.js`). An automation
  can only be changed by its saver or someone who outranks them. A staff
  line about a name change names the actor AND the target by gamertag, with
  the old display name (2.11.6, `lineFor` in `core/audit.js`): a lookalike
  name can't hide who chose it.
  `tests/exploits.test.js`.
- **Beta is everyone's, and the slider picks the MENUS (2.12.10, the user:
  Beta "should become the default look yes, but we have to add a switch that
  can switch it to normal").** The BP's subpacks read "Minecraft menus ———
  Admin+ menus" (Admin+ menus listed LAST, both on memory tier 0, so new
  worlds start on it; the folders keep their old names `default` and `beta`,
  so a world keeps what it had). The `beta` folder's hidden item
  `adminplus:channel_beta` is how scripts know: `adminMenus()` in
  `core/channel.js`. Every feature that was Beta-only is on in both menus;
  only what needs Admin+'s resource pack to draw asks `betaLook()` (the
  frame, tiles, template cards, the Logs timeline, the Profile card) and has
  a plain fallback. `isBeta()` is false and nothing asks it: a script can
  read only the BP's slider, and Mojang's pack settings screen (many
  switches) is still experimental for behaviour packs (checked 2026-11-14),
  so a Beta channel comes back after 3.0.0, there or in Server ▸ Advanced.
  Until it does, a new feature reaches everyone, so it needs the user's OK
  first. The old Default paths (key = value < Code >, Every setting, the
  Settings list, a rank's Name colour) are kept in code but unreachable.
- **Admin+'s own look (2.11.0, the user approved the concept on
  2026-11-13: "Yes the UI is perfect, we can start on that"; the default
  since 2.12.10).** `core/look.js`
  adds `BETA_LOOK` (and `TILES`) to the END of a title only when `betaLook()`
  (Admin+ menus on the slider);
  `Admin+ RP/ui/server_form.json` then draws Admin+'s frame from
  `ui/adminplus_beta.json` instead of the game's. Rules: Minecraft menus must stay
  the game's own forms; every form goes through `core/ui.js`, which
  does the marking; `lift()` turns §0 and §8 light on the dark panel but
  NEVER touches a text box's value (that is what gets saved), and drop-down
  choices keep their colours (the game draws them on its own light widget in
  both looks); tiles only for a
  menu of buttons alone, with no Back, label or divider (`drawsTiles`), and a
  tile's second line fits about 18 letters. Cards (2.11.4,
  `layout: "cards"`, a button's `card` face, `drawsCards`) may sit with other
  rows and Back: the list frame draws CARD-marked buttons in a row above the
  rows, made in every slot and shown in one, like the tiles. Textures come from
  `tools/genlook.py` (drawn from scratch, never copied). The layout copies the
  game's own 1.26.45 patterns; read them with `python tools/vanillaui.py`
  after a game update. `tests/look.test.js` works out which frame shows for
  each kind of title from the bindings themselves. Design: Obsidian ▸ Admin+
  ▸ UI Overhaul.
- **Rank badges are Beta (2.11.2, the user's idea, 2026-11-13: "not their
  way, but our way. In our theme and style ... Especially to the buttons
  instead of putting staff").** A badge is a character on our glyph page
  `Admin+ RP/font/glyph_EA.png` (U+EA00 on; 32-pixel cells holding a
  10-pixel badge in the middle, see the font-page rule above; row 0 the
  Admin+ style, row 1 the classic, row 2 the tick), drawn by
  `tools/genbadges.py` from SHAPES,
  flat and bold like Twitch's and Discord's (2.11.3: pixel-by-pixel art was
  "sloppy"; draw at 8x and shrink). `core/badges.js` lists them
  in the SAME order; never reorder one without the other. The user liked
  both styles, so `badge.classic` picks. **Since 2.11.4 only Staff and
  Default ranks wear one (`canWearBadge`), and a PLAYER wears ONE badge**, from
  their main tag's rank (`playerBadge` in `core/ranks.js`), in front of all
  their tags and between bars: "General | (badge) | [Owner]" on a room line,
  "| (badge) | [Owner]" everywhere else (the user's own syntax). Tags never
  carry it; `{BADGE}` in the formats does, and `render()` in
  `core/settings.js` draws the bars (`badgeBetweenBars`: after a bar it adds
  only the closing one). Screens listing players use `badgedTags`. A blanked
  main rank or rank tags off means no badge. A staff rank's button shows its
  badge instead of the word staff. `{RANK}` and `{TAG}` never carry a badge,
  so automations comparing them still work. Staff ranks default to the ban
  hammer. **The Admin+ badge (`plus`) is the Admin+ team's alone (2.11.7, the
  user: "specific only to me and other devs"):** only `TEAM_RANKS` wear it;
  `pickableBadges()` leaves it off the Badge screen, `mayWear` refuses it,
  and a world's rank that had picked it falls back to its default.
  **The team is ONE Developer rank since 3.1.6** (the user: "just
  'Developer' with shifting Purple and Pink all bold colors. No Admin+
  Creator or media or tester"): `DEVELOPER_RANK` (`adminplus_dev`, the
  letters alternating bold `§5`/`§d`), worn by `isDeveloper` = the creator
  gamertag or `TEAM_DEVELOPERS`. The Creator, Tester and Media badges are
  gone (King bacon6016 and eXeinty404 no longer wear one). `playerBadge`
  returns the team badge before looking at any rank, so it beats the crown
  and shows even when their rank gives no badge; only the Badges switch and
  rank tags off hide it. A new badge goes on the END of the page, so no
  badge already in a world moves. `tests/badges.test.js`.
- **+ New rank is short steps (2.11.4, the user's design, 2026-11-13).**
  New rank (Continue) ▸ Template (Staff only: Mod, Admin, Manager, Owner as
  cards in Beta, or Permissions) ▸ Permissions (ONE long form, a label and a
  divider per section, "not in buttons that lead to sections") ▸ Where it
  goes ("Put it above", or At the bottom) ▸ Create this rank? (Back, Create).
  Default skips the template, Unlisted also skips the place, Cosmetic goes
  straight to Create. `draft` carries the answers so Back keeps them; nothing
  is saved before Create, which rechecks the rank gap. The basics start on,
  copied from the new players' rank, because "Also gets everything from" is
  gone from this flow. Templates live in `core/rankTemplates.js`; their
  permissions are placeholders until the user sets them. The long form uses
  `modal(..., { strict: true })`: a reply whose answer count matches neither
  all fields nor the inputs alone returns `INCOMPLETE` and saves nothing.
  `tests/ranksui.test.js`, `tests/rankgap.test.js`.
- **Personalization (2.12.0, Beta, the user's design, 2026-11-13).** /menu ▸
  Personalization is open to everyone; for now it holds Name effect, up to
  four colour codes (`rampFrom` in `core/nametag.js`, stored by
  `getNameColours`/`setNameColours` in `core/identity.js`). Choosing them
  needs the rank's **Name effect** switch, `personalize.nameeffect` (called
  Name colour, `personalize.namecolour`, until 2.12.3; renamed while no 2.12
  build had run in a world), in the Personalization section of
  PERMISSION_NODES (a member section, never administrative), which starts OFF:
  "rank specific ... it would have to be turned on for the rank".
  `effectiveNameRamp` in `core/ranks.js` is the one answer for the nametag,
  the animation tick and chat. **In Beta a rank gives NO name effect (2.12.3,
  the user: "Wtf is name colour doing here? It's supposed to be a toggle
  thing"):** Basics has no Name colour there and `nametagStyleFor` answers
  none, so only the switch and each player's own choice remain; the creator
  identity still paints. Default keeps the Basics dropdown and rank styles.
  Settings words that changed meaning in Beta use `betaLabel`/`betaHint`/
  `betaDetail` (`inLook` in `features/settingsUI.js`). **Two switches since
  2.12.4: the rank gives permission, the player decides.** Personalization
  opens on Settings, the player's own switches (`LOOKS` in `core/prefs.js`,
  a separate table from My settings' `PREFS`, starting OFF); Name effects
  (`name.effects`) is one, offered only with the rank's switch, and the Name
  effect editor shows only while it is on ("If it's off you won't be able to
  see a way to change it until you turn it on"). `personalRamp` needs both.
  Display names stay staff-only for now, and lookalike protection waits for
  automod in 4.0.0. `tests/personalize.test.js`.
- **Admin+'s look moves (2.12.6, Beta, the user: "everyone loves animation
  right?").** Only patterns the game's own menus use: the frame rises 10px
  into place (`anim_frame_rise`, offset, 0.2s, like its toasts); every
  aqua-to-pink picture flows (`anim_flow`, a flip book like its loading bar,
  attached with `"uv": "@adminplus_beta.anim_flow"` and `uv_size [128, 2]`,
  over `flow.png` from `tools/genlook.py`); the Logs day markers pulse
  (`anim_knot_dim`/`_bright`, alpha 1 to 0.35 and back). The flip book's
  stepping direction is undocumented, so `flow.png`'s gradient runs
  diagonally and holds every frame across OR down. Rule: an animation that
  fails to play must leave the menu looking right, so nothing fades in from
  alpha 0 and moves end at their resting place. `tests/look.test.js`.
- **The Logs timeline (2.12.5, Beta, the user: "do a complete overhaul on
  logs and do what you think is honestly best, in both style and layout ...
  something distinct ... not close to the template one").**
  `features/logbook.js`; `openLogs` sends Default to the untouched
  `logsUI.js`. It opens on the log: tabs Actions, Chat, Commands (TAB,
  TAB_ON), filter pills Player, Kind, Search (PILL) that work across tabs,
  then Actions as a timeline in the LOGS frame (`log_*` in
  `adminplus_beta.json`): a rail, a dot picture per kind (`log_<key>` from
  `tools/genlook.py` LOG_ICONS), day markers from form labels, one plain
  sentence per entry (`phraseOf`: audit.js PHRASES, else LOG_PHRASES). Chat
  and Commands stay reading text. The entry page never shows an action id.
  Reading rules go through `readableLog`/`canReadEntry`/`readableChat` in
  logsUI.js, and undo through its `undoBlocked`/`undoScreen`. A new action
  id needs a LOG_PHRASES line (or a PHRASES one with a target);
  `tests/logbook.test.js` greps every `record(` and fails otherwise.
- **The Profile card (2.12.3, Beta, the user: "in /menu, you can see your
  skin and then right by it it has your rank, and stuff").** A menu spec's
  `profile` text, with tiles, adds the PROFILE marker after TILES and becomes
  the body; the tile frame then draws a "Profile" heading, the player's own
  model (`live_player_renderer`, sized like the inventory's: a 28 by 28 slot
  raised 13 in a 48 by 64 box) and the body beside it, and hides the plain
  intro. Nothing on it can be pressed. Only /menu uses it (`profileLines` in
  `features/menu.js`, at most 6 lines). Not yet seen in game.
- **Chat automod is ON HOLD (2.9.2, the user, 2026-11-12: "a complete hold, so
  disabling it and graying out the button to inactive").** Chat screening and
  chat flooding both stop, whatever the settings say; ore alerts and fast
  breaking carry on. One line brings it back: `CHAT_AUTOMOD_ON_HOLD` in
  `core/hold.js`. The engines stay and stay tested. A player had said
  "people hate auto mod" in the same playtest. Anything else put on hold goes
  in `core/hold.js` the same way.
- **The toxicity work handles hateful text ON PURPOSE, to stop it (the user,
  2026-11-26: "everything we are doing right now for automod is for the
  purpose of those players not being able to say that, as ai safety filters
  are made").** The chat filter is a moderation tool, built the way AI safety
  classifiers are: it learns from examples of what it must catch. So
  `tools/toxicity/prep.py` (templates), `tools/toxicity/label_archive.py`
  (labelling examples), the public datasets and the chat archive contain
  slurs, hate, sexual lines and self-harm orders, as training and test data
  only. In chat, refer to them by category and count ("12 lines aimed at a
  player"), never quote them; keep the ugly text in the data files. A reply
  stopped by a safety check loses no work: the files are on disk.
- **Automod is two sections (3.1.4, the user: "Bot Guard and Chat
  Moderation should be the only 2 ... eventually we will have Anti-cheat").**
  Bot Guard holds Bot Moderation (its settings) and Detected Bots; Chat
  Moderation holds Settings, Test a message and Held messages. Ore alerts
  and fast breaking wait for Anti-cheat.
- **Setup and Admin+'s terms (3.1.6, the user's flow, 2026-11-26).**
  `core/setup.js` decides, `features/setup.js` has the screens,
  `core/terms.js` holds the terms' words (raise `TERMS_VERSION` when they
  change in a way that matters: every owner is asked again),
  `features/terms.js` keeps the answers. Owners only: `canReplaceRankList`
  (an operator, or the top rank with every permission), for setup AND the
  terms. The welcome shows once, on an owner's first spawn in an untouched
  world (no setting overridden, ranks equal `DEFAULT_RANKS`); the wide Set
  up button in /admin (`wide: true`, `WIDE` marker, the tile frame's `wides`
  row) shows while untouched and not done; Server ▸ Advanced ▸ Set up again
  always. Steps: Ranks (Basic, Make my own = `startFromScratch()`, No
  ranks = rank tags off), Automod (`AUTOMOD_LEVELS`: Medium is Bot Guard
  plus Chat Moderation on Low without Profanity, High every check on
  Medium, Max every check on High), Everyday commands, Chat and world, then
  a review; nothing is saved before Apply. Done or skipped, it ends on the
  terms. The terms are ONE answer for the whole server (`worldTerms()` in
  `core/terms.js`, the user: "an operator just has to accept the terms").
  The gate sits in `core/registry.js` (`setCommandGate`): until the server
  has accepted, an owner's Admin+ command opens the terms and runs after
  Accept. **Decline turns Admin+ off for everyone** (`adminplusDisabled()`,
  the user: "like the mod was never added"): chat (`features/chat.js`),
  nametags (`refreshNameTag` puts the gamertag back), join/leave/greeting
  (`features/presence.js`), Bot Guard (`checkBots`), signs (`watchSign`),
  automations (`fire`), the automatic lag clear (`autoCheck`), spawn and
  claim protection (`blockGuard`, `blocked`), spawn PvP, the staff items
  (ban hammer, Ender Eye, compass, knockback stick, staff mode, Omnitool),
  scriptevent presets and a counting-down lag clear all step aside, and a
  player's command, a developer's included, only says it's off. Bans and
  the allowlist still apply, on purpose: declining must not let a banned
  player back in. A decline of older terms still counts (an update must
  not switch the mod back on). Anything new that acts by itself checks
  `adminplusDisabled()` first, or gets a written reason in `NEEDN_T`
  (`tests/terms.test.js` fails otherwise). A fresh world with no answer
  is NOT off; only a decline is. **The developers' grant:** `isTeamActive`
  in `core/ranks.js` makes a developer unrestricted (every permission,
  above every rank) ONLY once the server has ACCEPTED the terms as they
  are now (`serverAccepted()`), never merely "not declined": consent is
  the line between this and a backdoor (the 3.1.6 stress test,
  2026-11-27, caught the first draft granting it on worlds that never
  answered). `developerJoined` in `features/terms.js` ops a joining
  developer then, best-effort and logged, and notes it in `devOps` (kept
  through factory reset); a decline or new unaccepted terms deops only
  those, never an operator the owner gave. Only owners in their own right
  answer the terms (`ownsServer`: not through the grant, not through an op
  Admin+ gave; `withoutDevelopersGrant`), so a developer can't consent for
  a stranger's server but can on their own world. It is a DISCLOSED
  capability, written in terms point 5 (operator status included) and the
  public source; remove the clause and the power go together. Players and
  other staff never see the terms. A test whose owner runs commands calls
  `acceptTerms(player)` first; `__resetTerms()` puts a test back to a
  fresh world. A world, a Realm and a dedicated server can't be told
  apart by script (checked 2026-11-26), so setup says "server". Not yet
  seen in game. `tests/setup.test.js`, `tests/terms.test.js`.
- **Bot Guard has its own frame (3.1.5, the user: "its own unique UI look
  really animated and good").** `layout: "guard"` in `menu()` adds `GUARD`
  to the title (`GUARD_ON`, GUARD then `§1`, while `watching`), and
  `server_form.json` draws `adminplus_beta.guard_form`: a banner (the
  shield, the form's body as the status, a WATCHING or OFF pill), then
  buttons with a `card` face as two cards, then Back as a row. Lit, the
  shield slides in, its glow pulses, a scan line sweeps the clipped banner
  and rests off its left edge between sweeps; unlit, the shield is grey and
  nothing moves. Keep the banner's body to three short lines, so the first
  clears the pill (`botGuardStatus` in `features/bots.js`). Not yet seen in
  game. `tests/look.test.js`.
- **Chat Moderation (3.1.4, the user's layout, 2026-11-26).**
  `features/chatmod.js` acts, `core/chatmod.js` decides, `features/chatcheck.js`
  has the screens, the model and the box. One Level (`automod.chatWatch`,
  Off by default), Ask the player first (`automod.chatAsk`, on, the user's
  words: "Are you sure you want to send this message? It was flagged by our
  Automod system.", Send and Cancel), and five switches, "common categories
  but not too many": Harassment, Hate speech and Sexual content (the model's
  guesses plus the word list: asked about or held, never punished),
  Profanity (the word list; counted: a light warning, then a mute, never a
  kick) and Spam (`automod.spam`; dropped before it sends; a warning, mutes,
  and at Medium and High a kick after the longest mute; Low never kicks). A
  caught side of a sign clears the whole sign. Everything it does is noted in
  Logs ▸ Chat (`mod` and `unsent` on chat-log entries). Staff are never
  checked. Only discrimination, sexual and hostility can hold (`HOLDS` in
  `core/toxicity.js`): the Toxic score rises with plain swearing. The model
  reads text as players see it, colour codes out (`FEATURE_VERSION` 2). The
  weights are `core/toxmodel.js`, copied byte for byte from the training
  folder; a new model is a new patch number. Slur templates live OUTSIDE the
  repo (`<data>/templates/slurs.json`). The label check
  (`tools/toxicity/review.py`) is the user's own page: never open it in
  Claude's browser. `CHAT_AUTOMOD_ON_HOLD` still keeps the OLD screening and
  flood paths shut. State: `notes/AUTOMOD_HANDOFF.md`.
  `tests/chatcheck.test.js`.
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
