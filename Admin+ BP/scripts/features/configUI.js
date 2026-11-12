import { world } from "@minecraft/server"
import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, info } from "../core/util.js"
import { setSetting, flag } from "../core/settings.js"

// /admin ▸ Server ▸ Features
//
// What exists on this server at all. Turning a feature off takes its commands
// with it — /tpa says "teleport requests are turned off on this server" rather
// than half-working — so this is the place to shape the server, and nobody has
// to remember which commands to tell players not to use.

const FEATURES = [
    { key: "feature.warps", label: "Warps", detail: "/warp, and the list of warps" },
    { key: "feature.spawn", label: "Spawn", detail: "/spawn" },
    { key: "feature.homes", label: "Homes", detail: "/home: players save their own places" },
    { key: "feature.back", label: "Go back", detail: "/back: return to a teleport or a death" },
    { key: "feature.rtp", label: "Random teleport", detail: "/rtp: a safe spot far away" },
    { key: "feature.tpa", label: "Teleport requests", detail: "/tpa and /tpahere" },
    { key: "feature.claims", label: "Land claims", detail: "/claim: players protect their builds" },
    // For a server running another chat or rank mod: each one hands a job back.
    { key: "feature.adminchat", label: "Admin+ chat", detail: "off: chat is left to the game or another mod. Mutes still work" },
    { key: "feature.chat", label: "Chat rooms", detail: "off means one chat for everyone" },
    { key: "feature.ranktags", label: "Rank tags", detail: "tags in chat and above heads. Off: ranks still work, unseen" },
    { key: "feature.tags", label: "Cosmetic tags", detail: "tags that only change how a name looks" },
    { key: "feature.nametags", label: "Names above heads", detail: "off: Admin+ leaves nametags alone" },
    { key: "feature.namecolour", label: "Name colours", detail: "a colour or moving effect, set per rank" },
    { key: "feature.pm", label: "Private messages", detail: "/pm, /r and /prchat" },
    { key: "feature.emote", label: "Emotes", detail: "/emote" },
    { key: "feature.reports", label: "Reports", detail: "/report, and the list staff see" },
    { key: "feature.enderchest", label: "Ender chests", detail: "/ec: open your ender chest anywhere" }
]

export async function configurationScreen(player, back) {
    const again = () => configurationScreen(player, back)
    const on = FEATURES.filter(f => flag(f.key)).length

    return menu(player, {
        title: hubTitle("settings", "Features"),
        body: [
            subtitle(`${on} of ${FEATURES.length} features are on.`),
            "",
            ...FEATURES.map(f => `${flag(f.key) ? "§a✔" : "§8✘"} §r${f.label}§8 · ${f.detail}`)
        ].join("\n"),
        buttons: [
            { text: "§bTurn features on and off", run: () => togglesScreen(player, again) }
        ],
        back
    })
}

async function togglesScreen(player, back) {
    const values = await modal(player, hubTitle("settings", "Features"),
        FEATURES.map(f => ({
            id: f.key,
            type: "toggle",
            label: `${f.label}\n§8${f.detail}`,
            default: flag(f.key)
        })))
    if (!values) return back()

    const changed = []
    for (const f of FEATURES) {
        const now = !!values[f.key]
        if (now === flag(f.key)) continue
        setSetting(f.key, now ? "true" : "false")
        changed.push(`${f.label} ${now ? "§aon" : "§8off"}`)
    }

    if (!changed.length) { info(player, "Nothing changed."); return back() }

    // Handing nametags back: put every name back to the plain gamertag once,
    // so the last thing Admin+ wrote does not stay up there for good.
    if (!flag("feature.nametags") && values["feature.nametags"] === false) {
        for (const p of world.getAllPlayers()) {
            try { p.nameTag = p.name } catch { /* left mid-loop */ }
        }
    }

    ok(player, `Updated: §r${changed.join("§a, ")}§a.`)
    return back()
}
