import { GameMode, CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { canActOn, onStaffLost } from "../core/ranks.js"
import { record } from "../core/logs.js"

// Gamemode, shaped the way people already type it.
//
//   /gm <mode> [player]   one command, tab-completed mode vocabulary
//   /gmc /gms /gma /gmsp  the muscle-memory shortcuts, each [player]-optional
//
// Every form defaults to "me" when no player is given, and every form accepts a
// player selector so tab-completion fills the full name.

const MODES = {
    c: GameMode.Creative, creative: GameMode.Creative,
    s: GameMode.Survival, survival: GameMode.Survival,
    a: GameMode.Adventure, adventure: GameMode.Adventure,
    sp: GameMode.Spectator, spec: GameMode.Spectator, spectator: GameMode.Spectator
}

const MODE_LABEL = {
    [GameMode.Creative]: "creative",
    [GameMode.Survival]: "survival",
    [GameMode.Adventure]: "adventure",
    [GameMode.Spectator]: "spectator"
}

const modeEnum = defineEnum("gamemode", Object.keys(MODES))

/** Apply a mode to a selector result, honouring rank protection. */
function applyMode(player, mode, selected) {
    const targets = selected?.length ? selected : [player]
    const changed = []
    const blocked = []
    const label = MODE_LABEL[mode] ?? String(mode)
    for (const target of targets) {
        if (target.id !== player.id && !canActOn(player, target)) { blocked.push(target.name); continue }
        try {
            target.setGameMode(mode)
            changed.push(target.name)
            // Logged HERE and not only in the panel. The command and the button
            // are the same act, and for a while only the button said so — which
            // meant the fastest way to change someone's mode unwatched was to
            // type it. Capitalised because the audit line is a sentence.
            record(player, "mod.gamemode", target, label[0].toUpperCase() + label.slice(1))
        } catch (e) {
            blocked.push(target.name)
        }
    }
    if (changed.length === 1 && changed[0] === player.name) ok(player, `You are now in §f${label}§a.`)
    else if (changed.length) ok(player, `Set §f${changed.join(", ")}§a to §f${label}§a.`)
    if (blocked.length) err(player, `Outranked you, skipped: §f${blocked.join(", ")}`)
    // Tell the people whose mode someone else changed.
    for (const target of targets) {
        if (target.id !== player.id && changed.includes(target.name)) {
            info(target, `${player.name} set your gamemode to §f${label}§7.`)
        }
    }
}

// `picker: false` on all five: `/gm creative @a` for a build event is real use,
// so these take typed text (`me`, `all`, `@a`, a name) instead of the list.
command({
    name: "gm",
    picker: false,
    description: "Set a gamemode — /gm <mode> [player]",
    perm: "admin.gamemode",
    mandatory: [{
        name: modeEnum, type: CustomCommandParamType.Enum,
        label: "Which gamemode?",
        choices: ["creative", "survival", "adventure", "spectator"]
    }],
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [mode, selected]) => {
        const resolved = MODES[String(mode).toLowerCase()]
        if (!resolved) return err(player, `Unknown gamemode "${mode}".`)
        applyMode(player, resolved, selected)
    }
})

for (const [name, mode] of [["gmc", GameMode.Creative], ["gms", GameMode.Survival], ["gma", GameMode.Adventure], ["gmsp", GameMode.Spectator]]) {
    command({
        name,
        picker: false,
        description: `Set ${MODE_LABEL[mode]} mode — /${name} [player]`,
        perm: "admin.gamemode",
        optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
        run: (player, [selected]) => applyMode(player, mode, selected)
    })
}

/**
 * A demoted staff member does not keep creative.
 *
 * **Nothing used to happen here at all.** Somebody in creative who lost their
 * staff rank stayed in creative for good, and could not put themselves back
 * either, because the demotion took `admin.gamemode` with it. The mode is
 * recoverable by staff; whatever they spawned in the meantime is not.
 *
 * Survival, not the world default, and deliberately: the two modes this moves
 * people out of are creative and spectator, and a world whose default is one of
 * those does not need this rule anyway.
 *
 * It fires on the TRANSITION out of staff, so an owner who deliberately leaves
 * somebody in creative is never overruled — they never stopped being staff.
 */
onStaffLost(player => {
    let mode
    try { mode = player.getGameMode?.() } catch { mode = undefined }
    if (mode !== GameMode.Creative && mode !== GameMode.Spectator) return
    try {
        player.setGameMode(GameMode.Survival)
        info(player, "§7You are no longer staff, so you have been put back into survival.")
    } catch { /* a runtime that will not let us; the demotion still stands */ }
})
