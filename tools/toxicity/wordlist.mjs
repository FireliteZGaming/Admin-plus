// What today's word list (core/chatfilter.js) says about each prepared line,
// so the model can be compared with it on the same messages.
//
//     node tools/toxicity/wordlist.mjs <prepared dir> val test
//
// Writes {split}.wl.u16: per row, bit (category * 3 + level - 1) is set when
// the shipped list (no owner-added words) holds the line for that category at
// that level. Categories in chatfilter's order: discrimination, sexual,
// aggression (Hostility), profanity.

import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { findTerm, termsFor, CATEGORIES } from "../../Admin+ BP/scripts/core/chatfilter.js"

const [dir, ...splits] = process.argv.slice(2)
const terms = CATEGORIES.map(c => termsFor(c))
console.log("shipped terms:", CATEGORIES.map((c, i) => `${c.id} ${terms[i].length}`).join(", "))

for (const split of splits) {
    const input = readline.createInterface({ input: fs.createReadStream(path.join(dir, `${split}.jsonl`)), crlfDelay: Infinity })
    const bits = []
    for await (const line of input) {
        if (!line) continue
        const text = JSON.parse(line).t
        let b = 0
        CATEGORIES.forEach((c, ci) => {
            for (let level = 1; level <= 3; level++) {
                if (findTerm(text, terms[ci], level, [])) b |= 1 << (ci * 3 + level - 1)
            }
        })
        bits.push(b)
    }
    fs.writeFileSync(path.join(dir, `${split}.wl.u16`), new Uint16Array(bits))
    console.log(`${split}: ${bits.length.toLocaleString()} rows`)
}
