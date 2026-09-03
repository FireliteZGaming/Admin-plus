import { world, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { CONFIG } from "../config.js"
import { ok, err, info } from "../core/util.js"
import { isStaff } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { isMuted } from "../core/moderation.js"
import { render, flag } from "../core/settings.js"
import {
    allChannels, getChannel, activeChannel, canUse, audienceFor, visibleTo,
    isChannelMuted, channelMute, muteChannel, unmuteChannel, setAllChannelsMuted
} from "../core/channels.js"
import { record } from "../core/logs.js"

// /mutechat [channel|all]  — close a room, or all of them
// /emote <action>          — say what you are doing rather than what you said
//
// These two are the last of the chat set. Both go through the channel system
// rather than round it: an emote lands in the room you are typing in, and a
// muted room stops emotes exactly the way it stops sentences. A /me that
// bypassed a mute would be the first thing anyone tried.

// ------------------------------------------------------------------ mutechat

command({
    name: "mutechat",
    description: "Mute or unmute chat — /mutechat [channel|all]",
    perm: "chat.manage",
    optional: [{ name: "channel", type: CustomCommandParamType.String }],
    run: (player, [wanted]) => {
        const asked = String(wanted ?? "").trim().toLowerCase()

        if (asked === "all" || asked === "*") {
            // Toggle on the state of the room as a whole: if ANY channel is
            // still open, "all" means close everything; only when they are all
            // shut does it mean open up.
            const anyOpen = allChannels().some(c => !isChannelMuted(c.id))
            const changed = setAllChannelsMuted(anyOpen, player)
            if (!changed) return info(player, "Nothing to change.")
            announce(player, anyOpen, undefined)
            record(player, anyOpen ? "chat.mute" : "chat.unmute", undefined,
                `all channels · ${changed}`)
            return
        }

        // No argument means the room they are standing in, which is the one
        // they are looking at when they decide it needs to stop.
        const channel = asked ? getChannel(asked) : activeChannel(player)
        if (!channel) {
            return err(player, `No channel called "§f${wanted}§c". Try §f${allChannels().map(c => c.id).join("§c, §f")}§c, or §fall§c.`)
        }

        const muting = !isChannelMuted(channel.id)
        if (muting) muteChannel(channel.id, player)
        else unmuteChannel(channel.id)

        announce(player, muting, channel)
        record(player, muting ? "chat.mute" : "chat.unmute", undefined, channel.id)
    }
})

/**
 * The one announcement in the pack that names its actor to everybody.
 *
 * Chat going silent with no explanation reads as the server being broken, and
 * the first thing players do about a broken server is leave. Saying who did it
 * also puts the decision on a person, which is the point of having staff.
 *
 * Sent with one world.sendMessage rather than per channel: someone who cannot
 * read Staff still needs to know why General stopped.
 */
function announce(actor, muted, channel) {
    const where = channel ? `${stripCodes(channel.display)} chat` : "Chat"
    const verb = muted ? "muted" : "unmuted"
    const colour = muted ? "§c" : "§a"
    world.sendMessage(`${CONFIG.brand.prefix}${colour}${where} has been ${verb} by §f${displayName(actor)}§r${colour}.`)
}

function stripCodes(text) { return String(text).replace(/§./g, "") }

/** For the panel and /chat: a short note on what is currently shut. */
export function chatMuteLine() {
    const shut = allChannels().filter(c => isChannelMuted(c.id))
    if (!shut.length) return ""
    if (shut.length === allChannels().length) return "§c§lAll chat is muted"
    return `§cMuted: §f${shut.map(c => stripCodes(c.display)).join(", ")}`
}

// ---------------------------------------------------------------------- emote

/**
 * /me is a VANILLA Bedrock command, so the bare name is already taken and the
 * game wins it — ours would only ever be reachable as /a:me. Rather than
 * ship a command that looks broken to anyone who types the obvious thing, the
 * feature is named /emote, which nothing else claims. Vanilla /me still works;
 * it just prints an unstyled line to everybody and ignores channels.
 */
command({
    name: "emote",
    description: "Say what you are doing — /emote <action>",
    mandatory: [{ name: "action", type: CustomCommandParamType.String }],
    run: (player, [action]) => sendEmote(player, action)
})

// Registered too, so /a:me exists for anyone who reaches for it out of
// habit. It cannot take the bare /me from vanilla, and does not try.
command({
    name: "me",
    description: "Say what you are doing — same as /emote (bare /me is vanilla's)",
    mandatory: [{ name: "action", type: CustomCommandParamType.String }],
    run: (player, [action]) => sendEmote(player, action)
})

function sendEmote(player, action) {
    if (!flag("feature.emote")) return err(player, "Emotes are turned off on this server.")

    const text = String(action ?? "").trim().slice(0, 160)
    if (!text) return err(player, "Type what you're doing. For example: /emote waves.")

    // Every gate ordinary chat passes through, in the same order. An emote is a
    // chat message wearing a hat.
    if (isMuted(player)) return err(player, "You are muted.")

    const channel = activeChannel(player)
    if (!channel || !canUse(player, channel)) return err(player, "You can't speak in that channel.")
    if (isChannelMuted(channel.id) && !isStaff(player)) {
        const who = channelMute(channel.id)
        return err(player, `${stripCodes(channel.display)} chat is muted — by ${who?.by ?? "staff"}.`)
    }

    const line = render("format.emote", {
        NAME: displayName(player),
        MSG: text,
        CHANNEL: channel.display ?? ""
    })

    const readers = audienceFor(channel)
    for (const reader of readers) {
        const labelled = visibleTo(reader).length > 1
        reader.sendMessage(labelled ? `${channel.display} §8|§r ${line}` : line)
    }
    console.log(`[Admin+] [${stripCodes(channel.display)}] * ${player.name} ${text}`)
}

export { sendEmote }
