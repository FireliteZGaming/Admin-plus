# Admin+ — Rank System Design (v0.1 draft)

Ranks are the spine of the pack: moderation, warps, TPA and homes all ask the rank
layer "is this allowed?". So this gets designed once, properly, and everything else
plugs into it.

Below: how the common Bedrock approach works, where it hurts, and what Admin+ does
instead. **Open decisions are marked ❓ — those are yours to call.**

---

## 1. The usual approach, and its four pain points

The typical Essentials-style rank layer is: ranks live in a table, a player "has" a
rank by carrying a tag, and a permission lookup walks the player's tags and takes the
**first one that mentions the node**.

| Pain point | What goes wrong in practice |
|---|---|
| **Tag-only storage** | You cannot promote or demote an offline player. Rank changes need the target online, which is miserable on a realm. |
| **Flat, first-match lookup** | Tag order is effectively arbitrary. A player holding `Member` + `Admin` may resolve `admin.ban` off whichever tag the engine sees first. |
| **No inheritance** | Every rank re-lists every node. Adding one player-facing perm means editing five ranks by hand. |
| **No hierarchy protection** | A Helper with `admin.ban` can ban the Owner. Nothing stops staff turning on each other. |

## 2. What Admin+ does

### 2.1 Storage: world table is the truth, tags are a mirror

The rank table and every player's assignment live in **world dynamic properties**
(chunked JSON). A tag `rank:<id>` is *also* written on the player, but only as a
mirror, so that:

- `/tag @a[tag=rank:admin]` and vanilla selectors keep working,
- other packs can read staff status,
- **but** rank changes still work while the target is offline — the table is keyed
  by player id with a name index, and the tag is re-synced the next time they join.

### 2.2 A rank

```jsonc
{
  "id": "mod",                 // stable key, also the tag suffix (rank:mod)
  "display": "§6Mod",          // what shows on nametag / chat
  "weight": 60,                // DERIVED from ladder position — never typed by hand
  "inherits": ["member"],      // pull in another rank's nodes
  "perms": ["admin.kick", "admin.mute", "-tpa.cooldown.bypass"],
  "meta": { "homes": 8, "tpCooldown": 0 },
  "staff": true,               // shorthand: counts as staff for staff-only channels
  "default": false             // auto-granted to anyone with no rank
}
```

### 2.2b Two orderings, kept apart

This is the distinction that makes the UI make sense:

- **Ladder order** (global, *Ranks ▸ Settings*) **is the hierarchy.** Row 1 outranks
  row 2. Everything about authority — precedence, protection, who may act on whom —
  comes from here. There are no weight numbers in the UI; you move rows up and down
  and `weight` is re-derived behind the scenes.
- **A player's own order** (*Ranks ▸ Players*) **is cosmetic.** It only picks which
  of their ranks is worn as the tag when they hold several. An Admin+Builder can
  show `[Builder]` and still have Admin's authority.

### 2.3 Permission resolution — weight, then specificity

1. Owners in `config.owners` short-circuit to **allow everything**.
2. The player's ranks are sorted **heaviest first**.
3. For each rank (its own nodes first, then everything it `inherits`), the
   **most specific** matching pattern wins:
   `exact node` ▸ `branch.*` (longer branch beats shorter) ▸ `*`.
4. A leading `-` is a **denial**. `admin.*` plus `-admin.ban` = everything but ban.
5. First rank with an opinion decides. No opinion anywhere → deny.

**Operators**: allowed unless a rank they hold *explicitly denies* the node. A silent
gap lets them through — that is what stops a fresh world locking its own host out of
`/admin` before any rank exists — but a deliberate `-admin.ban` on a rank they hold
still binds them.

The upshot: `Owner` always beats `Member`, regardless of tag order, and a rank can
grant a whole branch then carve one hole out of it.

### 2.4 Meta values instead of fake permission nodes

Numbers (home limit, teleport cooldown, warp cost) live in `meta`, not in nodes like
`homes.limit.8`. Resolution: **heaviest rank that defines the key wins**. Cleaner to
edit in a form, and typed.

### 2.5 Hierarchy protection (the one Essentials is missing)

Ladder position is not just display order — it is authority:

- You cannot moderate (kick/ban/mute/freeze) a player whose **strongest rank sits at
  or above yours**.
- You cannot grant, edit, delete, or reorder a rank **at or above your own row**.
- Config owners are immune to all of it.

A Mod therefore cannot touch an Admin, cannot promote themselves by editing the Admin
rank, and cannot drag their own rank up the ladder. This closes the standard
staff-escalation hole.

### 2.6 Permission bundles (the editor UX)

Bedrock forms are checkbox lists — 40 raw nodes is unusable. So the editor works in
**bundles**, with raw nodes still editable for power users:

| Bundle | Nodes |
|---|---|
| `Moderation — light` | kick, mute, freeze |
| `Moderation — full` | + ban, tempban, unban, invsee |
| `Teleport tools` | tp, tphere, bring, vanish |
| `World tools` | gamemode, fly, god, heal, feed |
| `Warp management` | setwarp, delwarp, setspawn |
| `Rank management` | create/edit/delete/grant ranks |
| `Player basics` | warp use, spawn, tpa, homes, back |
| `Everything` | `*` |

### 2.7 Presets

A preset is a whole ladder applied in one click (players keep their tags, so anyone
holding an id that still exists keeps their rank). Drafted:

| Preset | Ladder |
|---|---|
| **Classic SMP** | Owner ▸ Co-Owner ▸ Developer ▸ Admin ▸ Mod ▸ Helper ▸ Member |
| **Realm Minimal** | Owner ▸ Staff ▸ Member |
| **Lockdown** | Staff keep everything; members get spawn + warps only (no TPA, no homes) |
| **Donor Tiers** | Staff ladder + VIP ▸ VIP+ ▸ MVP with rising home limits |
| **Roleplay / Factions** | Overseer ▸ Warden + Citizen ▸ Merchant ▸ Noble |

Applying a preset is **destructive to the rank table** → confirm form, and the
previous table is kept as a one-step undo snapshot.

### 2.8 Display

- **Nametag**: `{RANK}\n§f{NAME}` — on by default.
- **Chat**: needs `world.beforeEvents.chatSend`, which is a **beta** API. On the
  stable runtime this is guarded and silently stays off; nametags still work.
  ❓ If you want rank prefixes in chat, the pack has to move to beta APIs
  (`@minecraft/server` beta) — that is a manifest-level decision.

---

## 3. Decisions

**Settled**

- Ladder position is the hierarchy; per-player order is cosmetic (§2.2b).
- Default ladder ships as **Owner ▸ Co-Owner ▸ Developer ▸ Admin ▸ Mod ▸ Member**.
- Default rank auto-granted on first join: **yes** (`member`).
- Rank protection as described in §2.5: **yes**.
- Management is panel-only — no `/setrank`-style commands.

**Still open ❓**

1. **Chat prefixes** — rank prefixes *in chat* need `world.beforeEvents.chatSend`,
   which is a **beta** API; nametags work on stable. Worth moving the pack to beta
   for? *Recommendation: no for now.*
2. **Multi-rank tags** — when someone holds several, show only the first
   (`§cAdmin`) or stack them (`[§cAdmin§8][§bBuilder§8]`)? *Currently: first only.*
3. **Preset list** — five ship today; want one themed for your realm?

---

## 4. One entry point: the panel

There are **no** `/setrank`, `/editrank`, `/createrank`, `/delrank` commands. Rank
management is entirely inside the admin panel.

Registered as `a:admin`, which Bedrock resolves down to a plain **`/admin`** whenever
nothing else claims that name — namespaced registration is required, but the bare form
works at the keyboard. The namespace is the short `a` precisely because it is only
ever typed where vanilla owns the name.

The same trick carries the player commands: `/warp`, `/warps`, `/home`, `/sethome`,
`/tpa`, `/back`, `/spawn` all type bare. Names vanilla already owns take the short
form: **`/a:tp`**. Commands mirror vanilla grammar — `/a:tp <dest>` moves you,
`/a:tp <victim> <dest>` moves them — and use real `PlayerSelector` / `Enum`
parameters so tab-completion fills names and vocabularies.

### Panel map

```
/admin
├─ Actions ──────── moderation and player tools            (not built yet)
├─ Ranks
│   ├─ Settings ─── the ladder, strongest at the top
│   │   ├─ <rank>   move up/down · basics · bundles · raw nodes · inherits · meta · delete
│   │   ├─ Create rank        (joins at the bottom)
│   │   ├─ Presets           (replace the ladder, confirm + one-step undo)
│   │   └─ Undo              (appears once a snapshot exists)
│   └─ Players ──── pick a player (online, or Known players for offline)
│       ├─ Add rank / Remove rank
│       ├─ Display order     (which of their ranks is worn as the tag)
│       └─ Set rank          (replace everything they hold)
├─ Warps ────────── named destinations and spawn           (not built yet)
├─ Money ────────── economy                                (not built yet)
└─ Settings ─────── feature switches, teleport tuning      (not built yet)
```

Player-facing commands stay as commands, since players live in them:
`/admin:warp`, `/admin:warps`, `/admin:spawn`, `/admin:tpa`, `/admin:tpaccept`,
`/admin:tpdeny`, `/admin:sethome`, `/admin:home`, `/admin:back`, `/admin:help`.
