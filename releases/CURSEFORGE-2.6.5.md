## Admin+ v2.6.5

Requires **Beta APIs** — world settings ▸ Game ▸ Experiments ▸ Beta APIs.
With it off the addon does nothing and says nothing.

### Pick a player off a list instead of typing their name

Commands that act on one person now open the game's own player list when you
get to the player argument. You scroll and pick, the same way vanilla commands
that take a player already work.

That covers `/nick`, `/sudo`, `/invsee`, `/grant`, `/report`, `/smite`, `/mm`,
`/tpa`, `/tpahere`, `/msg`, `/pm`, `/prchat`, `/vanish` and the private-chat
replies — alongside `/mute`, `/ban`, `/warn` and `/unmute`, which already had it.

Typing a gamertag exactly right is the most common way these commands fail, and
awkward names are exactly the ones most likely to need moderating.

**One thing to know before you update.** On those commands, `@a` / `@p` / `@s`
now need operator status. That is the cost of the picker — the game expands the
selector itself, and it checks who is asking. If you are an operator nothing
changes. If you are not, use the list, or leave the argument off entirely on the
commands that act on you anyway (`/vanish`, `/mm`).

`/tp` and `/gm` are deliberately **not** in that group, because targeting
everyone is genuinely useful there — `/a:tp @a spawn` and `/a:gm creative @a`
still work for everybody. So do all the vanilla passthroughs like `/a:kill` and
`/a:effect`.

### Also in this build

Everything from 2.6.4, which some of you will not have picked up yet: the
scripting module no longer pins a beta version that Minecraft has moved past —
the failure that leaves the pack listed in your world with nothing running — and
the **Permissions** screen under `Ranks ▸ a rank` went from 95 switches to 41,
grouped in plain words.

⚠ Carried over from 2.6.4, still worth knowing: **vanilla commands now need a
switch.** `Ranks ▸ the rank ▸ Permissions ▸ Server settings ▸ commands` decides
who may use `/a:give`, `/a:effect` and the rest. Owner, Manager and Developer
have it through their wildcards. A **Mod** who was using those will need it
turned on.
