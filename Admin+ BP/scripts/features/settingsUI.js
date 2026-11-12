import { world } from "@minecraft/server"
import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ok, info } from "../core/util.js"
import { setting, setSetting, flag, overrides, DEFAULTS } from "../core/settings.js"
import { has } from "../core/ranks.js"
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
// request lasts. The rarely touched values (text formats, log sizes, filter
// word lists) stay in Server ▸ Advanced ▸ Every setting.
//
// A page only writes what was changed. A slider showing a value clamped into
// its range writes nothing unless it was moved, so a number set out of range
// in Advanced is never quietly rewritten by opening this page.

/** A switch. */
const sw = (key, label, detail) => ({ key, kind: "toggle", label, detail })
/** A number on a slider. The shipped default must sit inside min and max. */
const num = (key, label, detail, min, max, step = 1) => ({ key, kind: "slider", label, detail, min, max, step })

/** Where per-rank numbers live, for the pages whose limits are set on a rank. */
const PER_RANK = "How many each rank gets is set on the rank: Ranks ▸ a rank ▸ Permissions ▸ Member ▸ Limits."

export const GROUPS = [
    {
        id: "travel",
        label: "Travel",
        hint: "Spawn, warps, homes, /back, random teleport, teleport requests",
        body: "Every way players get around, and how long they wait.\nThe same things players find in /menu ▸ Travel.",
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
                    num("rtp.range", "Furthest it sends someone, in blocks", "", 500, 20000, 500),
                    num("rtp.tries", "Spots to test before giving up", "An ocean world needs more", 4, 64, 4)
                ]
            },
            {
                label: "Teleport requests", hint: "/tpa and /tpahere, and how long a request lasts",
                fields: [
                    sw("feature.tpa", "Teleport requests", "/tpa and /tpahere: ask to teleport, and the other player says yes or no"),
                    num("tpa.expire", "Seconds a request waits before it lapses", "", 15, 300, 5)
                ]
            },
            {
                label: "Wait times", hint: "Warmup and cooldown, for every way of travelling",
                note: "A rank can set its own cooldowns: Ranks ▸ a rank ▸ Permissions ▸ Member ▸ Cooldowns.",
                fields: [
                    num("teleport.warmup", "Warmup: seconds to stand still before a teleport", "0 is instant", 0, 15),
                    sw("teleport.cancelOnMove", "Moving cancels a teleport", ""),
                    num("teleport.cooldown", "Cooldown: seconds between teleports", "For ranks that set none of their own", 0, 60),
                    sw("staff.exemptCooldowns", "Staff skip warmups and cooldowns", "")
                ]
            }
        ]
    },
    {
        id: "chat",
        label: "Chat",
        hint: "Admin+ chat, chat rooms, private messages, emotes, join and leave lines",
        body: "What players type and read.",
        preview: true,
        pages: [
            {
                label: "Admin+ chat", hint: "Off hands chat to the game or another mod",
                fields: [sw("feature.adminchat", "Admin+ chat", "Off: chat is left to the game or another mod. No chat rooms, tags or screening in chat. Mutes still work, and chat is still logged.")]
            },
            { label: "Chat rooms", hint: "Off means one chat for everyone", fields: [sw("feature.chat", "Chat rooms", "Separate chats, such as one for staff. Off means one chat for everyone.")] },
            { label: "Private messages", hint: "/pm, /r and /prchat", fields: [sw("feature.pm", "Private messages", "/pm, /r and /prchat")] },
            { label: "Emotes", hint: "/emote", fields: [sw("feature.emote", "Emotes", "/emote: an action line, like * Steve waves")] },
            {
                label: "Join and leave", hint: "Who joined and left, and a hello for newcomers",
                fields: [
                    sw("presence.announce", "Show join and leave lines", "Admin+ prints them in place of the game's"),
                    sw("presence.greet", "Greet newcomers", "One line, a few seconds after they join, that only they see")
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
        body: "How names and rank tags look, in chat and above heads.",
        pages: [
            {
                label: "Rank tags", hint: "Tags like [Mod] in chat and above heads",
                fields: [
                    sw("feature.ranktags", "Rank tags", "Off: no rank tags shown. Ranks still decide what people can use."),
                    num("format.tagCount", "How many tags show at once", "0 shows every one they have", 0, 5)
                ]
            },
            { label: "Cosmetic ranks", hint: "Show the tags of cosmetic ranks", fields: [sw("feature.tags", "Cosmetic ranks", "Show the tags of cosmetic ranks, beside the rank tag")] },
            { label: "Names above heads", hint: "Off leaves nametags to the game or another mod", fields: [sw("feature.nametags", "Names above heads", "Off: Admin+ never changes nametags, and puts every name back to the gamertag once")] },
            {
                label: "Name colours", hint: "A colour or moving effect, set per rank",
                fields: [
                    sw("feature.namecolour", "Name colours", "A colour or moving effect on names, set in each rank's Basics"),
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
            { label: "Inventory viewing", hint: "How /invsee draws an inventory", fields: [sw("invsee.chestUI", "Show inventories as a chest grid", "Off gives a plain list")] },
            {
                label: "Lag clear", hint: "What a lag clear removes",
                fields: [
                    sw("cleanup.items", "Dropped items", ""),
                    sw("cleanup.xp", "XP orbs", ""),
                    sw("cleanup.projectiles", "Spent arrows and tridents", ""),
                    sw("cleanup.fallingBlocks", "Falling sand and gravel", ""),
                    num("cleanup.warn", "Countdown before it clears, in seconds", "0 clears at once", 0, 30)
                ]
            },
            {
                label: "Logs", hint: "What gets written down",
                fields: [
                    sw("logs.chat", "Chat log", ""),
                    sw("logs.commands", "Command log", ""),
                    sw("logs.signs", "What is written on signs", ""),
                    sw("logs.commandBlocks", "Who places and breaks command blocks", "")
                ]
            },
            { label: "Staff announcements", hint: "Staff see what other staff do", fields: [sw("audit.announce", "Announce staff actions", "Seen only by staff who outrank the target, never by the target")] },
            {
                label: "Staff items and pranks", hint: "The Ender Eye, the knockback stick, smite",
                fields: [
                    num("items.eyeRange", "How far the Ender Eye looks, in blocks", "", 16, 512, 16),
                    num("items.knockback", "How hard the knockback stick throws", "Very high numbers can lose a player in unloaded land", 1, 30),
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
            { label: "Ender chests", hint: "/ec: open your ender chest anywhere", fields: [sw("feature.enderchest", "Ender chests", "/ec opens your ender chest anywhere. Staff can open somebody else's.")] }
        ]
    }
]

/** Every key a page sets, for the test that keeps groups and settings matched. */
export function settingKeys() {
    return GROUPS.flatMap(group => group.pages.flatMap(page => page.fields.map(field => field.key)))
}

/** A number kept inside its slider's range, for showing on the slider. */
function shownNumber(field) {
    const stored = Number(setting(field.key))
    const fallback = Number(DEFAULTS[field.key]?.value ?? field.min)
    const value = Number.isFinite(stored) ? stored : fallback
    return Math.min(field.max, Math.max(field.min, value))
}

/** On or off, for the page's button. Only pages led by a feature switch have one. */
function stateOf(page) {
    const first = page.fields[0]
    if (first.kind !== "toggle" || !first.key.startsWith("feature.")) return ""
    return flag(first.key) ? "§aon§8 · " : "§coff§8 · "
}

export async function settingsScreen(player, back) {
    const again = () => settingsScreen(player, back)
    return menu(player, {
        title: hubTitle("settings", "Settings"),
        body: subtitle("Everything you can switch on or off, in groups.\nEach group says what is in it."),
        buttons: GROUPS.map(group => ({
            text: hubButton("settings", group.label, group.hint),
            run: () => groupScreen(player, group, again)
        })),
        back
    })
}

export async function groupScreen(player, group, back) {
    const again = () => groupScreen(player, group, back)
    return menu(player, {
        title: hubTitle("settings", group.label),
        body: [
            subtitle(group.body),
            group.preview ? `\n§8A chat line looks like this: §r${previewLine()}` : ""
        ].filter(Boolean).join("\n"),
        buttons: [
            ...group.pages.map(page => ({
                text: hubEntry("settings", page.label, `${stateOf(page)}${page.hint}`),
                run: () => pageScreen(player, page, again)
            })),
            ...(group.extra?.(player, again) ?? [])
        ],
        back
    })
}

/**
 * One thing and everything about it, as a form.
 *
 * A page's note (where its per-rank numbers live) rides on the first field's
 * label. A ModalForm label element would shift every answer after it by one,
 * which is why the forms in this pack never use one.
 */
export async function pageScreen(player, page, back) {
    const fields = page.fields.map((field, i) => {
        const extra = [field.detail ? `§8${field.detail}` : "", i === 0 && page.note ? `§8${page.note}` : ""].filter(Boolean)
        const label = [field.label, ...extra].join("\n")
        return field.kind === "toggle"
            ? { id: field.key, type: "toggle", label, default: flag(field.key) }
            : { id: field.key, type: "slider", label, min: field.min, max: field.max, step: field.step, default: shownNumber(field) }
    })
    const values = await modal(player, hubTitle("settings", page.label), fields)
    if (!values) return back()

    // What the settings were, so Logs can undo this like any other config edit.
    const previous = overrides()
    const changed = []
    for (const field of page.fields) {
        const raw = values[field.key]
        // An unanswered field keeps what it had; see submittedValue in code.js.
        if (raw === undefined) continue
        if (field.kind === "toggle") {
            if (!!raw === flag(field.key)) continue
            setSetting(field.key, raw ? "true" : "false")
            changed.push(`${field.label} ${raw ? "§aon" : "§8off"}`)
        } else {
            // Unmoved means unchanged, even when the stored value sits outside
            // the slider and was shown clamped.
            if (Number(raw) === shownNumber(field)) continue
            setSetting(field.key, String(raw))
            changed.push(`${field.label}: §f${raw}`)
        }
    }

    if (!changed.length) { info(player, "Nothing changed."); return back() }

    // Handing nametags back: put every name back to the plain gamertag once,
    // so the last thing Admin+ wrote does not stay up there for good.
    if (page.fields.some(f => f.key === "feature.nametags") && values["feature.nametags"] === false && !flag("feature.nametags")) {
        for (const p of world.getAllPlayers()) {
            try { p.nameTag = p.name } catch { /* left mid-loop */ }
        }
    }

    record(player, "config.edit", undefined, `${page.label}: ${changed.join(", ").replace(/§./g, "")}`,
        { kind: "config", overrides: previous })
    ok(player, `${page.label}: §r${changed.join("§a, §r")}§a.`)
    return back()
}
