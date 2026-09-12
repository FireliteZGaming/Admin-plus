import { world } from "@minecraft/server"
import { menu, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubButton } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { has, canActOn } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { getChannel } from "../core/channels.js"
import { heldMessages, heldCount, removeHeld, clearHeld } from "../core/heldchat.js"
import { postToChannel } from "./chat.js"

// The queue a moderator reads. See core/chatfilter.js for why messages are held
// rather than punished, and why the sender is never told.

/** How long ago, in words. */
function ago(at) {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
    return `${Math.round(seconds / 3600)}h ago`
}

/** The player who sent it, if they are still here. */
function senderOf(entry) {
    return world.getAllPlayers().find(p => p.id === entry.player?.id)
}

export async function heldScreen(player, back) {
    if (!has(player, "admin.automod")) {
        err(player, "You can't review held messages.")
        return back()
    }

    const waiting = heldMessages()
    if (!waiting.length) {
        info(player, "§7Nothing is being held. Chat is going straight through.")
        return back()
    }

    const again = () => heldScreen(player, back)
    return menu(player, {
        title: hubTitle("settings", "Held messages"),
        body: [
            subtitle(`${waiting.length} waiting on you.`),
            "§8Approving posts it where it was going. Denying drops it.",
            "§8The sender was never told either way."
        ].join("\n"),
        buttons: [
            ...waiting.map(entry => ({
                // The message itself, because deciding without reading it is
                // not reviewing — it is rubber-stamping.
                text: `§f${entry.player?.name ?? "?"}§r §8${ago(entry.at)}\n§7"${entry.message}"\n§8${entry.label ?? "flagged"}`,
                run: () => oneScreen(player, entry.id, again)
            })),
            {
                text: hubButton("moderation", "Deny all", `Drop all ${waiting.length} without posting`),
                run: async () => {
                    const sure = await confirm(player, hubTitle("settings", "Deny all"),
                        `Drop all ${waiting.length} held messages?\n\n§7They are not posted and nobody is punished. The queue is simply emptied.`)
                    if (!sure) return again()
                    const n = clearHeld()
                    record(player, "chat.denyAll", undefined, `${n} held message(s)`)
                    ok(player, `Dropped §f${n}§a held message(s).`)
                    return back()
                }
            }
        ]
    })
}

async function oneScreen(player, id, back) {
    const entry = heldMessages().find(e => e.id === id)
    if (!entry) { info(player, "§7Somebody already dealt with that one."); return back() }

    const sender = senderOf(entry)
    const channel = getChannel(entry.channel)

    // The ladder applies here as everywhere: releasing or dropping somebody
    // senior's message is acting on them.
    if (sender && !canActOn(player, sender)) {
        err(player, `${entry.player.name} outranks you — leave this one.`)
        return back()
    }

    return menu(player, {
        title: hubTitle("settings", "Held message"),
        body: [
            `§f${entry.player?.name ?? "?"}§r §8· ${ago(entry.at)}`,
            `§8Heading for §7${channel?.display ?? "General"}`,
            "",
            `§7"${entry.message}"`,
            "",
            `§8Caught by: §7${entry.label ?? "?"}§8, on "§7${entry.term}§8" at level ${entry.level}`
        ].join("\n"),
        buttons: [
            {
                text: hubButton("settings", "Approve", "Post it, where it was going"),
                run: () => {
                    removeHeld(id)
                    if (!sender) {
                        info(player, "§7They have left — nothing to post. Dropped instead.")
                        record(player, "chat.approve", undefined, `"${entry.message}" (sender gone)`)
                        return back()
                    }
                    postToChannel(sender, entry.message, channel)
                    record(player, "chat.approve", sender, `"${entry.message}"`)
                    ok(player, "Posted.")
                    return back()
                }
            },
            {
                text: hubButton("moderation", "Deny", "Drop it · the sender is not told"),
                run: () => {
                    removeHeld(id)
                    record(player, "chat.deny", sender, `"${entry.message}" (${entry.label})`)
                    ok(player, "Dropped.")
                    return back()
                }
            }
        ]
    })
}

/** For the Automod screen's button, so it can say how many are waiting. */
export function heldWaiting() { return heldCount() }
