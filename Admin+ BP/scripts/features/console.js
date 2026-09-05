import { world } from "@minecraft/server"
import { modal } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err } from "../core/util.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { isCreator, isOwner } from "../core/ranks.js"
import { inDeveloperMode } from "../core/devgate.js"
import { runAsServer } from "../core/execute.js"
import { record } from "../core/logs.js"

// The Creator & Dev console — a command line in /menu, for the pack's Creator
// and anyone the owner has tagged Dev.
//
// This is the ONE thing the creator badge carries beyond being a badge, and the
// design brief for it is a fence, not a feature: the creator getting authority
// inside somebody else's world is precisely the backdoor this pack's own rules
// forbid (see core/ranks.js). Three things keep it the right side of that line,
// and all three are load-bearing:
//
//   1. OPT-OUT, NOT HIDDEN. `creator.console` is a normal setting, on by
//      default, sitting in the config where any owner can see and close it.
//   2. THE OWNER'S OWN WHITELIST. It runs through runAsServer, which only runs
//      what `commands.allowed` permits — so it can do nothing the owner has not
//      already exposed to /cmd, and cannot /op, because op is never on the list.
//   3. WATCHED. Every command is written to the log and announced to online
//      owners, so it is a power an owner sees being used, not one that acts
//      unseen.
//
// A regular member never reaches it. That is the point, and it is the only part
// that must never soften.

/**
 * May this player open the console here?
 *
 * The setting first, so an owner who turns it off closes it for everyone,
 * creator included. Then identity: the pack's Creator, or somebody carrying the
 * Dev tag — which only an operator can have set on themselves, and which an
 * owner hands out deliberately.
 */
export function canUseConsole(player) {
    if (!flag("creator.console")) return false
    return isCreator(player) || inDeveloperMode(player)
}

/** Owners who are online, to be told what just ran. */
function onlineOwners() {
    return world.getAllPlayers().filter(p => isOwner(p))
}

/**
 * The console screen. Runs one command, shows the result, and re-opens itself
 * so it reads like a console rather than a one-shot box. Closing it leaves.
 *
 * `last` is the previous result, shown at the top — the output line a console
 * would print before the next prompt.
 */
export async function consoleScreen(player, back = () => {}, last = "") {
    // Re-checked on every entry, not just when the button was drawn: the owner
    // could turn the setting off, or strip the Dev tag, while this sits open.
    if (!canUseConsole(player)) { err(player, "The console is closed here."); return back() }

    const values = await modal(player, hubTitle("code", "Console"), [
        {
            id: "line",
            type: "text",
            label: [
                "§8Runs at operator level, from the server's seat.",
                "§8Only the world's allowed vanilla commands — the same list /cmd uses.",
                last ? `\n${last}` : ""
            ].join("\n"),
            placeholder: "kill @e[type=creeper]",
            default: ""
        }
    ])
    if (!values) return back()

    const line = String(values.line ?? "").trim()
    if (!line) return consoleScreen(player, back, last)

    const result = runAsServer(player, line)
    if (!result.ok) {
        // Re-open with the refusal shown, so a mistyped command does not eject
        // you from the console — that is what a real one does.
        return consoleScreen(player, back, `§c✗ ${result.reason}`)
    }

    // Logged and announced. record() is the audit trail; the owner message is
    // the live "someone is using this" the badge rule promises.
    record(player, "creator.console", undefined, result.command)
    for (const owner of onlineOwners()) {
        if (owner.id === player.id) continue
        owner.sendMessage(`§8[§bAdmin§d+§8] §7${displayName(player)} ran §f/${result.command}§7 from the console.`)
    }

    ok(player, `Ran §f/${result.command}§a.`)
    return consoleScreen(player, back, `§a✓ /${result.command}`)
}
