import { __test } from "@minecraft/server"
import { matches, relevance } from "../Admin+ BP/scripts/features/actions.js"
import { setNickname } from "../Admin+ BP/scripts/core/identity.js"
import { record, clear as clearLogs } from "../Admin+ BP/scripts/core/logs.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const fakePlayer = (id, name, at = { x: 0, y: 0, z: 0 }) => ({
    id, name, nameTag: name, location: at,
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {},
    getDynamicProperty: () => undefined, setDynamicProperty: () => {}
})

const online = (p) => ({ online: true, id: p.id, name: p.name, player: p })
const offline = (id, name) => ({ online: false, id, name })

console.log("\n— finding somebody by name —")
{
    const steve = fakePlayer("p-steve", "NotSteve")
    const row = online(steve)

    // The rules, all three asked for by name.
    check("a substring is enough, not just a prefix", matches(row, "ste"), true)
    check("case does not matter", matches(row, "STE"), true)
    check("nor in the other direction", matches(row, "notsteve"), true)
    check("the whole name still works", matches(row, "notsteve"), true)
    check("something absent does not match", matches(row, "herobrine"), false)
    check("an empty search matches everyone, so the list is not blanked",
        matches(row, ""), true)
}

console.log("\n— and by their nickname, which is the name staff actually saw —")
// Admin+ lets people set nicknames. A moderator reading chat sees the nickname
// and often never learns the gamertag, so matching one and not the other is a
// bug waiting to be reported.
{
    const p = fakePlayer("p-nick", "xX_Gamer_Xx")
    setNickname(p, "Dave")
    const row = online(p)
    check("the gamertag matches", matches(row, "gamer"), true)
    check("and so does the nickname", matches(row, "dave"), true)
    check("case-insensitively there too", matches(row, "DAV"), true)
    check("something in neither does not", matches(row, "steve"), false)
}

console.log("\n— a colour code cannot hide somebody from a search —")
{
    const p = fakePlayer("p-colour", "Plain")
    setNickname(p, "§cRed§rName")
    const row = online(p)
    check("the codes come off before comparing", matches(row, "redname"), true)
    check("and searching the visible halves works", matches(row, "red"), true)
}

console.log("\n— an offline row has only a gamertag, and still matches —")
{
    const row = offline("o-1", "OldPlayer")
    check("by gamertag", matches(row, "oldplay"), true)
    check("and not by something it never had", matches(row, "nickname"), false)
    check("a row with no player object does not throw", matches(row, "x"), false)
}

console.log("\n— the list is ordered before anybody has to search it —")
// Search is a workaround for a badly ordered list, so the order is the thing
// that actually has to be right.
{
    clearLogs()
    const viewer = fakePlayer("v", "Mod", { x: 0, y: 64, z: 0 })
    const near = fakePlayer("a-near", "Near", { x: 3, y: 64, z: 0 })
    const far = fakePlayer("b-far", "Far", { x: 900, y: 64, z: 0 })
    const rows = [online(far), online(near), offline("z-gone", "Gone")]

    const sorted = relevance(viewer, rows)
    check("online before offline", sorted.map(r => r.id),
        ["a-near", "b-far", "z-gone"])

    // Now the viewer mutes the far one. A mute is followed by a kick more often
    // than by anything else, and finding that name again from scratch is the
    // thing this removes.
    record(viewer, "mod.mute", far, "10m")
    const after = relevance(viewer, rows)
    check("somebody just acted on comes first, even from across the map",
        after[0].id, "b-far")
    check("and the nearest is still next", after[1].id, "a-near")

    // Acting on the near one afterwards puts THEM on top - most recent wins,
    // or the ordering would be "whoever was ever acted on, alphabetically".
    record(viewer, "mod.warn", near, "language")
    check("most recent, not merely ever", relevance(viewer, rows)[0].id, "a-near")
}

console.log("\n— it never reorders somebody else's history —")
{
    clearLogs()
    const viewer = fakePlayer("v2", "Mod2", { x: 0, y: 64, z: 0 })
    const other = fakePlayer("v3", "Mod3", { x: 0, y: 64, z: 0 })
    const near = fakePlayer("n2", "Near2", { x: 1, y: 64, z: 0 })
    const far = fakePlayer("f2", "Far2", { x: 500, y: 64, z: 0 })
    const rows = [online(near), online(far)]

    // The OTHER moderator muted the far one. That is their business, and it
    // must not rearrange this person's screen.
    record(other, "mod.mute", far, "10m")
    check("the nearest is still first", relevance(viewer, rows)[0].id, "n2")
}

console.log("\n— a player whose position cannot be read does not break it —")
// An unloaded chunk, a player leaving mid-sort: reading .location throws, and
// a sort comparator that throws takes the whole screen with it.
{
    clearLogs()
    const viewer = fakePlayer("v4", "Mod4", { x: 0, y: 64, z: 0 })
    const broken = {
        id: "broken", name: "Broken",
        get location() { throw new Error("chunk unloaded") },
        getTags: () => [], sendMessage: () => {},
        getDynamicProperty: () => undefined, setDynamicProperty: () => {}
    }
    const near = fakePlayer("ok", "Fine", { x: 1, y: 64, z: 0 })
    const rows = [online(broken), online(near)]
    let threw = false
    let sorted = []
    try { sorted = relevance(viewer, rows) } catch { threw = true }
    check("sorting does not throw", threw, false)
    check("everybody is still in the list", sorted.length, 2)
    check("and the readable one sorts first", sorted[0].id, "ok")
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
