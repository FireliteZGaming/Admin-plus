import { readFileSync, readdirSync } from "node:fs"
import { HUB, hubButton, hubEntry } from "../Admin+ BP/scripts/core/theme.js"

// Button text you can read. The game draws form buttons light grey (#C6C6C6,
// from its own interface files). Text in §7 is #AAAAAA, a contrast of about
// 1.4 to 1, which is why "Help" all but vanished in game (the user,
// 2026-11-12: "the help text completely matches the button color").
//
// The bright hub colours (aqua, green, yellow, pink, red) are also faint on
// that grey, but their hue still shows and nobody has asked to change them.
// Admin+'s own look is the step that will redo button colours; until then
// this file holds the line on grey-on-grey.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const RGB = {
    "0": "000000", "1": "0000AA", "2": "00AA00", "3": "00AAAA", "4": "AA0000", "5": "AA00AA",
    "6": "FFAA00", "7": "AAAAAA", "8": "555555", "9": "5555FF", a: "55FF55", b: "55FFFF",
    c: "FF5555", d: "FF55FF", e: "FFFF55", f: "FFFFFF"
}
const BUTTON = "C6C6C6"
function luminance(hex) {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}
const codeOf = colour => String(colour).replace("§", "").toLowerCase()

console.log("\n— Help can be read on a button —")
const help = codeOf(HUB.about)
check("Help is no longer the button's own grey", help === "7", false)
check("and stands out from it at least 3 to 1", contrast(RGB[help], BUTTON) >= 3, true)
check("the Help button uses it", hubButton("about", "Help", "x").startsWith(HUB.about), true)
check("so do Credits and What can I do?", hubEntry("about", "Credits", "x").startsWith(HUB.about), true)
check("no hub is grey on grey", Object.entries(HUB).filter(([, c]) => codeOf(c) === "7").map(([k]) => k), [])

console.log("\n— no other button title is grey on grey —")
const bp = new URL("../Admin+ BP/scripts/", import.meta.url)
function scripts(dir) {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir)
        if (entry.isDirectory()) out.push(...scripts(url))
        else if (entry.name.endsWith(".js")) out.push([entry.name, readFileSync(url, "utf8")])
    }
    return out
}
// `text: "§7...` is a button title in this pack's menus. The one allowed is
// Chat screening while it is on hold: greyed out is exactly what the user
// asked for there, and its "On hold" line underneath is readable.
const greyButtons = scripts(bp).flatMap(([name, text]) => text.split("\n")
    .filter(line => /text:\s*["`]§7/.test(line))
    .filter(line => !line.includes("§7Chat screening\\n§8On hold"))
    .map(line => `${name}: ${line.trim().slice(0, 60)}`))
check("none, apart from the greyed-out Chat screening", greyButtons, [])

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
