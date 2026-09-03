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
        how: "Bedrock gives scripts no container UI. This module worked out that a form's title and its button icons are strings a resource pack can match on, so a sentinel in the title tells the pack to redraw the form as a 9-column grid. Admin+ includes its id table and its JSON-UI, both modified, and speaks the same wire format on purpose — two packs that implement it can then draw each other's windows, whichever one wins the resource-pack order."
    }
]

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
            "§fIncludes code from",
            ...INCLUDED.map(entry => `§8· §f${entry.pack} §8— ${entry.licence}`),
            "",
            "§fTechniques learned from",
            ...LEARNED_FROM.map(entry => `§8· §f${entry.pack} §8— ${entry.what}`),
            "",
            "§8Nothing from that second list ships here — those are ideas,",
            "§8rewritten. Tap any of them to read what was taken."
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
                    "§8Every file taken is named in THIRD-PARTY-NOTICES.md."
                ]
                : [
                    `§8Written from scratch here. Nothing from ${entry.pack} is`,
                    "§8shipped in this pack — the idea is theirs, the code is ours."
                ])
        ].join("\n"),
        buttons: [],
        back
    })
}

export { AUTHOR }
