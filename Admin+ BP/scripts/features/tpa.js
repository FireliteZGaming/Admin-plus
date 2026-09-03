import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { queueTeleport } from "../core/teleport.js"
import {
    createRequest, cancelRequest, takeIncoming, incomingFor, outgoingFrom,
    playerById, secondsLeft
} from "../core/tpa.js"

// /tpa · /tpahere · /tpaccept · /tpadeny · /tpacancel
//
// Essentials' shape, with Admin+'s argument style: a real PlayerSelector so tab
// fills the name, and the accept/deny commands take an OPTIONAL name so a
// player with several pending requests can pick, while the common case stays a
// bare /tpaccept.

command({
    name: "tpa",
    description: "Ask to teleport to someone — /tpa <player>",
    perm: "tpa.use",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => send(player, selected, "to")
})

command({
    name: "tpahere",
    description: "Ask someone to teleport to you — /tpahere <player>",
    perm: "tpa.use",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => send(player, selected, "here")
})

function send(player, selected, kind) {
    if (!flag("feature.tpa")) return err(player, "Teleport requests are turned off on this server.")
    const targets = selected ?? []
    if (!targets.length) return err(player, "No player matched that selector.")
    if (targets.length > 1) return err(player, "Ask one player at a time.")

    const target = targets[0]
    const result = createRequest(player, target, kind)
    if (!result.ok) return err(player, result.reason)

    const secs = secondsLeft(result.request)
    if (result.replaced) info(player, "§7Your previous request was replaced.")

    ok(player, kind === "to"
        ? `Asked §f${displayName(target)}§a if you can teleport to them. §8(${secs}s)`
        : `Asked §f${displayName(target)}§a to teleport to you. §8(${secs}s)`)

    target.sendMessage(kind === "to"
        ? `§f${displayName(player)}§7 wants to teleport §fto you§7.\n§8/tpaccept to allow · /tpadeny to refuse · lapses in ${secs}s`
        : `§f${displayName(player)}§7 wants §fyou to teleport to them§7.\n§8/tpaccept to allow · /tpadeny to refuse · lapses in ${secs}s`)
}

command({
    name: "tpaccept",
    description: "Accept a teleport request — /tpaccept [player]",
    perm: "tpa.use",
    optional: [{ name: "player", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!flag("feature.tpa")) return err(player, "Teleport requests are turned off on this server.")
        const waiting = incomingFor(player)
        if (!waiting.length) return err(player, "Nobody has asked to teleport.")

        const request = takeIncoming(player, name)
        if (!request) {
            return err(player, `No request from "§f${name}§c". Waiting: §f${waiting.map(r => r.fromName).join(", ")}`)
        }

        const sender = playerById(request.from)
        if (!sender) return err(player, `§f${request.fromName}§c has left.`)

        // Whoever MOVES serves the warmup and cooldown — the person standing
        // still is not the one teleporting.
        if (request.kind === "to") {
            info(sender, `§a${displayName(player)} accepted.`)
            queueTeleport(sender, displayName(player), () => {
                sender.teleport(player.location, { dimension: player.dimension })
                ok(sender, `Teleported to §f${displayName(player)}§a.`)
            })
            ok(player, `Accepted §f${displayName(sender)}§a.`)
        } else {
            info(sender, `§a${displayName(player)} accepted — bringing them over.`)
            queueTeleport(player, displayName(sender), () => {
                player.teleport(sender.location, { dimension: sender.dimension })
                ok(player, `Teleported to §f${displayName(sender)}§a.`)
            })
        }
    }
})

command({
    name: "tpadeny",
    description: "Refuse a teleport request — /tpadeny [player]",
    perm: "tpa.use",
    optional: [{ name: "player", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!flag("feature.tpa")) return err(player, "Teleport requests are turned off on this server.")
        const waiting = incomingFor(player)
        if (!waiting.length) return err(player, "Nobody has asked to teleport.")

        const request = takeIncoming(player, name)
        if (!request) {
            return err(player, `No request from "§f${name}§c". Waiting: §f${waiting.map(r => r.fromName).join(", ")}`)
        }
        ok(player, `Refused §f${request.fromName}§a.`)
        const sender = playerById(request.from)
        if (sender) info(sender, `§c${displayName(player)} refused your teleport request.`)
    }
})

command({
    name: "tpacancel",
    description: "Take back your teleport request",
    perm: "tpa.use",
    run: (player) => {
        if (!flag("feature.tpa")) return err(player, "Teleport requests are turned off on this server.")
        const request = cancelRequest(player)
        if (!request) return err(player, "You have no request out.")
        ok(player, `Cancelled your request to §f${request.toName}§a.`)
        const target = playerById(request.to)
        if (target) info(target, `§7${displayName(player)} took back their teleport request.`)
    }
})

