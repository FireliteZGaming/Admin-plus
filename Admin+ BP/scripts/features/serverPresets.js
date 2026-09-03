import { menu, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { record } from "../core/logs.js"
import {
    SERVER_PRESETS, getServerPreset, detectServerPreset,
    partsOf, nearestPreset, applyServerPreset
} from "../core/serverPresets.js"

// /admin ▸ Presets
//
// One screen that says what shape this server is, and lets you change it in one
// act instead of three.

export async function serverPresetsScreen(player, back) {
    if (!has(player, "presets.apply")) {
        err(player, "Changing the server shape is not something your rank can do.")
        return back()
    }

    const current = detectServerPreset()
    const again = () => serverPresetsScreen(player, back)

    return menu(player, {
        title: hubTitle("presets", "Server presets"),
        body: [
            subtitle("Ladder, config and chats as one coherent shape."),
            "",
            `§fThis server: §r${current.id === "custom" ? "§e" : "§a"}${current.label}`,
            ...(current.id === "custom" ? [driftLine()] : []),
            "",
            "§8Applying one sets all three. It never touches your warps,",
            "§8never deletes a chat you made, and people keep their ranks."
        ].join("\n"),
        buttons: Object.values(SERVER_PRESETS).map(preset => ({
            text: preset.id === current.id
                ? `§a${preset.label} §8· this server§r\n§8${preset.description}`
                : hubEntry("presets", preset.label, preset.description),
            run: () => presetScreen(player, preset.id, again)
        })),
        back
    })
}

/** Custom is only useful if it says WHAT drifted. */
function driftLine() {
    const near = nearestPreset()
    if (!near) return "§8Nothing matches a named shape."
    const off = [
        near.parts.ladder ? null : "the ladder",
        near.parts.config ? null : "the config",
        near.parts.channels ? null : "the chats"
    ].filter(Boolean)
    if (!off.length) return "§8Nothing matches a named shape."
    return `§8Closest is §7${near.label}§8 — ${off.join(" and ")} differ${off.length === 1 ? "s" : ""}.`
}

async function presetScreen(player, id, back) {
    const preset = getServerPreset(id)
    if (!preset) { err(player, "That preset is gone."); return back() }

    const parts = partsOf(id)
    const mark = (matches) => matches ? "§a✔" : "§8✘"

    return menu(player, {
        title: hubTitle("presets", preset.label),
        body: [
            `§7${preset.notes}`,
            "",
            `${mark(parts.ladder)} §fLadder §8· ${preset.ladder}`,
            `${mark(parts.config)} §fConfig §8· ${Object.keys(preset.config).length} values`,
            `${mark(parts.channels)} §fChats §8· ${preset.channels.join(", ")}`,
            "",
            parts.ladder && parts.config && parts.channels
                ? "§aThis server already is this shape."
                : "§8Ticks show what already matches."
        ].join("\n"),
        buttons: [
            {
                text: "§e§lApply this shape§r\n§8Sets the ladder, the config and the chats",
                run: () => applyScreen(player, id, back)
            },
            {
                text: "§bWhat it sets§r\n§8Every value, before you commit to it",
                run: () => detailScreen(player, id, () => presetScreen(player, id, back))
            }
        ],
        back
    })
}

async function detailScreen(player, id, back) {
    const preset = getServerPreset(id)
    const values = Object.entries(preset.config).map(([key, value]) => `§8· §7${key} §8= §f${value}`)

    return menu(player, {
        title: hubTitle("presets", preset.label),
        body: [
            `§fLadder: §7${preset.ladder}`,
            `§fChats: §7${preset.channels.join(", ")}`,
            "",
            "§fConfig",
            ...values,
            "",
            "§8Anything not listed keeps whatever it has now."
        ].join("\n"),
        buttons: [],
        back
    })
}

async function applyScreen(player, id, back) {
    const preset = getServerPreset(id)
    if (!preset) { err(player, "That preset is gone."); return back() }

    // The ladder swap is the part with teeth: a rank the new ladder does not
    // define stops existing, and anyone holding it silently loses it. Saying so
    // here is the difference between a preset and a trap.
    const yes = await confirm(player, hubTitle("presets", preset.label),
        [
            preset.notes,
            "",
            `§fSets:§r the ${preset.ladder} ladder, §f${Object.keys(preset.config).length}§r config values, chats §f${preset.channels.join(", ")}§r.`,
            "",
            "§8Warps are untouched. Chats you made are kept.",
            "§cRanks not in the new ladder stop existing, and holders lose them.",
            "§8Ranks ▸ Ladder ▸ Undo puts the old ladder back."
        ].join("\n"),
        "§eApply")
    if (!yes) return back()

    const result = applyServerPreset(id)
    if (!result) { err(player, "That preset is gone."); return back() }

    record(player, "config.serverPreset", undefined,
        `${preset.label} · ${result.ranks} ranks · ${result.configCount} values · +${result.channelsAdded.length} chats`)

    ok(player, `This server is now §f${preset.label}§a.`)
    info(player, [
        `§7${result.ranks} ranks · ${result.configCount} config values`,
        result.channelsAdded.length
            ? `§7Added chats: §f${result.channelsAdded.join(", ")}`
            : "§7No new chats needed.",
        "§8Undo the ladder in Ranks ▸ Ladder if that was not what you wanted."
    ].join("\n"))
    return back()
}
