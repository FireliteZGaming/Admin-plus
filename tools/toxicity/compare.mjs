// Compare exported models on the same held-out lines, with the pack's own
// scorer and verdict(), so what's compared is what the game would do.
//
//     node tools/toxicity/compare.mjs <prepared/test.jsonl> <a.js> <b.js> [...]
//
// Prints numbers only:
//   1. public test AUC per output (Civil Comments, Measuring Hate Speech and
//      HateXplain lines; "yes" means at least half the annotators said so),
//   2. for each group of held-out template lines, the share each level holds:
//      for hostile groups that's how much is caught, for the rest it's how
//      often a line is held wrongly,
//   3. a few fixed probe lines, named, never printed.
// The template lines are Admin+'s own; the probes are written here.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { loadModel, scoreMessage, verdict, LEVELS } from "../../Admin+ BP/scripts/core/toxicity.js"
import { FEATURE_VERSION } from "../../Admin+ BP/scripts/core/toxfeatures.js"

const [testPath, ...modelPaths] = process.argv.slice(2)
if (!testPath || !modelPaths.length) {
    console.log("usage: node tools/toxicity/compare.mjs <test.jsonl> <model.js> [model.js ...]")
    process.exit(2)
}
const models = []
for (const p of modelPaths) {
    const { TOX_MODEL } = await import(pathToFileURL(path.resolve(p)).href)
    // An older model is scored with today's features anyway, to compare. The
    // pack itself refuses that. Version 2 only took colour codes out, so only
    // a line with "§" in it reads differently.
    if (TOX_MODEL.featureVersion !== FEATURE_VERSION) {
        console.log(`note: ${TOX_MODEL.name} was built for features v${TOX_MODEL.featureVersion}; scored with v${FEATURE_VERSION} here`)
    }
    models.push(loadModel({ ...TOX_MODEL, featureVersion: FEATURE_VERSION }))
}
const rows = fs.readFileSync(testPath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
const PUBLIC = new Set(["cc", "mhs", "hx"])

/** Area under the ROC curve, ties shared. */
function auc(scores, labels) {
    const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b])
    let pos = 0, neg = 0, rankSum = 0
    for (let i = 0; i < order.length;) {
        let j = i
        while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) j++
        const mid = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) if (labels[order[k]]) { pos++; rankSum += mid } else neg++
        i = j + 1
    }
    return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN
}

function groupOf(r) {
    if (r.s !== "tpl") return undefined
    const m = /^game-([a-z]+)-/.exec(r.id)
    if (m) return `game ${m[1]}`
    const y = r.y.map(v => v ?? 0)
    if (y.every(v => v === 0)) return "old traps"
    if (y[1] >= 0.5 || y[3] >= 0.5) return "old hostile"
    if (y[4] >= 1) return "old swearing"
    return "old other"
}

const scored = models.map(m => rows.map(r => scoreMessage(m, r.t)))
const names = models.map(m => m.spec.name)

console.log(`${rows.length.toLocaleString()} test lines; models: ${names.join(", ")}`)
console.log("\n1. Public test AUC per output")
console.log(`   ${"output".padEnd(15)}${names.map(n => n.padStart(16)).join("")}`)
const pub = rows.map(r => PUBLIC.has(r.s))
for (const [j, out] of models[0].outputs.entries()) {
    const idx = rows.map((r, i) => i).filter(i => pub[i] && rows[i].y[j] !== null && rows[i].y[j] !== undefined)
    const labels = idx.map(i => rows[i].y[j] >= 0.5)
    const cells = scored.map(s => auc(idx.map(i => s[i][j]), labels))
    console.log(`   ${out.padEnd(15)}${cells.map(c => c.toFixed(4).padStart(16)).join("")}   (${idx.length.toLocaleString()} lines, ${labels.filter(Boolean).length.toLocaleString()} yes)`)
}

console.log("\n2. Held-out template lines: share held at Low / Medium / High")
const groups = [...new Set(rows.map(groupOf).filter(Boolean))].sort()
for (const g of groups) {
    const idx = rows.map((r, i) => i).filter(i => groupOf(rows[i]) === g)
    const cells = models.map((m, k) => LEVELS.map(level =>
        idx.filter(i => verdict(m, scored[k][i])[level.id].length).length / idx.length))
    console.log(`   ${g.padEnd(14)} n=${String(idx.length).padEnd(5)}` +
        cells.map((c, k) => `  ${names[k]}: ${c.map(x => `${(100 * x).toFixed(0)}%`.padStart(4)).join(" ")}`).join(""))
}

console.log("\n3. Probes: the level that first holds each (- = none), per model")
const PROBES = [
    ["self-harm abbreviation, alone", "kys"],
    ["self-harm abbreviation, in a line", "just kys"],
    ["swearing at the lag, two words", "damn lag"],
    ["swearing at a creeper", "fuck this creeper"],
    ["swearing at the server's lag", "this server is so fucking laggy"],
    ["PvP talk", "i will kill you in pvp"],
    ["a real-world threat", "i know where you live"],
    ["the same words in game talk", "i know where your base is lol"],
    ["friendly", "gg well played"],
    ["a clear insult at a player", "you are an idiot"]
]
for (const [label, text] of PROBES) {
    const cells = models.map(m => {
        const v = verdict(m, scoreMessage(m, text))
        return LEVELS.find(l => v[l.id].length)?.label ?? "-"
    })
    console.log(`   ${label.padEnd(36)} ${cells.map(c => c.padStart(8)).join("")}`)
}
