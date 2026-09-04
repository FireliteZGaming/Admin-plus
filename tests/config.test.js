import { setting, setSetting, resetSetting, overrides, replaceOverrides, flag, render, renderTag, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { toBlock, fromBlock, canUseCode, kindOf, groupOf, groupedKeys, GROUPS } from "../Admin+ BP/scripts/features/code.js"
import { getNickname, setNickname, displayName, hasNickname, NICK_MAX } from "../Admin+ BP/scripts/core/identity.js"
// canUseCode comes via features/code.js above, which re-exports it.
import { hasOperator, inDeveloperMode, setDeveloperMode } from "../Admin+ BP/scripts/core/devgate.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— settings —")
check("falls back to the shipped default", setting("bracket.open"), DEFAULTS["bracket.open"].value)
setSetting("bracket.open", "§8<")
check("override wins", setting("bracket.open"), "§8<")
check("only the override is stored", overrides(), { "bracket.open": "§8<" })
resetSetting("bracket.open")
check("reset restores the default", setting("bracket.open"), DEFAULTS["bracket.open"].value)

console.log("\n— booleans, as typed by a human —")
for (const [text, expected] of [["true", true], ["false", false], ["FALSE", false], ["0", false], ["off", false], ["no", false], ["yes", true], ["", false]]) {
    setSetting("staff.exemptCooldowns", text)
    check(`"${text}" reads as ${expected}`, flag("staff.exemptCooldowns"), expected)
}
resetSetting("staff.exemptCooldowns")

console.log("\n— rendering —")
check("tag wraps the rank in the brackets", renderTag({ display: "§cAdmin" }), "§8[§cAdmin§8]")
check("no rank means no tag", renderTag(undefined), "")
check("tokens are substituted", render("format.chat", { TAG: "[A]", NAME: "Steve", MSG: "hi", RANK: "" }), "[A] §7Steve §8» §rhi")
setSetting("format.nameTag", "{TAG}\n{NAME}")
check("a typed \n becomes a real line break", render("format.nameTag", { TAG: "[A]", NAME: "Steve" }), "[A]\nSteve")
resetSetting("format.nameTag")

console.log("\n— the config block round-trips —")
const block = toBlock()
const parsed = fromBlock(block)
check("the generated block parses", parsed.error, undefined)
check("no unknown keys in our own output", parsed.unknown, [])
// The block also carries a "preset" line, which is not a setting — it names the
// baseline and is applied separately, so it is excluded here on purpose.
check("every setting key survives",
    Object.keys(parsed.values).filter(k => k !== "preset").sort(), Object.keys(DEFAULTS).sort())
check("the preset line rides along", "preset" in parsed.values, true)
check("and is never mistaken for a setting", parsed.unknown.includes("preset"), false)
check("values survive unchanged", parsed.values["format.chat"], DEFAULTS["format.chat"].value)

console.log("\n— the block tolerates what people actually type —")
check("comments and blank lines are skipped", fromBlock("# note\n\n  \nbracket.open = [").values, { "bracket.open": "[" })
check("a value containing = is kept whole", fromBlock("format.chat = a=b=c").values["format.chat"], "a=b=c")
check("colour codes survive", fromBlock("bracket.open = §8[").values["bracket.open"], "§8[")
check("an empty value is allowed", fromBlock("format.noRankTag =").values["format.noRankTag"], "")
check("windows line endings are handled", Object.keys(fromBlock("a.b = 1\r\nc.d = 2").values), ["a.b", "c.d"])
check("unknown keys are reported, not silently kept", fromBlock("nonsense.key = 1").unknown, ["nonsense.key"])

console.log("\n— a malformed block changes nothing —")
const before = JSON.stringify(overrides())
const broken = fromBlock("bracket.open = [\nthis line has no equals sign")
check("the bad line is named", broken.error.includes("Line 2"), true)
check("no values come back from a failed parse", broken.values, undefined)
check("nothing was stored", JSON.stringify(overrides()), before)
check("a key with nothing before = is rejected", fromBlock("  = orphan").error.includes("Line 1"), true)

console.log("\n— < Code > needs BOTH the tag and op —")
const mk = (tags, level) => ({ name: "T", getTags: () => tags, commandPermissionLevel: level })
check("tag + op passes", canUseCode(mk(["Dev"], 1)), true)
check("tag alone is not enough", canUseCode(mk(["Dev"], 0)), false)
check("op alone is not enough", canUseCode(mk([], 1)), false)
check("neither fails", canUseCode(mk([], 0)), false)
check("the tag is case-insensitive", canUseCode(mk(["dev"], 1)), true)
check("a lookalike tag does not pass", canUseCode(mk(["Developer"], 1)), false)

console.log("\n— display names —")
const p = { id: "n1", name: "Nova" }
check("no nickname means the account name", displayName(p), "Nova")
setNickname(p, "§dStarlight")
check("nickname takes over", displayName(p), "§dStarlight")
check("and is recorded as set", hasNickname(p), true)
check("control characters are stripped", setNickname(p, "Line1\nLine2"), "Line1Line2")
check("spaces and hyphens survive", setNickname(p, "Big Red-Dog"), "Big Red-Dog")
check("length is capped", setNickname(p, "z".repeat(80)).length, NICK_MAX)
check("clearing falls back to the account name", setNickname(p, "   "), undefined)
check("really cleared", [getNickname(p), displayName(p)], [undefined, "Nova"])

console.log("\n— the permission editor is switchable —")
check("ships as toggles", setting("ranks.permissionEditor"), "toggle")
setSetting("ranks.permissionEditor", "dropdown")
check("switches to dropdown", setting("ranks.permissionEditor"), "dropdown")
setSetting("ranks.permissionEditor", "DropDown ")
check("case and spacing tolerated",
    String(setting("ranks.permissionEditor")).trim().toLowerCase(), "dropdown")
resetSetting("ranks.permissionEditor")
check("resets to toggles", setting("ranks.permissionEditor"), "toggle")

console.log("\n— what kind of value each key holds —")
// The Edit Config screen infers a control from the SHIPPED default rather than
// from a field on every entry. That inference has to stay right, or the screen
// renders a toggle for a format string.
check("a true default is a switch", kindOf("presence.announce"), "bool")
check("a false default too", kindOf("cleanup.fallingBlocks"), "bool")
check("a numeric default is a number", kindOf("spawn.radius"), "number")
check("a format string is text", kindOf("format.chat"), "text")
check("so is a colour code", kindOf("bracket.open"), "text")
// "" is an empty list, not zero — Number("") is 0 and finite, which is exactly
// the trap this guards.
check("a blank default is text, not a number", kindOf("automod.oreThresholds"), "text")
check("an unknown key is text", kindOf("nope.not.a.key"), "text")

console.log("\n— every key classifies, and bools really are true/false —")
const kinds = Object.keys(DEFAULTS).map(kindOf)
check("nothing falls outside the three kinds",
    kinds.every(k => ["bool", "number", "text"].includes(k)), true)
check("every bool default is literally true or false",
    Object.keys(DEFAULTS).filter(k => kindOf(k) === "bool")
        .every(k => ["true", "false"].includes(DEFAULTS[k].value)), true)
check("every number default parses as one",
    Object.keys(DEFAULTS).filter(k => kindOf(k) === "number")
        .every(k => Number.isFinite(Number(DEFAULTS[k].value))), true)

console.log("\n— the config screen groups every key, exactly once —")
const grouped = groupedKeys()
const flat = grouped.flatMap(([, keys]) => keys)
check("every key is on the screen", flat.length, Object.keys(DEFAULTS).length)
check("and none of them twice", new Set(flat).size, flat.length)
check("the set matches DEFAULTS exactly",
    flat.slice().sort().join(),  Object.keys(DEFAULTS).slice().sort().join())
check("a group is never empty", grouped.every(([, keys]) => keys.length > 0), true)
check("a heading is never blank", grouped.every(([name]) => name.length > 0), true)
// A new key with an unmapped prefix still renders — it just gets a plain
// capitalised heading. This catches the case where that fallback is silently
// carrying a real group that deserves a proper name.
// Not "does it render" — everything renders, the fallback sees to that. The
// thing worth catching is a NEW key prefix nobody wrote a heading for, which
// would show up as a bare capitalised word and read like a bug.
check("every shipped prefix has a heading written for it",
    Object.keys(DEFAULTS).every(key => key.split(".")[0] in GROUPS), true)
check("and no heading is written for a prefix that no longer exists",
    Object.keys(GROUPS).every(prefix =>
        Object.keys(DEFAULTS).some(key => key.startsWith(prefix + "."))), true)
check("keys keep their own group", groupOf("format.chat"), "Formatting")
check("the lag-clear keys are cleanup.*, and say so", groupOf("cleanup.items"), "Lag clear")
check("an unmapped prefix is capitalised, not dropped", groupOf("brandnew.thing"), "Brandnew")
check("a key with no dot still groups", groupOf("loose"), "Loose")

replaceOverrides({})

console.log("\n— /mode is a door, not a second authority —")
// The gate is "operator, deliberately". /mode grants nothing an op did not
// already have, because /tag is vanilla and answers to op. These pin that.
const devTags = new Set()
const opPlayer = {
    name: "Op", commandPermissionLevel: 1,
    getTags: () => [...devTags], addTag: t => devTags.add(t), removeTag: t => devTags.delete(t)
}
check("an op is not in developer mode by default", inDeveloperMode(opPlayer), false)
check("so < Code > is shut", canUseCode(opPlayer), false)

setDeveloperMode(opPlayer, true)
check("switching on writes the tag", inDeveloperMode(opPlayer), true)
check("and an OP in developer mode gets in", canUseCode(opPlayer), true)

setDeveloperMode(opPlayer, false)
check("switching off takes it away", inDeveloperMode(opPlayer), false)
check("and shuts the door again", canUseCode(opPlayer), false)

// The half that matters: the tag ALONE is not the gate, which is why /mode
// asking for operator does not weaken anything.
const taggedNonOp = {
    name: "NotOp", commandPermissionLevel: 0,
    getTags: () => ["Dev"], addTag: () => true, removeTag: () => true
}
check("a non-op holding the tag is still refused", canUseCode(taggedNonOp), false)
check("even though the tag is really there", inDeveloperMode(taggedNonOp), true)
check("because operator is the other lock", hasOperator(taggedNonOp), false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
