# Changelog

Every version of Admin+, newest first. One section per version, written when the
version is cut rather than reconstructed afterwards.

Versions between 1.4.0 and 1.15.0 were built and played but never published one
at a time — that is why the releases page jumps. From 1.15.0 on, every version
here gets its own tag, its own release and its own build, and nothing ships
without going through `python tools/release.py`.

Releases carry a channel, and it describes how sure we are rather than how big
the change was:

| | |
|---|---|
| **alpha** | the tests pass; the engine has never seen it. GitHub pre-release. |
| **beta** | it ran in a world and did what it should. |
| **release** | it has been played by somebody who did not write it. |

Nothing is renumbered on the way up. An alpha that survives is *promoted* — same
tag, same file, only the claim about it changes.

---

## 2.0.0 — 2026-09-04

**The milestone. Everything since the last stable, consolidated.**

Between 1.7.3 and here, nineteen versions of work went up as alphas and never as
a stable release. 2.0.0 is that work, released — the first real stable in a long
time — and the point where versioning changes: from now on, patches (`2.0.x`) are
the day-to-day, a minor (`2.x.0`) is a whole new section, and a major (`x.0.0`)
is reserved for a milestone like this one.

What that body of work amounts to:

- **Bans and kicking, rebuilt on what the engine actually does.** `Player.kick()`
  turned out to be the `/kick` command underneath, reporting success it never
  checked; kicking now tries three routes — the self-kick SafeGuard uses first —
  and reports honestly which one worked. Bans match by id *or* name. Ban length
  is one slider whose last notch is permanent, gated so temp is Admin-and-up and
  permanent is Manager-and-up.
- **Staff mode (`/mm`)** — stow your inventory, take a tool bar, vanish, with a
  lossless restore and a snapshot fallback that admits when it rebuilt.
- **`/items`** — a chest picker for the Ban Hammer, a teleport compass and a
  knockback stick.
- **The troll section** — `/smite` and `/sudo` behind a `feature.troll` switch
  that ships off.
- **`/cmd`** (was `/exec`) runs the full 56-command Bedrock whitelist without op;
  **`/mode`**, **`/version`**, **`/credits`** round out the command set.
- **Storage** stopped writing defaults over worlds — the early-execution read
  failure that reset warps, ranks and bans on every rejoin for six versions.
- **`tools/release.py`** with alpha/beta/stable channels, gated on the content
  log so nothing ships stable that the engine has never run.

The per-version detail for all of it is below, unchanged.

---

## 2.0.1 — 2026-09-05

**The first version anybody actually played, and what that found.**

2.0.0 was the milestone; this is the one that survived contact. Eighteen
versions had passed their tests and none had ever run in a world. One
playthrough found two real faults, and neither was reachable by any test that
could have been written for it.

### `< Code >` opens the config, not a menu

The section used to be four buttons standing between you and the file. It opens
the file: the whole config, multi-line, scrolled and edited like any `.txt`.

Multi-line form fields were believed impossible here — that belief is why the
config had been unrolled into some forty single-line boxes. It was wrong, and
the proof had shipped in this pack since v1.1.0: the resource pack's
`server_form.json` carries a control chain ending at Minecraft's own
`multiline_text_edit_control`, the one the NPC dialogue editor uses. Nothing had
ever triggered it, because the trigger was a *printable* string. It is now an
invisible sentinel, and the original is kept working alongside it so packs
speaking the older protocol still render.

The other three buttons moved to **Settings** rather than disappearing:

- **All values** — the field-at-a-time editor. Built as a workaround for the
  belief above, kept because typed controls validate and explain in a way raw
  text does not. Both doors write the same store.
- **Config presets** — named baselines, unchanged.
- **Factory Reset** — now **operator-only**, and it checks on the way in rather
  than trusting the button that opened it.

Submitting the text replaces the whole config with what you typed, so an empty
box would quietly discard every changed value — a factory reset without the
question. A real editor makes that a single mis-stroke, so it is refused. A
*shorter* config still saves normally: deleting a line is how you set that key
back to its default.

### Fixed by playing it

- **Staff mode left you invisible after a world reload.** "Staff mode is what
  vanished you" was remembered in memory, and a reload forgets. Coming back, the
  restore never un-vanished you: infinite invisibility, night vision, still
  hidden, with only `/vanish` twice to get out. It is stored with the inventory
  snapshot now, for the same reason that snapshot exists — staff mode has to
  survive the world going away.
- **`/cmd` did not work with arguments — at all.** A Bedrock command's text
  parameter stops at the first space, so `/cmd kill @e[type=cow]` was read as a
  command plus an argument nobody asked for, and came back a syntax error. Only
  a bare one-word command ever ran.

  The command name is now a proper list the game completes for you, the way a
  vanilla command does, and arguments follow it as separate words. One
  consequence worth knowing: the list is what can be *typed* now, so the
  deliberate omissions — `op`, `kick`, `execute`, `function`, `schedule` — are
  no longer merely refused, they cannot be entered.

**Also from that session**

- **The config box types faster.** Two thirds of what you were editing was
  comments explaining each key — 7,467 characters to hold 2,065 of config. One
  heading per group is kept; the rest moved out, and Settings ▸ All values shows
  each key's explanation beside its field anyway.
- **The knockback stick is at full scale**, and is two config values rather than
  a number in the source, so you can tune it by feel. Turn it far enough and you
  will throw somebody into unloaded chunks; that is your call to make now.
- **The Locked down preset is gone.** Its ladder went in 1.19.0 because a
  lockdown is a mode a server enters, not a shape it has — the preset goes for
  the same reason. Everything it set is ordinary config, so tightening up during
  an incident is a few settings, reversibly, without renaming what your server
  is.
- **Credits lists where the pack officially lives** — CurseForge, MCPEDL and
  GitHub. The person who needs that is standing in a world somebody else
  installed this into, and a reuploaded copy cannot answer "where do updates
  come from".

## 1.26.0 — 2026-09-04

**`/items`** — grab an admin item without vanishing or opening `/admin`. It opens
the same chest-grid window `/invsee` uses, but as a picker: click a slot and the
item lands in your inventory. Three items, each shown only to a rank that may
take it:

- **Ban Hammer** — for permanent-ban holders, same as the `/mm` bar.
- **Teleport compass** — jump to a random player. Works on its own, without
  entering staff mode.
- **Knockback stick** — hit somebody and send them flying the way you're facing.

Everything is signed with the per-world serial the Ban Hammer uses, so a compass
or stick renamed on an anvil is inert. The sigil differs from the staff-mode
tools', so a `/mm` compass and an `/items` compass never trigger each other.

The knockback is *very strong*, not literally infinite — infinite throws
somebody into unloaded chunks and loses them. It applies through whichever of
three shapes the runtime supports: `applyKnockback(VectorXZ, vertical)`, the
older four-argument `applyKnockback`, or `applyImpulse` as the fallback. The
stick checks permission and rank at the moment of the hit, like the hammer, so
it goes inert if the holder loses the node.

## 1.25.0 — 2026-09-04

**`/sudo` is a troll command now, and answers to `feature.troll`.** Putting words
in somebody's mouth is a prank by definition, so it sits behind the same switch
as `/smite` — which ships **off**. It keeps its own `admin.sudo` node, so once
the troll section is on an owner still chooses who may use it.

Note for anyone updating: on a world that used `/sudo` before, it will stop
working until troll commands are turned on in Settings ▸ Troll commands. The
node did not change — the master switch over it did.

**Fixed:** a ban-hammer swing could reject silently. `swing()` became async when
`ban()` and `kick()` did, and the `system.run` that fires it was not catching
the promise — a silent failure on the one path built to log every outcome. Now
caught and traced. An audit confirmed every other `ban()`/`kick()` call site was
already awaited correctly; this was the only gap.

## 1.24.0 — 2026-09-04

**`/mode <default|developer>`** — a door onto `< Code >` with a name on it.

Developer mode was reachable only by typing `/tag @s add Dev`, which is a thing
you have to be told once and remember forever. This is the same switch, with an
enum the game tab-completes.

It grants nothing new. Any operator could already give themselves that tag —
`/tag` is vanilla and answers to operator — so `/mode` asks for operator and
then writes the tag. The gate is still "operator, deliberately", exactly as it
was: a non-op holding the Dev tag is still refused, because operator is the
other half of the lock.

It is a set, not a toggle: `/mode developer` twice leaves you in developer mode
and says so, rather than quietly dropping you out. `/mode default` is the way
back, and having an explicit word for off is why a toggle would be worse.

## 1.23.0 — 2026-09-04

**A ban now matches by id OR by name.** Admin+ keyed bans by player id alone.
Every other pack read for this — Minecraft Essentials, SafeGuard, AdminUtils —
keys them by name, and that difference is a silent failure waiting to happen:
the id is documented only as *"intended to be consistent across loads of a world
instance"*, and if it ever is not, the id lookup misses on every rejoin and the
ban quietly does nothing at all.

The id is tried first, because it is exact and survives a rename. The name is
the safety net. `unban` clears **both**, which matters more than it sounds — a
record stored under an old id would otherwise keep matching on name after being
"unbanned", turning somebody away forever with nothing in the panel to lift.

The known cost is the one every other pack accepts: somebody who takes a banned
player's name inherits their ban. That is the right way round — a ban that
over-reaches is visible and appealable; one that silently stops working is
neither.

**`/mm` is down to three items.** The bar carried six, four of them finding
their target by ray cast. Freeze, Examine, Punish and the block Inspector are
gone: each already had a command and a panel button, and a tool that duplicates
a button is one people have to learn twice. What is left has no equivalent
elsewhere:

- **Ban Hammer** — only for people allowed to ban permanently
- **Leave** — get your things back without typing
- **Teleport** — jump to somebody without picking them off a list

**`/smite` — the first troll command.** Lightning on a player, and the most
recognisable troll command there is.

The whole section answers to `feature.troll`, and it **ships off**. A pack that
arrives with troll commands live hands a new owner a way to annoy people before
they have decided they want one.

`troll.smiteFire` decides what a strike actually is. On, it spawns a real
lightning bolt — which **sets fires**. Off, it is the sound, the flash and the
damage with no bolt at all, so nothing burns and nobody's build is part of the
joke. It ships on, because that is what smite means; turn it off on a world
where the buildings matter.

## 1.22.0 — 2026-09-04

**Kicking now tries three routes, and SafeGuard's goes first.**

There is exactly one mechanism for removing a player on Bedrock — the `/kick`
command. That was established by reading four shipped addons and all 46
installed packs that import `@minecraft/server`: nobody uses anything else,
because `@minecraft/server-admin` holds the only real disconnect and exists on
dedicated servers alone. The only thing that varies between packs is **who
issues the command**, and that turns out to matter.

| | Route | Who removes whom |
|---|---|---|
| 1 | `victim.runCommand("kick @s …")` | **the player removes themselves** |
| 2 | `Player.kick(reason)` | the API method → /kick underneath |
| 3 | `dimension.runCommand('kick "name" …')` | the server removes them |

**The self-kick is first because it is the only one that changes the
relationship rather than the syntax.** As far as the command is concerned the
executor and the target are the same person — no operator is removing anybody.
That is what SafeGuard does, and it is the standing candidate for why an
admin-issued kick can leave somebody locked out until the world is relaunched
while SafeGuard's does not.

`Player.kick()` is second: it is the route confirmed on this project to leave a
player unable to rejoin *after being unbanned*. The dimension route is last
because it is the bluntest — closest to somebody simply typing the command — so
nothing reaches it until the other two have actually failed.

A route counts as working only if it neither throws nor returns
`successCount: 0`. Every attempt is logged with the route that worked and the
ones that did not, so the next playtest says plainly which mechanism removed
somebody instead of leaving it to be guessed at.

This reverses a standing rule in this project. "Never run the /kick command" was
unachievable — `Player.kick()` is that command — and it had steered the pack
onto the single route nobody else uses.

## 1.21.1 — 2026-09-04

**A ban said "removed" whether or not anybody moved.** `Player.kick()` returns a
`CommandResult` — sometimes wrapped in a promise — and the old code took that
value, attached a rejection logger, and returned `true` immediately. It never
looked at what came back. So `kicked: true` was a value the pack reported
without ever measuring it, and "banned and removed" in the log proved only that
the method existed and had not thrown.

`kick()` and `ban()` await the result now and read `successCount`. Zero means
the command ran and removed nobody, which is how a refusal actually arrives —
no throw, no rejection, just a count. A rejected promise is a failure too,
where it used to be reported as success.

**And the mechanism is now named correctly.** `Player.kick()` is undocumented —
absent from Microsoft's reference and the community mirror — so this pack had
been asserting it was a gentler, separate thing from the `/kick` command. That
was an assumption written up as a finding, and it was wrong: the CommandResult
return type says plainly that `/kick` is what runs underneath. It inherits
everything `/kick` does, lockouts included. Every comment claiming otherwise is
corrected, in `moderation.js`, `CLAUDE.md` and the tests.

Nothing here makes a kick work where it did not before. What changes is that
the pack stops claiming it did.

## 1.21.0 — 2026-09-04

**`/version`** — what this world is running, and whether it is healthy. The pack
version, the ladder shape and rank count, whether Beta APIs is on, and the one
worth having in game: **whether storage actually came back**.

That last line answers a question that was previously only answerable by opening
the content log on the host's machine — `all 24 tables read from this world`,
or `this world has no Admin+ data yet`, or a red line saying nothing will save.

**`/credits`** — the same screen as `/admin ▸ About ▸ Credits`: who built it,
what code is included and under which licence, and which techniques were learned
from whom.

Neither takes a permission node. For `/version`, the person standing in front of
a bug is often not the person who can open the panel, and "what version are you
on" is the first question anybody asks. For `/credits` the reason is stronger:
that screen is where the pack keeps its word about whose work is in it, and an
attribution nobody can reach is not an attribution.

## 1.20.0 — 2026-09-04

**`/exec` is now `/cmd`.** "exec" was a programmer's word for it. The thing on
the other side is a *command*: the list is a list of commands, the setting is
`commands.allowed`, the node is `admin.commands`. One word for one idea.

**The allowlist is the real Bedrock command set now — 56 commands, up from 26.**
Taken from the official command reference rather than from memory, which matters
in both directions: Java has commands Bedrock does not (`advancement`, `data`,
`bossbar`, `worldborder`, `team`, `item`), and a Java name sitting on this list
would look like a working entry while being a word that can never match.

Everything at Game Directors level is on it, including the ones you actually
reach for — `kill`, `clear`, `give`, `effect`, `enchant`, `gamemode`, `summon`,
`xp`, `tp` and `teleport` both, `fill`, `setblock`, `clone`, `structure`,
`tickingarea`, `damage`, `loot`, `ride`, `hud`, `fog`, `camera`, `dialogue`,
`spreadplayers`, `testfor` and the rest.

**What is deliberately off it, because the gaps are the design:**

- `kick` — the standing rule. It locks somebody out until the *host* restarts.
- `op`, `deop` — the entire point of a whitelist.
- `execute`, `function`, `scriptevent`, **`schedule`** — wrappers. Only the first
  word of a line is checked, so each of these allows anything at all behind it.
  `schedule` is new to that list: it takes a function name as an argument, which
  makes it the same hole as `function` wearing a different hat.
- `allowlist`, `changesetting`, `permission`, `reload`, `save`, `stop`,
  `transfer`, `setmaxplayers`, `wsserver`, `script`, `gametest` — dedicated-server
  administration and debug tooling.
- `help`, `list`, `me`, `tell` — anybody can already run these, so routing them
  through an operator-level door buys nothing.

Those exclusions are pinned by tests now rather than remembered, along with
"every entry is one lowercase word" and "no duplicates".

## 1.19.0 — 2026-09-04

**Banning is two tiers now, and they sit a rung apart.** In server terms: a
**temp ban is Admin and up**, a **permanent ban is Manager and up**. An Admin can
put somebody away for a week; ending an account for good belongs higher.

`admin.banperm` was on Admin in 1.18.0 — one rung too low. It is now reached only
through the `admin.*` that manager-tier ranks carry, so on every ladder it lands
exactly on Manager and above. `admin.ban` did not move.

A test walks all six ladders and asks the real permission resolver, because
these grants are mostly implicit — a Manager gets permanent bans through a
wildcard, not by naming the node. It checks the rules rather than a list of rank
ids, so a ladder added later is covered the day it is added: nobody may ban
forever without also being allowed a week, permanent ban's floor never sits
below temp ban's, and no non-staff rank has either.

**Removed: the Lockdown *ladder*.** It sat in the list of server shapes — Server,
Realm, SMP — and a lockdown is a mode a server goes into, not a shape it has.

The **Locked down server preset stays**; it now borrows the SMP ladder, which is
the same owner/staff/member shape it always installed. The old ladder expressed
"members cannot TPA" as a permission denial buried in a rank; the preset now
sets `feature.tpa` to false instead, which says it out loud and says it for
everybody — what a lockdown should mean anyway.

Worlds already running that ladder keep every rank and every holder; storage
holds the rank table itself, not a preset name. The panel will simply call it
Custom.

**Removed: `/function spear-mace`.** Applying a preset had two names for one
thing, and the function was the worse of them — one line that fired the event
anyway, and a `.mcfunction` with a single unparseable line is dropped whole and
silently. The event is the interface:

```
/scriptevent adminplus:preset <id>
```

## 1.18.0 — 2026-09-04

**The staff tools work now.** In 1.17.0 four of the six did nothing. The compass
and the clock — the two bound to `itemUse` — worked; the four bound to
`playerInteractWithEntity` and `playerInteractWithBlock` never fired. Both of
those events exist and both are stable, which is what the API reference says.
Right-clicking a *player* simply does not raise one, because a player is not an
interactable entity the way a villager is.

So every tool now hangs off `itemUse`, the event that demonstrably fires, and
finds its target by **ray cast** from where you are looking. That is better than
the original: the tools work at range, so freezing somebody no longer means
walking into them. Look at them and use it.

The block inspector keeps a second path through `playerInteractWithBlock`,
because a right-click a chest or a door swallows may never reach `itemUse` — and
those are the blocks most worth reading. Whichever fires first wins.

**The Ban Hammer moved out of the Dev screen and into staff mode.** It used to
be minted behind the Dev tag plus operator, which meant the thing that bans
people forever answered to a different question than banning people forever
does. Now it appears in the `/mm` tool bar for anybody holding the new
`admin.banperm` node, and the permission and the tool say the same thing. The
swing checks the same node — at swing time, so a hammer left in a chest goes
inert the moment the permission does.

**New node: `admin.banperm` — permanent bans.** It gates two things:

- The last notch on the ban slider. The world setting `ban.allowPermanent` is
  the *place's* policy; this node is whether *this person* may. A Mod can ban for
  a week on a world that allows permanent bans — the 8th notch just is not on
  their slider, and the label says which of the two is stopping them.
- Whether the Ban Hammer is in your bar at all.

On Admin and up by default.

## 1.17.0 — 2026-09-04

**`/mm` — staff mode.** One toggle: your inventory is put away, a tool bar takes
its place, and you vanish. `/mm` again gives everything back.

The tools, and what each one is pointed at:

| Slot | Tool | Does |
|---|---|---|
| 1 | Compass | jump to a random non-staff player |
| 2 | Packed ice | right-click a player to freeze or release them |
| 3 | Book | right-click a player to read their inventory |
| 4 | Blaze rod | right-click a player for everything you can do to them |
| 5 | Stick | right-click a block to read its type and every block state |
| 9 | Clock | leave staff mode |

They are signed the way the Ban Hammer is — vanilla items carrying this world's
serial in their lore, which players cannot set. A renamed stick does nothing.

**On not losing anybody's items.** Entering staff mode empties an inventory, so
two copies are kept and they are not the same kind of thing. The real
`ItemStack` objects are held in memory, and putting those back is lossless —
shulker contents, book pages and map data all survive because it is the same
object. A serialised description also goes into world storage as a safety net.
The snapshot is written and confirmed **before a single slot is cleared**: if
the inventory cannot be read or the copy cannot be saved, `/mm` refuses and
touches nothing.

If the world reloads while somebody is in staff mode the originals are gone, so
the fallback rebuilds from the snapshot — and it **says so** rather than handing
back a reconstruction quietly. Coming back after leaving mid-staff-mode restores
automatically on spawn.

`/mm <player>` takes somebody else *out* of staff mode — a rescue. It will not
put them in; their items would be stowed under their own name with no way for
them to know.

**Also**

- New node `admin.staffmode`, on Mod and up.
- The block inspector reads states but does not change them. Cycling them — a
  real debug stick — is possible on Bedrock via `BlockPermutation.resolve` and
  is not built yet.

## 1.16.0 — 2026-09-04

**Banning is one screen, and the length is a slider.** It used to be two: a menu
of six preset lengths, then a box for the reason. Now it asks the three
questions together — a dropdown of reasons, a box for what actually happened,
and a single slider for how long.

The slider runs 1 to 7 days, and the 8th notch is **permanent** — the longest
length rather than a separate switch, so you cannot set "3 days" and "forever"
at the same time and leave the code to pick a winner. Bedrock draws a slider as
a bare number with no way to label a notch, so the field label names the last
one.

**Added**

- **`/ban <player>`** — opens the same screen, and tab-completes the name, which
  the panel's player list cannot. It deliberately takes no length argument:
  "/ban Steve 30" is thirty of something.
- **Permanent bans toggle** (`ban.allowPermanent`, in Code ▸ Bans). Switched off,
  the slider stops at 7 days and no value sent to it can produce a permanent ban
  — not the 8th notch, not a number past it.

## 1.15.0 — 2026-09-03

**Vanilla commands are a whitelist now.** `commands.allowed` is the single list;
anything not on it does not run through `/exec`, so `/op` cannot be reached even
by an owner. An empty list means nothing runs. `execute` and `function` are
deliberately off it — only the first word of a line is checked, so either one
would smuggle anything through behind it.

**Added**

- `/guestlist` — off means anyone may join; on means only listed names may. The
  removal is `Player.kick()`, never the `/kick` command.
- `/maintenance` — closes the world with a reason, staff excepted, so the people
  fixing it stay inside.
- One door: both checks run through a single `doorCheck()` so they can never
  disagree about who gets in.

## 1.14.0 — 2026-09-03

- Vanilla commands moved from a blocklist to an allowlist. A blocklist is a
  promise you have thought of every dangerous command; an allowlist is not.

## 1.13.1 — 2026-09-03

- **Nothing runs the `/kick` command any more.** On a local world `/kick` does
  not merely disconnect somebody — it locks them out until the *host* restarts
  the world. Moderation uses `Player.kick()` with no fallback, and `kick` is off
  the `/exec` whitelist. A kick that quietly fails is the smaller problem.

## 1.13.0 — 2026-09-03

- `/exec` — run whitelisted vanilla commands at operator level without holding
  operator. `dimension.runCommand()` is operator-level regardless of who asked,
  which is the whole mechanism.
- Staff read every room. Any staff rank sees General and Staff at once;
  switching changes where you *type*, not what you read.

## 1.12.0 — 2026-09-03

- **Idle worlds do nothing.** Hologram sync was scanning entities across every
  dimension every two seconds even with zero holograms placed; vanish ran a
  per-tick loop with nobody vanished; nametags were rewritten unconditionally.
  All of it is now conditional. No behaviour changed.

## 1.11.2 — 2026-09-03

- Leaderboards showed `commands.scoreboard.players.offlinePlayerName` instead of
  a name. A scoreboard participant's `displayName` is only a name while they are
  online, so names are cached while players are present.

## 1.11.1 — 2026-09-03

- Confirmed the storage cause in the content log: `world.getDynamicProperty`
  cannot be used during early execution, which is exactly when tables are
  constructed. Every table's first read had always failed.

## 1.11.0 — 2026-09-03

- **Never write defaults over storage that could not be read.** A read that
  *threw* is not an empty world. Treating it as one had been flushing default
  tables over real ones — warps, ranks, bans and settings reset on rejoin, for
  six versions, silently. Reads now report `{ok, value}`, and a seed is only
  committed once a read has actually succeeded.

## 1.10.3 — 2026-09-03

- The startup line reports the whole storage layer, not just ranks, so "did the
  world remember" is answerable without guessing.

## 1.10.2 — 2026-09-03

- A table that started from its seed re-reads on the first tick and adopts
  whatever storage really holds. This closed the common case of the reset bug;
  the remaining one — a second read that also failed — was closed in 1.11.0.

## 1.10.1 — 2026-09-03

- Switching server preset no longer erases ranks the new ladder does not define.
  Ids the incoming preset lacks are kept dormant and come back when you switch
  back.

## 1.10.0 — 2026-09-03

- Operator-only blocks, without operator. Nothing can exempt anyone from a
  vanilla Deny block — `beforeEvents` can only add restrictions, never remove
  them — so this is script-side protection instead.

## 1.9.0 — 2026-09-03

- Mod-tier ranks can set game modes.

## 1.8.1 — 2026-09-03

- Staff ranks always take the nametag; cosmetic ranks sit after them.
- Two fixes to the chat line added in 1.8.0.

## 1.8.0 — 2026-09-03

- `/praccept` and `/prdeny` for private chat invitations.
- A private chat's header says who it is between.

## 1.7.4 — 2026-09-03

- **Holograms and leaderboards were never renderable.** The resource pack had no
  client entity, so Bedrock drew nothing at all — no model, no nametag — while
  every script call reported success. They had been invisible since the day they
  were written.

## 1.7.3 — 2026-09-03

- Plainer error messages throughout. "You can't warn yourself" instead of
  something written to be charming.

## 1.7.2 — 2026-09-03

- Verification pass: private chat was imported but never installed, so `/prchat`
  did not exist. A permission node nobody could hold was removed. `verify.py`
  now fails on both shapes of that mistake.

## 1.7.1 — 2026-09-03

- Two TPA requests arriving at once no longer make it impossible to accept one
  and deny the other — you are asked which.

## 1.7.0 — 2026-09-03

- `/pm` and `/r` for private messages, `/socialspy` for staff, and `/prchat`
  two-person private sessions with `/prexit`.

## 1.6.0 — 2026-09-03

- `/mutechat` per channel or across all of them, announced by name.
- `/emote` — vanilla owns `/me`, so the name had to differ.

## 1.5.0 — 2026-09-03

- `/warn` with add and remove.
- `/report` rebuilt form-first: pick a player, pick a reason, say what happened.
- `/nick` for admins.

## 1.4.0 — 2026-09-03

- A Creator badge for the pack's author, shown until a real rank replaces it —
  so you can tell at a glance whether the person who wrote this just joined your
  world.
- Preset ladder ordering: development tiers sit above management.

## 1.3.0 — 2026-09-03

- Preset ladders gained an extra development tier.

## 1.2.0 — 2026-09-03

- Audit covers every operator-style act, not only the panel button for it. Using
  a command instead of the panel is no longer a way to act unlogged.

## 1.1.2 — 2026-09-02

- Staff action lines read as sentences — "Set Steve's game mode to creative" —
  instead of one template applied to everything.

## 1.1.1 — 2026-09-02

- The in-game credits no longer claim nothing was included.

## 1.1.0 — 2026-09-02

First public release. Ranks and permissions, the `/admin` panel, chat channels,
warps, moderation with a ban hammer, vanish, freeze, `/invsee`, `/sudo`, TPA,
holograms and leaderboards, automod alerts, and an audit log.
