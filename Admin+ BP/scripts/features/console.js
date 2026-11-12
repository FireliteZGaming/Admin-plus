import { world } from "@minecraft/server"
import { modal } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err } from "../core/util.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { isCreator, isTeamDeveloper, isOwner } from "../core/ranks.js"
import { canUseCode } from "../core/devgate.js"
import { runPackCommand } from "../core/dispatch.js"
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
//   2. ADMIN+ COMMANDS ONLY (since 2.8.2). Each one checks the person's own
//      rank, so the console reaches nothing they could not have typed
//      themselves, and it runs no vanilla command at all, so it cannot /op.
//      Until 2.8.2 it fell through to vanilla here and promised to stay inside
//      the owner's whitelist, but that whitelist had stopped being checked, so
//      in practice it ran any vanilla command short of /op.
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
 * creator included. Then one of two quite different claims:
 *
 *   THE PACK'S TEAM — `[Admin+ Creator]` or `[Admin+ Dev]`. Recognised by
 *   gamertag from a list in the source, so it travels with the pack into any
 *   world. This is the part the badge rule is about, and the part the three
 *   fences above exist to bound.
 *
 *   THE WORLD'S OWN DEV — `canUseCode`: the Dev tag AND operator, the same gate
 *   `< Code >` sits behind. Both locks, not just the tag: a tag alone is
 *   something any staff member with /tag can hand out, and gating a command
 *   line on it would mean a moderator could quietly promote a member into one.
 *   With operator required this grants nothing — an op can already type any
 *   command — so it is a nicer door onto a room they were standing in.
 *
 * Identity, not badge display: the creator's badge hides itself the moment a
 * world gives them a real rank, and losing the console for accepting a rank
 * would be a very odd rule.
 */
export function canUseConsole(player) {
    if (!flag("creator.console")) return false
    if (isCreator(player) || isTeamDeveloper(player)) return true
    return canUseCode(player)
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
                "§8Admin+ commands by name — §fgm creative Steve§8, §fban Alex§8 — no §fa:§8 needed.",
                "§8Time and weather too: §fclock set day§8, §fsky clear§8. No other vanilla commands.",
                last ? `\n${last}` : ""
            ].join("\n"),
            placeholder: "gm creative @a",
            default: ""
        }
    ])
    if (!values) return back()

    const line = String(values.line ?? "").trim()
    if (!line) return consoleScreen(player, back, last)

    // The pack's OWN commands first. /gm, /tp, /ban and the rest are handlers
    // the engine calls with parsed arguments — not strings the dimension knows
    // — so runAsServer could never reach them, and the console could only ever
    // run vanilla. core/dispatch.js parses the line the way the engine would,
    // reusing the registry's typed parameter lists and the selector resolver.
    //
    // undefined means it was not one of ours. Each command still checks its
    // own perm, so this reaches exactly what the person could have typed.
    const pack = runPackCommand(player, line)
    if (pack) {
        if (!pack.ok) return consoleScreen(player, back, `§c✗ ${pack.reason}`)
        record(player, "creator.console", undefined, pack.command)
        for (const owner of onlineOwners()) {
            if (owner.id === player.id) continue
            owner.sendMessage(`§8[§bAdmin§d+§8] §7${displayName(player)} ran §f/${pack.command}§7 from the console.`)
        }
        return consoleScreen(player, back, `§a✓ /${pack.command}`)
    }

    // Not one of ours, and the console runs nothing else: see point 2 above.
    return consoleScreen(player, back, "§c✗ The console runs Admin+ commands only. §8Vanilla commands need operator.")
}
