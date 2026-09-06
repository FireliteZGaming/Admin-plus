import { world, system } from "@minecraft/server"

// A REAL container screen onto somebody's ender chest — drag, shift-click and
// all, because it is the game's own container UI rather than a form.
//
// Forms cannot do slots. That is true and stays true: an ActionForm is buttons,
// and a press returns one index. What Bedrock does have is a container ENTITY —
// an entity carrying `minecraft:inventory` with a vanilla `container_type`,
// which the game opens NATIVELY when a player interacts with it. Technique
// reverse-engineered from The Magic Way's Spell Binding Table for the sibling
// project's Soulforge; see memory `bedrock-container-entity-ui`.
//
// We need none of the fiddly half of that technique. The Spell Binding Table
// reskins `ui/chest_screen.json` because it wants an anvil-shaped layout; a
// plain 27-slot chest is what `minecart_chest` already draws, so there is no
// JSON-UI here and no new textures. And nothing is placed in the world — the
// entity is spawned and removed, so no block is ever touched.
//
// There is still no "open a container" API. The player taps the marker. That is
// the one bit of ceremony the technique costs and it cannot be removed.
//
// ---------------------------------------------------------------------------
// THE DUPE, AND WHY THIS RECONCILES RATHER THAN MIRRORS
//
// The entity holds a COPY. Writing that copy back over the ender chest every
// tick is the obvious implementation and it duplicates items:
//
//   t0  chest [diamond]        -> entity [diamond]
//   t1  the player, standing at their own ender chest block, drags the diamond
//       into their inventory.  chest [] and the diamond is in their pack
//   t2  a blind entity -> chest write puts it back.  TWO diamonds.
//
// So each tick asks which SIDE changed since the last one:
//
//   the chest changed   -> somebody else edited it. Reload the entity from the
//                          chest. The viewer watches the item leave, live.
//   only the view changed -> the viewer edited it. Write the view to the chest.
//   both changed        -> the real chest wins, for the same reason.
//
// Opening your OWN is the safe case and has no reconciliation to do: one player
// has one screen, so the block and this view cannot both be open.
//
// It also makes cleanup safe. The chest is never emptied, so an entity stranded
// by a crash or a chunk unload holds nothing but a copy — it is deleted on
// sight, and deleting it can never cost anybody an item.

// TWO MECHANISMS, ON PURPOSE, so a playtest can say which one Bedrock likes.
//
//   marker  spawn a container entity at the crosshair; the player taps it.
//           Certain to be a real container, uncertain how it feels.
//   ride    force the player to RIDE a container entity (addRider is
//           scriptable). On a chested mount the inventory button shows the
//           mount's container next to your own, with drag — and needs no aiming
//           at anything. Uncertain whether a custom `horse` container behaves
//           that way; that is exactly what the test is for.
//
// Neither can open the screen outright. Nothing can: `Container` has no open
// method, `Player` has none, `CustomForm` has no slot control, and no vanilla
// command does it either — checked 2026-09-06 against the real .d.ts for both
// modules, beta and stable. The engine only ever OBSERVES a container opening
// (`entityContainerOpened`, carrying an `openSource` describing which player
// action did it). So the question is not how to skip the interaction, it is
// which interaction costs the player least.
const TYPE = "adminplus:ender_view"
const RIDE_TYPE = "adminplus:ender_ride"
const SIZE = 27

/** How long a view may sit open untouched, and how far the viewer may wander. */
const IDLE_TICKS = 20 * 90
const MAX_DISTANCE = 8

/** viewerId -> view. One per viewer, and at most one per target. */
const views = new Map()

function safe(fn, fallback) {
    try {
        const value = fn()
        return value === undefined ? fallback : value
    } catch { return fallback }
}

/** Both spellings, for the reason core/inventory.js gives. */
function enderOf(player) {
    return safe(() => player.getComponent("minecraft:ender_inventory")?.container)
        ?? safe(() => player.getComponent("ender_inventory")?.container)
}

function boxOf(entity) {
    return safe(() => entity.getComponent("minecraft:inventory")?.container)
}

/**
 * A cheap string standing for a container's contents.
 *
 * Only ever compared with itself, never stored, so it needs to change whenever
 * the contents change rather than to describe them. Durability is in it because
 * repairing or damaging a tool is a real edit that leaves type and count alone.
 */
export function signature(container) {
    if (!container) return ""
    const size = container.size ?? SIZE
    const parts = []
    for (let i = 0; i < size; i++) {
        const stack = safe(() => container.getItem(i))
        if (!stack) { parts.push("-"); continue }
        const damage = safe(() => stack.getComponent("minecraft:durability")?.damage, 0) ?? 0
        parts.push(`${stack.typeId}:${stack.amount ?? 1}:${stack.nameTag ?? ""}:${damage}`)
    }
    return parts.join("|")
}

/** Copy every slot, so the destination ends up identical to the source. */
function copyInto(source, destination) {
    if (!source || !destination) return false
    const size = Math.min(source.size ?? SIZE, destination.size ?? SIZE)
    for (let i = 0; i < size; i++) {
        safe(() => destination.setItem(i, safe(() => source.getItem(i))), undefined)
    }
    return true
}

/** Is somebody already looking into this player's chest? */
export function viewOpenOn(targetId) {
    for (const view of views.values()) if (view.targetId === targetId) return view
    return undefined
}

export function viewOf(viewerId) { return views.get(viewerId) }

/**
 * Put a container marker in front of the viewer, loaded from `target`'s chest.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function openEnderView(viewer, target, mode = "marker") {
    const chest = enderOf(target)
    if (!chest) return { ok: false, reason: "Couldn't reach that ender chest." }

    // One view per chest. Two entities reconciling against one chest would take
    // turns overwriting each other, and the loser's edits would vanish.
    const busy = viewOpenOn(target.id)
    if (busy && busy.viewerId !== viewer.id) {
        return { ok: false, reason: "Somebody else has that ender chest open." }
    }
    closeEnderView(viewer)

    const riding = mode === "ride"

    // The marker goes at the crosshair at arm's length, so it is already under
    // the aim the moment the command runs. The seat goes at the player's own
    // feet, because they are about to be sitting in it.
    let spot
    if (riding) {
        spot = safe(() => viewer.location)
    } else {
        const at = safe(() => viewer.getHeadLocation()) ?? safe(() => viewer.location)
        if (!at) return { ok: false, reason: "Couldn't work out where you are." }
        const facing = safe(() => viewer.getViewDirection()) ?? { x: 0, y: 0, z: 1 }
        spot = { x: at.x + facing.x * 1.4, y: at.y + facing.y * 1.4, z: at.z + facing.z * 1.4 }
    }
    if (!spot) return { ok: false, reason: "Couldn't work out where you are." }

    let entity
    try {
        entity = viewer.dimension.spawnEntity(riding ? RIDE_TYPE : TYPE, spot)
    } catch (e) {
        return { ok: false, reason: `Couldn't open the drag view (${e}).` }
    }
    // NOT wrapped in safe(): a marker that failed to spawn means the whole
    // feature is broken, and the caller has a working screen to fall back on.
    if (!entity) return { ok: false, reason: "Couldn't open the drag view." }

    const box = boxOf(entity)
    if (!box) {
        safe(() => entity.remove())
        return { ok: false, reason: "The drag view has no container — the pack may be out of date." }
    }

    copyInto(chest, box)

    if (riding) {
        // Seat them in it. If this fails there is nothing to tap either — the
        // seat is invisible and at their feet — so clean up rather than leave
        // them standing next to a thing they cannot use.
        const seat = safe(() => entity.getComponent("minecraft:rideable"))
        const seated = seat && safe(() => seat.addRider(viewer), false)
        if (!seated) {
            safe(() => entity.remove())
            return { ok: false, reason: "Couldn't sit you in the ender chest seat." }
        }
    }
    // No nametag. The marker renders as an ender chest, so floating text over
    // it would be a label on something that already says what it is — and a
    // debug artifact is exactly what it looked like.

    views.set(viewer.id, {
        viewerId: viewer.id,
        targetId: target.id,
        own: viewer.id === target.id,
        mode: riding ? "ride" : "marker",
        entityId: entity.id,
        entity,
        chestSig: signature(chest),
        viewSig: signature(box),
        opened: system.currentTick,
        touched: system.currentTick
    })
    return { ok: true }
}

/** Flush and remove one viewer's marker. */
export function closeEnderView(viewer) {
    const id = typeof viewer === "string" ? viewer : viewer?.id
    const view = views.get(id)
    if (!view) return false
    views.delete(id)

    // A last reconcile, so an edit made on the tick they walked away is not
    // thrown out. The chest still wins if it also moved.
    const target = world.getAllPlayers().find(p => p.id === view.targetId)
    const box = boxOf(view.entity)
    const chest = target ? enderOf(target) : undefined
    if (chest && box && signature(chest) === view.chestSig && signature(box) !== view.viewSig) {
        copyInto(box, chest)
    }

    // Stand them up before the seat disappears out from under them.
    if (view.mode === "ride") {
        safe(() => view.entity.getComponent("minecraft:rideable")?.ejectRiders())
    }
    safe(() => view.entity.remove())
    return true
}

/**
 * One reconciliation pass.
 *
 * Exported and pure enough to test: it takes the containers rather than finding
 * them, and returns which way it went.
 * @returns {"chest-wins"|"view-wins"|"idle"}
 */
export function reconcile(view, chest, box) {
    const chestSig = signature(chest)
    const viewSig = signature(box)

    if (chestSig !== view.chestSig) {
        // Somebody edited the real chest. They win — always, including when the
        // viewer edited too, because the alternative is putting back an item
        // the owner has already taken out and holding two of it.
        copyInto(chest, box)
        view.chestSig = chestSig
        view.viewSig = signature(box)
        return "chest-wins"
    }

    if (viewSig !== view.viewSig) {
        copyInto(box, chest)
        view.viewSig = viewSig
        view.chestSig = signature(chest)
        return "view-wins"
    }

    return "idle"
}

function distanceOk(viewer, entity) {
    const a = safe(() => viewer.location)
    const b = safe(() => entity.location)
    if (!a || !b) return false
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
    return (dx * dx + dy * dy + dz * dz) <= MAX_DISTANCE * MAX_DISTANCE
}

function step() {
    if (!views.size) return
    const online = world.getAllPlayers()
    for (const [viewerId, view] of [...views]) {
        const viewer = online.find(p => p.id === viewerId)
        const target = online.find(p => p.id === view.targetId)
        const box = boxOf(view.entity)
        const chest = target ? enderOf(target) : undefined

        // Any of these means the view cannot be trusted to reconcile: drop it.
        // The chest keeps the items either way.
        if (!viewer || !target || !box || !chest) {
            closeEnderView(viewerId)
            continue
        }

        // How you leave differs by mechanism. A marker you walk away from; a
        // seat you get out of, and getting out IS the close — waiting for a
        // distance that never grows would strand the seat under them.
        //
        // Both get a moment's grace first. A rider may not be registered on the
        // same tick it was added, and closing on that would look exactly like
        // the feature not working at all.
        const settling = system.currentTick - view.opened < 10
        const stillThere = settling || (view.mode === "ride"
            ? !!safe(() => view.entity.getComponent("minecraft:rideable")
                ?.getRiders()?.some(r => r?.id === viewerId), false)
            : distanceOk(viewer, view.entity))
        if (!stillThere) {
            closeEnderView(viewerId)
            continue
        }

        const outcome = reconcile(view, chest, box)
        if (outcome !== "idle") view.touched = system.currentTick
        if (system.currentTick - view.touched > IDLE_TICKS) closeEnderView(viewerId)
    }
}

/**
 * Delete every marker in the world.
 *
 * Safe by construction: the ender chest is never emptied, so a marker holds a
 * copy and nothing else. Run at startup, where anything found is an orphan left
 * by a crash or a reload.
 */
export function sweepOrphans() {
    let removed = 0
    for (const dimensionId of ["overworld", "nether", "the_end"]) {
        const dimension = safe(() => world.getDimension(dimensionId))
        if (!dimension) continue
        for (const type of [TYPE, RIDE_TYPE]) {
            for (const entity of safe(() => dimension.getEntities({ type }), []) ?? []) {
                if ([...views.values()].some(v => v.entityId === entity.id)) continue
                safe(() => entity.getComponent("minecraft:rideable")?.ejectRiders())
                safe(() => entity.remove())
                removed++
            }
        }
    }
    return removed
}

export function installEnderView() {
    system.run(() => {
        const removed = sweepOrphans()
        if (removed) console.warn(`[Admin+] cleared ${removed} orphaned ender chest marker(s)`)
    })
    system.runInterval(step, 1)
    world.afterEvents.playerLeave.subscribe(({ playerId }) => {
        closeEnderView(playerId)
        for (const [viewerId, view] of [...views]) {
            if (view.targetId === playerId) closeEnderView(viewerId)
        }
    })
}

export { TYPE as ENDER_VIEW_TYPE, SIZE as ENDER_VIEW_SIZE, views as __views }
