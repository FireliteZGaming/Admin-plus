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
        info(player, "Chat rooms are turned off, so everyone shares one chat.")
        return back ? back() : undefined
    }
    const options = availableTo(player)
    const current = activeChannel(player)

    if (options.length <= 1) {
        info(player, `You're in ${current?.display ?? "§7General"}§7. It's the only chat you can use.`)
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
    description: "Choose which chat you type in",
    optional: [{ name: "channel", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!flag("feature.adminchat")) return err(player, "Admin+ chat is turned off on this server.")
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

// ------------------------------------------------- Settings ▸ Chat rooms

export async function channelsScreen(player, back) {
    if (!has(player, "chat.manage")) { err(player, "You can't manage chat rooms."); return back() }
    const list = allChannels()
    return menu(player, {
        title: hubTitle("settings", "Chat rooms"),
        body: subtitle("The order here is the order in the chat picker.\n§8An open room needs no permission. The others need their own."),
        buttons: [
            ...list.map(channel => ({
                text: `${channel.display}§r\n§8${channel.open ? "open to everyone" : channel.node}`,
                run: () => channelScreen(player, channel.id, () => channelsScreen(player, back))
            })),
            { text: hubEntry("presets", "+ New chat room"), run: () => createChannelScreen(player, () => channelsScreen(player, back)) }
        ],
        back
    })
}

async function channelScreen(player, channelId, back) {
    const channel = getChannel(channelId)
    if (!channel) { err(player, "That chat room no longer exists."); return back() }
    const list = allChannels()
    const index = list.findIndex(c => c.id === channelId)
    const again = () => channelScreen(player, channelId, back)

    return menu(player, {
        title: hubTitle("settings", `Chat · ${channel.id}`),
        body: [
            `${channel.display}§r §8(id: ${channel.id})`,
            subtitle(`Position ${index + 1} of ${list.length}`),
            "",
            channel.open ? "§aOpen§7: everyone can use it" : `§fNeeds permission: §7${channel.node}`
        ].join("\n"),
        buttons: [
            index > 0 ? { text: "§7▲ Move up", run: () => { moveChannel(channelId, -1); return again() } } : null,
            index < list.length - 1 ? { text: "§7▼ Move down", run: () => { moveChannel(channelId, 1); return again() } } : null,
            { text: "§bEdit", run: () => editChannelScreen(player, channelId, again) },
            { text: "§cDelete chat room", run: () => deleteChannelScreen(player, channelId, back) }
        ].filter(Boolean),
        back
    })
}

async function editChannelScreen(player, channelId, back) {
    const channel = getChannel(channelId)
    const values = await modal(player, hubTitle("settings", `Edit · ${channelId}`), [
        { id: "display", type: "text", label: "Name §8· colour codes allowed", default: channel.display },
        { id: "node", type: "text", label: "Permission §8· who can use it", default: channel.node },
        { id: "open", type: "toggle", label: "Open to everyone §8· no permission needed", default: !!channel.open }
    ])
    if (!values) return back()
    saveChannel(channelId, { display: values.display, node: values.node, open: values.open })
    ok(player, `Updated §f${channelId}§a.`)
    return back()
}

async function createChannelScreen(player, back) {
    const values = await modal(player, hubTitle("settings", "New chat room"), [
        { id: "id", type: "text", label: "ID §8· lowercase, no spaces", placeholder: "builders" },
        { id: "display", type: "text", label: "Name §8· for example §9Builders", placeholder: "§9Builders" },
        { id: "node", type: "text", label: "Permission §8· leave empty for chat.<id>", placeholder: "chat.builders" },
        { id: "open", type: "toggle", label: "Open to everyone", default: false }
    ])
    if (!values) return back()

    const id = String(values.id ?? "").trim().toLowerCase().replace(/\s+/g, "_")
    if (!id) { err(player, "Use lowercase letters or numbers for the ID."); return back() }
    if (getChannel(id)) { err(player, `A chat room called §f${id}§c already exists.`); return back() }

    const channel = saveChannel(id, {
        display: values.display || `§7${id}`,
        node: String(values.node ?? "").trim() || `chat.${id}`,
        open: values.open
    })
    ok(player, `Made ${channel.display}§a. Give a rank the §f${channel.node}§a permission so people can use it.`)
    return back()
}

async function deleteChannelScreen(player, channelId, back) {
    const channel = getChannel(channelId)
    const list = allChannels()
    if (list.length <= 1) { err(player, "You can't delete the last chat room."); return back() }

    const yes = await confirm(player, hubTitle("settings", "Delete chat room"),
        `Delete ${channel.display}§r?\n\n§7Anyone typing in it moves to the first chat they can use.`,
        "§cDelete")
    if (!yes) return back()
    deleteChannel(channelId)
    ok(player, `Deleted §f${channelId}§a.`)
    return back()
}
