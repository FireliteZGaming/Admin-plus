import { world } from "@minecraft/server"
import { Table } from "../core/storage.js"
import { canReplaceRankList, isDeveloper, isOwner, isRealOperator, withoutDevelopersGrant } from "../core/ranks.js"
import { menu } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, info } from "../core/util.js"
import { record } from "../core/logs.js"
import { setCommandGate } from "../core/registry.js"
import { applyFrozen } from "../core/moderation.js"
import { TERMS_VERSION, TERMS_LINES, setWorldTerms, worldTerms, adminplusDisabled, serverAccepted, __resetWorldTerms } from "../core/terms.js"

// Admin+'s terms (3.1.6), the half that touches the game; core/terms.js has
// the words and the server's own answer. Only owners are asked: an operator,
// or someone with the top rank and every permission, the same people who set
// Admin+ up. Players and other staff never see the terms.
//
// It is ONE answer for the whole server (the user: "an operator just has to
// accept the terms"). Until the server has accepted, every Admin+ command an
// owner uses opens the terms instead (core/registry.js asks termsGate first),
// and runs once they accept. DECLINE turns Admin+ off for everyone: chat,
// tags and automod go back to vanilla (core/terms.js adminplusDisabled, read
// by the chat, nametag, presence and automod code), until an owner accepts.
//
// The Admin+ developers get full control and operator status, but only once
// an owner has ACCEPTED (point 5 of the terms), and a developer is never the
// one who accepts for a server they don't own: their own say only counts
// where they are an owner without Admin+'s help (ownsServer). The 3.1.6 stress
// test (2026-11-27) rewrote this half; the first draft let a developer through
// every gate, even on a server that had declined.

/** Each owner's own answer, by id, kept for the record. The SERVER answer (what
 *  turns the mod on or off) lives in core/terms.js. */
const answers = new Table("terms", {})
/** The developers Admin+ itself made operators, by id: { name, at }. Only
 *  these are ever deopped, so an operator the owner chose is left alone. Kept
 *  through a factory reset (features/reset.js KEPT_BY_RESET). */
const devOps = new Table("devOps", {})
/** One terms screen per player at a time, however many commands they type. */
const showing = new Map()

/**
 * An owner in their OWN right: a config owner, an operator, or the top rank
 * with every permission, and never through the developers' grant or through
 * operator status Admin+ gave a developer. These are the people who may answer
 * the terms for the server, because the grant is theirs to give.
 */
export function ownsServer(player) {
    if (!player) return false
    if (isOwner(player)) return true
    if (isDeveloper(player) && devOps.get(player.id)) return false
    return withoutDevelopersGrant(() => canReplaceRankList(player))
}

/** The people who are asked: owners in their own right (ownsServer). */
export function asksTerms(player) { return ownsServer(player) }

/** True when an owner still has to take the server through the terms. */
export function needsTerms(player) {
    return asksTerms(player) && !serverAccepted()
}

/** What a player answered last, if anything. */
export function termsAnswer(player) { return answers.get(player?.id) }

/** The server's standing on the terms, for other screens. */
export function termsStanding() { return worldTerms() }

/** Show the terms. Resolves true once they accept, false otherwise. */
export function termsScreen(player) {
    const already = showing.get(player.id)
    if (already) return already
    const shown = menu(player, {
        title: hubTitle("about", "Admin+ terms"),
        body: TERMS_LINES.join("\n"),
        waitWhileBusy: 200,
        buttons: [
            { text: "§a§lAccept§r\n§8Turn Admin+ on for this server", run: () => answer(player, "accept") },
            { text: "§c§lDecline§r\n§8Leave Admin+ off", run: () => answer(player, "decline") }
        ],
        onCancel: () => { stillOff(player); return false }
    }).then(result => result === true).finally(() => showing.delete(player.id))
    showing.set(player.id, shown)
    return shown
}

function answer(player, choice) {
    const yes = choice === "accept"
    answers.set(player.id, { name: player.name, version: TERMS_VERSION, answer: choice, at: Date.now() })
    setWorldTerms(yes ? "accepted" : "declined", player.name)
    record(player, yes ? "terms.accept" : "terms.decline", undefined, `version ${TERMS_VERSION}`)
    console.log(`[Admin+] Terms: ${player.name} ${yes ? "accepted" : "declined"} version ${TERMS_VERSION}. Admin+ is ${yes ? "on" : "off"} for the server`)
    // The grant follows the answer at once for developers who are here, and
    // a freeze lifts on a decline and holds again on an accept.
    syncDeveloperOps()
    for (const online of world.getAllPlayers()) {
        try { applyFrozen(online) } catch { /* left */ }
    }
    if (yes) {
        ok(player, "Admin+ is on for this server. Thanks.")
        return true
    }
    stillOff(player)
    return false
}

/** After a decline, or a closed terms screen: what is true now, in one line. */
function stillOff(player) {
    info(player, adminplusDisabled()
        ? "§7Admin+ is off for this server until an owner accepts its terms. Use any Admin+ command to read them again."
        : "§7Your Admin+ commands open the terms until an owner accepts them.")
}

/** Asked before every Admin+ command: true to go ahead, or the terms first. */
export function termsGate(player) {
    // Off for the whole server: an owner can accept to turn it on. Anyone
    // else, a developer included, is told it is off and the command does
    // nothing (the user: "if they end up pressing decline, I won't have it").
    if (adminplusDisabled()) {
        if (asksTerms(player)) return termsScreen(player)
        info(player, "§7Admin+ is turned off here. An owner has to accept its terms.")
        return false
    }
    // Not off, but the server hasn't accepted yet: an owner reads the terms
    // before using a command. Everyone else carries on.
    if (needsTerms(player)) return termsScreen(player)
    return true
}

/**
 * The terms if this owner still owes them; true when they're done. Someone
 * who isn't an owner in their own right is never shown them (a developer on
 * a stranger's server would otherwise be asked to consent for it), and gets
 * whether Admin+ is on.
 */
export async function ensureTerms(player) {
    if (!asksTerms(player)) return !adminplusDisabled()
    return serverAccepted() ? true : termsScreen(player)
}

// ------------------------------------------------ the developers' operator

/** Ids handled this world load, so a developer is opped at most once a load. */
const opped = new Set()

/** Run op or deop on one player through the server dimension; true if it took. */
function runOp(verb, player) {
    const name = String(player.name).replace(/"/gu, "")
    try {
        const result = world.getDimension("overworld").runCommand(`${verb} "${name}"`)
        return (result?.successCount ?? 0) > 0
    } catch (e) {
        console.warn(`[Admin+] Developer ${verb}: couldn't run it for ${player.name}: ${e}`)
        return false
    }
}

function giveDeveloperOp(player) {
    if (opped.has(player.id)) return
    opped.add(player.id)
    // Already an operator: nothing to give, so nothing to take back later.
    if (isRealOperator(player)) {
        console.log(`[Admin+] Developer op: ${player.name} is already an operator here`)
        return
    }
    const took = runOp("op", player)
    if (took) devOps.set(player.id, { name: player.name, at: Date.now() })
    console.log(`[Admin+] Developer op: ${player.name} ${took ? "opped" : "op did not take (the world may not allow it)"}`)
}

function takeBackDeveloperOp(player) {
    opped.delete(player.id)
    if (!devOps.get(player.id)) return
    const took = runOp("deop", player)
    if (took) devOps.delete(player.id)
    console.log(`[Admin+] Developer op: ${player.name} ${took ? "deopped, the terms aren't accepted" : "deop did not take, so it is tried again when they next join"}`)
}

/**
 * A developer is in the world (3.1.6, the user: "grants op to the dev if
 * that's even a thing, because admin+ is still weird about op with its own
 * commands"). With the terms accepted as they are now, Admin+ makes them an
 * operator; otherwise it takes back any operator status Admin+ itself gave
 * them (a decline, or new terms nobody has accepted yet), and never touches
 * an op the owner gave. Best-effort: op runs through the server dimension, as
 * the kick route in core/moderation.js does, some worlds refuse it with no
 * error, and every outcome goes to the content log.
 */
export function developerJoined(player) {
    if (!player || !isDeveloper(player)) return
    if (serverAccepted()) giveDeveloperOp(player)
    else takeBackDeveloperOp(player)
}

/** Every developer online, after the server's answer changes. */
function syncDeveloperOps() {
    for (const player of world.getAllPlayers()) {
        try { developerJoined(player) } catch (e) { console.warn(`[Admin+] Developer op: ${e}`) }
    }
}

export function installTerms() {
    setCommandGate(termsGate)
    world.afterEvents?.playerSpawn?.subscribe?.(({ player, initialSpawn }) => {
        if (!initialSpawn) return
        try { developerJoined(player) } catch (e) { console.warn(`[Admin+] Developer op: ${e}`) }
    })
    world.afterEvents?.playerLeave?.subscribe?.(({ playerId }) => opped.delete(playerId))
    return true
}

/** Tests: the ids Admin+ made operators. */
export function developerOps() { return devOps.ids() }

/** Tests: accept the terms the way pressing Accept does, for the whole server. */
export function acceptTerms(player) {
    answers.set(player.id, { name: player.name, version: TERMS_VERSION, answer: "accept", at: Date.now() })
    setWorldTerms("accepted", player.name)
}

/** Tests: forget every terms answer, back to a fresh (not-yet-answered) world. */
export function __resetTerms() {
    for (const id of answers.ids()) answers.delete(id)
    for (const id of devOps.ids()) devOps.delete(id)
    __resetWorldTerms()
    opped.clear()
}
