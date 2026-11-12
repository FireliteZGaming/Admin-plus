import { world } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, subtitle, isDecoration } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { setting, flag, render, renderTag } from "../core/settings.js"
import { record } from "../core/logs.js"
import { ok, err, info } from "../core/util.js"
import { stripCodes, displayName, withCodes, asTyped } from "../core/identity.js"
import { STYLES, STYLE_IDS, paint } from "../core/nametag.js"
import { FONTS, FONT_IDS, applyFont, fontOptions } from "../core/fonts.js"
import {
    ladder, getRank, saveRank, deleteRank, normaliseRankId, moveRank,
    PRESETS, BUNDLES, PERMISSION_NODES, RANK_VALUES,
    applyPreset, restoreSnapshot, hasSnapshot, snapshot,
    canEditRank, canActOn, has, rankState, rankGrant, displacedBy, defaultRank,
    displayRanks, heldRankIds, primaryRank,
    setRanks, grantRank, revokeRank, knownHolders, nodeLabels, topWeight,
    RANK_TYPES, rankType, isRanked, unrankedRanks
} from "../core/ranks.js"

// /admin ▸ Ranks
//
// Opening Ranks shows the ranks in two sections, split by a divider as the
// user asked on 2026-11-11: the ranks in the order (Default and Staff),
// strongest first, then the cosmetic and unlisted ranks, which have no order.
// Every rank's button says its type. Everything else hangs off that list:
//
//   tap a rank         Basics (name, font, type, colours) and Permissions
//   + New rank         a typed name, a font and a type
//   Give a rank        pick a player, then give or take ranks
//   Rank templates     replace the order with a ready-made one
//
// Two orders, kept apart on purpose:
//   the LIST order is the hierarchy. A rank outranks everything below it, and
//     that is where all authority comes from. No weight numbers are shown.
//   a PLAYER's own order only picks which of their ranks shows as their tag.
//
// The numbers a rank carries live in RANK_VALUES in core/ranks.js, beside the
// code that reads them.

// ------------------------------------------------------------ typed names
//
// A rank's name is TYPED, colour codes and all, the way players already do it
// and the way Essentials explains it: put the code in front of the words and
// everything after it takes that colour. A list of sixteen colours could never
// offer what typing does (two colours, VIP+), so there is no colour list for
// the name any more. The user's call, 2026-11-11.
//
// The Bold and Italic switches are shortcuts for the same codes: they read
// what was typed (a name with &l in it shows Bold on) and switching one on
// just puts the code in front of the words.

/**
 * Switch one formatting code (l bold, o italic) on or off for the whole name.
 * On puts the code at the start and after every colour code and reset, so
 * the whole name has it even where a colour change would end it. Off takes
 * every copy out.
 */
function setFormat(text, code, on) {
    let out = text.replace(new RegExp(`§${code}`, "gi"), "")
    if (!on) return out
    out = out.replace(/§[0-9a-jmnpqrstuv]/gi, m => `${m}§${code}`)
    if (!/^(?:§[0-9a-v])*§[0-9a-jmnpqrstuv]/i.test(out)) out = `§${code}${out}`
    return out
}

/** Does this name use the code (l bold, o italic) anywhere? */
const uses = (text, code) => new RegExp(`§${code}`, "i").test(withCodes(text))

/**
 * What the name box and its switches add up to.
 *
 * A switch that was flipped wins: on adds the code to the whole name, off
 * takes every copy out. A switch left as it was leaves the box alone, so a
 * name typed with its own &l keeps exactly the bold it was typed with. That is
 * the "it auto turns on" the user asked for: the switch starts on when the
 * name already has the code.
 *
 * `text` is kept for the box. `display` is what shows, in `font`. A name with
 * no colour code shows white rather than taking the dark grey of the brackets
 * around it.
 */
function buildName(typed, { bold = false, italic = false, wasBold = false, wasItalic = false, font = "normal" } = {}) {
    let text = withCodes(typed).trim()
    if (bold !== wasBold) text = setFormat(text, "l", bold)
    if (italic !== wasItalic) text = setFormat(text, "o", italic)
    const shown = /^(?:§[klor])*§[0-9a-jmnpqstuv]/i.test(text) ? text : `§f${text}`
    return { text: asTyped(text), display: applyFont(shown, font) }
}

/** The box shows what was typed. Ranks from before 2.8.1 never stored it. */
const typedOf = rank => rank?.text ?? asTyped(rank?.display ?? "")

/** The name field's help: how to colour it, with an example and the codes. */
const NAME_HELP = [
    "Name",
    "§8Colour it by putting & and a code in front of the words.",
    "§8Example: §7&c&lAdmin§8 shows as §c§lAdmin",
    "§0&0 §1&1 §2&2 §3&3 §4&4 §5&5 §6&6 §7&7 §8&8 §9&9 §a&a §b&b §c&c §d&d §e&e §f&f",
    "§8&l bold · &o italic · & and § both work"
].join("\n")

/** Fonts are look-alike letters; the list names each font in itself. */
const FONT_HELP = "Font\n§8Look-alike letters, like Discord's fonts. They draw smoother than normal text."

/** Chat colour is typed too: one code, or nothing for the normal colour. */
const CHAT_HELP = "Chat colour\n§8A code like &e for what they type. Leave it empty for normal."
function chatCodeFrom(typed) {
    const value = String(typed ?? "").trim()
    // The letter on its own counts too: "e" is as clear as "&e".
    if (/^[0-9a-jmnpqstuv]$/i.test(value)) return value.toLowerCase()
    const match = withCodes(value).match(/§([0-9a-jmnpqstuv])/i)
    return match ? match[1].toLowerCase() : ""
}

/** The four types, in RANK_TYPES order, and what each one means. */
const TYPE_OPTIONS = ["Default", "Staff", "Cosmetic", "Unlisted"]
const TYPE_HELP = [
    "Rank type",
    "§8Default: a normal rank, like VIP. Replaces the starting rank.",
    "§8Staff: the same, plus staff permissions.",
    "§8Cosmetic: a tag added beside the others. No permissions.",
    "§8Unlisted: hidden. Gives permissions without a tag."
].join("\n")

/** The type as one word, the same word as in the Rank type list. */
const typeWord = rank => TYPE_OPTIONS[RANK_TYPES.indexOf(rankType(rank))].toLowerCase()

/**
 * The line under a rank's name on its button: its type first, always, so
 * nobody has to guess whether they are editing a rank in the order or a
 * cosmetic one. Asked for on 2026-11-11.
 */
function typeNote(rank) {
    const type = rankType(rank)
    if (type === "cosmetic") return "cosmetic · a tag beside their rank"
    if (type === "unlisted") return "unlisted · hidden, no tag"
    return rank.default ? `${typeWord(rank)} · new players get it` : typeWord(rank)
}

/** A list of ranks for a body line: hidden ones marked, "none" when empty. */
export function rankNames(ranks) {
    return ranks
        .map(rank => rankType(rank) === "unlisted" ? `${rank.display}§r §8(hidden)` : `${rank.display}§r`)
        .join("§7, ") || "§7none"
}

/**
 * Ranks under two headers: those in the order, then cosmetic and unlisted.
 * An empty section is left out.
 */
function sectioned(ranks) {
    const ranked = ranks.filter(isRanked)
    const unranked = ranks.filter(rank => !isRanked(rank))
    const items = []
    if (ranked.length) items.push({ header: "In the order" }, ...ranked)
    if (unranked.length) {
        if (items.length) items.push({ divider: true })
        items.push({ header: "Cosmetic and unlisted" }, ...unranked)
    }
    return items
}

/** A rank's button in any list: its name, then its type. */
const rankButton = rank => ({ text: `${rank.display}§r\n§8${typeNote(rank)}` })

/** A rank's name as plain text, for titles and messages. */
const nameOf = rank => stripCodes(String(rank?.display ?? "")) || rank?.id || "this rank"

/** Does a player holding this rank end up with the node, however it arrives? */
const holds = (rank, node) => ["own", "wildcard", "inherited"].includes(rankGrant(rank, node).state)

/**
 * The two halves of a rank's permissions, as split on 2026-11-11: Member is
 * what any player with the rank can do, Administrative is staff tools.
 */
const MEMBER_GROUPS = ["Everyone"]
const ADMIN_GROUPS = Object.keys(PERMISSION_NODES).filter(group => !MEMBER_GROUPS.includes(group))
const countOn = (rank, groups) => groups.reduce((n, g) => n + PERMISSION_NODES[g].filter(node => holds(rank, node)).length, 0)
const countAll = groups => groups.reduce((n, g) => n + PERMISSION_NODES[g].length, 0)

/** Name colour choices: Default, the plain colours, then the moving effects. */
function nameColourOptions() {
    return STYLE_IDS.map(id => {
        const style = STYLES[id]
        if (id === "none") return "§7Default"
        if (style.still) return `§${style.ramp}${style.label}`
        return `${paint(style.label, style.ramp, 0)}§r §8(moves)`
    })
}

/**
 * One chat line, drawn the way this rank would make it look. A cosmetic tag is
 * shown beside the starting rank's, which is how it really appears; an
 * unlisted rank shows no tag at all.
 */
function previewLine(rank) {
    const type = rankType(rank)
    if (type === "unlisted") return "§7no tag: unlisted ranks are not shown"
    // A cosmetic rank changes only its own tag, so the rest stays plain.
    const own = type !== "cosmetic"
    const looks = own ? (rank.meta ?? {}) : {}
    const font = own && rank.font ? rank.font : "normal"
    const style = STYLES[String(looks["nametag.style"] ?? "none")]
    const base = applyFont("Steve", rank.fontName ? font : "normal")
    const name = style?.ramp ? paint(base, style.ramp, 0) : base
    const code = String(looks["chat.colour"] ?? "")
    const colour = /^[0-9a-jmnpqstuv]$/i.test(code) ? `§${code}` : ""
    const message = applyFont("hello!", rank.fontChat ? font : "normal")
    const starter = defaultRank()
    const tag = type === "cosmetic" && starter
        ? [renderTag(starter), renderTag(rank)].filter(Boolean).join(" ")
        : renderTag(rank)
    return render("format.chat", { TAG: tag, RANK: rank.display, NAME: "Steve", NICKNAME: name, MSG: `${colour}${message}` })
}

export async function ranksScreen(player, back) {
    // Somebody who may hand out ranks but not edit them goes straight to the
    // one thing they can do.
    if (!has(player, "ranks.manage")) return rankPlayersScreen(player, back)
    return ladderScreen(player, back)
}

// ================================================================ the list

function ladderLine(rank, index) {
    // Cosmetic and unlisted ranks have no number, because they have no place.
    if (!isRanked(rank)) return `§r${rank.display}§r\n§8${typeNote(rank)}`
    return `§8${index + 1}. §r${rank.display}§r\n§8${typeNote(rank)}`
}

/**
 * The rank list, in two sections with a divider between them, asked for on
 * 2026-11-11 "so people understand what they are editing": ranks in the
 * order, then cosmetic and unlisted ranks. Each section says what its ranks
 * are, and an empty second section says how to make one.
 */
async function ladderScreen(player, back) {
    const ranks = ladder()
    const unranked = unrankedRanks()
    const again = () => ladderScreen(player, back)
    return pagedMenu(player, {
        title: hubTitle("ranks", "Ranks"),
        body: subtitle("Tap a rank to change it."),
        items: [
            { header: "In the order" },
            { label: "§8Strongest first. Each rank outranks the ranks below it." },
            ...ranks,
            { divider: true },
            { header: "Cosmetic and unlisted" },
            {
                label: unranked.length
                    ? "§8No order and no power over anyone. Cosmetic adds a tag; unlisted is hidden."
                    : "§8None yet. Make one with + New rank and pick its type."
            },
            ...unranked,
            { divider: true }
        ],
        render: item => isDecoration(item) ? item : { text: ladderLine(item, ranks.indexOf(item)) },
        onPick: rank => rankScreen(player, rank.id, again),
        extra: [
            { text: hubEntry("presets", "+ New rank", "A name, a font and a type"), run: () => createRankScreen(player, again) },
            { text: hubEntry("ranks", "Give a rank to a player", "Or take one away"), run: () => rankPlayersScreen(player, again) },
            { text: hubEntry("presets", "Rank templates", "Replace the order with a ready-made one"), run: () => presetsScreen(player, again) },
            hasSnapshot()
                ? { text: "§8↺ Undo last change\n§8Puts back the list from before the last template or delete", run: () => undoScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

async function undoScreen(player, back) {
    const yes = await confirm(player, hubTitle("ranks", "Undo last change"),
        "Put the rank list back the way it was before the last template or delete?\n\n§7Players keep the ranks they have.", "§eUndo")
    if (!yes) return back()
    restoreSnapshot()
    ok(player, "The rank list is back the way it was.")
    return back()
}

/** One rank: what it is, what it can do, and every way to change it. */
export async function rankScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) { err(player, "That rank no longer exists."); return back() }

    const type = rankType(rank)
    const ranked = isRanked(rank)
    const rows = ladder()
    const index = rows.findIndex(r => r.id === rankId)
    const editable = canEditRank(player, rank)
    const again = () => rankScreen(player, rankId, back)

    // What the HOLDER ends up with, per group, counted the same way the
    // switches are drawn, so this summary and those screens always agree.
    const groups = Object.entries(PERMISSION_NODES).map(([group, nodes]) => {
        const on = nodes.filter(node => ["own", "wildcard", "inherited"].includes(rankGrant(rank, node).state)).length
        if (!on) return null
        return `§7${group}: §f${on === nodes.length ? "all" : `${on} of ${nodes.length}`}`
    }).filter(Boolean)
    const parents = (rank.inherits ?? []).map(id => getRank(id)).filter(Boolean)

    const body = [
        `${rank.display}§r`,
        subtitle(ranked ? `Number ${index + 1} of ${rows.length} in the order · ${typeNote(rank)}` : typeNote(rank)),
        "",
        `§fIn chat: §r${previewLine(rank)}`,
        "",
        // A cosmetic rank gives nothing, so there is nothing to list.
        ...(type === "cosmetic"
            ? ["§7A cosmetic rank only changes how a name looks. It gives no permissions."]
            : [
                "§fWhat it can do:",
                ...(groups.length ? groups : ["§7Nothing yet"]),
                parents.length ? `\n§fAlso gets everything from: §r${parents.map(r => r.display + "§r").join("§7, ")}` : ""
            ]),
        editable ? "" : "\n§cThis rank is at or above yours, so you can only look."
    ].join("\n")

    // Only a rank in the order has a place to move to.
    const canMoveUp = ranked && editable && index > 0 && canEditRank(player, rows[index - 1])
    const canMoveDown = ranked && editable && index < rows.length - 1

    return menu(player, {
        title: hubTitle("ranks", nameOf(rank)),
        body,
        buttons: editable ? [
            // Two doors, as the user laid it out on 2026-11-11: Basics is how
            // the rank looks and what type it is; Permissions is what it can
            // do, split into Member and Administrative.
            { text: hubEntry("ranks", "Basics", "Name, font, type and colours"), run: () => basicsScreen(player, rankId, again) },
            type !== "cosmetic"
                ? { text: hubEntry("ranks", "Permissions", type === "staff" ? "Member and administrative" : "What players with it can do"), run: () => permissionsScreen(player, rankId, again) }
                : null,
            canMoveUp ? { text: `§7▲ Move up §8· above ${nameOf(rows[index - 1])}`, run: () => { moveRank(rankId, -1); return again() } } : null,
            canMoveDown ? { text: `§7▼ Move down §8· below ${nameOf(rows[index + 1])}`, run: () => { moveRank(rankId, 1); return again() } } : null,
            { text: "§cDelete this rank", run: () => deleteScreen(player, rankId, back) }
        ].filter(Boolean) : [],
        back
    })
}

/**
 * A new rank: a typed name, a font and a type.
 *
 * The name is typed with its colours, the way players already write them
 * (see "typed names" at the top), and the id is made from its letters, so
 * nobody types an id. Only Default and Staff ranks take a place in the order,
 * and a cosmetic rank inherits nothing, because it gives no permissions.
 *
 * Only places and parents at or below the maker's own rank are offered, so
 * making a rank can never hand out more than its maker has.
 */
export async function createRankScreen(player, back) {
    const mine = topWeight(player)
    const usable = ladder().filter(r => (r.weight ?? 0) <= mine)
    if (!usable.length) { err(player, "You can only make ranks below your own, and there are none to place it under."); return back() }
    const fallback = defaultRank()
    const fallbackAt = usable.findIndex(r => r.id === fallback?.id)

    const values = await modal(player, hubTitle("ranks", "New rank"), [
        { id: "name", type: "text", label: NAME_HELP, placeholder: "&eHelper" },
        { id: "bold", type: "toggle", label: "Bold", default: false },
        { id: "italic", type: "toggle", label: "Italic", default: false },
        { id: "font", type: "dropdown", label: `${FONT_HELP}\n§8It goes on the rank tag. Basics can put it on names and messages too.`, options: fontOptions(), default: 0 },
        { id: "type", type: "dropdown", label: TYPE_HELP, options: TYPE_OPTIONS, default: 0 },
        {
            id: "from", type: "dropdown",
            label: "Also gets everything from\n§8It starts with all of that rank's permissions. Not for cosmetic ranks.",
            options: ["§7No other rank", ...usable.map(r => `${r.display}§r`)],
            // New players' rank by default, so the new rank never loses the
            // basics when it replaces that one.
            default: fallbackAt >= 0 ? fallbackAt + 1 : 0
        },
        {
            id: "below", type: "dropdown",
            label: "Put it just below\n§8Only Default and Staff ranks have a place in the order.",
            options: usable.map(r => `${r.display}§r`),
            // Just above the new players' rank, where Helper, VIP or Builder
            // usually belongs.
            default: Math.max(0, fallbackAt - 1)
        }
    ])
    if (!values) return back()

    const typed = String(values.name ?? "")
    const plain = stripCodes(withCodes(typed)).trim()
    if (!plain) { err(player, "Give the rank a name."); return back() }
    const base = normaliseRankId(plain)
    if (!base) { err(player, "Use letters or numbers in the name."); return back() }
    let id = base
    for (let n = 2; getRank(id); n++) id = `${base}${n}`

    const type = RANK_TYPES[values.type] ?? "default"
    const ranked = type === "default" || type === "staff"
    const font = FONT_IDS[values.font] ?? "normal"
    const name = buildName(typed, { bold: !!values.bold, italic: !!values.italic, font })
    const parent = type !== "cosmetic" && values.from ? usable[values.from - 1] : undefined
    saveRank(id, {
        display: name.display, text: name.text, font,
        fontTag: true, fontName: false, fontChat: false,
        type, inherits: parent ? [parent.id] : [], perms: [], meta: {}
    })

    // A rank in the order lands at the bottom. Walk it up to just below the
    // chosen one.
    if (ranked) {
        const target = usable[values.below] ?? usable[usable.length - 1]
        for (let guard = 0; guard < 64; guard++) {
            const order = ladder().map(r => r.id)
            if (order.indexOf(id) <= order.indexOf(target.id) + 1) break
            if (!moveRank(id, -1)) break
        }
    }

    ok(player, {
        default: `Made the ${name.display}§a rank. Its permissions are under Permissions.`,
        staff: `Made the ${name.display}§a staff rank. Staff tools are under Permissions ▸ Administrative.`,
        cosmetic: `Made the ${name.display}§a cosmetic rank. Give it to players from Give a rank.`,
        unlisted: `Made the ${name.display}§a unlisted rank. It shows no tag. Give it to players from Give a rank.`
    }[type])
    return rankScreen(player, id, back)
}

/**
 * A rank's Basics: how it looks and what type it is.
 *
 * The form is built for the rank's type, so it asks only what applies: an
 * unlisted rank has no tag to put a font on, and a cosmetic rank changes only
 * its own tag, so it has no name font, name colour or chat colour. A field
 * that is not shown keeps its saved value.
 */
export async function basicsScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const type = rankType(rank)
    const ranked = isRanked(rank)
    const typed = typedOf(rank)
    const wasBold = uses(typed, "l")
    const wasItalic = uses(typed, "o")
    const fontAt = Math.max(0, FONT_IDS.indexOf(rank.font ?? "normal"))
    const styleAt = Math.max(0, STYLE_IDS.indexOf(String(rank.meta?.["nametag.style"] ?? "none")))
    const chatCode = String(rank.meta?.["chat.colour"] ?? "")
    const coloursOff = flag("feature.namecolour") ? "" : "\n§cName colours are turned off in Server ▸ Features."

    const values = await modal(player, hubTitle("ranks", `Basics · ${nameOf(rank)}`), [
        { id: "name", type: "text", label: NAME_HELP, default: typed },
        { id: "bold", type: "toggle", label: "Bold", default: wasBold },
        { id: "italic", type: "toggle", label: "Italic", default: wasItalic },
        { id: "font", type: "dropdown", label: FONT_HELP, options: fontOptions(), default: fontAt },
        // Where the font goes, right under it, as the user laid it out.
        type !== "unlisted" ? { id: "fontTag", type: "toggle", label: "Apply to the rank tag", default: rank.fontTag ?? true } : null,
        type !== "cosmetic" ? { id: "fontName", type: "toggle", label: "Apply to their name", default: !!rank.fontName } : null,
        type !== "cosmetic" ? { id: "fontChat", type: "toggle", label: "Apply to their messages", default: !!rank.fontChat } : null,
        { id: "type", type: "dropdown", label: TYPE_HELP, options: TYPE_OPTIONS, default: RANK_TYPES.indexOf(type) },
        type !== "cosmetic"
            ? { id: "nameColour", type: "dropdown", label: `Name colour\n§8The player's name, in chat and above their head${coloursOff}`, options: nameColourOptions(), default: styleAt }
            : null,
        type !== "cosmetic"
            ? { id: "chatColour", type: "text", label: CHAT_HELP, placeholder: "&e", default: chatCode ? `&${chatCode}` : "" }
            : null,
        ranked
            ? { id: "isDefault", type: "toggle", label: "New players get this rank\n§8The starting rank. Only one rank can be it.", default: !!rank.default }
            : null
    ].filter(Boolean))
    if (!values) return back()

    const newType = RANK_TYPES[values.type] ?? type
    const nowRanked = newType === "default" || newType === "staff"
    // The starting rank has to stay in the order, or new players would start
    // with nothing. Unticking it in the same form is the way out.
    if (!nowRanked && values.isDefault) {
        err(player, "New players get this rank, so it must stay Default or Staff. Make another rank the starting rank first.")
        return back()
    }

    const font = FONT_IDS[values.font] ?? "normal"
    const fontTag = "fontTag" in values ? !!values.fontTag : (rank.fontTag ?? true)
    const fontName = "fontName" in values ? !!values.fontName : !!rank.fontName
    const fontChat = "fontChat" in values ? !!values.fontChat : !!rank.fontChat

    // An emptied box keeps the old name, as it always has.
    const wanted = stripCodes(withCodes(values.name ?? "")).trim() ? String(values.name) : typed
    const name = buildName(wanted, {
        bold: !!values.bold, italic: !!values.italic, wasBold, wasItalic,
        font: fontTag ? font : "normal"
    })

    // "Default" removes the value rather than storing "none", so a lower
    // rank's colour can still show through.
    const meta = { ...(rank.meta ?? {}) }
    if ("nameColour" in values) {
        const styleId = STYLE_IDS[values.nameColour]
        if (!styleId || styleId === "none") delete meta["nametag.style"]
        else meta["nametag.style"] = styleId
    }
    if ("chatColour" in values) {
        const code = chatCodeFrom(values.chatColour)
        if (code) meta["chat.colour"] = code
        else delete meta["chat.colour"]
    }

    saveRank(rankId, {
        display: name.display, text: name.text, font, fontTag, fontName, fontChat,
        type: newType, meta,
        default: "isDefault" in values ? !!values.isDefault : !!rank.default
    })

    const moved = ranked === nowRanked ? ""
        : nowRanked ? " It joined the order at the bottom. Move it up from its page."
        : " It left the order, so it no longer outranks anyone."
    ok(player, `Saved ${name.display}§a.${moved}`)
    return back()
}

async function deleteScreen(player, rankId, back) {
    const rank = getRank(rankId)
    const shown = rank?.display ?? rankId
    const yes = await confirm(player, hubTitle("ranks", "Delete rank"),
        `Delete ${shown}§r?\n\n§7Everyone who has it loses it. You can undo this from the rank list.`, "§cDelete")
    if (!yes) return back()
    snapshot()
    deleteRank(rankId)
    record(player, "rank.delete", undefined, rankId, { kind: "ladder" })
    ok(player, `Deleted ${shown}§a.`)
    return back()
}

// ---------------------------------------------------------------- templates

export async function presetsScreen(player, back) {
    return menu(player, {
        title: hubTitle("presets", "Rank templates"),
        body: subtitle("Each template is a full set of ranks. Using one replaces your rank list.\nPlayers keep any rank that still exists, and you can undo it from the rank list."),
        buttons: Object.keys(PRESETS).map(key => ({
            text: `§l${PRESETS[key].name}§r\n§8${PRESETS[key].description}`,
            run: () => applyPresetScreen(player, key, back)
        })),
        back
    })
}

async function applyPresetScreen(player, key, back) {
    const preset = PRESETS[key]
    const rows = Object.values(preset.ranks)
        .sort((a, b) => b.weight - a.weight)
        .map((r, i) => `  §8${i + 1}. §r${r.display}`)
        .join("\n")
    const yes = await confirm(player, hubTitle("presets", preset.name),
        `${preset.description}\n\n§fRanks:\n${rows}\n\n§cThis replaces your current rank list.`, "§cUse this template")
    if (!yes) return back()
    applyPreset(key)
    record(player, "rank.preset", undefined, preset.name, { kind: "ladder" })
    ok(player, `Now using the §f${preset.name}§a ranks.`)
    return back()
}

// -------------------------------------------------------------- permissions

/**
 * Quick fill. A bundle is a SHORTCUT, not a second kind of permission.
 *
 * These used to be toggles on a screen of their own, sitting beside the real
 * permissions and looking exactly like them — so nothing said which was the
 * state and which the shortcut. Even the person who commissioned this pack
 * could not tell them apart, which is a UI problem rather than a reading one.
 *
 * They also overlapped, which made them quietly destructive. Every node in
 * "Moderation — light" is inside "Moderation — full", and a bundle showed as ON
 * once you owned all of it — so ticking the full one lit the light one too,
 * without being touched, and unticking that stripped eight nodes back out of
 * the bundle you actually wanted.
 *
 * So they only ADD now. Press one, watch the permissions change, fine-tune them
 * next door. Nothing here can take a permission away, and a rank's permissions
 * live in exactly one place.
 */
async function quickFillScreen(player, rankId, back) {
    const again = () => quickFillScreen(player, rankId, back)
    const rank = getRank(rankId)
    const has = key => BUNDLES[key].nodes.every(n => rank.perms.includes(n))

    return menu(player, {
        title: hubTitle("ranks", `Ready-made sets · ${nameOf(rank)}`),
        body: subtitle("Each one switches on a group of permissions in one tap.\n§8Nothing is switched off here. Do that inside each group."),
        buttons: Object.keys(BUNDLES).map(key => {
            const bundle = BUNDLES[key]
            const done = has(key)
            const size = bundle.nodes.length
            return {
                text: `${done ? "§8" : "§b"}${bundle.label}\n§8${size} permission${size === 1 ? "" : "s"}${done ? " · already on" : ""}`,
                run: () => {
                    const perms = [...rank.perms]
                    const added = bundle.nodes.filter(node => !perms.includes(node))
                    if (!added.length) {
                        info(player, "§7They already have every one of those.")
                        return again()
                    }
                    saveRank(rankId, { perms: [...perms, ...added] })
                    ok(player, `Switched on §f${added.length}§a permission${added.length === 1 ? "" : "s"} for ${rank.display}§a.`)
                    return again()
                }
            }
        }),
        back
    })
}

/**
 * A rank's permissions, in the two halves the user laid out on 2026-11-11:
 *
 *   Member           what any player with this rank can do, plus how many
 *                    homes and claims they get and how long they wait
 *   Administrative   staff tools, shown only for a staff rank
 *
 * Administrative stays visible on a rank that is not staff but still holds
 * some of those permissions, with a line saying so, so nothing it can do is
 * ever hidden from the person editing it.
 */
async function permissionsScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const again = () => permissionsScreen(player, rankId, back)
    const staff = rankType(rank) === "staff"
    const adminOn = countOn(rank, ADMIN_GROUPS)
    const parents = (rank.inherits ?? []).map(id => getRank(id)).filter(Boolean)

    return menu(player, {
        title: hubTitle("ranks", `Permissions · ${nameOf(rank)}`),
        body: [
            subtitle("What players with this rank can do."),
            staff ? "" : "§8Administrative permissions show here when the rank type is Staff (in Basics).",
            !staff && adminOn
                ? `§cThis rank is not staff, but it still has ${adminOn} administrative permission${adminOn === 1 ? "" : "s"}.`
                : ""
        ].filter(Boolean).join("\n"),
        buttons: [
            { text: hubEntry("ranks", "Member", `What they can use, limits and cooldowns · ${countOn(rank, MEMBER_GROUPS)} of ${countAll(MEMBER_GROUPS)} on`), run: () => memberPermissionsScreen(player, rankId, again) },
            staff || adminOn
                ? { text: hubEntry("actions", "Administrative", `Staff tools · ${adminOn} of ${countAll(ADMIN_GROUPS)} on`), run: () => adminPermissionsScreen(player, rankId, again) }
                : null,
            { text: hubEntry("ranks", "Also gets permissions from", parents.length ? parents.map(nameOf).join(", ") : "No other rank"), run: () => inheritScreen(player, rankId, again) }
        ].filter(Boolean),
        back
    })
}

async function memberPermissionsScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const again = () => memberPermissionsScreen(player, rankId, back)
    return menu(player, {
        title: hubTitle("ranks", `Member · ${nameOf(rank)}`),
        body: subtitle("What any player with this rank can do."),
        buttons: [
            ...MEMBER_GROUPS.map(group => {
                const nodes = PERMISSION_NODES[group]
                const on = nodes.filter(node => holds(rank, node)).length
                return {
                    text: hubEntry("ranks", "What they can use", `Warps, spawn, requests, reports, who is online · ${on} of ${nodes.length} on`),
                    run: () => nodeGroupScreen(player, rankId, group, again)
                }
            }),
            // Numbers belong beside the switches: "may they set homes" and
            // "how many" are one question asked twice.
            { text: hubEntry("ranks", "Limits", "How many homes and land claims"), run: () => valuesScreen(player, rankId, "limit", again) },
            { text: hubEntry("ranks", "Cooldowns", "How long to wait between teleports"), run: () => valuesScreen(player, rankId, "cooldown", again) }
        ],
        back
    })
}

async function adminPermissionsScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const again = () => adminPermissionsScreen(player, rankId, back)
    return menu(player, {
        title: hubTitle("actions", `Administrative · ${nameOf(rank)}`),
        body: subtitle("Staff tools. Each switch turns one on or off for this rank.\n§8Off means this rank adds nothing. Players still get what\n§8their other ranks give them."),
        buttons: [
            // The shortcut sits with the thing it is a shortcut for.
            { text: "§eReady-made sets §8· switch on a group at once", run: () => quickFillScreen(player, rankId, again) },
            // Each group says how much of it is on, counted the way the
            // switches inside are drawn, so the number and the page agree.
            ...ADMIN_GROUPS.map(group => {
                const nodes = PERMISSION_NODES[group]
                const on = nodes.filter(node => holds(rank, node)).length
                return { text: hubEntry("actions", group, `${on} of ${nodes.length} on`), run: () => nodeGroupScreen(player, rankId, group, again) }
            })
        ],
        back
    })
}

/** Beyond this many switches a form stops being trustworthy — see below. */
const NODES_PER_PAGE = 14

/**
 * A group, paged when it is big enough to need it.
 *
 * Operator carries one node per vanilla command, so it is fifty-six switches.
 * That is exactly the shape that has now bitten this pack twice: `modal()`
 * pairs answers to fields BY INDEX, and a response that comes back short leaves
 * the tail reading as off — which on THIS screen would quietly strip
 * permissions from a rank. Fourteen at a time, and a page that did come back
 * short can only cost that page.
 *
 * The write path already rewrites only the nodes it was handed, so a page is a
 * correct unit of work with no further care.
 */
async function nodeGroupScreen(player, rankId, group, back) {
    const all = PERMISSION_NODES[group] ?? []
    if (all.length <= NODES_PER_PAGE) {
        return nodePageScreen(player, rankId, group, all, back)
    }

    const again = () => nodeGroupScreen(player, rankId, group, back)
    const rank = getRank(rankId)
    const pages = []
    for (let i = 0; i < all.length; i += NODES_PER_PAGE) pages.push(all.slice(i, i + NODES_PER_PAGE))

    return menu(player, {
        title: hubTitle("ranks", `${group} · ${nameOf(rank)}`),
        body: subtitle(`${all.length} permissions, ${pages.length} pages.
§8Each page saves on its own.`),
        buttons: pages.map(nodes => {
            const on = nodes.filter(n => rankState(rank, n) !== "none").length
            // Labelled by the same rule as the switches inside, so the range on
            // the button and the rows behind it read as the same words.
            const shown = nodeLabels(all)
            const first = shown[all.indexOf(nodes[0])]
            const last = shown[all.indexOf(nodes[nodes.length - 1])]
            return {
                text: hubEntry("ranks", `${first} – ${last}`,
                    on ? `${on} of ${nodes.length} on` : "none on"),
                run: () => nodePageScreen(player, rankId, group, nodes, again)
            }
        }),
        back
    })
}

async function nodePageScreen(player, rankId, group, nodes, back) {
    const rank = getRank(rankId)

    // Two editor styles, chosen in < Code > ("ranks.permissionEditor"):
    //
    //   toggle    on = granted, off = this rank says nothing and the default
    //             rank's answer stands. Fewer decisions, no way to write a
    //             denial by accident.
    //   dropdown  Default / Allow / Deny per node. Deny writes "-node", which
    //             beats anything inherited — the only way to carve a hole in an
    //             inherited wildcard.
    const dropdown = String(setting("ranks.permissionEditor")).trim().toLowerCase() === "dropdown"
    const stateOf = node => rank.perms.includes(node) ? 1 : (rank.perms.includes(`-${node}`) ? 2 : 0)

    /**
     * The control says what THIS rank states, because that is what it writes.
     * The note beside it says what the holder actually ends up with — a
     * different question, and the one people were reading the switch as
     * answering.
     *
     * Without it the screen looked plainly wrong: an Admin inherits most of Mod
     * and holds "chat.*", so row after row read OFF while the holder obviously
     * had the thing. rankState() resolves it exactly as has() does.
     */
    // Labelled, not spelled out — see nodeLabels in core/ranks.js. Computed
    // over the WHOLE group rather than this page, so page two of Operator
    // cannot shorten differently from page one.
    const whole = PERMISSION_NODES[group] ?? nodes
    const shown = nodeLabels(whole)
    const nameOf = node => shown[whole.indexOf(node)] ?? node

    const labelFor = node => {
        const name = nameOf(node)
        // SAY WHERE IT CAME FROM. "inherited" on its own sent somebody hunting
        // through an empty Inherits list for a rank that had been granting
        // itself ban through its own `admin.*` the whole time.
        const { state, via } = rankGrant(rank, node)
        const rankName = r => stripCodes(String(r?.display ?? "")) || r?.id || "a rank above"
        if (state === "wildcard") return `${name}\n§8· has it already, from its own ${via}`
        if (state === "inherited") return `${name}\n§8· inherited from ${rankName(via)}`
        if (state === "denied" && !rank.perms.includes(`-${node}`)) {
            const from = typeof via === "string" ? `its own ${via}` : rankName(via)
            return `${name}\n§8· denied by ${from}`
        }
        return name
    }

    const values = await modal(player, hubTitle("ranks", group),
        nodes.map(node => dropdown
            ? {
                id: node,
                type: "dropdown",
                label: labelFor(node),
                options: ["Default", "§aAllow", "§cDeny"],
                default: stateOf(node)
            }
            : {
                id: node,
                type: "toggle",
                // **The switch shows what the HOLDER ends up with, not what
                // this rank happens to state.** It used to show the latter, so
                // a node arriving through inheritance or a wildcard read OFF
                // while the person plainly had it — and turning it off did
                // nothing, because there was nothing of this rank's to remove.
                //
                // Reported 2026-09-13 in exactly those words: "even if it's
                // toggled off it somehow has that". Now off means off.
                label: labelFor(node),
                default: ["own", "wildcard", "inherited"].includes(rankGrant(rank, node).state)
            }))
    if (!values) return back()

    // Either way, this group's nodes are rewritten from scratch — anything the
    // rank said about them before is replaced, never merged.
    const perms = rank.perms.filter(p => !nodes.includes(p) && !nodes.includes(p.replace(/^-/, "")))
    for (const node of nodes) {
        const value = values[node]
        if (dropdown) {
            if (value === 1) perms.push(node)
            else if (value === 2) perms.push(`-${node}`)
        } else {
            // **A toggle can now write and clear a denial**, which is what
            // makes "off" mean off for something the rank did not grant itself.
            //
            //   on  + nothing had it      -> state it
            //   on  + a denial had it off -> the denial is simply not rewritten
            //   on  + it flows in already -> write nothing, let it flow
            //   off + it flows in already -> write "-node", the only thing that
            //                                can carve a hole in an inherited
            //                                grant or a wildcard
            //
            // `state` is read BEFORE the edit, from the rank as saved.
            const { state } = rankGrant(rank, node)
            const flowsIn = state === "wildcard" || state === "inherited"
            if (value) {
                if (!flowsIn) perms.push(node)
            } else if (flowsIn || state === "denied") {
                perms.push(`-${node}`)
            }
        }
    }

    saveRank(rankId, { perms })
    ok(player, `Saved what ${rank.display}§a can do.`)
    return back()
}

async function inheritScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    // Ranks in the order, then unlisted ones, which can carry a set of
    // permissions on their own. Cosmetic ranks give none, so they are left out.
    const others = [...ladder(), ...unrankedRanks().filter(r => rankType(r) === "unlisted")]
        .filter(r => r.id !== rankId)
    if (!others.length) { info(player, "There are no other ranks to take permissions from."); return back() }

    const values = await modal(player, hubTitle("ranks", `Also gets permissions from · ${nameOf(rank)}`),
        others.map(other => ({
            id: other.id,
            type: "toggle",
            label: `${other.display}§r${isRanked(other) ? "" : " §8(unlisted)"}`,
            default: rank.inherits?.includes(other.id)
        })))
    if (!values) return back()

    const picked = others.filter(o => values[o.id]).map(o => o.id)
    if (picked.some(id => inheritsFrom(id, rankId))) {
        err(player, "That would make a loop: one of those ranks already gets its permissions from this one.")
        return back()
    }
    saveRank(rankId, { inherits: picked })
    const names = picked.map(id => nameOf(getRank(id)))
    ok(player, names.length
        ? `${rank.display}§a now also gets everything from §f${names.join(", ")}§a.`
        : `${rank.display}§a no longer gets permissions from another rank.`)
    return back()
}

function inheritsFrom(rankId, ancestorId, seen = new Set()) {
    if (rankId === ancestorId) return true
    if (seen.has(rankId)) return false
    seen.add(rankId)
    return (getRank(rankId)?.inherits ?? []).some(parent => inheritsFrom(parent, ancestorId, seen))
}

/**
 * The numbers a rank carries, drawn from core/ranks.js's RANK_VALUES.
 *
 * Generated rather than listed, so a value added to that table gets a slider
 * here without anybody editing this file — and, the part that matters, a
 * feature cannot start reading a number that nobody can set.
 *
 * Cooldowns and limits are two screens because they answer different questions
 * and a single form of five sliders is a wall. They link to each other rather
 * than sitting behind separate buttons, so getting between them is one tap.
 */

async function valuesScreen(player, rankId, kind, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const keys = Object.keys(RANK_VALUES).filter(k => RANK_VALUES[k].kind === kind)
    const other = kind === "cooldown" ? "limit" : "cooldown"
    const heading = kind === "cooldown" ? "Cooldowns" : "Limits"
    // modal() has no text area of its own, and this explanation used to be
    // passed to it as an extra argument it ignored, so nobody ever saw it. It
    // goes on the first slider now, where it is read before anything moves.
    const rule = kind === "cooldown"
        ? "§8Seconds to wait between uses. 0 means no wait.\n§8Staff skip cooldowns unless the server turns that off."
        : "§8How many they may have. 0 turns the feature off for this rank."

    const values = await modal(player, hubTitle("ranks", `${heading} · ${nameOf(rank)}`),
        keys.map((key, i) => ({
            id: key,
            type: "slider",
            label: `${i === 0 ? `${rule}\n\n§r` : ""}${RANK_VALUES[key].label}\n§8${RANK_VALUES[key].hint}`,
            min: RANK_VALUES[key].min,
            max: RANK_VALUES[key].max,
            step: 1,
            default: Number(rank.meta?.[key] ?? RANK_VALUES[key].fallback)
        })))

    if (!values) return back()
    saveRank(rankId, { meta: { ...rank.meta, ...values } })
    ok(player, `Saved the ${heading.toLowerCase()} for ${rank.display}§a.`)

    // Straight on to the other half rather than back out: somebody setting a
    // rank's homes usually wants to set its cooldowns in the same sitting.
    return menu(player, {
        title: hubTitle("ranks", `${heading} · ${nameOf(rank)}`),
        body: subtitle("Saved."),
        buttons: [{
            text: `§bNext: ${other === "cooldown" ? "cooldowns" : "limits"}`,
            run: () => valuesScreen(player, rankId, other, back)
        }],
        back
    })
}

// ================================================ giving ranks to players

export async function rankPlayersScreen(player, back) {
    const online = world.getAllPlayers()
    return pagedMenu(player, {
        title: hubTitle("ranks", "Give a rank to a player"),
        body: subtitle(`${online.length} online. Tap a player.`),
        items: online,
        render: target => {
            const rank = primaryRank(target)
            const self = target.id === player.id ? " §8(you)" : ""
            return { text: `${rank ? rank.display + "§r " : ""}${displayName(target)}${self}` }
        },
        onPick: target => playerRankScreen(player, target.id, target.name, () => rankPlayersScreen(player, back)),
        extra: [
            { text: "§7Everyone seen\n§8Includes players who are offline", run: () => offlinePlayersScreen(player, () => rankPlayersScreen(player, back)) }
        ],
        back
    })
}

async function offlinePlayersScreen(player, back) {
    const holders = knownHolders()
    if (!holders.length) { info(player, "Nobody has been seen yet."); return back() }
    const onlineIds = new Set(world.getAllPlayers().map(p => p.id))
    return pagedMenu(player, {
        title: hubTitle("ranks", "Everyone seen"),
        body: subtitle("Everyone Admin+ has seen. §a•§7 means online.\nA change to someone offline applies now and shows when they next join."),
        items: holders,
        render: holder => {
            const rank = getRank(heldRankIds(holder.id)[0])
            return { text: `${rank ? rank.display + "§r " : ""}${holder.name || "§8(unknown)"}${onlineIds.has(holder.id) ? " §a•" : ""}` }
        },
        onPick: holder => playerRankScreen(player, holder.id, holder.name, () => offlinePlayersScreen(player, back)),
        back
    })
}

/**
 * One player's ranks: the tags they show, in order, and any unlisted ranks
 * they hold, which show nothing but still count. Give, take away, tag order.
 */
export async function playerRankScreen(player, targetId, targetName, back) {
    const shown = displayRanks(targetId)
    const hidden = heldRankIds(targetId).map(getRank).filter(rank => rank && rankType(rank) === "unlisted")
    const list = shown.length
        ? shown.map((r, i) => `  §8${i + 1}. §r${r.display}§r §8· ${typeWord(r)}`).join("\n")
        : "  §7none"
    const allowed = canActOn(player, targetId) && has(player, "ranks.grant")
    const online = world.getAllPlayers().some(p => p.id === targetId)
    const again = () => playerRankScreen(player, targetId, targetName, back)

    return menu(player, {
        title: hubTitle("ranks", targetName || "Unknown"),
        body: [
            online ? "§a• online" : "§8offline",
            "",
            "§fTheir tags, in order:",
            list,
            hidden.length ? `\n§fUnlisted, so not shown: §r${hidden.map(r => `${r.display}§r`).join("§7, ")}` : "",
            "",
            "§7What they can do comes from all their ranks together.",
            allowed ? "" : "\n§cThey outrank you, so you can't change their ranks."
        ].join("\n"),
        buttons: allowed ? [
            { text: "§a+ Give a rank", run: () => addRankScreen(player, targetId, targetName, again) },
            { text: "§c- Take a rank away", run: () => removeRankScreen(player, targetId, targetName, again) },
            shown.length > 1
                ? { text: "§7Change the tag order", run: () => displayOrderScreen(player, targetId, targetName, again) }
                : null,
            { text: "§bReplace all their ranks with one", run: () => setRankScreen(player, targetId, targetName, again) }
        ].filter(Boolean) : [],
        back
    })
}

/**
 * Two of a player's shown ranks trade places. A rank only moves among ranks
 * of its own type, because staff tags always come first, then other ranks in
 * the order, then cosmetic ones (see heldRankObjects in core/ranks.js).
 * Swapping in the stored list, rather than stepping one place, is what skips
 * the unlisted ranks hidden between them.
 */
function canSwap(shown, index, delta) {
    const other = shown[index + delta]
    return !!other && rankType(other) === rankType(shown[index])
}
function swapShown(targetId, shown, index, delta) {
    if (!canSwap(shown, index, delta)) return false
    const held = heldRankIds(targetId)
    const a = held.indexOf(shown[index].id)
    const b = held.indexOf(shown[index + delta].id)
    if (a < 0 || b < 0) return false
    ;[held[a], held[b]] = [held[b], held[a]]
    setRanks(targetId, held)
    return true
}

/** Reorder just this player's tags. It changes how they look, never authority. */
async function displayOrderScreen(player, targetId, targetName, back) {
    const shown = displayRanks(targetId)
    if (shown.length < 2) return back()
    const cap = Number(setting("format.tagCount"))
    return menu(player, {
        title: hubTitle("ranks", `Tag order · ${targetName}`),
        body: subtitle(`${cap > 0 ? `The first ${cap} tags show, in this order.` : "Their tags show in this order."}\n§8Staff tags come first, then other ranks, then cosmetic ones.\n§8This does not change what they can do.`),
        buttons: shown.map((rank, index) => ({
            text: `§8${index + 1}. §r${rank.display}§r\n§8${typeWord(rank)}`,
            run: () => moveHeldScreen(player, targetId, targetName, rank.id, () => displayOrderScreen(player, targetId, targetName, back))
        })),
        back
    })
}

async function moveHeldScreen(player, targetId, targetName, rankId, back) {
    const shown = displayRanks(targetId)
    const index = shown.findIndex(r => r.id === rankId)
    const rank = shown[index]
    if (!rank) return back()
    const again = () => moveHeldScreen(player, targetId, targetName, rankId, back)
    const up = canSwap(shown, index, -1)
    const down = canSwap(shown, index, 1)
    return menu(player, {
        title: hubTitle("ranks", nameOf(rank)),
        body: [
            `${rank.display}§r`,
            subtitle(`Number ${index + 1} of ${shown.length}`),
            up || down ? "" : "§8It is the only one of its type, so it stays where it is."
        ].filter(Boolean).join("\n"),
        buttons: [
            up ? { text: "§7▲ Move up", run: () => { swapShown(targetId, shown, index, -1); return again() } } : null,
            down ? { text: "§7▼ Move down", run: () => { swapShown(targetId, shown, index, 1); return again() } } : null
        ].filter(Boolean),
        back
    })
}

/**
 * Ranks the actor may hand out: ranks in the order strictly below their own
 * row, plus cosmetic and unlisted ranks.
 */
export function grantableRanks(player) {
    return [...ladder(), ...unrankedRanks()].filter(rank => canEditRank(player, rank))
}

async function addRankScreen(player, targetId, targetName, back) {
    const held = heldRankIds(targetId)
    const options = grantableRanks(player).filter(rank => !held.includes(rank.id))
    if (!options.length) { err(player, "There are no more ranks below your own to give."); return back() }
    return pagedMenu(player, {
        title: hubTitle("ranks", `Give a rank · ${targetName}`),
        body: subtitle("A rank in the order replaces their starting rank.\nA cosmetic or unlisted rank is added beside what they have."),
        items: sectioned(options),
        render: item => isDecoration(item) ? item : rankButton(item),
        onPick: async rank => {
            // Say what giving this rank takes away before it happens. (The
            // old prompt also pointed at a "Replaces lower ranks" switch,
            // which was never saved anywhere and so never did anything.)
            const losing = displacedBy(targetId, rank.id)
            if (losing.length) {
                const list = losing.map(r => r.display + "§r").join("§7, ")
                const yes = await confirm(player, hubTitle("ranks", "Give rank"),
                    `Give §f${targetName}§r the ${rank.display}§r rank?` +
                    `${String.fromCharCode(10)}${String.fromCharCode(10)}§7It replaces their ${list}§7 rank.`,
                    "§aGive rank")
                if (!yes) return back()
            }
            const before = heldRankIds(targetId)
            grantRank(targetId, rank.id, targetName)
            record(player, "rank.grant", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `${targetName} now has ${rank.display}§a.`)
            notify(targetId, `You were given the ${rank.display}§r rank.`)
            return back()
        },
        back
    })
}

async function removeRankScreen(player, targetId, targetName, back) {
    const held = heldRankIds(targetId).map(getRank).filter(Boolean).filter(rank => canEditRank(player, rank))
    if (!held.length) { err(player, "They have no ranks you are allowed to take away."); return back() }
    return pagedMenu(player, {
        title: hubTitle("ranks", `Take a rank away · ${targetName}`),
        items: sectioned(held),
        render: item => isDecoration(item) ? item : rankButton(item),
        onPick: rank => {
            const before = heldRankIds(targetId)
            revokeRank(targetId, rank.id, targetName)
            record(player, "rank.revoke", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `Removed ${rank.display}§a from ${targetName}.`)
            notify(targetId, `The ${rank.display}§r rank was removed.`)
            return back()
        },
        back
    })
}

async function setRankScreen(player, targetId, targetName, back) {
    // Only ranks in the order: replacing everything with a cosmetic tag would
    // leave them with just the starting rank beside it, which is not what the
    // button says.
    const options = grantableRanks(player).filter(isRanked)
    if (!options.length) { err(player, "There are no ranks below your own to give."); return back() }
    return pagedMenu(player, {
        title: hubTitle("ranks", `Replace all ranks · ${targetName}`),
        body: subtitle("Removes every rank they have and gives them this one."),
        items: options,
        render: rankButton,
        onPick: async rank => {
            const yes = await confirm(player, hubTitle("ranks", "Replace all ranks"),
                `Give §f${targetName}§r only ${rank.display}§r?\n\n§7Their other ranks are removed.`, "§aReplace")
            if (!yes) return back()
            const before = heldRankIds(targetId)
            setRanks(targetId, [rank.id], targetName)
            record(player, "rank.set", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `${targetName} now has only ${rank.display}§a.`)
            notify(targetId, `Your rank is now ${rank.display}§r.`)
            return back()
        },
        back
    })
}

export function notify(targetId, text) {
    const target = world.getAllPlayers().find(p => p.id === targetId)
    if (target) info(target, text)
}
