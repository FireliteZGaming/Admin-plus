# Admin+ 2.5.10

Everything since 2.1.9 — 45 versions of it. Most of this is one long argument
with the same problem: a permission system is only worth anything if it holds
*everywhere*, and a feature is only worth anything if somebody can find it.

## New

**Four admin items**, all in `/items`, all behind their own switch.

- **The Ender Eye** — look somewhere, use it, be there. Or open it for a menu:
  pick a player off a list, or type coordinates and choose a dimension.
- **The Orbital Strike** — a fishing rod. Aim at anything within 300 blocks and
  use it once. The sky goes dark, a warden heartbeat starts up and quickens,
  and about eight seconds later a few hundred primed TNT come down in a spiral.
  Block damage is a setting, for realms that want the fear without the hole.
- **The Spectral Trident** — throw it. Red dust turns in the air around whoever
  it hits while their armour comes apart piece by piece, and it tells you what
  it broke rather than leaving you guessing.
- **The Mirror Totem** — everything that hits you hits whoever swung it
  instead, and you take none of it. 165 charges, counted in the item itself, so
  the charge survives being dropped, traded or left in a chest.

**`/info`** — a help system written for somebody who has never used a mod
before. Five pages, every command shown with an example that works if you type
it, and it only ever lists what *you* can actually use. New players are now told
it exists when they join — one line, a few seconds after they spawn, that only
they see.

**Automod acts on spam now.** Flooding chat gets a talking-to first, then 1, 5
and 10 minute mutes, escalating, and everything it hands out expires. It speaks
as **[Automod]**, never as staff, so nobody blames whoever happens to be online.
Ore-vein and break-rate alerts still only *alert* — those are guesses, and a
guess should never punish.

**The console runs Admin+'s own commands**, not just vanilla ones:

```
gm creative @a
ban Steve griefing the spawn again
tp @p
```

**Logs read as text**, grouped by day, instead of as a list of records.

## The rank ladder now holds everywhere

The biggest single sweep in this stretch. Every command, every admin item and
every screen was read against the hierarchy, and a lot of them were not asking:

- **Nothing reaches above you.** You cannot ban, mute, kick, freeze, teleport,
  inspect or use an item on somebody senior to you.
- **A peer cannot act on a peer**, which is a different rule from the one above
  and was being confused with it.
- **Staff notices no longer leak upward** — you cannot sit and watch your
  seniors work.
- **Every admin item answers to your rank**, not to whoever managed to pick it
  up.
- Troll tools sit behind one switch of their own, separate from moderation.

## Commands

All 55 vanilla passthrough commands were read against Microsoft's own reference.
Sixteen of them were wrong. Beyond that:

- **Commands run as you**, at your permission level, instead of quietly
  defaulting to the server.
- **Ranks stack.** The only thing a grant takes away is Member.
- **Plain English targets.** `/eff me speed`, `/eff everyone night_vision`,
  `/slay mobs` — `me`, `everyone`, `nearest`, `random` and `mobs` all work
  wherever a target goes, alongside `@s @a @p @r @e`. Previously the box was
  blank and offered nothing, so anyone who had never typed an `@` was stuck.
- `/tp @p` works, and a name means **the name you can see** — the nickname,
  not a hidden gamertag.
- "Insufficient permission" is gone. It was one word in one line.

## Fixed, including from reports here

- **Every rank you hold now shows, not just the top one.** Ranks have stacked
  for a long time, but the tag only ever drew the first of them — so granting
  somebody a second rank told them it had happened and then showed nothing.
  It is `[Owner][Elytra Mace]` now, staff first, in chat, above the head, in
  private messages and in the panel's lists. **How many rank tags show** caps it
  at three by default.
- **Blanking a rank's name now removes the tag.** It used to leave `§8[]` in
  dark grey on every line with no way to get rid of it — reported in the
  comments here, and the report was right.
- A name can no longer repaint the chat line it sits in.
- Four feature switches existed in the config but appeared on no screen at all.
- The orbital strike was detonating one tick before it landed, so it skimmed the
  surface instead of cratering. A TNT fuse is 80 ticks and nothing can change
  it, so the drop height *is* the timing — it was 78 blocks, which takes 79
  ticks to fall.

---

Admin+ is MIT licensed. The chest-grid interface uses Chest-UI under CC BY 4.0;
techniques from SafeGuard and UltraVanish were reimplemented rather than copied,
and no files of theirs ship. Full per-version detail is in `CHANGELOG.md` on
GitHub.
