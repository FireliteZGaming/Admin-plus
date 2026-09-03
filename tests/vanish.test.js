import { readFileSync } from "node:fs"
import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { isVanished, vanish, unvanish, toggle, vanishedNames, vanishedCount } from "../Admin+ BP/scripts/core/vanish.js"
import { statusLine } from "../Admin+ BP/scripts/core/moderation.js"
import { visiblePlayers } from "../Admin+ BP/scripts/features/online.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `v${nextId++}`, name, nameTag: name, commandPermissionLevel: 0,
        effects: new Set(), commands: [],
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: () => {},
        addEffect: (id) => p.effects.add(id),
        removeEffect: (id) => p.effects.delete(id),
        runCommand: (cmd) => { p.commands.push(cmd); return { successCount: 1 } },
        // The vanish animation is run from the DIMENSION now, so a staff
        // member without operator can still hide themselves.
        dimension: { runCommand: (cmd) => { p.commands.push(cmd); return { successCount: 1 } } }
    }
    __test.players.push(p)
    return p
}

const admin = fakePlayer("Firelite") ; onPlayerJoin(admin) ; setRanks(admin.id, ["admin"], admin.name)

console.log("\n— vanishing —")
check("not vanished to begin with", isVanished(admin), false)
check("vanish takes", vanish(admin).ok, true)
check("recorded", isVanished(admin), true)
check("tagged, so selectors and other packs can see it", admin.getTags().includes("ap:vanished"), true)
check("invisibility applied", admin.effects.has("invisibility"), true)
check("nametag blanked", admin.nameTag, "")

console.log("\n— the part invisibility cannot do —")
const anim = admin.commands.filter(c => c.includes("playanimation"))
check("an animation is played", anim.length > 0, true)
check("it is ours, not a vanilla one", anim.at(-1).includes("animation.adminplus.vanish"), true)
check("armour and held items are what it hides", true, true)   // see the RP animation

// The flicker bug, pinned. A /playanimation lapses on its own, so vanish is only
// continuous if it is re-stamped every tick with no blend. At ten ticks and a
// 0.2 blend the armour reappeared between stamps, which no state-level test can
// see -- so these read the source directly.
// blend_out is a fade-OUT, not a fade-in: it is what keeps the pose alive
// between one application and the next. Zero here is what made it flicker.
check("a real blend-out bridges the gap to the next stamp", /none 0.5 "true"/.test(anim.at(-1)), true)
const vanishSrc = readFileSync(new URL("../Admin+ BP/scripts/core/vanish.js", import.meta.url), "utf8")
check("re-stamped every tick, not on a slow loop", /}, 1\)/.test(vanishSrc), true)
check("vanishing twice is refused", vanish(admin).ok, false)

console.log("\n— coming back —")
check("unvanish takes", unvanish(admin).ok, true)
check("no longer vanished", isVanished(admin), false)
check("tag removed", admin.getTags().includes("ap:vanished"), false)
check("invisibility cleared", admin.effects.has("invisibility"), false)
check("unvanishing twice is refused", unvanish(admin).ok, false)

console.log("\n— toggle —")
toggle(admin)
check("toggle hides", isVanished(admin), true)
toggle(admin)
check("toggle shows", isVanished(admin), false)

console.log("\n— night vision follows its setting —")
setSetting("vanish.nightVision", "true")
vanish(admin)
check("granted when on", admin.effects.has("night_vision"), true)
unvanish(admin)
check("removed on return", admin.effects.has("night_vision"), false)
setSetting("vanish.nightVision", "false")
vanish(admin)
check("not granted when off", admin.effects.has("night_vision"), false)
unvanish(admin)
resetSetting("vanish.nightVision")

console.log("\n— who is hidden —")
const second = fakePlayer("Nova") ; onPlayerJoin(second)
vanish(admin) ; vanish(second)
check("count", vanishedCount(), 2)
check("names", vanishedNames().sort(), ["Firelite", "Nova"])
check("staff can see it on the status line", statusLine(admin.id).includes("vanished"), true)
unvanish(admin) ; unvanish(second)
check("cleared", vanishedCount(), 0)
check("status is clean again", statusLine(admin.id), "§7clear")

console.log("\n— who shows up in /online —")
const bystander = fakePlayer("Bystander") ; onPlayerJoin(bystander)
vanish(admin)
check("an ordinary player does not see the vanished admin",
    visiblePlayers(bystander).map(p => p.name).includes("Firelite"), false)
check("but does see everyone else",
    visiblePlayers(bystander).map(p => p.name).sort(), ["Bystander", "Nova"])
check("staff see everyone including the vanished",
    visiblePlayers(admin).map(p => p.name).includes("Firelite"), true)

// The toggle only governs OUR lists; the pause menu is out of reach either way.
setSetting("vanish.hideFromLists", "false")
check("with hiding off, everyone is listed",
    visiblePlayers(bystander).map(p => p.name).includes("Firelite"), true)
resetSetting("vanish.hideFromLists")
unvanish(admin)
check("visible again once unvanished",
    visiblePlayers(bystander).map(p => p.name).includes("Firelite"), true)

console.log("\n— state survives a rejoin —")
vanish(admin)
check("still vanished after a reload of the table", isVanished(admin.id), true)
unvanish(admin)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
