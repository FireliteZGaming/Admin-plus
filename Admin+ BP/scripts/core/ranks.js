import { world, system, CommandPermissionLevel } from "@minecraft/server"
import { CONFIG } from "../config.js"
import { Table, cleanId } from "./storage.js"
import { displayName } from "./identity.js"
import { render, renderTag, nameTagsEnabled, flag } from "./settings.js"

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
        description: "Owner ▸ Co-Owner ▸ Developer ▸ Admin ▸ Mod ▸ Member. Every tag, split by job.",
        ranks: {
            owner:     { id: "owner",     display: "§4§lOwner",     weight: 100, inherits: [],         perms: ["*"], meta: {}, staff: true },
            coowner:   { id: "coowner",   display: "§c§lCo-Owner",  weight: 90,  inherits: [],         perms: ["*"], meta: {}, staff: true },
            developer: { id: "developer", display: "§d§lDeveloper", weight: 80,  inherits: ["admin"],  perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply", "chat.*"], meta: {}, staff: true },
            admin:     { id: "admin",     display: "§6§lAdmin",     weight: 70,  inherits: ["mod"],    perms: ["admin.ban", "admin.nickname", "admin.sudo", "admin.gamemode", "admin.holograms", "ranks.grant", "warp.manage", "spawn.set", "chat.*"], meta: {}, staff: true },
            mod:       { id: "mod",       display: "§aMod",         weight: 50,  inherits: ["member"], perms: [...STAFF_CORE, "admin.kick", "admin.mute", "admin.freeze", "admin.tpatoggle", "admin.reports", "admin.automod", "admin.clearchat", "admin.lagclear", "admin.tp", "admin.vanish", "admin.invsee", "admin.logs", "admin.broadcast", "admin.settings"], meta: {}, staff: true },
            member:    { id: "member",    display: "§bMember",      weight: 10,  inherits: [],         perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    realm: {
        name: "Realm",
        description: "Owner ▸ Manager ▸ Admin ▸ Mod ▸ Member. The shape a realm actually has.",
        ranks: {
            owner:   { id: "owner",   display: "§4§lOwner",   weight: 100, inherits: [],         perms: ["*"], meta: {}, staff: true },
            manager: { id: "manager", display: "§5§lManager", weight: 85,  inherits: ["admin"],  perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply", "chat.*"], meta: {}, staff: true },
            admin:   { id: "admin",   display: "§6§lAdmin",   weight: 70,  inherits: ["mod"],    perms: ["admin.ban", "admin.nickname", "admin.sudo", "admin.gamemode", "admin.settings", "admin.holograms", "ranks.grant", "warp.manage", "spawn.set", "chat.viewall"], meta: {}, staff: true },
            mod:     { id: "mod",     display: "§aMod",       weight: 50,  inherits: ["member"], perms: [...STAFF_CORE, "admin.kick", "admin.mute", "admin.freeze", "admin.tpatoggle", "admin.reports", "admin.automod", "admin.logs", "admin.invsee", "admin.tp", "admin.vanish", "admin.clearchat", "admin.lagclear", "admin.broadcast"], meta: {}, staff: true },
            member:  { id: "member",  display: "§bMember",    weight: 10,  inherits: [],         perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    smp: {
        name: "SMP",
        description: "Owner ▸ Staff ▸ Member. Nobody expects a hierarchy from an SMP.",
        ranks: {
            owner:  { id: "owner",  display: "§4§lOwner", weight: 100, inherits: [],         perms: ["*"], meta: {}, staff: true },
            staff:  { id: "staff",  display: "§6§lStaff", weight: 60,  inherits: ["member"], perms: ["admin.*", "ranks.view", "ranks.grant", "warp.manage", "spawn.set", "chat.staff"], meta: {}, staff: true },
            member: { id: "member", display: "§bMember",  weight: 10,  inherits: [],         perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    spearmace: {
        name: "Spear Mace",
        description: "A strict PvP world. No TPA, ban sits above Admin, development outranks management, and the long tail of tags are Member with a different name on them.",
        ranks: {
            owner:      { id: "owner",      display: "§5§lOwner",       weight: 100, inherits: [],            perms: ["*"], meta: {}, staff: true },
            // Second on the ladder, above Co-Owner: the development branch
            // outranks both management and the co-owner seat here. It carries
            // the owner tier's grant, which is the only thing separating it
            // from Developer. Teal on "Lead" is the unique colour — nothing
            // else on this ladder uses §3 — and keeping "Developer" in §d says
            // which rank it is senior to.
            leaddev:    { id: "leaddev",    display: "§3§lLead §d§lDeveloper", weight: 97, inherits: [],     perms: ["*"], meta: {}, staff: true },
            coowner:    { id: "coowner",    display: "§4§lCo-Owner",    weight: 95,  inherits: [],            perms: ["*"], meta: {}, staff: true },
            developer:  { id: "developer",  display: "§d§lDeveloper",   weight: 88,  inherits: ["headadmin"], perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply", "chat.*"], meta: {}, staff: true },
            manager:    { id: "manager",    display: "§6§lManager",     weight: 85,  inherits: ["headadmin"], perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply", "chat.*"], meta: {}, staff: true },
            headadmin:  { id: "headadmin",  display: "§c§lHead Admin",  weight: 80,  inherits: ["admin"],     perms: ["admin.ban", "admin.settings", "admin.holograms", "ranks.grant", "warp.manage", "spawn.set", "chat.viewall", "chat.manage"], meta: {}, staff: true },
            admin:      { id: "admin",      display: "§cAdmin",         weight: 70,  inherits: ["moderator"], perms: ["admin.mute", "admin.tpatoggle", "admin.automod", "admin.logs", "admin.gamemode", "admin.nickname", "admin.tp", "admin.vanish", "admin.clearchat", "admin.lagclear", "admin.broadcast"], meta: {}, staff: true },
            moderator:  { id: "moderator",  display: "§b§lModerator",   weight: 50,  inherits: ["member"],    perms: ["admin.panel", "ranks.view", "chat.staff", "admin.kick", "admin.freeze", "admin.reports", "admin.invsee"], meta: {}, staff: true },
            ht2_elytra_mace:   { id: "ht2_elytra_mace",   display: "§dHt2 Elytra mace", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            ht1_elytra_mace:   { id: "ht1_elytra_mace",   display: "§9Ht1 Elytra mace", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            ht2:               { id: "ht2",               display: "§cHt2", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            ht1_sword:         { id: "ht1_sword",         display: "§aHt1 sword", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            ht1_at_sword:      { id: "ht1_at_sword",      display: "§dHt1 at sword", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            ht1_cart:          { id: "ht1_cart",          display: "§cHt1 Cart", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            ht1_gamemodes:     { id: "ht1_gamemodes",     display: "§bHt1 all gamemodes", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            vipplus:           { id: "vipplus",           display: "§aVip+", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            vip:               { id: "vip",               display: "§aVip", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            king_overworld:    { id: "king_overworld",    display: "§bKing of the Overworld", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            king_nether:       { id: "king_nether",       display: "§cKing of the nether", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            king_end:          { id: "king_end",          display: "§dKing of the end", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            king_abyss:        { id: "king_abyss",        display: "§aKing of abyss", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            king_dimensions:   { id: "king_dimensions",   display: "§cKing of all dimensions", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            queen_dimensions:  { id: "queen_dimensions",  display: "§bQueen of all Dimensions", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            emperor_end:       { id: "emperor_end",       display: "§dEmperor of the End", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            admiral_dimensions:{ id: "admiral_dimensions",display: "§eAdmiral of All Dimensions", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            god_builder:       { id: "god_builder",       display: "§aGOD BUILDER", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            head_builder:      { id: "head_builder",      display: "§dHead builder", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            void:              { id: "void",              display: "§0Void", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            dab_gf:            { id: "dab_gf",            display: "§adab gf :sob:", weight: 15, inherits: ["member"], perms: [], meta: {}, staff: false },
            member:     { id: "member",     display: "§aMember",        weight: 10,  inherits: [],            perms: ["warp.use", "spawn.use", "report.use", "online.use", "-tpa.use"], meta: {}, staff: false, default: true }
        }
    },
    lockdown: {
        name: "Lockdown",
        description: "Staff keep everything; members get spawn and warps only — no TPA.",
        ranks: {
            owner:  { id: "owner",  display: "§4§lOwner", weight: 100, inherits: [], perms: ["*"], meta: {}, staff: true },
            staff:  { id: "staff",  display: "§c§lStaff", weight: 60,  inherits: [], perms: ["admin.*", "ranks.view", "warp.*", "spawn.use", "spawn.set", "tpa.use", "chat.staff"], meta: {}, staff: true },
            member: { id: "member", display: "§7Member",  weight: 10,  inherits: [], perms: ["warp.use", "spawn.use", "report.use", "online.use", "-tpa.use"], meta: {}, staff: false, default: true }
        }
    },
    donor: {
        name: "Donor Tiers",
        description: "Staff ladder plus VIP ▸ VIP+ ▸ MVP cosmetic tiers.",
        ranks: {
            owner:   { id: "owner",   display: "§4§lOwner",  weight: 100, inherits: [],          perms: ["*"], meta: {}, staff: true },
            admin:   { id: "admin",   display: "§c§lAdmin",  weight: 80,  inherits: ["mod"],     perms: ["admin.*", "ranks.*", "warp.manage", "spawn.set", "presets.apply"], meta: {}, staff: true },
            mod:     { id: "mod",     display: "§6Mod",      weight: 60,  inherits: ["member"],  perms: [...STAFF_CORE, "admin.kick", "admin.mute", "admin.freeze", "admin.tp", "admin.invsee", "admin.logs", "admin.reports"], meta: {}, staff: true },
            mvp:     { id: "mvp",     display: "§d§lMVP",    weight: 35,  inherits: ["vipplus"], perms: [], meta: {}, staff: false },
            vipplus: { id: "vipplus", display: "§e§lVIP§6+", weight: 30,  inherits: ["vip"],     perms: [], meta: {}, staff: false },
            vip:     { id: "vip",     display: "§eVIP",      weight: 25,  inherits: ["member"],  perms: [], meta: {}, staff: false },
            member:  { id: "member",  display: "§bMember",   weight: 10,  inherits: [],          perms: [...BASIC_PERMS], meta: {}, staff: false, default: true }
        }
    },
    roleplay: {
        name: "Roleplay / Factions",
        description: "Staff ladder plus flavour ranks (Citizen ▸ Merchant ▸ Noble) sharing member perms.",
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
 */
export const PERMISSION_NODES = {
    "Panel & info": ["admin.panel", "admin.settings", "admin.logs", "ranks.view"],
    "Moderation": ["admin.kick", "admin.ban", "admin.mute", "admin.freeze", "admin.invsee", "admin.tpatoggle", "admin.reports", "admin.automod"],
    "Staff tools": ["admin.tp", "admin.vanish", "admin.gamemode", "admin.nickname", "admin.sudo", "admin.holograms"],
    "Chat": ["chat.staff", "chat.viewall", "chat.manage", "admin.broadcast"],
    "World upkeep": ["admin.clearchat", "admin.lagclear"],
    "Management": ["ranks.grant", "ranks.manage", "warp.manage", "spawn.set", "presets.apply"],
    "Player basics": ["warp.use", "spawn.use", "tpa.use", "report.use", "online.use"]
}

/** Checkbox-sized groupings for the rank editor form. */
export const BUNDLES = {
    "mod_light":   { label: "Moderation — light", nodes: ["admin.panel", "ranks.view", "admin.kick", "admin.mute", "admin.freeze", "admin.tpatoggle", "admin.reports"] },
    "mod_full":    { label: "Moderation — full",  nodes: ["admin.panel", "ranks.view", "admin.kick", "admin.mute", "admin.freeze", "admin.tpatoggle", "admin.reports", "admin.automod", "admin.ban", "admin.invsee", "admin.logs"] },
    "staff_tools": { label: "Staff tools",        nodes: ["admin.tp", "admin.vanish", "admin.gamemode"] },
    "holograms":   { label: "Floating text",      nodes: ["admin.holograms"] },
    "identity":    { label: "Names & voice",      nodes: ["admin.nickname", "admin.sudo"] },
    "chat":        { label: "Staff chat",         nodes: ["chat.staff"] },
    "chat_all":    { label: "See every chat",     nodes: ["chat.staff", "chat.viewall"] },
    "chat_manage": { label: "Run the chats",      nodes: ["chat.staff", "chat.manage", "admin.broadcast"] },
    "warps":       { label: "Warp management",    nodes: ["warp.manage", "spawn.set"] },
    "upkeep":      { label: "World upkeep",       nodes: ["admin.clearchat", "admin.lagclear"] },
    "ranks":       { label: "Rank management",    nodes: ["ranks.view", "ranks.grant", "ranks.manage"] },
    "shape":       { label: "Server shape",       nodes: ["admin.settings", "presets.apply"] },
    "basics":      { label: "Player basics",      nodes: [...BASIC_PERMS] },
    "everything":  { label: "Everything (*)",     nodes: ["*"] }
}

export const ranksTable = new Table(RANKS_KEY, DEFAULT_RANKS)
export const holdersTable = new Table(HOLDERS_KEY, {})
// One instance: constructing a Table schedules a deferred seed write, so making
// a fresh one per snapshot call would queue a write on every check.
const snapshotTable = new Table(SNAPSHOT_KEY, {})

// ---------------------------------------------------------------- rank table

export function allRanks() {
    return Object.values(ranksTable.data).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
}

export function getRank(id) { return ranksTable.get(id) }

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

/** The ladder, strongest first. */
export function ladder() { return allRanks() }

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
    // A brand-new rank joins at the BOTTOM of the ladder — the safe end. Moving
    // it up is a deliberate act on the ladder screen.
    const bottomWeight = Math.min(...Object.values(ranksTable.data).map(r => r.weight ?? 0), LADDER_STEP)
    /** @type {Rank} */
    const rank = {
        id: rankId,
        display: data.display ?? existing?.display ?? `§7${rankId}`,
        weight: Number.isFinite(Number(data.weight))
            ? Number(data.weight)
            : (existing?.weight ?? Math.max(1, bottomWeight - LADDER_STEP)),
        inherits: data.inherits ?? existing?.inherits ?? [],
        perms: data.perms ?? existing?.perms ?? [],
        meta: data.meta ?? existing?.meta ?? {},
        staff: data.staff ?? existing?.staff ?? false,
        default: data.default ?? existing?.default ?? false,
        // Granting this rank clears the weaker ranks the player holds, so a
        // promotion reads as a promotion. Turn it off for cosmetic ranks that
        // are meant to sit alongside whatever someone already has.
        replacesLower: data.replacesLower ?? existing?.replacesLower ?? true
    }
    // Only one default rank at a time.
    if (rank.default) {
        for (const other of Object.values(ranksTable.data)) {
            if (other.id !== rankId && other.default) { other.default = false }
        }
    }
    ranksTable.set(rankId, rank)
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
    ranksTable.replace(JSON.parse(JSON.stringify(preset.ranks)))
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

/** Rank ids a player holds (works offline — reads the table, not tags). */
export function heldRankIds(playerOrId) {
    const id = typeof playerOrId === "string" ? playerOrId : playerOrId?.id
    const held = (record(id).ranks ?? []).filter(r => ranksTable.has(r))
    if (held.length) return held
    const fallback = defaultRank()
    return fallback ? [fallback.id] : []
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
export function playerRanks(playerOrId) {
    return displayRanks(playerOrId).slice().sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
}

// ------------------------------------------------------------ author's badge

/**
 * One gamertag gets a tag of its own in any world running this pack.
 *
 * It is a BADGE AND NOTHING ELSE. No permissions, not staff, weight 0. An
 * addon that handed its own author authority inside a stranger's world would be
 * a backdoor whatever it was called, and would deserve to be pulled from every
 * site that hosts it — so `has()` finds nothing to say about any node here and
 * the answer comes from whatever real rank they hold, which for a visitor is
 * the default one. Weight 0 keeps it under every ladder, so `topWeight` and
 * `canActOn` never see it either.
 *
 * It also lives OUTSIDE ranksTable, which is what makes it survive a preset
 * replacing the whole ladder — and what stops it being granted to anyone else,
 * renamed, or edited in the rank screens.
 */
export const CREATOR_GAMERTAG = "FireliteZGaming"

const CREATOR_RANK = Object.freeze({
    id: "adminplus_creator",
    // The pack's own two colours, then the title in a shade no ladder rank
    // uses — so it reads as the pack's mark rather than as a rank in the world.
    display: "§bAdmin§d+§r §e§lCreator",
    weight: 0,
    inherits: [],
    perms: [],
    meta: {},
    staff: false
})

function isCreator(playerOrId) {
    const name = typeof playerOrId === "string"
        ? record(playerOrId).name
        : playerOrId?.name
    return String(name ?? "").toLowerCase() === CREATOR_GAMERTAG.toLowerCase()
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

/** Rank objects in the player's own display order — the cosmetic view. */
export function displayRanks(playerOrId) {
    const held = heldRankIds(playerOrId).map(id => ranksTable.get(id)).filter(Boolean)
    // In FRONT of what they hold, so it is the tag that shows — and gone the
    // moment a world hands them a rank of its own, which is the whole contract.
    if (isCreator(playerOrId) && onlyDefaultRank(playerOrId)) return [CREATOR_RANK, ...held]
    return held
}

export { CREATOR_RANK, isCreator }

/** The rank that shows as their tag: first in their display order. */
export function primaryRank(playerOrId) { return displayRanks(playerOrId)[0] }

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
    holdersTable.set(playerId, {
        name: name ?? existing.name ?? "",
        ranks: clean,
        since: existing.since ?? Date.now()
    })
    const online = world.getAllPlayers().find(p => p.id === playerId)
    if (online) syncPlayer(online)
    return clean
}

export function grantRank(playerId, rankId, name) {
    if (!ranksTable.has(rankId)) return false
    const rank = ranksTable.get(rankId)
    const weight = rank.weight ?? 0
    let held = heldRankIds(playerId).filter(id => id !== rankId)

    // A promotion should not leave the old rank underneath it. When the rank
    // replaces lower ones, every weaker rank the player holds is dropped —
    // giving VIP to a Member leaves them VIP, not VIP-and-Member. Ranks marked
    // as stacking (cosmetic ones) keep everything instead.
    if (rank.replacesLower !== false) {
        held = held.filter(id => (ranksTable.get(id)?.weight ?? 0) > weight)
    }

    // Insert by LADDER position rather than appending. The tag a player wears is
    // the first entry in their display order, so appending meant granting Mod to
    // a Member changed nothing visible — the grant worked, but they kept wearing
    // Member and it read as a no-op. Strongest-first is the sane default; the
    // display-order screen can still override it per player afterwards.
    const at = held.findIndex(id => (ranksTable.get(id)?.weight ?? 0) < weight)
    if (at < 0) held.push(rankId)
    else held.splice(at, 0, rankId)

    setRanks(playerId, held, name)
    return true
}

/** What granting this rank would remove, for the confirmation copy. */
export function displacedBy(playerId, rankId) {
    const rank = ranksTable.get(rankId)
    if (!rank || rank.replacesLower === false) return []
    const weight = rank.weight ?? 0
    return heldRankIds(playerId)
        .filter(id => id !== rankId && (ranksTable.get(id)?.weight ?? 0) <= weight)
        .map(id => ranksTable.get(id))
        .filter(Boolean)
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

function isOperator(player) {
    if (!CONFIG.opIsStaff) return false
    try {
        const level = player.commandPermissionLevel
        return typeof level === "number" && level >= (CommandPermissionLevel?.GameDirectors ?? 1)
    } catch { return false }
}

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

/** Resolved meta value — heaviest rank that defines the key wins. */
export function meta(playerOrId, key, fallback) {
    for (const rank of playerRanks(playerOrId)) {
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
    if (flag("staff.exemptCooldowns")) {
        if (typeof playerOrId !== "string" && isStaff(playerOrId)) return 0
        if (playerRanks(playerOrId).some(r => r.staff)) return 0
    }
    const value = Number(meta(playerOrId, "tpCooldown", fallback))
    return Number.isFinite(value) && value > 0 ? value : 0
}

export function isStaff(player) {
    if (!player) return false
    if (isOwner(player)) return true
    if (playerRanks(player).some(r => r.staff)) return true
    return isOperator(player)
}

/**
 * Hierarchy protection: staff may only act on players strictly below them, and
 * may only touch ranks lighter than their own. Config owners are immune and
 * unrestricted.
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

export function canEditRank(actor, rank) {
    if (isUnrestricted(actor)) return true
    if (!rank) return true
    return topWeight(actor) > (rank.weight ?? 0)
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
    system.run(() => { for (const p of world.getAllPlayers()) syncPlayer(p) })
}

export function refreshNameTag(player) {
    if (!nameTagsEnabled()) return
    try {
        const rank = primaryRank(player)
        player.nameTag = render("format.nameTag", {
            TAG: renderTag(rank),
            RANK: rank?.display ?? "",
            NAME: displayName(player)
        })
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
