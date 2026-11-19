import { world } from "@minecraft/server"
import { menu } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { command } from "../core/registry.js"
import { info } from "../core/util.js"
import { tableReport } from "../core/storage.js"
import { ladder } from "../core/ranks.js"
import { detectServerPreset } from "../core/serverPresets.js"
import { SERVER_PRESETS_ON_HOLD, AUTOMOD_ON_HOLD } from "../core/hold.js"
import { ADMINPLUS_VERSION, CONFIG } from "../config.js"
import { discordLine } from "../core/links.js"

// /admin ▸ About ▸ Credits
//
// Two jobs. Name the author, and be straight about what was learned from whom.
//
// The second one matters more than it looks. Admin+ took TECHNIQUES from packs
// that solved Bedrock problems first — SafeGuard's realisation that .mcfunction
// files still run when a beta-gated script never starts, UltraVanish's discovery
// that invisibility does not hide armour and a bone-scaling animation does. No
// files of theirs are in this pack, and none of their assets. Saying which ideas
// came from where costs nothing and keeps that claim checkable; quietly not
// mentioning them would make the same code look like something else.

const AUTHOR = "FireliteZGaming"

/**
 * Code actually included here, under someone else's licence.
 *
 * Kept apart from the list below on purpose. The two are different debts, and
 * this screen used to blur them: it said nothing of anyone's shipped here,
 * which stopped being true the day the chest grid arrived.
 */
const INCLUDED = [
    {
        pack: "Chest-UI / ChestFormData",
        licence: "CC BY 4.0",
        who: "LeGend077, Herobrine64, Aex66",
        what: "The chest window /invsee opens in",
        how: "Bedrock gives scripts no container UI. This module found that a form's title and button icons are text a resource pack can read, so a marker in the title tells the pack to draw the form as a 9-column grid. Admin+ includes its ID table and its JSON-UI, both changed, and uses the same format on purpose, so two packs that use it can draw each other's windows, whichever pack is on top."
    }
]

/** Technique borrowed, file not. Each line has to stay true. */
/**
 * Where the pack officially lives.
 *
 * On the credits screen rather than only in the README, because the person who
 * needs it is standing in a world somebody else installed this into: "is this
 * the real thing, and where do updates come from" is a question you ask from
 * inside the game. A reuploaded copy cannot answer it; this can.
 */
const HOMES = [
    { where: "CurseForge", url: "curseforge.com/minecraft-bedrock/addons/adminplus" },
    { where: "MCPEDL",     url: "mcpedl.com/adminplus/" },
    { where: "GitHub",     url: "github.com/FireliteZGaming/Admin-plus" },
    { where: "YouTube",    url: "youtube.com/@firelitezgaming" }
]

const LEARNED_FROM = [
    {
        pack: "SafeGuard",
        what: "Warning players when Beta APIs are off",
        how: "A script that needs Beta APIs can't say it is missing, because it never runs. Function files still run, so a check in functions/admin/ is what reaches players when no Admin+ script is running."
    },
    {
        pack: "ChestFormData",
        what: "Showing an inventory as a real chest grid",
        how: "Bedrock gives scripts no container UI. The community found that a form's title and button icons are text a resource pack can read, so a marked title and numbered icons can be drawn as a 9-column grid of real item pictures. Herobrine64 and LeGend077 maintain this format, and most addons that show an inventory use it. Admin+ uses the same format, so its chest windows still draw correctly when another pack that uses it is on top."
    },
    {
        pack: "UltraVanish",
        what: "Hiding armour while vanished",
        how: "The invisibility effect still shows armour and held items. A resource-pack animation that shrinks the whole model to nothing hides them, and it is applied every tick because it wears off on its own."
    }
]

// People who helped shape Admin+. The user, 2026-11-12, about the tester who
// showed how far Saved setups can go: "this guy can be in the in-mod credits".
const THANKS = [
    { who: "King bacon6016", what: "tester, and the spark for Automation" }
]

export async function creditsScreen(player, back) {
    return menu(player, {
        title: hubTitle("about", "Credits"),
        body: [
            `§l§bAdmin§d+§r §8v${ADMINPLUS_VERSION}`,
            "",
            `§fBuilt by §d§l${AUTHOR}§r`,
            "",
            "§7Admin tools for Bedrock: ranks, moderation, warps,",
            AUTOMOD_ON_HOLD ? "§7TPA and chat rooms. No economy and no shop:" : "§7TPA, chat rooms and automod. No economy and no shop:",
            "§7the §f+§7 means essentials.",
            "",
            // The user, 2026-11-14: "Axiomation Syndicate is what we slap on our thing".
            "§fAn Axiomation Syndicate project",
            "§8The part of Overhang Studio that makes in-game mods,",
            "§8mostly for Minecraft. © 2026 Axiomation Syndicate.",
            "",
            "§fIncludes code from",
            ...INCLUDED.map(entry => `§8· §f${entry.pack}§8, ${entry.licence}`),
            "",
            "§fTechniques learned from",
            ...LEARNED_FROM.map(entry => `§8· §f${entry.pack}§8: ${entry.what}`),
            "",
            "§8No code from the second list is included. The ideas were",
            "§8rewritten here. Tap one to read what was learned.",
            "",
            // Its own place, asked for on 2026-11-12: where to get help, hear
            // about updates and suggest presets. Presets are hidden since
            // 2.12.9 (core/hold.js), so the line doesn't ask for them.
            "§fDiscord",
            SERVER_PRESETS_ON_HOLD ? "§7Help, updates and ideas:" : "§7Help, updates, and ideas for new presets:",
            `  ${discordLine()}`,
            "",
            "§fTesters and thanks",
            ...THANKS.map(t => `§8· §f${t.who}§8: ${t.what}`),
            "",
            "§fLinks",
            ...HOMES.map(home => `§8· ${home.where}\n  §7${home.url}`)
        ].join("\n"),
        buttons: [...INCLUDED, ...LEARNED_FROM].map(entry => ({
            text: `§b${entry.pack}§r\n§8${entry.what}`,
            run: () => techniqueScreen(player, entry, () => creditsScreen(player, back))
        })),
        back
    })
}

async function techniqueScreen(player, entry, back) {
    return menu(player, {
        title: hubTitle("about", entry.pack),
        body: [
            `§f${entry.what}`,
            "",
            `§7${entry.how}`,
            "",
            ...(entry.licence
                ? [
                    `§fBy §r${entry.who}`,
                    `§fUnder §r${entry.licence}§7, modified.`,
                    "§8creativecommons.org/licenses/by/4.0",
                    "§8Every file used is listed in THIRD-PARTY-NOTICES.md."
                ]
                : [
                    `§8Written from scratch. No code from ${entry.pack} is`,
                    "§8included. The idea is theirs, and the code is Admin+'s."
                ])
        ].join("\n"),
        buttons: [],
        back
    })
}

// ------------------------------------------------------------ /version

/**
 * Is the Beta APIs experiment on?
 *
 * Asked of the engine rather than of our own chat module, on purpose — this is
 * the one screen somebody opens when they think something is broken, and it
 * should not be reporting a cached opinion. `chatSend` is the gate everything
 * beta-only in this pack sits behind.
 */
function betaApis() {
    try { return !!world.beforeEvents?.chatSend?.subscribe } catch { return false }
}

/** The same three states main.js prints at startup, in one line. */
function storageLine() {
    let report
    try { report = tableReport() } catch (e) { return `§ccould not be read: ${e}` }
    const loaded = report.filter(t => t.fromStorage).length
    const stuck = report.filter(t => t.unreadable).length

    if (stuck) return `§c${stuck} of ${report.length} storage tables can't be read, so nothing will save`
    if (loaded === report.length) return `§aall ${report.length} storage tables read`
    if (!loaded) return `§eall ${report.length} storage tables read, but this world has no Admin+ data yet`
    return `§a${loaded}§7 of §a${report.length}§7 storage tables have saved data`
}

// /version — what am I running, and is it healthy.
//
// No permission node. Somebody who cannot open the panel can still be the
// person standing in front of a bug, and "what version are you on" is the first
// question anybody asks. Gating it would mean the answer is unavailable to
// exactly the people most likely to need to give it.
//
// It reports STORAGE, which is the part worth having in game: whether this
// world's data actually came back is otherwise only answerable by reading the
// content log on the host's machine.
command({
    name: "version",
    description: "See which version of Admin+ is running",
    run: (player) => {
        info(player, `§l§bAdmin§d+§r §fv${ADMINPLUS_VERSION}`)
        info(player, "§8Axiomation Syndicate © 2026")
        // While presets are hidden (core/hold.js), naming one would point
        // at a screen nobody can open.
        info(player, SERVER_PRESETS_ON_HOLD
            ? `§7Ranks: §f${ladder().length}`
            : `§7Preset: §f${detectServerPreset().label}§7, ${ladder().length} ranks`)
        info(player, `§7Storage: ${storageLine()}`)
        info(player, `§7Beta APIs: ${betaApis() ? "§aon" : "§coff (chat formatting and mutes need it)"}`)
        info(player, `§8When the game already has a command by that name, type §7/${CONFIG.ns}:§8<name>. §7/credits§8 shows who made Admin+.`)
    }
})

// /credits — the same screen as /admin ▸ About ▸ Credits.
//
// Also unGATED, and for a stronger reason than /version: this screen is where
// the pack keeps its word about whose work is in it and whose ideas are. An
// attribution nobody can reach is not an attribution.
command({
    name: "credits",
    description: "See who made Admin+",
    run: (player) => creditsScreen(player, () => { })
})

export { AUTHOR }
