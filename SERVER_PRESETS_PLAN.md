# Admin+ — Server presets, Dev Power, /panel (design, queued)

Three things that arrived together. Written down so the break does not cost them.

---

## 1. Presets should describe a whole server, not one dimension

Today there are two unrelated preset systems:

- **Rank presets** (Ranks ▸ Presets) — swap the ladder.
- **Config presets** (`< Code >` ▸ Presets) — swap the settings block.

Applying "Realm" to the config and "Classic SMP" to the ladder is two separate
acts, and nothing says those two go together. The point being made: **a preset
should mean something** — a coherent server shape whose parts were chosen to
work with each other.

So a server preset names all of it at once:

```jsonc
{
  "id": "classic",
  "label": "Classic SMP",
  "description": "Owner ▸ Co-Owner ▸ Developer ▸ Admin ▸ Mod ▸ Helper ▸ Member, protected spawn, alerts on.",
  "ladder": "classic",          // an existing rank preset
  "config": { … },              // the settings that suit that ladder
  "channels": ["general", "staff"],
  "notes": "What this shape is FOR — read before applying."
}
```

Applying one is a single confirmed action that sets the ladder, the config and
the channels together, and **detection still works the same way**: change any
part and it reads **Custom**, because Custom is the honest answer whenever the
pieces no longer match a named shape.

Shipped shapes should be opinionated rather than exhaustive — each one an
argument about how a server is run:

| Shape | Ladder | Config leaning |
|---|---|---|
| **Classic SMP** | full staff ladder incl. Co-Owner + Developer | protected spawn, alerts on, normal teleports |
| **Realm (small)** | Owner ▸ Staff ▸ Member | quick teleports, light automod, chatty |
| **Locked down** | staff-heavy, members restricted | long warmups, wide protection, staff not exempt |
| **Quiet survival** | minimal ladder | no join/leave lines, no automod, nothing announced |

**Open question:** should applying a server preset also touch **warps** (it
cannot invent locations) — probably not, so it should say plainly that warps and
player ranks are left alone.

## 2. Dev Power

The addon's own authors get admin powers in any world running it.

- Identity is by **gamertag**, e.g. `FireliteZGaming`.
- Lives in the `< Code >` config as a switch (`dev.power`), so any server owner
  can turn it off. Default on.
- Developer rank now renders **bright pink** (`§d§lDeveloper`). *(done)*

**Two things to get right before this ships anywhere but your own worlds:**

1. **It must be disclosed, not hidden.** An undisclosed author backdoor in a
   distributed pack is the kind of thing that gets a pack pulled and a reputation
   with it — and it is trivially discoverable by anyone who opens the scripts.
   Stated openly in the About screen and the credits it is a *feature*
   ("the author can help you debug your server"); found by surprise it is a
   backdoor. Same code, entirely different reception.
2. **Names are weak identity.** A gamertag is verified in online play, but a
   local or cracked client can present any name. So Dev Power should require the
   name **and** operator status, never the name alone, and every use of it should
   land in the log (`dev.*`) so it is visible after the fact.

## 3. /panel

A separate command that opens **only for operators and devs**, holding the Dev
Power tools. Deliberately not `/admin`: that panel is the server's, this one is
the author's.

**Still needed:** what goes in it. Candidates from what already exists —
diagnostics (`/function check` in a screen), a storage inspector, a log dump,
forcing a config preset, resetting a corrupted table. Say which and it gets
built.

## 4. Credits

A screen naming the author, with Dev Power stated openly next to it, and the
packs whose *techniques* were learned from (SafeGuard's function-driven
messaging, UltraVanish's bone-scaling animation) — technique credited, no files
of theirs shipped. That claim should stay true and checkable.
