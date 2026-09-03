import { world, system } from "@minecraft/server"
import { CONFIG } from "../config.js"
import { primaryRank } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { render, renderTag } from "../core/settings.js"
import { isMuted, muteRecord } from "../core/moderation.js"
import { formatDuration } from "../core/util.js"
import { activeChannel, visibleTo, audienceFor } from "../core/channels.js"

// Chat: rank tag, display name, channels, and mute enforcement.
//
// world.beforeEvents.chatSend is a BETA api. On the stable runtime the event
// does not exist, so this whole feature no-ops rather than throwing — nametags
// and nicknames still work and chat stays vanilla.
//
// Delivery is PER RECIPIENT, not one world.sendMessage. It has to be: whether a
// line carries its "Staff |" prefix depends on what the READER can see, not on
// what the sender typed. Someone who only ever sees General gets plain vanilla
// lines; someone with View All gets every line labelled.

let chatHooked = false
export function chatAvailable() { return chatHooked }

/**
 * The chat line as one reader sees it.
 * @param {boolean} labelled prefix the channel — true when the reader can see
 *   more than one, so the label is actually telling them something
 */
export function formatChatLine(sender, message, channel, labelled) {
    const rank = primaryRank(sender)
    // showInChat only decides whether the RANK TAG is drawn. It must never
    // decide whether routing happens — see installChat.
    const withTag = CONFIG.ranks.showInChat
    const tokens = {
        TAG: withTag ? renderTag(rank) : "",
        RANK: withTag ? (rank?.display ?? "") : "",
        NAME: displayName(sender),
        MSG: message,
        CHANNEL: channel?.display ?? ""
    }
    // Dropping the tag can leave a leading space where it used to sit.
    return render(labelled ? "format.chatChannel" : "format.chat", tokens).replace(/^ +/, "")
}

/** Post a message into a channel as if `sender` said it. Used by chat and /sudo. */
export function postToChannel(sender, message, channel) {
    const readers = audienceFor(channel)
    for (const reader of readers) {
        const labelled = visibleTo(reader).length > 1
        reader.sendMessage(formatChatLine(sender, message, channel, labelled))
    }
    // The log always carries the label, so the record stays whole even though
    // most readers never saw one.
    console.log(`[Admin+] [${stripCodes(channel?.display ?? "?")}] ${sender.name}: ${message}`)
    return readers.length
}

function stripCodes(text) { return String(text).replace(/§./g, "") }

export function installChat() {
    const event = world.beforeEvents?.chatSend
    if (!event?.subscribe) {
        console.log("[Admin+] chat formatting unavailable on this runtime (needs beta APIs) — nametags only")
        return false
    }
    chatHooked = true

    event.subscribe(eventData => {
        const player = eventData.sender

        // Muted players never reach any channel.
        if (isMuted(player)) {
            eventData.cancel = true
            const record = muteRecord(player)
            const left = record.until ? ` (${formatDuration(record.until - Date.now())} left)` : ""
            system.run(() => {
                player.sendMessage(`${CONFIG.brand.prefix}§cYou are muted: ${record.reason}${left}`)
            })
            return
        }

        // ALWAYS cancel and re-emit. Returning early here (as this once did when
        // rank tags were switched off) hands the message back to vanilla chat,
        // which broadcasts it to everyone — turning a Staff-channel line into a
        // public one. Channel routing is not cosmetic and never opts out.
        eventData.cancel = true
        const message = eventData.message
        const channel = activeChannel(player)

        // Nothing is said back to the sender here, deliberately. An earlier
        // version noted when a channel had no other readers, which sounds
        // helpful and is in fact a line after EVERY message you send — the
        // sender already knows which channel they are in, because switching
        // said so and the panel shows it. Chat output is reserved for the
        // things that actually changed: switching channels, and commands.
        system.run(() => postToChannel(player, message, channel))
    })

    console.log("[Admin+] chat channels active")
    return true
}
