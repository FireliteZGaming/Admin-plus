import { CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err, info, formatDate, formatDuration } from "../core/util.js"
import { has, canActOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import {
    WARN_REASONS, addWarning, removeWarning, warningsFor, warningCount
} from "../core/warnings.js"

// /warn add|remove <player>   — staff, opens a form
// /warnings [player]          — read your own; staff may read anyone's
//
// A warning does nothing to the player but tell them and leave a mark. That is
// the point of having it: the rung below a mute, so the first offence has a
// response that is not silence and is not punishment.
//
// The player can always read their own. Anything staff write into a warning is
// written knowing the person it is about will see it — the "note" field is the
// one place that is not true, and it says so on the form.

const actionEnum = defineEnum("warnaction", ["add", "remove"])

command({
    name: "warn",
    description: "Warn a player, or take a warning back — /warn <add|remove> <player>",
    perm: "admin.warn",
    mandatory: [
        { name: actionEnum, type: CustomCommandParamType.Enum },
        { name: "player", type: CustomCommandParamType.PlayerSelector }
    ],
    run: (player, [action, selected]) => {
        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")
        if (targets.length > 1) return err(player, "One player at a time.")

        const target = targets[0]
        if (target.id === player.id) return err(player, "Warn somebody else.")
        if (!canActOn(player, target)) return err(player, `${displayName(target)} outranks you.`)

        // The command is the door; the form is the feature. core/registry.js
        // already defers every run handler a tick, which is what makes it legal
        // to show a form from here at all.
        const open = String(action).toLowerCase() === "remove" ? removeScreen : addScreen
        return open(player, target, undefined)
    }
})

command({
    name: "warnings",
    description: "See your warnings — /warnings [player]",
    // No node. Reading your OWN record is not a privilege, and gating it
    // would have meant a member on an existing world being refused until
    // somebody re-applied the ladder — a rank table is stored per world, so
    // a node added in an update reaches nobody already running. Naming
    // someone else still needs admin.warn, checked below.
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const targets = selected ?? []

        // No argument, or pointing it at yourself, is always allowed. Reading
        // somebody ELSE's is a staff act and needs the node for it.
        if (!targets.length || (targets.length === 1 && targets[0].id === player.id)) {
            return tellOwn(player)
        }
        if (!has(player, "admin.warn")) {
            return err(player, "You can only read your own warnings.")
        }
        if (targets.length > 1) return err(player, "One player at a time.")
        tellAbout(player, targets[0])
    }
})

/** Their own list, in chat — no form, so it works the moment they type it. */
function tellOwn(player) {
    const mine = warningsFor(player)
    if (!mine.length) {
        return info(player, "§aNo warnings on your record.")
    }
    const lines = [
        `§e§lYour warnings §r§7(${mine.length})`,
        ...mine.slice(0, 10).map((w, i) =>
            `§8${i + 1}. §f${w.reason} §8· ${ago(w.at)}`)
    ]
    if (mine.length > 10) lines.push(`§8…and ${mine.length - 10} older.`)
    lines.push("§8Ask a staff member if you think one of these is wrong.")
    player.sendMessage(lines.join("\n"))
}

function tellAbout(staff, target) {
    const list = warningsFor(target)
    if (!list.length) return info(staff, `§f${displayName(target)}§7 has no warnings.`)
    staff.sendMessage([
        `§e§l${displayName(target)}§r§7 — ${list.length} warning${list.length === 1 ? "" : "s"}`,
        ...list.slice(0, 10).map(w => `§8· §f${w.reason} §8— ${w.by}, ${ago(w.at)}${w.note ? ` §8(${w.note})` : ""}`)
    ].join("\n"))
}

function ago(at) {
    const gap = Date.now() - (at ?? 0)
    return gap < 60000 ? "just now" : `${formatDuration(gap)} ago`
}

// ------------------------------------------------------------------- the form

/**
 * Add a warning. A dropdown of the usual reasons plus Other, and a box that
 * has to be filled in — the reason list alone would produce a record that says
 * "Chat behaviour" six times and explains nothing.
 */
export async function addScreen(staff, target, back, error) {
    const done = back ?? (() => undefined)
    const values = await modal(staff, hubTitle("actions", `Warn · ${displayName(target)}`), [
        {
            id: "reason",
            type: "dropdown",
            label: `${error ? "§c" + error + "\n§r" : ""}Reason`,
            options: WARN_REASONS,
            default: 0
        },
        {
            id: "detail",
            type: "text",
            label: "What happened §8· required, and they will read this",
            placeholder: "said X to Y in chat after being asked to stop"
        },
        {
            id: "note",
            type: "text",
            label: "§7Staff note §8· optional, NOT shown to them",
            placeholder: "second time this week"
        },
        { id: "tell", type: "toggle", label: "Tell them now (if online)", default: true }
    ])
    if (!values) return done()

    const detail = String(values.detail ?? "").trim()
    if (!detail) {
        // Re-open rather than dropping what they typed on the floor.
        return addScreen(staff, target, back, "Say what they did — that box is required.")
    }

    const label = WARN_REASONS[values.reason ?? 0] ?? "Other"
    const reason = label === "Other" ? detail : `${label}: ${detail}`
    const result = addWarning(staff, target, reason, values.note)
    if (!result.ok) { err(staff, result.reason); return done() }

    record(staff, "mod.warn", target, `${reason}${values.note ? ` · note: ${values.note}` : ""}`,
        { kind: "warning", warningId: result.entry.id })

    ok(staff, `Warned §f${displayName(target)}§a. That is warning §f${result.total}§a.`)
    if (values.tell !== false) notify(target, result.entry, result.total)
    return done()
}

/** What the warned player sees. Deliberately plain and not shouty. */
function notify(target, entry, total) {
    try {
        target.sendMessage([
            "§e§l⚠ You have been warned",
            `§f${entry.reason}`,
            `§8This is warning ${total}. Type §f/warnings§8 to see them all.`
        ].join("\n"))
    } catch { /* offline — they will see it in /warnings */ }
}

/** Take one back. Lists them, because "remove the last one" is rarely the ask. */
export async function removeScreen(staff, target, back) {
    const done = back ?? (() => undefined)
    const list = warningsFor(target)
    if (!list.length) {
        info(staff, `§f${displayName(target)}§7 has no warnings to remove.`)
        return done()
    }

    return pagedMenu(staff, {
        title: hubTitle("actions", `Warnings · ${displayName(target)}`),
        body: subtitle(`${list.length} on record. Pick one to take back.`),
        items: list,
        render: warning => ({
            text: `§f${warning.reason}\n§8${warning.by} · ${ago(warning.at)}`
        }),
        onPick: async warning => {
            const yes = await confirm(staff, hubTitle("actions", "Remove warning"),
                [
                    `Remove this warning from §f${displayName(target)}§r?`,
                    "",
                    `§7${warning.reason}`,
                    `§8Given by ${warning.by}, ${formatDate(warning.at)}`,
                    warning.note ? `§8Note: ${warning.note}` : "",
                    "",
                    "§8It leaves their record. The audit log keeps that it existed."
                ].filter(Boolean).join("\n"),
                "§cRemove")
            if (!yes) return removeScreen(staff, target, back)

            const gone = removeWarning(target, warning.id)
            if (!gone) { info(staff, "Already gone."); return removeScreen(staff, target, back) }

            record(staff, "mod.unwarn", target, gone.reason)
            ok(staff, `Removed. §f${displayName(target)}§a is on §f${warningCount(target)}§a now.`)
            return removeScreen(staff, target, back)
        },
        back
    })
}

/**
 * The read-only view, for the Actions screen. Staff who can see a player's
 * record but hold no warn node still get here — reading is not acting.
 */
export async function warningsScreen(staff, target, back) {
    const list = warningsFor(target)
    const mayWarn = has(staff, "admin.warn") && canActOn(staff, target)

    return menu(staff, {
        title: hubTitle("actions", `Warnings · ${displayName(target)}`),
        body: list.length
            ? [
                `§f${list.length}§7 on record.`,
                "",
                ...list.slice(0, 8).map(w =>
                    `§8· §f${w.reason}\n  §8${w.by} · ${ago(w.at)}${w.note ? ` · §7${w.note}` : ""}`)
            ].join("\n")
            : "§7Nothing on record.",
        buttons: [
            mayWarn ? { text: "§eAdd a warning", run: () => addScreen(staff, target, () => warningsScreen(staff, target, back)) } : null,
            mayWarn && list.length ? { text: "§7Remove one", run: () => removeScreen(staff, target, () => warningsScreen(staff, target, back)) } : null
        ].filter(Boolean),
        back
    })
}
