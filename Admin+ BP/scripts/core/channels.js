import { world } from "@minecraft/server"
import { Table, cleanId } from "./storage.js"
import { has } from "./ranks.js"
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
export function viewsAll(player) { return has(player, "chat.viewall") }

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
