import { world, CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { menu, pagedMenu, modal, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info, formatDate, formatDuration } from "../core/util.js"
import { has } from "../core/ranks.js"
import { flag } from "../core/settings.js"
import { statusLine } from "../core/moderation.js"
import {
    CATEGORIES, fileReport, pendingReports, handledReports, getReport,
    markRead, isUnreadBy, unreadCount, handleReport, reportStaff
} from "../core/reports.js"
import { record } from "../core/logs.js"
import { openActionsFor } from "./actions.js"

// /report <player> [category] <reason>
//
// Staff hear about it immediately — sent directly to everyone holding
// admin.reports, rather than into a chat channel: a channel they are not
// currently reading would swallow it.

const categoryEnum = defineEnum("reportcategory", CATEGORIES)

command({
    name: "report",
    description: "Report a player to staff — /report <player> <reason>",
    perm: "report.use",
    mandatory: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "reason", type: CustomCommandParamType.String }
    ],
    optional: [{ name: categoryEnum, type: CustomCommandParamType.Enum }],
    run: (player, [selected, reason, category]) => {
        if (!flag("feature.reports")) return err(player, "Reports are turned off on this server.")
        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")
        if (targets.length > 1) return err(player, "Report one player at a time.")

        const text = String(reason ?? "").trim().slice(0, 200)
        if (!text) return err(player, "Say what they did.")

        const result = fileReport(player, targets[0], text, String(category ?? "other"))
        if (!result.ok) return err(player, result.reason)

        ok(player, result.updated
            ? "Updated your report — staff have been told again."
            : "Report sent. Staff have been told.")
        record(player, "report.filed", targets[0], `${category ?? "other"}: ${text}`)
        alertStaff(result.report)
    }
})

function alertStaff(report) {
    const staff = reportStaff()
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
    const pending = pendingReports().length
    if (!pending) return undefined
    const unread = unreadCount(player)
    return `§c§lReports§r §8(${pending}${unread ? `, §c${unread} new§8` : ""})`
}

export async function reportsScreen(player, back) {
    if (!has(player, "admin.reports")) { err(player, "You can't read reports."); return back() }
    const pending = pendingReports()

    if (!pending.length) {
        return menu(player, {
            title: hubTitle("actions", "Reports"),
            body: "§7Nothing waiting.\n\n§8Reports arrive here the moment a player files one.",
            buttons: handledReports().length
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
        extra: handledReports().length
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
    if (!report) { info(player, "That report is gone."); return back() }

    if (report.handled) {
        return menu(player, {
            title: hubTitle("actions", "Report · closed"),
            body: [
                `§f${report.target.name}§7 — reported by §f${report.reporter.name}`,
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
            { text: "§7Dismiss §8· nothing to do here", run: () => closeScreen(player, reportId, "dismissed", back) },
            { text: "§8Leave it for someone else", run: () => back() }
        ],
        back
    })
}

/** Closing is what removes it from everyone's queue — reading never does. */
async function closeScreen(player, reportId, outcome, back) {
    const report = getReport(reportId)
    if (!report || report.handled) { info(player, "Already closed."); return back() }

    const values = await modal(player, hubTitle("actions", outcome === "action" ? "Close report" : "Dismiss report"), [
        { id: "note", type: "text", label: "Note §8· optional, kept with the report", placeholder: outcome === "action" ? "banned 3d" : "nothing to it" }
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
    const handled = handledReports()
    return pagedMenu(player, {
        title: hubTitle("about", "Handled reports"),
        body: subtitle("The last few, and who closed them."),
        items: handled,
        render: report => ({
            text: `§7${report.target.name}§r\n§8${report.handled.outcome} by ${report.handled.by}${report.handled.note ? " · " + report.handled.note : ""}`
        }),
        onPick: report => reportScreen(player, report.id, () => historyScreen(player, back)),
        back
    })
}
