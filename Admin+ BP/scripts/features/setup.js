import { world, system } from "@minecraft/server"
import { Table } from "../core/storage.js"
import { menu, modal, INCOMPLETE } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { record } from "../core/logs.js"
import { DEFAULTS, setting, flag, setSetting, resetSetting, overrides } from "../core/settings.js"
import {
    ranksTable, DEFAULT_RANKS, PRESETS, applyPreset, startFromScratch, canReplaceRankList,
    grantRank, heldRankIds, isRanked
} from "../core/ranks.js"
import {
    PLACE, RANK_CHOICES, AUTOMOD_LEVELS, ESSENTIALS, WORLD_SWITCHES,
    untouched, sameRanks, automodLevelOf, automodNow, settingChanges, summaryLines
} from "../core/setup.js"
import { ensureTerms, ownsServer } from "./terms.js"
import { adminplusDisabled } from "../core/terms.js"
import { createRankScreen, ranksScreen } from "./ranksUI.js"

// Setup (3.1.6), the half that touches the game; core/setup.js decides.
//
// An owner (an operator, or someone with the top rank and every permission)
// gets a welcome the first time they enter a world where nothing has been
// changed yet: Set up now, or Skip. Four steps follow, each one form: ranks,
// automod, the everyday commands, then chat and the world. A last screen
// says what Apply will do, and nothing is saved before Apply. Done or
// skipped, it ends on Admin+'s terms (features/terms.js).
//
// /admin shows a wide Set up button to owners until setup is done or anything
// is changed by hand (the user: "If you have it probably means you know what
// you are doing, specifically if you created a rank"). Server ▸ Advanced ▸
// Set up again runs it any time, with what's set now filled in.

/** What setup remembers for the world: { done, shown, skipped, by, at }. */
const state = new Table("setup", {})
const STATE = "world"
const OWNERS_ONLY = "Only an owner can run setup: an operator, or someone with the top rank and every permission."
const LOST = "Not every answer came back from the game, so nothing changed. Run setup again from /admin."

function readState() { return { ...(state.get(STATE) ?? {}) } }
function writeState(patch) { state.set(STATE, { ...readState(), ...patch }) }

/** Owners run setup. */
export function canSetUp(player) { return !!player && canReplaceRankList(player) }

/** Nothing changed yet: no setting off its default, and the ranks a new world starts with. */
export function worldUntouched() {
    return untouched({ overrides: overrides(), ranks: ranksTable.data, defaultRanks: DEFAULT_RANKS })
}

/** The wide Set up button in /admin: for owners, until setup is done or anything is changed. */
export function offersSetup(player) {
    return canSetUp(player) && !readState().done && worldUntouched()
}

/** Whether setup has been finished in this world. */
export function setupDone() { return !!readState().done }

/** The answers to start from: what's set now, so a second run changes only what's asked. */
function freshDraft() {
    const custom = !sameRanks(ranksTable.data, DEFAULT_RANKS)
    const level = automodLevelOf(setting)
    const automodCustom = !level && Object.keys(overrides()).some(key => key.startsWith("automod."))
    return {
        custom,
        automodCustom,
        ranks: custom ? "keep" : "basic",
        owner: true,
        automod: level || (automodCustom ? "keep" : "medium"),
        essentials: Object.fromEntries(ESSENTIALS.map(s => [s.key, flag(s.key)])),
        world: Object.fromEntries(WORLD_SWITCHES.map(s => [s.key, flag(s.key)]))
    }
}

/** Rank tags will show after these answers. */
function tagsAfter(draft) {
    if (draft.ranks === "none") return false
    if (draft.ranks === "keep") return flag("feature.ranktags")
    return true
}

// ------------------------------------------------------------------ screens

/** The welcome: Set up now, or Skip. Either way it ends on the terms. */
export async function setupScreen(player, back) {
    if (!canSetUp(player)) { err(player, OWNERS_ONLY); return back?.() }
    writeState({ shown: true })
    const draft = freshDraft()
    const again = draft.custom || draft.automodCustom || readState().done
    return menu(player, {
        title: hubTitle("presets", "Set up Admin+"),
        body: [
            "§fWelcome to Admin+.",
            `§7Four short steps set up your ${PLACE}: ranks, automod, the everyday commands, and chat. Nothing changes until you press Apply at the end.`,
            "§7A world, a Realm or a dedicated server: the steps are the same.",
            again ? "§7What's set now is filled in, so change only what you want." : null,
            "§7Then Admin+'s terms, which every owner accepts once."
        ].filter(Boolean).join("\n"),
        waitWhileBusy: 200,
        buttons: [
            { text: "§a§lSet up now§r\n§8About a minute", run: () => ranksStep(player, draft, back) },
            { text: "§lSkip for now§r\n§8Straight to the terms", run: () => skip(player, back) }
        ],
        onCancel: () => skip(player, back)
    })
}

async function ranksStep(player, draft, back) {
    const choices = RANK_CHOICES.filter(c => c.id !== "keep" || draft.custom)
    const holds = heldRankIds(player.id).includes("owner")
    const values = await modal(player, hubTitle("presets", "Setup · Ranks"), [
        {
            type: "label", label: [
                "§7Step 1 of 4: ranks.",
                "§7Ranks decide what each player can use, and the tag before their name.",
                draft.custom ? "§7This world already has ranks of its own." : null,
                ...choices.map(c => `§f${c.label}§7: ${c.says}.`)
            ].filter(Boolean).join("\n")
        },
        { id: "ranks", type: "dropdown", label: "Ranks", options: choices.map(c => c.label), default: Math.max(0, choices.findIndex(c => c.id === draft.ranks)) },
        { id: "owner", type: "toggle", label: holds ? "Give me the Owner rank §8(you have it)" : "Give me the Owner rank §8(with Basic ranks or your own)", default: draft.owner && !holds }
    ], { strict: true, submit: "Next" })
    if (values === undefined) return skip(player, back)
    if (values === INCOMPLETE) { err(player, LOST); return afterSetup(player, back) }
    if (values.ranks !== undefined && choices[values.ranks]) draft.ranks = choices[values.ranks].id
    if (values.owner !== undefined) draft.owner = values.owner
    return automodStep(player, draft, back)
}

async function automodStep(player, draft, back) {
    const options = [...(draft.automodCustom ? [{ id: "keep", label: "Keep what's set now" }] : []), ...AUTOMOD_LEVELS]
    const values = await modal(player, hubTitle("presets", "Setup · Automod"), [
        {
            type: "label", label: [
                "§7Step 2 of 4: automod.",
                "§7Automod watches for trouble so staff don't have to.",
                `§7Now: ${automodNow(setting)}.`,
                ...AUTOMOD_LEVELS.map(l => `§f${l.label}§7: ${l.says}.`),
                "§8Anti-cheat joins these levels when it's built."
            ].join("\n")
        },
        { id: "automod", type: "dropdown", label: "Automod", options: options.map(o => o.label), default: Math.max(0, options.findIndex(o => o.id === draft.automod)) }
    ], { strict: true, submit: "Next" })
    if (values === undefined) return skip(player, back)
    if (values === INCOMPLETE) { err(player, LOST); return afterSetup(player, back) }
    if (values.automod !== undefined && options[values.automod]) draft.automod = options[values.automod].id
    return essentialsStep(player, draft, back)
}

async function essentialsStep(player, draft, back) {
    const values = await modal(player, hubTitle("presets", "Setup · Everyday commands"), [
        { type: "label", label: "§7Step 3 of 4: the everyday commands.\n§7What players can use. A command switched off is gone, not refused." },
        ...ESSENTIALS.map(s => ({ id: s.key, type: "toggle", label: `${s.label} §8${s.says}`, default: !!draft.essentials[s.key] }))
    ], { strict: true, submit: "Next" })
    if (values === undefined) return skip(player, back)
    if (values === INCOMPLETE) { err(player, LOST); return afterSetup(player, back) }
    for (const s of ESSENTIALS) if (values[s.key] !== undefined) draft.essentials[s.key] = values[s.key]
    return worldStep(player, draft, back)
}

async function worldStep(player, draft, back) {
    const list = WORLD_SWITCHES.filter(s => !s.needsTags || tagsAfter(draft))
    // Badges ride on rank tags: with no tags, the switch isn't asked and stays as it is.
    for (const s of WORLD_SWITCHES) if (!list.includes(s)) delete draft.world[s.key]
    const values = await modal(player, hubTitle("presets", "Setup · Chat and world"), [
        { type: "label", label: "§7Step 4 of 4: chat and the world.\n§7How chat looks, and what runs by itself." },
        ...list.map(s => ({ id: s.key, type: "toggle", label: s.says ? `${s.label} §8${s.says}` : s.label, default: !!draft.world[s.key] }))
    ], { strict: true, submit: "Next" })
    if (values === undefined) return skip(player, back)
    if (values === INCOMPLETE) { err(player, LOST); return afterSetup(player, back) }
    for (const s of list) if (values[s.key] !== undefined) draft.world[s.key] = values[s.key]
    return reviewStep(player, draft, back)
}

/** The ranked part of a rank list: what a template or "own ranks" replaces. */
function rankedIds(ranks) {
    return Object.entries(ranks).filter(([, rank]) => isRanked(rank)).map(([id]) => id).sort()
}

function replacesRanks(draft) {
    if (draft.ranks === "basic") return !sameRanks(ranksTable.data, DEFAULT_RANKS)
    if (draft.ranks === "own") return rankedIds(ranksTable.data).join(",") !== "member,owner"
    return false
}

async function reviewStep(player, draft, back) {
    return menu(player, {
        title: hubTitle("presets", "Setup · Check and apply"),
        body: ["§7Nothing has changed yet. Apply does this:", "", ...summaryLines(draft, setting, { replacesRanks: replacesRanks(draft) })].join("\n"),
        buttons: [
            { text: "§a§lApply§r\n§8Save all of this", run: () => applySetup(player, draft, back) },
            { text: "§lStart over§r\n§8Back to step 1", run: () => ranksStep(player, freshDraft(), back) },
            { text: "§lSkip setup§r\n§8Change nothing", run: () => skip(player, back) }
        ],
        onCancel: () => skip(player, back)
    })
}

// ------------------------------------------------------------------ doing it

/** Save every answer. Ranks first, then settings, then one line in Logs. */
export async function applySetup(player, draft, back) {
    if (!canSetUp(player)) { err(player, OWNERS_ONLY); return back?.() }
    const before = overrides()
    const ranksBefore = replacesRanks(draft)
    if (draft.ranks === "basic" && ranksBefore) {
        applyPreset("server")
        record(player, "rank.preset", undefined, PRESETS.server.name, { kind: "ladder" })
    }
    if (draft.ranks === "own" && ranksBefore) {
        startFromScratch()
        record(player, "rank.preset", undefined, "Owner and Member", { kind: "ladder" })
    }
    if ((draft.ranks === "basic" || draft.ranks === "own") && draft.owner && !heldRankIds(player.id).includes("owner")) {
        const held = heldRankIds(player.id)
        if (grantRank(player.id, "owner", player.name)) {
            record(player, "rank.grant", { id: player.id, name: player.name }, "owner", { kind: "ranks", ranks: held })
        }
    }
    const changes = settingChanges(draft, setting)
    for (const { key, to } of changes) {
        // Back to a default is no override at all, so the world stays tidy.
        if (DEFAULTS[key]?.value === to) resetSetting(key)
        else setSetting(key, to)
    }
    writeState({ done: true, shown: true, by: player.name, at: Date.now() })
    const words = [
        RANK_CHOICES.find(c => c.id === draft.ranks)?.label ?? "ranks kept",
        `automod ${AUTOMOD_LEVELS.find(l => l.id === draft.automod)?.label ?? "kept"}`,
        `${changes.length} setting${changes.length === 1 ? "" : "s"} changed`
    ].join(" · ")
    record(player, "setup.done", undefined, words, changes.length ? { kind: "config", overrides: before } : undefined)
    console.log(`[Admin+] Setup applied by ${player.name}: ${words}`)
    ok(player, "Admin+ is set up. Change any of it later in /admin.")
    return afterSetup(player, back, draft.ranks === "own")
}

async function skip(player, back) {
    writeState({ shown: true, skipped: true })
    info(player, "§7Setup skipped. Run it any time from /admin ▸ Server ▸ Advanced ▸ Set up again.")
    return afterSetup(player, back)
}

/** Done or skipped: the terms, if they're still owed, then where they were going. */
async function afterSetup(player, back, newRank = false) {
    if (!await ensureTerms(player)) return
    if (newRank) return createRankScreen(player, () => ranksScreen(player, back))
    return back?.()
}

// ----------------------------------------------------------------- first join

/**
 * The welcome, the first time an owner enters a world where nothing has been
 * changed. A few seconds after they spawn, so the world has drawn first, and
 * only once: after that the Set up button in /admin is the reminder.
 */
export function onOwnerSpawn(player) {
    // Owners in their own right only: a developer whose say comes from the
    // grant is not welcomed into setting up somebody else's server.
    if (!ownsServer(player)) return false
    // Admin+ is off (the terms were declined): bring the owner the terms so
    // they have a way to turn it back on, whatever state the world is in.
    if (adminplusDisabled()) {
        system.runTimeout(() => {
            try { if (player.isValid !== false) ensureTerms(player) } catch (e) { console.warn(`[Admin+] Terms: ${e}`) }
        }, 60)
        return true
    }
    const now = readState()
    if (now.done || now.shown || !worldUntouched()) return false
    writeState({ shown: true })
    console.log(`[Admin+] Setup offered to ${player.name}`)
    system.runTimeout(() => {
        try { if (player.isValid !== false) setupScreen(player) } catch (e) { console.warn(`[Admin+] Setup: ${e}`) }
    }, 60)
    return true
}

export function installSetup() {
    world.afterEvents?.playerSpawn?.subscribe?.(({ player, initialSpawn }) => {
        if (!initialSpawn) return
        try { onOwnerSpawn(player) } catch (e) { console.warn(`[Admin+] Setup: ${e}`) }
    })
    return true
}
