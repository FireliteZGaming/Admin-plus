// Run a model and the shipped word list over the private chat archive and
// print COUNTS ONLY: how many lines each would hold, by level and length.
//
//     node tools/toxicity/archive_check.mjs <model.js> [archive.jsonl]
//
// It never prints, writes or returns a chat line. Other players wrote the
// archive, it stays on this PC, and reading it is the user's call.

import fs from "node:fs"
import { pathToFileURL } from "node:url"
import { loadModel, scoreMessage } from "../../Admin+ BP/scripts/core/toxicity.js"
import { findTerm, termsFor, CATEGORIES } from "../../Admin+ BP/scripts/core/chatfilter.js"

const [modelPath, archivePath = "notes/chat-archive/chat.jsonl"] = process.argv.slice(2)
const { TOX_MODEL } = await import(pathToFileURL(modelPath).href)
const model = loadModel(TOX_MODEL)
const lines = fs.readFileSync(archivePath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
const messages = lines.map(l => String(l.message ?? ""))

const t0 = performance.now()
const scores = messages.map(m => scoreMessage(model, m))
const ms = (performance.now() - t0) / messages.length

const LEVELS = ["low", "medium", "high"]
const HOLDS = ["discrimination", "sexual", "hostility"]
const out = model.outputs
console.log(`${messages.length.toLocaleString()} lines, ${(ms * 1000).toFixed(0)} microseconds a line in Node`)
console.log("\nModel: lines each output would hold at each level (thresholds from the public validation set)")
for (const name of out) {
    const j = out.indexOf(name)
    const cells = LEVELS.map(level => {
        const t = model.levels[name]?.[level]
        if (t === null || t === undefined) return `${level} -`
        return `${level} ${scores.filter(s => s[j] >= t).length}`
    })
    console.log(`   ${name.padEnd(15)} ${cells.join("   ")}`)
}

const anyHeld = level => scores.map(s => HOLDS.some(name => {
    const t = model.levels[name]?.[level]
    return t !== null && t !== undefined && s[out.indexOf(name)] >= t
}))
const terms = CATEGORIES.map(c => termsFor(c))
const listHits = messages.map(m => CATEGORIES.some((c, i) => c.id !== "profanity" && findTerm(m, terms[i], 2, [])))
const listProf = messages.map(m => Boolean(findTerm(m, terms[3], 2, [])))
console.log(`\nWord list at level 2 (shipped terms): ${listHits.filter(Boolean).length} lines for discrimination, sexual or hostility; ${listProf.filter(Boolean).length} for profanity`)
for (const level of LEVELS) {
    const held = anyHeld(level)
    const both = held.filter((h, i) => h && listHits[i]).length
    console.log(`   model ${level.padEnd(6)} holds ${held.filter(Boolean).length} lines (discrimination, sexual or hostility); ${both} of them the list also holds`)
}

console.log("\nBy length (words): lines, then model holds at medium")
const med = anyHeld("medium")
for (const [lo, hi] of [[1, 1], [2, 2], [3, 5], [6, 15], [16, 999]]) {
    const sel = messages.map(m => { const n = m.split(/\s+/).filter(Boolean).length; return n >= lo && n <= hi })
    const n = sel.filter(Boolean).length
    const h = med.filter((x, i) => x && sel[i]).length
    console.log(`   ${String(lo === hi ? lo : `${lo}-${hi}`).padEnd(7)} ${String(n).padStart(5)} lines, ${String(h).padStart(4)} held (${(100 * h / Math.max(n, 1)).toFixed(1)}%)`)
}
