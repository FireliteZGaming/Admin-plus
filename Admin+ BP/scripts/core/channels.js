import { world } from "@minecraft/server"
import { Table, cleanId } from "./storage.js"
import { has, isStaff } from "./ranks.js"
import { flag } from "./settings.js"

// Chat channels.
//
// A channel is a named room with a permission node. You TYPE IN exactly one at a
// time (your active channel) and you RECEIVE one or more (your visible set).
//
// Two ideas keep it honest:
//   * Access is not membership — holding chat.staff means you may switch to
//     Staff, not that you are stuck in it.
//   * "View All Chats" widens you to every channel you ALREADY have access to.
//     It never reaches past that, so it can't leak Staff to a member.

const CHANNELS_KEY = "channels"
const ACTIVE_KEY = "chatActive"

/**
 * @typedef {{
 *   id: string, display: string, node: string,
 *   open: boolean, order: number
 * }} Channel
 */

export const DEFAULT_CHANNELS = {
    general: { id: "general", display: "§7General", node: "chat.general", open: true, order: 0 },
    staff:   { id: "staff",   display: "§cStaff",   node: "chat.staff",   open: false, order: 1 }
}

const channels = new Table(CHANNELS_KEY, DEFAULT_CHANNELS)
const active = new Table(ACTIVE_KEY, {})

const idOf = p => typeof p === "string" ? p : p?.id

export function allChannels() {
    return Object.values(channels.data).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function getChannel(id) { return channels.get(id) }

/** The channel everyone falls back to — first open channel, else first. */
export function defaultChannel() {
    const list = allChannels()
    return list.find(c => c.open) ?? list[0]
}

export function saveChannel(id, data) {
    const channelId = cleanId(id).toLowerCase().replace(/\s+/g, "_")
    if (!channelId) return undefined
    const existing = channels.get(channelId)
    const bottom = Math.max(-1, ...allChannels().map(c => c.order ?? 0))
    /** @type {Channel} */
    const channel = {
        id: channelId,
        display: data.display ?? existing?.display ?? `§7${channelId}`,
        node: data.node ?? existing?.node ?? `chat.${channelId}`,
        open: data.open ?? existing?.open ?? false,
        order: data.order ?? existing?.order ?? bottom + 1
    }
    channels.set(channelId, channel)
    return channel
}

export function deleteChannel(id) {
    channels.delete(id)
    // Anyone parked in the deleted channel falls back on their next message.
    for (const [playerId, channelId] of active.entries()) {
        if (channelId === id) active.delete(playerId)
    }
}

export function moveChannel(id, delta) {
    const list = allChannels()
    const from = list.findIndex(c => c.id === id)
    if (from < 0) return false
    const to = from + delta
    if (to < 0 || to >= list.length) return false
    list.splice(to, 0, ...list.splice(from, 1))
    list.forEach((channel, index) => { channel.order = index })
    channels.flush()
    return true
}

// ---------------------------------------------------------------- access

/** May this player type in, and receive, this channel? */
export function canUse(player, channel) {
    if (!channel) return false
    if (channel.open) return true
    // Being staff IS the qualification for the staff channel. A rank marked
    // staff that somebody built by hand might never have been given chat.staff,
    // and a staff member who cannot reach staff chat is a broken rank, not a
    // deliberate one. Channels made LATER still gate on their own node, which
    // is what lets a manager run a room most staff cannot read.
    if (channel.id === "staff" && isStaff(player)) return true
    return has(player, channel.node)
}

/**
 * Every channel this player is allowed to touch, in ladder order.
 *
 * With the feature switched off everyone shares the default channel — the
 * channels still exist in storage, so turning it back on restores them
 * untouched rather than making the operator rebuild them.
 */
export function availableTo(player) {
    if (!flag("feature.chat")) {
        const only = defaultChannel()
        return only ? [only] : []
    }
    return allChannels().filter(c => canUse(player, c))
}

/** Operators get this for free, same as every other node. */
/**
 * Who reads more than one room at a time.
 *
 * STAFF ALWAYS DO. A moderator watching General had to leave it to read Staff
 * and leave Staff to read General, which is not how anybody actually works —
 * you want both in front of you. So staff receive every channel they have
 * ACCESS to, and access is what does the limiting: a Mod holds General and
 * Staff, so that is what they see. A channel a manager creates carries its own
 * node, so it stays out of a Mod's view until they are given it.
 *
 * chat.viewall still exists for the same reason it always did — handing the
 * whole picture to somebody who is not staff.
 */
export function viewsAll(player) {
    return isStaff(player) || has(player, "chat.viewall")
}

/** The channel this player is currently typing in. */
export function activeChannel(player) {
    const stored = channels.get(active.get(idOf(player)))
    if (stored && canUse(player, stored)) return stored
    // Lost access (or the channel was deleted) — fall back rather than strand them.
    return availableTo(player)[0] ?? defaultChannel()
}

export function setActiveChannel(player, channelId) {
    const channel = channels.get(channelId)
    if (!channel || !canUse(player, channel)) return undefined
    active.set(idOf(player), channelId)
    return channel
}

/**
 * What this player RECEIVES: their active channel, or everything they have
 * access to when they hold View All.
 */
export function visibleTo(player) {
    if (viewsAll(player)) return availableTo(player)
    const current = activeChannel(player)
    return current ? [current] : []
}

/** Everyone who should receive a message posted in this channel. */
export function audienceFor(channel) {
    return world.getAllPlayers().filter(p => visibleTo(p).some(c => c.id === channel.id))
}

// ------------------------------------------------------------- chat lockdown

/**
 * Muting a CHANNEL, which is a different thing from muting a person.
 *
 * A player mute is a punishment aimed at one player and is nobody else's
 * business. A chat mute is a room-wide measure — an argument to cool down, a
 * raid, a staff announcement nobody should talk over — and hiding WHO did it
 * would be worse than useless: players would think chat was broken. It is the
 * one action in the pack announced to everybody, by name.
 *
 * Stored per channel rather than as one global flag, so muting General does not
 * silence Staff — which is usually the entire reason for muting General.
 */
const CHATMUTE_KEY = "chatMutes"
const chatMutes = new Table(CHATMUTE_KEY, {})

export function isChannelMuted(channelId) {
    return !!chatMutes.get(typeof channelId === "string" ? channelId : channelId?.id)
}

/** Who muted it and when, or undefined. */
export function channelMute(channelId) {
    return chatMutes.get(typeof channelId === "string" ? channelId : channelId?.id)
}

export function muteChannel(channelId, by) {
    const id = typeof channelId === "string" ? channelId : channelId?.id
    if (!channels.has(id)) return undefined
    return chatMutes.set(id, { by: by?.name ?? "console", byId: idOf(by), at: Date.now() })
}

export function unmuteChannel(channelId) {
    const id = typeof channelId === "string" ? channelId : channelId?.id
    if (!chatMutes.has(id)) return false
    chatMutes.delete(id)
    return true
}

/** Every channel currently muted, as channel objects. */
export function mutedChannels() {
    return allChannels().filter(c => isChannelMuted(c.id))
}

/**
 * Apply to every channel at once — what "all" means on the command.
 *
 * Deliberately NOT a global flag: a flag would silently swallow a channel made
 * afterwards, and "why is my new channel muted" is a bug report nobody can
 * answer. This mutes what exists, and what exists is what the panel lists.
 * @returns {number} how many changed
 */
export function setAllChannelsMuted(muted, by) {
    let changed = 0
    for (const channel of allChannels()) {
        if (muted && !isChannelMuted(channel.id)) { muteChannel(channel.id, by); changed++ }
        else if (!muted && isChannelMuted(channel.id)) { unmuteChannel(channel.id); changed++ }
    }
    return changed
}
