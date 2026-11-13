import { world, GameMode } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, COLOUR_CODE_TIP } from "../core/theme.js"
import { nameTakenBy } from "../core/names.js"
import { sameLetters } from "../core/audit.js"
import { ok, err, info, formatDuration } from "../core/util.js"
import { primaryRank, playerRanks, canActOn, canSeeActionsOf, has, refreshNameTag, knownHolders, getRank, heldRankIds, renderTags, nameFontFor, badgedTags } from "../core/ranks.js"
import { invseeScreen } from "./invsee.js"
import { displayName, getNickname, setNickname, NICK_MAX, getNameFont, setNameFont } from "../core/identity.js"
import { FONT_IDS, FONTS, fontOptions } from "../core/fonts.js"
import { flag } from "../core/settings.js"
import {
    kick, ban, mute, unmute, isMuted, hasMuteTag, isFrozen, setFrozen,
    tpaClosed, setTpaClosed, statusLine,
    banList, unban, isBanned, banRecord,
    BAN_REASONS, banSliderMax, banLengthMs, banLengthLabel, PERMANENT_NOTCH
} from "../core/moderation.js"
import { record } from "../core/logs.js"
import { warningLine, warningCount } from "../core/warnings.js"
import { warningsScreen } from "./warn.js"
import { forceVisible, isVanished } from "./vanish.js"
import { playerRankScreen, rankNames } from "./ranksUI.js"
import { chatAvailable } from "./chat.js"
import { matches, relevance } from "../core/ask.js"

// /admin ▸ Actions
//
//   pick a player  ▸  everything you can do TO that player
//
// Display name sits at the top of that screen. Bedrock action forms cannot hold a
// text field inline, so the name is the first button and opens the text box —
// which is as close to "a box at the top" as the form API allows.

// matches() and relevance() order and filter every player list in the pack,
// so they live with the shared pick list in core/ask.js.
export { matches, relevance }

export async function actionsScreen(player, back, filter = "") {
    const online = world.getAllPlayers()
    const onlineIds = new Set(online.map(p => p.id))
    // Online first in blue, then everyone Admin+ has seen, greyed and labelled.
    // Offline players stay actionable — ranks, unban and unmute all work on a
    // stored record, so logging off is not a way to dodge consequences.
    const offline = knownHolders().filter(h => !onlineIds.has(h.id))
    const needle = String(filter ?? "").trim().toLowerCase()
    const rows = relevance(player, [
        ...online.map(p => ({ online: true, id: p.id, name: p.name, player: p })),
        ...offline.map(h => ({ online: false, id: h.id, name: h.name || "unknown" }))
    ]).filter(row => matches(row, needle))

    const again = () => actionsScreen(player, back, filter)
    const banned = banList().length
    return pagedMenu(player, {
        title: hubTitle("actions", "Players"),
        body: needle
            ? subtitle(`${rows.length} match${rows.length === 1 ? "" : "es"} for "§f${filter}§7".`)
            : subtitle(`${online.length} online · ${offline.length} seen before.`),
        items: rows,
        render: row => {
            if (row.online) {
                const tag = badgedTags(row.player)
                const self = row.id === player.id ? " §8(you)" : ""
                const nick = getNickname(row.player) ? " §8~" : ""
                return { text: `${tag ? tag + "§r " : ""}§9${displayName(row.player)}§r${nick}${self}` }
            }
            const rank = getRank(heldRankIds(row.id)[0])
            const flags = isBanned(row.id) ? " §cbanned" : ""
            return { text: `${rank ? rank.display + "§r " : ""}§8${row.name}${flags}\n§8offline` }
        },
        onPick: row => row.online
            ? playerActionsScreen(player, row.player, again)
            : offlineActionsScreen(player, row, again),
        extra: [
            // A form cannot hold a text field beside a button list — the same
            // Bedrock limit that puts the nickname box behind a button on the
            // screen below. So search is a button that opens one, which is the
            // pattern the Logs screen already uses.
            needle
                ? { text: `§8Clear search §7"${filter}"`, run: () => actionsScreen(player, back, "") }
                : { text: "§8Search§r\n§8Find a player by gamertag or display name", run: () => searchScreen(player, back) },
            ...(has(player, "admin.ban")
                ? [{ text: `§cBanned players\n§8${banned} active`, run: () => bannedScreen(player, again) }]
                : [])
        ],
        back
    })
}

/**
 * Ask for the text, then show the list filtered by it.
 *
 * Live filtering as each letter is typed was asked for and is not buildable:
 * the script API has no keystroke event, and no form type carries a text input
 * and a button list at the same time. A resource-pack route exists in theory —
 * JSON-UI has the substring test this pack already relies on for `< Code >` —
 * but nothing shows that a typed value can escape its own collection index,
 * which is what per-button filtering would need. Submit-then-filter is the
 * whole of what the API supports, and with the list ordered by relevance it is
 * rarely reached at all.
 */
async function searchScreen(player, back) {
    const values = await modal(player, hubTitle("actions", "Search players"), [
        { id: "text", type: "text", label: "Gamertag or display name", placeholder: "part of a name" }
    ])
    if (!values) return actionsScreen(player, back)
    return actionsScreen(player, back, String(values.text ?? "").trim())
}

/** What you can still do to someone who is not here. */
async function offlineActionsScreen(player, row, back) {
    const allowed = canActOn(player, row.id)
    const again = () => offlineActionsScreen(player, row, back)
    const record = banRecord(row.id)
    const ranks = rankNames(playerRanks(row.id))

    return menu(player, {
        title: hubTitle("actions", row.name),
        body: [
            "§8offline",
            "",
            `§fRanks: §r${ranks}`,
            `§fStatus: §r${statusLine(row.id)}`,
            allowed ? "" : "\n§cThey outrank you, so only teleporting and unmuting work."
        ].join("\n"),
        buttons: [
            has(player, "ranks.grant")
                ? { text: "§bRanks\n§8Works even when they're offline", run: () => playerRankScreen(player, row.id, row.name, again) }
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
    if (!banned) { info(player, "That ban no longer exists."); return back() }
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
    const ranks = rankNames(playerRanks(target))

    const body = [
        `${badgedTags(target)}§r ${displayName(target)}`,
        nick ? `§8gamertag: ${target.name}` : "§8no display name set",
        "",
        `§fRanks: §r${ranks}`,
        `§fGamemode: §7${gameModeOf(target)}`,
        `§fWarnings: ${warningLine(target)}`,
        `§fStatus: §r${statusLine(target)}`,
        allowed ? "" : "\n§cThey outrank you, so only teleporting and unmuting work."
    ].join("\n")

    const actions = actionButtons(player, target, () => playerActionsMenu(player, target, again, back), back)
    return menu(player, {
        title: hubTitle("actions", displayName(target)),
        body,
        buttons: [
            // Basics first: how they look and what ranks they have, the
            // things most often changed. One door for both, as asked for on
            // 2026-11-11: "you can either choose Display or Rank".
            (allowed && has(player, "admin.nickname")) || has(player, "ranks.grant")
                ? { text: "§bBasics\n§8Display name, font and ranks", run: () => basicsMenu(player, target, again) }
                : null,
            // Everything you DO to them, behind one door, asked for on
            // 2026-11-12: "teleport, gamemode, kick, and ban should be under
            // Actions". The button lists what this viewer will find inside.
            actions.length
                ? { text: `§cActions\n§8${actions.map(a => a.word).join(", ")}`, run: () => playerActionsMenu(player, target, again, back) }
                : null,
            // Looking is not an action against them, so this one is not gated on
            // the hierarchy — the screen itself refuses to let you TAKE from
            // somebody above you.
            has(player, "admin.invsee")
                ? { text: "§bInventory §8· see what they are carrying", run: () => invseeScreen(player, target, again) }
                : null,
            // A disciplinary record is about the person. Reading one belonging
            // to somebody ABOVE you is the same leak the staff notices had, so
            // it takes canSeeActionsOf — the SEEING rule, equal-or-below —
            // rather than canActOn, which would also shut out your peers.
            (has(player, "admin.warn") || warningCount(target)) && canSeeActionsOf(player, target)
                ? {
                    text: `§eWarnings §8· ${warningCount(target)} on record`,
                    run: () => warningsScreen(player, target, again)
                }
                : null
        ].filter(Boolean),
        back
    })
}

/**
 * Players ▸ a player ▸ Actions: everything you can do to them, mildest first.
 * `playerBack` returns to their screen. Kick and Ban return to `listBack`,
 * the screen before theirs, because after either one they are gone.
 */
export async function playerActionsMenu(player, target, playerBack, listBack) {
    const again = () => playerActionsMenu(player, target, playerBack, listBack)
    const allowed = canActOn(player, target)
    return menu(player, {
        title: hubTitle("actions", `Actions · ${displayName(target)}`),
        body: [
            `§fGamemode: §7${gameModeOf(target)}`,
            `§fStatus: §r${statusLine(target)}`,
            allowed ? "" : "\n§cThey outrank you, so only teleporting and unmuting work."
        ].filter(Boolean).join("\n"),
        buttons: actionButtons(player, target, again, listBack),
        back: playerBack
    })
}

/**
 * What this viewer may do to this player, as buttons, each with a `word` for
 * the Actions button's list. `again` reopens the Actions menu; `listBack` is
 * where Kick and Ban go afterwards.
 */
function actionButtons(player, target, again, listBack) {
    const allowed = canActOn(player, target)
    const muted = isMuted(target) || hasMuteTag(target)
    return [
        has(player, "admin.tp")
            ? { word: "teleport", text: "§bTeleport", run: () => teleportScreen(player, target, again) }
            : null,
        allowed && has(player, "admin.gamemode")
            ? { word: "gamemode", text: "§bGamemode", run: () => gamemodeScreen(player, target, again) }
            : null,
        // forceVisible has always existed and its own comment said the
        // Actions screen used it. Nothing did — so a vanished player was
        // only reachable by typing /vanish at them, from a screen that
        // could not even tell you they were hidden.
        allowed && has(player, "admin.vanish") && isVanished(target)
            ? {
                word: "make visible",
                text: "§bMake visible §8· they are vanished",
                run: () => {
                    forceVisible(player, target)
                    ok(player, `${displayName(target)} is visible again.`)
                    info(target, "§7Staff made you visible again.")
                    return again()
                }
            }
            : null,
        allowed && has(player, "admin.freeze")
            ? {
                word: isFrozen(target) ? "unfreeze" : "freeze",
                text: isFrozen(target) ? "§b❄ Unfreeze" : "§b❄ Freeze §8· stop them moving",
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
                word: "TPA",
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
        // Muting needs `allowed` (the rank check); UNMUTING does not, and
        // that split is the whole point. See the long note in
        // features/modcommands.js on /unmute: lifting a mute is
        // restorative, and gating it by rank meant a `/mute @a` left every
        // peer silenced with nobody able to undo it for them. Muting stays
        // ranked so a junior still cannot silence a senior.
        //
        // EITHER half counts as muted, for the label and for what the button
        // does. With only `isMuted`, a player carrying a leftover mute tag
        // and no record was offered "Mute", so somebody trying to free
        // themselves muted themselves instead. That was the reported symptom.
        has(player, "admin.mute") && (allowed || muted)
            ? {
                word: muted ? "unmute" : "mute",
                text: muted ? "§eUnmute" : "§eMute",
                run: () => muted
                    ? (unmute(target), record(player, "mod.unmute", target, "lifted"), ok(player, `Unmuted §f${displayName(target)}§a.`), info(target, "§aYou can talk again."), again())
                    : durationScreen(player, target, "mute", again)
            }
            : null,
        allowed && has(player, "admin.kick")
            ? { word: "kick", text: "§6Kick", run: () => reasonScreen(player, target, "kick", listBack) }
            : null,
        allowed && has(player, "admin.ban")
            ? { word: "ban", text: "§cBan", run: () => banScreen(player, target, listBack) }
            : null
    ].filter(Boolean)
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

// Mutes still pick from a list of preset lengths. A mute is cheap and easily
// lifted, so the extra screen costs less than it does on a ban — and the useful
// mute lengths (30 minutes, an hour) are shorter than a day-slider can express.
async function durationScreen(player, target, action, back) {
    return menu(player, {
        title: hubTitle("actions", `Mute · ${displayName(target)}`),
        body: subtitle("How long?"),
        buttons: DURATIONS.map(([label, ms]) => ({
            text: ms === 0 ? `§c${label}` : label,
            run: () => reasonScreen(player, target, action, back, ms)
        })),
        back
    })
}

/**
 * The ban screen. One form: why, what happened, how long.
 *
 * Bans used to take two screens — a menu of six preset lengths, then a box for
 * the reason. This is one, and the length is a slider whose last notch is
 * permanent (see banLengthMs in core/moderation.js for why it is one control
 * and not two).
 *
 * The field ORDER is load-bearing. `modal()` maps answers back by index, so
 * these three entries and the three reads below have to stay in step; a label
 * or divider slipped in between would silently shift every value one place.
 */
export async function banScreen(player, target, back) {
    if (!has(player, "admin.ban")) return err(player, "Your rank can't ban.")
    if (!canActOn(player, target)) {
        return err(player, `${displayName(target)}§c outranks you.`)
    }
    if (isBanned(target)) {
        info(player, `${displayName(target)}§7 is already banned.`)
        return back()
    }

    // Two gates, and they answer different questions. The setting is the
    // WORLD's policy — does this place hand out forever at all. The node is
    // whether THIS person may. A Mod can ban for a week on a world that allows
    // permanent bans; the last notch simply is not on their slider.
    const worldAllows = flag("ban.allowPermanent")
    const mayBanForever = has(player, "admin.banperm")
    const permanent = worldAllows && mayBanForever
    const max = banSliderMax(permanent)

    const values = await modal(player, hubTitle("actions", `Ban · ${displayName(target)}`), [
        {
            id: "reason",
            type: "dropdown",
            label: "Reason",
            options: BAN_REASONS,
            default: 0
        },
        {
            id: "detail",
            type: "text",
            label: "What happened §7(required if you picked Other)",
            placeholder: "They tore up spawn",
            default: ""
        },
        {
            id: "length",
            type: "slider",
            // A Bedrock slider draws the number and nothing else, so the notch
            // that means "permanent" has to be named up here or not at all.
            label: permanent
                ? `Days §7(${PERMANENT_NOTCH} = permanent)`
                : worldAllows
                    ? "Days §7(you can't ban permanently)"
                    : "Days §7(permanent bans are switched off here)",
            min: 1,
            max,
            step: 1,
            default: 1
        }
    ])
    if (!values) return back()

    const picked = BAN_REASONS[values.reason ?? 0] ?? "Other"
    const detail = String(values.detail ?? "").trim()
    if (picked === "Other" && !detail) {
        err(player, "Say what they did.")
        return banScreen(player, target, back)
    }
    const reason = picked === "Other" ? detail : (detail ? `${picked}: ${detail}` : picked)

    const notch = values.length ?? 1
    const durationMs = banLengthMs(notch, permanent)
    const length = banLengthLabel(notch, permanent)

    const confirmed = await confirm(player, hubTitle("actions", "Ban"),
        `Ban §f${displayName(target)}§r?\n\n§7Reason: ${reason}\n§7Length: ${length}`,
        "§cBan")
    if (!confirmed) return back()

    await ban(target, durationMs, reason, player)
    record(player, "mod.ban", target, `${reason} · ${length}`, { kind: "ban" })
    ok(player, `Banned §f${target.name}§a (${length}).`)
    return back()
}

async function reasonScreen(player, target, action, back, durationMs = 0) {
    const label = action === "ban" ? "Ban" : action === "mute" ? "Mute" : "Kick"
    const values = await modal(player, hubTitle("actions", `${label} · ${displayName(target)}`), [
        { id: "reason", type: "text", label: "Reason §7(shown to them)", placeholder: "Griefing", default: "" }
    ])
    if (!values) return back()
    const reason = String(values.reason ?? "").trim() || "No reason given"

    if (action === "kick") {
        const confirmed = await confirm(player, hubTitle("actions", "Kick"), `Kick §f${displayName(target)}§r?\n\n§7Reason: ${reason}`, "§6Kick")
        if (!confirmed) return back()
        await kick(target, reason)
        record(player, "mod.kick", target, reason)
        ok(player, `Kicked §f${target.name}§a.`)
        return back()
    }

    if (action === "mute") {
        mute(target, durationMs, reason, player)
        record(player, "mod.mute", target,
            `${reason} · ${durationMs ? formatDuration(durationMs) : "permanent"}`, { kind: "mute" })
        ok(player, `Muted §f${displayName(target)}§a ${durationMs ? `for §f${formatDuration(durationMs)}§a` : "§fpermanently§a"}.`)
        info(target, `§cYou were muted: ${reason}`)
        // Mutes are enforced inside the chat event, which is beta-only. Saying so
        // beats a mute that looks applied but lets them keep talking.
        if (!chatAvailable()) {
            info(player, "§7This mute is saved, but it can't block chat until Beta APIs are turned on in this world's settings.")
        }
        return back()
    }

    // Bans do not come through here — they have their own single screen, with
    // the slider. See banScreen above.
    return back()
}

function gameModeOf(target) {
    try { return target.getGameMode?.() ?? "unknown" } catch { return "unknown" }
}

// --------------------------------------------------------------------- basics

/**
 * Basics: how a player looks and what ranks they have. Two doors, Display and
 * Ranks, with what each one holds now written above them.
 */
export async function basicsMenu(player, target, back) {
    const again = () => basicsMenu(player, target, back)
    const nick = getNickname(target)
    const own = getNameFont(target)
    const shown = nameFontFor(target)
    const font = shown !== own
        ? `${FONTS[own]?.label ?? "Normal"} §8(their rank gives ${FONTS[shown]?.label ?? shown})`
        : (FONTS[own]?.label ?? "Normal")
    return menu(player, {
        title: hubTitle("actions", `Basics · ${target.name}`),
        body: [
            `§fDisplay name: §r${nick ? `${nick}§r` : "§7their gamertag"}`,
            `§fFont: §7${font}`,
            `§fRanks: §r${rankNames(playerRanks(target))}`
        ].join("\n"),
        buttons: [
            canActOn(player, target) && has(player, "admin.nickname")
                ? { text: "§bDisplay\n§8Display name and font", run: () => nicknameScreen(player, target, again) }
                : null,
            has(player, "ranks.grant")
                ? { text: "§bRanks\n§8Give, take away, change the tag order", run: () => playerRankScreen(player, target.id, target.name, again) }
                : null
        ],
        back
    })
}

/**
 * Display: their display name and their font, in one form.
 *
 * The name box starts with the name they show now, § codes and all, so
 * changing it is editing rather than retyping. Colour is typed into the name,
 * the way players already do it; there is no colour list. Font is a list,
 * because look-alike letters are not something anybody can type.
 *
 * Their gamertag, typed plain, or an empty box means no display name.
 */
export async function nicknameScreen(player, target, back) {
    // Bare /nick opens this with nowhere to go back to.
    const done = () => back?.()
    const current = getNickname(target) ?? target.name
    const fontAt = Math.max(0, FONT_IDS.indexOf(getNameFont(target)))
    const values = await modal(player, hubTitle("actions", `Display · ${target.name}`), [
        {
            id: "nick",
            type: "text",
            label: [
                `Display name §8(up to ${NICK_MAX} characters, codes count)`,
                "§8Colour codes work, the same as in rank names. The ! shows how to type one.",
                "§8Their gamertag or an empty box means no display name."
            ].join("\n"),
            placeholder: target.name,
            tooltip: COLOUR_CODE_TIP,
            default: current
        },
        {
            id: "font",
            type: "dropdown",
            label: "Font\n§8Their name in chat and above their head. On Normal, a rank's name font can show instead.",
            options: fontOptions(),
            default: fontAt
        }
    ])
    if (!values) return done()

    const wanted = String(values.nick ?? "").trim()
    if (wanted.length > NICK_MAX) {
        err(player, `A display name can have at most ${NICK_MAX} characters, codes included.`)
        return done()
    }
    // Their own gamertag with no codes is the same as no display name.
    const plainGamertag = wanted === target.name
    // Nobody gets a display name another player already goes by.
    const taken = wanted && !plainGamertag ? nameTakenBy(target.id, wanted) : undefined
    if (taken) {
        err(player, `§f${taken}§c already goes by that name. Pick a different one.`)
        return done()
    }

    const previous = getNickname(target)
    const applied = setNickname(target, plainGamertag ? "" : wanted)
    const fontBefore = getNameFont(target)
    const font = FONT_IDS[values.font] ?? "normal"
    setNameFont(target, font)
    refreshNameTag(target)

    const nameChanged = (applied ?? "") !== (previous ?? "")
    const fontChanged = font !== fontBefore
    if (nameChanged) {
        record(player, applied ? "name.set" : "name.clear", target,
            applied ? applied : "back to gamertag", { kind: "nickname", previous })
    }
    if (!nameChanged && !fontChanged) {
        info(player, "Nothing changed.")
        return done()
    }

    const what = [
        nameChanged ? (applied ? `${sameLetters(target.name, applied) ? "now looks like" : "shows as"} ${applied}§r§a` : "is their gamertag again") : null,
        fontChanged ? `uses the §f${FONTS[font].label}§a font` : null
    ].filter(Boolean).join(" and ")
    ok(player, `§f${target.name}§a's name ${what}.`)
    if (target.id !== player.id) {
        info(target, [
            nameChanged ? (applied ? `Your display name is now ${applied}§r§7.` : "Your display name is your gamertag again.") : null,
            fontChanged ? `Your name now uses the ${FONTS[font].label} font.` : null
        ].filter(Boolean).join(" "))
    }
    return done()
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
        title: hubTitle("actions", `Gamemode · ${displayName(target)}`),
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
        title: hubTitle("actions", `Teleport · ${displayName(target)}`),
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
