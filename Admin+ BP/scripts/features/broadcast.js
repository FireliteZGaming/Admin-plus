import { world, CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { displayName, nameTokens } from "../core/identity.js"
import { render } from "../core/settings.js"
import { record } from "../core/logs.js"
import { allChannels, getChannel, audienceFor } from "../core/channels.js"

// /broadcast <where> <message>  —  say something to everyone, or to one chat.
//
//   /broadcast all Server restarting in five minutes
//   /broadcast staff eyes on spawn please
//   /broadcast all "punctuation, commas and all"
//
// "all" reaches every player online regardless of which chat they are reading.
// A channel id reaches exactly the people who can SEE that channel, so a staff
// broadcast stays staff-only rather than being a public message with a red
// prefix on it.

const ALL = "all"

/**
 * The channel vocabulary, for tab-completion.
 *
 * Bedrock registers enums once, during startup, so this is the channel list as
 * it stood when the world loaded — which includes every channel saved on the
 * world, but not one created later in the same session. Make a channel and it
 * tab-completes from the next reload. The alternative was a free-text argument
 * that never completes at all, which is worse every day except the one day you
 * create a channel.
 */
const WHERE = defineEnum("where", [ALL, ...allChannels().map(channel => channel.id)])

// The message is a `rest` parameter (core/registry.js), so a plain sentence of
// up to seven words works unquoted. Quoting is the way past seven, and leaving
// the message off opens a box to type it in.

export function broadcastTo(sender, scope, message) {
    const where = String(scope ?? ALL).trim().toLowerCase()
    const text = String(message ?? "").trim()
    if (!text) return { ok: false, reason: "Type a message to send." }

    let audience
    let channel
    if (where === ALL) {
        audience = world.getAllPlayers()
    } else {
        channel = getChannel(where)
        if (!channel) {
            const known = [ALL, ...allChannels().map(c => c.id)].join(", ")
            return { ok: false, reason: `No chat called "§f${where}§c". Try: §f${known}` }
        }
        audience = audienceFor(channel)
    }

    const line = render("format.broadcast", {
        MSG: text,
        ...nameTokens(sender ?? "Console"),
        CHANNEL: channel?.display ?? "§7Everyone"
    })
    for (const player of audience) player.sendMessage(line)

    return { ok: true, reached: audience.length, channel, text }
}

command({
    name: "broadcast",
    description: "Send an announcement to everyone, or to one chat",
    perm: "admin.broadcast",
    mandatory: [
        { name: WHERE, type: CustomCommandParamType.Enum, label: "Who should see it?" },
        { name: "message", type: CustomCommandParamType.String, rest: true, label: "The announcement" }
    ],
    run: (player, [where, message]) => {
        const result = broadcastTo(player, where, message)
        if (!result.ok) return err(player, result.reason)

        record(player, "chat.broadcast", undefined,
            `${result.channel?.id ?? ALL} · ${result.reached} reached · ${result.text}`)

        // The sender is inside their own audience, so they have already read the
        // broadcast itself. This only says where it landed.
        ok(player, result.channel
            ? `Sent to ${result.channel.display}§a. §f${result.reached}§a can read it.`
            : `Sent to everyone. §f${result.reached}§a online.`)
    }
})
