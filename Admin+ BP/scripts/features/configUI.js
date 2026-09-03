import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, info } from "../core/util.js"
import { setSetting, flag } from "../core/settings.js"

// /admin ▸ Settings ▸ Configuration
//
// What exists on this server at all. Turning a feature off takes its commands
// with it — /tpa answers "teleport requests are turned off here" rather than
// half-working — so this is the honest place to shape the server, and nobody
// has to remember which commands to tell players not to use.

const FEATURES = [
    { key: "feature.warps", label: "Warps", detail: "/warp · /warps · the Warps panel" },
    { key: "feature.spawn", label: "Spawn", detail: "/spawn and the spawn point" },
    { key: "feature.tpa", label: "Teleport requests", detail: "/tpa · /tpahere · /tpaccept · /tpadeny" },
    { key: "feature.reports", label: "Reports", detail: "/report and the pinned queue" },
    { key: "feature.chat", label: "Chat channels", detail: "off = one plain chat for everyone" }
]

export async function configurationScreen(player, back) {
    const again = () => configurationScreen(player, back)
    const on = FEATURES.filter(f => flag(f.key)).length

    return menu(player, {
        title: hubTitle("settings", "Configuration"),
        body: [
            subtitle(`${on} of ${FEATURES.length} features on.`),
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
    const values = await modal(player, hubTitle("settings", "Configuration"),
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
    ok(player, `Updated: §r${changed.join("§a, ")}§a.`)
    return back()
}

