## Admin+ v2.5.10

Requires **Beta APIs** — world settings ▸ Game ▸ Experiments ▸ Beta APIs.
With it off the addon does nothing and says nothing.

45 versions since v2.1.9. The ones worth reading about:

### /info — the mod explaining itself
Written for somebody who has never used a mod: the ten-year-old who joined a
realm, saw a coloured tag next to their name and wanted to know what was going
on. Five pages, every command shown with an example that works if you type it,
and it only ever lists what *you* can use. New players are told it exists a few
seconds after they join, in a line only they see.

### Four admin items
In `/items` and `/mm`. The **Ender Eye** — look somewhere, use it, be there; or
open it for a player list and a coordinate entry with a dimension. The **Orbital
Strike** — a fishing rod. Aim at anything within 300 blocks; the sky goes dark,
a warden heartbeat starts and quickens, and eight seconds later a few hundred
primed TNT come down in a spiral. The **Spectral Trident** takes somebody's
armour apart piece by piece and tells you what it broke. The **Mirror Totem**
sends everything that hits you back at whoever swung it — 165 charges, counted
in the item, so they survive being dropped or traded. The last three sit behind
`Ranks ▸ Staff tools ▸ troll`.

### Automod punishes spam, and only spam
It acts now rather than watching: a talking-to, then 1, 5 and 10 minute mutes,
escalating, and everything it hands out expires. It speaks as **[Automod]**,
never as [Admin+], so nobody blames whichever staff happen to be online. Ore
veins and break rates still only alert — those are guesses, and a guess should
never punish.

### Nothing reaches above you
Every command, every admin item and every screen was read against the ladder.
You cannot ban, mute, kick, freeze, teleport, inspect or use an item on somebody
senior to you. A peer cannot act on a peer. Staff notices no longer leak upward,
so you cannot sit and watch your seniors work, and every admin item answers to
your rank rather than to whoever picked it up.

### Vanilla commands, read against the reference
All 55 checked against Microsoft's own documentation — sixteen were wrong. They
run as **you**, at your permission level, instead of quietly defaulting to the
server. And a target can be plain English: `/eff me speed`,
`/eff everyone night_vision`, `/slay mobs`, alongside `@s @a @p @r @e`.

### The console takes Admin+'s own commands
`gm creative @a`, `ban Steve griefing the spawn again`, `tp @p` — no prefix
needed. A line that is not one of ours still falls through to the vanilla
whitelist exactly as before.

### Logs read as text
`/admin ▸ Logs` is prose grouped by day now, instead of a list of records.

### Fixes
- **Every rank you hold shows, not just the top one.** Ranks have stacked for a
  long time, but the tag only ever drew the first of them — so granting somebody
  a second rank announced itself twice and then showed nothing. It is
  `[Owner][Elytra Mace]` now, staff first, in chat, above the head, in private
  messages and in the panel's lists.
- **Blanking a rank's name removes its tag**, instead of leaving `[]` in dark
  grey on every line with no way to get rid of it. Reported here, and the report
  was right.
- **The orbital strike only skimmed the surface.** A TNT fuse is 80 ticks and
  nothing in Bedrock can change it, so the drop height *is* the timing — it was
  78 blocks, which takes 79 ticks to fall.
- **A name could repaint the chat line it sat in.**
- **Four feature switches existed in the config and appeared on no screen.**
