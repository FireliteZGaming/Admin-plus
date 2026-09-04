import { PRESETS as LADDERS, applyPreset as applyLadder, ladder } from "./ranks.js"
import { DEFAULTS, setting, setSetting } from "./settings.js"
import { allChannels, getChannel, saveChannel, DEFAULT_CHANNELS } from "./channels.js"

// Server presets — one preset that describes a whole server.
//
// There were two unrelated preset systems before this: rank presets swapped the
// ladder, config presets swapped the settings block, and nothing said the two
// went together. Applying "Realm" to the config and "Classic SMP" to the ladder
// was two separate acts producing a combination nobody had thought about.
//
// A server preset names all of it at once — ladder, config and channels — so a
// preset MEANS something: a coherent shape whose parts were chosen to work with
// each other. Detection is derived, never stored, exactly like the config
// presets: change any part of it and it reads Custom on its own, because Custom
// is the honest answer once the pieces no longer match a named shape.
//
// What a preset deliberately does NOT touch:
//   * Warps — it cannot invent locations, and yours are yours.
//   * Who holds which rank — people keep their ranks. A rank the new ladder
//     does not define simply stops existing, which is worth saying out loud
//     before anyone presses the button.
//   * Channels you made — it adds the ones it names and removes nothing.

/** @typedef {{id: string, label: string, description: string, ladder: string, config: Record<string,string>, channels: string[], notes: string}} ServerPreset */

/** @type {Record<string, ServerPreset>} */
export const SERVER_PRESETS = {
    server: {
        id: "server",
        label: "Server",
        description: "The full staff ladder, a protected spawn, alerts on.",
        ladder: "server",
        config: {
            "spawn.protect": "true",
            "spawn.radius": "24",
            "teleport.warmup": "3",
            "teleport.cooldown": "5",
            "staff.exemptCooldowns": "true",
            "automod.ores": "true",
            "automod.breaks": "true",
            "automod.spam": "true",
            "presence.announce": "true",
            "feature.chat": "true"
        },
        channels: ["general", "staff"],
        notes: "A public survival server with a real staff team: seven ranks, staff chat, automod watching, and teleports that make you stand still for a moment."
    },
    realm: {
        id: "realm",
        label: "Realm",
        description: "Three ranks, quick teleports, light automod, chatty.",
        ladder: "realm",
        config: {
            "spawn.protect": "true",
            "spawn.radius": "16",
            "teleport.warmup": "0",
            "teleport.cooldown": "2",
            "staff.exemptCooldowns": "true",
            "automod.ores": "false",
            "automod.breaks": "true",
            "automod.spam": "true",
            "presence.announce": "true",
            "feature.chat": "true"
        },
        channels: ["general", "staff"],
        notes: "A handful of friends. Everyone roughly trusts everyone, so teleports are instant and ore alerts would just be noise — but spam and impossible mining still get flagged."
    },
    smp: {
        id: "smp",
        label: "SMP",
        description: "Owner, Staff, Member. Teleports free, almost nothing watched.",
        ladder: "smp",
        config: {
            "spawn.protect": "false",
            "teleport.warmup": "0",
            "teleport.cooldown": "0",
            "staff.exemptCooldowns": "true",
            "automod.ores": "false",
            "automod.breaks": "false",
            "automod.spam": "true",
            "presence.announce": "true",
            "feature.chat": "true"
        },
        channels: ["general", "staff"],
        notes: "People who already know each other. There is no hierarchy to speak of and nothing to police but spam, so the addon mostly stays out of the way - the panel and moderation are there for the day you need them."
    },
    spearmace: {
        id: "spearmace",
        label: "Spear Mace",
        description: "Strict PvP. No TPA, ban above Admin, everything watched.",
        ladder: "spearmace",
        config: {
            "feature.tpa": "false",
            "spawn.protect": "true",
            "spawn.radius": "32",
            "teleport.warmup": "3",
            "teleport.cooldown": "10",
            "staff.exemptCooldowns": "false",
            "automod.ores": "true",
            "automod.breaks": "true",
            "automod.spam": "true",
            "presence.announce": "true",
            "feature.chat": "true"
        },
        channels: ["general", "staff"],
        notes: "A spear-and-mace PvP world, run tight. Teleport requests are off entirely — you walk, or you fight. Banning sits above Admin on purpose: Moderator is a trial rank, Admin runs the day, and the irreversible button belongs to Head Admin and up. Most of the ladder is cosmetic: tags that are Member with a different name, so awarding one replaces the Member tag rather than stacking on it."
    },
    lockdown: {
        id: "lockdown",
        label: "Locked down",
        description: "Long warmups, wide protection, staff not exempt.",
        // Lockdown is a MODE a server goes into, not a shape a server has, so
        // it no longer carries a ladder of its own — it borrows the SMP one,
        // which is the same owner/staff/member shape it always installed. The
        // old ladder expressed "members cannot TPA" as a permission denial
        // buried in a rank; `feature.tpa` says it out loud, and says it for
        // everybody, which is what a lockdown should mean anyway.
        ladder: "smp",
        config: {
            "feature.tpa": "false",
            "spawn.protect": "true",
            "spawn.radius": "64",
            "teleport.warmup": "5",
            "teleport.cooldown": "15",
            "staff.exemptCooldowns": "false",
            "automod.ores": "true",
            "automod.breaks": "true",
            "automod.spam": "true",
            "presence.announce": "true",
            "feature.chat": "true"
        },
        channels: ["general", "staff"],
        notes: "Something went wrong and you are tightening up. Staff wait the same cooldowns as everyone else, deliberately — during an incident the rules should visibly apply to the people enforcing them."
    },
    quiet: {
        id: "quiet",
        label: "Quiet survival",
        description: "Nothing announced. No join lines, no automod, one chat.",
        ladder: "smp",
        config: {
            "presence.announce": "false",
            "automod.ores": "false",
            "automod.breaks": "false",
            "automod.spam": "false",
            "spawn.protect": "false",
            "teleport.warmup": "0",
            "teleport.cooldown": "0",
            "feature.chat": "false"
        },
        channels: ["general"],
        notes: "A survival world that wants to be left alone. Admin+ still gives you the panel, ranks and moderation — it just stops talking."
    }
}

export function allServerPresets() { return SERVER_PRESETS }
export function getServerPreset(id) { return SERVER_PRESETS[id] }

// ---------------------------------------------------------------- detection

/**
 * A ladder reduced to the things a preset actually claims about it, with every
 * list sorted so that "the same ladder in a different order" still matches.
 */
function shapeOf(ranks) {
    return JSON.stringify(
        [...ranks]
            .map(rank => [
                rank.id,
                rank.display,
                rank.weight,
                [...(rank.perms ?? [])].sort(),
                [...(rank.inherits ?? [])].sort(),
                !!rank.staff
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    )
}

/** Does the live ladder still match the one this preset names? */
export function ladderMatches(presetId) {
    const preset = SERVER_PRESETS[presetId]
    const source = LADDERS[preset?.ladder]
    if (!source) return false
    return shapeOf(ladder()) === shapeOf(Object.values(source.ranks))
}

/** Does every config value this preset names still hold? */
export function configMatches(presetId) {
    const preset = SERVER_PRESETS[presetId]
    if (!preset) return false
    return Object.entries(preset.config).every(([key, value]) =>
        key in DEFAULTS && setting(key) === value)
}

/** Does every channel this preset names exist? */
export function channelsMatch(presetId) {
    const preset = SERVER_PRESETS[presetId]
    if (!preset) return false
    return preset.channels.every(id => !!getChannel(id))
}

/**
 * Which named shape this server currently is.
 * @returns {{id: string, label: string, parts?: {ladder: boolean, config: boolean, channels: boolean}}}
 */
export function detectServerPreset() {
    // Order matters. Two shapes can share a ladder (SMP and Quiet both use the
    // smp one), so the first full match wins and the list is written most
    // specific first.
    for (const id of Object.keys(SERVER_PRESETS)) {
        if (ladderMatches(id) && configMatches(id) && channelsMatch(id)) {
            return { id, label: SERVER_PRESETS[id].label }
        }
    }
    return { id: "custom", label: "Custom" }
}

/**
 * How close one preset is, part by part — so "Custom" can say WHICH piece
 * drifted instead of leaving you to diff it yourself.
 */
export function partsOf(presetId) {
    return {
        ladder: ladderMatches(presetId),
        config: configMatches(presetId),
        channels: channelsMatch(presetId)
    }
}

/** The preset the server is closest to, and what does not match. */
export function nearestPreset() {
    let best
    for (const id of Object.keys(SERVER_PRESETS)) {
        const parts = partsOf(id)
        const score = [parts.ladder, parts.config, parts.channels].filter(Boolean).length
        if (!best || score > best.score) best = { id, label: SERVER_PRESETS[id].label, parts, score }
    }
    return best
}

// ------------------------------------------------------------------ applying

/**
 * Apply all three parts. Returns what it did, so the screen can report it
 * rather than claim a generic success.
 */
export function applyServerPreset(id) {
    const preset = SERVER_PRESETS[id]
    if (!preset) return undefined

    // The ladder goes first: it takes the one-step undo snapshot, and the
    // config below is the config that suits the ladder above it.
    const ladderApplied = applyLadder(preset.ladder)

    let configCount = 0
    for (const [key, value] of Object.entries(preset.config)) {
        if (!(key in DEFAULTS)) continue          // a key that has since been renamed
        setSetting(key, value)
        configCount++
    }

    const channelsAdded = []
    for (const channelId of preset.channels) {
        if (getChannel(channelId)) continue
        const seed = DEFAULT_CHANNELS[channelId]
        saveChannel(channelId, seed ?? { display: `§7${channelId}`, open: false })
        channelsAdded.push(channelId)
    }

    return {
        ladder: ladderApplied ? LADDERS[preset.ladder]?.name : undefined,
        ranks: ladderApplied ? Object.keys(LADDERS[preset.ladder].ranks).length : 0,
        configCount,
        channelsAdded,
        channelsKept: allChannels().length - channelsAdded.length
    }
}
