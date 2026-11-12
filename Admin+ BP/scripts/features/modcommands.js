import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info, formatDuration, parseDuration } from "../core/util.js"
import { canActOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { mute, unmute, isMuted, hasMuteTag, banList, unban } from "../core/moderation.js"
import { chatAvailable } from "./chat.js"
import { banScreen } from "./actions.js"
import { record } from "../core/logs.js"
import { pickFrom } from "../core/ask.js"

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
        { name: "reason", type: CustomCommandParamType.String, rest: true }
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
        const already = []

        for (const target of targets) {
            if (target.id !== player.id && !canActOn(player, target)) {
                blocked.push(displayName(target))
                continue
            }
            // Say so rather than silently re-muting. Re-applying would reset a
            // running timer without a word, so somebody who typed the command
            // twice would quietly double the sentence — and after a `/mute @a`,
            // "already muted" is the answer to "did that work?".
            if (isMuted(target) || hasMuteTag(target)) {
                already.push(displayName(target))
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
        if (already.length) info(player, `§7Already muted: §f${already.join(", ")}`)
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
    mandatory: [{
        name: "player", type: CustomCommandParamType.PlayerSelector,
        // Left off, the list is the people who are actually muted.
        self: true,
        only: target => isMuted(target) || hasMuteTag(target),
        empty: "Nobody online is muted."
    }],
    run: (player, [selected]) => {
        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")

        const cleared = []
        const untouched = []
        const unstuck = []
        for (const target of targets) {
            // BOTH halves are checked, and either one is enough to act on. A
            // record with no tag, or a tag with no record, is a mute that has
            // come apart — and the whole reason the tag exists is so that the
            // ordinary command can put it back together instead of the player
            // being stuck until somebody works out which half is lying.
            const hadRecord = isMuted(target)
            const hadTag = hasMuteTag(target)
            if (!hadRecord && !hadTag) { untouched.push(displayName(target)); continue }
            // NO hierarchy check here, deliberately — this used to require
            // canActOn and that was the bug.
            //
            // Muting is punitive, so it is ranked: a junior must not be able to
            // silence a senior. UNMUTING is restorative and the risk runs the
            // other way. Requiring rank to lift a mute meant that after a
            // `/mute @a`, every peer was silenced AND barred from fixing it —
            // a moderator could not unmute another moderator, so the only way
            // out was the one person who cast it. The worst case without the
            // check is that somebody speaks who should not, which any staff
            // member can undo in one command; the worst case WITH it is a room
            // full of staff who cannot talk and cannot help each other.
            //
            // `admin.mute` is still required to get this far, so this is not
            // open to everyone — it is open to everyone already trusted to mute.
            // The PLAYER, not their id: unmute has to reach them to take the
            // tag off, and every caller used to hand it a bare id.
            unmute(target)
            record(player, "mod.unmute", target,
                hadRecord ? "lifted" : "cleared a leftover mute tag")
            ;(hadRecord ? cleared : unstuck).push(displayName(target))
            info(target, "§aYou can speak again.")
        }

        if (cleared.length) ok(player, `Unmuted §f${cleared.join(", ")}§a.`)
        if (unstuck.length) {
            ok(player, `Cleared a leftover mute tag on §f${unstuck.join(", ")}§a — they were not actually muted.`)
        }
        // Always said, not only when nothing else happened. "They weren't muted"
        // is the answer to "why can't they talk", and swallowing it whenever
        // some OTHER player in the same selector got unmuted is how a real mute
        // hides behind a successful one.
        if (untouched.length) info(player, `§7Not muted: §f${untouched.join(", ")}`)
    }
})


// /unban takes a NAME, not a selector: a banned player is by definition not here
// for a selector to match. Left off, the ban list itself is the pick list.
command({
    name: "unban",
    description: "Lift a ban — /unban <name>, or /unban alone to pick from the list",
    perm: "admin.ban",
    mandatory: [{
        name: "name", type: CustomCommandParamType.String,
        // Resolves to the ban's id, which the handler matches before any name,
        // so two banned players with similar names cannot be confused.
        ask: async player => (await pickFrom(player, {
            title: "/unban",
            body: "Pick a ban to lift.",
            items: banList(),
            render: ban => `§c${ban.name || "unknown"}§r\n§8${ban.reason} · by ${ban.by}`,
            empty: "Nobody is banned."
        }))?.id
    }],
    run: (player, [name]) => {
        const wanted = String(name ?? "").trim().toLowerCase()
        if (!wanted) return err(player, "Type the name of the player to unban.")

        const bans = banList()
        const match = bans.find(b => String(b.id) === String(name))
            ?? bans.find(b => (b.name ?? "").toLowerCase() === wanted)
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
