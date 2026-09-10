import { setting, setSetting } from "./settings.js"

// The vanilla command set, as data. The screens live in features/opcommands.js.
//
// Split out of that file because core/ranks.js needs the same list to declare a
// permission node per command, and core importing from features would be the
// wrong way round.

/**
 * The commands this screen offers, and the deliberate gaps.
 *
 * Every Bedrock command at Game Directors level, minus the ones that would hand
 * the world over. The reasoning lives in core/settings.js beside the setting
 * itself and must not drift from this list:
 *
 *   op, deop                     the entire point of a whitelist
 *   execute, function,           WRAPPERS. Only the first word is checked, so
 *   scriptevent, schedule        each of these allows anything behind it
 *   kick                         removing somebody is this pack's job, not a
 *                                command anybody may type
 *   allowlist, permission,       dedicated-server and session administration
 *   reload, save, stop, ...
 */
export const OP_COMMANDS = Object.freeze([
    "aimassist", "camera", "camerashake", "clear", "clearspawnpoint", "clone",
    "controlscheme", "damage", "daylock", "dialogue", "difficulty", "effect",
    "enchant", "event", "fill", "fog", "gamemode", "gamerule", "give", "hud",
    "inputpermission", "kill", "locate", "loot", "mobevent", "music", "particle",
    "place", "playanimation", "playsound", "recipe", "replaceitem", "ride",
    "scoreboard", "setblock", "setworldspawn", "spawnpoint", "spreadplayers",
    "stopsound", "structure", "summon", "tag", "teleport", "tellraw", "testfor",
    "testforblock", "testforblocks", "tickingarea", "time", "title", "titleraw",
    "toggledownfall", "tp", "weather", "xp"
])

/** What is on right now, lowercased, in no particular order. */
export function allowedNow() {
    return String(setting("commands.allowed") ?? "")
        .split(",")
        .map(name => name.trim().toLowerCase())
        .filter(Boolean)
}

/**
 * Write a new set, keeping anything an owner typed in by hand.
 *
 * Somebody may have added a command this screen does not list — a custom one, or
 * a name added by a newer game version. Dropping it because it is not in our
 * array would be this screen quietly overruling a deliberate edit.
 */
export function writeAllowed(names) {
    const known = new Set(OP_COMMANDS)
    const custom = allowedNow().filter(name => !known.has(name))
    const wanted = [...new Set([...names].map(n => n.trim().toLowerCase()).filter(Boolean))]

    const ordered = OP_COMMANDS.filter(name => wanted.includes(name))
    setSetting("commands.allowed", [...ordered, ...custom].join(", "))
    return ordered.length + custom.length
}

/** The pages, each a slice of the list with a readable name. */
export function pages() {
    const out = []
    for (let start = 0; start < OP_COMMANDS.length; start += PER_PAGE) {
        const slice = OP_COMMANDS.slice(start, start + PER_PAGE)
        out.push({ label: `${slice[0]} – ${slice[slice.length - 1]}`, names: slice })
    }
    return out
}

