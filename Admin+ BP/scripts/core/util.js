import { world } from "@minecraft/server"
import { CONFIG } from "../config.js"
import { isStaff } from "./ranks.js"

const B = CONFIG.brand

export function msg(player, text) { player.sendMessage(B.prefix + text) }
export function ok(player, text) { msg(player, B.ok + text) }
export function err(player, text) { msg(player, B.err + text) }
export function info(player, text) { msg(player, B.info + text) }

/** Broadcast to everyone, Admin+ branded. */
export function broadcast(text) { world.sendMessage(B.prefix + text) }

/** Broadcast to staff only — used for moderation notices. */
export function staffNotice(text) {
    for (const p of world.getAllPlayers()) {
        if (isStaff(p)) p.sendMessage(B.prefix + "§8(staff) §r" + text)
    }
}

/** Exact-then-fuzzy online player lookup by name. */
export function findPlayer(name) {
    if (!name) return undefined
    const players = world.getAllPlayers()
    const needle = String(name).toLowerCase()
    return players.find(p => p.name.toLowerCase() === needle)
        ?? players.find(p => p.name.toLowerCase().includes(needle))
}

/** "30m", "3d", "2h30m", "perm" -> milliseconds (0 = permanent). */
export function parseDuration(input) {
    if (!input) return 0
    const raw = String(input).trim().toLowerCase()
    if (raw === "perm" || raw === "permanent" || raw === "forever") return 0
    const units = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }
    let total = 0
    let matched = false
    for (const [, amount, unit] of raw.matchAll(/(\d+)\s*([smhdw])/g)) {
        total += Number(amount) * units[unit]
        matched = true
    }
    if (!matched) {
        const n = Number(raw)
        if (Number.isFinite(n) && n > 0) return n * 6e4 // bare number = minutes
        return 0
    }
    return total
}

/** Milliseconds -> "2d 3h 5m" (or "permanent" for 0). */
export function formatDuration(ms) {
    if (!ms || ms <= 0) return "permanent"
    const units = [["d", 864e5], ["h", 36e5], ["m", 6e4], ["s", 1e3]]
    const out = []
    let rest = ms
    for (const [label, size] of units) {
        const n = Math.floor(rest / size)
        if (n > 0) { out.push(`${n}${label}`); rest -= n * size }
        if (out.length === 2) break
    }
    return out.join(" ") || "0s"
}

export function formatDate(ts) {
    if (!ts) return "unknown"
    const d = new Date(ts)
    const pad = n => String(n).padStart(2, "0")
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}



