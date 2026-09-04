import { world, system, ItemTypes } from "@minecraft/server"
import { ok, err, info } from "../core/util.js"
import { allServerPresets, getServerPreset, applyServerPreset, detectServerPreset } from "../core/serverPresets.js"
import { record } from "../core/logs.js"
import { typeIdToDataId, typeIdToID } from "../core/typeIds.js"

// The bridge from commands into the script.
//
// A .mcfunction cannot call script — /scriptevent is the only door between the
// two — so anything a command needs to trigger comes through here.
//
// Applying a preset used to have a function wrapper as well as this event, and
// the wrapper was one line that fired the event. Two names for one thing, and
// the function was the worse of them: a .mcfunction with a single unparseable
// line is dropped WHOLE and silently, so the wrapper could vanish without
// anybody being told. The event is the interface now:
//
//     /scriptevent adminplus:preset <id>
//
// No permission check, deliberately: running /scriptevent at all already
// requires cheats or operator, which is a higher bar than most of the panel's
// own nodes. Adding a rank check on top would only mean an operator being told
// no by their own addon.

const NAMESPACE = "adminplus"
const PRESET_EVENT = `${NAMESPACE}:preset`
const ICONS_EVENT = `${NAMESPACE}:icons`

/** Say it where whoever pulled the lever will actually see it. */
function reply(source, kind, text) {
    if (source && typeof source.sendMessage === "function") {
        ;({ ok, err, info }[kind] ?? info)(source, text)
        return
    }
    // Fired from a command block or the console — nobody to answer, so the log
    // is the only honest place for it.
    console.log(`[Admin+] ${text.replace(/§./g, "")}`)
}

function applyByEvent(source, wanted) {
    const id = String(wanted ?? "").trim().toLowerCase()

    if (!id) {
        const names = Object.values(allServerPresets()).map(p => `${p.label} (${p.id})`).join(", ")
        reply(source, "info", `§7Server shapes: §f${names}§7. Currently §f${detectServerPreset().label}§7.`)
        return
    }

    const preset = getServerPreset(id)
    if (!preset) {
        const ids = Object.keys(allServerPresets()).join(", ")
        reply(source, "err", `No server preset called "§f${id}§c". Known: §f${ids}`)
        return
    }

    const result = applyServerPreset(id)
    if (!result) {
        reply(source, "err", `Couldn't apply §f${preset.label}§c.`)
        return
    }

    record(source, "config.serverPreset", undefined,
        `${preset.label} via scriptevent · ${result.ranks} ranks · ${result.configCount} values`)

    reply(source, "ok", `This server is now §f${preset.label}§a.`)
    reply(source, "info", [
        `§7${result.ranks} ranks · ${result.configCount} config values`,
        result.channelsAdded.length
            ? `§7Added chats: §f${result.channelsAdded.join(", ")}`
            : "§7No new chats needed.",
        "§8Warps and who holds which rank are untouched. Ranks the new ladder",
        "§8does not define have stopped existing — Ranks ▸ Ladder ▸ Undo reverts it."
    ].join("\n"))

    console.log(`[Admin+] server preset applied via scriptevent: ${preset.label}`)
}


/**
 * /scriptevent adminplus:icons — why the chest grid draws the wrong pictures.
 *
 * The grid identifies an item by a NUMBER, and that number is an index into the
 * game's item registry. We ship a static table of those numbers, and a table
 * that does not match the running build draws neighbours instead of the right
 * item: an acacia boat came out as pink dye, a copper shovel as a copper
 * pickaxe. Worse, the error GREW with the id (25 low down, 26 higher up), which
 * means the table holds entries this build does not — so no single offset can
 * correct it.
 *
 * This prints the one measurement that decides the fix. If (table id − position
 * in ItemTypes.getAll()) is the SAME for every probe, the registry order is
 * recoverable at runtime and the table can be computed from the live world
 * instead of shipped, which would end this whole class of bug. If the deltas
 * drift, the numeric route is unfixable and the icons must come from texture
 * paths instead — the resource pack already supports both.
 */
const PROBES = [
    "minecraft:stone",
    "minecraft:oak_planks",
    "minecraft:diamond_sword",
    "minecraft:golden_boots",
    "minecraft:acacia_boat",
    "minecraft:pink_dye",
    "minecraft:leather",
    "minecraft:copper_sword",
    "minecraft:copper_shovel",
    "minecraft:copper_pickaxe",
    "minecraft:mace"
]

function probeIcons(source) {
    let all = []
    try {
        all = ItemTypes.getAll().map(type => type.id)
    } catch (e) {
        console.error(`[Admin+] icon probe: ItemTypes.getAll() failed: ${e}`)
        return
    }

    console.warn(`[Admin+] icon probe: ItemTypes.getAll() reports ${all.length} item types`)
    console.warn("[Admin+] icon probe: id                              table  index  delta")

    const deltas = []
    for (const id of PROBES) {
        const table = typeIdToDataId.get(id) ?? typeIdToID.get(id)
        const index = all.indexOf(id)
        const delta = (table !== undefined && index >= 0) ? table - index : undefined
        if (delta !== undefined) deltas.push(delta)
        console.warn(`[Admin+] icon probe: ${id.padEnd(32)} ${String(table ?? "-").padStart(5)} ${String(index).padStart(6)} ${String(delta ?? "-").padStart(6)}`)
    }

    const unique = [...new Set(deltas)]
    if (unique.length === 1) {
        console.warn(`[Admin+] icon probe: VERDICT constant delta ${unique[0]} — ids can be computed from the live world`)
    } else {
        console.warn(`[Admin+] icon probe: VERDICT deltas differ (${unique.join(", ")}) — the numeric route cannot be corrected; use texture paths`)
    }

    if (source && typeof source.sendMessage === "function") {
        info(source, `§7Icon probe written to the content log · §f${all.length}§7 item types, delta ${unique.join("/")}`)
    }
}

export function installScriptEvents() {
    const event = system.afterEvents?.scriptEventReceive
    if (!event?.subscribe) {
        console.warn("[Admin+] scriptEventReceive unavailable — /function preset triggers will do nothing")
        return false
    }

    try {
        event.subscribe(ev => {
            if (ev.id !== PRESET_EVENT && ev.id !== ICONS_EVENT) return
            // Deferred: an event handler is not a safe place to rewrite the rank
            // table and every setting on top of it.
            system.run(() => {
                try {
                    if (ev.id === ICONS_EVENT) probeIcons(ev.sourceEntity)
                    else applyByEvent(ev.sourceEntity, ev.message)
                } catch (e) {
                    console.error(`[Admin+] ${ev.id} failed: ${e}\n${e?.stack ?? ""}`)
                }
            })
        }, { namespaces: [NAMESPACE] })
    } catch {
        // Older runtimes reject the filter object rather than ignoring it.
        event.subscribe(ev => {
            if (ev.id === ICONS_EVENT) { system.run(() => probeIcons(ev.sourceEntity)); return }
            if (ev.id !== PRESET_EVENT) return
            system.run(() => applyByEvent(ev.sourceEntity, ev.message))
        })
    }

    console.log(`[Admin+] scriptevent bridge ready (${PRESET_EVENT}, ${ICONS_EVENT})`)
    return true
}

export { PRESET_EVENT, ICONS_EVENT, NAMESPACE }
