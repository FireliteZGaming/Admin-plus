import { readFileSync } from "node:fs"
import { MULTILINE, multilineTitle, hubTitle } from "../Admin+ BP/scripts/core/theme.js"
import { toBlock, blockHasNoConfig } from "../Admin+ BP/scripts/features/code.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// The multi-line config editor.
//
// There is no script API for a multi-line form field. The resource pack watches
// every form title, and when it finds a sentinel it draws the form's inputs with
// the multi-line control vanilla already has for NPC dialogue. So the script and
// the pack agree on a magic string across two files in two different languages,
// and NOTHING AT RUNTIME REPORTS A DISAGREEMENT — the form just quietly opens
// with a one-line box again, which is precisely the state we were trying to
// leave. That is what this file is for.

const RP = JSON.parse(readFileSync(new URL("../Admin+ RP/ui/server_form.json", import.meta.url), "utf8"))
const SWITCH = RP.custom_form_switch

console.log("\n— the sentinel is the same string on both sides —")
check("the pack has a flag", typeof SWITCH?.$flag_form_title, "string")
check("and it is exactly the one the scripts send", SWITCH.$flag_form_title, MULTILINE)

console.log("\n— it has to be invisible, or every title carries junk —")
// A sentinel is only usable if it prints nothing. Bedrock eats "§" plus one
// character as a formatting code, valid or not, so a string of nothing but
// those pairs renders empty.
check("it is nothing but section-sign pairs", /^(?:§.)+$/.test(MULTILINE), true)
check("so no character stands on its own", MULTILINE.length % 2, 0)
check("and it is not empty, which would match every title", MULTILINE.length > 0, true)

console.log("\n— where it goes in a title —")
const title = multilineTitle("code", "< Code >")
check("the flag is at the END", title.endsWith(MULTILINE), true)
check("a prefix would restyle the words after it, so it is not one", title.startsWith(MULTILINE), false)
check("the ordinary title is still in there", title.includes("< Code >"), true)
check("it is the plain title plus the flag", title, hubTitle("code", "< Code >") + MULTILINE)

console.log("\n— ordinary screens must NOT trip it —")
// Every other form in the pack goes through hubTitle. If one of those ever
// contained the sentinel, that screen would silently turn multi-line.
check("a plain hub title does not contain it", hubTitle("settings", "Settings").includes(MULTILINE), false)
check("nor does one that mentions code", hubTitle("code", "Unknown keys").includes(MULTILINE), false)

console.log("\n— the upstream flag still works —")
// Chest-UI shipped this machinery with "JavaScript REPL" as the trigger. Keeping
// it means a pack that speaks the original protocol still renders correctly if
// it wins the resource-pack order, which is the same courtesy the chest grid
// pays. Dropping it would break them for no gain.
check("the original trigger is kept as an alternate", SWITCH.$flag_form_title_alt, "JavaScript REPL")

console.log("\n— the two panels are exact opposites —")
// One binding shows the ordinary form, the other the multi-line one. If they are
// not complements you get both at once, or neither, and the form looks broken
// rather than wrong.
const [plainPanel, multiPanel] = SWITCH.controls
const plainExpr = plainPanel["custom_form@server_form.custom_form"]
    .bindings.find(b => b.target_property_name === "#visible").source_property_name
const multiExpr = multiPanel["custom_multiline_form@server_form.custom_multiline_form"]
    .bindings.find(b => b.target_property_name === "#visible").source_property_name
check("the multi-line panel shows exactly when the plain one does not", multiExpr, `(not ${plainExpr})`)
check("both flags are consulted", plainExpr.includes("$flag_form_title") && plainExpr.includes("$flag_form_title_alt"), true)

console.log("\n— the control chain the pack needs is all present —")
// Five controls, each inheriting the next. Any one of them missing and the form
// falls back without saying so. The last one is the point of the whole exercise:
// a control vanilla already ships, for the NPC dialogue editor.
for (const control of [
    "custom_form_switch",
    "custom_multiline_form@common_dialogs.main_panel_no_buttons",
    "custom_multiline_form_panel",
    "custom_multiline_input@server_form.option_multiline_text_edit",
    "option_multiline_text_edit@settings_common.option_generic",
    "multiline_dialog_text_edit@npc_interact.multiline_text_edit_control"
]) {
    check(`${control.split("@")[0]} is defined`, control in RP, true)
}
check("the input is wired to the multi-line option, not the one-line one",
    RP.custom_multiline_form_panel.controls[0].generated_contents.factory.control_ids.input,
    "@server_form.custom_multiline_input")
check("and it takes a whole config, not a line of one",
    RP["custom_multiline_input@server_form.option_multiline_text_edit"].$max_text_edit_length > 3000, true)

console.log("\n— < Code > actually asks for it —")
const source = readFileSync(new URL("../Admin+ BP/scripts/features/code.js", import.meta.url), "utf8")
check("the editor uses multilineTitle", source.includes("multilineTitle(\"code\""), true)
check("and nothing in the pack hardcodes the sentinel instead of importing it",
    (source.match(/§c§o§d§e/g) ?? []).length, 0)

console.log("\n— the whole config has to FIT in the field —")
// Past $max_text_edit_length the box truncates, and a truncated document parses
// perfectly well: the keys past the cut are simply absent, and submitting then
// reverts every one of them to default. Silent, and shaped exactly like the
// storage bug this project already paid for once. The block grows every time a
// config key is added, so the margin is worth watching rather than assuming.
const block = toBlock()
const cap = RP["custom_multiline_input@server_form.option_multiline_text_edit"].$max_text_edit_length
check("the config block fits", block.length < cap, true)
check("with room for the config to keep growing", block.length < cap / 2, true)

console.log("\n— an empty document must not wipe the config —")
// Submitting REPLACES the override table with whatever came back. A real
// multi-line box makes select-all-and-type a one-gesture accident, so the empty
// case is refused rather than obeyed. Factory Reset is the deliberate door and
// it asks first.
check("an empty field is refused", blockHasNoConfig(""), true)
check("so is whitespace", blockHasNoConfig("   \n\n\t "), true)
check("so is a document of nothing but comments", blockHasNoConfig("# just a note\n# and another"), true)
check("so is one with only unrecognised keys", blockHasNoConfig("nonsense.key = 1"), true)
check("a preset line alone is refused too, since the values would still be lost",
    blockHasNoConfig("preset = strict"), true)

// The other half of the rule: deleting a line is how you say "default this
// one", so a shrunken document is NOT the accident case and must still save.
check("the real block saves", blockHasNoConfig(block), false)
check("and so does a single surviving key", blockHasNoConfig("bracket.open = ["), false)
check("a parse error is left to the parser's own message",
    blockHasNoConfig("this line has no equals sign"), false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
