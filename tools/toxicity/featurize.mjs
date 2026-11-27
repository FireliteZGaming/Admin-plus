// Turn prepared/{split}.jsonl into features with the pack's own code.
//
//     node tools/toxicity/featurize.mjs <prepared dir> train val test
//
// Writes, per split:
//   {split}.hash.u32   every piece's 32-bit hash, row after row
//   {split}.cnt.u16    four counts per row: letters, words, squashed, shape
// Labels and weights stay in the .jsonl; train.py reads them in the same order.
//
// It imports core/toxfeatures.js itself, so the model is trained on exactly
// what the game will compute. Nothing here is a second copy of that code.

import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fold, features, MAX_FEATURES, FEATURE_VERSION } from "../../Admin+ BP/scripts/core/toxfeatures.js"

const [dir, ...splits] = process.argv.slice(2)
if (!dir || !splits.length) {
    console.error("usage: node featurize.mjs <prepared dir> <split> [split...]")
    process.exit(1)
}

const CHUNK = 1 << 22                    // hashes per write
for (const split of splits) {
    const started = Date.now()
    const input = readline.createInterface({ input: fs.createReadStream(path.join(dir, `${split}.jsonl`)), crlfDelay: Infinity })
    const hashFile = fs.openSync(path.join(dir, `${split}.hash.u32`), "w")
    const countFile = fs.openSync(path.join(dir, `${split}.cnt.u16`), "w")

    const buf = new Uint32Array(MAX_FEATURES)
    const counts = [0, 0, 0, 0]
    let chunk = new Uint32Array(CHUNK)
    let fill = 0
    let countChunk = new Uint16Array(4 * 65536)
    let countFill = 0
    let rows = 0
    let total = 0

    for await (const line of input) {
        if (!line) continue
        const n = features(fold(JSON.parse(line).t), buf, counts)
        if (fill + n > CHUNK) {
            fs.writeSync(hashFile, chunk.subarray(0, fill))
            fill = 0
        }
        chunk.set(buf.subarray(0, n), fill)
        fill += n
        for (let k = 0; k < 4; k++) countChunk[countFill++] = counts[k]
        if (countFill === countChunk.length) {
            fs.writeSync(countFile, countChunk)
            countFill = 0
        }
        rows++
        total += n
    }
    fs.writeSync(hashFile, chunk.subarray(0, fill))
    fs.writeSync(countFile, countChunk.subarray(0, countFill))
    fs.closeSync(hashFile)
    fs.closeSync(countFile)
    fs.writeFileSync(path.join(dir, `${split}.meta.json`), JSON.stringify({ rows, total, featureVersion: FEATURE_VERSION }))
    console.log(`${split}: ${rows.toLocaleString()} rows, ${total.toLocaleString()} pieces (${(total / rows).toFixed(0)} a row), ${((Date.now() - started) / 1000).toFixed(1)} s`)
}
