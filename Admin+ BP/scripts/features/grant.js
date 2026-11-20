import { world, system, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { modal, confirm } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { has, canActOn, heldRankIds, grantRank, displacedBy, getRank } from "../core/ranks.js"
import { ranksToGive, notify } from "./ranksUI.js"
import {
    DURATIONS, durationAt, setExpiry, sweep, timedGrants, remainingLabel,
    keepOf, setKeep, takeKeep, addDue, takeDue
} from "../core/grants.js"
import { liveInventory, snapshotOf, buildStack, writeInventory, countItems, inStaffMode } from "../core/staffmode.js"
import { currentSpawnPoint } from "../core/omnitool.js"
import { teleportTo } from "../core/warps.js"

// /grant — hand somebody a rank, optionally with an end date.
//
// Ranks could always be given; they could never be given BACK on their own, so
// "Mod for the weekend" was a thing somebody had to remember to undo. The rank
// remembers now.
//
// One screen: what, for how long, and what happens when it ends. The length is
// a dropdown rather than a number box because "how long" has about eight
// sensible answers and 259200 is not one of them.
//
// Permanent is the FIRST option and means no record at all, so the default
// answer changes nothing about how ranks already behave — the timer is
// something you opt into.
//
// WHEN A TIMED GRANT ENDS (2.12.16, the user's design): they always go back to
// the gamemode they had when they got it. Two switches add more: give back the
// inventory they had right before the rank, and send them to spawn (the world's
// spawn when no spawn is set). Both keep across leaving and rejoining: if it
// ends while they are away, it happens when they come back. Whether it ends by
// time or because somebody took the rank away early, the grant is over, so the
// same things happen. The inventory works like staff mode's (core/staffmode.js):
// the real items when the world hasn't reloaded since (lossless), otherwise the
// saved copy, which can't carry what the script API can't read (a shulker
// box's contents, a book's pages).

/** How often grants are checked: often enough that one ends close to on time. */
const SWEEP_TICKS = 20 * 10

/** The real items, this session only: `${playerId}|${rankId}` -> { slots, worn }. */
const liveCopies = new Map()
const keyOf = (playerId, rankId) => `${playerId}|${rankId}`

const online = id => world.getAllPlayers().find(p => p.id === id)

export async function grantScreen(player, targetId, targetName, back = () => {}) {
    if (!has(player, "ranks.grant")) { err(player, "You can't give ranks."); return back() }
    if (!canActOn(player, targetId)) { err(player, `${targetName} outranks you.`); return back() }

    // The same list the panel's Give a rank offers: below you, nothing you
    // lack, and nothing that would raise you if the target is you.
    const options = ranksToGive(player, targetId)
    if (!options.length) { err(player, "There are no ranks you can give them. You can give ranks below your own, with no permissions you don't have."); return back() }

    const timed = timedGrants(targetId)
    const standing = timed.length
        ? timed.map(t => `§8· ${getRank(t.rankId)?.display ?? t.rankId}§8 ends in ${remainingLabel(t.until)}`).join("\n")
        : ""

    const values = await modal(player, hubTitle("ranks", `Grant · ${targetName}`), [
        {
            id: "rank",
            type: "dropdown",
            label: `§fRank to give${standing ? `\n${standing}` : ""}`,
            options: options.map(r => `${r.display}§r`),
            default: 0
        },
        {
            id: "duration",
            type: "dropdown",
            label: "§fFor how long\n§8Permanent means it never runs out.",
            options: DURATIONS.map(d => d.label),
            default: 0
        },
        { type: "label", label: "§lWhen it ends\n§r§7They always go back to the gamemode they had. These two are for timed grants." },
        {
            id: "inventory",
            type: "toggle",
            label: "§fGive back their inventory\n§8Exactly what they had before the rank, even if they're offline when it ends",
            default: false
        },
        {
            id: "spawn",
            type: "toggle",
            label: "§fSend them to spawn\n§8The world's spawn if no spawn is set",
            default: false
        }
    ])
    if (!values) return back()

    const rank = options[values.rank ?? 0]
    const length = durationAt(values.duration ?? 0)
    if (!rank) return back()
    const end = length.ms ? { inventory: !!values.inventory, spawn: !!values.spawn } : undefined

    // Say what a promotion will drop BEFORE it drops it — same courtesy the
    // panel's Add rank pays, and it matters more here because a timed grant
    // that displaces a permanent rank does not give that rank back when it
    // ends. It gives back nothing; they fall to whatever is left.
    const losing = displacedBy(targetId, rank.id)
    if (losing.length) {
        const list = losing.map(r => r.display + "§r").join("§7, ")
        const yes = await confirm(player, hubTitle("ranks", "Promote"),
            [
                `Give §f${targetName}§r ${rank.display}§r for §f${length.label.toLowerCase()}§r?`,
                "",
                `§7This replaces: ${list}`,
                length.ms ? "§8When it ends, they won't get those back." : ""
            ].join("\n"),
            "§aGrant")
        if (!yes) return back()
    }

    const before = heldRankIds(targetId)
    if (!grantRank(targetId, rank.id, targetName)) {
        err(player, "That rank no longer exists.")
        return back()
    }
    setExpiry(targetId, rank.id, length.ms, player, end)
    if (length.ms) beginGrant(targetId, rank.id, end)

    const extras = [end?.inventory ? "inventory back" : "", end?.spawn ? "to spawn" : ""].filter(Boolean)
    record(player, "rank.grant", { id: targetId, name: targetName },
        `${rank.id}${length.ms ? ` · ${length.label}` : ""}${extras.length ? ` · ${extras.join(" · ")}` : ""}`,
        { kind: "ranks", ranks: before })

    if (length.ms) {
        ok(player, `${targetName} is now ${rank.display}§a for §f${length.label.toLowerCase()}§a.`)
        info(player, `§7When it ends: their gamemode goes back${end.inventory ? ", their inventory goes back to what they have now" : ""}${end.spawn ? ", they go to spawn" : ""}.`)
        notify(targetId, [
            `You were given ${rank.display}§r for ${length.label.toLowerCase()}.`,
            end.inventory ? "When it ends, your inventory goes back to what you have now." : "",
            end.spawn ? "When it ends, you'll be sent to spawn." : ""
        ].filter(Boolean).join(" "))
    } else {
        ok(player, `${targetName} is now ${rank.display}§a.`)
        notify(targetId, `You were given the ${rank.display}§r rank.`)
    }
    return back()
}

command({
    name: "grant",
    description: "Give a player a rank, for a set time or permanently",
    perm: "ranks.grant",
    // **Bare /grant asks who, then opens the Grant screen** (2.12.16, the
    // user: "just doing /grant ... should also bring up the player list"). It
    // used to open the panel's rank list, which led to a different screen.
    // `offline` adds Everyone seen: the engine's own list only offers players
    // who are online, and a rank can be given to somebody who isn't here
    // (setRanks writes by id; their tag syncs when they come back).
    mandatory: [{
        name: "player", type: CustomCommandParamType.PlayerSelector,
        title: "Grant · pick a player", label: "Who gets the rank?", self: true, offline: true
    }],
    run: (player, [targets]) => {
        const target = (targets ?? [])[0]
        if (!target) return
        const name = typeof target.sendMessage === "function" ? displayName(target) : (target.name || "Unknown")
        return grantScreen(player, target.id, name)
    }
})

// ----------------------------------------------------- what to give back

/**
 * Note what to give back when this timed grant ends: the gamemode always, the
 * inventory if asked. Taken now if they are here; otherwise (or while staff
 * mode has their real things stowed) the first time they are seen while the
 * grant still runs. A grant renewed while it runs keeps the FIRST note, because
 * "what they had before the rank" is from before the first one.
 */
export function beginGrant(playerId, rankId, end) {
    const existing = keepOf(playerId, rankId)
    const wantsInventory = !!end?.inventory
    if (existing && !existing.pending && (existing.inv || !wantsInventory)) return existing
    const target = online(playerId)
    if (!target || inStaffMode(target)) {
        setKeep(playerId, rankId, { ...(existing ?? {}), pending: true, at: existing?.at ?? Date.now() })
        return keepOf(playerId, rankId)
    }
    return noteNow(target, rankId, wantsInventory, existing)
}

function noteNow(target, rankId, wantsInventory, existing) {
    let gm = existing?.gm
    if (!gm) { try { gm = target.getGameMode() } catch { gm = undefined } }
    let inv = existing?.inv ?? null
    if (wantsInventory && !inv) {
        const held = liveInventory(target)
        const saved = snapshotOf(target)
        if (!held || !saved) {
            // Couldn't read it. Try again on the next check rather than saving
            // an empty inventory that would wipe theirs when the grant ends.
            setKeep(target.id, rankId, { ...(existing ?? {}), gm, pending: true, at: existing?.at ?? Date.now() })
            return keepOf(target.id, rankId)
        }
        inv = saved
        liveCopies.set(keyOf(target.id, rankId), held)
    }
    setKeep(target.id, rankId, { gm: gm ?? null, inv, at: existing?.at ?? Date.now() })
    return keepOf(target.id, rankId)
}

/** Notes still waiting on this player, now that they are here. */
function notePending(player) {
    if (inStaffMode(player)) return
    for (const grant of timedGrants(player.id)) {
        const noted = keepOf(player.id, grant.rankId)
        if (noted?.pending) noteNow(player, grant.rankId, !!grant.end?.inventory, noted)
    }
}

/**
 * A grant is over: queue what to give back. A grant that never got going while
 * they were here changed nothing, so it has nothing to undo; they are just told
 * it ended, as before.
 */
function queueEnd(item, reason) {
    const noted = takeKeep(item.playerId, item.rankId)
    const key = keyOf(item.playerId, item.rankId)
    if (!noted || noted.pending) {
        liveCopies.delete(key)
        const target = online(item.playerId)
        if (target && reason === "expired") info(target, `Your ${item.display}§r rank has expired.`)
        return
    }
    if (!item.end?.inventory) liveCopies.delete(key)
    addDue(item.playerId, {
        rankId: item.rankId, display: item.display, reason,
        gm: noted.gm ?? null,
        inv: item.end?.inventory ? (noted.inv ?? null) : null,
        spawn: !!item.end?.spawn,
        started: noted.at ?? 0,
        at: Date.now()
    })
}

/**
 * Give back what is owed, now that they are here. Waits while they are in staff
 * mode: their real things are stowed, and writing an inventory over the staff
 * tools would tangle the two.
 */
function applyDue(player) {
    if (inStaffMode(player)) return
    const list = takeDue(player.id)
    if (!list.length) return
    // The earliest grant last, so they end up as they were before ANY of them.
    list.sort((a, b) => (b.started ?? 0) - (a.started ?? 0))
    for (const entry of list) finish(player, entry)
}

function finish(player, entry) {
    const lines = []
    if (entry.gm) {
        let now
        try { now = player.getGameMode() } catch { now = undefined }
        if (now !== entry.gm) {
            try {
                player.setGameMode(entry.gm)
                lines.push(`Your gamemode is back to ${String(entry.gm).toLowerCase()}.`)
            } catch (e) {
                console.warn(`[Admin+] grant ended: couldn't set ${player.name}'s gamemode back: ${e}`)
            }
        }
    }
    if (entry.inv) {
        const key = keyOf(player.id, entry.rankId)
        const held = liveCopies.get(key)
        liveCopies.delete(key)
        if (held) {
            writeInventory(player, held.slots, held.worn)
        } else {
            const worn = {}
            for (const [slot, plain] of Object.entries(entry.inv.worn ?? {})) worn[slot] = buildStack(plain)
            writeInventory(player, (entry.inv.slots ?? []).map(buildStack), worn)
        }
        lines.push("Your inventory is back to what you had before the rank.")
        console.log(`[Admin+] grant ended: gave ${player.name} back ${countItems(entry.inv)} item stack(s) ` +
            `(${held ? "the originals" : "rebuilt from the saved copy"})`)
    }
    if (entry.spawn && sendToSpawn(player)) lines.push("You were sent to spawn.")
    const head = entry.reason === "removed"
        ? `Your ${entry.display}§r rank has ended.`
        : `Your ${entry.display}§r rank has expired.`
    info(player, [head, ...lines].join(" "))
}

/**
 * Spawn: Admin+'s own (the Omnitool's point, or simple spawn) when one is set,
 * otherwise the world's spawn. The world's spawn often has no fixed height (the
 * game stores 32767 for "find the ground"), so they go there high up with slow
 * falling and drop onto the top block once that ground has loaded.
 */
export function sendToSpawn(player) {
    const point = currentSpawnPoint()
    if (point && typeof point.x === "number") {
        try { if (teleportTo(player, point)) return true } catch { /* fall back to the world's spawn */ }
    }
    try {
        const overworld = world.getDimension("minecraft:overworld")
        const at = world.getDefaultSpawnLocation()
        const x = Math.floor(at.x) + 0.5, z = Math.floor(at.z) + 0.5
        if (Number.isFinite(at.y) && at.y > -64 && at.y < 320) {
            player.teleport({ x, y: at.y, z }, { dimension: overworld })
            return true
        }
        try { player.addEffect("slow_falling", 20 * 10, { showParticles: false }) } catch { /* only a cushion */ }
        player.teleport({ x, y: 200, z }, { dimension: overworld })
        settleOnTop(player, x, z, 0)
        return true
    } catch (e) {
        console.warn(`[Admin+] grant ended: couldn't send ${player.name} to spawn: ${e}`)
        return false
    }
}

function settleOnTop(player, x, z, tries) {
    system.runTimeout(() => {
        try {
            const top = player.dimension.getTopmostBlock({ x: Math.floor(x), z: Math.floor(z) })
            if (top) { player.teleport({ x, y: top.location.y + 1, z }); return }
        } catch { /* not loaded yet, or they left */ }
        if (tries < 20) settleOnTop(player, x, z, tries + 1)
    }, 5)
}

/**
 * One pass: end what is over, give back what is owed, take the notes still
 * waiting. On a timer AND on join, because neither alone is enough: a world
 * that runs for a week never reloads, and a grant that ends while nobody is
 * online has to be dealt with the moment its holder walks back in.
 */
export function runGrantChecks(now = Date.now()) {
    const removed = []
    for (const ended of sweep(now, removed)) {
        queueEnd(ended, "expired")
        console.log(`[Admin+] grant expired: ${ended.playerId} lost ${ended.rankId}`)
    }
    for (const gone of removed) queueEnd(gone, "removed")
    for (const player of world.getAllPlayers()) {
        applyDue(player)
        notePending(player)
    }
}

export function installGrants() {
    system.runInterval(() => runGrantChecks(), SWEEP_TICKS)

    if (world.afterEvents?.playerSpawn?.subscribe) {
        world.afterEvents.playerSpawn.subscribe(event => {
            if (!event.initialSpawn) return
            system.runTimeout(() => runGrantChecks(), 20)
        })
    }
    return true
}

/** Testing seam: drop the in-memory copies, as a world reload would. */
export function __forgetLiveCopies() { liveCopies.clear() }
