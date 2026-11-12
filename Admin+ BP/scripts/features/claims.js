import { world, system, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { has } from "../core/ranks.js"
import { record } from "../core/logs.js"
import {
    allClaims, claimsOf, getClaim, createClaim, removeClaim, claimAt,
    claimLimit, claimMaxSize, squareAround, trust, untrust, mayBuild
} from "../core/claims.js"

// Claims, and the events that enforce them.
//
// **Every hook here is a BEFORE event, because after is too late.** An after
// event tells you a block is already gone; the only way to stop a stranger
// breaking somebody's front door is to cancel the attempt, and only the before
// events carry `cancel`. Confirmed against the packs installed on this machine
// rather than from memory — Soulbound Essentials protects land through exactly
// these four, and IAmAtomic cancels breaks the same way.
//
// **A before event runs in a READ-ONLY context.** Setting `cancel` is allowed;
// sending a message is not, and calling one throws inside the handler, which
// would leave the block broken AND the player unwarned. So every message is
// deferred with system.run().

/** Telling somebody off, but not forty times a second. */
const told = new Map()

function refuse(player, reason) {
    const last = told.get(player.id) ?? 0
    // Holding left-click on a protected wall fires this every few ticks. One
    // line every two seconds is a warning; thirty is a punishment for asking.
    if (Date.now() - last < 2000) return
    told.set(player.id, Date.now())
    system.run(() => err(player, reason))
}

/** The one check every hook runs. Returns true when the event must be cancelled. */
function blocked(player, block) {
    if (!player || !block) return false
    const at = block.location
    if (!at) return false
    const verdict = mayBuild(player, block.dimension?.id, at.x, at.z)
    if (verdict.ok) return false
    refuse(player, `${verdict.reason} You can't build here.`)
    return true
}

export function installClaims() {
    const before = world.beforeEvents ?? {}

    // Breaking and placing are the two that matter; the other two are what stop
    // a claim being a fence with an open gate. Each is optional-chained because
    // a runtime missing one should lose that protection, not the whole feature.
    before.playerBreakBlock?.subscribe(event => {
        if (blocked(event.player, event.block)) event.cancel = true
    })

    before.playerPlaceBlock?.subscribe(event => {
        if (blocked(event.player, event.block)) event.cancel = true
    })

    // Chests, doors, buttons, furnaces. Without this a claim keeps your walls
    // up and hands over everything inside them, which is worse than no claim at
    // all because it looks like protection.
    before.playerInteractWithBlock?.subscribe(event => {
        if (blocked(event.player, event.block)) event.cancel = true
    })

    // Item frames, armour stands, animals — the things a claim is often FOR.
    before.playerInteractWithEntity?.subscribe(event => {
        const target = event.target
        const at = target?.location
        if (!event.player || !at) return
        const verdict = mayBuild(event.player, target.dimension?.id, at.x, at.z)
        if (!verdict.ok) {
            refuse(event.player, `${verdict.reason} You can't touch things here.`)
            event.cancel = true
        }
    })

    // A creeper does not have a permission node, so an explosion is judged by
    // WHERE it goes off rather than by who caused it. Cancelled outright inside
    // a claim: sorting the block list would let a charged creeper on the border
    // take half a wall, and "mostly protected" is not a promise worth making.
    // **The block list is FILTERED, not the explosion cancelled.**
    //
    // The first version of this read `event.impactedBlocks` and `event.dimension`
    // and set `event.cancel`. None of those are the API: an ExplosionBeforeEvent
    // carries `getImpactedBlocks()` and `setImpactedBlocks()`, and each block
    // knows its own dimension. Checked against Soulbound Essentials, which
    // protects land through this same event and is the only installed pack that
    // does — it filters, it does not cancel.
    //
    // Worth saying that the test passed anyway, because the stub had been
    // written to match the same wrong assumption. A test and the code agreeing
    // with each other proves nothing when both came from one guess.
    //
    // Filtering is also the better behaviour. A creeper on a claim border used
    // to have its whole blast cancelled, protecting unclaimed ground nobody had
    // paid for; now the claimed blocks survive and the rest goes, which is what
    // a boundary should mean.
    before.explosion?.subscribe(event => {
        let blocks
        try { blocks = event.getImpactedBlocks?.() } catch { blocks = undefined }
        if (!Array.isArray(blocks) || !blocks.length) return

        const kept = blocks.filter(block => {
            const at = block?.location
            if (!at) return true
            return !claimAt(block.dimension?.id, at.x, at.z)
        })
        if (kept.length !== blocks.length) {
            try { event.setImpactedBlocks(kept) } catch { /* runtime without the setter */ }
        }
    })

    if (!before.playerBreakBlock) {
        console.warn("[Admin+] beforeEvents.playerBreakBlock unavailable — land claims cannot protect anything on this runtime")
    }
}

// ----------------------------------------------------------------- commands

command({
    name: "claim",
    description: "Claim the land around you",
    optional: [{ name: "size", type: CustomCommandParamType.Integer }],
    run: (player, [size]) => {
        const result = createClaim(player, size)
        if (!result.ok) return err(player, result.reason)
        const c = result.claim
        record(player, "claim.created", undefined,
            `${c.id} · ${c.x2 - c.x1 + 1} across at ${c.x1}, ${c.z1}`)
        return ok(player, `Claimed §f${c.x2 - c.x1 + 1}§a blocks across, `
            + `centred on you. §7(${claimsOf(player.id).length}/${claimLimit(player)})`)
    }
})

command({
    name: "unclaim",
    description: "Give up the claim you are standing in",
    run: (player) => {
        if (!flag("feature.claims")) return info(player, "Land claims are turned off on this server.")
        const at = player.location
        const claim = claimAt(player.dimension?.id, at.x, at.z)
        if (!claim) return err(player, "You aren't standing in a claim.")
        if (claim.owner !== player.id && !has(player, "admin.claims")) {
            return err(player, `That land is §f${claim.ownerName}§c's.`)
        }
        removeClaim(claim.id)
        record(player, "claim.removed", undefined, `${claim.id} (owner ${claim.ownerName})`)
        return ok(player, "That land is open again.")
    }
})

command({
    name: "claims",
    description: "See and manage your land claims",
    run: (player) => claimsScreen(player, () => {})
})

command({
    name: "trust",
    description: "Let a player build on your claim",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const target = selected?.[0]
        if (!target) return err(player, "Nobody by that name is online.")
        const at = player.location
        const claim = claimAt(player.dimension?.id, at.x, at.z)
        if (!claim) return err(player, "You aren't standing in a claim.")
        if (claim.owner !== player.id) return err(player, "That isn't your claim.")
        const result = trust(claim.id, target)
        if (!result.ok) return err(player, result.reason)
        info(target, `§a${player.name}§7 trusted you on their land.`)
        return ok(player, `§f${target.name}§a can build there now.`)
    }
})

command({
    name: "untrust",
    description: "Stop a player building on your claim",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const target = selected?.[0]
        if (!target) return err(player, "Nobody by that name is online.")
        const at = player.location
        const claim = claimAt(player.dimension?.id, at.x, at.z)
        if (!claim) return err(player, "You aren't standing in a claim.")
        if (claim.owner !== player.id) return err(player, "That isn't your claim.")
        if (!untrust(claim.id, target.id)) {
            return err(player, `§f${target.name}§c wasn't trusted there anyway.`)
        }
        return ok(player, `§f${target.name}§a can't build there any more.`)
    }
})

// ------------------------------------------------------------------ the panel

export async function claimsScreen(player, back) {
    const again = () => claimsScreen(player, back)
    const staff = has(player, "admin.claims")
    const mine = claimsOf(player.id)
    const limit = claimLimit(player)

    if (!flag("feature.claims")) { info(player, "Land claims are turned off on this server."); return back() }

    return menu(player, {
        title: hubTitle("warps", "Land claims"),
        body: subtitle(limit > 0
            ? `You have ${mine.length} of ${limit}, up to ${claimMaxSize(player)} blocks across.`
            : "Your rank can't claim land."),
        buttons: [
            ...mine.map(c => ({
                text: `§f${c.id}§r\n§8${c.x2 - c.x1 + 1} across · ${(c.trusted ?? []).length} trusted`,
                run: () => claimScreen(player, c.id, again)
            })),
            limit > mine.length
                ? { text: hubEntry("warps", "Claim here", "The ground around where you stand"), run: () => claimHereScreen(player, again) }
                : null,
            staff
                ? { text: hubEntry("settings", "Every claim", `${allClaims().length} on this server`), run: () => allClaimsScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

async function claimHereScreen(player, back) {
    const max = claimMaxSize(player)
    const values = await modal(player, hubTitle("warps", "Claim here"), [
        {
            id: "size", type: "slider",
            label: `How many blocks across\n§8Centred on you. Your rank allows up to ${max}.`,
            min: 4, max, step: 4, default: Math.min(32, max)
        }
    ])
    if (!values) return back()
    const result = createClaim(player, values.size)
    if (!result.ok) return err(player, result.reason)
    record(player, "claim.created", undefined, `${result.claim.id} · ${values.size} across`)
    ok(player, `Claimed §f${values.size}§a blocks across.`)
    return back()
}

async function claimScreen(player, claimId, back) {
    const claim = getClaim(claimId)
    if (!claim) return back()
    const again = () => claimScreen(player, claimId, back)
    const trusted = claim.trusted ?? []

    return menu(player, {
        title: hubTitle("warps", claim.id),
        body: [
            subtitle(`${claim.x2 - claim.x1 + 1} blocks across, full height.`),
            `§f${claim.x1}, ${claim.z1}§7 to §f${claim.x2}, ${claim.z2}`,
            `§8${String(claim.dimension).replace("minecraft:", "")}`,
            "",
            trusted.length
                ? `§fTrusted: §7${trusted.map(t => t.name).join(", ")}`
                : "§8Nobody else can build here."
        ].join("\n"),
        buttons: [
            trusted.length
                ? { text: hubEntry("actions", "Trusted players", "Take somebody off"), run: () => trustedScreen(player, claimId, again) }
                : null,
            { text: "§cGive up this claim", run: () => removeScreen(player, claimId, back) }
        ].filter(Boolean),
        back
    })
}

async function trustedScreen(player, claimId, back) {
    const claim = getClaim(claimId)
    if (!claim) return back()
    return pagedMenu(player, {
        title: hubTitle("actions", "Trusted"),
        body: subtitle("Tap somebody to stop them building here."),
        items: claim.trusted ?? [],
        render: t => ({ text: `§f${t.name}` }),
        onPick: async t => {
            const yes = await confirm(player, hubTitle("actions", t.name),
                `Stop §f${t.name}§r building on §f${claim.id}§r?`, "§cRemove")
            if (yes) { untrust(claimId, t.id); ok(player, `§f${t.name}§a removed.`) }
            return trustedScreen(player, claimId, back)
        },
        back
    })
}

async function removeScreen(player, claimId, back) {
    const claim = getClaim(claimId)
    if (!claim) return back()
    const yes = await confirm(player, hubTitle("warps", "Give up claim"),
        `Give up §f${claim.id}§r?\n\n§8Anybody will be able to build there.`, "§cGive it up")
    if (!yes) return back()
    removeClaim(claimId)
    record(player, "claim.removed", undefined, `${claim.id} (owner ${claim.ownerName})`)
    ok(player, "That land is open again.")
    return back()
}

/** Staff: every claim on the server, so a griefer's can be removed. */
async function allClaimsScreen(player, back) {
    return pagedMenu(player, {
        title: hubTitle("settings", "Every claim"),
        body: subtitle(`${allClaims().length} on this server.`),
        items: allClaims(),
        render: c => ({
            text: `§f${c.ownerName}§r\n§8${c.id} · ${c.x2 - c.x1 + 1} across at ${c.x1}, ${c.z1}`
        }),
        onPick: c => claimScreen(player, c.id, () => allClaimsScreen(player, back)),
        back
    })
}
