import { __test } from "@minecraft/server"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { normalise, findTerm, screen, termsFor, CATEGORIES } from "../Admin+ BP/scripts/core/chatfilter.js"
import { hold, heldMessages, heldCount, removeHeld, clearHeld, getHeld } from "../Admin+ BP/scripts/core/heldchat.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const sender = { id: "cf1", name: "Talker", getTags: () => [], sendMessage: () => {} }
__test.players.push(sender)

console.log("\n— folding a message down —")
// Both sides go through this, message and term alike. A filter that normalised
// only the haystack would stop matching its own list the moment somebody typed
// a 1 instead of an i.
{
    check("case goes", normalise("SHOUTING", 1), "shouting")
    check("zero-width characters go", normalise("a​b​c", 1), "abc")
    // Cyrillic а renders identically to Latin a and is the oldest trick there is.
    check("lookalike letters fold at level 1", normalise("аbc", 1), "abc")
    check("but leet does NOT, at level 1", normalise("4bc", 1), "4bc")
    check("leet folds at level 2", normalise("4bc", 2), "abc")
    check("and stutter collapses", normalise("noooooo", 2), "no")
    check("level 2 keeps word gaps", normalise("bad word", 2), "bad word")
    check("level 3 removes them, which is how f.u.c.k is caught",
        normalise("b.a.d w.o.r.d", 3), "badword")
}

console.log("\n— the Scunthorpe problem, which is the thing that will misfire —")
// Substring matching finds banned words inside innocent ones, and the folding
// above makes it worse. Levels 1 and 2 match WHOLE WORDS for exactly this
// reason; only level 3 looks inside, and only with an allow list beside it.
{
    const terms = ["ass"]
    check("a whole-word level does not flag 'class'",
        findTerm("what a class build", terms, 2), undefined)
    check("nor 'pass' or 'bass'",
        findTerm("pass me the bass", terms, 2), undefined)
    check("but it does flag the word itself",
        findTerm("you ass", terms, 2), "ass")

    // Level 3 WILL flag class — that is what it is for, and why it is not the
    // default. The allow list is the only thing standing between it and every
    // word containing another.
    check("level 3 flags it inside a word, as designed",
        findTerm("what a class build", terms, 3), "ass")
    check("unless the innocent word is allowed",
        findTerm("what a class build", terms, 3, ["class"]), undefined)
    check("and allowing one word does not excuse the real one",
        findTerm("class, you ass", terms, 3, ["class"]), "ass")
}

console.log("\n— evasion —")
{
    const terms = ["badword"]
    check("straight through", findTerm("that is a badword", terms, 2), "badword")
    check("leet spelling", findTerm("that is a b4dw0rd", terms, 2), "badword")
    check("stretched out", findTerm("baaaadword", terms, 2), "badword")
    check("mixed case and lookalikes", findTerm("BАDword", terms, 2), "badword")
    // Separators only fall at level 3 — at level 2 the word is genuinely broken
    // into pieces and matching it would mean matching across every space.
    check("dots need level 3", findTerm("b.a.d.w.o.r.d", terms, 2), undefined)
    check("and level 3 gets them", findTerm("b.a.d.w.o.r.d", terms, 3), "badword")
    // A multi-word term is looked for in the line, not in the word set.
    check("a phrase is matched as a phrase",
        findTerm("just kill yourself mate", ["kill yourself"], 2), "kill yourself")
}

console.log("\n— what ships, and what deliberately does not —")
{
    const byId = id => CATEGORIES.find(c => c.id === id)
    // **Discrimination ships with NO terms, on purpose.** A slur list belongs to
    // a community and a language; shipping one would be this pack deciding what
    // a realm somewhere else finds unacceptable. Pinned so the choice is a
    // decision somebody has to undo deliberately, not an oversight.
    check("discrimination ships empty", termsFor(byId("discrimination")).length, 0)
    check("and the other three do not",
        ["sexual", "aggression", "profanity"].every(id => termsFor(byId(id)).length > 0), true)

    // Which means it catches nothing until configured — honest, where a token
    // list pretending to cover the subject would not be.
    setSetting("filter.terms.discrimination", "madeupslur")
    check("once the owner fills it in, it works",
        screen("you are a madeupslur")?.category, "discrimination")
    resetSetting("filter.terms.discrimination")
    check("and goes quiet again when they empty it",
        screen("you are a madeupslur"), undefined)
}

console.log("\n— screening a message —")
{
    check("an ordinary line passes", screen("anyone want to trade iron"), undefined)
    check("hostility is caught out of the box", screen("just kys")?.category, "aggression")
    check("and says which term did it", screen("just kys")?.term, "kys")

    // Profanity ships OFF: holding every "shit" buries the queue, and the queue
    // only works if a moderator can actually face reading it.
    check("swearing is not held by default", screen("oh shit"), undefined)
    setSetting("filter.profanity", "2")
    check("until you turn it on", screen("oh shit")?.category, "profanity")
    resetSetting("filter.profanity")

    setSetting("filter.enabled", "false")
    check("the master switch stops everything", screen("just kys"), undefined)
    resetSetting("filter.enabled")

    setSetting("filter.aggression", "0")
    check("a category at 0 is off", screen("just kys"), undefined)
    resetSetting("filter.aggression")
}

console.log("\n— the queue —")
// Held, not deleted and not punished. A false positive has to stay recoverable,
// which is the whole argument for a queue over an auto-mute.
{
    clearHeld()
    const flagged = screen("just kys")
    const entry = hold(sender, "just kys", "general", flagged)
    check("it goes in", heldCount(), 1)
    check("carrying who said it", heldMessages()[0].player.name, "Talker")
    // The channel matters: releasing a Staff line into General would be a worse
    // accident than holding it was.
    check("and where it was going", heldMessages()[0].channel, "general")
    check("and what caught it", heldMessages()[0].category, "aggression")
    check("it can be found again", getHeld(entry.id)?.id, entry.id)

    check("taking it out returns it", removeHeld(entry.id)?.id, entry.id)
    check("and it is gone", heldCount(), 0)
    check("taking a missing one is not an error", removeHeld("nope"), undefined)

    // A realm that never reads the queue must not grow it without bound.
    setSetting("filter.holdCap", "5")
    for (let i = 0; i < 20; i++) hold(sender, `line ${i}`, "general", flagged)
    check("the queue has a ceiling", heldCount(), 5)
    check("and keeps the NEWEST, which is what somebody is coming to read",
        heldMessages()[0].message, "line 19")
    resetSetting("filter.holdCap")
    clearHeld()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
