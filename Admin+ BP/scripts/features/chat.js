import { world, system } from "@minecraft/server"
import { noteChat } from "../core/chatlog.js"
import { CONFIG } from "../config.js"
import { primaryRank, isStaff, renderTags, chatNameFor, chatColourFor, chatFontFor, playerBadge } from "../core/ranks.js"
import { applyFont } from "../core/fonts.js"
import { displayName, nameTokens, stripCodes } from "../core/identity.js"
import { render, flag } from "../core/settings.js"
import { screen } from "../core/chatfilter.js"
import { CHAT_AUTOMOD_ON_HOLD } from "../core/hold.js"
import { chatAutomations } from "./automation.js"
import { chatText } from "../core/chattext.js"
import { hold } from "../core/heldchat.js"
// One voice for anything automatic — see alertStaff.
import { alertStaff, actOnFilter } from "./automod.js"
import { isMuted, muteRecord, syncMuteTag } from "../core/moderation.js"
import { formatDuration } from "../core/util.js"
import { activeChannel, visibleTo, audienceFor, isChannelMuted, channelMute } from "../core/channels.js"
// The test comes from core, the delivery from the feature: asking core avoids
// pulling the feature module in just to answer "is this player in a session",
// and keeps the read-only event context free of anything that sends.
import { inPair as inPrivate } from "../core/privatechat.js"
import { routePrivate } from "./privatechat.js"

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
    const names = nameTokens(sender)
    const tokens = {
        BADGE: withTag ? playerBadge(sender) : "",
        TAG: withTag ? renderTags(sender) : "",
        RANK: withTag && flag("feature.ranktags") ? (rank?.display ?? "") : "",
        ...names,
        // The name colour and chat colour from their rank's Basics. The name
        // gets the still frame of a moving effect, because a chat line is
        // printed once and never redrawn.
        NICKNAME: chatNameFor(sender, names.NICKNAME),
        MSG: `${chatColourFor(sender)}${applyFont(message, chatFontFor(sender))}`,
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
    // And kept in the world, so staff can read it back later. The content log
    // is wiped every session and nobody can open it from inside the game.
    noteChat(sender, message, channel)
    return readers.length
}

export function installChat() {
    const event = world.beforeEvents?.chatSend
    if (!event?.subscribe) {
        console.log("[Admin+] chat formatting unavailable on this runtime (needs beta APIs) — nametags only")
        return false
    }
    chatHooked = true

    event.subscribe(eventData => {
        const player = eventData.sender

        // Put the mirror tag back in step first. This is where a stuck mute
        // surfaces — somebody tries to talk and cannot — so it is the right
        // place to self-heal. The common drift is a TIMED mute running out: the
        // record carries an expiry and a tag cannot, so the tag outlives it.
        // Only writes when the two actually disagree.
        syncMuteTag(player)

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

        // **Admin+ chat switched off** (Server ▸ Settings ▸ Chat), for a server where
        // another mod owns chat. The message is left alone, so the game or that
        // mod delivers it. Only the mute above still applies, because a mute
        // that stopped working when chat was handed over would be no mute.
        // Still logged, so staff can read back what was said.
        if (!flag("feature.adminchat")) {
            const said = eventData.message
            // Automations still see it. They can stop it, but can't change its
            // words: the game or the other mod delivers it as typed.
            if (chatAutomations(player, said, { canReplace: false }).cancel) { eventData.cancel = true; return }
            system.run(() => noteChat(player, said, undefined))
            return
        }

        // ALWAYS cancel and re-emit. Returning early here (as this once did when
        // rank tags were switched off) hands the message back to vanilla chat,
        // which broadcasts it to everyone — turning a Staff-channel line into a
        // public one. Channel routing is not cosmetic and never opts out.
        eventData.cancel = true
        // Colour codes need "Colour codes in chat" (core/chattext.js).
        const message = chatText(player, eventData.message)
        if (!message.trim()) return
        const channel = activeChannel(player)

        // **Screened, and held rather than punished.** See core/chatfilter.js.
        // Sits after the mute (a muted player is already going nowhere) and
        // before routing, because the message must not reach a channel first.
        //
        // The sender is shown their own line as if it posted. That is Twitch's
        // trick and it is the reason this is worth doing: a troll who cannot
        // see which words were stopped has nothing to iterate against.
        // On hold since 2.9.2 (core/hold.js): nothing is screened.
        if (!CHAT_AUTOMOD_ON_HOLD && !(flag("filter.staffBypass") && isStaff(player))) {
            const flagged = screen(message)
            if (flagged) {
                system.run(() => {
                    hold(player, message, channel?.id, flagged)
                    player.sendMessage(formatChatLine(player, message, channel, false))
                    // Held first, always — a punishment must stay
                    // recoverable, and the queue is what shows a
                    // moderator the setting is too aggressive.
                    actOnFilter(player, flagged)
                    alertStaff(`Held a message from §f${player.name}§r §8(${flagged.label})§r. See §7/admin ▸ Server ▸ Automod ▸ Held messages§r.`)
                })
                return
            }
        }

        // A /prchat session swallows everything you type, which is what makes
        // it a session rather than a prefix you have to remember. It sits ABOVE
        // the channel mute on purpose: a mute closes a room, and two people
        // talking privately are not in the room.
        if (inPrivate(player)) {
            system.run(() => routePrivate(player, message))
            return
        }

        // A muted channel stops everyone but staff. Staff keep talking on
        // purpose: chat is usually muted so that staff can be heard over an
        // argument, and a mute that silenced them too would defeat itself.
        if (isChannelMuted(channel?.id) && !isStaff(player)) {
            const who = channelMute(channel.id)
            system.run(() => {
                player.sendMessage(
                    `${CONFIG.brand.prefix}§c${stripCodes(channel.display)} chat is muted§7 by ${who?.by ?? "staff"}.`)
            })
            return
        }

        // Nothing is said back to the sender here, deliberately. An earlier
        // version noted when a channel had no other readers, which sounds
        // helpful and is in fact a line after EVERY message you send — the
        // sender already knows which channel they are in, because switching
        // said so and the panel shows it. Chat output is reserved for the
        // things that actually changed: switching channels, and commands.
        // Automations (Server ▸ Automation) see it last, once it is really
        // going to a room. They may stop it or change its words; Logs keep
        // the real ones.
        const automated = chatAutomations(player, message)
        if (automated.cancel) return
        const said = automated.replace ?? message
        system.run(() => postToChannel(player, said, channel))
    })

    console.log("[Admin+] chat channels active")
    return true
}
