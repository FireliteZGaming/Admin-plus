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
## 2.6.0 — 2026-09-12

**Chat screening, in the shape of Twitch's AutoMod.** A minor, because it is a
whole section behind its own switch with its own settings group and its own
screen — not one feature.

Four categories, each with its own sensitivity: **discrimination, sexual
content, hostility, profanity**. A flagged message is **held for a moderator**
at `/admin ▸ Held messages` — approve and it posts where it was going, deny and
it is dropped.

### What was taken from Twitch, and it is the good part

**The message is held, not punished, and the sender is never told.** They see
their own line echoed back as if it posted. That is the cleverest part of
Twitch's design: a troll who cannot see which words were stopped has nothing to
iterate against. It also means a false positive costs a moderator one tap
rather than costing an innocent player ten minutes.

It keeps faith with the rule this pack already had — automod punishes what it
**counts** (flooding) and only ever alerts on what it **guesses**. A term filter
is a guess, so it holds.

### What was NOT taken, because we cannot

Twitch's AutoMod is a machine-learning classifier: it scores a message and reads
context, which is why "I hate this block" survives where the same words aimed at
a person do not. **Scripts here have no network at all** — `@minecraft/server-net`
is dedicated-server only — so this matches TERMS. It cannot read intent and does
not pretend to.

### Evasion, and the thing that will misfire

Both the message and the term list are folded the same way: case, zero-width
characters, Cyrillic lookalikes, then leet (`sh1t`, `b4d`) and stutter
(`fuuuuck`) at level 2, and every separator removed at level 3 (`f.u.c.k`).

Which brings the Scunthorpe problem. **Levels 1 and 2 match whole words** for
exactly that reason; only level 3 looks inside them, and it comes with an allow
list. Allowed words are *removed from the message* before matching rather than
consulted — the first version excused every occurrence in the line, so typing
one innocent word bought you the real one for free. Its own test caught that.

### Choices worth knowing

- **Discrimination ships with no terms at all.** A slur list belongs to a
  community and a language, and this pack will not pick yours. Fill in
  `Terms: discrimination` and it works; leave it and that category catches
  nothing. Honest, where a token list pretending to cover the subject would not
  be.
- **Profanity ships OFF.** Holding every "shit" buries the queue, and the queue
  only works if somebody can face reading it.
- **Staff bypass by default**, as Twitch exempts its moderators.
- **It can act, not only flag.** `What a flagged message costs` takes
  `hold` / `warn` / `mute`. Hold is the default and the message is held
  whichever you pick — punishing never replaces the queue, because a false
  positive has to stay undoable.
- Approve and deny are **never announced**. An audit line saying "X denied your
  message" would tell the sender they were filtered and undo the whole design.

## 2.5.15 — 2026-09-12

**What people write on signs is in the log now.** Asked for directly, and it
closes a real gap: chat is logged, names are logged, commands are logged — and
sign text, the one thing a player can put in front of everyone permanently, was
invisible to any staff member who was not standing there when it went up.

`/admin ▸ Logs ▸ Signs`, with the text, who wrote it, and coordinates to walk to.

### Bedrock has no sign-edited event, so this is a watch

A sign is placed **blank** and the words arrive afterwards, typed into a
client-side screen no script can see, with no callback when it closes. Checked
against all 40+ behaviour packs installed here: not one sign-specific event
between them, and the only pack that reads sign text does it on
`playerInteractWithBlock` — which answers "somebody touched a sign", a different
question entirely.

So the block is watched and read back, at 2, 5, 10 and 20 seconds. Repeated
looks because there is no signal for when somebody stops typing, and it is one
component read on one block.

- **Two entries, not one.** `sign.written` for a fresh sign; `sign.edited` for
  an existing one changed, which carries the old text too — a place-only hook
  would have missed editing somebody else's sign entirely, and that is the more
  suspicious case.
- **Blank signs are never recorded**, and merely reading a sign records nothing.
- **`§` codes are stripped.** Hiding a word behind `§0` on a black sign is
  exactly the trick this exists to catch, and a stray `§` would repaint the log
  line around it besides.
- **Recorded, never announced.** A survival world writes signs constantly, for
  shops and labels and directions; announcing each one would bury staff chat in
  furniture. The log is the record.
- Switched off with **Log what is written on signs**. The watch list is capped
  at 64, so a sign farm cannot grow it without end.

## 2.5.14 — 2026-09-12

**`< Code >` refused an edit and explained nothing.** Reported from a world:
changing `{NICKNAME}` to `{NAME}` came back as *"That came back with no config
in it — nothing was saved."*

The guard was right and the config was never at risk — that message exists so a
mangled document cannot silently factory-reset every setting. What it did not
say is the one thing worth knowing: **this screen is only a multi-line editor
because the RESOURCE pack overrides the form.** Without the RP on — a world
running only the behaviour pack, for instance — it falls back to a plain
one-line box, and a sixty-line document does not survive that.

The refusal now says so, and points at `Settings ▸ All values`, which edits the
same keys one field at a time and needs no resource pack at all.

## 2.5.13 — 2026-09-12

**The player picker is back on the moderation commands.** Asked for directly:
*"put player selectors for mute, warn and those things so people can actually
use them."*

Typing `/mute ` pops the game's own list of online players again, so a
moderator picks a gamertag instead of spelling one — which is the half of the
picker that was actually worth having.

It is an **opt-in**, not a revert. 2.5.12 fixed `@` targeting across 23
commands by handing Bedrock plain text; going back on that wholesale would
re-break `/vanish @s` the day after it was reported. So `picker: true` on a
spec keeps the real selector type, and everything else keeps the working one.

- **With the picker:** `/mute`, `/ban`, `/unmute`, `/warn`, `/warnings`.
- **Without it, still resolving `@` forms:** `/vanish`, `/invsee`, `/tpa`,
  `/sudo`, `/nick`, `/gm`, `/grant`, `/smite` and the rest.
- The trade, stated plainly: on those five, `@a` and `@p` go back to being
  refused by the engine. A name — typed or chosen from the list — works, which
  is what those commands are for. `/mute @a` is not something anybody needs.
- **The console is unaffected.** It reads the original spec and never goes
  through the engine, so `mute @a 5m spam` still works there on all five.
- The test lists the five by name, so a command cannot join them quietly —
  anything that appears with a selector without being added on purpose is the
  old bug coming back.

## 2.5.12 — 2026-09-12

Two reports from a world, and the second one was caused by an earlier fix.

### `@s` was refused by every command that takes a player

Reported as *"/vanish doesn't work"* — and it is `/vanish @s` that fails, not
`/vanish`. A parameter registered as `PlayerSelector` or `EntitySelector` is
expanded by the ENGINE at the command's declared permission level, and this
pack declares `Any` for everything on purpose, because Admin+ exists to be
usable without operator. So every `@` form was refused before the handler ran.

`/tp` was fixed at its call site in 2.1.21 and the 54 vanilla passthroughs in
theirs. main.js said out loud that roughly two dozen of the pack's own commands
were still wrong, and listed them. This is those: **23 registrations across 14
files** — `/ban`, `/mute`, `/warn`, `/nick`, `/invsee`, `/sudo`, `/tpa`,
`/smite`, `/gm`, `/grant`, `/vanish` and the rest.

- Fixed **once, in `core/registry.js`**, not in 23 handlers: a selector
  parameter is handed to Bedrock as text and resolved back to entities before
  the handler is called. Every handler is untouched, and a new command cannot
  reintroduce the bug by declaring the type that looks right.
- It looked random for months because the two commonest cases are the two that
  worked: a literal name, and leaving an optional argument off.
- **`system.beforeEvents.startup` was a no-op in the test stub**, so the
  registry's entire engine-facing half had never been executed by a test. That
  is exactly where this lived. It now runs against a recording registry, and
  `tests/registry.test.js` asserts that no command hands Bedrock a selector —
  reading the REGISTRATION, not the source text, because the specs still say
  `PlayerSelector` and translating them is the point.

### The leave line lost its yellow

`§r` resets to WHITE, not to what the format string had. Ending a styled
nickname with `§r` — which 2.1.25 added so a name could not repaint the words
after it — therefore wiped the line's own colour too: `§e{NICKNAME} left the
game` rendered the name, then everything after it in white.

Both things have to be true at once, so `render()` now follows a styled value
with the formatting **the template itself was in at that point** rather than a
bare reset. A colour clears styles and a style stacks on the colour, as
Minecraft does it, so `§e§l` comes back as both. Uncoloured templates are
unchanged.

## 2.5.11 — 2026-09-12

**"What is it inherited from? Literally nothing."** Reported from a world, and
exactly right. The permission editor showed Manager as having ban *"inherited"*
while its Inherits list was empty.

`rankState` asked "does this rank say so itself" with an exact string match, so
`admin.*` — sitting in Manager's OWN perms — missed it, fell through to the
flattened own-plus-inherited list, matched `admin.ban` there, and got reported
as inherited. Clearing inheritance changed nothing, because inheritance was
never what granted it. **The permissions themselves were right the whole time;
the screen explaining them was not**, which is the worse of the two to get
wrong — a wrong answer you can check, a wrong explanation sends you hunting.

- New state `wildcard`, separate from `inherited`, and the screen now names the
  source either way: *"has it already, from its own admin.\*"* or *"inherited
  from Admin"* or *"denied by Admin"*.
- `rankGrant(rank, node)` returns `{ state, via }` — the pattern for a wildcard,
  the rank object for anything inherited. `rankState` is now a wrapper on it.
- Both sides are **scored** rather than own-first-wins, so an ancestor's exact
  `-admin.ban` still beats this rank's broad `admin.*` — the screen and `has()`
  must never diverge, and a test now pins them equal on that exact case.
- The old test asserted a wildcard grant was `"inherited"`, which is how this
  survived. Its own comment named the two as different things in the line above.

## 2.5.10 — 2026-09-12

**A second rank was invisible everywhere.** Reported from a world: a rank was
granted, the grant said so, the receipt said so, and the chat line still read
`[Owner] FireliteZGaming` with no sign of it. From the outside that looks like
the grant silently failed.

Ranks have stacked since 2.1.14, and `displayRanks` has returned all of them in
the right order ever since — staff first, then whatever order the holder chose.
But every surface that drew a tag called `primaryRank`, which is literally
`displayRanks()[0]`. The list was built correctly and then thrown away at the
last step, in all six places independently.

- `{TAG}` is now the whole badge — `[Owner][Elytra Mace]` — in chat, on the
  nametag above the head, in private messages, and in the panel's player lists.
- `{RANK}` still means the single primary rank's name, for anyone formatting
  without brackets.
- **Staff always leads**, whatever order the ranks were granted in. That rule
  already existed and this is the first thing able to show it.
- New setting **How many rank tags show**, default 3. `1` is exactly the old
  behaviour; `0` shows every rank they hold. The cap exists because "twenty
  cosmetic tags on a PvP ladder" is a real shape, and twenty of them in a chat
  line is unreadable.
- A rank whose name has been blanked still disappears (the 2.5.2 fix) without
  taking the tags beside it with it.

## 2.5.9 — 2026-09-12

**Nothing ever told anybody that `/info` existed.**

`/info` is written for the ten-year-old who joined a realm, saw a coloured tag
next to their name and wanted to know what was going on — and the only way to
find it was to already know it was there. Same hole `/eff` had in 2.5.7, one
level up: the help was fine, the pointer was missing.

- A newcomer now gets one line a few seconds after they join, **sent to them
  and nobody else** — broadcasting it would make every join cost everyone a
  line, which is how a good idea becomes spam.
- Three seconds late on purpose. The join line, the world's own messages and
  everything else that fires on spawn arrive together, and a line inside that
  burst is a line nobody reads.
- `Point newcomers at /info` switches it off; `Greeting line` rewrites it, with
  `{NAME}` and `{NICKNAME}` like the join and leave lines. Blanking the text
  also silences it, so a realm with its own welcome system does not have to go
  looking for the switch.

## 2.5.8 — 2026-09-12

**The orbital strike went off too high, and the reason was arithmetic.**
Reported from a world: it "only skins the surface".

A primed TNT's fuse is 80 ticks and Bedrock gives no way to set it, so the drop
height is not a look — it IS the timing, and it is the only say anyone has over
where a shell detonates. The height was 78 blocks. A falling entity accelerates
0.04 b/t against 0.98 drag, so 78 blocks takes **79 ticks**: the shells were
going off at the instant they arrived, or a shade before. That is a surface
burst.

- Drop height **78 → 68**, which lands them with about seven ticks of fuse
  left, so they are sitting ON the ground when they go.
- The fall is now modelled rather than guessed: `fallTicks(blocks)` and
  `TNT_FUSE` live in `core/orbital.js`, and the test asserts the MARGIN between
  them — that the shells land with fuse to spare, but not so much you could
  walk away — instead of pinning the number 68, which would only prove nobody
  had changed it.
- One constant, `DROP_HEIGHT`, behind both places that used to carry 78. The
  `Orbital strike: drop height` setting still overrides it, and its help now
  says where the airburst line is.

## 2.5.7 — 2026-09-12

**`/eff` told nobody how to use it.** The target box was blank, offered nothing,
and `<targets: string>` is not a hint. Now `me` works, and so do five other
words anybody would guess.

### The hole this fell through

Selectors stopped being offered as you type when the pack moved them to
`String`, and that was forced: a parameter registered as `EntitySelector` is
expanded **by the engine** at the command's declared permission level, and every
`@` form is refused at `Any` — which is where this pack registers, because the
whole point is power without operator. A picker that offers five selectors and
refuses all five is worse than one that offers none.

What it left behind was a blank box. The vocabulary went into the command
*description*, which is read while you are picking the command and gone by the
time you are filling it in. So for anybody who had never typed an `@`, `/eff`
was unusable and said nothing about why.

### Words, and each one is a selector written out

    /eff me speed
    /eff everyone night_vision
    /slay mobs

| word | is | means |
|---|---|---|
| `me` `self` `myself` | `@s` | you |
| `everyone` `all` `everybody` | `@a` | every player |
| `nearest` `closest` | `@p` | whoever is standing closest |
| `random` `anyone` | `@r` | one player, out of a hat |
| `mobs` `entities` `everything` | `@e` | every creature, players included |

No new capability: each word *is* one selector, so there is one behaviour to
explain and one to test, and somebody who learns `@s` later finds it already
works. Names and nicknames work as they always did, and `@e[type=cow,r=10]` with
every filter is untouched.

The words **beat** a player carrying one, deliberately: `me` has to mean me
every time or it is not worth teaching. `me` cannot collide at all — a gamertag
is at least three characters — and somebody actually named `Random` is still
reachable as `@a[name=Random]`.

### Three surfaces that can still say it

- **The parameter name**, which is the only thing on screen while you type the
  argument: `<targets_or_me: string>`. All 54 passthroughs and `/tp`.
- **The description**, reordered to lead with the plain words instead of
  `@s @p @r` — a description is cut off on the right, so whatever leads it is
  the part everybody sees.
- **A failed target**, which now points at the words rather than only refusing.
  Same in the creator console.

`/info ▸ Commands ▸ Who a command aims at` explains all of it in the same
plain-English register as the rest of that screen.

### The console stops leaking a registration detail

Bedrock links an Enum parameter to its values **by name**, so the parameter is
literally called `a:effect`. The console printed that at somebody who had just
typed a command wrong. The namespace comes off now.

### The test stub had never applied a single query option

`getPlayers` was `() => [...players]` — every `EntityQueryOptions` thrown away.
That is not a harmless simplification: `core/selector.js` exists to turn
`@e[type=cow,r=10]` into those options, so the stub agreed with any filter at
all and the whole translation went untested. `@a[name=Steve]` returned the
world. It now applies type, name, tags, gamemode, distance, `closest` and
`farthest`, and deliberately does **not** fake families — a test asking about a
family should fail to find one rather than be quietly told yes.

Two other tests were quietly passing for the wrong reason and are fixed: the
selector-to-`String` check read the source text rather than the registrations,
so rearranging the code broke it while the behaviour was fine; and the console's
"a name works too" used a stand-in named `Me`, which is a reserved word now.

40 suites, 2228 assertions.

## 2.5.6 — 2026-09-12

**The trident strikes mobs properly, and says what it did.** Plus a much bigger
orbital strike.

### Armour on mobs

The playtest said the trident did nothing to mobs. It turned out damage *was*
landing — only the armour break was missing — which makes it the commonest
possible cause: **most mobs are not wearing any.**

That is the real bug, and it is not in the breaking. It is that "nothing
happened" and "they had no armour" look identical from across a field, and so
does "they died before the three seconds were up". The strike now says which:

    Shattered 4 pieces of Zombie's armour.
    Zombie had no armour to break.
    Zombie didn't survive the three seconds.

### Three ways in, deduped

While chasing the wrong cause I moved the hit onto `entityHurt`. Keeping only
that would have been a **regression**: it needs damage to have been dealt, so an
invulnerable or creative-mode target would never storm.

So all three are subscribed — `projectileHitEntity`, `entityHurt`, and
`projectileHitBlock` for a trident that lands in the dirt — and whichever
arrives first wins. The others find the strike already spent, which is what the
`ap:spectral_spent` tag is for. It also stops a Loyalty trident starting a
second storm on its way back through somebody already at half a heart.

### A much bigger strike

| | was | now |
|---|---|---|
| TNT | 200 | **320** |
| spiral width | 22 | **48** blocks (96 across) |
| turns | 2.5 | **3** |
| drop height | 62 | **78** |
| aim range | 160 | **300** |

All still tunable in `< Code >` under Orbital strike. If 320 shells stutter the
realm, `nuke.tnt` is the dial.

### The stub was lying about addTag

`addTag` returned the Set it added to — always truthy — so "have I already done
this to you?" answered yes every time. That is exactly what a once-per-throw
guard asks, and it passed while guarding nothing. It returns true only for a new
tag now, the way the real API does.

## 2.5.5 — 2026-09-12

**The trident works, and the orbital strike is real TNT now.** Both from
playtest reports, and the first one was the more useful.

### The trident did nothing at all

Not a missing trail and a missing storm — **one failure**. If the tag never
lands on the thrown entity, the hit handler sees an ordinary trident and every
downstream thing is correctly skipped. No trail, no storm, no error.

It hung on **two events firing**: `itemReleaseUse` to notice the throw, and
`entitySpawn` to catch the entity it made. Which of the four use-events a
trident raises is undocumented — `itemReleaseUse` is the least used of them
across the 74 packs installed here, six against twenty-one for `itemStopUse` —
and whether `entitySpawn` fires for a projectile was a second guess stacked on
the first.

**Neither is used now.** The tick loop already ran every tick for the storms; it
also watches who is *holding* one, and adopts any thrown trident that turns up
beside somebody who was. Every step is a poll, so no event has to fire for any
of it.

The old test passed the whole time, because **it fired those events itself** —
testing that the handlers worked, never that anything would call them. The loop
body is exported and driven directly now, which is what would have caught this.

### The orbital strike drops TNT

The first version was a handful of `createExplosion` calls: an effect that
*looked* like a strike. The real thing is hundreds of primed TNT hanging in the
sky in a spiral, coming down together — and you can watch them fall. No number
of scripted blasts gets there.

Around two hundred shells, five arms, winding two and a half turns out to
twenty-two blocks, dropped from sixty-two up. **That height is the timing:**
nothing in Bedrock can set a TNT fuse, so the fall is what lines them up to
land as one detonation rather than a shower of airbursts.

Density is at the centre, which is what the reference looks like — `r` grows
linearly with the step so the inner and outer halves hold the same *number* of
shells while the inner half is a quarter of the area. Using `sqrt(t)` would even
that out and draw a flat disc instead of a galaxy.

Spawning is spread across ticks, because hundreds of entities in one tick is how
a server stutters. And the route is not assumed: `spawnEntity` is tried first
and `summon` second, with the winner logged — nothing installed here spawns
primed TNT from script, so it was not something to take on faith.

**Block damage still decides, but it now picks which strike you get.** TNT
cannot be told not to break things, so a server that wants the sound and the
fear without the hole keeps the scripted version.

Found while testing: `arms: 0` in config produced an empty spiral and therefore
**no TNT at all** — one mis-typed setting silently disarming the whole thing.
Clamped, so a bad number gives a plain strike and never none.

## 2.5.4 — 2026-09-12

**`/info`, and gating you can actually follow.**

### /info

Written for somebody who has never used a mod — the ten-year-old who joined a
realm, saw a coloured tag next to their name and wanted to know what was going
on. Three rules for every line of it:

- **Say what it does, not what it is.** Not "a permission node gating the
  teleport subsystem" — *"lets you go to people"*.
- **Show, don't describe.** Every command comes with a real example that works
  if you type it.
- **Only what they can use.** A member reading a list of staff commands learns
  nothing except that the mod is not for them. What staff *can do* gets its own
  page — including how to report one who is misusing it — and the detail appears
  only when you can actually use it.

Five pages: the commands you can use, what a rank is, how chat works, the staff
(either "here are yours" or "here is what to expect"), and what this mod is.

### Every lock, at once

The Orbital Strike has three, and it reported them **one per attempt**. You were
told it was not armed, armed it, and were then told about developer mode — a
second errand you could have run at the same time if anybody had said so.

Locked items now list everything outstanding, in the words the rank editor puts
on the button:

```
Orbital Strike
  Needs Ranks ▸ Staff tools ▸ troll
  Turn on developer mode — /mode developer
  Arm it — type toggle nuke in /menu ▸ Console
```

`whereToGrant()` derives that path from `nodeLabels`, the same function the
editor uses, so a message can never name a switch that does not exist under that
name. A test walks every node in every group and checks the two agree.

The Orbital stays the one thing an operator cannot casually reach — that is the
point of it — but the route in is now written down rather than discovered one
refusal at a time.

### Staff mode without vanish

`/mm` is three things at once: your things put away, your tools to hand, and you
out of sight. It demanded all three or nothing, so a rank holding
`admin.staffmode` but **not** `admin.vanish` went invisible anyway — and that is
the one part somebody might deliberately withhold, because a moderator you want
*visible* while they work is a real thing to want.

The first two happen regardless; the third is asked for. And it says so, because
silently not vanishing looks like a bug. Leaving still only un-vanishes people
staff mode vanished, which matters more now that some never were.

## 2.5.3 — 2026-09-12

**One switch for troll tools, and the chest stops hiding things.** Found by
opening `/items` as an operator and seeing three of seven, bunched in a clump.

### The world switch is gone

`feature.troll` was a second gate beside the rank node, and it was the wrong
shape twice over.

It confused exactly the person it was meant to protect. `has()` lets an operator
through any rank node, so the ladder half passed and the world half failed —
**silently**. The four missing items did not look switched off, they looked like
they did not exist, and the switch that would have brought them back was not in
that window.

And it asked a question the ranks already answer. *"Does this world have troll
tools"* is not separate from *"which ranks may use them"*: a world that wants
none gives the node to nobody. Same decision, made once, in the place people
already go to decide who may do what.

So there is one switch: **`admin.troll`**, in Settings ▸ Ranks ▸ the rank ▸ Staff
tools. No shipped preset grants it, so out of the box troll tools reach owners
and operators only — the same protection the old default-off switch gave.

`/sudo` came along too. It had **its own `admin.sudo` node** on the theory that
an owner might hand out troll tools while withholding that one — a distinction
nobody asked for, guarding a hypothetical, and a second thing to find and
understand for no gain. It answers to `admin.troll` now, and the dead node is
out of the node list, the bundles, and the two shipped ladders that granted it.
(That last one touches the presets, which are normally left alone — but a grant
for a node nothing checks is a lie in a list people read.)

### The chest shows everything, and says why

Leaving out what you cannot take read as *"there are three admin items"* — a
statement about the pack, and false. Locked rows now appear greyed with the
reason on them, and the reason names the switch rather than the symptom, because
the point of showing a locked row is that you can go and unlock it. The check is
re-asked when you tap, so a window left open is not a way in.

### And they are spread out

Seven in one nine-wide row had to sit shoulder to shoulder. They are on **two
rows** now, grouped by what the thing is and spaced two apart:

```
. . H . T . E . .      hammer · teleport · eye
. O . T . K . M .      orbital · trident · knockback · mirror
```

The layout test asks for the rule — on a row, evenly spaced, gaps of at least
two, centred — rather than for a list of numbers, so a new item fails it for a
real reason instead of for changing a constant.

## 2.5.2 — 2026-09-11

**Blanking a rank name now actually removes the tag.** Reported on CurseForge
against the released build:

> how can i disable the chat prefixes. Like the `General | [Member]` ones. I
> tried removing the names from settings but it still shows `| []:` in dark grey

They did the reasonable thing and the pack ignored them. `renderTag` built
`[` + name + `]` whether or not there was a name to decorate, so clearing a rank
left **`§8[]`** on every line — empty brackets in dark grey, and nothing in the
settings that would take them away.

A rank whose display says nothing now renders nothing. Whitespace and bare
colour codes count as nothing too, since a half-deleted `§8` is exactly what
gets left behind.

And an **empty token takes its gap with it**, so the line does not start adrift
where the tag used to be.

**The message is never touched.** A global space-collapse was tried here first
and turned `hello     there` into `hello there` — the pack quietly editing what
somebody said. Only gaps left by empty tokens close; what a player typed
survives exactly as typed, and a test pins that.

### What is still manual

The `|` in `General | [Member]` is a literal in `format.chatChannel`, not a
token, so blanking names cannot remove it. For a plain line, set `format.chat`
and `format.chatChannel` to `{NICKNAME}§7: §r{MSG}` in **Settings ▸ All
values** — or turn **Chat channels** off in Settings ▸ Configuration, which
switches from the channel format to the plain one.

## 2.5.1 — 2026-09-11

**A guard on the version number itself**, because the rule for it was ignored
four times in one day.

CLAUDE.md has said since 2.0.0 that a **minor is a whole new SECTION behind its
own toggle** — the troll section is the archetype — and that a major is a
milestone. Everything else, which is nearly everything, is a patch: a command, a
fix, a tweak.

Today the Orbital Strike took 2.2.0 while being one item *inside* the existing
troll section. A leak fix took 2.3.0. Automod changing its mind took 2.4.0. The
console parser took 2.5.0. Each one felt big while it was being written, and
**"felt big" is not the rule.**

Those numbers stand. Nothing is tagged or pushed, and renumbering six deployed
versions to correct a digit would cost more than the digit does. What changes is
that it cannot happen by habit again: `tools/setversion.py` refuses a minor
without `--section` and a major without `--milestone`, and the refusal names the
patch you probably meant:

```
refusing 2.6.0: a MINOR is a whole new SECTION behind its
  own toggle (the troll section is the archetype) — not a feature, not a fix,
  not a policy change. Nearly everything is a patch.
  Did you mean 2.5.1?
```

A flag is a sentence you have to be willing to write down. A rule in a file is
one you can drift past.

Same shape as the other three guards this project now runs on: `check_bumped()`
refusing an unbumped deploy, the stale-count test, and the verifier refusing a
test file that never runs. The pattern is consistent enough to state plainly —
**a rule I can forget should be a tool that refuses.**

## 2.5.0 — 2026-09-11

**The console runs Admin+'s own commands now**, not just vanilla ones.

```
gm creative @a
ban Steve griefing the spawn again
tp @p
```

No `a:` prefix needed, and the pack's commands are tried first — a line that
is not one of ours falls through to the vanilla whitelist exactly as before.

### Why it could not before

`runAsServer` hands a **string** to the dimension, which is the only thing the
dimension understands. A pack command is not a string: it is a handler the
engine calls with arguments it has already parsed. From a text box, nobody has
parsed anything — so the console could reach `/kill` and never `/gm`.

`core/dispatch.js` is that parser, and it is short because it does not invent
one. The registry already records every command's typed parameter list, and
`core/selector.js` already turns selector text into entities — the one genuinely
hard conversion, and the one that took two days to get right. Everything else is
a number, a boolean or a word.

**It loosens no permission.** Each command's own `perm` is checked exactly as
the engine checks it, so the console reaches precisely what the person at the
keyboard could have typed — it just saves them the `a:`. Every run is logged and
announced to online owners, same as before.

Two touches that make it feel like a command line: the **last string parameter
swallows the rest of the line**, so `ban Steve griefing the spawn again` keeps
every word without quotes; and a selector matching nobody is an **error** rather
than an empty list, because handlers written against the engine have never had
to consider one — the engine refuses the command before calling them.

### Two test files were never being run

And one of them had been wrong for six versions because of it.

`tests/orbital.test.js` sat on disk unregistered. It went stale the moment the
troll gate was consolidated into `core/trollgate.js` in 2.2.4 — the two messages
it asserted moved — and nothing said so, **because nothing ran it**. Thirty-seven
assertions quietly guarding nothing, while every report's count looked healthy
because it was only ever counting the files that did run.

`npm test` is a hand-written `&&` chain, which is exactly what makes this
possible: adding a test file is one edit and adding it to the chain is another,
and only the first one is obvious.

`tools/verify.py` now compares the files on disk against the ones the script
names, in both directions — a file that never runs is a **problem**, and so is a
name in the script with no file behind it. Proved by unregistering one and
watching the verifier refuse.

The real count was never 2079. It is **2149**, across **40** suites.

## 2.4.5 — 2026-09-11

**Four feature switches were on no screen at all.** Asking "where do I find
this?" about the troll section turned out to be the right question, because the
answer was: nowhere.

`feature.troll` gates `/smite` and three of the seven admin items — the
Knockback stick, the Spectral Trident and the Mirror Totem — and it ships OFF.
It was reachable only through **All values** or `< Code >`, one field among
hundreds. A switch nobody can find is a section nobody can turn on, which is
worse than not having the switch.

It is on **Settings ▸ Configuration** now, with the rest. And the guard written
to stop it happening again immediately found three more in the same state:
**Private messages**, **Emotes** and **Ender chests** — all shipped, all
toggleable, none of them on a screen. All four added.

The test compares the Configuration screen against every `feature.*` key in
DEFAULTS, in both directions: a key with no row fails, and a row naming a key
that does not exist fails too, so the list cannot rot from either end.

## 2.4.4 — 2026-09-11

**The Mirror Totem joins the Spectral Trident.** Both on the troll gate now:
the same category seen from both ends — one is what you throw, the other is
what you hold when somebody throws theirs. Splitting them would have meant a
rank that can hand out the attack but not the answer to it.

It was on ' + chr(96) + 'admin.staffmode' + chr(96) + ', which every staff member has.

### A comment that was answering a different question

The trident carried this, directly above its gate:

> **canActOn, not canTrollOn.**

That was true about the *hit* — which does ask the strict ladder, when it
lands — and false about the line it sat on, which is ' + chr(96) + 'trollAllowed' + chr(96) + '. Two gates
answer two different questions, and the comment only described one of them
while appearing to describe the other.

It now says both: **who may take it** is the troll section plus the ladder's
troll node, and **who you may hit with it** is asked again at impact and is
canActOn.

## 2.4.3 — 2026-09-11

**The Mirror Totem.** Everything that hits you hits whoever swung it instead,
and you take none of it. 165 charges — an unenchanted iron helmet's worth — and
when they run out it becomes an ordinary totem of undying.

Two problems, and the second is the interesting one.

### A totem has no durability

`minecraft:totem_of_undying` is not a tool, so there is no damage component to
decrement and no bar to draw. The count is written into the **lore** instead,
beside the serial, and the stack is re-minted on every hit.

That is better than the alternative rather than a workaround: the charge travels
with the **item**. Drop it, trade it, leave it in a chest — it is the same totem
with the same charges left. A count kept in world storage against a player id
would be none of those things, because an item has no identity to key on.

The serial and the count are separate lore lines on purpose, so re-minting
changes the number without ever touching the thing that proves it is ours. And
an absent count means *not one of ours* rather than "full", so a totem somebody
found in a chest never reads as a fresh mirror.

### Mirroring the hit that kills you is a question about order

Healing the damage back afterwards is too late. They are already dead, and a
corpse cannot be topped up. The only way to survive a lethal hit is for the
damage **never to land**.

So it refuses the hit in `beforeEvents.entityHurt` — the same two-tier shape
spawn protection has used in `features/warps.js` all along: cancel it where the
runtime allows, heal it back where it does not. On the preferred path *all*
damage is mirrored, lethal included, exactly as asked. On the fallback path
everything survivable is mirrored exactly and a killing blow still kills — and
the item is honest about that, because it is a real totem of undying and
vanilla's own mechanic catches that one.

### It never volleys

Applying the reflected damage raises the same event again. If the attacker is
holding a mirror too, the two would bounce the hit between them until something
gave — and what gives is the server. A reflection never reflects: one bounce,
then it stops. The guard clears even if the reflection throws, because a flag
stuck on would silently ignore every hit for the rest of the session.

It works from either hand, the way a totem does in vanilla.

### The chest

Seven items now, so the row is 10–16 — which is dead centre, one blank at each
end. The layout test wanted that within one slot and got it exactly.

## 2.4.2 — 2026-09-11

**The Spectral Trident does something now.** Three acts, eighty-four ticks.

| | | |
|---|---|---|
| **0–3s** | the grind | the dust closes in while their health drains |
| **3s** | the break | every piece of armour destroyed, health pinned at half a heart |
| **+0.5s** | the collapse | the swirls fall inward onto them |
| **+0.7s** | the shockwave | and back out, a red ring running across the ground |

Three seconds because that is long enough to be a thing *happening* to somebody
rather than a hit they read about afterwards. Everyone nearby gets those three
seconds to watch it and work out who is doing it.

### It cannot kill, by construction

Health is **set**, not damaged. `applyDamage` runs through armour, resistance
and absorption, so the same call lands differently on different people and can
finish somebody off — and a weapon whose whole description is *"drops them to
half a heart"* must not sometimes drop them to nothing. Setting the value makes
the floor exact and unkillable.

It only ever takes health away, so somebody already under the floor is left
there rather than healed up to it. And the starting health is read **once**: re-
reading it each tick would chase a moving number, so anything else hurting them
mid-grind would stretch the curve instead of leaving it on schedule.

The armour is **destroyed, not dropped** — armour on the floor is armour they
pick straight back up. The held item is left alone; this is about what protects
them, not about disarming them.

### It moved to the strict ladder

**`canActOn`, not `canTrollOn`.** It was a light show when it only drew
particles. It strips somebody's armour and pins them at half a heart now, and
the rule this pack settled on two versions ago is that a tool leaving a mark
somebody has to appeal belongs on the strict rule. Troll tools are for things
you laugh about afterwards.

And the ladder is asked **at the moment it lands**, not only when the chest was
drawn. Holding the trident is not permission to use it on somebody above you,
and the throw is the only other place the question could be put — by which point
it is already in the air. A strike on somebody who outranks you scatters, and
says so. Every strike on a player is logged.

### Drawing

The collapse reuses the swirl with a `squeeze` argument rather than a second
renderer, so the ten orbits keep their identities as they close in instead of
being replaced by a different effect.

The shockwave scales its point count with its radius. A fixed count spaced
evenly around a growing circle turns into separate dots racing apart, which
reads as debris; scaling keeps it a ring.

A storm on a *place* — a trident in the dirt — draws all three acts and harms
nobody, which is what makes it safe to start the visual before knowing what was
struck.

## 2.4.1 — 2026-09-11

**The Spectral Trident.** Throw it and red dust turns around it in the air;
whatever it strikes wears a storm of it. Loyalty III, so it always comes back.

### Why a trident and not an arrow

An arrow is **ammunition**, and that ruins it twice over. The bow picks a stack
out of your inventory, consumes it, and spawns a generic `minecraft:arrow` that
carries none of the item's name or lore — so you cannot tell which arrow was
fired. Worse, *you cannot choose which one the bow takes*, so somebody carrying
both normal and special arrows would fire them at random. "Reload with normal
arrows and nothing happens" cannot be built on that.

A trident **is** the item. You throw the one in your hand, so there is nothing
to pick and nothing to guess — and Loyalty proves the stack survives the flight,
because returning that exact trident with its enchantments is what Loyalty does.

No custom item was needed: it is a signed vanilla trident, like the Ban Hammer.

### How it knows

Three events, because a throw and its consequences are three facts the engine
never joins up:

1. **release** — the trident is still in their hand, the only moment its
   signature can be read at all
2. **spawn** — the thrown entity appears carrying nothing, so it is **tagged**
   here, off the back of the release just seen
3. **hit** — the tag says it was ours

Same trick `buildLine` uses to pin a selector's matches to what the engine
actually resolved.

### The dust

`minecraft:redstone_wire_dust_particle` — the id three Soulbound souls already
draw with, so it is proven on this engine and proven to render in open air.

The technique is Soulbound's too: a `phase` driven by the clock so the ring
genuinely **turns** rather than sitting still, points spaced evenly around the
circle, and every `spawnParticle` wrapped, because one in an unloaded chunk
throws and a lost frame must not take the effect with it.

**In flight**, six points a tick — enough to read as a ring at the speed a
trident moves, cheap enough to run on several at once.

**On impact**, ten swirls for about two seconds. Each gets its radius, height,
speed and *direction* fixed when the storm starts rather than re-rolled per
frame: re-rolling every tick is a fog of unrelated dots, while fixing them means
ten things that visibly **orbit**, at odds with each other — which is what reads
as erratic. A wobble on top stops them looking like clockwork, and the whole
thing tightens as it runs so it closes in rather than just stopping.

Ten particles a tick, inside the budget Soulbound's spiral works to. The storm
**follows the victim**, and falls back to where they were standing if they die
or log out mid-swirl rather than vanishing.

### Also

The `/items` chest holds six now, so the row moved to 11–16. Six items cannot
sit evenly *and* symmetrically in a nine-wide row, so the layout test asks for
centred **to within one slot** — otherwise it would fail on every even count
rather than on a real mistake. It caught the sixth item landing outside the row,
which is exactly what it was written for.

## 2.4.0 — 2026-09-11

**Automod stops watching and starts acting.** It mutes spammers on a ladder,
speaks in its own name, and everything it hands out expires.

A minor, because this reverses a rule this pack has stated since it was
written — *"nothing is ever punished automatically"* — and adds a whole class of
behaviour behind it.

### Why the reversal is narrow

That rule was right about **guesses**. An ore-vein alert or a break-rate flag is
inferred from behaviour that might be innocent, and a guess must never punish.
Those still only alert, and they stay staff's call.

Flooding chat is different. It is **counted, not inferred**, and the person
doing it knows they are doing it. Twitch has worked this way for a decade and
nobody finds it unjust, because the first thing that happens is being told and
the punishment is a minute.

### Typing fast is not spamming

One threshold had to be either chatty or strict, so it was set high enough not
to punish ordinary excitement and therefore high enough to miss real flooding.
There are two lines now:

| | default | what happens |
|---|---|---|
| `automod.spamRate` | above 6 in 10s | *"You are typing quickly."* Nothing else — no strike, nothing recorded, staff not told. |
| `automod.spamHard` | above 10 in 10s | a strike, and strikes escalate |

Three quick "yes" in an argument is the first one, and must never put anything
on somebody's record.

### The ladder

`automod.spamLadder`, seconds per strike, shipping as `0, 60, 300, 600`:

1. **told** — *"Stop spamming. Carry on and you will be muted."*
2. **1 minute**
3. **5 minutes**, and a warning goes on the record
4. **10 minutes** — and every time after that

The **last rung repeats**, so a four-entry ladder never quietly stops punishing
on the fifth offence. A mis-typed ladder falls back to the shipped one rather
than to no punishment, because the failure mode of a bad setting must not be
"automod stopped working".

Strikes are forgotten after `automod.spamForget` (30 minutes) and on leaving.
Without that the ladder is permanent for the session, and a second offence an
hour later lands on the ten-minute rung — which reads as broken rather than
strict.

### It speaks as [Automod]

Never as `[Admin+]`. The pack's prefix means *a person with a rank did this to
you*; a mute nobody chose has to say so, or the first thing the player does is
accuse whoever happens to be online. The warning it files is signed **Automod**
too, not "console".

### A timed mute now says when it is over

Nothing did. A mute with a length announced itself at the start, and the only
way to find out it had lifted was to try talking — so a one-minute mute was
indistinguishable from a permanent one until you guessed right. **A punishment
with a stated length has to say when the length is up, or the length is
decoration.**

The trick is that no new state was needed: a record whose `until` has passed is
already inactive, but the mirror **tag** is still on them, and that pairing means
exactly one thing — this expired and nobody has been told. It works for mutes
laid down before the sweep existed, and survives a reload. This covers every
timed mute, not just automod's, and it ends in the voice that started it.

### Warnings expire

**48 hours** by default (`warnings.expire`), because a warning is a nudge with a
memory rather than a mark for life — somebody told off on Tuesday should not
still be one step from a ban on Friday.

**Severe ones never expire**, which is the whole reason the flag exists: the
things worth remembering past the week are exactly the ones somebody chose to
mark. The toggle ships **off**, so permanence is a decision rather than an
accident. `0` keeps everything forever.

Staff can still see the lot — `warningHistory()` keeps expired entries, because
"clean now" and "never warned" are different facts and only one of them is
reassuring.

## 2.3.1 — 2026-09-11

**The whole observe class, swept.** The audit two versions ago looked for
commands that *target* a player and had no idea a command could *watch* one.
Watching was where everything left was hiding.

### The action log remembered what the notice refused to say

`core/audit.js` has refused since 2.1.x to tell a moderator that an operator
opened somebody's ender chest. **The stored log then remembered it and showed
them anyway**, off a screen asking only for `admin.logs`. The leak was never
closed — it was delayed.

Both ends of an entry are checked now, the way the live notice checks both ends
of an action: the **actor** — whose action it was, the half the notice was
missing in 2.1.x and the log was missing entirely — and the **target**. Filtered
inside `listScreen`, which all five doors funnel through (Recent, a branch, a
search, and both halves of one person's history), because a funnel is only a
funnel if nothing goes round it. The People screen's *counts* are filtered too:
a count is smaller than a line and leaks the same fact.

Anything you were part of stays yours to read, whichever end you were on. An
entry about you is how an appeal starts.

### Reports needed a category, and a rule about who hears

Reporting upward is the point — **being told about it is not.** A report about
an owner alerted every moderator: upward gossip they could not act on, and the
queue kept showing it to them.

But that rule alone was too blunt, because **staff misconduct is not the same
report.** The other four categories are about a player and go to staff; this one
is about staff and has to go over their head. So there is an `abuse` category
now, and the picker spells out what it is for:

> **Staff abuse** · a staff member misusing their tools

"Abuse" on its own would not tell a member that this is where you report a staff
member — they would file it under Other, and it would read as a complaint about
a player. Every category has its own written line for the same reason.

**And the person reported never sees the report.** `canSeeActionsOf` answers
*true* when the viewer is the subject — right for reading your own audit trail,
catastrophic here: the reported staff member would have been shown the report
against them, with the reporter's name on it. An `abuse` report is exactly the
case where being tipped off *is* the harm. The target is refused before the
seeing rule is consulted, and a test pins that order.

### A guard that knows about watching

The old one counted commands that target a player. The new one asks which files
**read one player's history and show it to another** — chat, the action log,
warnings, reports, spy — and fails unless each consults the ladder or is named
with a reason. The stores themselves are exempt and say why: they hand back rows
and have no viewer to check against.

It was tested by deleting the check from the action log and watching it fail.

## 2.3.0 — 2026-09-11

**Two ways a moderator could read upward, both closed.** The question that found
them: *can a mod see a prchat between an owner and a member?* The answer was
yes.

A minor rather than a patch because the chat log now records a field it did not
have, and reading it back is gated where it never was.

### Social spy looked in every direction

`spy()` checked `chat.spy` and nothing else, so a moderator holding it read an
**owner's** private messages and `/prchat` sessions, live. Same leak the staff
notices had before 2.1.x — except carrying the actual conversation rather than a
notification about one.

**A conversation has two ends, and both must be visible to the watcher.** An
owner messaging a member is not readable by a moderator just because the member
is beneath them: the line contains what the owner said. So both participants go
through `canSeeActionsOf` — the seeing rule, equal-or-below, so peers still
watch each other and only what is above you closes.

This is why the audit in 2.2.9 let `/prchat` and `/pm` through with "a message
is not something done *to* somebody". That was true about **sending** one. It
said nothing about **watching** one, and watching was the hole.

### The chat log gave back rooms you cannot enter

Channels are not all public. `core/channels.js` says it outright — a channel
made later gates on its own node, *"which is what lets a manager run a room most
staff cannot read"*. Those lines went into the log all the same, and the log
asked only for `admin.logs`. So a moderator read back a manager-only room, off a
screen captioned **"Public chat only"**.

You can read back what you could have heard. Every one of the three doors into
the stored chat filters now — Recent, Search, and one person's own history —
because a single unfiltered door is the whole leak.

Entries record the channel's **id** as well as its display name, since a display
name is a label an owner can rename while the id is what `canUse()` answers on.
Lines written before this version have no id, so their display name is matched
against the live channels instead — and a line from a room that no longer exists
is treated as **restricted**, because the one thing that must not happen is
defaulting an unknown room to readable.

The caption now says what is true: private messages are never recorded, and you
only see rooms you can enter.

## 2.2.9 — 2026-09-11

**Every command audited against the hierarchy rules.** All 55 pack commands
read from source — not from memory — and sorted into three boxes: checks the
ladder, deliberately does not, or was a gap.

### One real leak, in two places

**Reading somebody's warnings did not consult the ladder.** `/warnings <player>`
needed `admin.warn` and nothing else, and the panel's **Warnings** button was
the same — so a moderator could read an owner's disciplinary record. That is
the same leak the staff notices had before 2.1.x, arriving by a different door.

Both now use **`canSeeActionsOf`** — the *seeing* rule, equal-or-below — rather
than `canActOn`. Reading a record is not acting on somebody, and the strict rule
would also have shut out your peers, which is not the complaint.

### Nine commands target a player and check nothing, on purpose

Each now carries a written reason, and the reasons are tested:

| | |
|---|---|
| `/msg` `/pm` `/prchat` `/praccept` `/prdeny` | a message is not something done *to* somebody — a moderator may PM an owner |
| `/report` | reporting upward is the entire point; a member must be able to report staff |
| `/tpa` `/tpahere` | a request, not an act — the other person accepts or declines |
| `/unmute` | **un-gated on purpose.** A mute that came apart must be fixable by whoever is there, or the player stays stuck until the right rank logs in. This is a fix, not a philosophy. |

### Everything else was already right

`/ban` `/mute` `/kick` `/warn` `/nick` `/sudo` `/vanish` `/tp` `/mm` check
directly; `/gm` `/gmc` `/gms` `/gma` `/gmsp` `/grant` `/invsee` `/ec`
`/enderchest` check inside the screen or helper they call — which is why the
audit had to read the file rather than the command block, and why the test that
pins it does both.

`/smite` and the Knockback stick use `canTrollOn`, the equals-allowed rule. The
54 vanilla passthroughs are filtered centrally where the selector resolves. The
Ban Hammer went onto the ladder in 2.2.5.

### The guard

A test walks every `command({ … })` in the pack — found by matching braces, not
a regex that truncates at the first `}` inside a handler — and fails if a
player-targeting command neither checks nor has a reason. The reason list is
checked from both ends: a name for a command that no longer targets anybody, or
one that has since grown a check, fails rather than sitting there excusing
nothing.

It distinguishes the **file** from the **block**, because one file holds both
kinds: `modcommands.js` has `/ban`, which checks, next to `/unmute`, which
deliberately does not.

### Still open, deliberately not changed

**Viewing an inventory or ender chest is not gated on the ladder.** The code
says why: looking is not an action against somebody, and the screen already
refuses to let you *take* from someone above you. By the same reasoning the
warnings fix just used, viewing arguably wants `canSeeActionsOf` too — but that
rationale was written down deliberately, so it is being raised rather than
overturned.

## 2.2.8 — 2026-09-11

**Logs read as text now, grouped by day.**

They were a wall of buttons — one per entry, its text in `§8`, which is dark
grey on a grey button face. **The thing you were trying to read was the least
legible part of the screen.** Buttons are for doing things; a log is for
reading.

So the entries live in the form's *body* now, the way the Credits screen puts
its text, under a day heading:

```
Today
20:32 Banned Steve
  Alex · griefing · permanent
20:22 Muted Kai
  Alex · 10m

Yesterday
20:20 Gave Kai Moderator (undone)
  Alex
```

"Today" and "Yesterday" are named rather than dated, and the clock is **local**
— the person reading is standing in the world, so yesterday should mean their
yesterday, not UTC's. Anything older gets a day and a month.

The palette is the actual fix. `§8` is fine for a timestamp because a timestamp
is a label, but the sentence is `§f` and the actor is `§7` — that second one is
what had vanished into the button.

Buttons are down to what buttons are for: **▲ Newer**, **▼ Older**, and **Open
an entry** for when you want the detail or an undo. Tapping an entry is not
lost, just moved behind one button instead of being the only way to see
anything.

### Chat especially

The action log says who did what *to* somebody; the chat log says what was
actually said — and a conversation split one-line-per-button is the one thing
you cannot follow. Run together under a day heading it reads the way it was
said:

```
Today
19:41 [global] Kai: who broke the bridge
19:41 [global] Steve: not me
```

Both screens share one reading view, so they cannot drift into two
different-looking answers to the same question.

## 2.2.7 — 2026-09-11

**The Ender Eye has a menu now, not a list.** Two doors:

- **Players** — everyone online, with how far away they are or which dimension
- **Location** — the world dropdown and coordinates, as before

and **Where I'm looking** kept beside them, because it answers neither question
and needs no argument at all: it is the only one that reaches a place nobody is
standing and you cannot name.

### Picking a player gives you four things

| | |
|---|---|
| **Go to** | jump to them |
| **Bring here** | move them to you |
| **Teleport** | send *them* to coordinates |
| **Swap places** | trade positions |

**Going to somebody is not something done to them, so it needs no rank check.
Moving them is.** Go to is always there; the other three appear greyed with
"outranks you" for anybody above you, because a missing button reads as a broken
menu while a greyed one reads as a rule.

The coordinate form is the same form either way — one box, one set of refusals,
one place to get the height rule right. It opens on the **subject's** position
rather than yours: sending somebody ten blocks up means ten above where *they*
stand, and a box pre-filled with your coordinates would quietly mean somewhere
else. The rank is checked again after the form closes, because it was open for
as long as they took to type.

A swap reads **both** positions before moving anybody. Teleporting one and then
asking where the other is would send the second to where the first no longer
stands.

### `bring` came off the dropped list

It was removed on purpose in an earlier life, alongside homes and fly, and
CLAUDE.md said not to build it unasked. It was asked for. That note now records
the reversal so the rule does not quietly delete it again — and it is a menu
entry rather than a command, which is what the standing "no command sprawl"
decision wants anyway. The audit log already had a phrase for it.

## 2.2.6 — 2026-09-11

**A peer cannot ban a peer.** 2.2.5 made one rule out of two different
questions, and this splits them again.

The reasoning that went wrong is worth writing down: the Knockback stick
obviously should work between equals, so `canActOn` was loosened to
equal-or-below — and that quietly meant a moderator could ban another
moderator. One example, generalised into a rule that covered punishments.

The difference is not how much a thing hurts. It is whether it is an exercise of
authority or a bit of noise between peers:

- **`canActOn` is strictly below you again.** Bans, kicks, mutes, warns,
  freezes, rank changes, the Ban Hammer, and all 54 vanilla passthroughs. Two
  moderators are not each other's moderators — that is what the rank above them
  is for, and a punishment one equal hands another has no authority behind it.
- **`canTrollOn` is equal-or-below**, and only the Knockback stick and `/smite`
  use it. Nothing punitive does, and nothing punitive should: if a tool leaves a
  mark somebody has to appeal, it belongs on the strict rule.

Both keep the same two exemptions — a config owner acts on anyone and is acted
on by nobody, an operator acts on anyone but a config owner — and a test pins
that the equal case is the **only** place the two rules disagree.

### The coverage guard learned two things

It accepts `canTrollOn` as asking the ladder, which it is. And it strips
**block** comments as well as line comments before looking: a `/** … */`
paragraph explaining why `canActOn` is the wrong question somewhere would
otherwise have read as the check itself. That is the third time a test here has
been at risk of agreeing with its own prose instead of with the code.
## 2.2.5 — 2026-09-11

**Nothing reaches above you.** The ladder is now asked by everything that acts
on a player, and it answers the same way everywhere: **your equals and everyone
below you, yes. Anyone above you, never. Operators, anyone.**

### The rule changed: equals are in

`canActOn` was strictly-above, so two moderators could not moderate each other
and a mod could not knock a peer about. It is equal-or-below now.

The consequence is worth stating plainly rather than discovering: **a peer can
ban a peer.** That is the stated rule, and the ladder is how you change it — give
the people who should be untouchable a heavier rank, not an equal one. A config
owner is still immune to everyone, online or not, and an operator still acts on
anyone but a config owner.

Nothing failed when this changed, because **no test pinned the equal case** —
which is how a rule can be inverted without anything noticing. It is pinned now,
both directions, plus the operator bypass.

### The 54 vanilla passthroughs had no rank protection at all

This is the real hole. Every command in the panel and every pack command checked
`canActOn`. The passthroughs checked **nothing** — so a moderator could `/slay`
an owner, `/eff` them poison, `/dmg` them, `/label` them or `/move` them into
the void. The permission node said who may use `/slay`; nothing said who they
may use it *on*.

One filter, at the point the selector is resolved, covers all 54. Mobs are
untouched — a zombie has no rank — so `/slay @e[family=monster]` behaves exactly
as before. When a selector matches people you may not touch:

- **all of them outrank you** — refused outright, so the command cannot report a
  cheerful "0 affected" for what was a permission failure
- **some of them do** — the rest go through and you are told who was skipped.
  Silently trimming the set would make `/slay @a` look like it worked on
  everybody.

### The Ban Hammer was protecting the wrong people

It had one guard, and it was not the ladder: anybody who *also* held
permanent-ban permission was immune. Two things were wrong with that. It let a
moderator strike an **owner** who happened not to hold that node, because it
never asked who outranked whom — and it was a rule nothing else used, so the
hammer protected a different set of people from every other way of banning
somebody. It asks the ladder now, like everything else.

### A guard, so this cannot come back

A test walks every feature file. Anything that takes a player as a command
argument must either call `canActOn` or be named in a short list with the reason
it does not:

| exempt | why |
|---|---|
| `privatechat.js` | a message is not something done *to* somebody — a moderator may PM an owner |
| `reports.js` | reporting upward is the entire point; a member must be able to report staff |
| `tpa.js` | a request, not an act — the other person accepts or declines |

Adding a command that targets somebody and forgetting the check fails the suite.
The list is checked too: a name on it for a file that no longer exists, or one
that has since grown the check, is flagged rather than left to rot.

## 2.2.4 — 2026-09-11

**Every admin item answers to your rank, and `/mm` hands you the same set
`/items` offers.** Four gates were checked; two were wrong and one door was
locked against the people meant to come through it.

| item | answers to |
|---|---|
| Ban Hammer | permanent-ban |
| Teleport compass | teleport |
| Ender Eye | teleport |
| Knockback stick | **troll tools** — was staff mode |
| Orbital Strike | troll tools, armed, operator + Dev |

**The Knockback stick was on `admin.staffmode`.** Every staff member got it
whatever the ladder said about troll tools, and switching the whole troll
section off did not take it away. It answers to troll now — and troll means
*both* switches: the owner's `feature.troll` and the rank's `admin.troll`,
which sits in Settings ▸ Ranks ▸ Staff tools as **troll**.

It was asked in **two** places — when the chest is drawn and again when the
stick is swung — so fixing one would have handed somebody an item that did
nothing when they hit with it. `core/trollgate.js` is now the single answer, and
`/smite` and the Orbital Strike use it too. Three troll tools had three
different answers to one question.

### `/mm` carries the whole catalogue

The staff-mode bar was a fixed list of two, plus the hammer if you could ban
forever; nothing else in it consulted your rank at all. It is built from the
same catalogue `/items` offers now, through the same gates, so the two can never
disagree and turning a permission off takes the tool from both.

That surfaced a **duplicate**: the bar carried its own Teleport compass, same
type and same name as the `/items` one, with no permission gate. It is gone —
the catalogue's version replaces it, gated. What is left in the bar's own list
is the Leave clock, which is the only thing that exists solely inside staff
mode.

### The bug that duplicate was hiding

`toolFor()` decided whether an item was a staff tool by looking for the world
serial — which **both** signatures carry. The two sigils exist precisely so the
two item sets cannot trigger each other's handlers, and this was the check not
reading them. An `/items` compass held in staff mode matched here as well, so
one right-click fired both handlers and teleported you twice, to two different
people. It checks the sigil now.

### `/items` refuses instead of opening empty

It demanded `admin.staffmode` to open, which locked out a rank holding only
teleport — somebody entitled to the compass and the eye could not reach the
chest they were sitting in. The command has no permission of its own now; the
items decide. Hold one and it opens, hold none and it says so:

> You don't have permission to use any admin items.

An empty chest reads as "there are no items", which is a statement about the
pack. The true statement is about the rank. (An operator passes every gate
regardless — that is `has()` keeping a fresh world's host from locking
themselves out.)

## 2.2.3 — 2026-09-11

**A verification pass, and what the engine had been saying all along.**

Minecraft's own content log has been printing this at every load for months:

    Custom Command alias [tp]  already in use. Required to use full name [a:tp].
    Custom Command alias [msg] already in use.
    Custom Command alias [me]  already in use.

Three of the pack's own command names are owned by the game. The 54 passthroughs
were renamed precisely to avoid that; the pack's own commands were never put
through the same check. **The audience holds a rank and not operator**, and that
is what decides how much each one costs:

- **`tp`** — vanilla's needs operator, so for a ranked non-op `/tp` does nothing
  at all. The answer is the **Ender Eye**: `/port` hands one over and the eye
  opens a menu of who to jump to, so the person who cannot type `/tp` never
  needed a name to type. Both doors — `/port` and `/items` — are now pinned as
  names the game does not own, because a collision there would send them to
  vanilla exactly as `/tp` does.
- **`msg`** — vanilla's works for everybody, so it silently *succeeds* while
  bypassing this pack's version: no socialspy, no chat log, and a muted player
  still gets their message out. `/pm` is the way through, and `/msg`'s own
  description has said so all along.
- **`me`** — same shape, lower stakes. `/emote` works bare.

A test pins the three, so a fourth cannot appear unnoticed.

### tools/state.py was hiding the thing it exists to show

Two faults, both of the kind that made the storage bug invisible for six
versions:

- It read the newest content log, which is not the newest log that *ran* Admin+.
  A world opened without the pack buried the session that mattered, and the
  report claimed there was no Admin+ startup line about a build that had run
  fine hours earlier. It now walks back to the newest log that actually loaded
  the pack, and says how many it skipped.
- It counted the 28 early-execution storage warnings as problems. They are
  expected — a Table is built while modules evaluate, and each one retries on
  the first tick — and the log says so two lines later. Twenty-eight lines of
  noise is where a real error hides. They are now reported as retries **only
  when the recovery line is actually present**; without it they are called out
  as the first thing to read.

### Checked against the game rather than against the tests

Every script call the last three versions added was verified against the 74
behaviour packs installed on this machine — `beforeEvents.itemUse` with
`event.cancel`, `system.runTimeout`, `createExplosion(location, radius, opts)`,
`getPlayers({location, maxDistance})`, `setItem(selectedSlotIndex, undefined)`
and the bare-name `addEffect("darkness", …)` form. All six are in packs the game
already runs.

That is still **Tested**, not **Proven** — none of it has been seen working in
this world. But it is no longer only Node's opinion.

## 2.2.2 — 2026-09-11

**`/tp @p` works, and a name now means the name you can see.** Two fixes in the
three commands that get typed hardest — kill, effect, teleport.

### `/a:tp` was still asking the parser

It was the pack's own teleport, and it still declared its arguments as
`PlayerSelector`, which is the shape the 54 passthroughs were moved off in
2.1.21. The engine expands a selector parameter at the command's declared
permission level — `core/registry.js` declares `Any` for everything — and every
`@` form is refused there, before the handler runs. A literal name got through,
which is exactly why the breakage looked random: `/tp Steve` worked and
`/tp @p` did not.

Both arguments are plain text now and `core/selector.js` resolves them through
the script API, the same route everything else takes. `@s @p @r @a` all work,
with filters. The cost is the one the passthroughs already pay: the game no
longer offers the selector list as you type, so the vocabulary rides in the
command's description instead.

### A name now includes a nickname

`core/selector.js` matched the gamertag and nothing else, so `/eff Starlight
speed` answered *"nobody here is called Starlight"* about somebody standing in
front of you wearing exactly that name. Admin+ shows a nicknamed player as their
nickname in every list, nametag and chat line — that is the name staff read off
the screen and type back in.

The **gamertag wins** when both could match. It is the name that cannot be
changed by the person answering to it, so a moderator typing a gamertag they
looked up in the ban list can never be redirected onto somebody who nicknamed
themselves that. Nicknames are compared with their formatting codes stripped,
because the codes are not something anybody can type.

Several matches come back as several — a shared nickname is a real situation,
and silently picking one of two people is the worse answer.

### And the thing that turned up while fixing it

`/slay` and `/eff` were traced end to end and are sound: both take the direct
script-API route — `entity.kill()`, `entity.addEffect()` — with no command text
and no parser anywhere, which is the route `/gm` has always taken.

But **`/a:tp` was not the only one left.** Roughly two dozen of the pack's own
commands still declare `PlayerSelector` — `/ban`, `/mute`, `/warn`, `/nick`,
`/invsee`, `/smite`, `/sudo`, `/tpa`, `/vanish`, `/ec`, `/gm`, `/msg` and the
rest — and every one of them refuses `@p` today, for exactly the same reason.
Nobody noticed because people type a name or leave the argument off, and those
are the two cases that work.

They are not fixed in this version. They are **counted** in
`tests/vanillacmds.test.js`, file by file, so the number goes down as they are
converted and nobody has to hold the list in their head. Lowering it means a fix
landed; raising it means somebody wrote a new command with the broken shape.

## 2.2.1 — 2026-09-11

**The Ender Eye's Location screen picks a world too.** A dropdown above the
coordinates — Overworld, Nether, The End — opening on the one you are standing
in, so a jump within it still needs nothing but a number.

That was the half of the question coordinates alone could never answer, and it
brings a footgun the rest of the eye never had. **Every other teleport here
stays in the world you are already in, so the height you type is always a height
that exists.** Pick the Nether with `~` still in the Y box while standing at 200
in the Overworld and you arrive inside the bedrock roof — which is not somewhere
you walk out of.

So the range is checked, and the refusal **names the world and the limit**:
"Nether only goes from 0 to 127 — 200 is outside it." Refused, never clamped;
silently moving somebody 73 blocks from where they asked is worse than telling
them the number was wrong. The ceiling itself is out as well, because the top of
the range is where blocks stop rather than a place to stand.

The heights are read from the engine where it will say, falling back to the
known table. The Overworld's floor has already moved once, in 1.18, and a
hardcoded number that disagreed with the game would refuse real heights.

The confirmation only mentions the world when you actually changed it.

## 2.2.0 — 2026-09-11

**The Orbital Strike.** A fishing rod in `/items`. Aim at something across the
map, use it once, and it is gone — then the sky goes dark, a warden heartbeat
starts up and gets faster, and about eight seconds later that place stops
existing.

A minor rather than a patch because it arrives behind its own switch, with its
own settings group and its own console verb, which is what a section means here.

### Where it comes from, and what was actually worth taking

Reimplemented from **lllTango_lll's** Orbital command-block build. None of their
files ship — the pack's standing rule — and it turned out almost none of their
machinery was needed either, because the hard half of theirs is a problem a
script does not have.

Theirs aims by summoning an `xp_orb` at the player's eye, rotating it to face
where they look, then nesting `execute as @e[c=2]` **ten deep** — 2¹⁰ = 1024
runs in one tick — each stepping the orb `^^^0.1` forward with `checkForBlocks`,
so it stops dead at the first solid block. A hundred-block raycast built out of
redstone, where the refusal to teleport into a block *is* the collision test.
`getBlockFromViewDirection()` is that, in one call.

What they got right, and what is copied on purpose, is the **drama**: darkness
over everyone nearby and a heartbeat that accelerates. A steady beat is a timer;
a quickening one is a warning. Theirs runs 56, 50, 46, 36, 30, 26, 20 ticks
apart — same shape here, shortened, because thirteen seconds is a long time to
stand still. You hear it coming and you have time to run, which is the whole
feature. The explosion is just the end of it.

### The locks, and which of them actually lock

Four things are checked, when the chest is drawn and again when the rod is used:

1. the **troll section** is on
2. somebody typed **`toggle nuke`** in the console, in this world
3. **operator and the Dev tag**, both
4. no rank the holder has **denies `admin.troll`**

**The fourth is weaker than it looks and the code says so rather than implying
otherwise.** `has()` lets an operator through any node no rank has an opinion
about — deliberately, so a fresh world cannot lock out its own host — and this
gate already demands operator. So the node cannot *add* anybody; it can only
subtract, honouring an explicit `-admin.troll`. That is still worth having — it
is how a realm carves this out of one admin rank without touching the other
three — it is just not a fourth key, and a test says that out loud.

Disarming at the console makes **every rod already handed out inert**, which is
what a switch has to mean or it is decoration.

### Settings, under a new "Orbital strike" heading

- `nuke.radius` — 12 by default; the central blast. The ring around it is
  smaller. 12 flattens a house.
- `nuke.breaksBlocks` — **true**. False keeps the sound, the darkness and the
  damage and leaves the ground alone. On by default because it is behind the
  locks above and a nuke that leaves the ground flat is a joke rather than a
  weapon — but a realm that wants the fear without the hole should not have to
  choose between that and nothing.
- `nuke.range` — 160. Looking at the sky fires at maximum range rather than
  refusing; a strike that needed a roof in the way would be a strange weapon.

One rod, one strike, and it is taken **by slot** rather than by type — somebody
holding two is left holding one, where `clear <player> fishing_rod` would have
taken both.

### Permission switches are labelled, not spelled out

The rank editor showed the raw node on every switch — `cmd.kill`, `admin.tp`,
`warp.use`. Inside a group the prefix is the same word on every row, so
fifty-four of them reading `cmd.` down the left is harder to scan than `kill`,
`give`, `clear`.

Stripping the prefix blindly is a trap, and two real groups spring it. Every
node in **Player basics** *ends* in `.use`, so the prefix is the meaningful half
and dropping it would have left five switches all labelled "use". **Management**
holds both `ranks.manage` and `warp.manage`, which collapse onto each other.

So the shared word is dropped, whichever end it is on, and a group that shares
nothing keeps both halves:

| | | |
|---|---|---|
| every node shares a first segment | drop it | `cmd.kill` → **kill** |
| every node shares a last segment | drop it | `warp.use` → **warp** |
| the short forms are unique anyway | drop the first | `chat.spy` → **spy** |
| otherwise | keep both | `ranks.manage` → **ranks · manage** |

The last case applies to the whole group rather than per row, because a list
spelled two ways reads as a mistake. A test walks every shipped group and fails
if two switches would end up with the same words on them.

### Also

- **`tools/nbtread.py`** — a reader for `.mcstructure`, which is uncompressed
  little-endian NBT and not a zip, which is why nothing generic opens one.
- The test stub gained a real `runTimeout` that **queues rather than fires**, so
  a sequence spread over eight seconds can be tested as a sequence instead of
  collapsing into one tick, plus `createExplosion`, so what the strike does is
  checked rather than described.

## 2.1.25 — 2026-09-11

**A name can no longer repaint the line it sits in.**

`§` plus one character is Minecraft's formatting escape, and in *Bedrock* a
colour code does not clear the style codes — only `§r` does. So a nickname
carrying `§k` obfuscated everything printed after it, `§l` bolded the rest of
the line, and neither stopped at the end of the name. Every Admin+ message is a
coloured sentence with a name in the middle of it, so one nickname could
scramble the whole thing:

    [Admin+] §f§kSteve§a was muted for 10m by Alex
             ^^ from here on, everything is obfuscated

Anybody who can set a nickname could do it, which is anybody staff have given
`/nick` to — and it would read as Admin+ being broken rather than as somebody
having done it.

The fix splits by **audience**, not by caller:

- **What Admin+ says in its own sentences is now plain.** `displayName()`
  strips the codes, so all 116 places that print a name are fixed by one
  function rather than by remembering at each one. Moderation output should not
  be styled by the person being moderated anyway.
- **The templated lines keep their colour.** Chat, the nametag, join and leave
  run through `format.*` strings where an owner put the colours there on
  purpose, so a coloured nickname still renders — it just cannot escape, because
  `{NICKNAME}` now ends with `§r`. Only where a code was actually used: adding a
  reset to every plain gamertag would cancel the colour the template just set.
  `{NAME}`, the gamertag, is plain by definition.

The stored nickname is untouched either way, so nothing anybody set is rewritten
and turning a colour back on is just clearing and re-setting it.

**A nickname made only of formatting codes is now refused**, the same as a blank
one. It rendered as nothing at all — an invisible player in every list, chat
line and nametag, which is a hiding place rather than a name.

### One place decides what a `§` means

`chat.js` and `chatcommands.js` each carried their own private `stripCodes`,
byte-identical to the other and to the one this work added to `identity.js`, and
nothing knew about the others. A rule about `§` living in three files is three
rules, and the bug above was fixed in none of them. They now import the one
function, and a test walks the source tree and fails if a second definition ever
appears.

### Known, and deliberately left

A **ban or mute reason** can still carry codes into a broadcast. It is the same
class of bug, but only staff can write one, where anybody with `/nick` could set
a nickname — so it is a much smaller hole, and stripping colour out of text
staff typed on purpose is a different decision from stopping a name repainting a
sentence. Say the word and it goes the same way.

## 2.1.24 — 2026-09-11

**The Ender Eye takes a location.** A second entry below the player list: type
X, Y and Z and go there.

That completes the set, and each of the three reaches somewhere the other two
cannot. A name gets you to a person. Looking gets you to a place you can see. A
coordinate gets you to a place that is neither — the spot a member reported, a
height above a build, somewhere in the dark you have written down.

The three fields open holding **where you are standing**, so the format is shown
rather than explained and changing only the height is a one-character edit. They
read vanilla's own grammar: `~` is where you are, `~10` is ten further along, a
bare number is absolute. Anybody who has typed a `/tp` already knows it.

A field that cannot be read is **refused by name** — "Y is not a number" —
rather than quietly becoming 0. That is the whole reason the parsing is its own
function with its own tests: a typo'd height read as zero drops you into
bedrock, and it would look like the eye simply misbehaved. `Infinity` is
refused for the same reason, since it survives `Number()` and throws only when
the teleport runs.

X and Z past 30 million are refused too. That is the world border; a teleport
past it does nothing at all, and saying so beats pressing the button and
appearing not to have moved.

The eye's entries are in the order you reach for them: people first, then a
location, then where you are looking.

## 2.1.23 — 2026-09-11

**The Ender Eye picks a person.** `/port` no longer teleports — it hands you the
eye, and using the eye opens a list of who is online. Click a name, you are
there.

2.1.22 shipped the eye as look-and-blink, which solved half the problem. The
other half is that most of the time you want to reach a *player*, not a roof —
and reaching a player is exactly what no command here can do, because a
destination means a selector and the engine refuses to expand one at the
permission level these commands hold. A menu has nothing to expand. It also
suits who actually plays here: a list of names you recognise beats `@p` even
where `@p` works, and nobody has to be taught that `@p` exists.

Looking somewhere and jumping there is still in the eye — as the first entry
below the names, so everything it does is in one place instead of split across
two gestures nobody would find.

**It can no longer be thrown.** A vanilla ender eye that is merely *handled* is
still thrown: it flies off toward a stronghold and is gone, taking your teleport
with it. Using it is now cancelled outright, which is the only thing that stops
that. A cancelled use means the after-event never fires, so the eye moved to the
before-event entirely — and the cancel happens before the permission check, so
even an eye whose holder has lost `admin.tp` stays in the inventory rather than
flying away. An ender eye somebody crafted is untouched; only ours is caught,
by the per-world serial in its lore.

The list leaves out vanished players unless you are allowed to see vanish, the
same rule `/vanished` and the People screen follow — an eye that listed a hidden
moderator would give them away without their having done anything. Rank does not
filter it: going to somebody is not something you do *to* them. Each entry says
how many blocks away they are, or which dimension they are in.

`/port` says so rather than handing you a second one if you already have an eye.

### The command table: 55 vanilla passthroughs become 54

`tp` is gone. Bedrock ships `tp` and `teleport` as two names for the same
command, and this table carried both, splitting the overloads between them —
`/port` took coordinates, `/move` took an entity destination. Registering the
same command twice to buy one extra overload was always a thin trade, and it
cost the name `port`.

So `/move` now carries the whole grammar that is worth having:

    /move <target> <x y z> [yRot] [xRot] [checkForBlocks]

Coordinates are the form neither the eye nor the pack's own `/a:tp` can express,
which makes it the one worth keeping. The entity destination is the eye's job
now, and it does it better than the command did.

The game still owns `/tp` — dropping the passthrough does not free the name — so
it moves onto the explicit owned list rather than being inferred from the table.

### Smaller

- A test now checks every command count written in a source comment against the
  actual table. Three files said "56" for the whole life of a 55-row table, and
  when `tp` was dropped the stale number was read back as if it were true and
  the correction landed one short. A wrong comment is worse than no comment,
  because it gets quoted.
- The test stub gained a real `itemUse`, before and after, with the engine's own
  rule that a cancelled before-event suppresses the after-event. The throw-cancel
  is tested by firing a use and reading the flag, not by looking for the word
  `cancel` in the source.

## 2.1.22 — 2026-09-11

**The Ender Eye.** A new admin item in `/items`: look somewhere, use it, be
there.

It exists because of what the selector work turned up. Every other way to
teleport needs a TARGET, and a target means a selector — and a custom command's
selector parameter is expanded by the engine at a permission level these
commands cannot have, so `@p` is refused before any of this pack's code runs.
**An item has no arguments to refuse.** You point at a roof and you are on it.

That suits who actually plays here better than the command ever did. Nobody has
to know `@p` exists, or that it would not have worked.

It lands on the UPPER face of whatever block the ray strikes, which is the one
place guaranteed not to be inside something — look at a wall and you are on the
wall, not embedded in it. Liquids and passable blocks are skipped, so looking
across water puts you on the far bank rather than dropping you in, and a ray
through tall grass does not stop at the grass. Your rotation is kept, because
you are already facing the thing you wanted to reach.

Range is `items.eyeRange` in Settings, 160 blocks by default; beyond it the eye
says nothing is in range rather than dropping you somewhere arbitrary. It needs
`admin.tp`, checked when you USE it and not only when you took it, so an item
that outlives its holder's permission goes inert rather than becoming a way
round the ranks.

The chest row now reads `[Hammer] [Teleport] [Eye] [Knockback]`, evenly spread,
because these are picked by eye rather than by name.

## 2.1.21 — 2026-09-11

**Selectors are resolved by the mod, not by the command parser.** This is the
answer to the whole hunt, and the user got there first: *"how can we forget it's
a mod? this isn't some command block thing."*

The decisive evidence was one detail — the error was **bare**. No `[Admin+]`
prefix:

    <insufficient permissions for selector expansion>

Every message this pack prints is prefixed. An unprefixed one means the failure
happened **before the handler ran**. A parameter registered as `EntitySelector`
or `PlayerSelector` is expanded BY THE ENGINE at the command's declared
permission level — `Any`, because the entire point is handing power to people
who do not hold operator — and every `@` form is refused there.
`/slay @e[family=monster]`, `/gift @p iron_leggings` and `/ench @p` all died
that way, while `/exp 100 Steve` worked, because a literal name is not a
selector and needs no expansion.

Which means everything built on the day before — `@a` versus `@e`, running per
entity with `@s`, the direct script-API routes — was correct and *unreachable*.
The handler never started.

So the selector comes in as text and `core/selector.js` resolves it through
`dimension.getEntities()`, the script API's own query. No parser, no permission,
nothing to refuse. `@e[family=monster,r=20,c=5]` becomes
`{ families: ["monster"], maxDistance: 20, closest: 5, location: … }`. Supported:
`@s @p @r @a @e` with `type` `family` `tag` `name` `r` `rm` `c` `m` `l` `lm`
`x y z` `dx dy dz`, and `!` to negate any of them.

**A filter that cannot be honoured is refused, never ignored.** `scores=` has no
equivalent, so `/slay @e[scores={kills=1..}]` reports that rather than quietly
dropping the filter — the difference between killing the mobs beside you and
killing every mob loaded.

**The cost, and it is the same one as 2.1.13:** the game no longer offers
`@a @e @p @r @s` as you type. It has to go, because the alternative is a picker
that suggests five selectors and refuses all five, which is worse than one that
suggests none. The vocabulary now rides in the description of every command that
takes a selector, which is the only surface left that can carry it. Locations
still suggest `~`, items and blocks still complete, enums still offer their
words — 165 parameters keep their real type; only the 36 selectors changed.

## 2.1.20 — 2026-09-11

**Two enums were being registered with Bedrock and offered to nobody.** Found by
asking a simple question — "did we have a `/time`?" — and checking rather than
answering from memory.

`riderule` went dead in 2.1.19 when `/mount`'s optional pair was corrected to
the ones vanilla actually takes. `timeset` never worked at all: `/time set`
accepts a NUMBER or a word, one parameter cannot be both, so the value is a
String and a day/noon/sunset vocabulary could only ever be registered and never
reached.

Both are gone, with a note where they sat saying why. This is the same rule the
rest of the pack follows — *a node exists only if the code checks it* — and
`tests/vanillacmds.test.js` now fails if an enum is defined without a parameter
naming it, so it cannot happen again quietly.

## 2.1.19 — 2026-09-10

**All 55 vanilla commands have now been read against Microsoft's reference.**
`python tools/commands.py` says 55 of 55; it said 4 this morning. Not one row is
guesswork any more.

The hit rate is the part worth knowing: **sixteen of the fifty-five were wrong**,
and nine of those could never have worked at all.

**Could not have worked — the command text they built was invalid:**

- **`/exp`** demanded a mandatory `levels|points` unit. That is *Java's*
  grammar; Bedrock is `/xp <amount> [player]`.
- **`/port`** declared `facing` as a position when it is a literal keyword.
- **`/sum`** had `nameTag` in position three, where vanilla expects `yRot`, so
  `/sum zombie ~ ~ ~ Bob` handed a name to a rotation. `spawnEvent` was
  unreachable, so no baby zombies and no charged creepers.
- **`/spread`** declared x and z as a single three-value Location. Every
  argument after it landed one place along. `maxHeight` was missing, and the
  target was entity-typed when the command wants a player.
- **`/input`** had no `set` verb at all — `inputpermission @a[…] camera enabled`
  is not a command. Nine of its eleven permissions were also missing, which is
  most of what makes it useful: you could not freeze someone's jump or their
  sneak, only camera and movement.
- **`/shake`** had no `add` verb.
- **`/controls`** had no `set` verb.
- **`/trigger`** was missing the literal `entity` that `/event` requires.
- **`/mount`** had the wrong pair of optional enums, in the wrong order, and
  `teleportRules` did not exist in the table at all.

**Vocabularies that were short**, which shows up as the game refusing a value it
actually accepts: `/eff` was seven effects light (the whole 1.21 trial-chamber
batch), `/ench` two (`breach`, `lunge`), `/diff` was missing `p e n h`, `/sky`
was missing `query`, `/gmode` was missing `s c a d`, and `/dmg` carried a
`suicide` cause that does not exist while missing `mace_smash`. `/overlay`
listed a `vehicle_health` element that is not one.

**Vocabularies that existed but were never offered.** `/rule` took a bare String
for the rule name — 38 names, none of them completing, and nobody remembers
whether it is `dodaylightcycle` or `doDaylightCycle`. Same for the verbs on
`/struct`, `/ticking`, `/mist`, `/dialog`, `/feature`, `/drops`, `/score`,
`/cam`, and the repeat mode on `/mus`.

**Four are as good as they can be, and that is now written down rather than
left looking like laziness.** `/cam` has 35 overloads built from keyword
literals in mid-line; `/drops` has 20; `/score` has 11 branches and one of them
takes a bare `+=` as an argument. A parameter list cannot describe a grammar
made of keywords, so those take a typed verb and loose words after it — a
decision, with the reason in the row.

**Also fixed:** `/find` was missing `useNewChunksOnly`, `/checkblock` its
optional block states, `/rawtitle` the two extra slots its `times` form needs,
and `/loot`, `/structure`, `/tickingarea` and `/place` all had a bare String
where a real enum existed.

## 2.1.18 — 2026-09-10

**An entity argument is run ON each entity with `@s`, not handed to the
dimension.** `/slay @e[family=monster]` was refused with *insufficient
permissions for selector expansion*, and with that the picture from a live world
finally resolves:

    /exp 100                    worked    no selector in the rebuilt line
    execute at @a[tag=…,c=1]    worked    that wrapper is in every command
    kill @e[tag=…]              refused
    /slay @e[family=monster]    refused

`dimension.runCommand` can expand **`@a`** and cannot expand **`@e`**. No
amount of care writing the line gets round that, because the problem is the
asking.

So it stops asking. The engine has already resolved the argument by the time
this code runs, so the slot becomes `@s` and the command runs once on each
entity through `Entity.runCommand`. `@s` names the executor and expands
nothing — there is no broad selector left for anything to refuse.

One dead mob in a list of forty is not a reason to abandon the other
thirty-nine, so failures are counted rather than thrown, and the reply now says
how many were actually affected: *Ran /kill — 12 affected.*

**The limit, stated rather than discovered:** only the FIRST entity argument can
be `@s`, because there is one executor. The three commands taking two —
`/move`, `/mount`, `/dialog` — still hand the second to the dimension and remain
subject to the same restriction.

## 2.1.17 — 2026-09-10

**One player is written as a NAME, not a selector at all.** This is the fix that
matters, and a live world handed us the clue: `/exp 100` worked, `/exp 100
<name>` did not. The only difference between them is that the second puts a
selector in the rebuilt line — so it is *expansion* that gets refused, not the
command, not the route, not the permission level.

The engine has already resolved the argument by the time this code runs, so for
a single player there is nothing to gain by handing a selector back. A name is
not a selector; the parser never expands it, and it reaches exactly the same
person. `/exp 100 Steve` now becomes `xp 100 "Steve"`. Quoted, because a
gamertag can contain spaces.

Several players still need a selector, and entities always do — which is where
the rest of this applies.

**A player argument gets `@a`, an entity argument gets `@e`.** Found in the same
world: `/gift FireliteZGaming chainmail_boots` came back with

    Error occurred with parsing command params: Selector must be player-type

Resolved selectors are handed back to the game as a tag, and the rebuilt line
always used `@e[tag=…]` — every entity. But vanilla checks a selector's TYPE
**syntactically**, not what it happens to resolve to, so a player-typed argument
handed `@e` is refused outright even when every tagged entity is a player. The
parameter table has always known which is which; the code just was not asking.
**Twenty-one player parameters were all emitting `@e`**, which is exactly why
some of these worked and some did not.

`@e` is also the most permission-restricted selector the game has, so this is
the likely cause of `insufficient permissions for selector expansion` on
commands that take a player — `/ench` among them.

**The pack no longer claims success it did not have.** A command the game
REFUSES does not throw: it returns `successCount: 0` and writes its own
complaint into chat. So `runAsServer` printed a cheerful green *"Ran /enchant
…"* directly above the game's red *"insufficient permissions for selector
expansion"*, with nothing to say which of the two was telling the truth.

Zero is not always failure — `/slay @e[type=cow]` with no cows nearby
legitimately affects nobody — so it is now reported as what it is, the command
ran and changed nothing, and the game's own message is pointed at rather than
contradicted.

**`tools/deploy.py` now refuses to deploy changed content under a version that
is already installed.** CLAUDE.md has said "bump before deploying" from the
start, and it was broken anyway: 2.1.15 went out, four more changes were made on
top, and all of them deployed still stamped 2.1.15. The pack list is the only
place the version is visible in game, so one number meaning two builds makes it
a liar — and the symptom is reloading the world, seeing the same number, and
reasonably concluding nothing deployed.

A rule in a document did not stop that. A tool that refuses does, which is the
same shape as `release.py` refusing a build the engine has never run. It stores
a fingerprint of everything that ships in `.deployed.json`; re-deploying the
same build is still fine, changing one byte without bumping is not.

## 2.1.16 — 2026-09-10

**The selector picker is back.** Typing `/slay ` offers `@a @e @p @r @s` and
every filter again, the way vanilla does, and a Location argument suggests `~`
or the coordinates of the block you are looking at.

2.1.13 had downgraded every selector parameter to a plain String to dodge
"insufficient permissions for selector expansion", and that cure was worse than
the disease: it turned the argument into a blank text box. A blank text box is
no use at all to somebody who does not already know selector syntax — which is
most of the audience for a command set whose entire purpose is handing power to
people who are not operators. It was a real cost and it should have been a
decision, not a comment.

`/gm` has always used a real `PlayerSelector` and has always worked, which was
sitting there the whole time as evidence the blanket downgrade was unnecessary.
`render()` now handles both shapes, so if the refusal ever comes back for a
non-operator the way back is one line, written out in the file.

**Two selectors in one command no longer collide.** Found by a second pass
before this shipped, not after. Every selector in a line was sharing one tag,
so `/move <cow> <steve>` came out as

    teleport @e[tag=T] @e[tag=T]

— both sides resolving to the same set, teleporting everything to itself. Hits
`/move`, `/mount` and `/dialog`. Each selector parameter now gets its own tag,
and the tag travels with the entity into cleanup so the right one comes off.

**Vanish no longer leaks upward either.** It announces itself rather than going
through the audit system, which meant it also skipped the rank rule 2.1.15 added
everywhere else — a moderator was watching an admin disappear, which rather
defeats the point of disappearing. `/vanished` was the same leak by another
door: it listed everyone hidden with no rank filter at all, so anyone who could
not be told could simply look it up. Both use the same predicate as the audit
announcer now. It also lists LIVE players rather than stored names, because
somebody who logged off while vanished is not vanished, they are offline.

### Eleven more commands read against Microsoft's reference

`python tools/commands.py` prints the table with the verified column. **15 of 55
now**, up from 4. Four were genuinely broken:

- **`/exp` could never have worked.** It demanded a mandatory `levels|points`
  unit, which is *Java's* grammar — Bedrock is `/xp <amount> [player]`. So
  `/exp 30 levels @s` emitted `xp 30 levels @s` and was rejected every time.
- **`/sum` had `nameTag` in position three, where vanilla expects `yRot`**, so
  `/sum zombie ~ ~ ~ Bob` handed a name to a rotation. `spawnEvent` was
  unreachable entirely — no baby zombies, no charged creepers.
- **`/eff` was seven effects short**: the whole 1.21 batch, six of them from
  trial chambers.
- **`/ench` was missing `breach` and `lunge`**, the mace enchantments.

Two more had the right shape and an incomplete vocabulary: **`/sky query`** and
**`/diff p`** are both things vanilla accepts and this pack was refusing.

Correct as they stood, now confirmed rather than assumed: `/slay`, `/gift`,
`/wipe`, `/region`, `/block`.

## 2.1.15 — 2026-09-10

**Staff notices no longer leak upward: you cannot watch your seniors work.**

Reported from a live world — a moderator could see an operator opening a
player's inventory and ender chest. The audience rule had only ever checked one
thing, that the viewer outranked the **target**, and never looked at who was
**acting**. A moderator does outrank an ordinary player, so an operator's every
move on that player was announced straight to them.

It is now two rank lines: above the target, **and** not below the actor.

They are deliberately different strengths. *Acting* on somebody requires rank
strictly above them, so two peers cannot punish each other. *Seeing* an action
only requires being level, because peers reviewing each other's moderation is
the entire point of having an audit trail — two moderators still see each
other's kicks.

**The honest consequence, stated rather than discovered later:** the top of the
ladder now answers to nobody. An owner acting on a moderator is announced to no
one at all, because every remaining candidate is below them. The action is
still written to the log — this rule governs the chat line, not the record, and
the log has always stored the real gamertag.

**A mute now carries a tag, `ap:muted`, so the state is visible from inside the
game.**

The record in storage is still what blocks chat — it holds the reason and the
expiry, and a tag holds neither. The tag exists because storage is *invisible*:
when somebody said "I am still muted" and the panel said they were not, there
was no way to tell who was wrong without reading a dynamic property nobody can
read in game. `/tag <player> list` answers it now.

**Either half is enough to act on.** `/unmute` clears the record *and* the tag,
whichever is present, so a mute that has come apart can always be lifted by the
ordinary command instead of the player being stuck while staff work out which
half is lying. `syncMuteTag` also runs from the chat gate — the exact place a
stuck mute surfaces, because somebody tries to talk and cannot — and puts the
two back in step, writing only when they actually disagree. The common drift is
a *timed* mute running out: a record carries an expiry and a tag cannot, so the
tag outlives it.

**And the commands say what happened.** `/mute` on somebody already muted
reports "Already muted" rather than silently re-applying, which would have reset
a running timer without a word. `/unmute` on somebody who is not muted reports
"Not muted" — and says it every time now, not only when nothing else in the
selector succeeded, because swallowing it whenever some *other* player got
unmuted is how a real mute hides behind a successful one. A leftover tag with no
record reports itself distinctly: "cleared a leftover mute tag — they were not
actually muted."

**This is also the likely cause of the reported symptom.** The panel's button
chose its label from `isMuted()` alone, so a player carrying a stuck tag was
offered **Mute** rather than Unmute — and somebody trying to free themselves
muted themselves instead, with the button still reading Mute afterwards. Both
the label and what the button does now consider the tag.

**Unmuting is no longer rank-gated, and a mass mute is survivable again.**

`/mute @a` silences every peer — and because lifting a mute ALSO required
`canActOn`, none of them could unmute each other. A moderator could not free
another moderator, so the only way out of a room-wide mute was the one person
who cast it. Reported from a live world.

Muting stays ranked, because it is punitive and a junior must not be able to
silence a senior. **Unmuting is restorative and the risk runs the other way:**
the worst case without a rank check is that somebody speaks who should not,
which any staff member can undo in one command. The worst case with it is a
room full of staff who cannot talk and cannot help each other. `admin.mute` is
still required, so this is open to everyone already trusted to mute — nobody
else. The panel makes the same split: the Mute button still needs rank over the
target, the Unmute button appears whenever they are actually muted.

**`{NAME}` is the gamertag. `{NICKNAME}` is what they call themselves.**

Before this, every one of the nine places that fills a name token filled
`{NAME}` with `displayName()` — the nickname when one was set. There was no
token at all for the real account name, which is the name you ban under and the
one the audit log stores, so a format string simply could not ask for it.

Both are now always offered and the template chooses. `{NICKNAME}` falls back to
the gamertag rather than rendering empty, because these strings are edited by
hand and a token that silently disappears leaves a chat line reading
"  joined the game" with nobody in it.

**Nothing looks different.** The shipped formats were switched to `{NICKNAME}`
in the same change, so a nicknamed player still joins, chats and emotes under
the name everyone watched them wear. What changed is that `{NAME}` now means
something, and the Settings help text says which is which.

One helper — `nameTokens()` in `core/identity.js` — fills both everywhere, so
the nine sites cannot drift apart the way they did to get here.

**The `z` prefix is gone. `/a:zfill` is now `/a:fill`.**

The prefix existed for one reason: the in-game command list is sorted
alphabetically, and a pack gets exactly one namespace, so "z" was the only
thing that would push all 56 vanilla passthroughs below the pack's own, whose
names run from admin to warps. That is a real convenience, and it has been
traded away. It was not worth a leading letter of noise on every single name —
`/a:zfill` reads as a typo — and the standing decision in CLAUDE.md was already
"bare command names". The prefix was the thing out of step.

Checked before doing it: of the 56 vanilla names, exactly **one** actually
collided with a command this pack already owns, and that is `tp`.

**All 56 got a new name, and none of them may be a name the game owns.** That
second part is the whole point, and the first attempt at this got it wrong by
leaving 27 commands on their vanilla name on the grounds that `kill` and `fill`
were already short enough. The pack's own verifier had the answer written down:

> a custom command registers namespaced, and the bare form only reaches the
> player if nothing else claims it

So `/kill` never reaches `/a:kill`. It reaches the **game's** kill, and this
pack's version stays stranded behind the full `/a:kill`, colon and all. That is
slower to type, and worse than slow — the people this entire command set exists
for hold a rank and **no operator**, and vanilla's kill refuses them. A
colliding name does not merely cost them keystrokes; it puts the command out of
reach by the short path entirely.

`tests/vanillacmds.test.js` now fails the suite if any codename appears in
`GAME_OWNED`, so this cannot come back.

**The naming rule.** A name is shortened only where shortening leaves something
a person can still read at a glance. `/gm` works as an abbreviation because
everybody already types it in Minecraft; `/fl` would not, because nobody does.

- Long names took the shortening people already say out loud — `camera` →
  **`cam`**, `difficulty` → **`diff`**, `damage` → **`dmg`**, `effect` →
  **`eff`**, `enchant` → **`ench`**, `structure` → **`struct`**,
  `playanimation` → **`anim`**, `inputpermission` → **`input`**,
  `controlscheme` → **`controls`**, `spreadplayers` → **`spread`**,
  `tickingarea` → **`ticking`**, `dialogue` → **`dialog`**.
- Names that could not shrink without turning into initials got a real WORD,
  taken from what the command actually does — `testfor` → **`count`** (it
  counts entities; the help text says so), `camerashake` → **`shake`**,
  `setblock` → **`block`**, `replaceitem` → **`slot`** (it writes an item into
  a slot), `toggledownfall` → **`rain`**, `gamerule` → **`rule`**, `playsound`
  → **`sound`**, `stopsound` → **`soundoff`**, `scoreboard` → **`score`**,
  `testforblock` → **`checkblock`**, `testforblocks` → **`checkarea`**,
  `spawnpoint` → **`setspawn`**, `clearspawnpoint` → **`unspawn`**,
  `setworldspawn` → **`worldspawn`**, `kill` → **`slay`**, `give` →
  **`gift`**, `clear` → **`wipe`**, `fill` → **`region`**, `clone` →
  **`copy`**, `locate` → **`find`**, `loot` → **`drops`**, `time` →
  **`clock`**, `weather` → **`sky`**, `tag` → **`label`**, `ride` →
  **`mount`**, `event` → **`trigger`**, `recipe` → **`unlock`**, `place` →
  **`feature`**, `fog` → **`mist`**, `daylock` → **`lockday`**, `mobevent` →
  **`mobs`**, `say` → **`announce`**, `tellraw` → **`rawtell`**, `title` →
  **`showtitle`**, `titleraw` → **`rawtitle`**, `hud` → **`overlay`**,
  `particle` → **`fx`**.
- And where a plain shortening was enough, it was used — `music` → **`mus`**,
  `xp` → **`exp`**.

Teleport was the awkward one. Bedrock ships `tp` and `teleport` as the same
command under two names and the table carries both, so both need one. Splitting
them into a `/bring` and a `/goto` was considered and dropped: those read
beautifully for a player target and cannot express `~ ~10 ~` at all, which is
most of what teleport is for. So they keep vanilla's own shape, one short and
one long — **`port`** and **`move`**, the latter chosen because it reads as a
sentence with any destination: `/move @p ~ ~10 ~`, `/move @s @e[c=1]`.

`gamemode` is **`gmode`**, because it would otherwise sit next to this pack's
own `/a:gm` — which does the same job through the script API and is the one to
reach for — with the two reading as the same command with a typo between them.

**`say` is gone entirely, so there are 55 passthroughs now, not 56.**
`/broadcast` is the same act done better: it picks an audience (everyone, or one
chat channel), it writes an audit record, and it tells you how many people it
reached. Keeping a `say` beside it would have been two ways to do one thing with
the worse one unlogged — and "never punish or announce without a record" is why
the log exists. Removed from the parameter table, from the op-command allowlist,
and from the codename map together, so nothing is left registering a command the
settings screen cannot switch on.

Where a registration is not called what the vanilla command is called, the
description now says so — `/a:count` describes itself as `(vanilla /testfor)`,
so nobody has to read the source to find out.

**Permissions are untouched.** `commandNode()` builds `cmd.<vanilla name>` from
the command text at run time, so a rank holding `cmd.fill` never knew or cared
what the registration was called. This rename is cosmetic all the way down,
which is why it was safe to do in one pass.

**This renames commands that shipped.** The z-prefixed names went out in 2.0.4
and are in the tagged v2.0.5, so anyone already typing `/a:zkill` will find it
gone. That is five days of exposure and the names were never advertised
anywhere; keeping them alive as hidden aliases would have meant 167
registrations, a count Bedrock has never been tested at here, to preserve
muscle memory that has barely had time to form.

**A test that had been agreeing with itself now actually checks.** The old
block built its expectation with `COMMANDS.map(c => \`z${c.name}\`)` — it wrote
down the naming rule and then confirmed its own arithmetic, so when the prefix
was removed every assertion still passed while testing nothing. It now calls
the real `codenameFor` and pins what matters: no two commands register the same
name, none collides with one the pack already owns, and none is a name the game
owns.

**`tools/verify.py` was blind to all 56 for one build, and is not now.** It
finds commands by matching `name: "literal"`, and the passthroughs register in
a loop as `name: registered` — a variable. So the moment the prefix came out,
the verifier stopped seeing them: it reported "53 commands" while 56 more went
unchecked for duplicates and unchecked against the eight-parameter limit, and
said nothing was wrong. It now reads them out of the table and resolves them
through the same `CODENAME` map the pack registers with, and refuses to
continue if it does not find exactly 56.

---

## 2.1.14 — 2026-09-07

**Ranks stack. The only thing a grant takes away is Member.**

A rank is something a player HOLDS, not a slot they occupy. Granting Admin to
somebody who is also a Builder now leaves them both — the grant adds, it does
not evict. Admin simply goes in front, because staff ranks take the nametag.

The one rank any grant replaces is the **default** one, Member. That is what
everybody has for want of anything else, so holding it beside a real rank means
nothing, and every ladder's ranks inherit it anyway.

**It goes whatever the new rank weighs.** This is the part that was wrong: the
old rule dropped ranks *weaker* than the one being granted, and a newly created
rank lands at the BOTTOM of the ladder — below Member. So Member outweighed it
and survived, and every fresh rank left the player sitting as
Member-and-that-rank. A rank below Member on the ladder now replaces Member just
as a rank above it does.

**"Replaces lower ranks when granted" is gone** from both the create and the
basics screen. Ranks always stack now, so the switch had nothing left to
control, and a switch that does nothing is worse than no switch.

A rank created from the panel now **inherits the default rank**, so replacing
Member cannot quietly cost somebody the basics everybody starts with. Ranks in
the shipped presets already did this.

Nothing needs re-applying, and nobody loses a rank they hold.

---

## 2.1.13 — 2026-09-07

**Two bugs that stopped 2.1.12 working at all. Both found in a playtest.**

**`limit=1` is Java.** Bedrock counts with `c=1`, and it does not fail quietly —
the selector 2.1.12 built to name you came back as
`Syntax error: Unexpected "limit"` on every single command. `/zfill`, `/zkill`,
all of them. It is `@a[tag=…,c=1]` now.

**Selectors are taken as text, not resolved by the engine.** `/a:zkill @p` was
refused with *insufficient permissions for selector expansion* before any of
this pack's code ran, because the game expands a custom command's selector
argument at the **caller's** permission level — and a caller with a rank and no
op is precisely who `/a:z*` exists for. The selector is now passed straight
through and the dimension expands it when the command runs, at operator level,
which is the same mechanism everything else here already uses.

The cost, said plainly: the game's selector auto-completion is gone for those
arguments, and the set resolves when the command runs rather than when it was
typed. A selector carrying spaces has to be quoted — `"@e[type=cow, r=5]"` — and
the quotes come back off before it runs. Item names, block names, enums and
coordinates all still complete as they did.

---

## 2.1.12 — 2026-09-07

**Commands run as you now, properly. Nothing defaults to the server any more.**

2.1.11 fixed the permission half of this: `execute as` was replacing the
executor with the player, so the command ran at *their* level and being handed
to the dimension bought nothing. It became `execute at`, which keeps the server
as the executor.

That left a second half, and it is the one that broke the commands people
actually type. `execute as` did not only decide what `@s` meant — it decided
what a **left-out target** meant. `/gamemode creative` names nobody, so there is
no `@s` for the rewrite to catch; it just quietly meant "the executor", which is
now the server.

Every target is written in explicitly before the command runs. These all mean
you again:

| you type | it runs |
|---|---|
| `/gamemode creative` | on you |
| `/kill` | on you, not on everything |
| `/clear` | your inventory |
| `/spawnpoint`, `/spawnpoint 10 64 30` | yours |
| `/clearspawnpoint` | yours |
| `/xp 30`, `/xp 30 levels` | to you |
| `/playsound note.harp` | to you |
| `/tp 10 64 30`, `/tp ~ ~10 ~`, `/tp Steve` | moves **you** |

and `/tp Steve Alex` still moves Steve, because naming two people has always
meant that. `~ ~ ~` is still where you are standing.

It is a curated list, and deliberately so. A command whose target is required
has nothing to default to and is never touched — `/give`, `/effect`, `/enchant`,
`/tag` and the rest go through exactly as typed. Where a command could honestly
be read either way it is left alone and the game answers, because guessing wrong
would not fail, it would silently act on somebody else.

Arguments are counted the way the game counts them, so a selector carrying
spaces — `@e[type=cow, r=5]` — is one argument and not three, and a second
target is never written into a command that already had one.

Applies everywhere commands run: `/cmd`, all of `/a:z*`, and the creator
console.

---

## 2.1.11 — 2026-09-07

**"Insufficient permission" is fixed. It was one word in one line.**

2.1.10 collapsed three permission gates into one, and `/a:tp` still answered
*insufficient permission* for anybody without operator. The gates were never the
problem.

Every vanilla command this pack runs is handed to the DIMENSION, because a
command run from a dimension executes at operator level whatever the person who
asked for it holds. That is the whole mechanism. But it was wrapped in

    execute as "<player>" at @s run <command>

and `execute as` **replaces the executor with that player** — so the inner
command was dispatched at *their* permission level, and handing it to the
dimension bought exactly nothing. It only ever worked for people who already had
op, which is why it looked like a ranks bug and was not one.

It is now

    execute at <that player> run <command>

`at` moves position, rotation and dimension only; the executor stays the server.
`~ ~ ~` still means where you are standing.

`@s` no longer means you under `at` — it would mean the server — so it is
rewritten to a selector naming exactly you. A temporary tag, not your name, so
two players with the same name cannot both be hit; `@s[r=5]` keeps its own
arguments, merged rather than trailing; the tag is removed the moment the
command returns.

Fixes `/a:tp` and the rest of `/a:z*`, `/cmd`, and the creator console for
everybody whose rank was supposed to grant them.

---

## 2.1.10 — 2026-09-06

**One gate for vanilla commands, and they are on by default.**

`/a:tp` could be refused by three separate checks: the world whitelist, an
`admin.commands` node absent from every shipped ladder, and the per-command
node. Three answers to one question, and "insufficient permission" never said
which had refused. Two are gone.

What is left is one per-rank switch, and it is **allow by default** — the
question is no longer "were you granted this" but "did somebody take it away".
Switch a command off for a rank in **Ranks ▸ the rank ▸ Permissions ▸
Operator**; wildcards and inheritance work as they do everywhere else.

Nothing needs turning on, and no ladder needs re-applying.

**`op` and `deop` can never be run this way**, along with the wrappers that
carry anything behind them (`execute`, `function`, `scriptevent`, `schedule`),
`kick`, and the dedicated-server admin commands. That list is not a setting,
because a setting that can grant `op` is `op`.

## 2.1.9 — 2026-09-06

**A chat log — /admin ▸ Logs ▸ Chat.**

The action log says who did what TO somebody. This says what was actually said,
which is the other half of most moderation calls: an argument gets reported
twenty minutes late, and without it the only honest answer is "I wasn't there."

Recent, a search over words or names, and — on any player in Logs ▸ Players —
a third view beside *Received* and *Did*: **Said**.

**Private messages are never in here.** That is a boundary, not an oversight.
This hangs off the channel funnel that public chat uses; `/pm` and private chat
send straight to the players involved and never pass through it, so they cannot
be recorded by accident. Players can switch those off in their own settings, and
a log that kept them anyway would make that preference a lie. `/sudo` **is**
recorded, because it goes through the same funnel — a line somebody was *made*
to say is the one most worth having a record of.

**Its own table and its own cap** (`logs.chatCap`, 200 lines). Chat outruns
staff actions by orders of magnitude, so sharing the audit log's ring buffer
would have pushed every ban and mute out of Recent within minutes — chat would
have destroyed the record it is meant to support.

It stores what was typed, not the decorated line: no colour codes, no rank
prefix. `logs.chat` switches the whole thing off.

## 2.1.8 — 2026-09-06

**A permission per vanilla command — Ranks ▸ the rank ▸ Permissions ▸ Operator.**

Fifty-six new nodes, one per command, so a rank can hold `/a:zkill` and be
refused `/a:zgamemode`. That matters most where a vanilla command **duplicates
something this pack already does better**: `/gm` makes `cmd.gamemode` redundant,
and the pack's own `/tp` outranks `cmd.teleport`.

**Two layers, and both have to agree.** `commands.allowed` is the world asking
*does this command exist here at all*; the `cmd.<name>` node is the ladder
asking *who may use it*. A node can never widen the whitelist — turning one on
for a command the world has switched off still runs nothing.

**They are ordinary nodes**, which is the whole point of making them nodes
rather than a second list: `cmd.*` grants the set, a rank **inherits** them from
the rank below, and `-cmd.gamemode` carves a hole in an inherited wildcard.
Nothing about them is special-cased, so everything you already know about
permissions applies.

The Operator group is **paged, fourteen at a time**. Fifty-six switches in one
form is the shape that has now bitten this pack twice, and on *this* screen a
short response would quietly strip permissions from a rank rather than merely
lose a setting.

The rule that every declared node must actually be checked still holds. These
are checked dynamically, so no literal `"cmd.kill"` exists for it to find — so
the test now pins the single line in `execute.js` that enforces them instead.
Delete that line and the suite fails.

## 2.1.7 — 2026-09-06

**`/ec` and `/enderchest` are one screen now — invsee, for ender chests.**

Open it and you get the chest grid: their ender chest on top, their inventory
below. Tap a stack to lift it, tap anywhere to set it down, swapping with
whatever was there. On somebody else's, a tap takes the item off them — looking
needs `admin.invsee`, taking needs to outrank them, and both are logged.

**Both attempts at real dragging are gone.** A container cannot be opened from
script, so one has to exist somewhere you can touch — and every arrangement of
that was worse than the grid:

- the **entity marker** needed a tap and could not be aimed past;
- **riding** one took the player's input away instead of giving them the chest;
- the **real ender chest block** matched the vanilla screen exactly and then left
  ender chests lying around, which is not a trade worth making.

The setting that chose between them is gone too, rather than left switching
nothing.

**The break row is empty again.** The held stack and the drag button were drawn
into it, which rendered as items floating in what is meant to read as a gap. The
stack you are carrying is named in the title instead.

**Ships OFF.** `feature.enderchest` is `false` — a world that wants it turns it
on, and nobody inherits it in an update.

## 2.1.6 — 2026-09-06

**The ender chest's hotbar row was bound to nothing.**

Caught in the content log rather than by eye, which is the only place it showed:
nine `Unknown property [collection_index]` errors, one per cell.

The hotbar had been lifted out of the grid and placed cell by cell, so the gap
above it could be six pixels — the thickness of the panel's own edge, the way the
game separates it — rather than a whole 18px row. **`collection_index` does not
exist in this JSON-UI version.** Those nine cells bound to no data at all, and
nothing about that is visible from inside the game; the row simply draws empty.

Nothing else can address a collection by index, and a grid always starts at zero
with uniform rows. So a break can be a whole row or nothing, at any price. The
one under the chest earns its row. The one above the hotbar does not, so the
hotbar now sits directly under the pack, and every cell comes from the grid
again. A test pins that no cell is ever placed outside it.

## 2.1.5 — 2026-09-06

**Permissions showed as off for things a rank plainly had.**

Reported from a world, and real: the rank editor read a rank's own `perms` list
literally, so anything reaching that rank by **inheritance** or through a
**wildcard** rendered as off. An Admin inherits most of Mod and holds `chat.*`,
so row after row read off while the holder obviously had the thing.

The switch still means "what this rank states itself", because that is what it
writes — flipping it on writes the node, flipping it off does not write a
denial. What is new is the line beneath it: **"has it already, inherited"**, or
**"denied further up the ladder"**. The control answers one question and the
note answers the other, instead of one control appearing to answer both and
getting it wrong.

It resolves through the same path `has()` uses rather than a second copy of the
inheritance rules, because a second copy drifts and the screen starts lying
again somewhere nobody looks.

## 2.1.4 — 2026-09-06

**Two screens that quietly contained other screens.**

**Settings had eight doors, and one of them was all the others.** Automod,
Configuration, Teleport tuning and Op commands each edit settings that **All
values** also edited — two routes to the same value, looking nothing alike, with
the catch-all being the sixty-field form that had just been corrupting toggles.

All values is now **one group at a time**: a list of the twenty groups, each
opening its own small screen. The largest is fourteen fields. Editing one group
can no longer touch another, and the form that made a short response dangerous
does not exist any more — which removes the bug class rather than the symptom
2.1.3 patched.

**"Permission bundles" and "Permissions" looked like the same thing, and one of
them was lying.** Permissions are the real switches — every one is a node the
code checks. Bundles were never stored; they only ever wrote permissions. Two
screens of identical toggles, and nothing said which was the state and which the
shortcut.

They were also **quietly destructive**. Every node in *Moderation — light* sits
inside *Moderation — full*, and a bundle showed as ON once you held all of it —
so ticking the full one lit the light one too, untouched, and unticking that
stripped eight permissions back out of the bundle you actually wanted. Same trap
across the three chat bundles, which all contain `chat.staff`.

Bundles are now **Quick fill**, inside the Permissions screen: press one and it
*adds* that set, then you fine-tune with the switches. Nothing there can take a
permission away, and a rank's permissions live in exactly one place.

## 2.1.3 — 2026-09-06

**Op commands ship OFF, and there is a screen for them.**

`commands.allowed` used to arrive with **fifty-six vanilla commands already
enabled** — `give`, `gamemode`, `effect`, `summon`, `fill`, `enchant`, `tp` and
the rest. The setting's own notes had argued the opposite the whole time: that
an empty list "makes turning `/cmd` on a deliberate act rather than a default".
The comment was right and the value disagreed with it. Now nothing is on until
somebody turns it on.

**Settings ▸ Op commands** is the new door: every command with a switch beside
it, rather than a comma-separated string you had to type without a typo. It is
the same `commands.allowed` underneath — one list, one gate — just one you can
read. Anything you added by hand that the screen does not list is kept rather
than quietly dropped.

It is **paged, fourteen at a time**, and that is not tidiness. Fifty-six toggles
in one form is exactly the shape that produced the bug below.

**Worlds that already set their own list keep it** — only worlds still on the
default are affected, which is the point. Note that the `/a:` commands are all
still registered: registration happens at startup, before world storage can be
read, so every command the screen *can* enable has to exist up front and refuse
until it is switched on.

---

**A setting you changed could come back unchanged — and worse.**

Reported from a world: Troll commands was switched on, submitted, and was still
off. **All values** is a sixty-field form, and answers are paired to fields by
index, so if a response ever comes back short every key past the cut arrives as
nothing at all. Nothing was being read as an answer:

- a **toggle** became `false`, so settings nobody touched turned themselves off;
- a **text field** became empty — and empty *differs from the default*, so it
  was written. A short form could have blanked `commands.allowed`, which would
  have taken `/cmd` out of the world entirely.

A key with no answer now keeps the value it already had. Not skipped, either:
submitting replaces the whole override table, so leaving a key out would revert
it to the shipped default — the same bug in different clothing.

**Picking up and putting down.** Tap a stack in `/ec` and it lifts; tap any
other slot and it goes there, swapping with whatever was in the way, exactly as
dropping onto an occupied slot would. Tap where it came from to put it back. It
is dragging's outcome without the drag, which a form cannot do: a form's only
message back is "button N was pressed", so nothing could carry "slot 3 was
dropped onto slot 17" — no resource pack can add that, however much JSON-UI can
restyle a screen.

The block that 2.1.2 put in front of you is gone from the command. It matched
the vanilla screen and then added something the original never had: a chest
appearing in your world. It is still there as a button for anyone who wants
literal dragging and will spend a tap on it.

## 2.1.2 — 2026-09-06

**`/ec` gives you the real ender chest screen.**

Not a copy of it, not a grid drawn to resemble one — the genuine vanilla
container, because what you open is a genuine ender chest. It puts one in front
of you and takes it away again when you close it. Drag, shift-click,
double-click-to-fill: every behaviour anyone has ever learned in a chest, with
nothing reimplemented and nothing to keep in sync, because it is not a mirror of
your ender chest, it *is* your ender chest.

**Why it has to be a block.** A Java server's `/enderchest` opens instantly
because Bukkit has `player.openInventory(...)` — a method that opens a container
*for* a player. Bedrock has no equivalent, anywhere: not on `Player`, not on
`Container`, not in the new DDUI forms, and not as a command. Input cannot be
synthesised either — the input API can read and block, never inject. So the
engine only ever opens a container in response to a real interaction, and every
Bedrock addon that needs one does the same thing this now does: puts it in the
world and lets you open it. Riding an entity with a container was tried and is
worse — it takes your input away instead of giving you the chest.

**It is careful about your world**, since placing blocks in somebody else's
world is not a small thing:

- **it only ever replaces air**, so nothing you have built is overwritten — it
  tries the space in front of you, then above it, then over your head;
- **it cannot be mined.** An ender chest breaks into eight obsidian, so a placed
  one would be an obsidian generator: open, break, repeat. Ours refuses to break;
- **it disappears the moment you close it**, not on a timer — the engine cannot
  open a container for us but it does say when one closes;
- **it is only removed if it is still ours.** Break it or build over the spot and
  nothing gets punched out;
- **every placement is written to world storage**, so a crash cannot strand one.
  Anything left over is swept on the next load.

`/enderchest` still uses the entity marker, which is the route that also works
on *somebody else's* chest — a placed ender chest always shows whoever opens it
their own, so staff can never use one to look inside another player's.

## 2.1.1 — 2026-09-06

**The ender chest opens the moment you type the command.**

2.1.0 put a step in the way: `/ec` spawned something you had to tap before
anything appeared, which made the command feel broken. Now the screen opens
straight away and the draggable container is a button inside it, taken when you
actually want to move things about rather than every single time.

**Why it cannot simply open a draggable chest instantly**, since it is the
obvious question: a container cannot be opened from script at all. Checked
against the real type definitions for `@minecraft/server` and
`@minecraft/server-ui`, beta and stable — `Container` has thirteen methods and
every one is data, `Player` has nothing, the new DDUI `CustomForm` has no slot
control, and no vanilla command does it either. The engine only ever *observes*
a container opening. Forms are the mirror image: openable on demand, and
structurally unable to hold slots, because the only thing a form sends back is
"button N was pressed" — which is why the chest screen this pack has always
drawn is a form wearing a chest's clothes, and why no resource pack can add
dragging to it.

So a real container always costs one interaction, and the only open question is
which interaction costs least. **`/ec` and `/enderchest` are temporarily
different so the two candidates can be compared side by side** — one puts an
ender chest in front of you to tap, the other seats you so your own inventory
button opens it. They go back to being one command once one of them wins.

The marker is an actual ender chest now, rather than an invisible entity wearing
a floating "tap to open" label. That was a debug artifact and it looked like one.

## 2.1.0 — 2026-09-05

**`/menu` — the other half of panel-first.**

`/admin` exists so staff never have to memorise commands. Members had no such
thing: everything they were allowed to do was a command somebody had to tell
them about once, and they had to remember forever. `/menu` is the same idea
pointed the other way, and anybody can open it.

It is not a small `/admin`. The verbs are different — staff *act on* players,
members *reach* them — so the section is called **People**, and nothing in it
does anything to anybody without their say-so.

**Your stats sit above the buttons**, and they are answers rather than
statistics. Your name and rank, when you first joined, and then only what
applies: how many warnings you have, and — the one that earns its place —
**whether you are muted, why, and how long is left.** A muted player used to
type, watch nothing happen, and have to find a moderator to ask.

**Settings, which are yours alone.** Three switches to start:

- **Teleport requests** — turn them off and nobody can `/tpa` to you.
- **Private chat invites** — turn them off and nobody can open one with you.
- **Private messages** — turn them off and nobody can `/pm` you. **Staff always
  get through**, deliberately: a setting that let a player mute the moderators
  would be a hole rather than a preference. Teleports have no such exception,
  because staff who genuinely need you have `/a:tp`, which does not ask.

All three ship **on**, so anyone who never opens the menu is reachable exactly
as they are today. Turning something off is an act, not a starting state — and
only your differences from the default are stored, so changing a default later
still reaches everybody who never disagreed with it.

Vanished staff do not appear in the People list. A member seeing a hidden
moderator there would undo vanish entirely, and it would be this screen that
gave them away.

---

**`/enderchest` and `/ec` — and yes, you can drag in it.**

`/enderchest` opens your ender chest from anywhere. `/ec` is the same command
with less typing. `/enderchest <player>` opens somebody else's, for staff who
hold `admin.invsee` — taking anything out of it also needs you to outrank them,
and both looking and taking are written to the log.

This is worth having because **the ender chest is where contraband actually
sits.** It is the one container a search could never reach, and it survives
death. A player empties their pack before they get caught; they do not empty
this.

**It is a real container screen, not a menu.** Drag works. Shift-click works.
You are looking at the game's own container UI, so everything you already know
how to do in a chest works without anybody having implemented it.

When staff open somebody's chest while that player is standing at their own,
**the owner wins every disagreement.** The alternative was worse than untidy: a
view that wrote itself back each tick would put a diamond straight back after
the owner had taken it out, and now there would be two. So the owner takes
something and the watching admin sees it leave, live, rather than the two
screens fighting. Nothing is ever emptied to make this work, which is also why
a marker left behind by a crash can simply be deleted — it holds a copy and
never the only one.

Under it sits a chest screen laid out the way the game lays one out: the chest
on top, your pack below, the hotbar on its own row under a thin gap. It is the
fallback if the drag view cannot open, and it is what `enderchest.dragUI false`
gives you deliberately.

**This was twice written off as impossible here.** The script API documents no
ender chest on a player, and of every add-on installed on this machine — a full
essentials pack among them — not one touches it. All true, and the conclusion
was still wrong: `minecraft:ender_inventory` gives back an ordinary container.
The way that was settled was reading a pack that already did it, rather than
reasoning about documentation. Same for dragging, which forms genuinely cannot
do and a container entity genuinely can.

---

**A console, for the pack's own creator and developers.**

`/menu` shows a **Console** to the pack's Creator and to anyone wearing the new
`[Admin+ Dev]` badge — a command line that runs at operator level. A regular
member never sees it, and that is the entire point.

An add-on that handed its author authority inside a stranger's world would be a
backdoor. This is not one, and it is worth being specific about why:

- **It is a setting you can see.** `creator.console` ships on and sits in the
  config with everything else. Turn it off and it is shut, creator included.
- **It can only run your own whitelist.** It goes through the same gate `/cmd`
  does, so it can do nothing you have not already allowed — and it cannot `/op`,
  because op is not on that list and never can be.
- **It is watched.** Every command is logged *and* announced to online owners by
  name as it runs.

**`[Admin+ Dev]`** is the second badge, alongside `[Admin+ Creator]`, for
developers working on the pack. Same colours, same rules: no permissions, no
weight, not staff, outside the rank table, and gone the moment a world gives
that person a rank of its own. Who holds it is a list in the source, so adding
somebody is a release you can read in this file rather than something a running
world can do.

**A fix worth naming**, because it went the wrong way: the console originally
asked only for the `Dev` tag. Any staff member with `/tag` can hand that out, so
the gate between a member and a command line was one command wide. It now asks
for the tag **and** operator — the same gate `< Code >` has always used, which
grants an operator nothing they could not already type.

Also: the small chest screen has been drawn one pixel taller than its own
texture since the day it shipped. A new test that pins the resource pack and the
script to the same numbers found it immediately.

## 2.0.5 — 2026-09-05

**`/grant` — a rank that gives itself back.**

Ranks could always be handed out. They could never be handed *back* on their
own, so "Mod for the weekend" was something a person had to remember to undo.
Now the rank remembers.

`/grant <player>` opens one screen with the two questions: which rank, and for
how long. The length is a dropdown — permanent, an hour, six, twelve, a day,
three, seven, fourteen, thirty — because "how long" has about eight sensible
answers and typing 259200 is not one of them.

**Permanent is the first option and means no timer at all**, so the default
answer leaves ranks behaving exactly as they always have. A clock is something
you opt into, and re-granting a timed rank permanently really does stop the
clock rather than leaving one behind to fire later.

Expired ranks are taken back on a timer *and* when their holder joins, because
neither alone is enough: a world can run for a week without reloading, and a
grant that runs out while nobody is online has to be gone by the time its holder
walks back in.

Two things it is careful about. If a timed rank replaces lower ones, it says so
before it does it — **and warns that those do not come back** when the timer
ends. And a grant whose rank was later revoked by hand leaves a record pointing
at nothing; that is cleaned up quietly rather than resurrecting the rank.

## 2.0.4 — 2026-09-05

**The 56 vanilla commands actually exist now.** They are `/a:zkill`,
`/a:zgive`, `/a:zsetblock` — z-prefixed, at the bottom of the list.

2.0.2 and 2.0.3 both shipped them broken, and neither said so in game: every
registration was refused at startup and the commands simply were not there.

The cause, which took both attempts to pin down: **an add-on gets exactly one
command namespace.** They were meant to be `/cmd:kill`, and that is not
reachable. Registering the value lists under a second namespace is refused
outright, and commands carrying no arguments at all are refused with the same
complaint — so it is not about any one command, it is the whole pack.

Which leaves them sharing one alphabetical list with the pack's own 49
commands. The `z` is what keeps that list usable: our commands run from `admin`
to `warps`, so a `z` puts all 56 below every one of them in one block rather
than scattered between them. It settles a collision too — this pack already has
its own `/a:tp`, and vanilla's is now `/a:ztp`.

The command you type after the prefix is the real one: `/a:zkill @e[` opens the
game's own selector completion, with every filter it supports.

## 2.0.2 — 2026-09-05

**The vanilla commands complete their own arguments now.**

`/cmd` could offer you a command name and nothing after it. Type
`/cmd:kill @e[` and the game opens its own selector completion — every filter it
supports, because it is the engine doing the parsing rather than anything here.
Item and block names complete the same way, and a bad argument is refused before
the pack sees it.

Each of the 56 allowed commands is its own command now, under `cmd:`, carrying
the parameters it really takes: `kill` an entity selector, `give` a player, an
item and a count, `setblock` a position and a block, `summon` an entity type.

The reason it is 56 commands rather than one is worth stating, because it is not
a style choice: a command can only declare **one** set of parameters. A single
`/cmd` could never be an entity selector for `kill` and a position-and-block for
`setblock` at the same time. `/cmd` itself is gone; `/cmd:` replaces it.

This was previously called impossible here. It was not — the parameter types had
simply never been looked up. There are eleven of them, and this project's own
test stand-in declared four, which is what the claim had been resting on.

**Removed: Operator blocks.** `/give` already does it. Its permission node went
with it, because a permission that nothing checks is worse than none at all.

**The About screen writes its own command list.** The hand-typed one had drifted
to naming 19 of 51 commands and still advertised two that had been renamed. A
list of what exists should be read from what exists.

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
