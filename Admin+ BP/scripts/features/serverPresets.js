import { menu, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { discordLine } from "../core/links.js"

// /admin ▸ Server ▸ Server presets
//
// On hold since 2.8.6. The user, 2026-11-12: "we can somewhat wipe presets now
// and just when people click on it it says join the discord to suggest ideas
// for presets". So the button stays and asks for ideas instead of offering the
// old four (Server, Realm, SMP, Quiet survival).
//
// Those four are still defined in core/serverPresets.js, and /scriptevent can
// still apply them, so nothing anyone relied on breaks and presets can come
// back as people suggest them.

export async function serverPresetsScreen(player, back) {
    return menu(player, {
        title: hubTitle("presets", "Server presets"),
        body: [
            subtitle("A preset sets up a whole server in one step:\nranks, settings and chats."),
            "",
            "§fNew presets are on the way.",
            "§7Join the Discord to suggest ideas for them:",
            `  ${discordLine()}`
        ].join("\n"),
        buttons: [],
        back
    })
}
