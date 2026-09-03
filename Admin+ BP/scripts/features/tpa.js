import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { queueTeleport } from "../core/teleport.js"
import { menu, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import {
    createRequest, cancelRequest, takeIncoming, takeIncomingById, clearIncoming,
    incomingFor, outgoingFrom, playerById, secondsLeft
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

    // Name the sender in the command being suggested. With one request waiting,
    // a bare /tpaccept is unambiguous; with two it is a coin toss, and the
    // person being asked had no way of knowing a second one even arrived.
    const queued = incomingFor(target).length
    target.sendMessage([
        kind === "to"
            ? `§f${displayName(player)}§7 wants to teleport §fto you§7.`
            : `§f${displayName(player)}§7 wants §fyou to teleport to them§7.`,
        `§8/tpaccept ${player.name}§8 to allow · /tpadeny ${player.name}§8 to refuse · lapses in ${secs}s`,
        queued > 1
            ? `§e${queued} requests are waiting§8 — plain /tpaccept will ask which one.`
            : ""
    ].filter(Boolean).join("\n"))
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

        // Two requests at once used to resolve to whichever was newest, silently
        // — you accepted somebody without being told which, and the other person
        // was left hanging with no way to tell them apart. When it is ambiguous
        // and nobody was named, ask.
        if (!name && waiting.length > 1) return pickScreen(player, "accept")

        const request = takeIncoming(player, name)
        if (!request) {
            return err(player, `No request from "§f${name}§c". Waiting: §f${waiting.map(r => r.fromName).join(", ")}`)
        }

        const sender = playerById(request.from)
        if (!sender) return err(player, `§f${request.fromName}§c has left.`)
        accept(player, sender, request)
    }
})

/**
 * Carry out an accepted request.
 *
 * Shared by the command and the picker so the two cannot drift — this used to
 * live inline in the command, and the picker would have been a second copy of
 * the warmup rule.
 */
function accept(player, sender, request) {
    // Whoever MOVES serves the warmup and cooldown — the person standing still
    // is not the one teleporting.
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
        ok(player, `Accepted §f${displayName(sender)}§a.`)
    }
}

command({
    name: "tpadeny",
    description: "Refuse a teleport request — /tpadeny [player]",
    perm: "tpa.use",
    optional: [{ name: "player", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!flag("feature.tpa")) return err(player, "Teleport requests are turned off on this server.")
        const waiting = incomingFor(player)
        if (!waiting.length) return err(player, "Nobody has asked to teleport.")

        if (!name && waiting.length > 1) return pickScreen(player, "deny")

        const request = takeIncoming(player, name)
        if (!request) {
            return err(player, `No request from "§f${name}§c". Waiting: §f${waiting.map(r => r.fromName).join(", ")}`)
        }
        refuse(player, request)
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


// ------------------------------------------------------- more than one asking

/**
 * Which request did you mean?
 *
 * The old behaviour with two requests waiting was to take the newest without
 * saying so: you accepted somebody, were not told who, and the other person sat
 * there until their request lapsed. Naming them on the command has always
 * worked — /tpaccept Steve — but nothing ever told anyone that, and by the time
 * two requests are on screen the wording of the first has scrolled away.
 *
 * A form is the honest answer on Bedrock: it lists exactly what is waiting, in
 * arrival order, and cannot pick the wrong one. It only appears when the
 * question is genuinely ambiguous — one request still accepts instantly, which
 * is the common case and should not cost a tap.
 *
 * (A standing requests-and-messages inbox is a bigger idea and belongs in its
 * own version. This is only the disambiguation.)
 */
async function pickScreen(player, mode) {
    const waiting = incomingFor(player)
    if (!waiting.length) return info(player, "§7Those requests have lapsed.")
    if (waiting.length === 1) return resolveOne(player, waiting[0].from, mode)

    const denying = mode === "deny"
    return menu(player, {
        title: hubTitle("actions", denying ? "Refuse which?" : "Accept which?"),
        body: subtitle(`${waiting.length} people are waiting. Pick one.`),
        buttons: [
            ...waiting.map(request => ({
                text: `§f${request.fromName}\n§8${request.kind === "to" ? "wants to come to you" : "wants you to go to them"} · ${secondsLeft(request)}s left`,
                run: () => resolveOne(player, request.from, mode)
            })),
            denying
                ? {
                    text: "§cRefuse them all",
                    run: () => {
                        const cleared = clearIncoming(player)
                        for (const request of cleared) {
                            const sender = playerById(request.from)
                            if (sender) info(sender, `§c${displayName(player)} refused your teleport request.`)
                        }
                        ok(player, `Refused §f${cleared.length}§a requests.`)
                    }
                }
                : null
        ].filter(Boolean)
    })
}

/** Act on one specific request, chosen by id rather than by name. */
function resolveOne(player, fromId, mode) {
    const request = takeIncomingById(player, fromId)
    if (!request) return info(player, "§7That request has already gone.")
    if (mode === "deny") return refuse(player, request)

    const sender = playerById(request.from)
    if (!sender) return err(player, `§f${request.fromName}§c has left.`)
    accept(player, sender, request)
}

function refuse(player, request) {
    ok(player, `Refused §f${request.fromName}§a.`)
    const sender = playerById(request.from)
    if (sender) info(sender, `§c${displayName(player)} refused your teleport request.`)
}
