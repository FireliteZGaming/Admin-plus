## Admin+ v2.7.2 — Homes, Land Claims and Random Teleport

Requires **Beta APIs** — world settings ▸ Game ▸ Experiments ▸ Beta APIs.
With it off the addon does nothing and says nothing.

### Homes

```
/sethome        save where you are standing
/sethome base   save it under a name
/home           go back
/home base      go back to that one
/homes          see the ones you have
/delhome base   forget one
```

They are **yours**. Nobody else sees your homes — not other players, not staff.
Staff can see how many you have and nothing else. Your base coordinates are the
one thing on a survival server actually worth keeping to yourself.

Running `/sethome base` again just moves that home to where you are now. It
doesn't use up another slot.

How many you get depends on your rank, and the server owner decides that.

### Land claims

```
/claim          claim the ground around you
/claim 32       claim a 32-block square instead
/unclaim        give up the claim you are standing in
/trust Steve    let Steve build here
/untrust Steve  stop them
```

Claim the ground and nobody else can break blocks, place blocks, open your
chests, use your doors, touch your item frames or blow anything up inside it.

Claims are **full height** — your base, the mine underneath, the tower on top.
Not just the bit at eye level.

You pick a square centred on where you're standing. No walking to corners and
running two commands; just stand in the middle and say how big.

⚠ **Land claims are OFF until you turn them on.** They change who is allowed to
break blocks, which isn't something an update should switch on behind your back.
`Settings ▸ Configuration ▸ Land claims`.

⚠ **Staff need one switch turned on.** Moderators can build inside claims
through `Ranks ▸ the rank ▸ Permissions ▸ Staff tools ▸ claims` — so they can
deal with grief that happens on someone's land. It's already on for Mod in the
built-in rank ladders, but a world that has been running a while will need it
switched on once.

### Random teleport

```
/rtp    get dropped somewhere far away
```

It finds you somewhere safe — not in lava, not in the sea, not inside a
mountain, and in the Nether not on top of the bedrock roof.

It won't drop you near spawn either. There's a minimum distance as well as a
maximum, both adjustable in `Settings ▸ Configuration ▸ Random teleport`.

If it can't find anywhere safe it tells you instead of hanging — on a mostly
ocean world, just run it again, it looks somewhere different each time.

`/rtp` has its own cooldown on the rank, a minute by default. It's a long walk
back.

### Ranks can hold numbers now, not just on/off switches

`Ranks ▸ a rank ▸ Permissions ▸ Cooldowns & limits`

- Teleport cooldown
- `/home` cooldown — separate, so a long warp cooldown doesn't strand people
- How many homes
- How many land claims
- How big a claim can be
- `/rtp` cooldown

Set them to 0 to switch something off for a rank entirely. Staff ranks skip
cooldowns automatically; limits still apply to them, because how much of the
world someone takes up is your call rather than ours.

Lowering a limit never deletes anything. Homes and claims people already have
stay put — they just can't add more.

If you never knew teleport cooldowns were adjustable, this is why: they used to
live on a screen called "Meta values" with nothing else on it.

### Also

Waiting on `/home` no longer blocks a warp — cooldowns are tracked separately
per command now.
