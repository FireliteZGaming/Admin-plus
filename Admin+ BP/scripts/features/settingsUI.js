import { world, system } from "@minecraft/server"
import { menu, modal, subtitle, INCOMPLETE } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ok, info, err } from "../core/util.js"
import { flag, overrides } from "../core/settings.js"
import { sw, num, txt, fieldFor, applyField } from "../core/settingFields.js"
import { has, refreshNameTag } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { channelsScreen } from "./chatUI.js"
import { previewLine } from "./code.js"

// /admin ▸ Server ▸ Settings
//
// Every switch on the server, in groups named for what they are for, laid out
// by the user on 2026-11-12: "settings is going to be all the toggles, like Tpa
// (this covers all Tpa things) and Rtp, and warps and home... you have to be
// very clear on what the groups basically have."
//
// So each group's button lists what is inside it, and each thing has ONE page
// holding everything about it: Teleport requests is its switch AND how long a
// request lasts.
//
// In Default a group is a list of pages, and the rarely touched values (text
// formats, log sizes, word lists) stay in Server ▸ Advanced ▸ Every setting.
// In Beta (2.12.7, the user: "it just feels like an absurd list of buttons that
// can be edited, which is what confuses people") a group is ONE page in
// sections, like + New rank's permissions, and those values sit in the section
// they belong to: how a chat line looks is in Chat. Fields and pages marked
// `beta` show only there, so Default stays exactly as it was.
//
// A page only writes what was changed. A slider showing a value clamped into
// its range writes nothing unless it was moved, so a number set out of range
// in Advanced is never quietly rewritten by opening this page.

/**
 * A page's or a field's words in the look being shown. A thing whose meaning
 * changed in Beta carries betaLabel, betaHint or betaDetail (2.12.3: name
 * effects come from Personalization there, not from a rank's Basics); Default
 * keeps its own words exactly.
 */
const inLook = (thing, key) => {
    const beta = thing[`beta${key[0].toUpperCase()}${key.slice(1)}`]
    return beta !== undefined ? beta : thing[key]
}

/** A field that shows only in Beta (2.12.7): it used to be in Every setting alone. */
const beta = field => ({ ...field, beta: true })

/** Where per-rank numbers live, for the pages whose limits are set on a rank. */
const PER_RANK = "How many each rank gets is set on the rank: Ranks ▸ a rank ▸ Permissions ▸ Member ▸ Limits."

/** What the words in braces mean, for the pages that hold chat lines. */
const TOKENS = "Words in braces are filled in for each line: {NICKNAME} is the display name, {NAME} the gamertag, {TAG} the rank tags, {BADGE} the badge, {MSG} the message."

/** The two rules a line must keep (settingProblem in core/settings.js). */
const KEEPS_BOTH = "Must keep {MSG}, and {NAME} or {NICKNAME}."
const KEEPS_NAME = "Must keep {NAME} or {NICKNAME}."

export const GROUPS = [
    {
        // "Teleportation" since 2.12.16 (the user: "make sure theres a server
        // settings for Teleportation and it covers all of tp including rtp").
        // The id stays "travel", so nothing saved moves.
        id: "travel",
        label: "Teleportation",
        hint: "Spawn, warps, homes, /back, /rtp, /tpa, and wait times for all of them",
        body: "Every way players teleport, and how long they wait.\nPlayers find these in /menu ▸ Travel.",
        pages: [
            {
                label: "Spawn", hint: "/spawn, and protecting the area around it",
                fields: [
                    sw("feature.spawn", "Spawn", "/spawn takes players to the world's spawn point"),
                    sw("spawn.protect", "Protect the area around spawn", "Only staff can build or break there"),
                    num("spawn.radius", "Protected area, in blocks from spawn", "", 4, 128, 4)
                ]
            },
            { label: "Warps", hint: "/warp and the places staff set up", fields: [sw("feature.warps", "Warps", "/warp, and the list of warps")] },
            {
                label: "Homes", hint: "/home: players save their own places", note: PER_RANK,
                fields: [sw("feature.homes", "Homes", "/home: players save their own places")]
            },
            { label: "Go back", hint: "/back: return to a teleport or a death", fields: [sw("feature.back", "Go back", "/back: return to where you were, or where you died")] },
            {
                label: "Random teleport", hint: "/rtp, and how far it sends people",
                fields: [
                    sw("feature.rtp", "Random teleport", "/rtp: a safe spot far away"),
                    num("rtp.minimum", "Nearest it sends someone, in blocks", "Keeps /rtp from dropping people back at spawn", 0, 2048, 64),
                    num("rtp.range", "Farthest it sends someone, in blocks", "", 500, 20000, 500),
                    num("rtp.tries", "Spots to try before giving up", "An ocean world needs more", 4, 64, 4)
                ]
            },
            {
                label: "Teleport requests", hint: "/tpa and /tpahere, and how long a request lasts",
                fields: [
                    sw("feature.tpa", "Teleport requests", "/tpa and /tpahere: ask to teleport, and the other player says yes or no"),
                    num("tpa.expire", "Seconds before a request expires", "", 15, 300, 5)
                ]
            },
            {
                label: "Wait times", hint: "Warmup and cooldowns for every teleport, /rtp included",
                note: "A rank can set its own cooldowns: Ranks ▸ a rank ▸ Permissions ▸ Member ▸ Cooldowns. These are for ranks that set none.",
                fields: [
                    num("teleport.warmup", "Warmup: seconds to stand still before a teleport", "Every teleport: spawn, warps, homes, /back, /rtp, /tpa. 0 is instant", 0, 15),
                    sw("teleport.cancelOnMove", "Moving cancels a teleport", ""),
                    num("teleport.cooldown", "Cooldown for spawn, warps and /tpa, in seconds", "", 0, 60),
                    num("teleport.homeCooldown", "Cooldown for /home, in seconds", "", 0, 120),
                    num("teleport.backCooldown", "Cooldown for /back, in seconds", "", 0, 300),
                    num("teleport.rtpCooldown", "Cooldown for /rtp, in seconds", "Usually the longest, since the walk back is long", 0, 600, 5),
                    sw("staff.exemptCooldowns", "Staff skip warmups and cooldowns", "")
                ]
            }
        ]
    },
    {
        id: "chat",
        label: "Chat",
        hint: "Admin+ chat, chat rooms, private messages, emotes, join and leave lines",
        betaHint: "Admin+ chat, how chat lines look, chat rooms, private messages, emotes, join and leave",
        body: "What players type and read.",
        preview: true,
        pages: [
            {
                label: "Admin+ chat", hint: "Off hands chat to the game or another mod",
                fields: [sw("feature.adminchat", "Admin+ chat", "Off: chat is left to the game or another mod. No chat rooms, tags or screening in chat. Mutes still work, and chat is still logged.")]
            },
            {
                label: "Chat lines", hint: "How a chat line and a broadcast look", beta: true, note: TOKENS,
                fields: [
                    txt("format.chat", "Chat line", `${KEEPS_BOTH} Also: {BADGE} {TAG} {RANK}`, true),
                    txt("format.chatChannel", "Chat line for players who read several rooms", `{CHANNEL} is the room. ${KEEPS_BOTH}`, true),
                    txt("format.broadcast", "Broadcast line", "{MSG} is the broadcast, {NICKNAME} who sent it", true)
                ]
            },
            { label: "Chat rooms", hint: "Off means one chat for everyone", fields: [sw("feature.chat", "Chat rooms", "Separate chats, such as one for staff. Off means one chat for everyone.")] },
            {
                label: "Private messages", hint: "/pm, /r and /prchat",
                fields: [
                    sw("feature.pm", "Private messages", "/pm, /r and /prchat"),
                    beta(txt("format.pmOut", "A message you sent", `{NICKNAME} is who you sent it to. ${KEEPS_BOTH}`, true)),
                    beta(txt("format.pmIn", "A message you received", `{NICKNAME} is who sent it. ${KEEPS_BOTH}`, true)),
                    beta(txt("format.prchat", "A line in a private chat (/prchat)", "{PAIR} is both names, {NICKNAME} whoever spoke", true)),
                    beta(txt("format.spy", "Social spy line", "Only staff with Social spy on see it. {FROM} sent {MSG} to {TO}", true))
                ]
            },
            {
                label: "Emotes", hint: "/emote",
                fields: [
                    sw("feature.emote", "Emotes", "/emote: an action line, like * Steve waves"),
                    beta(txt("format.emote", "Emote line", KEEPS_BOTH, true))
                ]
            },
            {
                label: "Join and leave", hint: "Who joined and left, and a hello for newcomers",
                fields: [
                    sw("presence.announce", "Show join and leave lines", "Admin+ shows them instead of the game's"),
                    beta(txt("format.join", "Join line", KEEPS_NAME, true)),
                    beta(txt("format.leave", "Leave line", `/vanish shows it too, so vanishing looks like leaving. ${KEEPS_NAME}`, true)),
                    sw("presence.greet", "Greet newcomers", "One line, a few seconds after they join, that only they see"),
                    beta(txt("format.greeting", "Greeting line", "Empty sends nothing", true))
                ]
            }
        ],
        // Rooms are made and ordered on their own screen; the switch is above.
        extra: (player, again) => has(player, "chat.manage")
            ? [{ text: hubEntry("settings", "Manage chat rooms", "Make, lock and order the chats"), run: () => channelsScreen(player, again) }]
            : []
    },
    {
        id: "names",
        label: "Names and tags",
        hint: "Rank tags, cosmetic ranks, names above heads, name colours",
        betaHint: "Rank tags and how they look, cosmetic ranks, badges, names above heads, name effects",
        body: "How names and rank tags look, in chat and above heads.",
        betaPreview: true,
        pages: [
            {
                label: "Rank tags", hint: "Tags like [Mod] in chat and above heads",
                fields: [
                    sw("feature.ranktags", "Rank tags", "Off: no rank tags shown. Ranks still decide what people can use."),
                    num("format.tagCount", "How many tags show at once", "0 shows every one they have", 0, 5),
                    beta(txt("format.tag", "How one tag looks", "{OPEN} and {CLOSE} are the brackets below, {RANK} the rank's name", true)),
                    beta(txt("bracket.open", "Opening bracket", "", true)),
                    beta(txt("bracket.close", "Closing bracket", "", true)),
                    beta(txt("format.tagJoin", "Between two tags", "A space to start with. Empty puts them side by side")),
                    beta(txt("format.noRankTag", "Tag for a player with no rank", "Empty shows nothing", true))
                ]
            },
            { label: "Cosmetic ranks", hint: "Show the tags of cosmetic ranks", fields: [sw("feature.tags", "Cosmetic ranks", "Show the tags of cosmetic ranks, beside the rank tag")] },
            // Badges are Beta (core/badges.js), so their page shows on Beta only.
            {
                label: "Badges", hint: "A small picture before each rank's tag", beta: true,
                fields: [
                    sw("feature.badges", "Badges", "Before each rank's tag in chat and above heads, and on rank buttons instead of the word staff. Pick each rank's in Ranks ▸ a rank ▸ Badge."),
                    sw("badge.classic", "Classic style", "Coloured squares instead of Admin+'s dark tiles")
                ]
            },
            {
                label: "Names above heads", hint: "Off leaves nametags to the game or another mod",
                fields: [
                    sw("feature.nametags", "Names above heads", "Off: Admin+ never changes nametags, and puts every name back to the gamertag once"),
                    beta(txt("format.nameTag", "How a name above a head looks", `${KEEPS_NAME} Type \\n to put the tag on a line above the name.`, true))
                ]
            },
            {
                label: "Name colours", hint: "A colour or moving effect, set per rank",
                betaLabel: "Name effects",
                fields: [
                    {
                        ...sw("feature.namecolour", "Name colours", "A colour or moving effect on names, set in each rank's Basics"),
                        betaLabel: "Name effects",
                        betaDetail: "Colours that move along names. Players pick their own in /menu ▸ Personalization; a rank's Name effect switch decides who may."
                    },
                    num("namecolour.speed", "Speed of moving colours", "1 is fastest, 10 is slow", 1, 10)
                ]
            }
        ]
    },
    {
        id: "moderation",
        label: "Moderation",
        hint: "Reports, warnings, bans, vanish, lag clear, logs, staff items",
        body: "How the staff tools behave.\n§8Who may use each tool, such as gamemode or bans, is set per rank:\n§8Ranks ▸ a rank ▸ Permissions ▸ Administrative.",
        pages: [
            { label: "Reports", hint: "/report, and the list staff see", fields: [sw("feature.reports", "Reports", "/report, and the list of reports staff see")] },
            {
                label: "Warnings", hint: "How long a warning counts",
                fields: [num("warnings.expire", "Hours before a warning stops counting", "0 keeps every warning. Severe ones never expire.", 0, 720, 12)]
            },
            { label: "Bans", hint: "Whether a ban can be permanent", fields: [sw("ban.allowPermanent", "Permanent bans", "Off caps bans at 7 days")] },
            {
                label: "Vanish", hint: "Hidden staff",
                fields: [
                    sw("vanish.hideFromLists", "Hide vanished staff from player lists", "Staff still see them, marked. The game's own pause-menu list cannot be changed."),
                    sw("vanish.nightVision", "Night vision while vanished", "")
                ]
            },
            {
                label: "Inventory viewing", hint: "How /invsee draws an inventory",
                fields: [
                    sw("invsee.chestUI", "Show inventories as a chest grid", "Off gives a plain list"),
                    beta(num("invsee.iconOffset", "Icon nudge", "Only if every icon in the grid is off by the same number of places. Too far right by 2: set -2.", -20, 20))
                ]
            },
            {
                label: "Lag clear", hint: "What a lag clear removes",
                fields: [
                    sw("cleanup.items", "Dropped items", ""),
                    sw("cleanup.xp", "XP orbs", ""),
                    sw("cleanup.projectiles", "Spent arrows and tridents", ""),
                    sw("cleanup.fallingBlocks", "Falling sand and gravel", ""),
                    num("cleanup.warn", "Countdown before it clears, in seconds", "0 clears at once", 0, 30),
                    beta(txt("cleanup.keep", "Items it never clears", "Separated by commas, and part of a name is enough. Empty keeps the built-in list of valuables."))
                ]
            },
            {
                label: "Logs", hint: "What gets written down",
                fields: [
                    sw("logs.chat", "Chat log", ""),
                    beta(num("logs.chatCap", "Chat lines kept", "The oldest go first", 50, 1000, 50)),
                    sw("logs.commands", "Command log", ""),
                    beta(num("logs.commandCap", "Commands kept", "The oldest go first", 50, 1000, 50)),
                    sw("logs.signs", "What is written on signs", ""),
                    sw("logs.commandBlocks", "Who places and breaks command blocks", "")
                ]
            },
            {
                label: "Staff announcements", hint: "Staff see what other staff do",
                fields: [
                    sw("audit.announce", "Announce staff actions", "Seen only by staff who outrank the target, never by the target"),
                    beta(txt("format.command", "Staff action line", `{ACTION} is the whole sentence, like Banned Steve. ${KEEPS_NAME}`, true))
                ]
            },
            {
                label: "Staff items and pranks", hint: "The Ender Eye, the knockback stick, smite",
                fields: [
                    num("items.eyeRange", "How far the Ender Eye looks, in blocks", "", 16, 512, 16),
                    num("items.knockback", "How hard the knockback stick throws", "Very high values can throw a player into unloaded chunks", 1, 30),
                    num("items.knockbackLift", "How much of the throw goes up", "", 0, 5),
                    sw("troll.smiteFire", "Smite starts fires", "Off: the flash and the damage only")
                ]
            }
        ]
    },
    {
        id: "extras",
        label: "Player extras",
        hint: "Land claims and ender chests",
        body: "Extra things players can use.",
        pages: [
            {
                label: "Land claims", hint: "/claim: players protect their builds", note: PER_RANK,
                fields: [sw("feature.claims", "Land claims", "/claim: players protect their builds")]
            },
            { label: "Ender chests", hint: "/ec: open your ender chest anywhere", fields: [sw("feature.enderchest", "Ender chests", "/ec opens your ender chest anywhere. Staff can open another player's.")] }
        ]
    },
    {
        // The user's own path, 2026-11-12: "settings < Omnitool < General
        // (which is where all the toggles are)".
        id: "omnitool",
        label: "Omnitool",
        hint: "World tools, spawn as an area, the outline",
        body: "The Omnitool and /wts.",
        pages: [
            {
                label: "General", hint: "Every Omnitool switch",
                fields: [
                    sw("feature.worldtools", "World tools", "/wts and the Omnitool"),
                    sw("omni.spawn", "Spawn through the Omnitool", "Off deletes the Omnitool spawn and puts simple spawn back exactly as it was"),
                    sw("omni.outlineEveryone", "Everyone sees the outline", "Off shows it only to the person using the stick"),
                    num("omni.idleMinutes", "Minutes before an idle selection clears", "It also clears when they leave", 5, 30)
                ]
            }
        ]
    },
    {
        id: "automation",
        label: "Automation",
        hint: "Automations that run by themselves",
        body: "The automations themselves are in Server ▸ Automation.",
        pages: [
            {
                label: "General", hint: "Every Automation switch",
                fields: [
                    sw("feature.automation", "Automations", "Off stops every automation. They are kept."),
                    sw("automation.chatEdit", "Automations can change chat", "Lets cancel and replace work. replace needs Admin+ chat on.")
                ]
            }
        ]
    }
]

/** Every key a page sets, for the test that keeps groups and settings matched. */
export function settingKeys() {
    return GROUPS.flatMap(group => group.pages.flatMap(page => page.fields.map(field => field.key)))
}

/** The pages and fields shown in the look being shown: Beta ones only in Beta. */
export const pagesIn = group => group.pages
export const fieldsIn = page => page.fields

/** On or off, for the page's button. Only pages led by a feature switch have one. */
function stateOf(page) {
    const first = page.fields[0]
    if (first.kind !== "toggle" || !first.key.startsWith("feature.")) return ""
    return flag(first.key) ? "§aon§8 · " : "§coff§8 · "
}

/** A field's words: its label, then its detail in grey. */
function labelOf(field, extra = []) {
    const detail = inLook(field, "detail")
    return [inLook(field, "label"), detail ? `§8${detail}` : "", ...extra].filter(Boolean).join("\n")
}

export async function settingsScreen(player, back) {
    const again = () => settingsScreen(player, back)
    const beta = true // Beta's pages are everyone's since 2.12.10
    return menu(player, {
        title: hubTitle("settings", "Settings"),
        body: beta
            ? subtitle("Every setting, in groups.\nEach group is one page, with a section for each thing in it.")
            : subtitle("Everything you can switch on or off, in groups.\nEach group says what is in it."),
        buttons: [
            ...GROUPS.map(group => ({
                text: hubButton("settings", group.label, inLook(group, "hint")),
                run: () => groupScreen(player, group, again)
            })),
            // A group is one form in Beta, and a form holds no buttons, so the
            // way to the chat rooms moves here.
            ...(beta ? GROUPS.flatMap(group => group.extra?.(player, again) ?? []) : [])
        ],
        back
    })
}

export async function groupScreen(player, group, back) {
    return groupPageScreen(player, group, back)
    const again = () => groupScreen(player, group, back)
    return menu(player, {
        title: hubTitle("settings", group.label),
        body: [
            subtitle(group.body),
            group.preview ? `\n§8A chat line looks like this: §r${previewLine()}` : ""
        ].filter(Boolean).join("\n"),
        buttons: [
            // A Beta page (badges) shows only when the slider is on Beta.
            ...pagesIn(group).map(page => ({
                text: hubEntry("settings", inLook(page, "label"), `${stateOf(page)}${inLook(page, "hint")}`),
                run: () => pageScreen(player, page, again)
            })),
            ...(group.extra?.(player, again) ?? [])
        ],
        back
    })
}

/**
 * One thing and everything about it, as a form. Default's page.
 *
 * A page's note (where its per-rank numbers live) rides on the first field's
 * label. A ModalForm label element would shift every answer after it by one,
 * which is why this page never uses one.
 */
export async function pageScreen(player, page, back) {
    const shown = fieldsIn(page)
    const fields = shown.map((field, i) => fieldFor(field, labelOf(field, i === 0 && page.note ? [`§8${page.note}`] : [])))
    const title = inLook(page, "label")
    const values = await modal(player, hubTitle("settings", title), fields)
    if (!values) return back()

    // What the settings were, so Logs can undo this like any other config edit.
    const previous = overrides()
    const result = { moved: [], changed: [], refused: [] }
    for (const field of shown) {
        // "Teleport requests: off", not "Teleport requests: Teleport requests off".
        const said = inLook(field, "label")
        save(result, field, values[field.key], field.kind === "toggle" && said === title ? "" : said)
    }
    return saved(player, title, result, previous, back)
}

/** Save one answer into the running result. */
function save(result, field, raw, said) {
    const answer = applyField(field, raw, said)
    if (answer.words) { result.moved.push(field); result.changed.push(answer.words) }
    if (answer.refused) result.refused.push(answer.refused)
}

/**
 * Beta's group page (2.12.7): every page of the group as a section of one
 * form, the way + New rank lists its permissions. A bold label and a divider
 * start each section; a section's note is a line of its own.
 *
 * `strict`: answers are matched to fields by position, so a reply that came
 * back short would save the wrong values. It saves nothing instead.
 */
export async function groupPageScreen(player, group, back) {
    const pages = pagesIn(group)
    const preview = inLook(group, "preview")
    const fields = [{ type: "label", label: [subtitle(group.body), preview ? `§8A chat line looks like this: §r${previewLine()}` : ""].filter(Boolean).join("\n") }]
    for (const page of pages) {
        fields.push({ type: "divider" })
        fields.push({ type: "label", label: `§l${inLook(page, "label")}§r${page.note ? `\n§8${page.note}` : ""}` })
        for (const field of fieldsIn(page)) fields.push(fieldFor(field, labelOf(field)))
    }

    const values = await modal(player, hubTitle("settings", group.label), fields, { strict: true, submit: "Save" })
    if (values === undefined) return back()
    if (values === INCOMPLETE) {
        err(player, "Not every setting came back from the game, so nothing was saved. Try again.")
        return back()
    }

    const previous = overrides()
    const result = { moved: [], changed: [], refused: [] }
    for (const field of pages.flatMap(fieldsIn)) save(result, field, values[field.key], inLook(field, "label"))
    return saved(player, group.label, result, previous, back)
}

/** The end of every save: what was refused, what moved, and the log line. */
function saved(player, title, { moved, changed, refused }, previous, back) {
    if (refused.length) err(player, refused.join("\n"))
    if (!changed.length) {
        if (!refused.length) info(player, "Nothing changed.")
        return back()
    }

    // Handing nametags back: put every name back to the plain gamertag once,
    // so the last thing Admin+ wrote does not stay up there for good. Only
    // when the switch itself went off: with it already off, another mod may
    // be drawing them.
    if (moved.some(f => f.key === "feature.nametags") && !flag("feature.nametags")) {
        for (const p of world.getAllPlayers()) {
            try { p.nameTag = p.name } catch { /* left mid-loop */ }
        }
    }
    // A new tag or name format shows at once, not on the next 5-second pass.
    if (moved.some(f => f.kind === "text")) {
        system.run(() => { for (const p of world.getAllPlayers()) refreshNameTag(p) })
    }

    record(player, "config.edit", undefined, `${title}: ${changed.join(", ").replace(/§./g, "")}`,
        { kind: "config", overrides: previous })
    ok(player, `${title}: §r${changed.join("§a, §r")}§a.`)
    return back()
}
