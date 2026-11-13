import { world, system } from "@minecraft/server"
import { Table } from "../core/storage.js"
import { flag } from "../core/settings.js"
import { parse, runBlock, statementsOf, triggerLabel, describe, LIMITS, PERMISSION_FOR } from "../core/automation.js"
import { has, isStaff, isOwner, heldRankIds, playerRanks, allRanks, holdersTable, grantRank, revokeRank, canEditRank, nodesBeyond, canActOn } from "../core/ranks.js"
import { setExpiry } from "../core/grants.js"
import { allWarps, teleportTo } from "../core/warps.js"
import { getNickname } from "../core/identity.js"
import { hasOperator } from "../core/devgate.js"
import { record } from "../core/logs.js"

// Automation: the part that touches the world. core/automation.js reads and
// runs the text; this file stores automations, starts them when something
// happens, and does what they say.
//
// THE RULE THAT KEEPS IT SAFE (the 2.8.7 rule, "nobody gives out a permission
// they don't have"): an automation can only do what the person who saved it
// can do. That is checked when it is saved, and again whenever it runs, so
// somebody who loses a permission loses it in their automations too.
// Operators and the pack's owners are not limited, the same as everywhere.

const store = new Table("automations", {})

/** id → { source, program, error, lastRun, waiting } for this session. */
const runtime = new Map()
/** "id#block#seconds" → when that `every` block runs next. */
const timers = new Map()
let sequence = 0

const plain = s => String(s ?? "").replace(/§./g, "").trim().toLowerCase()
const shown = s => String(s ?? "").replace(/§./g, "").trim()

// ------------------------------------------------------------------ lookups

function findRank(name) {
    const want = plain(name)
    return allRanks().find(rank => rank.id.toLowerCase() === want) ?? allRanks().find(rank => plain(rank.display) === want)
}

function findWarp(name) {
    const want = plain(name)
    return allWarps().find(warp => warp.id.toLowerCase() === want) ?? allWarps().find(warp => plain(warp.display) === want)
}

/** The player an automation is about. When they are leaving, only an id and a name. */
function subjectOf(player) { return player ? { id: player.id, name: player.name, player } : undefined }

function rankWord(subject) {
    return shown(playerRanks(subject.player ?? subject.id)[0]?.display)
}

function unlimited(player) { return hasOperator(player) || isOwner(player) }

function authorOnline(rec) {
    const id = rec.author?.id
    return id ? world.getAllPlayers().find(p => p.id === id) : undefined
}

/** Who acts, for a permission check: the author online, their id, or null for an operator who is away. */
function authority(rec) {
    const online = authorOnline(rec)
    if (online) return online
    return rec.author?.op ? null : rec.author?.id
}

function authorHas(rec, node) {
    const actor = authority(rec)
    if (actor === null) return true
    return !!actor && has(actor, node)
}

function canGive(actor, rank) {
    if (actor === null) return true
    if (!actor) return false
    if (typeof actor !== "string" && unlimited(actor)) return true
    return has(actor, "ranks.grant") && canEditRank(actor, rank) && !nodesBeyond(actor, rank).length
}

const VERB = {
    say: "send a message to everyone",
    warp: "teleport players",
    giveRank: "give ranks",
    takeRank: "take ranks away",
    cancel: "stop players' messages",
    replace: "change players' messages"
}

// ------------------------------------------------------------------ checks

/**
 * May `player` change this automation? Only if they saved it, or outrank (or
 * equal) whoever did. Without this, a lower rank with the Automation
 * permission could turn off or rewrite an owner's automations (2.10.1).
 */
export function canChange(player, rec) {
    if (!rec) return false
    if (unlimited(player) || !rec.author?.id || rec.author.id === player.id) return true
    if (rec.author.op) return false
    return canActOn(player, rec.author.id)
}

const OUTRANKED = "Someone who outranks you saved this automation, so you can't change it."

/**
 * Read an automation as `player` would save it. Adds the permission rule to
 * what the language checks: every line must be something they can do.
 */
export function checkFor(player, source) {
    const parsed = parse(source)
    if (!parsed.ok || parsed.empty) return parsed
    if (unlimited(player)) return parsed
    for (const s of statementsOf(parsed.blocks)) {
        const node = PERMISSION_FOR[s.type]
        if (node && !has(player, node)) {
            return { ok: false, error: `Line ${s.line}: you can't ${VERB[s.type]}, so this automation can't either.`, line: s.line }
        }
        if ((s.type === "giveRank" || s.type === "takeRank") && !String(s.text).includes("{")) {
            const rank = findRank(s.text)
            if (!rank) return { ok: false, error: `Line ${s.line}: there's no rank called ${s.text}.`, line: s.line }
            if (!canGive(player, rank)) {
                return { ok: false, error: `Line ${s.line}: you can't give the ${shown(rank.display)} rank, so this automation can't either.`, line: s.line }
            }
        }
    }
    return parsed
}

function compiled(rec) {
    let entry = runtime.get(rec.id)
    if (!entry || entry.source !== rec.source) {
        const parsed = parse(rec.source)
        entry = { source: rec.source, program: parsed.ok ? parsed : null, error: parsed.ok ? undefined : parsed.error, lastRun: entry?.lastRun, waiting: entry?.waiting ?? 0 }
        runtime.set(rec.id, entry)
    }
    return entry
}

// ------------------------------------------------------------------ doing

function actorFor(rec) {
    return { id: rec.author?.id ?? "automation", name: `Automation "${rec.name}"` }
}

/** Do one line for real. Returns a problem in words, or nothing. */
function act(rec, subject, s, text, sub) {
    const node = PERMISSION_FOR[s.type]
    if (node && !authorHas(rec, node)) return `${rec.author?.name ?? "whoever saved it"} can't ${VERB[s.type]} any more, so this was skipped.`
    const player = subject?.player
    switch (s.type) {
        case "say":
            world.sendMessage(text)
            return
        case "tell":
            player?.sendMessage(text)
            return
        case "tellStaff":
            for (const p of world.getAllPlayers()) if (isStaff(p)) p.sendMessage(text)
            return
        case "title":
            try {
                player.onScreenDisplay.setTitle(text, { subtitle: sub || undefined, fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20 })
            } catch { return "the title couldn't be shown." }
            return
        case "actionbar":
            try { player.onScreenDisplay.setActionBar(text) } catch { return "the text above the hotbar couldn't be shown." }
            return
        case "sound":
            try { player.playSound(text) } catch { return `the sound ${text} couldn't be played.` }
            return
        case "warp": {
            const warp = findWarp(text)
            if (!warp) return `there's no warp called ${text}.`
            try { teleportTo(player, warp) } catch { return `${subject.name} couldn't be sent to ${text}.` }
            return
        }
        case "giveRank":
        case "takeRank": {
            const rank = findRank(text)
            if (!rank) return `there's no rank called ${text}.`
            if (!subject?.id) return
            // Nobody raises themselves through their own automation.
            if (subject.id === rec.author?.id) return
            if (!canGive(authority(rec), rank)) return `${rec.author?.name ?? "whoever saved it"} can't give the ${shown(rank.display)} rank any more, so this was skipped.`
            const holds = heldRankIds(subject.id).includes(rank.id)
            if (s.type === "giveRank") {
                if (!holds) grantRank(subject.id, rank.id, subject.name)
                if (s.seconds) setExpiry(subject.id, rank.id, s.seconds * 1000, actorFor(rec))
                if (!holds || s.seconds) record(actorFor(rec), "automation.rank", subject, `gave ${shown(rank.display)}${s.seconds ? " for a while" : ""}`)
            } else if (holds) {
                revokeRank(subject.id, rank.id, subject.name)
                record(actorFor(rec), "automation.rank", subject, `took ${shown(rank.display)}`)
            }
            return
        }
    }
}

/** Three problems in a row turn an automation off, and Logs says why. */
function settle(rec, result) {
    const now = store.get(rec.id)
    if (!now) return
    if (result.error) {
        const errors = (now.errors ?? 0) + 1
        const off = errors >= 3
        store.set(rec.id, { ...now, errors, lastError: result.error, on: off ? false : now.on })
        if (off) record(actorFor(now), "automation.error", undefined, `turned off after 3 problems in a row. The last: ${result.error}`)
    } else if (now.errors) {
        store.set(rec.id, { ...now, errors: 0 })
    }
}

/**
 * Run one block of one automation. In a before-event (`defer`), nothing is
 * written: what it does is queued and runs on the next tick. A dry run
 * (`dry`, a list) only describes what it would do.
 */
function runOne(rec, entry, block, subject, extra = {}, { defer = false, dry = null } = {}) {
    if (!dry && entry.waiting >= LIMITS.waitingRuns) return { cancel: false, replace: undefined, skipped: true }
    if (!dry) entry.lastRun = Date.now()
    const phase = { sync: true, queue: [], finished: undefined }
    const env = {
        token: name => {
            switch (name) {
                case "NAME": return subject?.name ?? ""
                case "NICKNAME": return subject ? (getNickname(subject.player ?? subject.id) || subject.name) : ""
                case "RANK": return subject ? rankWord(subject) : ""
                case "MSG": return extra.message ?? ""
                case "ONLINE": return String(world.getAllPlayers().length)
            }
            return ""
        },
        hasRank: name => {
            const rank = findRank(name)
            return !!rank && !!subject && heldRankIds(subject.player ?? subject.id).includes(rank.id)
        },
        isStaff: () => !!subject && isStaff(subject.player ?? subject.id),
        random: Math.random,
        act: (s, text, sub) => {
            if (dry) { dry.push(describe(s, text, sub)); return }
            if (defer && phase.sync) {
                phase.queue.push(() => {
                    const problem = act(rec, subject, s, text, sub)
                    return problem ? `Line ${s.line}: ${problem}` : undefined
                })
                return
            }
            return act(rec, subject, s, text, sub)
        },
        later: (fn, ticks) => {
            if (dry) { fn(); return }
            entry.waiting++
            system.runTimeout(() => { entry.waiting = Math.max(0, entry.waiting - 1); fn() }, ticks)
        },
        alive: () => {
            if (dry) return true
            const now = store.get(rec.id)
            return !!now?.on && now.source === rec.source && flag("feature.automation")
        },
        finished: result => {
            if (dry) return
            if (defer && phase.sync) { phase.finished = result; return }
            settle(rec, result)
        }
    }
    const result = runBlock(block, env)
    phase.sync = false
    if (defer && !dry) {
        system.run(() => {
            const problems = phase.queue.map(fn => fn()).filter(Boolean)
            if (!phase.finished) return
            const done = { ...phase.finished }
            if (problems.length && !done.error) done.error = problems[0]
            settle(rec, done)
        })
    }
    return result
}

function enabled() { return flag("feature.automation") }

/** Start every automation block for `trigger`. Not for chat; see chatAutomations. */
export function fire(trigger, subject, extra = {}) {
    if (!enabled()) return 0
    let ran = 0
    for (const rec of store.values()) {
        if (!rec.on) continue
        const entry = compiled(rec)
        if (!entry.program) continue
        for (const block of entry.program.blocks) {
            if (block.trigger !== trigger) continue
            runOne(rec, entry, block, subject, extra)
            ran++
        }
    }
    return ran
}

/**
 * Chat, from inside the chat before-event. Returns whether to stop the
 * message and what to say instead. Every automation sees what was typed.
 * The real words always go to Logs when an automation stops or changes them,
 * so staff can see what a player actually said.
 */
export function chatAutomations(player, message, { canReplace = true } = {}) {
    const verdict = { cancel: false, replace: undefined }
    if (!enabled() || !player) return verdict
    const subject = subjectOf(player)
    const mayEdit = flag("automation.chatEdit")
    let by
    for (const rec of store.values()) {
        if (!rec.on) continue
        const entry = compiled(rec)
        if (!entry.program) continue
        for (const block of entry.program.blocks) {
            if (block.trigger !== "chat") continue
            const result = runOne(rec, entry, block, subject, { message }, { defer: true })
            if (!mayEdit || !authorHas(rec, "admin.mute")) continue
            if (result.cancel) { verdict.cancel = true; by = rec }
            if (canReplace && result.replace !== undefined) { verdict.replace = result.replace; by = by ?? rec }
        }
    }
    if (by && (verdict.cancel || verdict.replace !== undefined)) {
        const said = message, instead = verdict.replace
        system.run(() => record(actorFor(by), verdict.cancel ? "automation.cancel" : "automation.replace", subject,
            verdict.cancel ? `stopped: "${said}"` : `"${said}" became "${instead}"`))
    }
    return verdict
}

/** The `every` blocks: called once a second. `now` is for the tests. */
export function tickTimers(now = Date.now()) {
    if (!enabled()) return
    const live = new Set()
    for (const rec of store.values()) {
        if (!rec.on) continue
        const entry = compiled(rec)
        if (!entry.program) continue
        entry.program.blocks.forEach((block, index) => {
            if (block.trigger !== "every") return
            const key = `${rec.id}#${index}#${block.seconds}`
            live.add(key)
            const due = timers.get(key)
            if (due === undefined) { timers.set(key, now + block.seconds * 1000); return }
            if (now < due) return
            timers.set(key, now + block.seconds * 1000)
            runOne(rec, entry, block, undefined, {})
        })
    }
    for (const key of [...timers.keys()]) if (!live.has(key)) timers.delete(key)
}

// ------------------------------------------------------------------ the list

export function automationList() {
    return store.values().sort((a, b) => plain(a.name).localeCompare(plain(b.name)))
}

export function getAutomation(id) { return store.get(id) }

/** "when join, every 5 minutes", for a list button. */
export function triggersOf(rec) {
    const entry = compiled(rec)
    if (!entry.program) return "has a mistake"
    return [...new Set(entry.program.blocks.map(triggerLabel))].join(", ")
}

export function lastRunOf(id) { return runtime.get(id)?.lastRun }

function cleanName(name, fallback = "Automation") {
    const text = String(name ?? "").replace(/§./g, "").trim().slice(0, 32)
    return text || fallback
}

/**
 * Save an automation as `player`. A mistake or something they can't do is
 * refused with its line, and nothing is saved.
 */
export function saveAutomation(player, { id, name, source }) {
    const checked = checkFor(player, source)
    if (!checked.ok) return checked
    if (checked.empty) return { ok: false, empty: true }
    const before = id ? store.get(id) : undefined
    if (before && !canChange(player, before)) return { ok: false, error: OUTRANKED }
    if (!before && store.ids().length >= LIMITS.maxAutomations) {
        return { ok: false, error: `You can have ${LIMITS.maxAutomations} automations at the most.` }
    }
    const key = before?.id ?? `a${Date.now().toString(36)}${(++sequence).toString(36)}`
    const rec = {
        id: key,
        name: cleanName(name ?? before?.name),
        on: before?.on ?? true,
        source: String(source),
        author: { id: player.id, name: player.name, op: unlimited(player) },
        saved: Date.now(),
        errors: 0
    }
    store.set(key, rec)
    runtime.delete(key)
    record(player, "automation.save", undefined, `${before ? "changed" : "made"} the automation "${rec.name}"`)
    return { ok: true, record: rec, made: !before }
}

export function setAutomationOn(player, id, on) {
    const rec = store.get(id)
    if (!rec || !canChange(player, rec)) return false
    store.set(id, { ...rec, on: !!on, errors: 0, lastError: on ? undefined : rec.lastError })
    record(player, on ? "automation.on" : "automation.off", undefined, `turned the automation "${rec.name}" ${on ? "on" : "off"}`)
    return true
}

export function renameAutomation(player, id, name) {
    const rec = store.get(id)
    if (!rec || !canChange(player, rec)) return false
    const next = cleanName(name, rec.name)
    store.set(id, { ...rec, name: next })
    record(player, "automation.rename", undefined, `renamed the automation "${rec.name}" to "${next}"`)
    return true
}

export function deleteAutomation(player, id) {
    const rec = store.get(id)
    if (!rec || !canChange(player, rec)) return false
    store.delete(id)
    runtime.delete(id)
    record(player, "automation.delete", undefined, `deleted the automation "${rec.name}"`)
    return true
}

/**
 * "Try it on me": every block once, with `player` as the player and
 * `message` as what they typed, describing what would happen. Nothing is done.
 */
export function previewAutomation(player, id, message = "test") {
    const rec = store.get(id)
    if (!rec) return []
    const entry = compiled(rec)
    if (!entry.program) return [entry.error ?? "It has a mistake."]
    return entry.program.blocks.map(block => {
        const dry = []
        const subject = block.trigger === "every" ? undefined : subjectOf(player)
        const result = runOne(rec, entry, block, subject, { message }, { dry })
        if (result.cancel) dry.push("would stop the message")
        if (result.replace !== undefined) dry.push(`would change the message to: ${result.replace}`)
        return `${triggerLabel(block)}: ${dry.length ? dry.join("; ") : "nothing, for you"}`
    })
}

// ------------------------------------------------------------------ events

export function installAutomation() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (!player) return
        if (initialSpawn) {
            // Read BEFORE the join handler gives them a record: a player Admin+
            // has never seen is joining for the first time.
            const known = holdersTable.get(player.id)
            const first = !known || Date.now() - (known.since ?? 0) < 5000
            system.runTimeout(() => {
                if (player.isValid === false) return
                const subject = subjectOf(player)
                if (first) fire("first join", subject)
                fire("join", subject)
            }, 40)
        } else {
            system.run(() => fire("respawn", subjectOf(player)))
        }
    })
    world.afterEvents?.playerLeave?.subscribe?.(({ playerId, playerName }) => {
        fire("leave", { id: playerId, name: playerName })
    })
    world.afterEvents?.entityDie?.subscribe?.(({ deadEntity }) => {
        if (deadEntity?.typeId === "minecraft:player") fire("death", subjectOf(deadEntity))
    })
    system.runInterval(() => tickTimers(), 20)
    return true
}
