import { GameMode, CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { canActOn } from "../core/ranks.js"

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
    for (const target of targets) {
        if (target.id !== player.id && !canActOn(player, target)) { blocked.push(target.name); continue }
        try {
            target.setGameMode(mode)
            changed.push(target.name)
        } catch (e) {
            blocked.push(target.name)
        }
    }
    const label = MODE_LABEL[mode] ?? String(mode)
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

command({
    name: "gm",
    description: "Set a gamemode — /gm <mode> [player]",
    perm: "admin.gamemode",
    mandatory: [{ name: modeEnum, type: CustomCommandParamType.Enum }],
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
        description: `Set ${MODE_LABEL[mode]} mode — /${name} [player]`,
        perm: "admin.gamemode",
        optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
        run: (player, [selected]) => applyMode(player, mode, selected)
    })
}
