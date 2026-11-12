import { world, system, CommandPermissionLevel } from "@minecraft/server"
import { CONFIG } from "../config.js"
import { Table, cleanId } from "./storage.js"
import { displayName, nameTokens, stripCodes, hasNickname, getNameFont, setNameDecorator } from "./identity.js"
import { render, renderTag, nameTagsEnabled, flag, setting } from "./settings.js"
import { STYLES, STYLE_IDS, paint, currentFrame } from "./nametag.js"
import { applyFont } from "./fonts.js"

// Admin+ rank engine — see RANKS_PLAN.md for the design rationale.
//
// Truth lives in two world tables:
//   ranks    id -> Rank
//   holders  playerId -> { name, ranks: string[], since: number }
// The "rank:<id>" tag on a player is only a MIRROR of `holders`, kept in sync on
// join and on every change. That ordering is what lets an offline player be
// promoted: the table takes the edit now, the tag catches up when they log in.

/**
 * @typedef {{
 *   id: string, display: string, weight: number, inherits: string[],
 *   perms: string[], meta: Record<string, number|string|boolean>,
 *   staff: boolean, default?: boolean
 * }} Rank
 */

const RANKS_KEY = "ranks"
const HOLDERS_KEY = "rankHolders"
const SNAPSHOT_KEY = "rankSnapshot"

/**
 * Player-facing baseline every ladder gives its lowest rank.
 *
 * Reporting and seeing who is online are basics, not privileges — a member who
 * cannot report has to go find a staff member in chat instead.
 */
const BASIC_PERMS = ["warp.use", "spawn.use", "tpa.use", "report.use", "online.use"]

/** What any staff rank needs before it can do anything at all. */
const STAFF_CORE = ["admin.panel", "ranks.view", "chat.staff"]

/**
 * Ready-made ladders. Applying one REPLACES the rank table; holders keep their
 * assignments, so anyone holding an id that still exists keeps their rank.
 *
 * The three named shapes are a scale of ambition, not of quality. A SERVER is
 * the thing that holds all the tags — every role split out, because at that
 * size the roles really are different jobs. A REALM is the shape a realm
 * actually has: an owner, somebody running it day to day, and two tiers of
 * staff under them. An SMP is just an SMP; nobody expects a hierarchy from one,
 * so it does not pretend to have one.
 *
 * Authority rises with the ladder, and so does what the panel SHOWS. A Mod gets
 * Kick and no Ban; Ban appears further up. Every button in the panel is drawn
 * from its node, so a rank is never shown a control it would be refused — the
 * ladder is the feature list, read top to bottom.
 */
export const PRESETS = {
    server: {
        name: "Server",
        description: "Owner, Co-Owner, Manager, Admin, Mod and Member.",
        ranks: {
            owner:     { id: "owner",     display: "§4§lOwner",     weight: 100, inherits: [],         perms: ["*"], meta: {}, staff: true },
            coowner:   { id: "coowner",   display: "§c§lCo-Owner",  weight: 90,  inherits: [],         perms: ["*"], meta: {}, staff: true },
            manager:   { id: "manager",   display: "§5§lManager",   weight: 80,  inherits: ["admin"],  perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply", "chat.*"], meta: {}, staff: true },
            admin:     { id: "admin",     display: "§6§lAdmin",     weight: 70,  inherits: ["mod"],    perms: ["admin.ban", "admin.nickname", "admin.gamemode", "admin.holograms", "ranks.grant", "warp.manage", "spawn.set", "chat.*"], meta: {}, staff: true },
            mod:       { id: "mod",       display: "§aMod",         weight: 50,  inherits: ["member"], perms: [...STAFF_CORE, "admin.warn", "admin.kick", "admin.mute", "admin.freeze", "admin.staffmode", "admin.tpatoggle", "admin.reports", "admin.automod", "admin.clearchat", "admin.lagclear", "admin.claims", "admin.alerts", "admin.tp", "admin.vanish", "admin.gamemode", "admin.invsee", "admin.logs", "admin.broadcast", "admin.settings", "chat.spy"], meta: {}, staff: true },
            member:    { id: "member",    display: "§bMember",      weight: 10,  inherits: [],         perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    realm: {
        name: "Realm",
        description: "Owner, Manager, Admin, Mod and Member. Good for a realm.",
        ranks: {
            owner:   { id: "owner",   display: "§4§lOwner",   weight: 100, inherits: [],         perms: ["*"], meta: {}, staff: true },
            manager: { id: "manager", display: "§5§lManager", weight: 85,  inherits: ["admin"],  perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply", "chat.*"], meta: {}, staff: true },
            admin:   { id: "admin",   display: "§6§lAdmin",   weight: 70,  inherits: ["mod"],    perms: ["admin.ban", "admin.nickname", "admin.gamemode", "admin.settings", "admin.holograms", "ranks.grant", "warp.manage", "spawn.set", "chat.viewall"], meta: {}, staff: true },
            mod:     { id: "mod",     display: "§aMod",       weight: 50,  inherits: ["member"], perms: [...STAFF_CORE, "admin.warn", "admin.kick", "admin.mute", "admin.freeze", "admin.staffmode", "admin.tpatoggle", "admin.reports", "admin.automod", "admin.logs", "admin.invsee", "admin.tp", "admin.vanish", "admin.gamemode", "admin.clearchat", "admin.lagclear", "admin.claims", "admin.alerts", "admin.broadcast", "chat.spy"], meta: {}, staff: true },
            member:  { id: "member",  display: "§bMember",    weight: 10,  inherits: [],         perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    smp: {
        name: "SMP",
        description: "Owner, Staff and Member. Good for a small survival server.",
        ranks: {
            owner:  { id: "owner",  display: "§4§lOwner", weight: 100, inherits: [],         perms: ["*"], meta: {}, staff: true },
            staff:  { id: "staff",  display: "§6§lStaff", weight: 60,  inherits: ["member"], perms: ["admin.*", "ranks.view", "ranks.grant", "warp.manage", "spawn.set", "chat.staff", "chat.spy"], meta: {}, staff: true },
            member: { id: "member", display: "§bMember",  weight: 10,  inherits: [],         perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    donor: {
        name: "Donor Tiers",
        description: "Owner, Admin and Mod, plus VIP, VIP+ and MVP above Member.",
        ranks: {
            owner:   { id: "owner",   display: "§4§lOwner",  weight: 100, inherits: [],          perms: ["*"], meta: {}, staff: true },
            admin:   { id: "admin",   display: "§c§lAdmin",  weight: 80,  inherits: ["mod"],     perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply"], meta: {}, staff: true },
            mod:     { id: "mod",     display: "§6Mod",      weight: 60,  inherits: ["member"],  perms: [...STAFF_CORE, "admin.kick", "admin.mute", "admin.freeze", "admin.staffmode", "admin.tp", "admin.gamemode", "admin.invsee", "admin.logs", "admin.reports"], meta: {}, staff: true },
            mvp:     { id: "mvp",     display: "§d§lMVP",    weight: 35,  inherits: ["vipplus"], perms: [], meta: {}, staff: false },
            vipplus: { id: "vipplus", display: "§e§lVIP§6+", weight: 30,  inherits: ["vip"],     perms: [], meta: {}, staff: false },
            vip:     { id: "vip",     display: "§eVIP",      weight: 25,  inherits: ["member"],  perms: [], meta: {}, staff: false },
            member:  { id: "member",  display: "§bMember",   weight: 10,  inherits: [],          perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    roleplay: {
        name: "Roleplay / Factions",
        description: "Overseer and Warden as staff, plus Noble, Merchant and Citizen.",
        ranks: {
            owner:    { id: "owner",    display: "§4§lOverseer", weight: 100, inherits: [],           perms: ["*"], meta: {}, staff: true },
            admin:    { id: "admin",    display: "§c§lWarden",   weight: 80,  inherits: ["citizen"],  perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply"], meta: {}, staff: true },
            noble:    { id: "noble",    display: "§5Noble",      weight: 30,  inherits: ["merchant"], perms: [], meta: {}, staff: false },
            merchant: { id: "merchant", display: "§6Merchant",   weight: 20,  inherits: ["citizen"],  perms: [], meta: {}, staff: false },
            citizen:  { id: "citizen",  display: "§bCitizen",    weight: 10,  inherits: [],           perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    }
}

/**
 * What a world starts with: the Server ladder.
 *
 * Derived rather than duplicated. These were two hand-kept copies of nearly the
 * same list, and they had already drifted — which meant a brand-new world could
 * not read as any named shape, because its ladder matched no preset. Pointing
 * one at the other makes that impossible.
 */
export const DEFAULT_RANKS = JSON.parse(JSON.stringify(PRESETS.server.ranks))

/**
 * Every node Admin+ checks, grouped for the permission editor.
 *
 * The rule this list keeps: a node in here is a node the code actually asks
 * about. A node for a feature that was never built is worse than no node — the
 * editor draws a switch, somebody turns it on, and nothing happens.
 * fly/god/heal/feed/bring and the homes limit sat here for exactly that reason,
 * and left with the features they described.
 *
 * **Rebuilt 2026-09-13, for the person who actually reads it.** Most people
 * running a Minecraft server are about thirteen, and the editor they were being
 * handed had 95 switches in eight groups of wildly different sizes, with names
 * like "World upkeep" and "Management" that do not say what is inside them.
 *
 * Three things changed:
 *
 * **The 55-switch "Operator" group is gone.** It was one node per vanilla
 * command — 58% of the entire editor — gated by `deniedFor`, which means every
 * one of them read ON by default and nobody had ever turned one off. The
 * mechanism survives: `commandNode()` still builds `cmd.<name>` and a rank
 * carrying `-cmd.fill` is still refused it. What replaced the fifty-five is the
 * single `admin.commands` switch in Server settings, which was declared for
 * exactly this and had never been wired to anything. Since 2.8.4 it gates only
 * /clock and /sky, and the editor calls it "time and weather".
 *
 * **`admin.troll` became `admin.smite` and `admin.sudo`.** One switch called
 * "troll" tells a thirteen-year-old nothing about what they are handing over,
 * and the two halves are not the same trust: smite is lightning and a few
 * annoying items, sudo puts words in somebody's mouth and runs commands as
 * them. Shipped ranks are unaffected — Developer/Manager hold `admin.*` and
 * Owner holds `*` — but a world that granted `admin.troll` to a custom rank has
 * to grant the two.
 *
 * **Groups are ordered least dangerous to most**, sized 2-8 rather than 2-55,
 * and named in words rather than categories: what everyone gets, then the
 * panel, chat, staff tools, punishments, pranks, and finally the two that can
 * hand the server away.
 */
export const PERMISSION_NODES = {
    "Everyone": ["warp.use", "spawn.use", "tpa.use", "report.use", "online.use"],
    "The panel": ["admin.panel", "admin.settings", "admin.logs", "ranks.view"],
    "Chat": ["chat.staff", "chat.viewall", "chat.manage", "chat.spy", "admin.broadcast", "admin.clearchat"],
    "Staff tools": ["admin.staffmode", "admin.vanish", "admin.tp", "admin.gamemode", "admin.nickname", "admin.holograms", "admin.invsee", "admin.lagclear", "admin.claims", "admin.alerts"],
    "Punishments": ["admin.warn", "admin.mute", "admin.kick", "admin.ban", "admin.banperm", "admin.freeze", "admin.tpatoggle", "admin.reports"],
    "Pranks": ["admin.smite", "admin.sudo"],
    "Ranks & places": ["ranks.grant", "ranks.manage", "warp.manage", "spawn.set"],
    "Server settings": ["presets.apply", "admin.commands", "admin.automod", "admin.allowlist"]
}

/**
 * What a permission node should be CALLED on screen.
 *
 * The switches used to be labelled with the raw node — `cmd.kill`, `admin.tp`,
 * `warp.use`. Inside a group the prefix is the same word over and over, so it
 * is pure noise: fifty-four rows reading `cmd.` down the left is harder to scan
 * than fifty-four reading `kill`, `give`, `clear`.
 *
 * But stripping the prefix blindly is a trap, and two groups spring it. Every
 * node in "Player basics" ENDS in `.use`, so the prefix is the meaningful half
 * and dropping it leaves five switches all labelled "use". "Management" holds
 * both `ranks.manage` and `warp.manage`, which collapse onto each other.
 *
 * So the shared word is dropped, whichever end it is on, and a group that
 * shares nothing keeps both halves:
 *
 *   every node shares a first segment   drop it     cmd.kill      -> kill
 *   every node shares a last segment    drop it     warp.use      -> warp
 *   the short forms are unique anyway   drop first  chat.spy      -> spy
 *   otherwise                           keep both   ranks.manage  -> ranks · manage
 *
 * The last case applies to the WHOLE group rather than per node, so a screen
 * never mixes two spellings — a list where some rows are shortened and others
 * are not reads as a mistake.
 *
 * Labels only. The node itself is what gets written, and the form field is
 * still keyed by it.
 *
 * @param {string[]} nodes one group's nodes
 * @returns {string[]} a label per node, in the same order
 */
/**
 * Labels the generator below cannot work out, because the meaning is in the
 * half it throws away.
 *
 * `nodeLabels` keeps the tail when the tails are unique, which is right 37
 * times out of 42 — `admin.ban` is "ban", and nobody needed the "admin". It
 * fails whenever the PREFIX carried the meaning: `presets.apply` came out as
 * "apply", which is the vaguest word on a screen where it is the heaviest
 * switch. Reported 2026-09-20: "what does apply mean too?"
 *
 * An override table rather than renaming the nodes, because a node id is
 * written into every world's rank table — renaming `presets.apply` would
 * silently strip it from every rank already holding it.
 */
const LABEL_OVERRIDES = {
    "presets.apply": "server presets",
    "ranks.view": "rank list",
    // **Named by the JOB, not by the noun.** These two sat next to each other
    // reading "every channel" and "channels", which share a word and differ by
    // a shrug — and "channels" did not say the main thing it does, which is
    // make them. Reported 2026-09-20: "if i can't discern it right by looking
    // at it, then it probably needs a clearer name."
    //
    // One is SEEING chat you are not in. The other is RUNNING the rooms:
    // creating them, gating them, ordering them, and /mutechat.
    "chat.manage": "make & edit chats",
    "chat.viewall": "see all chats",
    "admin.tpatoggle": "block TPA",
    "admin.alerts": "staff alerts",
    // What it gates since 2.8.4: /clock and /sky. The id stays, so ranks that
    // already hold it keep the right.
    "admin.commands": "time and weather"
}

export function nodeLabels(nodes) {
    const list = [...(nodes ?? [])]

    // The override wins over every branch below, so it is applied ONCE on the
    // way out rather than at each return — there are four of those and a fix
    // that has to be repeated four times is a fix that will be repeated three.
    // Keyed by NODE, because the label is exactly the thing being replaced.
    const settle = labels => labels.map((label, i) => LABEL_OVERRIDES[list[i]] ?? label)

    if (list.length < 2) return settle(list)
    const split = list.map(node => {
        const at = String(node).indexOf(".")
        return at === -1 ? [node, ""] : [node.slice(0, at), node.slice(at + 1)]
    })

    const allShare = (i) => split.every(parts => parts[i] === split[0][i]) && split[0][i] !== ""
    if (allShare(0)) return settle(split.map(parts => parts[1] || parts[0]))
    if (allShare(1)) return settle(split.map(parts => parts[0]))

    const tails = split.map(parts => parts[1] || parts[0])
    if (new Set(tails).size === tails.length) return settle(tails)
    return settle(split.map(parts => parts[1] ? `${parts[0]} · ${parts[1]}` : parts[0]))
}

/**
 * Where to go to switch a node on, in the words the screen actually uses.
 *
 * "Ranks ▸ the rank ▸ Permissions ▸ Administrative ▸ Pranks ▸ smite" rather
 * than "admin.smite". The node id is what the code says; the path is the
 * buttons somebody taps, in the words those buttons use. The labels come from
 * nodeLabels so they cannot drift from the editor. A message naming a switch
 * that does not exist under that name is worse than no message.
 *
 * Since 2.8.0 a rank opens on Basics and Permissions, and Permissions splits
 * into Member (the Everyone group, behind "What they can use") and
 * Administrative (every other group). features/ranksUI.js draws those buttons;
 * tests/ranksui.test.js walks them to check this path still matches.
 */
export function whereToGrant(node) {
    for (const [group, nodes] of Object.entries(PERMISSION_NODES)) {
        const at = nodes.indexOf(node)
        if (at === -1) continue
        const half = group === "Everyone" ? "Member ▸ What they can use" : `Administrative ▸ ${group}`
        return `Ranks ▸ the rank ▸ Permissions ▸ ${half} ▸ ${nodeLabels(nodes)[at]}`
    }
    return `Ranks ▸ the rank ▸ Permissions ▸ ${node}`
}

/** Checkbox-sized groupings for the rank editor form. */
export const BUNDLES = {
    "mod_light":   { label: "Moderation — light", nodes: ["admin.panel", "ranks.view", "admin.warn", "admin.kick", "admin.mute", "admin.freeze", "admin.tpatoggle", "admin.reports"] },
    "mod_full":    { label: "Moderation — full",  nodes: ["admin.panel", "ranks.view", "admin.warn", "admin.kick", "admin.mute", "admin.freeze", "admin.staffmode", "admin.tpatoggle", "admin.reports", "admin.automod", "admin.ban", "admin.invsee", "admin.logs"] },
    "staff_tools": { label: "Staff tools",        nodes: ["admin.tp", "admin.vanish", "admin.gamemode"] },
    "holograms":   { label: "Floating text",      nodes: ["admin.holograms"] },
    "identity":    { label: "Names & voice",      nodes: ["admin.nickname"] },
    "chat":        { label: "Staff chat",         nodes: ["chat.staff"] },
    "chat_all":    { label: "See every chat",     nodes: ["chat.staff", "chat.viewall", "chat.spy"] },
    "chat_manage": { label: "Run the chats",      nodes: ["chat.staff", "chat.manage", "admin.broadcast"] },
    "warps":       { label: "Warp management",    nodes: ["warp.manage", "spawn.set"] },
    "upkeep":      { label: "Tidying up",         nodes: ["admin.clearchat", "admin.lagclear"] },
    "ranks":       { label: "Rank management",    nodes: ["ranks.view", "ranks.grant", "ranks.manage"] },
    "shape":       { label: "Server shape",       nodes: ["admin.settings", "presets.apply"] },
    "basics":      { label: "Everyone",            nodes: [...BASIC_PERMS] },
    "pranks":      { label: "Pranks (smite only)", nodes: ["admin.smite"] },
    "everything":  { label: "Everything (*)",     nodes: ["*"] }
}

export const ranksTable = new Table(RANKS_KEY, DEFAULT_RANKS)
export const holdersTable = new Table(HOLDERS_KEY, {})
// One instance: constructing a Table schedules a deferred seed write, so making
// a fresh one per snapshot call would queue a write on every check.
const snapshotTable = new Table(SNAPSHOT_KEY, {})
// True while gainedBy works out a "what if". See pretend.
let pretending = false

// ---------------------------------------------------------------- rank table

export function allRanks() {
    return Object.values(ranksTable.data).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
}

export function getRank(id) { return ranksTable.get(id) }

/**
 * A rank's TYPE, chosen in Basics. The user's own four, 2026-11-11, modelled on
 * Discord roles rather than a single staff switch:
 *
 *   default   a normal rank in the order, like VIP. Giving it replaces the
 *             starting rank.
 *   staff     the same, plus staff permissions, staff chat and staff alerts.
 *   cosmetic  a tag added beside the others. No place in the order, no
 *             permissions, and it never replaces the starting rank.
 *   unlisted  hidden: gives its permissions without showing a tag, and never
 *             replaces the starting rank.
 *
 * Cosmetic and unlisted ranks have NO place in the order and weigh 0, so they
 * can never make anybody outrank anybody. Ranks saved before types existed
 * read their type from `staff`, so nothing in an old world changes.
 */
export const RANK_TYPES = ["default", "staff", "cosmetic", "unlisted"]

export function rankType(rank) {
    const type = String(rank?.type ?? "")
    if (RANK_TYPES.includes(type)) return type
    return rank?.staff ? "staff" : "default"
}

/** In the ranking order: Default and Staff. Cosmetic and Unlisted are not. */
export function isRanked(rank) {
    const type = rankType(rank)
    return type === "default" || type === "staff"
}

/** The ranks with no place in the order, sorted by name. */
export function unrankedRanks() {
    const plain = rank => String(rank.display ?? rank.id).replace(/§./g, "")
    return allRanks().filter(rank => !isRanked(rank)).sort((a, b) => plain(a).localeCompare(plain(b)))
}

// ------------------------------------------------------------- the ladder
//
// The rank list IS the hierarchy: row 1 outranks row 2, and that single fact
// drives permission precedence, which prefix shows, and who may act on whom.
// `weight` still exists because every comparison in this file reads it, but it
// is DERIVED from ladder position — nothing outside these two functions should
// ever set it by hand.

const LADDER_STEP = 10

/** Re-derive every weight from the current order (top of the list = strongest). */
function restack(orderedIds) {
    const total = orderedIds.length
    orderedIds.forEach((id, index) => {
        const rank = ranksTable.get(id)
        if (rank) rank.weight = (total - index) * LADDER_STEP
    })
    ranksTable.flush()
}

/** The ladder, strongest first: the ranks that have a place in the order. */
export function ladder() { return allRanks().filter(isRanked) }

/** Move a rank one row up (-1) or down (+1). Returns false at the ends. */
export function moveRank(id, delta) {
    const ids = ladder().map(r => r.id)
    const from = ids.indexOf(id)
    if (from < 0) return false
    const to = from + delta
    if (to < 0 || to >= ids.length) return false
    ids.splice(to, 0, ...ids.splice(from, 1))
    restack(ids)
    resyncAll()
    return true
}

/** Replace the whole order at once. */
export function reorder(orderedIds) {
    const known = orderedIds.filter(id => ranksTable.has(id))
    const missing = ladder().map(r => r.id).filter(id => !known.includes(id))
    restack([...known, ...missing])
    resyncAll()
}

export function defaultRank() {
    return allRanks().find(r => r.default)
}

export function normaliseRankId(raw) {
    return cleanId(raw).toLowerCase().replace(/\s+/g, "_")
}

/** Create or overwrite a rank. Returns the stored rank, or undefined on a bad id. */
export function saveRank(id, data) {
    const rankId = normaliseRankId(id)
    if (!rankId) return undefined
    const existing = ranksTable.get(rankId)

    // The type: given outright, or worked out from the older `staff` flag, or
    // kept as it was.
    let type = RANK_TYPES.includes(data.type) ? data.type : undefined
    if (!type && data.staff !== undefined) {
        type = data.staff ? "staff" : (existing && !isRanked(existing) ? rankType(existing) : "default")
    }
    if (!type) type = existing ? rankType(existing) : "default"
    const ranked = type === "default" || type === "staff"
    const wasRanked = existing ? isRanked(existing) : false

    // A rank joining the order joins at the BOTTOM — the safe end. Moving it up
    // is a deliberate act on the rank list. A rank outside the order weighs 0,
    // so it can never make anybody outrank anybody.
    const bottomWeight = Math.min(...Object.values(ranksTable.data)
        .filter(r => r.id !== rankId && isRanked(r)).map(r => r.weight ?? 0), LADDER_STEP)
    let weight
    if (!ranked) weight = 0
    else if (Number.isFinite(Number(data.weight))) weight = Number(data.weight)
    else if (existing && wasRanked) weight = existing.weight ?? 0
    else weight = Math.max(1, bottomWeight - LADDER_STEP)

    /** @type {Rank} */
    const rank = {
        id: rankId,
        display: data.display ?? existing?.display ?? `§7${rankId}`,
        // What was typed into the name box (with & codes) and the font it is
        // drawn in. `display` is the finished result of the two; these are
        // kept so the box shows what was typed, not the converted letters.
        text: data.text ?? existing?.text,
        font: data.font ?? existing?.font,
        // Where the font goes: the rank's own tag (on unless switched off),
        // its players' names, and what they type.
        fontTag: data.fontTag ?? existing?.fontTag,
        fontName: data.fontName ?? existing?.fontName,
        fontChat: data.fontChat ?? existing?.fontChat,
        weight,
        type,
        inherits: data.inherits ?? existing?.inherits ?? [],
        perms: data.perms ?? existing?.perms ?? [],
        meta: data.meta ?? existing?.meta ?? {},
        staff: type === "staff",
        // Only a rank in the order can be the one everybody starts with.
        default: ranked && (data.default ?? existing?.default ?? false)
    }
    // Only one default rank at a time.
    if (rank.default) {
        for (const other of Object.values(ranksTable.data)) {
            if (other.id !== rankId && other.default) { other.default = false }
        }
    }
    ranksTable.set(rankId, rank)
    // A rank that has just joined the order goes to the very bottom on a
    // weight of its own. The weight worked out above has a floor of 1, so a
    // second new rank used to land on the same weight as the first, and two
    // ranks on one weight outrank neither. Restacking is what Move up and Move
    // down already do.
    if (ranked && !wasRanked && !Number.isFinite(Number(data.weight))) {
        restack([...ladder().filter(r => r.id !== rankId).map(r => r.id), rankId])
    }
    resyncAll()
    return rank
}

/** Delete a rank and strip it from everyone holding it. */
export function deleteRank(id) {
    ranksTable.delete(id)
    for (const [playerId, record] of holdersTable.entries()) {
        if (!record.ranks?.includes(id)) continue
        record.ranks = record.ranks.filter(r => r !== id)
        holdersTable.data[playerId] = record
    }
    holdersTable.flush()
    resyncAll()
}

/** Apply a preset ladder, keeping a one-step undo snapshot. */
export function applyPreset(key) {
    const preset = PRESETS[key]
    if (!preset) return false
    snapshot()
    // A template replaces the ORDER. Cosmetic and unlisted ranks are not part
    // of it, so they stay, unless the template has a rank with the same id.
    const kept = Object.fromEntries(Object.entries(ranksTable.data)
        .filter(([id, rank]) => !isRanked(rank) && !(id in preset.ranks)))
    ranksTable.replace({ ...JSON.parse(JSON.stringify(preset.ranks)), ...kept })
    resyncAll()
    return true
}

export function snapshot() {
    snapshotTable.replace(JSON.parse(JSON.stringify(ranksTable.data)))
}

export function hasSnapshot() {
    return Object.keys(snapshotTable.data).length > 0
}

/** Undo the last preset application / destructive edit. */
export function restoreSnapshot() {
    const snap = snapshotTable.data
    if (!Object.keys(snap).length) return false
    ranksTable.replace(JSON.parse(JSON.stringify(snap)))
    resyncAll()
    return true
}

// ------------------------------------------------------------- rank holders

function record(playerId) {
    return holdersTable.get(playerId) ?? { name: "", ranks: [], since: Date.now() }
}

/**
 * When this player was first seen, as a timestamp.
 *
 * Already written on every join; nothing had ever read it back. /menu shows it
 * to the player as "here since", which is the one genuinely nice thing this
 * pack knows about somebody who has never been in trouble.
 */
export function memberSince(playerOrId) {
    const id = typeof playerOrId === "string" ? playerOrId : playerOrId?.id
    return record(id).since
}

/** Rank ids a player holds (works offline — reads the table, not tags). */
export function heldRankIds(playerOrId) {
    const id = typeof playerOrId === "string" ? playerOrId : playerOrId?.id
    const held = (record(id).ranks ?? []).filter(r => ranksTable.has(r))
    // Everybody holds at least one rank IN THE ORDER. Somebody holding only a
    // cosmetic or unlisted rank still has the starting rank beside it, or a
    // cosmetic tag would cost them the basics everybody gets.
    if (held.some(r => isRanked(ranksTable.get(r)))) return held
    const fallback = defaultRank()
    return fallback ? [fallback.id, ...held] : held
}

// Two orderings live side by side, and keeping them apart is the whole trick:
//
//   LADDER order (global, Ranks ▸ Settings) = authority. Who outranks whom, who
//     may act on whom, and how a permission conflict resolves.
//   HELD order (per player) = display only. Which of their ranks shows as the
//     tag when they hold several. Shuffling it changes nothing about power.
//
// So a Builder+Admin can show [Builder] while still having Admin's authority.

/** Rank objects a player holds, strongest first — the authority view. */
/**
 * Rank objects strongest first — **the authority view**.
 *
 * Built from what they HOLD, never from the display list. A badge is a mark,
 * not a rank: it carries no permissions and no weight, and it must not be able
 * to displace something that does. See the note in `displayRanks`.
 */
export function playerRanks(playerOrId) {
    return heldRankObjects(playerOrId).slice().sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
}

// ------------------------------------------------------- the pack's own badges

/**
 * A short list of gamertags gets a tag of its own in any world running this
 * pack: the creator, and the developers on the Admin+ team.
 *
 * Neither carries ANY PERMISSIONS. No node, not staff, weight 0 — `has()` finds
 * nothing to say about any node here, so a visitor's authority comes from
 * whatever real rank they hold, and weight 0 keeps them under every ladder so
 * `topWeight` and `canActOn` never see them either.
 *
 * ONE THING SITS BESIDE THE BADGE, and it is not a permission: the Creator &
 * Dev console (`features/console.js`). It matters that it is not hidden and not
 * unbounded, because "an addon that handed its author authority inside a
 * stranger's world would be a backdoor" is still true and still the rule. What
 * keeps the console the right side of that line:
 *   - it is an OPT-OUT setting (`creator.console`), visible in the config, so
 *     nothing about it is concealed from an owner who looks;
 *   - it runs Admin+ commands only, each checking the person's own rank, so
 *     it grants nothing their rank does not already give them, and it runs no
 *     vanilla command, so it cannot `/op` (since 2.8.2);
 *   - every command through it is logged AND announced to online owners, so it
 *     is a power an owner can watch, not one that acts unseen.
 * A regular member never reaches it — that is the whole point. If any of those
 * three ever stops being true, this is a backdoor again; do not let it.
 *
 * The badge lives OUTSIDE ranksTable, which is what makes it survive a preset
 * replacing the whole ladder — and what stops it being granted to anyone else,
 * renamed, or edited in the rank screens.
 */
// One source, in config.js, because core/identity.js needs it too and
// cannot import this file — see the note beside CONFIG.creator.
export const CREATOR_GAMERTAG = CONFIG.creator.gamertag

/**
 * Gamertags on the Admin+ TEAM — people the creator has taken on to work on
 * this pack. They wear `[Admin+ Dev]` and, like the creator, they reach the
 * console. Everything written above about the creator's badge applies to this
 * one unchanged: no permissions, weight 0, outside the rank table.
 *
 * IT IS A LIST IN THE SOURCE ON PURPOSE. Adding somebody is a pack release —
 * which means it goes through the changelog, the tag and the diff, where an
 * owner can see who was added and when. If a world could grant this, the badge
 * would stop being a claim about the team and the console would stop being
 * bounded to people the creator actually vouches for.
 *
 * NOT the same thing as the per-world "Dev" TAG (core/devgate.js), which any
 * operator can give themselves and which means "developer in THIS world".
 * Nor the same as a ladder's own Developer rank, which is a job in one world.
 * Three different ideas; only this one travels with the pack.
 *
 * EMPTY TODAY. Add a gamertag as a string below, ship it in a patch, and say so
 * in the changelog — an owner is entitled to read who they just let in.
 */
let TEAM_DEVELOPERS = Object.freeze([
    // "TheirGamertag",
])

/** The team list as it stands. */
export function developerGamertags() { return TEAM_DEVELOPERS }

/**
 * TEST HOOK — the only reason the list above is a `let`.
 *
 * The badge and the console are the two things in this pack that a stranger's
 * world has to take on trust, so the branch that grants them cannot be the one
 * branch no test can reach. Nothing in the pack calls this; `console.test.js`
 * greps the whole BP for a caller and fails if one appears, which is what keeps
 * "the list lives in the source" true rather than merely intended.
 */
export function __setTeamDevelopers(names) {
    TEAM_DEVELOPERS = Object.freeze([...names].map(String))
}

/** The two badges are the same object with one word changed — deliberately, so
 *  they read as one family and neither can drift into looking like a rank. */
function teamBadge(id, word) {
    return Object.freeze({
        id,
        // The pack's own two colours, then the title in a shade no ladder rank
        // uses — so it reads as the pack's mark rather than as a rank in the
        // world.
        display: `§bAdmin§d+§r §e§l${word}`,
        weight: 0,
        inherits: [],
        perms: [],
        meta: {},
        staff: false
    })
}

const CREATOR_RANK = teamBadge("adminplus_creator", "Creator")
const DEVELOPER_RANK = teamBadge("adminplus_dev", "Dev")

/** The gamertag behind either kind of argument these helpers accept. */
function nameOf(playerOrId) {
    const name = typeof playerOrId === "string"
        ? record(playerOrId).name
        : playerOrId?.name
    return String(name ?? "").toLowerCase()
}

function isCreator(playerOrId) {
    const name = nameOf(playerOrId)
    return !!name && name === CREATOR_GAMERTAG.toLowerCase()
}

/** On the Admin+ team — the pack's own developers, not a world's. */
function isTeamDeveloper(playerOrId) {
    const name = nameOf(playerOrId)
    if (!name) return false
    return TEAM_DEVELOPERS.some(tag => String(tag).toLowerCase() === name)
}

/** The pack badge this player wears, if any. Creator wins over Dev. */
function packBadge(playerOrId) {
    if (isCreator(playerOrId)) return CREATOR_RANK
    if (isTeamDeveloper(playerOrId)) return DEVELOPER_RANK
    return undefined
}

/**
 * True while they hold nothing but the rank everybody starts with.
 *
 * onPlayerJoin writes the default rank as a real assignment, so "has no rank"
 * is never true for anyone who has actually joined — the question that matters
 * is whether somebody has since given them one.
 */
function onlyDefaultRank(playerOrId) {
    const held = heldRankIds(playerOrId)
    if (!held.length) return true
    const fallback = defaultRank()
    return held.length === 1 && !!fallback && held[0] === fallback.id
}

/**
 * Rank objects in the player's own display order — the cosmetic view.
 *
 * With one rule on top of that order: STAFF RANKS COME FIRST. A moderator who
 * also collected a cosmetic tag was showing the tag, because held order is
 * manual and the tag happened to be first in the list. Whatever else a tag is
 * for, the one thing a player must be able to read off somebody's name is
 * whether they are staff.
 *
 * The partition is STABLE, so the manual order still decides everything inside
 * each group — a Builder+Admin can still choose which of those two shows, and
 * the twenty cosmetic tags on a PvP ladder keep whatever order their holder put
 * them in. It only guarantees that no cosmetic rank outranks a staff one.
 */
/**
 * What they actually hold: staff first, then other ranks in the order, then
 * cosmetic, then unlisted. No badges — this is the real list. Each group keeps
 * the holder's own order.
 */
function heldRankObjects(playerOrId) {
    const held = heldRankIds(playerOrId).map(id => ranksTable.get(id)).filter(Boolean)
    const of = type => held.filter(rank => rankType(rank) === type)
    return [...of("staff"), ...of("default"), ...of("cosmetic"), ...of("unlisted")]
}

export function displayRanks(playerOrId) {
    const ordered = heldRankObjects(playerOrId)
    // **The badge REPLACES the default rank rather than sitting in front of
    // it.** Prepending meant the creator wore two tags — `[Admin+ Creator]
    // [Member]` — which reads as somebody who collected a cosmetic rather than
    // as the pack's own mark. Asked for 2026-09-19.
    //
    // Only the DEFAULT rank is displaced, and only while that is all they hold.
    // The contract is unchanged where it matters: the moment a world gives them
    // a rank of its own, the badge is gone and the world's rank shows.
    //
    // **This is the DISPLAY list, and nothing may read authority from it.**
    // That used to be untrue in the most direct way possible — `playerRanks`
    // was this function sorted by weight, so dropping the default rank here
    // took `warp.use` and the holder's ladder weight with it. The badge carries
    // no permissions, so a creator would have silently ended up with fewer
    // rights than a stranger. Two assertions caught it; they are why the two
    // lists are now built separately rather than one from the other.
    const badge = packBadge(playerOrId)
    if (badge && onlyDefaultRank(playerOrId)) return [badge]
    // An unlisted rank is held and works, but never shows.
    return ordered.filter(rank => rankType(rank) !== "unlisted")
}

export { CREATOR_RANK, DEVELOPER_RANK, isCreator, isTeamDeveloper, packBadge }

/** The rank that shows as their tag: first in their display order. */
export function primaryRank(playerOrId) { return displayRanks(playerOrId)[0] }

/**
 * **Every tag they wear, not just the first one.**
 *
 * Ranks have stacked since 2.1.14 and `displayRanks` has returned all of them
 * in the right order ever since — staff first, then whatever order the holder
 * chose. But every surface that drew a tag took `primaryRank`, which is
 * `displayRanks()[0]`, so the second rank was invisible everywhere. Granting
 * somebody a rank told them it had happened and then showed them nothing,
 * which reads as the grant having silently failed.
 *
 * So `{TAG}` is now the whole badge, `[Owner][Elytra Mace]`, and `{RANK}` stays
 * the single primary name for anyone formatting without brackets.
 *
 * Capped, because "twenty cosmetic tags on a PvP ladder" is a real shape this
 * pack already talks about and twenty of them in a chat line is unreadable.
 * `format.tagCount` is the cap; 0 means show them all.
 */
export function renderTags(playerOrId) {
    // Tags of ranks in the order first, then cosmetic ranks' tags, each half
    // behind its own switch in Server ▸ Settings ▸ Names and tags. Unlisted ranks never show:
    // displayRanks has already left them out.
    const shown = displayRanks(playerOrId)
    const ranks = flag("feature.ranktags") ? shown.filter(rank => rankType(rank) !== "cosmetic") : []
    const cosmetic = flag("feature.tags") ? shown.filter(rank => rankType(rank) === "cosmetic") : []
    // Nobody with no rank at all loses their "no rank" tag — that is a separate
    // setting and it still gets the last word. Not when rank tags are off.
    if (!ranks.length && !cosmetic.length) {
        return flag("feature.ranktags") ? renderTag(undefined) : ""
    }
    const all = [...ranks, ...cosmetic]
    const cap = Number(setting("format.tagCount"))
    const limit = Number.isFinite(cap) && cap > 0 ? cap : all.length
    // renderTag answers "" for a rank whose name has been blanked, so a
    // switched-off tag still disappears rather than leaving empty brackets.
    //
    // **Joined with a separator, and the empties dropped FIRST.** They used to
    // be joined with "", so somebody holding two ran together as `[Owner][Dev]`
    // with nothing between the brackets. Filtering before the join is what
    // stops a blanked tag in the middle leaving a double space behind it.
    const sep = String(setting("format.tagJoin") ?? " ")
    return all.slice(0, limit).map(rank => renderTag(rank)).filter(Boolean).join(sep)
}

/** Their authority: the strongest rank they hold, whatever the display order. */
/**
 * Anyone who sits outside the ladder entirely: a config owner, or a live
 * operator. `has()` already lets operators through nodes nothing has an opinion
 * on; authority has to agree with that, or an op holding only the default rank
 * ends up able to OPEN the rank screens while every list in them comes back
 * empty (nothing is below weight 10) — which is exactly what it did before.
 */
function isUnrestricted(playerOrId) {
    if (isOwner(playerOrId)) return true
    return typeof playerOrId !== "string" && isOperator(playerOrId)
}

export function topWeight(playerOrId) {
    if (isUnrestricted(playerOrId)) return Infinity
    return playerRanks(playerOrId)[0]?.weight ?? 0
}

/** Move one of a player's held ranks up (-1) or down (+1) in display order. */
export function moveHeldRank(playerId, rankId, delta) {
    const ids = heldRankIds(playerId)
    const from = ids.indexOf(rankId)
    if (from < 0) return false
    const to = from + delta
    if (to < 0 || to >= ids.length) return false
    ids.splice(to, 0, ...ids.splice(from, 1))
    setRanks(playerId, ids)
    return true
}

/** Replace a player's ranks outright. Accepts an offline player id. */
export function setRanks(playerId, ids, name) {
    const clean = [...new Set(ids.filter(id => ranksTable.has(id)))]
    const existing = record(playerId)
    // Read before the write below, or "were they staff a moment ago" is asked
    // of the record that already answers no.
    const wasStaff = playerRanks(playerId).some(r => r.staff)

    // DORMANT IDS. Applying a preset replaces the ladder, so a rank the player
    // holds may simply not exist for a while — heldRankIds() filters those out
    // at read time, which is right. What was wrong is that grantRank,
    // revokeRank and moveHeldRank all read that FILTERED list and wrote it
    // straight back, so one ordinary panel edit while a different preset was
    // applied erased the rest permanently. Undo restored the ladder and the
    // holder record no longer mentioned them.
    //
    // So ids the player already holds that the current ladder does not define
    // are carried through untouched. They stay inert — nothing reads them for
    // permissions or display — until their ladder comes back.
    //
    // Deleting a rank is the deliberate path and still strips it from every
    // holder: see deleteRank. Switching shape is not deletion.
    const dormant = (existing.ranks ?? [])
        .filter(id => !ranksTable.has(id) && !clean.includes(id))

    holdersTable.set(playerId, {
        name: name ?? existing.name ?? "",
        ranks: [...clean, ...dormant],
        since: existing.since ?? Date.now()
    })
    const online = world.getAllPlayers().find(p => p.id === playerId)
    if (online) {
        syncPlayer(online)
        // Only on the TRANSITION out of staff, and only for somebody actually
        // here to notice. A listener rather than a call into the gamemode code,
        // because this file has no business importing GameMode.
        if (wasStaff && !playerRanks(playerId).some(r => r.staff)) {
            for (const listen of demotionListeners) {
                try { listen(online) } catch (e) { console.error(`[Admin+] demotion hook: ${e}`) }
            }
        }
    }
    return clean
}

/**
 * Called when somebody stops holding any staff rank, while they are online.
 *
 * **The gap this exists for:** nothing used to happen. A Mod in creative who
 * got demoted stayed in creative indefinitely — and could no longer `/gm`
 * themselves back, because the demotion took `admin.gamemode` with it. The
 * creative flag is recoverable by staff; the netherite they spawned first is
 * not.
 *
 * A registry rather than a direct call so core/ranks.js stays free of game
 * state. It fires on the transition only, so it never touches somebody an
 * owner deliberately left in creative.
 */
const demotionListeners = []
export function onStaffLost(fn) { demotionListeners.push(fn) }

export function grantRank(playerId, rankId, name) {
    if (!ranksTable.has(rankId)) return false
    setRanks(playerId, idsAfterGrant(playerId, rankId), name)
    return true
}

/**
 * The ranks a player will hold once given `rankId`, without giving it. The
 * rank screens ask this before a grant, to check it would not raise the
 * person giving it to themselves (see gainedBy).
 */
export function idsAfterGrant(playerId, rankId) {
    const rank = ranksTable.get(rankId)
    if (!rank) return heldRankIds(playerId)
    const weight = rank.weight ?? 0
    // RANKS STACK. Granting Admin to somebody who is also a Builder leaves them
    // both, whatever the two weigh. A rank is something a player holds, not a
    // slot they occupy, and dropping ranks they had earned because a new one
    // outweighed them threw away work nobody asked to lose. Which rank they
    // WEAR is a separate question, and displayRanks already answers it — staff
    // first, then their own display order.
    //
    // The one exception is the DEFAULT rank. It is what everybody holds for
    // want of anything else, so keeping it beside a real rank means nothing,
    // and every ladder's own ranks inherit it anyway. It goes whatever the new
    // rank weighs — including a cosmetic one sitting BELOW it, which is the
    // case the old weight comparison got wrong: member outweighed a new rank,
    // so a brand-new rank left the player as Member-and-that.
    //
    // A cosmetic or unlisted rank replaces nothing: it is added beside what
    // they already have, starting rank included.
    const fallback = defaultRank()
    let held = heldRankIds(playerId).filter(id => id !== rankId)
    if (fallback && rankId !== fallback.id && isRanked(rank)) held = held.filter(id => id !== fallback.id)

    // Insert by LADDER position rather than appending. The tag a player wears is
    // the first entry in their display order, so appending meant granting Mod to
    // a Member changed nothing visible — the grant worked, but they kept wearing
    // Member and it read as a no-op. Strongest-first is the sane default; the
    // display-order screen can still override it per player afterwards.
    const at = held.findIndex(id => (ranksTable.get(id)?.weight ?? 0) < weight)
    if (at < 0) held.push(rankId)
    else held.splice(at, 0, rankId)
    return held
}

/**
 * What granting this rank would remove, for the confirmation copy.
 *
 * Only ever the default rank now, because that is the only thing a grant takes
 * away — see grantRank. It still returns a list so the callers that render it
 * do not have to care.
 */
export function displacedBy(playerId, rankId) {
    const fallback = defaultRank()
    if (!ranksTable.has(rankId) || !fallback || rankId === fallback.id) return []
    if (!isRanked(ranksTable.get(rankId))) return []
    return heldRankIds(playerId).includes(fallback.id) ? [fallback] : []
}

export function revokeRank(playerId, rankId, name) {
    setRanks(playerId, heldRankIds(playerId).filter(r => r !== rankId), name)
    return true
}

/** Find a holder record by name — the offline-promotion path. */
export function findHolderByName(name) {
    const needle = String(name ?? "").toLowerCase()
    for (const [id, rec] of holdersTable.entries()) {
        if ((rec.name ?? "").toLowerCase() === needle) return { id, ...rec }
    }
    return undefined
}

export function knownHolders() {
    return holdersTable.entries()
        .map(([id, rec]) => ({ id, ...rec }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}

// ------------------------------------------------------- permission resolve

/** How specific a pattern is for a node — bigger wins inside a single rank. */
function matchScore(pattern, node) {
    const body = pattern.startsWith("-") ? pattern.slice(1) : pattern
    if (body === "*") return 1
    if (body === node) return 1000
    if (body.endsWith(".*")) {
        const branch = body.slice(0, -2)
        if (node === branch || node.startsWith(branch + ".")) return 100 + branch.length
    }
    return 0
}

/** A rank's own nodes first, then everything it inherits (cycle-safe). */
function effectivePerms(rank, seen = new Set()) {
    if (!rank || seen.has(rank.id)) return []
    // A cosmetic rank is a tag and nothing else, even if permissions were left
    // on it from before it was made cosmetic.
    if (rankType(rank) === "cosmetic") return []
    seen.add(rank.id)
    const out = [...(rank.perms ?? [])]
    for (const parentId of rank.inherits ?? []) {
        out.push(...effectivePerms(ranksTable.get(parentId), seen))
    }
    return out
}

/**
 * A config owner — by Player object, by player id, or by name.
 *
 * The id form matters: the offline-player screens address people by id, and an
 * owner who happens to be offline must still be untouchable. Looking the name up
 * from the holder record is what closes that gap.
 */
export function isOwner(playerOrId) {
    if (!playerOrId) return false
    let name
    if (typeof playerOrId === "string") {
        name = holdersTable.get(playerOrId)?.name
    } else {
        name = playerOrId.name
    }
    if (!name) return false
    return CONFIG.owners.some(n => String(n).toLowerCase() === String(name).toLowerCase())
}

/**
 * Is this player a real Minecraft operator, whatever the pack thinks of them?
 *
 * `isOperator` below answers a different question — "does op status count as
 * staff HERE" — and a world that says no by turning `opIsStaff` off is talking
 * about POWERS. This one is about PROTECTION, and the two must not share an
 * answer: whether somebody may be struck down by an item should not flip
 * because an owner decided op status no longer grants the panel.
 *
 * Kept separate rather than exporting `isOperator`, so nothing can reach for
 * the powers question by accident when it meant this one.
 */
export function isRealOperator(player) {
    try {
        const level = player?.commandPermissionLevel
        return typeof level === "number" && level >= (CommandPermissionLevel?.GameDirectors ?? 1)
    } catch { return false }
}

function isOperator(player) {
    if (!CONFIG.opIsStaff) return false
    try {
        const level = player.commandPermissionLevel
        return typeof level === "number" && level >= (CommandPermissionLevel?.GameDirectors ?? 1)
    } catch { return false }
}

/**
 * How a RANK answers for one node, resolved the way has() resolves it.
 *
 * The rank editor used to read `rank.perms` literally, which is not the question
 * anybody looking at that screen is asking. Everything a rank INHERITS, and
 * everything it gets through a wildcard, rendered as OFF while the holder
 * plainly had it — an Admin inheriting from Mod, or holding "chat.*", looked
 * like it had almost nothing.
 *
 * Built on effectivePerms and matchScore rather than repeating them. A second
 * copy of inheritance resolution would drift from has(), and the screen would go
 * back to lying in a new way that nobody would spot for months.
 *
 * @returns {"own"|"inherited"|"denied"|"none"}
 */
/**
 * The strongest pattern in a list that has an opinion about `node`.
 *
 * `>` not `>=`, so the FIRST pattern at a given strength wins — which is what
 * makes this agree with has(), whose loop reads a rank's own perms before
 * anything it inherits.
 */
function bestPattern(patterns, node) {
    let best = 0
    let winner
    for (const pattern of patterns) {
        const score = matchScore(pattern, node)
        if (score > best) { best = score; winner = pattern }
    }
    return { score: best, pattern: winner }
}

/**
 * The strongest opinion about `node` held ABOVE this rank, and whose it is.
 *
 * Scored rather than first-found: an ancestor's exact `-admin.ban` has to beat
 * a nearer ancestor's broad `admin.*`, exactly as it does in has().
 */
function bestAncestor(rank, node, seen = new Set([rank.id])) {
    let found = { score: 0 }
    for (const parentId of rank.inherits ?? []) {
        if (seen.has(parentId)) continue
        seen.add(parentId)
        const parent = ranksTable.get(parentId)
        if (!parent) continue
        for (const candidate of [
            { ...bestPattern(parent.perms ?? [], node), rank: parent },
            bestAncestor(parent, node, seen)
        ]) {
            if (candidate.score > found.score) found = candidate
        }
    }
    return found
}

/**
 * Where a rank's answer about one node actually COMES from.
 *
 * **A rank's own wildcard is not inheritance, and calling it that was a real
 * bug.** Reported from a world: Manager showed "has it already, inherited" on
 * ban while its Inherits list was empty — inheriting, as the user put it, from
 * literally nothing. The cause is that the old check for "does this rank say so
 * itself" was an exact string match, so `admin.*` sitting in Manager's OWN
 * perms missed it, fell through to the flattened list, matched there, and got
 * labelled inherited. Clearing inheritance changed nothing, because inheritance
 * was never what granted it.
 *
 * Returns `{ state, via }`:
 *   own        the exact node is in this rank's list          via: the node
 *   wildcard   one of this rank's OWN patterns covers it      via: the pattern
 *   inherited  an ancestor grants it                          via: that rank
 *   denied     the strongest opinion is a denial              via: source
 *   none       nothing has an opinion                         via: undefined
 */
export function rankGrant(rankOrId, node) {
    const rank = typeof rankOrId === "string" ? ranksTable.get(rankOrId) : rankOrId
    if (!rank) return { state: "none" }

    // What this rank says ITSELF comes first — that is what the switch writes,
    // so it has to be what the switch shows.
    if (rank.perms.includes(node)) return { state: "own", via: node }
    if (rank.perms.includes(`-${node}`)) return { state: "denied", via: `-${node}` }

    // Both sides scored, then compared — NOT own-first-wins. An ancestor's
    // exact `-admin.ban` must still beat this rank's broad `admin.*`, or this
    // screen would say "allowed" about something has() refuses.
    const mine = bestPattern(rank.perms ?? [], node)
    const theirs = bestAncestor(rank, node)
    if (!mine.score && !theirs.score) return { state: "none" }

    // Ties go to the rank itself, matching effectivePerms' own-first order.
    const ownWins = mine.score >= theirs.score
    const pattern = ownWins ? mine.pattern : theirs.pattern
    if (pattern.startsWith("-")) {
        return { state: "denied", via: ownWins ? pattern : theirs.rank }
    }
    return ownWins
        ? { state: "wildcard", via: pattern }
        : { state: "inherited", via: theirs.rank }
}

/** Just the state, for callers that do not care where it came from. */
export function rankState(rankOrId, node) { return rankGrant(rankOrId, node).state }

/** Does this player have a permission node? */
export function has(player, node) {
    if (!player) return false
    if (isOwner(player)) return true
    for (const rank of playerRanks(player)) {
        let best = 0
        let granted = false
        for (const pattern of effectivePerms(rank)) {
            const score = matchScore(pattern, node)
            if (score > best) { best = score; granted = !pattern.startsWith("-") }
        }
        if (best > 0) return granted
    }
    // Nothing in their ranks had an opinion. Operators pass here, which is what
    // stops a fresh world locking its own host out of /admin before any rank
    // has been handed out.
    //
    // The full rule for an operator is therefore: ALLOWED UNLESS A RANK THEY
    // HOLD EXPLICITLY DENIES IT. A silent gap lets them through; an explicit
    // "-admin.ban" on a rank they hold does not. That is deliberate — it keeps
    // the host from being locked out, while still letting you restrict a
    // realm-op with a "-node" denial when you actually mean to.
    return isOperator(player)
}

/**
 * Resolved meta value — heaviest rank that defines the key wins. Unlisted
 * ranks weigh 0, so they fill in only what the ranks in the order leave unset.
 * Cosmetic ranks set nothing.
 */
export function meta(playerOrId, key, fallback) {
    for (const rank of playerRanks(playerOrId)) {
        if (rankType(rank) === "cosmetic") continue
        const value = rank.meta?.[key]
        if (value !== undefined && value !== null) return value
    }
    return fallback
}

/**
 * Teleport cooldown in seconds for this player, from their rank's meta.
 *
 * STAFF ARE EXEMPT by default: a player holding a staff rank (and any owner or
 * operator) waits zero, whatever the meta says — staff use teleports as tools,
 * not as a perk to be rationed. The exemption is a config value, so it can be
 * turned off in < Code > ("staff.exemptCooldowns") without touching scripts.
 * Warps, spawn and TPA all read this one function.
 */
export function cooldownFor(playerOrId, fallback = 0) {
    if (exemptFromCooldowns(playerOrId)) return 0
    const value = Number(meta(playerOrId, "tpCooldown", fallback))
    return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Numbers a rank carries, beside the switches it carries.
 *
 * **A permission is not always a yes or a no.** "May this person set a home"
 * and "how many" are the same question asked twice, and a pack that can only
 * answer the first ends up with the second hardcoded — which means every world
 * gets one person's guess. Minecraft Essentials settles this by letting a
 * permission hold a VALUE (`home.cooldown`, `home.limit`); the same idea fits
 * the `meta` field ranks here have always had.
 *
 * Declared in ONE table so the rank editor draws itself. A number added here
 * gets a slider without anybody touching the UI, and — more to the point — a
 * feature cannot quietly read a number nobody can edit.
 *
 * `kind` sorts them onto the right screen and decides what a 0 means:
 *   cooldown  seconds to wait. 0 is no wait. Staff are exempt by default.
 *   limit     how many you may have. 0 means none at all, which is how you
 *             switch a feature off for a rank without a separate node.
 */
export const RANK_VALUES = {
    tpCooldown: {
        kind: "cooldown", label: "Teleport cooldown",
        hint: "warps, spawn and TPA", min: 0, max: 60, fallback: 3
    },
    "home.cooldown": {
        kind: "cooldown", label: "/home cooldown",
        hint: "between one trip home and the next", min: 0, max: 120, fallback: 3
    },
    "rtp.cooldown": {
        kind: "cooldown", label: "/rtp cooldown",
        hint: "it is a long walk back, so this is usually the longest", min: 0, max: 600, fallback: 60
    },
    "back.cooldown": {
        kind: "cooldown", label: "/back cooldown",
        hint: "a short one: the usual reason is a death", min: 0, max: 300, fallback: 10
    },
    "home.limit": {
        kind: "limit", label: "Homes allowed",
        hint: "0 stops this rank setting any", min: 0, max: 25, fallback: 3
    },
    "claim.limit": {
        kind: "limit", label: "Land claims allowed",
        hint: "0 stops this rank claiming ground", min: 0, max: 10, fallback: 1
    },
    "claim.size": {
        kind: "limit", label: "Claim size (blocks across)",
        hint: "the widest a single claim may be", min: 16, max: 256, fallback: 64
    },
    // Not a number, so it is not a slider — `kind` is what the editor switches
    // on, and this is the first entry that is a choice. It lives in this table
    // anyway for the reason the table exists: a value the code reads and nobody
    // can set is the failure mode being designed out.
    "nametag.style": {
        kind: "style", label: "Name colour",
        hint: "one colour, or colours that move along the name",
        options: STYLE_IDS, fallback: "none"
    },
    // The colour of what they type, set in Basics beside the name colour. A
    // single colour code, or nothing for the chat line's own colour.
    "chat.colour": {
        kind: "colour", label: "Chat colour",
        hint: "the colour of their messages",
        fallback: ""
    }
}

/** The colour codes a chat colour may be: every colour, no formatting letter. */
const CHAT_COLOUR = /^[0-9a-jmnpqstuv]$/i

/**
 * The chat colour their ranks give them, as a `§` code, or "" for none.
 * The highest rank that sets one wins, like every other rank value.
 */
export function chatColourFor(playerOrId) {
    const code = String(meta(playerOrId, "chat.colour", "") ?? "")
    return CHAT_COLOUR.test(code) ? `§${code}` : ""
}

/**
 * The font for a player's name. Their own, set in Players ▸ a player ▸ Basics,
 * wins; otherwise the highest rank whose font is switched on for names.
 * Cosmetic ranks only ever change their own tag.
 */
export function nameFontFor(playerOrId) {
    const own = getNameFont(playerOrId)
    if (own && own !== "normal") return own
    for (const rank of playerRanks(playerOrId)) {
        if (rankType(rank) === "cosmetic") continue
        if (rank.fontName && rank.font && rank.font !== "normal") return rank.font
    }
    return "normal"
}

/** The font for what they type: the highest rank whose font is on for messages. */
export function chatFontFor(playerOrId) {
    for (const rank of playerRanks(playerOrId)) {
        if (rankType(rank) === "cosmetic") continue
        if (rank.fontChat && rank.font && rank.font !== "normal") return rank.font
    }
    return "normal"
}

// Every templated line (chat, nametag, join, leave, private messages) asks
// identity.js for a name; this is how that name gets its font.
setNameDecorator((player, text) => applyFont(text, nameFontFor(player)))

/**
 * Their name for a chat line, in their name colour.
 *
 * Chat is printed once and never redrawn, so a moving effect is drawn at its
 * first frame. A nickname's own colours are replaced, exactly as they are
 * above the head. Name colours switched off, or none set: unchanged.
 */
export function chatNameFor(player, text) {
    if (!flag("feature.namecolour")) return text
    const ramp = STYLES[effectiveNametagStyle(player)]?.ramp
    if (!ramp) return text
    return paint(stripCodes(text), ramp, 0)
}

/** Is this person exempt from waiting, by rank or by ownership? */
export function exemptFromCooldowns(playerOrId) {
    if (!flag("staff.exemptCooldowns")) return false
    if (typeof playerOrId !== "string" && isStaff(playerOrId)) return true
    return playerRanks(playerOrId).some(r => r.staff)
}

/**
 * One of the numbers above, for this player.
 *
 * Cooldowns collapse to 0 for staff, exactly as `cooldownFor` does — staff use
 * these as tools rather than as a perk to be rationed. Limits do NOT: a limit
 * is about how much of the world somebody may occupy, and "staff may have
 * unlimited homes" is a decision an owner should make on the rank rather than
 * something the pack assumes.
 */
/**
 * The name the CREATOR wears when they have not said otherwise.
 *
 * Asked for on 2026-09-20: the gamertag is `FireliteZGaming`, the name they
 * actually go by is `Firelite`, and they picked `§mF§4i§nr§ce§6l§pi§gt§ee` for
 * it. Frame 0 of the `molten` ramp on this text is that exact string, so the
 * still they chose is what this renders and the animation is that still moving.
 *
 * **It is a DEFAULT, not an override.** A nickname they set beats it — that is
 * what "unless they replace my nametag" means — and clearing the nickname comes
 * back HERE rather than to the bare gamertag, which is the whole point: the
 * reset lands on the name they use, not on the account name.
 *
 * Rank changes do not touch it either. A rank supplies the TAG beside the name;
 * this supplies the name, and the two never contend.
 *
 * Gated on `isCreator`, so it is one person by construction rather than by
 * configuration — a developer-mode feature until there is a reason to make it
 * general. `creator.identity` turns it off without touching scripts.
 */
export function creatorIdentity(playerOrId) {
    if (!flag("creator.identity")) return undefined
    if (!isCreator(playerOrId)) return undefined
    return { text: CONFIG.creator.name, style: CONFIG.creator.style }
}

/**
 * The nametag style this player's ranks give them, as a style id.
 *
 * Its own function rather than `valueFor`, because that one is about NUMBERS —
 * it clamps to min/max and collapses cooldowns to zero for staff, neither of
 * which means anything for a choice. `meta` already walks the ranks in
 * hierarchy order, so the highest rank that names a style wins, and a rank
 * saying `none` deliberately beats a lower one saying `rainbow`.
 */
export function nametagStyleFor(playerOrId) {
    const id = String(meta(playerOrId, "nametag.style", "none"))
    return STYLES[id] ? id : "none"
}

/**
 * The style actually being drawn — rank OR creator identity.
 *
 * **This exists because the two were asked separately and disagreed.** The
 * nametag renderer checked the creator identity and then the rank; the
 * animation tick checked only the rank. The creator's rank names no style, so
 * the tick skipped them every frame: their name was painted once with the
 * molten colours and then never moved again. Reported from a world as
 * *"they couldn't even see my name changing color"*, and it was not a
 * replication problem — the string genuinely never changed.
 *
 * So there is one answer to "what is this player wearing" now, and both the
 * renderer and the tick ask it. A second caller asking a narrower question is
 * how that bug happened, and a shared function is the only thing that stops it
 * happening again.
 */
export function effectiveNametagStyle(player) {
    const creator = creatorIdentity(player)
    if (creator && !hasNickname(player)) return creator.style
    return nametagStyleFor(player)
}

export function valueFor(playerOrId, key) {
    const spec = RANK_VALUES[key]
    if (!spec) return undefined
    if (spec.kind === "cooldown" && exemptFromCooldowns(playerOrId)) return 0
    const raw = Number(meta(playerOrId, key, spec.fallback))
    if (!Number.isFinite(raw)) return spec.fallback
    return Math.max(spec.min, Math.min(spec.max, raw))
}

export function isStaff(player) {
    if (!player) return false
    if (isOwner(player)) return true
    if (playerRanks(player).some(r => r.staff)) return true
    return isOperator(player)
}

/**
 * Hierarchy protection for anything DONE TO somebody: strictly below you.
 *
 * A peer cannot ban a peer. Two moderators are not each other's moderators —
 * that is what the rank above them is for — and a punishment one equal can
 * hand another is a punishment with no authority behind it.
 *
 * 2.2.5 briefly made this equal-or-below, on the strength of the knockback
 * stick being fine between peers. That was one example generalised into a rule,
 * and it quietly meant a peer could ban a peer. The stick is not the thing to
 * reason from: see canTrollOn below, which is where equals belong.
 *
 * Two exemptions:
 *   - a config OWNER acts on anyone and is acted on by nobody, online or not
 *   - an OPERATOR acts on anyone but a config owner
 *
 * canSeeActionsOf is equal-or-below and asks something different — whether you
 * may SEE what somebody did. Acting is strict; watching is not.
 */
export function canActOn(actor, targetPlayerOrId) {
    if (isOwner(actor)) return true
    const targetId = typeof targetPlayerOrId === "string" ? targetPlayerOrId : targetPlayerOrId?.id
    if (targetId === actor.id) return true
    // isOwner resolves ids too, so an OFFLINE config owner is still protected.
    if (isOwner(targetPlayerOrId)) return false
    // Operators outrank the ladder, but never a config owner (handled above).
    if (isOperator(actor)) return true
    return topWeight(actor) > topWeight(targetId ?? targetPlayerOrId)
}

/**
 * The looser rule, for tools that are a JOKE rather than a punishment: equals
 * included.
 *
 * Two moderators knocking each other about with the stick is banter. Two
 * moderators BANNING each other is a moderation decision neither has the
 * authority to make over the other, which is what `canActOn` is strict for. The
 * difference is not how much it hurts — it is whether it is an exercise of
 * authority or a bit of noise between peers.
 *
 * Everything above you is still off limits, and the same two exemptions apply,
 * so this is exactly `canActOn` with equals let in and nothing else changed.
 *
 * Used by the Knockback stick and `/smite`. Nothing punitive uses it, and
 * nothing should: if a tool leaves a mark somebody has to appeal, it belongs on
 * `canActOn`.
 */
export function canTrollOn(actor, targetPlayerOrId) {
    if (canActOn(actor, targetPlayerOrId)) return true
    if (isOwner(targetPlayerOrId)) return false
    const targetId = typeof targetPlayerOrId === "string" ? targetPlayerOrId : targetPlayerOrId?.id
    return topWeight(actor) === topWeight(targetId ?? targetPlayerOrId)
}

/**
 * Whether `viewer` is allowed to SEE what `actor` did.
 *
 * The rule is equal-or-below: you watch your peers and the people under you,
 * never the people above you. This is a different question from `canActOn`,
 * which asks whether you may act on somebody, and conflating the two is what
 * caused the leak this fixes — the staff notice checked only that the viewer
 * outranked the TARGET, and never looked at the actor at all. So a moderator
 * watched an operator open a third player's ender chest, which is exactly the
 * thing a moderator is not supposed to know about.
 *
 * Note the asymmetry with `canActOn`: acting requires being STRICTLY above,
 * because two peers should not be able to punish each other. Seeing only
 * requires being LEVEL, because peers reviewing each other's moderation is the
 * point of an audit trail.
 */
export function canSeeActionsOf(viewer, actor) {
    if (!actor || !viewer) return true
    if (viewer.id === actor.id) return true
    if (isOwner(viewer)) return true
    if (isOwner(actor)) return false
    // An operator sits above the ladder, so they see everyone; and nobody on
    // the ladder sees them.
    if (isOperator(viewer)) return true
    if (isOperator(actor)) return false
    return topWeight(viewer) >= topWeight(actor)
}

export function canEditRank(actor, rank) {
    if (isUnrestricted(actor)) return true
    if (!rank) return true
    return topWeight(actor) > (rank.weight ?? 0)
}

// ------------------------------------------------ handing out permissions
//
// THE RANK GAP, closed in 2.8.7. canEditRank above only asks whether a rank
// sits below the editor. Nothing asked what the editor could do. So anyone
// who could edit ranks could switch on Ban, or "*", for a rank under them,
// press "Everything (*)" in the ready-made sets, or make that rank get its
// permissions from Owner, and then give the rank to themselves. The Logs
// undo was the same hole from another side: anyone who could read the logs
// could undo a ban, a settings change or a rank change.
//
// The rule now, the way Discord roles work: nobody gives out a permission
// they don't have. Owners and operators sit outside the order and are not
// limited. And nobody raises their own power by changing ranks: a change a
// limited player makes is first worked out as a "what if" (gainedBy), and
// refused if it would give them anything they don't have now.

/** What a rank's answer about a permission has to be for it to give it. */
const GIVES = ["own", "wildcard", "inherited"]

/** A config owner or an operator: outside the order, so not limited by it. */
export function hasFullControl(playerOrId) { return isUnrestricted(playerOrId) }

/** Every permission the pack declares, once each. */
export function allNodes() {
    return [...new Set(Object.values(PERMISSION_NODES).flat())]
}

/**
 * May this player replace the whole rank list: use a template, or put the
 * list back from before the last template or delete? That rewrites every
 * rank, the top one included, so only someone nothing is above who already
 * has every permission: an owner or operator, or a holder of the top rank
 * when they have everything.
 */
export function canReplaceRankList(player) {
    if (isUnrestricted(player)) return true
    const top = ladder()[0]
    if (!top || topWeight(player) < (top.weight ?? 0)) return false
    return allNodes().every(node => has(player, node))
}

/**
 * May `actor` give out this permission, by switching it on for a rank or
 * adding it in a ready-made set? Only if they have it. A wildcard ("admin.*",
 * "*") counts as every declared permission it covers.
 */
export function canGiveNode(actor, pattern) {
    if (isUnrestricted(actor)) return true
    const body = String(pattern ?? "").replace(/^-/, "")
    const covered = allNodes().filter(node => matchScore(body, node) > 0)
    if (!covered.length) return has(actor, body)
    return covered.every(node => has(actor, node))
}

/**
 * The permissions a rank gives that `actor` does not have. Empty means the
 * actor may hand the rank on: give it to someone, or make another rank get
 * its permissions from it.
 */
export function nodesBeyond(actor, rankOrId) {
    const rank = typeof rankOrId === "string" ? ranksTable.get(rankOrId) : rankOrId
    if (!rank || isUnrestricted(actor) || rankType(rank) === "cosmetic") return []
    return allNodes().filter(node => GIVES.includes(rankGrant(rank, node).state) && !has(actor, node))
}

/**
 * Work something out as if a change had been made, without saving it.
 *
 * `change` runs against COPIES of the rank list and the holder list with
 * saving switched off, so it may call saveRank, deleteRank and moveRank. It
 * must not call setRanks, grantRank or revokeRank: those refresh a live
 * player's name and run the demotion hooks at once. gainedBy takes `held`
 * for those instead.
 */
function pretend(change, ask) {
    const tables = [ranksTable, holdersTable]
    const real = tables.map(table => table.data)
    for (const table of tables) {
        table.data = JSON.parse(JSON.stringify(table.data))
        table.flush = () => {}
    }
    pretending = true
    try {
        change()
        return ask()
    } finally {
        pretending = false
        tables.forEach((table, i) => {
            table.data = real[i]
            delete table.flush
        })
    }
}

/**
 * The permissions `player` would GAIN from a change, worked out without
 * making it. `held` is the list of ranks they would then hold; `change`
 * edits ranks (see pretend). Owners and operators gain nothing, because
 * they already have everything.
 */
export function gainedBy(player, { held, change } = {}) {
    if (!player || isUnrestricted(player)) return []
    const id = typeof player === "string" ? player : player.id
    const nodes = allNodes()
    const before = new Set(nodes.filter(node => has(player, node)))
    return pretend(() => {
        if (held) holdersTable.data[id] = { ...record(id), ranks: [...held] }
        change?.()
    }, () => nodes.filter(node => !before.has(node) && has(player, node)))
}

// ------------------------------------------------------------------ display

export function rankTag(id) { return `${CONFIG.ranks.tagPrefix}${id}` }

/** Mirror the table onto the player's tags + refresh their nametag. */
export function syncPlayer(player) {
    try {
        const wanted = new Set(heldRankIds(player).map(rankTag))
        for (const tag of player.getTags()) {
            if (tag.startsWith(CONFIG.ranks.tagPrefix) && !wanted.has(tag)) player.removeTag(tag)
        }
        for (const tag of wanted) player.addTag(tag)
        refreshNameTag(player)
    } catch { /* player left mid-sync */ }
}

function resyncAll() {
    // A "what if" (see pretend) changes nothing real, so there is nothing to show.
    if (pretending) return
    system.run(() => { for (const p of world.getAllPlayers()) syncPlayer(p) })
}

export function refreshNameTag(player) {
    if (!nameTagsEnabled()) return
    try {
        const rank = primaryRank(player)
        const tokens = nameTokens(player)

        // A shifting colour, when the rank grants one. It replaces the NICKNAME
        // token rather than wrapping the whole line, so the rank tag keeps its
        // own colours — the name is the thing being decorated, not the row.
        //
        // **It strips whatever codes the nickname carried.** Painting one code
        // per character over a string that already has its own interleaves two
        // sets and renders as rubbish, so the plain text is what gets painted.
        // Somebody wearing an animated style gives up hand-coloured lettering;
        // that is the trade, and it is why `none` is the default rather than a
        // rank quietly overriding what a player chose for themselves.
        // The creator's default name, when they have not set a nickname. It
        // loses to a nickname deliberately — see creatorIdentity — and a
        // cleared nickname lands back on it rather than on the gamertag.
        const creator = creatorIdentity(player)
        if (creator && !hasNickname(player)) tokens.NICKNAME = applyFont(creator.text, nameFontFor(player))
        // ONE function answers this, and the animation tick asks the same one.
        // Asking separately is what froze the creator's name — see the note on
        // effectiveNametagStyle.
        const styleId = effectiveNametagStyle(player)

        if (styleId !== "none" && flag("feature.namecolour")) {
            const ramp = STYLES[styleId]?.ramp
            if (ramp) {
                tokens.NICKNAME = paint(
                    stripCodes(tokens.NICKNAME), ramp, currentFrame())
            }
        }

        const tag = render("format.nameTag", {
            TAG: renderTags(player),
            RANK: rank?.display ?? "",
            ...tokens
        })
        // Only write when it actually changed. This runs for every player on a
        // timer, and assigning a nametag is a native call whether the string is
        // new or identical to the one already there.
        if (player.nameTag !== tag) player.nameTag = tag
    } catch { /* player left */ }
}

/** Called on join: remember the name, seed the default rank, mirror tags. */
export function onPlayerJoin(player) {
    const existing = holdersTable.get(player.id)
    if (!existing) {
        const fallback = defaultRank()
        holdersTable.set(player.id, {
            name: player.name,
            ranks: fallback ? [fallback.id] : [],
            since: Date.now()
        })
    } else if (existing.name !== player.name) {
        existing.name = player.name
        holdersTable.set(player.id, existing)
    }
    syncPlayer(player)
}
