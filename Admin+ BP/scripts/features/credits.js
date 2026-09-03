import { menu } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ADMINPLUS_VERSION } from "../config.js"

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

/** Technique borrowed, file not. Each line has to stay true. */
const LEARNED_FROM = [
    {
        pack: "SafeGuard",
        what: "Warning people when Beta APIs is off",
        how: "A beta-gated script cannot report its own absence — it never runs. Functions are data and still do, so the watchdog in functions/admin/ is the one channel that reaches a player when nothing else of ours is executing."
    },
    {
        pack: "ChestFormData",
        what: "Showing an inventory as a real chest grid",
        how: "Bedrock gives scripts no container UI. The community worked out that a form title and its button icons are strings a resource pack can match on, so a sentinel title plus numeric icon ids can be redrawn as a 9-column grid of real item textures. The protocol is maintained by Herobrine64 and LeGend077 and is what every addon that shows an inventory speaks. Admin+ speaks the same wire format on purpose, so its chest windows still render correctly when another pack that also implements it wins the resource-pack order."
    },
    {
        pack: "UltraVanish",
        what: "Actually disappearing",
        how: "The invisibility effect leaves armour and held items rendering. A resource-pack animation that scales every bone to zero is what hides them, re-stamped every tick because the animation lapses on its own."
    }
]

export async function creditsScreen(player, back) {
    return menu(player, {
        title: hubTitle("about", "Credits"),
        body: [
            `§l§bAdmin§d+§r §8v${ADMINPLUS_VERSION}`,
            "",
            `§fBuilt by §d§l${AUTHOR}§r`,
            "",
            "§7An admin toolkit for Bedrock: ranks, moderation, warps,",
            "§7TPA, chat channels and automod. No economy, no shop —",
            "§7the §f+§7 means essentials, not a server suite.",
            "",
            "§fTechniques learned from",
            ...LEARNED_FROM.map(entry => `§8· §f${entry.pack} §8— ${entry.what}`),
            "",
            "§8No files, assets or code from those packs ship here.",
            "§8Tap one to read what was actually taken from it."
        ].join("\n"),
        buttons: LEARNED_FROM.map(entry => ({
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
            `§8Written from scratch here. Nothing from ${entry.pack} is shipped`,
            "§8in this pack — the idea is theirs, the code is ours."
        ].join("\n"),
        buttons: [],
        back
    })
}

export { AUTHOR }
