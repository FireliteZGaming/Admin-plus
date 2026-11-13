import { menu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry, multilineTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { has } from "../core/ranks.js"
import { parse, LIMITS } from "../core/automation.js"
import {
    automationList, getAutomation, saveAutomation, setAutomationOn, renameAutomation,
    deleteAutomation, previewAutomation, triggersOf, lastRunOf, canChange
} from "./automation.js"

// Server ▸ Automation. A list of automations, each with its own on/off, like
// Shortcuts. Each is written in the tall text editor Saved setups uses, with
// the instructions on top, as the user asked: "for now just text editor and
// instructions on how to use on top". Building blocks come later and will
// write the same text.

const NODE = "admin.automation"

/** The lines above the text box. */
const INSTRUCTIONS = [
    "§8when join { if ({RANK} == \"Owner\") { say \"Hi {NAME}\" } }",
    "§8When: join, first join, leave, chat, death, respawn, every 5 minutes",
    "§8Check: == != contains, and or not, has rank \"VIP\", is staff",
    "§8Do: say, tell, tell staff, title, actionbar, sound, warp, give rank, take rank, wait, stop",
    "§8Chat only: cancel, replace \"new words\"",
    "§8Words: {NAME} {NICKNAME} {RANK} {MSG} {ONLINE}"
]

/** What a new automation starts with, so the box is never blank. */
const STARTER = [
    "// Say what this automation is for.",
    "when join {",
    "    tell \"Welcome, {NAME}!\"",
    "}"
].join("\n")

function allowed(player, back) {
    if (has(player, NODE)) return true
    err(player, "You can't change automations.")
    back()
    return false
}

function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
    if (s < 60) return "just now"
    if (s < 3600) return `${Math.round(s / 60)} minute(s) ago`
    if (s < 86400) return `${Math.round(s / 3600)} hour(s) ago`
    return `${Math.round(s / 86400)} day(s) ago`
}

export async function automationScreen(player, back) {
    if (!allowed(player, back)) return
    const again = () => automationScreen(player, back)
    const list = automationList()
    const on = flag("feature.automation")
    return menu(player, {
        title: hubTitle("settings", "Automation"),
        body: subtitle(on
            ? "Automations run by themselves: when something happens,\nthey check a condition and do something."
            : "Automation is switched off, so none of these run.\nServer ▸ Settings ▸ Automation turns it on."),
        buttons: [
            list.length < LIMITS.maxAutomations
                ? { text: hubEntry("settings", "+ New automation", "Name it, then write it"), run: () => newAutomation(player, again) }
                : null,
            ...list.map(rec => ({
                text: `${rec.on ? "§2●" : "§8○"} §8${rec.name}§r\n§8${triggersOf(rec)} · ${rec.on ? "on" : "off"}${rec.lastError ? " · §4a problem" : ""}`,
                run: () => detailScreen(player, rec.id, again)
            })),
            { text: hubEntry("about", "How to write automations", "Examples of everything they can do"), run: () => guideScreen(player, again) }
        ].filter(Boolean),
        back
    })
}

async function newAutomation(player, back) {
    if (!allowed(player, back)) return
    const values = await modal(player, hubTitle("settings", "New automation"), [
        { id: "name", type: "text", label: "Name\n§8A few words, like Welcome owners. Up to 32 letters.", placeholder: "Welcome owners" }
    ])
    if (!values) return back()
    const name = String(values.name ?? "").replace(/§./g, "").trim()
    if (!name) { info(player, "Give it a name first."); return back() }
    return editorScreen(player, { name, source: STARTER }, back)
}

/**
 * The text editor. A mistake opens it again with the same text and the
 * problem on top. Closing it changes nothing.
 */
async function editorScreen(player, draft, back, problem) {
    if (!allowed(player, back)) return
    const values = await modal(player, multilineTitle("settings", `Automation · ${draft.name}`), [{
        id: "source",
        type: "text",
        label: [
            problem ? `§4${problem}` : "§8Write it below, then Submit. Closing changes nothing.",
            ...INSTRUCTIONS
        ].join("\n"),
        placeholder: "when join { ... }",
        default: draft.source
    }])
    if (!values) return back()
    const source = String(values.source ?? "")

    // An empty box is never saved as "nothing": it asks first.
    if (parse(source).empty) {
        if (!draft.id) { info(player, "Nothing was saved, because the box was empty."); return back() }
        const yes = await confirm(player, hubTitle("settings", "Automation"), `The box came back empty.\n\nDelete §f${draft.name}§r?`, "§cDelete it")
        if (!yes) return editorScreen(player, draft, back)
        deleteAutomation(player, draft.id)
        ok(player, `Deleted §f${draft.name}§a.`)
        return back()
    }

    const result = saveAutomation(player, { id: draft.id, name: draft.name, source })
    if (!result.ok) return editorScreen(player, { ...draft, source }, back, result.error)
    ok(player, `${result.made ? "Made" : "Saved"} §f${result.record.name}§a.${result.record.on ? " It's on." : " It's off."}`)
    return detailScreen(player, result.record.id, back)
}

async function detailScreen(player, id, back) {
    if (!allowed(player, back)) return
    const rec = getAutomation(id)
    if (!rec) { err(player, "That automation no longer exists."); return back() }
    const again = () => detailScreen(player, id, back)
    const ran = lastRunOf(id)
    const mine = canChange(player, rec)
    return menu(player, {
        title: hubTitle("settings", rec.name),
        body: [
            `§7Runs: §f${triggersOf(rec)}`,
            `§7It's ${rec.on ? "§2on" : "§4off"}§7.`,
            `§7Saved by ${rec.author?.name ?? "?"} ${rec.saved ? ago(rec.saved) : ""}.`,
            ran ? `§7Last ran ${ago(ran)}.` : "§7It hasn't run since the world loaded.",
            rec.lastError ? `§4Last problem: ${rec.lastError}` : "",
            mine ? "" : "§8Someone who outranks you saved this, so you can only try it."
        ].filter(Boolean).join("\n"),
        buttons: mine ? [
            { text: hubEntry("settings", "Edit", "Open it in the text editor"), run: () => editorScreen(player, { id, name: rec.name, source: rec.source }, again) },
            {
                text: rec.on ? hubEntry("settings", "Turn off", "It stays here, and does nothing") : hubEntry("settings", "Turn on", "Start running it again"),
                run: () => {
                    setAutomationOn(player, id, !rec.on)
                    ok(player, `§f${rec.name}§a is ${rec.on ? "off" : "on"}.`)
                    return again()
                }
            },
            { text: hubEntry("settings", "Try it on me", "Shows what it would do, and does nothing"), run: () => tryScreen(player, id, again) },
            { text: hubEntry("settings", "Rename"), run: () => renameScreen(player, id, again) },
            { text: hubEntry("actions", "Delete"), run: () => deleteScreen(player, id, back, again) }
        ] : [
            { text: hubEntry("settings", "Try it on me", "Shows what it would do, and does nothing"), run: () => tryScreen(player, id, again) }
        ],
        back
    })
}

async function tryScreen(player, id, back) {
    const rec = getAutomation(id)
    if (!rec) return back()
    let message = "test"
    if (/when\s+chat/i.test(rec.source)) {
        const values = await modal(player, hubTitle("settings", "Try it on me"), [
            { id: "message", type: "text", label: "A chat message to try it with\n§8Nothing is sent.", placeholder: "hello" }
        ])
        if (!values) return back()
        message = String(values.message ?? "") || "test"
    }
    const lines = previewAutomation(player, id, message)
    info(player, [`§7${rec.name}, tried on you:`, ...lines.map(line => `§8· §f${line}`)].join("\n"))
    return back()
}

async function renameScreen(player, id, back) {
    const rec = getAutomation(id)
    if (!rec) return back()
    const values = await modal(player, hubTitle("settings", "Rename"), [
        { id: "name", type: "text", label: "Name\n§8Up to 32 letters.", default: rec.name }
    ])
    if (!values) return back()
    const name = String(values.name ?? "").replace(/§./g, "").trim()
    if (!name || name === rec.name) return back()
    renameAutomation(player, id, name)
    ok(player, `Renamed to §f${name}§a.`)
    return back()
}

async function deleteScreen(player, id, listBack, back) {
    const rec = getAutomation(id)
    if (!rec) return listBack()
    const yes = await confirm(player, hubTitle("settings", "Delete"), `Delete §f${rec.name}§r?\n\n§8This can't be undone. Turning it off keeps it instead.`, "§cDelete it")
    if (!yes) return back()
    deleteAutomation(player, id)
    ok(player, `Deleted §f${rec.name}§a.`)
    return listBack()
}

/** Examples of everything, as the design note has them. */
async function guideScreen(player, back) {
    return menu(player, {
        title: hubTitle("about", "How to write automations"),
        body: [
            "§7An automation is one or more §fwhen§7 blocks. Inside, §fif§7 checks",
            "§7something, and each line does one thing. Text goes in quotes.",
            "",
            "§fA welcome by rank",
            "§8when join {",
            "§8    if ({RANK} == \"Owner\") {",
            "§8        say \"The owner {NAME} is here!\"",
            "§8    } else {",
            "§8        tell \"Welcome, {NAME}. Type /menu to start.\"",
            "§8    }",
            "§8}",
            "",
            "§fAn answer only they see",
            "§8when chat {",
            "§8    if ({RANK} == \"Member\" and {MSG} contains \"lag\") {",
            "§8        tell \"Staff know about the lag.\"",
            "§8    }",
            "§8}",
            "",
            "§fA reminder on a timer",
            "§8every 20 minutes {",
            "§8    if ({ONLINE} >= 2) { say \"Vote at /warp contest\" }",
            "§8}",
            "",
            "§fNew players",
            "§8when first join {",
            "§8    warp \"Spawn\"",
            "§8    title \"Welcome!\" \"Read the rules at /warp rules\"",
            "§8}",
            "",
            "§fWhen it runs",
            "§7join, first join, leave, chat, death, respawn, and every 5",
            "§7minutes (10 seconds at the shortest).",
            "",
            "§fChecks",
            "§7== != > < >= <=, contains, starts with, ends with.",
            "§7Join them with and, or, not. Also has rank \"VIP\",",
            "§7is staff, and chance 10%. Capital letters don't matter.",
            "",
            "§fWhat it can do",
            "§7say (everyone), tell (them), tell staff, title \"big\" \"small\",",
            "§7actionbar, sound \"random.levelup\", warp \"Spawn\",",
            "§7give rank \"VIP\" for 1 day, take rank \"VIP\", wait 5 seconds,",
            "§7stop. In when chat only: cancel, and replace \"new words\".",
            "",
            "§fRules that keep it safe",
            "§7An automation can only do what the person who saved it can do.",
            "§7A mistake doesn't save: the editor shows its line. One run does",
            `§7${LIMITS.actionsPerRun} things at most. Three problems in a row turn it off.`,
            "§7When it stops or changes a message, Logs keep the real words.",
            "",
            "§8Lines starting with // are notes, and do nothing."
        ].join("\n"),
        buttons: [],
        back
    })
}
