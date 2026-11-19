import { system, world, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { pref, setPref, PREFS } from "../core/prefs.js"
import { queueTeleport } from "../core/teleport.js"
import { menu, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import {
    createRequest, cancelRequest, takeIncoming, takeIncomingById, clearIncoming,
    incomingFor, outgoingFrom, playerById, secondsLeft,
    takeLapsed, askWait, noteAsked, noteRefused
} from "../core/tpa.js"

// Teleport requests, rebuilt in 2.12.13 (the user, 2026-11-18: "redo the whole
// tpa system").
//
//   /tpa · /tpahere · /tpaccept · /tpadeny · /tpacancel · /tpatoggle
//   /menu ▸ Travel ▸ Teleport requests
//
// What the rebuild changed, and why:
//   * A request POPS UP for the player asked, with Accept and Refuse. Typing
//     /tpaccept Steve is the hard part of teleport requests on a phone. Closing
//     the pop-up keeps the request waiting, the chat lines still arrive, and
//     /menu ▸ Settings turns pop-ups off for anybody who would rather type.
//   * Sounds: a chime when you are asked, a note when you are answered, the
//     portal when you land.
//   * Both people hear when a request expires or its sender leaves. Before, it
//     vanished without a word and the sender kept waiting.
//   * Asking the same player again waits ASK_AGAIN_S, and REFUSED_S after a
//     refusal (core/tpa.js), because a pop-up anybody can trigger at will is a
//     way to pester people.
//   * /tpatoggle turns requests to you off and on without a menu.
//   * The warmup counts down on the action bar (core/teleport.js).
//
// Essentials' shape is kept: accept and deny take an OPTIONAL player, so one
// request is a bare /tpaccept and several ask which.

const SOUNDS = {
    asked: ["random.orb", 1.4],
    answered: ["random.orb", 1.0],
    refused: ["note.bass", 0.8],
    landed: ["mob.endermen.portal", 1.0]
}

/** A sound is a nicety: a player who just left, or a sound the game lacks, must not break a request. */
function sound(player, key) {
    const [id, pitch] = SOUNDS[key]
    try { player?.playSound(id, { volume: 0.8, pitch }) } catch { /* nothing to hear */ }
}

const OFF = "Teleport requests are turned off on this server."

command({
    name: "tpa",
    description: "Ask to teleport to a player",
    perm: "tpa.use",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => send(player, selected, "to")
})

command({
    name: "tpahere",
    description: "Ask a player to teleport to you",
    perm: "tpa.use",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => send(player, selected, "here")
})

function send(player, selected, kind) {
    if (!flag("feature.tpa")) return err(player, OFF)
    const targets = selected ?? []
    if (!targets.length) return err(player, "Nobody matched that name.")
    if (targets.length > 1) return err(player, "Ask one player at a time.")

    const target = targets[0]

    // The target's own choice, from /menu ▸ Settings or /tpatoggle. Not
    // bypassed for staff: a moderator who genuinely needs to reach somebody has
    // /a:tp, which does not ask, so "I turned it off" can mean it.
    if (!pref(target, "tpa.accept")) {
        return err(player, `${displayName(target)} ${PREFS["tpa.accept"].off}`)
    }
    if (target.id !== player.id) {
        const wait = askWait(player, target)
        if (wait > 0) return err(player, `Wait §f${wait}s§c before asking ${displayName(target)}§c again.`)
    }

    const result = createRequest(player, target, kind)
    if (!result.ok) return err(player, result.reason)
    noteAsked(player, target)

    const secs = secondsLeft(result.request)
    if (result.replaced) info(player, "§7Your previous request was replaced.")

    ok(player, kind === "to"
        ? `Asked §f${displayName(target)}§a if you can teleport to them. §8(${secs}s)`
        : `Asked §f${displayName(target)}§a to teleport to you. §8(${secs}s)`)

    // Name the sender in the command being suggested. With one request waiting
    // a bare /tpaccept is unambiguous; with two it is a coin toss.
    const queued = incomingFor(target).length
    target.sendMessage([
        kind === "to"
            ? `§f${displayName(player)}§7 wants to teleport §fto you§7.`
            : `§f${displayName(player)}§7 wants §fyou to teleport to them§7.`,
        `§8/tpaccept ${player.name}§8 to allow · /tpadeny ${player.name}§8 to refuse · expires in ${secs}s`,
        queued > 1
            ? `§e${queued} requests are waiting§8. Type /tpaccept to pick one.`
            : ""
    ].filter(Boolean).join("\n"))
    sound(target, "asked")
    if (pref(target, "tpa.popup")) system.run(() => popUp(target, result.request))
}

/**
 * The two requests, for callers holding a Player rather than a selector.
 *
 * Wrappers rather than a second implementation: /menu and /tpa must agree about
 * every rule, and the only way to guarantee that is one function.
 */
export function requestTo(player, target) { return send(player, [target], "to") }
export function requestHere(player, target) { return send(player, [target], "here") }

/**
 * The request on the asked player's screen.
 *
 * Closing it is "decide later": the request keeps waiting, so nobody loses one
 * by tapping away. It opens only while that very request is still waiting, so
 * a pop-up never answers one that was replaced or has expired.
 */
async function popUp(target, request) {
    if (!incomingFor(target).some(r => r.seq === request.seq)) return
    const sender = playerById(request.from)
    if (!sender) return
    const coming = request.kind === "to"
    return menu(target, {
        title: hubTitle("actions", "Teleport request"),
        body: [
            coming
                ? `§f${displayName(sender)}§7 wants to teleport §fto you§7.`
                : `§f${displayName(sender)}§7 wants §fyou§7 to teleport §fto them§7.`,
            "",
            `§8It expires in ${secondsLeft(request)}s. Close this to decide later.`
        ].join("\n"),
        buttons: [
            { text: `§aAccept\n§8${coming ? "Let them come to you" : "Go to them"}`, run: () => resolveOne(target, request.from, "accept") },
            { text: "§cRefuse\n§8Tell them no", run: () => resolveOne(target, request.from, "deny") }
        ]
    })
}

command({
    name: "tpaccept",
    description: "Accept a teleport request",
    perm: "tpa.use",
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        if (!flag("feature.tpa")) return err(player, OFF)
        const waiting = incomingFor(player)
        if (!waiting.length) return err(player, "Nobody has asked to teleport.")

        // With two waiting and nobody named, ask which. Taking the newest
        // silently accepted somebody without saying who.
        const named = (selected ?? [])[0]
        if (!named && waiting.length > 1) return pickScreen(player, "accept")

        const request = named ? takeIncomingById(player, named.id) : takeIncoming(player)
        if (!request) {
            return err(player, `No request from §f${displayName(named)}§c. Waiting: §f${waiting.map(r => r.fromName).join(", ")}`)
        }

        const sender = playerById(request.from)
        if (!sender) return err(player, `§f${request.fromName}§c has left.`)
        accept(player, sender, request)
    }
})

/**
 * Carry out an accepted request. Shared by the command, the pop-up, the picker
 * and the requests screen, so none of them can drift from the warmup rule.
 */
function accept(player, sender, request) {
    sound(sender, "answered")
    // Whoever MOVES serves the warmup and cooldown. The person standing still
    // is not the one teleporting.
    if (request.kind === "to") {
        info(sender, `§a${displayName(player)} accepted.`)
        queueTeleport(sender, displayName(player), () => {
            sender.teleport(player.location, { dimension: player.dimension })
            ok(sender, `Teleported to §f${displayName(player)}§a.`)
            sound(sender, "landed")
        })
        ok(player, `Accepted §f${displayName(sender)}§a.`)
    } else {
        info(sender, `§a${displayName(player)} accepted. They are coming to you.`)
        queueTeleport(player, displayName(sender), () => {
            player.teleport(sender.location, { dimension: sender.dimension })
            ok(player, `Teleported to §f${displayName(sender)}§a.`)
            sound(player, "landed")
        })
        ok(player, `Accepted §f${displayName(sender)}§a.`)
    }
}

command({
    name: "tpadeny",
    description: "Turn down a teleport request",
    perm: "tpa.use",
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        if (!flag("feature.tpa")) return err(player, OFF)
        const waiting = incomingFor(player)
        if (!waiting.length) return err(player, "Nobody has asked to teleport.")

        const named = (selected ?? [])[0]
        if (!named && waiting.length > 1) return pickScreen(player, "deny")

        const request = named ? takeIncomingById(player, named.id) : takeIncoming(player)
        if (!request) {
            return err(player, `No request from §f${displayName(named)}§c. Waiting: §f${waiting.map(r => r.fromName).join(", ")}`)
        }
        refuse(player, request)
    }
})

command({
    name: "tpacancel",
    description: "Cancel your teleport request",
    perm: "tpa.use",
    run: (player) => {
        if (!flag("feature.tpa")) return err(player, OFF)
        if (!cancelMine(player)) err(player, "You have no request out.")
    }
})

command({
    name: "tpatoggle",
    description: "Turn teleport requests to you off or on",
    perm: "tpa.use",
    run: (player) => {
        if (!flag("feature.tpa")) return err(player, OFF)
        toggleRequests(player)
    }
})

/** Take back your own request. Returns false when there was none. */
function cancelMine(player) {
    const request = cancelRequest(player)
    if (!request) return false
    ok(player, `Cancelled your request to §f${request.toName}§a.`)
    const target = playerById(request.to)
    if (target) info(target, `§7${displayName(player)} took back their teleport request.`)
    return true
}

function toggleRequests(player) {
    const on = !pref(player, "tpa.accept")
    setPref(player, "tpa.accept", on)
    ok(player, on
        ? "You accept teleport requests again."
        : "Teleport requests to you are off. §f/tpatoggle§a turns them back on.")
    return on
}

// ------------------------------------------------------- more than one asking

/**
 * Which request did you mean? Only shown when the answer is genuinely
 * ambiguous: one request still accepts instantly.
 */
async function pickScreen(player, mode) {
    const waiting = incomingFor(player)
    if (!waiting.length) return info(player, "§7Those requests have expired.")
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
            denying ? { text: "§cRefuse them all", run: () => refuseAll(player) } : null
        ].filter(Boolean)
    })
}

/** Act on one specific request, chosen by id rather than by name. */
function resolveOne(player, fromId, mode) {
    const request = takeIncomingById(player, fromId)
    if (!request) return info(player, "§7That request has already ended.")
    if (mode === "deny") return refuse(player, request)

    const sender = playerById(request.from)
    if (!sender) return err(player, `§f${request.fromName}§c has left.`)
    accept(player, sender, request)
}

function refuse(player, request) {
    noteRefused(request.from, request.to)
    ok(player, `Refused §f${request.fromName}§a.`)
    const sender = playerById(request.from)
    if (sender) {
        info(sender, `§c${displayName(player)} refused your teleport request.`)
        sound(sender, "refused")
    }
}

function refuseAll(player) {
    const cleared = clearIncoming(player)
    for (const request of cleared) {
        noteRefused(request.from, request.to)
        const sender = playerById(request.from)
        if (sender) {
            info(sender, `§c${displayName(player)} refused your teleport request.`)
            sound(sender, "refused")
        }
    }
    ok(player, `Refused §f${cleared.length}§a requests.`)
}

// ------------------------------------------------------- the requests screen

/**
 * Everything about teleport requests in one place: who is waiting on you, the
 * request you have out, and your two switches. /menu ▸ Travel opens it.
 */
export async function requestsScreen(player, back = () => {}) {
    const again = () => requestsScreen(player, back)
    const waiting = incomingFor(player)
    const mine = outgoingFrom(player)
    const accepting = pref(player, "tpa.accept")
    const popups = pref(player, "tpa.popup")
    return menu(player, {
        title: hubTitle("warps", "Teleport requests"),
        body: subtitle(waiting.length
            ? `${waiting.length} waiting for you. Tap one to answer it.`
            : "Nobody is waiting on you."),
        buttons: [
            ...waiting.map(request => ({
                text: `§f${request.fromName}\n§8${request.kind === "to" ? "wants to come to you" : "wants you to go to them"} · ${secondsLeft(request)}s`,
                run: () => answerScreen(player, request, again)
            })),
            mine
                ? { text: `§eCancel my request\n§8To ${mine.toName} · ${secondsLeft(mine)}s left`, run: () => { cancelMine(player); return again() } }
                : null,
            {
                text: accepting ? "§aRequests: on\n§8Tap to stop people asking" : "§cRequests: off\n§8Tap to let people ask again",
                run: () => { toggleRequests(player); return again() }
            },
            {
                text: popups ? "§aPop-ups: on\n§8Requests show on your screen" : "§cPop-ups: off\n§8Requests only show in chat",
                run: () => { setPref(player, "tpa.popup", !popups); return again() }
            }
        ].filter(Boolean),
        back
    })
}

async function answerScreen(player, request, back) {
    const coming = request.kind === "to"
    return menu(player, {
        title: hubTitle("warps", request.fromName),
        body: subtitle(coming
            ? `${request.fromName} wants to teleport to you. It expires in ${secondsLeft(request)}s.`
            : `${request.fromName} wants you to teleport to them. It expires in ${secondsLeft(request)}s.`),
        buttons: [
            { text: `§aAccept\n§8${coming ? "Let them come to you" : "Go to them"}`, run: () => resolveOne(player, request.from, "accept") },
            { text: "§cRefuse\n§8Tell them no", run: () => { resolveOne(player, request.from, "deny"); return back() } }
        ],
        back
    })
}

// ------------------------------------------------------- telling people

/** Expired requests and players who leave, told to whoever is still here. */
export function installTpa() {
    system.runInterval(() => {
        for (const request of takeLapsed()) {
            const sender = playerById(request.from)
            const target = playerById(request.to)
            if (sender) info(sender, `§7Your teleport request to §f${request.toName}§7 expired.`)
            if (target) info(target, `§7The teleport request from §f${request.fromName}§7 expired.`)
        }
    }, 20)

    world.afterEvents.playerLeave.subscribe(({ playerId }) => {
        const gone = { id: playerId }
        const theirs = cancelRequest(gone)
        if (theirs) {
            const target = playerById(theirs.to)
            if (target) info(target, `§7${theirs.fromName} left, so their teleport request ended.`)
        }
        for (const request of clearIncoming(gone)) {
            const sender = playerById(request.from)
            if (sender) info(sender, `§7${request.toName} left, so your teleport request ended.`)
        }
    })

    console.log("[Admin+] teleport requests ready")
}
