# Admin+ — Logs (design, queued)

Essentials' `/logs` is a flat reverse-chronological list. It answers *"what
happened recently"* and nothing else. The two questions staff actually ask are:

- **"What has been done to this player?"** — they're appealing a ban, or claiming
  they were demoted unfairly.
- **"What has this staff member been doing?"** — the question you ask before
  removing someone's rank.

A flat feed answers neither without scrolling. So the log is indexed by **both
sides of every action**, and it can **undo** the ones that are reversible.

---

## 1. An entry

```jsonc
{
  "at": 1756742400000,
  "actor": { "id": "...", "name": "Firelite" },   // who did it
  "action": "rank.grant",                          // dotted, filterable by branch
  "target": { "id": "...", "name": "Nova" },       // who it happened to (optional)
  "detail": "mod",                                 // one short human string
  "undo": { "kind": "ranks", "ranks": ["member"] } // absent when irreversible
}
```

`action` is dotted so a filter can take a whole branch: `rank.*`, `mod.*`,
`config.*`. Storage is one capped table (`CONFIG.limits.logEntries`, default 300)
behaving as a ring buffer — oldest entry drops when full, so it can never grow
without bound on a long-running realm.

## 2. What gets logged

| Branch | Actions |
|---|---|
| `mod.*` | ban · tempban · unban · kick · mute · unmute · freeze · unfreeze |
| `rank.*` | grant · revoke · set · create · edit · delete · reorder · preset |
| `name.*` | nickname set · nickname cleared |
| `config.*` | code edit · factory reset |
| `chat.*` | channel created · edited · deleted |
| `player.*` | sudo · gamemode · teleport (staff-initiated only) |

Ordinary play is never logged. This is a record of **staff acting on other
people**, not a surveillance feed — a distinction worth keeping, or the useful
signal drowns.

## 3. The screens

```
/admin/logs/
├── recent/                # everything, newest first, paged
├── players/               # pick a player
│   └── <player>/
│       ├── received       # what was done TO them        ← the appeal view
│       └── did            # what THEY did as staff       ← the audit view
├── filter/                # by branch: moderation · ranks · names · config
└── search/                # free text over name + detail
```

Every entry renders as:

```
§8[14:32] §cBAN  §fNova §8· by Firelite
§8       Grief · 7d
```

and opens a detail screen with the full timestamp, both parties, and — when the
action is reversible — an **Undo** button.

## 4. Undo, the part Essentials has no answer for

| Action | Undo does |
|---|---|
| `mod.ban` / `mod.mute` / `mod.freeze` | lifts it |
| `rank.grant` / `rank.revoke` / `rank.set` | restores the exact rank list they held before |
| `name.set` | puts back the previous display name |
| `rank.preset` / `rank.delete` | restores from the ladder snapshot already kept |
| `config.edit` | restores the previous config block |

The `undo` payload stores the **prior state**, not a reverse instruction — that
way an undo is correct even if three other things changed in between. An entry
that has already been undone is marked and cannot be applied twice.

Undo obeys rank protection: you cannot undo an action taken by someone above you,
or one that would re-rank someone you cannot touch.

## 5. Open questions

1. **Retention** — 300 entries, or time-based (keep 14 days)? *Recommendation:
   count-based; predictable storage on a realm that may sit idle for weeks.*
2. **Who can read it** — `admin.logs` gates the hub, but should `received` be
   readable by the player themselves ("why was I banned")? *Recommendation: yes,
   their own `received` view only, so appeals start with facts.*
3. **Should teleports be logged at all?** They are high-volume and low-value.
   *Recommendation: log staff-initiated teleports onto other players only.*
