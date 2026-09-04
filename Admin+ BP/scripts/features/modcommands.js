import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info, formatDuration, parseDuration } from "../core/util.js"
import { canActOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { mute, unmute, isMuted, banList, unban } from "../core/moderation.js"
import { chatAvailable } from "./chat.js"
import { banScreen } from "./actions.js"
import { record } from "../core/logs.js"

// /mute and /unmute — the command form of the panel's mute button.
//
// Same shape as everything else here: a real PlayerSelector first, so tab
// completes the name, then optional arguments with sensible defaults. No
// duration means permanent; no reason means "No reason given".
//
//   /mute <player> [duration] [reason]      duration: 30m · 2h · 3d · perm
//   /unmute <player>

command({
    name: "mute",
    description: "Mute a player — /mute <player> [duration] [reason]",
    perm: "admin.mute",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    optional: [
        { name: "duration", type: CustomCommandParamType.String },
        { name: "reason", type: CustomCommandParamType.String }
    ],
    run: (player, [selected, duration, reason]) => {
        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")

        // parseDuration returns 0 for "permanent" AND for anything it can't read,
        // so a typo would silently become a permanent mute. Only accept 0 when
        // they actually meant forever.
        const ms = parseDuration(duration)
        const asked = String(duration ?? "").trim().toLowerCase()
        if (asked && ms === 0 && !["perm", "permanent", "forever"].includes(asked)) {
            return err(player, `Couldn't read the duration "§f${duration}§c". Try §f30m§c, §f2h§c, §f3d§c, §f1w§c, or §fperm§c.`)
        }
        const why = String(reason ?? "").trim() || "No reason given"
        const muted = []
        const blocked = []

        for (const target of targets) {
            if (target.id !== player.id && !canActOn(player, target)) {
                blocked.push(displayName(target))
                continue
            }
            mute(target, ms, why, player)
            record(player, "mod.mute", target,
                `${why} · ${ms ? formatDuration(ms) : "permanent"}`, { kind: "mute" })
            muted.push(displayName(target))
            info(target, `§cYou were muted: ${why}${ms ? ` (${formatDuration(ms)})` : ""}`)
        }

        if (muted.length) {
            ok(player, `Muted §f${muted.join(", ")}§a for §f${ms ? formatDuration(ms) : "ever"}§a.`)
            // Enforcement lives in the chat event, which is beta-only. Better to
            // say so than to let a mute look applied while they keep talking.
            if (!chatAvailable()) {
                info(player, "§7Chat interception needs beta APIs — this mute is recorded but NOT enforced on this runtime.")
            }
        }
        if (blocked.length) err(player, `Outranked you, skipped: §f${blocked.join(", ")}`)
    }
})

// /ban opens the ban screen rather than taking a length as an argument.
//
// A ban is the one act here with no undo the person on the end of it can see,
// and a typed length is exactly where that goes wrong: "/ban Steve 30" is
// thirty of something. The screen asks the three questions in one form and
// makes the length a slider, so an impossible ban cannot be expressed.
//
// The command is still worth having — it tab-completes the name, which the
// panel's player list does not.
command({
    name: "ban",
    description: "Ban a player — /ban <player> opens the ban screen",
    perm: "admin.ban",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")
        if (targets.length > 1) return err(player, "Pick one player.")

        const target = targets[0]
        if (target.id === player.id) return err(player, "You can't ban yourself.")
        if (!canActOn(player, target)) return err(player, `${displayName(target)} outranks you.`)

        // registry.js defers every run handler a tick, which is what makes it
        // legal to show a form from here.
        return banScreen(player, target, () => { })
    }
})

command({
    name: "unmute",
    description: "Unmute a player — /unmute <player>",
    perm: "admin.mute",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")

        const cleared = []
        const untouched = []
        for (const target of targets) {
            if (!isMuted(target)) { untouched.push(displayName(target)); continue }
            if (target.id !== player.id && !canActOn(player, target)) {
                err(player, `${displayName(target)} outranks you — skipped.`)
                continue
            }
            unmute(target.id)
            record(player, "mod.unmute", target, "lifted")
            cleared.push(displayName(target))
            info(target, "§aYou can speak again.")
        }

        if (cleared.length) ok(player, `Unmuted §f${cleared.join(", ")}§a.`)
        if (untouched.length && !cleared.length) info(player, `§7Not muted: §f${untouched.join(", ")}`)
    }
})


// /unban takes a NAME, not a selector: a banned player is by definition not here
// for a selector to match. Names come from the ban list itself.
command({
    name: "unban",
    description: "Lift a ban — /unban <name>",
    perm: "admin.ban",
    mandatory: [{ name: "name", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        const wanted = String(name ?? "").trim().toLowerCase()
        if (!wanted) return err(player, "Type the name of the player to unban.")

        const bans = banList()
        const match = bans.find(b => (b.name ?? "").toLowerCase() === wanted)
            ?? bans.find(b => (b.name ?? "").toLowerCase().includes(wanted))

        if (!match) {
            const open = bans.length
            return err(player, open
                ? `No ban on "§f${name}§c". ${open} player${open === 1 ? " is" : "s are"} banned — see /admin ▸ Actions ▸ Banned players.`
                : `No ban on "§f${name}§c" — nobody is banned.`)
        }
        unban(match.id)
        record(player, "mod.unban", { id: match.id, name: match.name }, `was: ${match.reason}`)
        ok(player, `Unbanned §f${match.name}§a.`)
    }
})
