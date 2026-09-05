import { world, system, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { modal, confirm } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { has, canActOn, heldRankIds, grantRank, displacedBy, getRank } from "../core/ranks.js"
import { grantableRanks, notify } from "./ranksUI.js"
import { DURATIONS, durationAt, setExpiry, sweep, timedGrants, remainingLabel } from "../core/grants.js"

// /grant — hand somebody a rank, optionally with an end date.
//
// Ranks could always be given; they could never be given BACK on their own, so
// "Mod for the weekend" was a thing somebody had to remember to undo. The rank
// remembers now.
//
// One screen, three questions, the way the ban screen asks its three: who, what,
// and for how long. The length is a dropdown rather than a number box because
// "how long" has about eight sensible answers and 259200 is not one of them.
//
// Permanent is the FIRST option and means no record at all, so the default
// answer changes nothing about how ranks already behave — the timer is
// something you opt into.

/** How often expired grants are taken back. */
const SWEEP_TICKS = 20 * 60          // a minute

export async function grantScreen(player, targetId, targetName, back = () => {}) {
    if (!has(player, "ranks.grant")) { err(player, "You can't hand out ranks."); return back() }
    if (!canActOn(player, targetId)) { err(player, `${targetName} outranks you.`); return back() }

    const held = heldRankIds(targetId)
    const options = grantableRanks(player).filter(rank => !held.includes(rank.id))
    if (!options.length) { err(player, "No ranks left to give that sit below your own."); return back() }

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
            label: "§fFor how long\n§8Permanent is the first option, and means no timer.",
            options: DURATIONS.map(d => d.label),
            default: 0
        }
    ])
    if (!values) return back()

    const rank = options[values.rank ?? 0]
    const length = durationAt(values.duration ?? 0)
    if (!rank) return back()

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
                length.ms ? "§8When it ends they will NOT get those back." : ""
            ].join("\n"),
            "§aGrant")
        if (!yes) return back()
    }

    const before = heldRankIds(targetId)
    if (!grantRank(targetId, rank.id, targetName)) {
        err(player, "That rank no longer exists.")
        return back()
    }
    setExpiry(targetId, rank.id, length.ms, player)

    record(player, "rank.grant", { id: targetId, name: targetName },
        `${rank.id}${length.ms ? ` · ${length.label}` : ""}`, { kind: "ranks", ranks: before })

    if (length.ms) {
        ok(player, `${targetName} is now ${rank.display}§a for §f${length.label.toLowerCase()}§a.`)
        notify(targetId, `You were given ${rank.display}§r for ${length.label.toLowerCase()}.`)
    } else {
        ok(player, `${targetName} is now ${rank.display}§a.`)
        notify(targetId, `You were given the ${rank.display}§r rank.`)
    }
    return back()
}

command({
    name: "grant",
    description: "Give somebody a rank, for a while or for good — /grant <player>",
    perm: "ranks.grant",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [targets]) => {
        const target = (targets ?? [])[0]
        if (!target) return err(player, "Nobody matched.")
        return grantScreen(player, target.id, displayName(target))
    }
})

/**
 * Take expired ranks back.
 *
 * On a timer AND on join, because neither alone is enough: a world that runs
 * for a week never reloads, and a grant that ends while nobody is online has to
 * be gone by the time its holder walks back in rather than a minute afterwards.
 */
export function installGrants() {
    const run = () => {
        for (const ended of sweep()) {
            const target = world.getAllPlayers().find(p => p.id === ended.playerId)
            if (target) info(target, `Your ${ended.display}§r rank has run out.`)
            console.log(`[Admin+] grant expired: ${ended.playerId} lost ${ended.rankId}`)
        }
    }

    system.runInterval(run, SWEEP_TICKS)

    if (world.afterEvents?.playerSpawn?.subscribe) {
        world.afterEvents.playerSpawn.subscribe(event => {
            if (!event.initialSpawn) return
            system.runTimeout(run, 20)
        })
    }
    return true
}
