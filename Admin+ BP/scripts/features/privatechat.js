import { world, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { CONFIG } from "../config.js"
import { ok, err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { isMuted } from "../core/moderation.js"
import { render, flag } from "../core/settings.js"
import {
    rememberExchange, replyTarget, isSpying, toggleSpying, spyIds,
    pairedWith, inPair, startPair, endPair,
    invite, inviteFrom, pendingInvite, clearInvite, INVITE_SECONDS, forgetPlayer
} from "../core/privatechat.js"

// /pm <player> <message>   one message, to one person
// /r <message>             answer whoever spoke to you last
// /prchat <player>         ask to open a standing two-person session
// /prchat                  leave the one you are in
// /prexit                  leave it, spelled out
// /socialspy               staff: read other people's private messages
//
// A NAMING NOTE, the same one /emote carries: /msg, /tell and /w are all
// VANILLA Bedrock commands. Custom commands register namespaced and the bare
// form only reaches you if nothing else claims it, so /msg would run vanilla's
// and ours would be stranded at /a:msg. /pm is the free name. a:msg is
// registered too, for the fingers that type it anyway.
//
// What "private" means here, precisely: not the room, and not the channel. It
// is NOT hidden from staff holding chat.spy, and NOT hidden from the content
// log — same as every other line in this pack. Anything else would be a promise
// the server owner cannot keep.

// ------------------------------------------------------------------ one-shots

command({
    name: "pm",
    description: "Send a private message — /pm <player> <message>",
    mandatory: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "message", type: CustomCommandParamType.String }
    ],
    run: (player, [selected, message]) => sendPrivate(player, selected, message)
})

// Bare /msg belongs to vanilla; this exists so /a:msg works.
command({
    name: "msg",
    description: "Send a private message — same as /pm (bare /msg is vanilla's)",
    mandatory: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "message", type: CustomCommandParamType.String }
    ],
    run: (player, [selected, message]) => sendPrivate(player, selected, message)
})

command({
    name: "r",
    description: "Reply to the last person who messaged you — /r <message>",
    mandatory: [{ name: "message", type: CustomCommandParamType.String }],
    run: (player, [message]) => {
        const targetId = replyTarget(player)
        if (!targetId) return err(player, "Nobody has messaged you yet.")
        const target = world.getAllPlayers().find(p => p.id === targetId)
        if (!target) return err(player, "They have gone offline.")
        sendPrivate(player, [target], message)
    }
})

function sendPrivate(player, selected, message) {
    if (!flag("feature.pm")) return err(player, "Private messages are turned off on this server.")

    const targets = selected ?? []
    if (!targets.length) return err(player, "No player matched that selector.")
    if (targets.length > 1) return err(player, "One person at a time — that is what makes it private.")

    const target = targets[0]
    if (target.id === player.id) return err(player, "Talking to yourself is not a feature.")

    const text = String(message ?? "").trim().slice(0, 240)
    if (!text) return err(player, "Say what?")

    // A muted player is muted everywhere. A mute that left private messages
    // open would be a mute in name only.
    if (isMuted(player)) return err(player, "You are muted.")

    player.sendMessage(render("format.pmOut", { NAME: displayName(target), MSG: text }))
    target.sendMessage(render("format.pmIn", { NAME: displayName(player), MSG: text }))
    rememberExchange(player, target)
    spy(player, target, text, "pm")
}

// ----------------------------------------------------------------- socialspy

command({
    name: "socialspy",
    description: "Read other people's private messages — /socialspy",
    perm: "chat.spy",
    run: (player) => {
        const on = toggleSpying(player)
        if (on) {
            info(player, "§7Social spy §aon§7 — you now see private messages and /prchat sessions.")
            info(player, "§8It stays on until you turn it off, including after a rejoin.")
        } else {
            info(player, "§7Social spy §coff§7.")
        }
    }
})

/**
 * Copy a private line to whoever is watching.
 *
 * Never to the two people already in the conversation, and never to a spy who
 * has since lost the node — the toggle is persisted, so a demoted moderator
 * would otherwise keep reading.
 */
function spy(from, to, text, kind) {
    const label = kind === "prchat" ? "prchat" : "pm"
    const line = render("format.spy", {
        FROM: displayName(from),
        TO: displayName(to),
        MSG: text,
        KIND: label
    })
    const watching = new Set(spyIds())
    for (const viewer of world.getAllPlayers()) {
        if (viewer.id === from.id || viewer.id === to.id) continue
        if (!watching.has(viewer.id)) continue
        if (!has(viewer, "chat.spy")) continue
        viewer.sendMessage(line)
    }
    console.log(`[Admin+] [${label}] ${from.name} -> ${to.name}: ${text}`)
}

// ------------------------------------------------------------------- sessions

command({
    name: "prchat",
    description: "Open a private two-person chat — /prchat <player>, or /prchat alone to leave",
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        if (!flag("feature.pm")) return err(player, "Private chat is turned off on this server.")
        const targets = selected ?? []

        // No argument is the exit, exactly as asked for.
        if (!targets.length) return leave(player)
        if (targets.length > 1) return err(player, "One person — that is the whole idea.")

        const target = targets[0]
        if (target.id === player.id) return err(player, "You are already alone with yourself.")
        if (isMuted(player)) return err(player, "You are muted.")

        // Pointing it at somebody who has already asked YOU is how you accept.
        // No second command to remember, and it reads the same either way round.
        if (inviteFrom(player, target)) {
            clearInvite(player)
            open(player, target)
            return
        }

        if (pairedWith(player) === target.id) {
            return info(player, `§7You are already in a private chat with §f${displayName(target)}§7.`)
        }
        if (inPair(player)) {
            return err(player, "Leave the chat you are in first — /prexit.")
        }
        if (inPair(target)) {
            return err(player, `§f${displayName(target)}§c is already in a private chat.`)
        }

        const standing = pendingInvite(target)
        if (standing?.from === player.id) {
            return info(player, `§7Already asked — waiting on §f${displayName(target)}§7.`)
        }

        invite(player, target)
        ok(player, `Asked §f${displayName(target)}§a for a private chat. It lapses in §f${INVITE_SECONDS}s§a.`)
        target.sendMessage([
            `${CONFIG.brand.prefix}§d${displayName(player)}§7 wants a private chat.`,
            `§8Type §f/prchat ${player.name}§8 to accept · §f/prexit§8 to decline · lapses in ${INVITE_SECONDS}s`
        ].join("\n"))
    }
})

command({
    name: "prexit",
    description: "Leave a private chat — /prexit",
    run: (player) => leave(player)
})

function open(a, b) {
    startPair(a, b)
    for (const [self, other] of [[a, b], [b, a]]) {
        self.sendMessage([
            `${CONFIG.brand.prefix}§dPrivate chat open with §f${displayName(other)}§d.`,
            "§8Everything you type goes to them until you §f/prexit§8."
        ].join("\n"))
    }
    console.log(`[Admin+] prchat opened: ${a.name} <-> ${b.name}`)
}

/** Leaving, declining and being logged out all land here. */
function leave(player) {
    const standing = pendingInvite(player)
    if (standing && !inPair(player)) {
        clearInvite(player)
        const asker = world.getAllPlayers().find(p => p.id === standing.from)
        if (asker) info(asker, `§7${displayName(player)} declined the private chat.`)
        return info(player, "§7Declined.")
    }

    const partnerId = endPair(player)
    if (!partnerId) return info(player, "§7You are not in a private chat.")

    info(player, "§7Private chat closed.")
    const partner = world.getAllPlayers().find(p => p.id === partnerId)
    if (partner) {
        info(partner, `§7${displayName(player)} left the private chat.`)
    }
}

/**
 * Deliver one line inside a session. Called from the chat hook.
 * @returns {boolean} whether it was handled here
 */
export function routePrivate(player, message) {
    const partnerId = pairedWith(player)
    if (!partnerId) return false

    const partner = world.getAllPlayers().find(p => p.id === partnerId)
    if (!partner) {
        endPair(player)
        player.sendMessage(`${CONFIG.brand.prefix}§7They left — private chat closed.`)
        return true
    }

    const line = render("format.prchat", { NAME: displayName(player), MSG: message })
    player.sendMessage(line)
    partner.sendMessage(line)
    rememberExchange(player, partner)
    spy(player, partner, message, "prchat")
    return true
}

/** Tidy up when somebody leaves the world. */
export function installPrivateChat() {
    world.afterEvents.playerLeave.subscribe(({ playerId }) => {
        const partnerId = forgetPlayer(playerId)
        if (!partnerId) return
        const partner = world.getAllPlayers().find(p => p.id === partnerId)
        if (partner) info(partner, "§7They left the world — private chat closed.")
    })

    console.log("[Admin+] private chat ready")
}
