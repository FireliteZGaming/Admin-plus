## Admin+ v2.6.4

Requires **Beta APIs** — world settings ▸ Game ▸ Experiments ▸ Beta APIs.
With it off the addon does nothing and says nothing.

### If Admin+ stopped working after the last Minecraft update, this is the fix

The symptom is a strange one and easy to misread: the pack is still in the
world, still listed, still ticked — and nothing happens. No `/admin`, no chat
formatting, no ranks. It looks broken rather than switched off.

That is what happens when an addon asks the game for a *specific* beta version
of the scripting API. Beta versions belong to a particular Minecraft build, and
when the game updates the old one stops being handed out. The pack then fails to
load its scripts at all, silently, while everything else about it looks fine.

Admin+ was asking for one of those. It now asks for whatever the current beta
is, so a Minecraft update moves it along instead of stranding it.

Nothing else about the addon changed for this. If it was working for you before,
it keeps working; if it had gone quiet, it should come back.

### Also in this build

The **Permissions** screen under `Ranks ▸ a rank` has been reorganised — fewer
switches, grouped in plainer words, ordered from what everyone gets down to the
things that can hand your server away. It is still being worked on, so it is not
the headline here.

One change in it is worth knowing before you update, because it can surprise you:

⚠ **Vanilla commands now need a switch.** `Ranks ▸ the rank ▸ Permissions ▸
Server settings ▸ commands` decides who may use `/a:give`, `/a:effect` and the
rest. Owner, Manager and Developer already have it through their wildcards. A
**Mod** who was using those commands will need it turned on.

The upside is that it replaced fifty-five separate switches — one per vanilla
command — that were on by default and that nobody had ever touched.
