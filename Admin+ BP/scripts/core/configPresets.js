import { Table } from "./storage.js"
import { DEFAULTS, setting, setSetting } from "./settings.js"

// Config presets — named baselines for the whole settings block.
//
// The useful half is CUSTOM. A preset name tells you the config is a known
// quantity; "Custom" tells you somebody has changed something and you now have
// to read the block to know what. Detection is derived, never stored: change one
// value and the name changes itself, so it can never claim you are on a preset
// you have edited away from.
//
// A preset only names the keys it cares about. Everything it does not mention
// keeps whatever it already had, so a preset about teleporting says nothing
// about chat.

const SAVED_KEY = "configPresets"

const saved = new Table(SAVED_KEY, {})

/** Shipped baselines. */
export const BUILT_IN = {
    vanilla: {
        label: "Vanilla",
        description: "Everything at its shipped default.",
        values: {}          // empty means "no overrides at all"
    },
    realm: {
        label: "Realm",
        description: "Tuned for a small realm: protected spawn, quick teleports, alerts on.",
        values: {
            "spawn.protect": "true",
            "spawn.radius": "24",
            "teleport.warmup": "1",
            "teleport.cooldown": "2",
            "automod.ores": "true",
            "automod.breaks": "true",
            "automod.spam": "true",
            "presence.announce": "true"
        }
    },
    strict: {
        label: "Strict",
        description: "Long warmups, wide spawn protection, everything watched.",
        values: {
            "spawn.protect": "true",
            "spawn.radius": "48",
            "teleport.warmup": "5",
            "teleport.cooldown": "15",
            "staff.exemptCooldowns": "false",
            "automod.ores": "true",
            "automod.breaks": "true",
            "automod.spam": "true"
        }
    },
    quiet: {
        label: "Quiet",
        description: "No join or leave lines, no automod chatter. Survival server, left alone.",
        values: {
            "presence.announce": "false",
            "automod.ores": "false",
            "automod.breaks": "false",
            "automod.spam": "false"
        }
    }
}

/** Built-ins plus anything saved on this world. */
export function allPresets() {
    const out = { ...BUILT_IN }
    for (const [id, preset] of saved.entries()) out[id] = { ...preset, custom: true }
    return out
}

export function getPreset(id) { return allPresets()[id] }

/** Does every key this preset names currently hold the preset's value? */
function matches(preset) {
    const values = preset.values ?? {}
    if (!Object.keys(values).length) {
        // The empty preset means "no overrides" — true only when nothing differs
        // from the shipped defaults.
        return Object.keys(DEFAULTS).every(key => setting(key) === DEFAULTS[key].value)
    }
    return Object.entries(values).every(([key, value]) => setting(key) === value)
}

/**
 * Which preset the config is currently on.
 * @returns {{id: string, label: string}} "custom" when nothing matches
 */
export function detectPreset() {
    for (const [id, preset] of Object.entries(allPresets())) {
        if (id === "vanilla") continue          // checked last: it is the weakest claim
        if (matches(preset)) return { id, label: preset.label ?? id }
    }
    if (matches(BUILT_IN.vanilla)) return { id: "vanilla", label: BUILT_IN.vanilla.label }
    return { id: "custom", label: "Custom" }
}

/** Apply a preset's values. Returns how many keys it touched. */
export function applyPreset(id) {
    const preset = getPreset(id)
    if (!preset) return undefined
    const values = preset.values ?? {}

    if (!Object.keys(values).length) {
        // "Vanilla" means clear everything rather than write defaults back —
        // an override that happens to equal the default is still an override.
        for (const key of Object.keys(DEFAULTS)) setSetting(key, DEFAULTS[key].value)
        return Object.keys(DEFAULTS).length
    }

    for (const [key, value] of Object.entries(values)) setSetting(key, value)
    return Object.keys(values).length
}

/**
 * Save the settings that currently differ from default as a named preset — the
 * way a hidden, world-specific baseline gets made.
 */
export function savePresetFromCurrent(id, label, description) {
    const presetId = String(id ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "")
    if (!presetId || presetId in BUILT_IN) return undefined

    const values = {}
    for (const key of Object.keys(DEFAULTS)) {
        const current = setting(key)
        if (current !== DEFAULTS[key].value) values[key] = current
    }

    const preset = {
        label: label || presetId,
        description: description || `Saved on this world · ${Object.keys(values).length} values`,
        values
    }
    saved.set(presetId, preset)
    return preset
}

export function deletePreset(id) {
    if (id in BUILT_IN) return false            // built-ins cannot be removed
    saved.delete(id)
    return true
}

export function isCustomPreset(id) { return !(id in BUILT_IN) }
