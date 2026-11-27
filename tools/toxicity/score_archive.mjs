// Score every line of the private chat archive with a model and the shipped
// word list, and write the SCORES ONLY, keyed by "source:line":
//
//     node tools/toxicity/score_archive.mjs <model.js> [out.jsonl] [archive.jsonl]
//
// The out file (default notes/chat-archive/labels/scores-<model name>.jsonl)
// holds per line: the model's five log-odds, the strictest level the pack's
// own verdict() would hold it at, the outputs High holds it for, and the word
// list's category at level 2. Never a word of the line: other players wrote
// the archive, and it stays on this PC. tools/toxicity/review.py reads it to
// pick the lines a person checks. Prints counts only.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { loadModel, scoreMessage, verdict, LEVELS, HOLDS } from "../../Admin+ BP/scripts/core/toxicity.js"
import { findTerm, termsFor, CATEGORIES } from "../../Admin+ BP/scripts/core/chatfilter.js"

const [modelPath, outArg, archivePath = "notes/chat-archive/chat.jsonl"] = process.argv.slice(2)
if (!modelPath) { console.log("usage: node tools/toxicity/score_archive.mjs <model.js> [out.jsonl] [archive.jsonl]"); process.exit(2) }
const { TOX_MODEL } = await import(pathToFileURL(path.resolve(modelPath)).href)
const model = loadModel(TOX_MODEL)
const out = outArg || `notes/chat-archive/labels/scores-${TOX_MODEL.name}.jsonl`
const rows = fs.readFileSync(archivePath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
const terms = CATEGORIES.map(c => termsFor(c))

const lines = []
const held = { low: 0, medium: 0, high: 0 }
let listed = 0
for (const r of rows) {
    const message = String(r.message ?? "")
    const s = scoreMessage(model, message)
    const v = verdict(model, s)
    const strictest = LEVELS.find(l => v[l.id].length)?.id ?? ""
    if (strictest) for (const l of LEVELS.slice(LEVELS.findIndex(x => x.id === strictest))) held[l.id]++
    const at = CATEGORIES.findIndex((c, i) => findTerm(message, terms[i], 2, []))
    if (at >= 0) listed++
    lines.push(JSON.stringify({
        key: `${r.source}:${r.line}`,
        s: Array.from(s, x => Math.round(x * 1000) / 1000),
        held: strictest,
        by: v.high.map(h => h.name),
        list: at >= 0 ? CATEGORIES[at].id : ""
    }))
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, lines.join("\n") + "\n", "utf8")
// What the numbers mean, beside them: the order of `s`, each level's lines.
const meta = out.replace(/\.jsonl$/, "") + ".meta.json"
fs.writeFileSync(meta, JSON.stringify({ name: TOX_MODEL.name, outputs: model.outputs, levels: TOX_MODEL.levels, holds: [...HOLDS] }, null, 1) + "\n", "utf8")
console.log(`${rows.length.toLocaleString()} lines scored with ${TOX_MODEL.name} -> ${out} (and ${path.basename(meta)})`)
console.log(`held by the pack's verdict: Low ${held.low}, Medium ${held.medium}, High ${held.high}; word list at level 2: ${listed}`)
