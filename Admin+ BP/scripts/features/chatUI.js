import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { flag } from "../core/settings.js"
import { chatMuteLine } from "./chatcommands.js"
import {
    allChannels, getChannel, saveChannel, deleteChannel, moveChannel,
    availableTo, activeChannel, setActiveChannel, visibleTo, viewsAll
} from "../core/channels.js"

// /chat — pick the channel you type in.
//
//   /chat            the picker
//   /chat staff      straight there, for people who know what they want
//
// Someone with access to exactly one channel never needs this, and the command
// tells them so rather than opening a one-button form.

export async function chatScreen(player, back) {
    if (!flag("feature.chat")) {
        info(player, "Chat channels are turned off — everyone shares one chat.")
        return back ? back() : undefined
    }
    const options = availableTo(player)
    const current = activeChannel(player)

    if (options.length <= 1) {
        info(player, `You're in ${current?.display ?? "§7General"}§7 — the only chat you have.`)
        return back ? back() : undefined
    }

    const seeing = visibleTo(player)
    return menu(player, {
        title: hubTitle("settings", "Chat"),
        body: [
            subtitle("Pick where your messages go."),
            `§fTyping in: §r${current?.display ?? "§7none"}`,
            viewsAll(player)
                ? `§fReading: §aall ${seeing.length} of your chats`
                : "§fReading: §7only the chat you're typing in",
            // A muted channel used to be invisible here — you found out it was
            // shut by typing into it and being refused.
            chatMuteLine()
        ].filter(Boolean).join("\n"),
        buttons: options.map(channel => ({
            text: channel.id === current?.id
                ? `${channel.display}§r §8· you're here`
                : channel.display,
            run: () => {
                setActiveChannel(player, channel.id)
                ok(player, `Now typing in ${channel.display}§a.`)
                if (!viewsAll(player)) {
                    info(player, "§7You'll only see this chat until you switch back.")
                }
                return back ? back() : undefined
            }
        })),
        back
    })
}

command({
    name: "chat",
    description: "Choose the chat you type in — /chat [channel]",
    optional: [{ name: "channel", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!name) return chatScreen(player)

        const wanted = String(name).trim().toLowerCase()
        const match = availableTo(player).find(c =>
            c.id === wanted || c.display.replace(/§./g, "").toLowerCase() === wanted)

        if (!match) {
            // Naming a channel they cannot use must not confirm it exists.
            return err(player, `No chat called "§f${name}§c" that you can use.`)
        }
        setActiveChannel(player, match.id)
        ok(player, `Now typing in ${match.display}§a.`)
    }
})

// ------------------------------------------------- Settings ▸ Chat channels

export async function channelsScreen(player, back) {
    if (!has(player, "chat.manage")) { err(player, "You can't manage chat channels."); return back() }
    const list = allChannels()
    return menu(player, {
        title: hubTitle("settings", "Chat channels"),
        body: subtitle("Order sets how they appear in the picker.\n§8An open channel needs no permission; the rest are gated by their node."),
        buttons: [
            ...list.map(channel => ({
                text: `${channel.display}§r\n§8${channel.open ? "open to everyone" : channel.node}`,
                run: () => channelScreen(player, channel.id, () => channelsScreen(player, back))
            })),
            { text: hubEntry("presets", "+ Create channel"), run: () => createChannelScreen(player, () => channelsScreen(player, back)) }
        ],
        back
    })
}

async function channelScreen(player, channelId, back) {
    const channel = getChannel(channelId)
    if (!channel) { err(player, "That channel is gone."); return back() }
    const list = allChannels()
    const index = list.findIndex(c => c.id === channelId)
    const again = () => channelScreen(player, channelId, back)

    return menu(player, {
        title: hubTitle("settings", `Chat · ${channel.id}`),
        body: [
            `${channel.display}§r §8(id: ${channel.id})`,
            subtitle(`Position ${index + 1} of ${list.length}`),
            "",
            channel.open ? "§aOpen §7— everyone can use it" : `§fGated by: §7${channel.node}`
        ].join("\n"),
        buttons: [
            index > 0 ? { text: "§7▲ Move up", run: () => { moveChannel(channelId, -1); return again() } } : null,
            index < list.length - 1 ? { text: "§7▼ Move down", run: () => { moveChannel(channelId, 1); return again() } } : null,
            { text: "§bEdit", run: () => editChannelScreen(player, channelId, again) },
            { text: "§cDelete channel", run: () => deleteChannelScreen(player, channelId, back) }
        ].filter(Boolean),
        back
    })
}

async function editChannelScreen(player, channelId, back) {
    const channel = getChannel(channelId)
    const values = await modal(player, hubTitle("settings", `Edit · ${channelId}`), [
        { id: "display", type: "text", label: "Display §8· §§ colour codes allowed", default: channel.display },
        { id: "node", type: "text", label: "Permission node §8· who may use it", default: channel.node },
        { id: "open", type: "toggle", label: "Open to everyone §8· ignores the node", default: !!channel.open }
    ])
    if (!values) return back()
    saveChannel(channelId, { display: values.display, node: values.node, open: values.open })
    ok(player, `Updated §f${channelId}§a.`)
    return back()
}

async function createChannelScreen(player, back) {
    const values = await modal(player, hubTitle("settings", "Create channel"), [
        { id: "id", type: "text", label: "Channel id §8· lowercase, no spaces", placeholder: "builders" },
        { id: "display", type: "text", label: "Display §8· e.g. §§9Builders", placeholder: "§9Builders" },
        { id: "node", type: "text", label: "Permission node §8· leave blank for chat.<id>", placeholder: "chat.builders" },
        { id: "open", type: "toggle", label: "Open to everyone", default: false }
    ])
    if (!values) return back()

    const id = String(values.id ?? "").trim().toLowerCase().replace(/\s+/g, "_")
    if (!id) { err(player, "That channel id isn't usable."); return back() }
    if (getChannel(id)) { err(player, `A channel called §f${id}§c already exists.`); return back() }

    const channel = saveChannel(id, {
        display: values.display || `§7${id}`,
        node: String(values.node ?? "").trim() || `chat.${id}`,
        open: values.open
    })
    ok(player, `Created ${channel.display}§a. Grant §f${channel.node}§a to a rank so people can use it.`)
    return back()
}

async function deleteChannelScreen(player, channelId, back) {
    const channel = getChannel(channelId)
    const list = allChannels()
    if (list.length <= 1) { err(player, "You can't delete the last channel."); return back() }

    const yes = await confirm(player, hubTitle("settings", "Delete channel"),
        `Delete ${channel.display}§r?\n\n§7Anyone typing in it is moved back to their first available chat.`,
        "§cDelete")
    if (!yes) return back()
    deleteChannel(channelId)
    ok(player, `Deleted §f${channelId}§a.`)
    return back()
}
