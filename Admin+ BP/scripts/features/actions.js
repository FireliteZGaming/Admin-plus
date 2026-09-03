import { world, GameMode } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, title, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err, info, formatDuration } from "../core/util.js"
import { primaryRank, playerRanks, canActOn, has, refreshNameTag, knownHolders, getRank, heldRankIds } from "../core/ranks.js"
import { invseeScreen } from "./invsee.js"
import { displayName, getNickname, setNickname, NICK_MAX } from "../core/identity.js"
import { renderTag } from "../core/settings.js"
import {
    kick, ban, mute, unmute, isMuted, isFrozen, setFrozen,
    tpaClosed, setTpaClosed, statusLine,
    banList, unban, isBanned, banRecord
} from "../core/moderation.js"
import { record } from "../core/logs.js"
import { warningLine, warningCount } from "../core/warnings.js"
import { warningsScreen } from "./warn.js"
import { forceVisible, isVanished } from "./vanish.js"
import { playerRankScreen } from "./ranksUI.js"
import { chatAvailable } from "./chat.js"

// /admin ▸ Actions
//
//   pick a player  ▸  everything you can do TO that player
//
// Display name sits at the top of that screen. Bedrock action forms cannot hold a
// text field inline, so the name is the first button and opens the text box —
// which is as close to "a box at the top" as the form API allows.

export async function actionsScreen(player, back) {
    const online = world.getAllPlayers()
    const onlineIds = new Set(online.map(p => p.id))
    // Online first in blue, then everyone Admin+ has seen, greyed and labelled.
    // Offline players stay actionable — ranks, unban and unmute all work on a
    // stored record, so logging off is not a way to dodge consequences.
    const offline = knownHolders().filter(h => !onlineIds.has(h.id))
    const rows = [
        ...online.map(p => ({ online: true, id: p.id, name: p.name, player: p })),
        ...offline.map(h => ({ online: false, id: h.id, name: h.name || "unknown" }))
    ]

    const banned = banList().length
    return pagedMenu(player, {
        title: hubTitle("actions", "Actions"),
        body: subtitle(`${online.length} online · ${offline.length} seen before.`),
        items: rows,
        render: row => {
            if (row.online) {
                const tag = renderTag(primaryRank(row.player))
                const self = row.id === player.id ? " §8(you)" : ""
                const nick = getNickname(row.player) ? " §8~" : ""
                return { text: `${tag ? tag + "§r " : ""}§9${displayName(row.player)}§r${nick}${self}` }
            }
            const rank = getRank(heldRankIds(row.id)[0])
            const flags = isBanned(row.id) ? " §cbanned" : ""
            return { text: `${rank ? rank.display + "§r " : ""}§8${row.name}${flags}\n§8offline` }
        },
        onPick: row => row.online
            ? playerActionsScreen(player, row.player, () => actionsScreen(player, back))
            : offlineActionsScreen(player, row, () => actionsScreen(player, back)),
        extra: has(player, "admin.ban")
            ? [{ text: `§cBanned players\n§8${banned} active`, run: () => bannedScreen(player, () => actionsScreen(player, back)) }]
            : [],
        back
    })
}

/** What you can still do to someone who is not here. */
async function offlineActionsScreen(player, row, back) {
    const allowed = canActOn(player, row.id)
    const again = () => offlineActionsScreen(player, row, back)
    const record = banRecord(row.id)
    const ranks = playerRanks(row.id).map(r => r.display).join("§7, ") || "§7none"

    return menu(player, {
        title: hubTitle("actions", row.name),
        body: [
            "§8offline",
            "",
            `§fRanks: §r${ranks}`,
            `§fStatus: §r${statusLine(row.id)}`,
            allowed ? "" : "\n§cThey outrank you — actions are disabled."
        ].join("\n"),
        buttons: [
            has(player, "ranks.grant")
                ? { text: "§bRanks\n§8Works while they are away", run: () => playerRankScreen(player, row.id, row.name, again) }
                : null,
            allowed && record && has(player, "admin.ban")
                ? { text: "§aUnban", run: () => unbanScreen(player, row.id, row.name, again) }
                : null,
            allowed && isMuted(row.id) && has(player, "admin.mute")
                ? { text: "§aUnmute", run: () => { unmute(row.id); ok(player, `Unmuted §f${row.name}§a.`); return again() } }
                : null
        ].filter(Boolean),
        back
    })
}

/** The ban list — the way back out of a ban. */
async function bannedScreen(player, back) {
    const bans = banList()
    if (!bans.length) { info(player, "Nobody is banned."); return back() }

    return pagedMenu(player, {
        title: hubTitle("actions", "Banned players"),
        body: subtitle(`${bans.length} active ban${bans.length === 1 ? "" : "s"}.`),
        items: bans,
        render: record => ({
            text: `§c${record.name || "unknown"}§r\n§8${record.reason} · ${record.until ? formatDuration(record.until - Date.now()) + " left" : "permanent"} · by ${record.by}`
        }),
        onPick: record => unbanScreen(player, record.id, record.name, () => bannedScreen(player, back)),
        back
    })
}

async function unbanScreen(player, targetId, targetName, back) {
    // NB: the local is `banned`, not `record` — `record` is the log function
    // imported at the top, and shadowing it here would break the audit entry.
    const banned = banRecord(targetId)
    if (!banned) { info(player, "That ban has already gone."); return back() }
    const yes = await confirm(player, hubTitle("actions", "Unban"),
        `Unban §f${targetName}§r?\n\n§7Reason was: ${banned.reason}\n§7Banned by: ${banned.by}`,
        "§aUnban")
    if (!yes) return back()
    unban(targetId)
    record(player, "mod.unban", { id: targetId, name: targetName }, `was: ${banned.reason}`)
    ok(player, `Unbanned §f${targetName}§a.`)
    return back()
}

/**
 * Open the right Actions screen for a player id, whether or not they are online.
 * Reports uses this so "Take action" lands on the same screen as everywhere else
 * rather than a second copy that drifts.
 */
export function openActionsFor(player, targetId, targetName, back) {
    const online = world.getAllPlayers().find(p => p.id === targetId)
    if (online) return playerActionsScreen(player, online, back)
    return offlineActionsScreen(player, { id: targetId, name: targetName, online: false }, back)
}

async function playerActionsScreen(player, target, back) {
    const nick = getNickname(target)
    const allowed = canActOn(player, target)
    const again = () => playerActionsScreen(player, target, back)
    const ranks = playerRanks(target).map(r => r.display).join("§7, ") || "§7none"

    const body = [
        `${renderTag(primaryRank(target))}§r ${displayName(target)}`,
        nick ? `§8account name: ${target.name}` : "§8no nickname set",
        "",
        `§fRanks: §r${ranks}`,
        `§fGamemode: §7${gameModeOf(target)}`,
        `§fWarnings: ${warningLine(target)}`,
        `§fStatus: §r${statusLine(target)}`,
        allowed ? "" : "\n§cThey outrank you — actions are disabled."
    ].join("\n")

    return menu(player, {
        title: title(displayName(target)),
        body,
        buttons: [
            // Display name first: it is the thing you are most often here to change.
            allowed && has(player, "admin.nickname")
                ? { text: `§bDisplay name\n§8${nick ? nick + "§8 — tap to edit or clear" : "using their account name"}`, run: () => nicknameScreen(player, target, again) }
                : null,
            has(player, "ranks.grant")
                ? { text: "§bRanks\n§8Add, remove, reorder their tags", run: () => playerRankScreen(player, target.id, target.name, again) }
                : null,
            allowed && has(player, "admin.gamemode")
                ? { text: "§bGamemode", run: () => gamemodeScreen(player, target, again) }
                : null,
            has(player, "admin.tp")
                ? { text: "§bTeleport", run: () => teleportScreen(player, target, again) }
                : null,
            // Looking is not an action against them, so this one is not gated on
            // the hierarchy — the screen itself refuses to let you TAKE from
            // somebody above you.
            has(player, "admin.invsee")
                ? { text: "§bInventory §8· see what they are carrying", run: () => invseeScreen(player, target, again) }
                : null,
            // forceVisible has always existed and its own comment said the
            // Actions screen used it. Nothing did — so a vanished player was
            // only reachable by typing /vanish at them, from a screen that
            // could not even tell you they were hidden.
            allowed && has(player, "admin.vanish") && isVanished(target)
                ? {
                    text: "§bMake visible §8· they are vanished",
                    run: () => {
                        forceVisible(player, target)
                        ok(player, `${displayName(target)} is visible again.`)
                        info(target, "§7Staff pulled you out of vanish.")
                        return again()
                    }
                }
                : null,
            has(player, "admin.warn") || warningCount(target)
                ? {
                    text: `§eWarnings §8· ${warningCount(target)} on record`,
                    run: () => warningsScreen(player, target, again)
                }
                : null,
            allowed && has(player, "admin.freeze")
                ? {
                    text: isFrozen(target) ? "§b❄ Unfreeze" : "§b❄ Freeze §8· lock movement",
                    run: () => {
                        const was = isFrozen(target)
                        const frozen = setFrozen(target, !was)
                        record(player, frozen ? "mod.freeze" : "mod.unfreeze", target,
                            frozen ? "movement locked" : "released", { kind: "freeze", frozen: was })
                        ok(player, `${displayName(target)} is now §f${frozen ? "frozen" : "unfrozen"}§a.`)
                        info(target, frozen ? "§cYou have been frozen by staff." : "§aYou can move again.")
                        return again()
                    }
                }
                : null,
            allowed && has(player, "admin.tpatoggle")
                ? {
                    text: tpaClosed(target) ? "§bOpen their TPA" : "§bClose their TPA §8· block requests",
                    run: () => {
                        const was = tpaClosed(target)
                        const closed = setTpaClosed(target, !was)
                        record(player, closed ? "mod.tpaClose" : "mod.tpaOpen", target,
                            closed ? "requests blocked" : "requests allowed", { kind: "tpa", closed: was })
                        ok(player, `TPA requests to ${displayName(target)} are now §f${closed ? "blocked" : "allowed"}§a.`)
                        return again()
                    }
                }
                : null,
            allowed && has(player, "admin.mute")
                ? {
                    text: isMuted(target) ? "§eUnmute" : "§eMute",
                    run: () => isMuted(target)
                        ? (unmute(target.id), record(player, "mod.unmute", target, "lifted"), ok(player, `Unmuted §f${displayName(target)}§a.`), info(target, "§aYou can speak again."), again())
                        : durationScreen(player, target, "mute", again)
                }
                : null,
            allowed && has(player, "admin.kick")
                ? { text: "§6Kick", run: () => reasonScreen(player, target, "kick", back) }
                : null,
            allowed && has(player, "admin.ban")
                ? { text: "§cBan", run: () => durationScreen(player, target, "ban", back) }
                : null
        ].filter(Boolean),
        back
    })
}

// ---------------------------------------------------------------- moderation

const DURATIONS = [
    ["30 minutes", 30 * 6e4],
    ["1 hour", 36e5],
    ["1 day", 864e5],
    ["7 days", 7 * 864e5],
    ["30 days", 30 * 864e5],
    ["Permanent", 0]
]

async function durationScreen(player, target, action, back) {
    return menu(player, {
        title: title(`${action === "ban" ? "Ban" : "Mute"} · ${displayName(target)}`),
        body: subtitle("How long?"),
        buttons: DURATIONS.map(([label, ms]) => ({
            text: ms === 0 ? `§c${label}` : label,
            run: () => reasonScreen(player, target, action, back, ms)
        })),
        back
    })
}

async function reasonScreen(player, target, action, back, durationMs = 0) {
    const label = action === "ban" ? "Ban" : action === "mute" ? "Mute" : "Kick"
    const values = await modal(player, title(`${label} · ${displayName(target)}`), [
        { id: "reason", type: "text", label: "Reason §7(shown to them)", placeholder: "Griefing", default: "" }
    ])
    if (!values) return back()
    const reason = String(values.reason ?? "").trim() || "No reason given"

    if (action === "kick") {
        const confirmed = await confirm(player, title("Kick"), `Kick §f${displayName(target)}§r?\n\n§7Reason: ${reason}`, "§6Kick")
        if (!confirmed) return back()
        kick(target, reason)
        record(player, "mod.kick", target, reason)
        ok(player, `Kicked §f${target.name}§a.`)
        return back()
    }

    if (action === "mute") {
        mute(target, durationMs, reason, player)
        record(player, "mod.mute", target,
            `${reason} · ${durationMs ? formatDuration(durationMs) : "permanent"}`, { kind: "mute" })
        ok(player, `Muted §f${displayName(target)}§a for §f${durationMs ? formatDuration(durationMs) : "ever"}§a.`)
        info(target, `§cYou were muted: ${reason}`)
        // Mutes are enforced inside the chat event, which is beta-only. Saying so
        // beats a mute that looks applied but lets them keep talking.
        if (!chatAvailable()) {
            info(player, "§7Heads up: chat interception needs beta APIs, so this mute is recorded but NOT enforced on this runtime.")
        }
        return back()
    }

    const confirmed = await confirm(player, title("Ban"),
        `Ban §f${displayName(target)}§r?\n\n§7Reason: ${reason}\n§7Length: ${durationMs ? formatDuration(durationMs) : "permanent"}`,
        "§cBan")
    if (!confirmed) return back()
    ban(target, durationMs, reason, player)
    record(player, "mod.ban", target,
        `${reason} · ${durationMs ? formatDuration(durationMs) : "permanent"}`, { kind: "ban" })
    ok(player, `Banned §f${target.name}§a (${durationMs ? formatDuration(durationMs) : "permanent"}).`)
    return back()
}

function gameModeOf(target) {
    try { return target.getGameMode?.() ?? "unknown" } catch { return "unknown" }
}

// --------------------------------------------------------------- display name

export async function nicknameScreen(player, target, back) {
    const current = getNickname(target) ?? ""
    const values = await modal(player, title(`Display name · ${target.name}`), [
        {
            id: "nick",
            type: "text",
            label: `Display name §7(max ${NICK_MAX} chars, §§ colours allowed)\n§8Clear the box to fall back to their account name.`,
            placeholder: target.name,
            default: current
        }
    ])
    if (!values) return back()

    const wanted = String(values.nick ?? "")
    if (wanted.trim().length > NICK_MAX) {
        err(player, `Display names cap at ${NICK_MAX} characters.`)
        return back()
    }

    const previous = getNickname(target)
    const applied = setNickname(target, wanted)
    refreshNameTag(target)
    record(player, applied ? "name.set" : "name.clear", target,
        applied ? applied : "back to account name", { kind: "nickname", previous })

    if (!applied) {
        ok(player, `Cleared §f${target.name}§a's display name.`)
        info(target, "Your display name was reset to your account name.")
    } else {
        ok(player, `§f${target.name}§a now shows as ${applied}§a.`)
        info(target, `Your display name is now ${applied}§7.`)
    }
    return back()
}

// ------------------------------------------------------------------ gamemode

const MODES = [
    ["Survival", GameMode.Survival],
    ["Creative", GameMode.Creative],
    ["Adventure", GameMode.Adventure],
    ["Spectator", GameMode.Spectator]
]

async function gamemodeScreen(player, target, back) {
    return menu(player, {
        title: title(`Gamemode · ${displayName(target)}`),
        body: subtitle(`Currently ${gameModeOf(target)}.`),
        buttons: MODES.map(([label, mode]) => ({
            text: label,
            run: () => {
                try {
                    target.setGameMode(mode)
                    record(player, "mod.gamemode", target, label)
                    ok(player, `${displayName(target)} → §f${label.toLowerCase()}§a.`)
                    if (target.id !== player.id) info(target, `${player.name} set your gamemode to §f${label.toLowerCase()}§7.`)
                } catch (e) {
                    err(player, `Couldn't set gamemode: ${e}`)
                }
                return back()
            }
        })),
        back
    })
}

// ------------------------------------------------------------------ teleport

async function teleportScreen(player, target, back) {
    return menu(player, {
        title: title(`Teleport · ${displayName(target)}`),
        body: subtitle("Where should the teleport go?"),
        buttons: [
            {
                text: "§bGo to them",
                run: () => {
                    player.teleport(target.location, { dimension: target.dimension })
                    // Logged but not announced — see the SILENT list in
                    // core/audit.js. Walking to someone is not done TO them.
                    record(player, "mod.tpTo", target, "went to them")
                    ok(player, `Teleported to §f${displayName(target)}§a.`)
                    return back()
                }
            },
            canActOn(player, target) ? {
                text: "§bBring them here",
                run: () => {
                    target.teleport(player.location, { dimension: player.dimension })
                    record(player, "mod.bring", target, "pulled to the staff member")
                    ok(player, `Brought §f${displayName(target)}§a to you.`)
                    info(target, `${player.name} teleported you to them.`)
                    return back()
                }
            } : null
        ].filter(Boolean),
        back
    })
}
