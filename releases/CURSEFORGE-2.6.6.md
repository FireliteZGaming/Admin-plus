## Admin+ v2.6.6

Requires **Beta APIs** — world settings ▸ Game ▸ Experiments ▸ Beta APIs.
With it off the addon does nothing and says nothing.

### The logs actually work now

If you have ever opened Logs looking for something and not found it, this is
why: **half of what Admin+ recorded had no screen to read it on.** Automod
punishes people for spamming and you could not see why it did. Vanish, staff
mode, holograms, smite, chat screening and every `/a:` command anybody ran were
all being stored and none of them could be found.

`/admin ▸ Logs` is now three screens instead of one pile:

- **Actions** — what staff and the server did
- **Chat** — what people said *and wrote on signs*
- **Commands** — what was typed

**Signs are chat now.** They used to be filed as staff actions, so a sign turned
up in a list between a ban and a rank grant, while the Chat screen could not see
it at all. Lines read like chat, because that is what they are:

```
[Chat] Notch: anyone got spare iron
[Sign] Herobrine: FREE STUFF ->
```

Tap through for where the sign is. If somebody edited one, the entry keeps what
it said before — usually the whole reason you went looking.

**Commands are logged, including the ones that got refused.** That second part
is the useful half: somebody working down the command list trying what sticks
shows up as a column of red.

```
[Cmd] Steve: /a:eff mobs speed
[Cmd] Member: /ban Notch   — refused, no permission
```

Command blocks are in there too — who placed one and where.

Chat and commands each keep their own list with their own size limit, so a busy
server no longer pushes your bans and mutes off the end of the action log. Both
can be switched off in Settings if you would rather not keep them.

Search covers all three at once, because you usually know a word and not which
list it is in.

### Finding a player got faster

`/admin ▸ Actions` opens with **whoever you just acted on at the top**, then
whoever is standing nearest you. Muting somebody and then kicking them no longer
means hunting for the same name twice.

There is a **Search** button too — type part of a name, any capitalisation. It
matches **nicknames as well as gamertags**, so the name you saw in chat is the
name you can search for.

### `/eff` — you can stop guessing

`/a:eff` asks for a target first and the box was labelled `targets_or_me`, which
reads like you can leave it blank. You cannot, and that was the whole problem.

All of these always worked, and now the label says so:

```
/a:eff me speed 30
/a:eff all night_vision 60
/a:eff nearest jump_boost
/a:eff mobs invisibility
/a:eff NotSteve speed 30
/a:eff @a resistance 30
```

`/a:tp` had the same misleading label.

### Upgrading

Nothing to do. Old sign entries stay readable under their own heading until they
age out on their own.
