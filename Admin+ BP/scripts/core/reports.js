import { world } from "@minecraft/server"
import { Table } from "./storage.js"
import { has } from "./ranks.js"

// Reports.
//
// Two states, deliberately separate:
//   READ     you opened it. Stops bolding FOR YOU. Still in the queue.
//   HANDLED  someone took action or dismissed it. Leaves the queue for EVERYONE.
//
// Collapsing those into one is the obvious shortcut and the wrong one: the first
// admin to glance at a report would clear it for the rest of the staff, and a
// report nobody acted on would quietly vanish. A report everyone has read but
// nobody has handled still sits there, which is the point.

const REPORTS_KEY = "reports"
const COOLDOWN_MS = 60 * 1000
const MAX_PENDING_PER_REPORTER = 3
const KEEP_HANDLED = 25          // recent handled reports kept for context

const reports = new Table(REPORTS_KEY, {})

export const CATEGORIES = ["griefing", "cheating", "chat", "other"]

const idOf = p => typeof p === "string" ? p : p?.id

function nextId() {
    return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

export function allReports() {
    return Object.values(reports.data).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

export function pendingReports() { return allReports().filter(r => !r.handled) }

export function handledReports() { return allReports().filter(r => r.handled) }

export function getReport(id) { return reports.get(id) }

/** How many pending reports this player still has room to file. */
function pendingBy(reporterId) {
    return pendingReports().filter(r => r.reporter?.id === reporterId).length
}

function lastFiledBy(reporterId) {
    const mine = allReports().filter(r => r.reporter?.id === reporterId)
    return mine.length ? Math.max(...mine.map(r => r.at ?? 0)) : 0
}

/**
 * File a report.
 * @returns {{ok: true, report: object, updated: boolean} | {ok: false, reason: string}}
 */
export function fileReport(reporter, target, reason, category = "other") {
    if (idOf(reporter) === idOf(target)) {
        return { ok: false, reason: "You can't report yourself." }
    }

    const waited = Date.now() - lastFiledBy(reporter.id)
    if (waited < COOLDOWN_MS) {
        const left = Math.ceil((COOLDOWN_MS - waited) / 1000)
        return { ok: false, reason: `Wait ${left}s before reporting again.` }
    }

    // Reporting the same player twice while the first is still open updates it
    // rather than stacking two entries for staff to read.
    const open = pendingReports().find(r =>
        r.reporter?.id === reporter.id && r.target?.id === idOf(target))
    if (open) {
        open.reason = reason
        open.category = category
        open.at = Date.now()
        open.read = []
        reports.set(open.id, open)
        return { ok: true, report: open, updated: true }
    }

    if (pendingBy(reporter.id) >= MAX_PENDING_PER_REPORTER) {
        return { ok: false, reason: "You already have reports waiting on staff. Give them a moment." }
    }

    const report = {
        id: nextId(),
        at: Date.now(),
        reporter: { id: reporter.id, name: reporter.name },
        target: { id: idOf(target), name: target.name ?? String(target) },
        category,
        reason,
        read: [],
        handled: undefined
    }
    reports.set(report.id, report)
    return { ok: true, report, updated: false }
}

/** Mark read for one viewer. Never removes it from anyone else's queue. */
export function markRead(player, reportId) {
    const report = reports.get(reportId)
    if (!report || report.read?.includes(player.id)) return report
    report.read = [...(report.read ?? []), player.id]
    reports.set(reportId, report)
    return report
}

export function isUnreadBy(player, report) {
    return !report.handled && !(report.read ?? []).includes(player.id)
}

/** How many still need this viewer's eyes. */
export function unreadCount(player) {
    return pendingReports().filter(r => isUnreadBy(player, r)).length
}

/**
 * Close a report for everyone.
 * @param {"action"|"dismissed"} outcome
 */
export function handleReport(player, reportId, outcome, note) {
    const report = reports.get(reportId)
    if (!report) return undefined
    if (report.handled) return report          // already closed by someone else
    report.handled = { by: player.name, at: Date.now(), outcome, note }
    reports.set(reportId, report)
    prune()
    return report
}

/** Keep the handled tail short; pending reports are never dropped. */
function prune() {
    const handled = handledReports()
    if (handled.length <= KEEP_HANDLED) return
    for (const report of handled.slice(KEEP_HANDLED)) reports.delete(report.id)
}

/** Everyone who should hear about a new report right now. */
export function reportStaff() {
    return world.getAllPlayers().filter(p => has(p, "admin.reports"))
}

export function describe(report) {
    const who = report.target?.name ?? "someone"
    return `${who} §8· ${report.category} §8· ${report.reason}`
}
