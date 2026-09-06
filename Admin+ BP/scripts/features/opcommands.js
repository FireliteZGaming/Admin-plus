import { menu, modal, confirm } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { setting, setSetting } from "../core/settings.js"
import { record } from "../core/logs.js"

// /admin ▸ Settings ▸ Op commands
//
// The vanilla command set, one switch each, instead of a comma-separated string
// somebody has to type without a typo. Same store either way — `commands.allowed`
// is still the single list that core/execute.js checks — this is just a door
// onto it that shows you what is actually on.
//
// EVERYTHING SHIPS OFF. A whitelist that arrives full is not a whitelist; it is
// a blocklist with extra steps. `/cmd` hands out operator-level power without
// operator, so turning any of it on should be a thing somebody did on purpose
// and can point at, which is what this screen is for.
//
// PAGED, and not for tidiness. Fifty-six toggles in one form is precisely the
// shape that broke the All values screen: answers pair to fields by index, and
// a response that comes back short leaves the tail reading as "off". Fourteen
// at a time is well inside anything the client has ever struggled with, and a
// page that did come back short can only cost that page.

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
    "place", "playanimation", "playsound", "recipe", "replaceitem", "ride", "say",
    "scoreboard", "setblock", "setworldspawn", "spawnpoint", "spreadplayers",
    "stopsound", "structure", "summon", "tag", "teleport", "tellraw", "testfor",
    "testforblock", "testforblocks", "tickingarea", "time", "title", "titleraw",
    "toggledownfall", "tp", "weather", "xp"
])

const PER_PAGE = 14

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

export async function opCommandsScreen(player, back) {
    const again = () => opCommandsScreen(player, back)
    const on = new Set(allowedNow())
    const live = OP_COMMANDS.filter(name => on.has(name)).length

    const buttons = pages().map(page => {
        const count = page.names.filter(name => on.has(name)).length
        return {
            text: hubEntry("settings", page.label,
                count ? `${count} of ${page.names.length} on` : "all off"),
            run: () => pageScreen(player, page, again)
        }
    })

    buttons.push({
        text: hubEntry("actions", "Turn every one off",
            "Back to shipped: nothing runs without op"),
        run: async () => {
            const yes = await confirm(player, hubTitle("settings", "Op commands"),
                "Turn off every vanilla command?\n\n§8/cmd and the /a: commands stop working for everyone who is not a real operator.",
                "§cTurn all off")
            if (!yes) return again()
            writeAllowed([])
            record(player, "config.edit", undefined, "op commands: all off")
            ok(player, "Every vanilla command is off.")
            return again()
        }
    })

    return menu(player, {
        title: hubTitle("settings", "Op commands"),
        body: [
            `§f${live}§7 of §f${OP_COMMANDS.length}§7 vanilla commands are on.`,
            "",
            "§8These run at operator level for anybody your ranks allow, without",
            "§8making them an operator. Everything is off until you turn it on.",
            live ? "" : "§8Nothing is on, so /cmd refuses everything."
        ].filter(Boolean).join("\n"),
        buttons,
        back
    })
}

async function pageScreen(player, page, back) {
    const on = new Set(allowedNow())
    const values = await modal(player, hubTitle("settings", page.label),
        page.names.map(name => ({
            id: name,
            type: "toggle",
            label: `§f/${name}`,
            default: on.has(name)
        })))
    if (!values) return back()

    // Only this page's commands are decided here; everything else keeps what it
    // had. And an unanswered toggle keeps its value rather than reading as off,
    // for the reason features/code.js spells out at length.
    const next = new Set(on)
    const changed = []
    for (const name of page.names) {
        const raw = values[name]
        if (raw === undefined) continue
        const want = !!raw
        if (want === on.has(name)) continue
        if (want) next.add(name); else next.delete(name)
        changed.push(`${want ? "§a+" : "§c-"}${name}`)
    }

    if (!changed.length) { info(player, "§7Nothing changed."); return back() }
    writeAllowed([...next])
    record(player, "config.edit", undefined, `op commands: ${changed.join(" ").replace(/§./g, "")}`)
    ok(player, `Updated: §r${changed.join("§a ")}§a.`)
    return back()
}
