import { world, CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { menu, pagedMenu, modal, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { tile } from "../core/look.js"
import { ok, err, info, formatDate, formatDuration } from "../core/util.js"
import { displayName } from "../core/identity.js"
import { has } from "../core/ranks.js"
import { flag } from "../core/settings.js"
import { statusLine } from "../core/moderation.js"
import {
    CATEGORIES, fileReport, pendingReports, handledReports, getReport,
    markRead, isUnreadBy, unreadCount, handleReport, reportStaff
} from "../core/reports.js"
import { record } from "../core/logs.js"
import { canSeeActionsOf } from "../core/ranks.js"
import { openActionsFor } from "./actions.js"

// /report <player> [category] <reason>
//
// Staff hear about it immediately — sent directly to everyone holding
// admin.reports, rather than into a chat channel: a channel they are not
// currently reading would swallow it.

const categoryEnum = defineEnum("reportcategory", CATEGORIES)

command({
    name: "report",
    description: "Report a player to staff",
    perm: "report.use",
    // Everything optional, so bare /report opens the form. Someone who has just
    // been griefed should not have to get a selector and a quoted string right
    // before they can say so.
    optional: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "reason", type: CustomCommandParamType.String },
        { name: categoryEnum, type: CustomCommandParamType.Enum }
    ],
    run: (player, [selected, reason, category]) => {
        if (!flag("feature.reports")) return err(player, "Reports are turned off on this server.")
        const targets = selected ?? []
        if (!targets.length) return reportForm(player)
        if (targets.length > 1) return err(player, "Report one player at a time.")

        const text = String(reason ?? "").trim().slice(0, 200)
        if (!text) return reportForm(player, targets[0])

        const result = fileReport(player, targets[0], text, String(category ?? "other"))
        if (!result.ok) return err(player, result.reason)

        ok(player, result.updated
            ? "Updated your report. Staff were told again."
            : "Report sent. Staff have been told.")
        record(player, "report.filed", targets[0], `${category ?? "other"}: ${text}`)
        alertStaff(result.report)
    }
})

/**
 * The form behind a bare /report.
 *
 * A DROPDOWN of players rather than a scrolling list of buttons: a report names
 * exactly one person, and picking from a closed list means a misspelt name
 * cannot produce a report about nobody. The reason list works the same way, with
 * Other last — and the box underneath is required whichever they pick, because
 * a queue full of reports that say only "cheating" tells staff nothing.
 *
 * @param {object} player  who is filing
 * @param {object} [preset]  a player already named on the command line
 * @param {string} [error]  what was wrong with the last attempt
 */
export async function reportForm(player, preset, error) {
    const others = world.getAllPlayers().filter(p => p.id !== player.id)
    if (!others.length) {
        return err(player, "There is nobody else here to report.")
    }

    const names = others.map(p => displayName(p))
    const startAt = Math.max(0, preset ? others.findIndex(p => p.id === preset.id) : 0)

    const values = await modal(player, hubTitle("actions", "Report a player"), [
        {
            id: "who",
            type: "dropdown",
            label: `${error ? "§c" + error + "\n§r" : ""}Who`,
            options: names,
            default: startAt
        },
        {
            id: "category",
            type: "dropdown",
            label: "What kind",
            options: CATEGORY_LABELS,
            default: 0
        },
        {
            id: "detail",
            type: "text",
            label: "What happened §8· required",
            placeholder: "For example: broke into my base. For staff abuse, say what they did and when."
        }
    ])
    if (!values) return

    const detail = String(values.detail ?? "").trim().slice(0, 200)
    if (!detail) {
        return reportForm(player, others[values.who ?? 0], "Fill in what happened before sending.")
    }

    const target = others[values.who ?? 0]
    if (!target) return err(player, "That player left before you sent it.")

    const category = CATEGORIES[values.category ?? 0] ?? "other"
    const result = fileReport(player, target, detail, category)
    if (!result.ok) return err(player, result.reason)

    ok(player, result.updated
        ? "Updated your report. Staff were told again."
        : "Report sent. Staff have been told.")
    record(player, "report.filed", target, `${category}: ${detail}`)
    alertStaff(result.report)
}

/**
 * What each category is called on the picker. CATEGORIES stays the stored
 * vocabulary — these are only what a person reads.
 *
 * Written out rather than derived by capitalising the id, because one of them
 * needs more than its own word: "Abuse" does not tell a member that this is
 * where you report a STAFF MEMBER, and somebody who does not know that will
 * file it under Other and it will read as a complaint about a player.
 */
const CATEGORY_TEXT = {
    griefing: "Griefing §8· broke or took something",
    cheating: "Cheating §8· hacks, exploits, unfair advantage",
    chat: "Chat §8· something they said",
    abuse: "Staff abuse §8· a staff member misusing their tools",
    other: "Other §8· none of these"
}
const CATEGORY_LABELS = CATEGORIES.map(c => CATEGORY_TEXT[c] ?? (c[0].toUpperCase() + c.slice(1)))

/**
 * Who hears about a report, and who can read it back.
 *
 * **Reporting upward is the point — being told about it is not.** A member must
 * be able to report an owner, and `/report` is deliberately un-gated for that
 * reason. But the ALERT went to every holder of `admin.reports`, so a moderator
 * learned that somebody had reported the owner: upward gossip they could not
 * act on, and the queue then kept showing it to them.
 *
 * canSeeActionsOf on the person reported — the seeing rule, equal-or-below —
 * so a peer can still pick up a report about a peer and escalate it, and only
 * what is above you closes. The report itself is never dropped: it is stored
 * either way, and whoever outranks them sees it.
 */
function canSeeReport(viewer, report) {
    if (!report?.target?.id) return true
    // **Never the person reported.** canSeeActionsOf answers true when the
    // viewer IS the subject — which is right for reading your own audit trail
    // and catastrophic here: the reported staff member would be shown the
    // report against them, complete with who filed it. An `abuse` report is
    // exactly the case where being tipped off is the harm.
    if (report.target.id === viewer.id) return false
    if (report.reporter?.id === viewer.id) return true
    return canSeeActionsOf(viewer, report.target.id)
}

/** The reports this person may see, from any list of them. */
function readableReports(player, reports) {
    return (reports ?? []).filter(report => canSeeReport(player, report))
}

function alertStaff(report) {
    const staff = reportStaff().filter(member => canSeeReport(member, report))
    for (const member of staff) {
        member.sendMessage(
            `§c§l[REPORT] §r§f${report.reporter.name}§7 reported §f${report.target.name}` +
            `\n§8${report.category} · ${report.reason}` +
            `\n§8Open /admin ▸ Reports`)
    }
    console.log(`[Admin+] report: ${report.reporter.name} -> ${report.target.name} (${report.category}) ${report.reason}`)
}

// ------------------------------------------------------------------ the queue

/** Label for the pinned panel entry, or undefined when there is nothing to show. */
export function reportsBadge(player) {
    if (!has(player, "admin.reports")) return undefined
    const pending = readableReports(player, pendingReports()).length
    if (!pending) return undefined
    const unread = unreadCount(player)
    return `§c§lReports§r §8(${pending}${unread ? `, §c${unread} new§8` : ""})`
}

/** The same badge as a tile, for /admin in Admin+'s own look (Beta). */
export function reportsTile(player) {
    if (!has(player, "admin.reports")) return undefined
    const pending = readableReports(player, pendingReports()).length
    if (!pending) return undefined
    const unread = unreadCount(player)
    return tile("reports", "Reports", unread ? `${pending} waiting, §c${unread} new` : `${pending} waiting`)
}

export async function reportsScreen(player, back) {
    if (!has(player, "admin.reports")) { err(player, "You can't read reports."); return back() }
    const pending = readableReports(player, pendingReports())

    if (!pending.length) {
        return menu(player, {
            title: hubTitle("actions", "Reports"),
            body: "§7No reports waiting.\n\n§8New reports show up here as soon as a player sends one.",
            buttons: readableReports(player, handledReports()).length
                ? [{ text: hubEntry("about", "Recently handled", "The last few, and who closed them"), run: () => historyScreen(player, () => reportsScreen(player, back)) }]
                : [],
            back
        })
    }

    return pagedMenu(player, {
        title: hubTitle("actions", "Reports"),
        body: subtitle(`${pending.length} waiting · ${unreadCount(player)} you haven't opened.`),
        items: pending,
        render: report => ({
            text: `${isUnreadBy(player, report) ? "§c§l" : "§7"}${report.target.name}§r\n§8${report.category} · ${ago(report.at)} · by ${report.reporter.name}`
        }),
        onPick: report => reportScreen(player, report.id, () => reportsScreen(player, back)),
        extra: readableReports(player, handledReports()).length
            ? [{ text: hubEntry("about", "Recently handled"), run: () => historyScreen(player, () => reportsScreen(player, back)) }]
            : [],
        back
    })
}

function ago(at) {
    const gap = Date.now() - (at ?? 0)
    return gap < 60000 ? "just now" : `${formatDuration(gap)} ago`
}

async function reportScreen(player, reportId, back) {
    // Opening marks it read FOR THIS VIEWER only — it stays in everyone's queue.
    markRead(player, reportId)
    const report = getReport(reportId)
    // Re-checked here: this screen is reachable by id, and the second of the
    // two is where a report gets HANDLED — where reading turns into acting.
    if (report && !canSeeReport(player, report)) {
        err(player, "That report is above your rank.")
        return back()
    }
    if (!report) { info(player, "That report is gone."); return back() }

    if (report.handled) {
        return menu(player, {
            title: hubTitle("actions", "Report · closed"),
            body: [
                `§f${report.target.name}§7, reported by §f${report.reporter.name}`,
                `§8${formatDate(report.at)}`,
                "",
                `§f${report.reason}`,
                "",
                `§aHandled by ${report.handled.by}§7 (${report.handled.outcome})`,
                "§8Someone got to it first."
            ].join("\n"),
            buttons: [],
            back
        })
    }

    const again = () => reportScreen(player, reportId, back)
    return menu(player, {
        title: hubTitle("actions", `Report · ${report.target.name}`),
        body: [
            `§fReported: §c${report.target.name}`,
            `§fBy: §7${report.reporter.name}`,
            `§fWhen: §7${formatDate(report.at)} §8(${ago(report.at)})`,
            `§fCategory: §7${report.category}`,
            "",
            `§f${report.reason}`,
            "",
            `§8Their status: ${statusLine(report.target.id)}`
        ].join("\n"),
        buttons: [
            {
                text: "§cTake action §8· open their Actions screen",
                run: () => openActionsFor(player, report.target.id, report.target.name, () => closeScreen(player, reportId, "action", back))
            },
            { text: "§8Dismiss · nothing to do here", run: () => closeScreen(player, reportId, "dismissed", back) },
            { text: "§8Leave it for someone else", run: () => back() }
        ],
        back
    })
}

/** Closing is what removes it from everyone's queue — reading never does. */
async function closeScreen(player, reportId, outcome, back) {
    const report = getReport(reportId)
    // Re-checked here: this screen is reachable by id, and the second of the
    // two is where a report gets HANDLED — where reading turns into acting.
    if (report && !canSeeReport(player, report)) {
        err(player, "That report is above your rank.")
        return back()
    }
    if (!report || report.handled) { info(player, "Already closed."); return back() }

    const values = await modal(player, hubTitle("actions", outcome === "action" ? "Close report" : "Dismiss report"), [
        { id: "note", type: "text", label: "Note §8· optional, kept with the report", placeholder: outcome === "action" ? "banned 3d" : "no rule broken" }
    ])
    if (!values) return back()

    handleReport(player, reportId, outcome, String(values.note ?? "").trim())
    record(player, "report.handled", { id: report.target.id, name: report.target.name },
        `${outcome}${values.note ? " · " + values.note : ""}`)
    ok(player, outcome === "action" ? "Report closed." : "Report dismissed.")

    notifyReporter(report)
    return back()
}

/**
 * Tell the reporter their report was dealt with — and nothing more. What
 * happened to the reported player is between staff and that player.
 */
function notifyReporter(report) {
    const reporter = world.getAllPlayers().find(p => p.id === report.reporter?.id)
    if (!reporter) return
    reporter.sendMessage(`§8[§cReport§8] §7Your report about §f${report.target.name}§7 has been handled. Thanks.`)
}

async function historyScreen(player, back) {
    const handled = readableReports(player, handledReports())
    return pagedMenu(player, {
        title: hubTitle("about", "Handled reports"),
        body: subtitle("The last few, and who closed them."),
        items: handled,
        render: report => ({
            text: `§8${report.target.name}§r\n§8${report.handled.outcome} by ${report.handled.by}${report.handled.note ? " · " + report.handled.note : ""}`
        }),
        onPick: report => reportScreen(player, report.id, () => historyScreen(player, back)),
        back
    })
}
