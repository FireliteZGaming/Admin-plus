import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, info } from "../core/util.js"
import { setting, setSetting, resetSetting, flag, DEFAULTS } from "../core/settings.js"
import { ladder } from "../core/ranks.js"

// /admin ▸ Settings ▸ Teleport tuning
//
// The same values the < Code > block exposes, as a form for people who would
// rather not edit text. Both write the same store, so whichever you use, the
// other reflects it immediately.
//
// Per-rank cooldowns are NOT here — they live on the rank (Ranks ▸ Ladder ▸
// <rank> ▸ Meta), because they differ per rank by definition. This screen sets
// the default those fall back to.

export async function teleportTuningScreen(player, back) {
    const warmup = Number(setting("teleport.warmup"))
    const cooldown = Number(setting("teleport.cooldown"))
    const expire = Number(setting("tpa.expire"))
    const exempt = flag("staff.exemptCooldowns")
    const cancels = flag("teleport.cancelOnMove")

    // Show which ranks override the default, so the number on this screen is
    // never mistaken for what everyone actually waits.
    const overrides = ladder()
        .filter(r => r.meta && r.meta.tpCooldown !== undefined)
        .map(r => `${r.display}§8 ${r.meta.tpCooldown}s`)

    return menu(player, {
        title: hubTitle("settings", "Teleport tuning"),
        body: [
            subtitle("Applies to warps, spawn, TPA and back."),
            "",
            `§fWarmup: §7${warmup}s${warmup === 0 ? " §8(instant)" : ""}`,
            `§fMoving cancels it: §7${cancels ? "yes" : "no"}`,
            `§fDefault cooldown: §7${cooldown}s`,
            `§fTPA expiry: §7${expire}s`,
            `§fStaff exempt: §7${exempt ? "yes" : "no"}`,
            overrides.length ? `\n§8Ranks with their own cooldown: ${overrides.join("§8, ")}` : ""
        ].join("\n"),
        buttons: [
            { text: "§bEdit values", run: () => editScreen(player, () => teleportTuningScreen(player, back)) },
            { text: "§8Reset teleport values to defaults", run: () => resetScreen(player, () => teleportTuningScreen(player, back)) }
        ],
        back
    })
}

const KEYS = ["teleport.warmup", "teleport.cooldown", "tpa.expire"]

async function editScreen(player, back) {
    const values = await modal(player, hubTitle("settings", "Teleport tuning"), [
        {
            id: "warmup",
            type: "slider",
            label: "Warmup seconds §8· 0 is instant",
            min: 0, max: 15, step: 1,
            default: clamp(Number(setting("teleport.warmup")), 0, 15, 2)
        },
        {
            id: "cancel",
            type: "toggle",
            label: "Moving cancels a teleport",
            default: flag("teleport.cancelOnMove")
        },
        {
            id: "cooldown",
            type: "slider",
            label: "Default cooldown seconds §8· ranks can override this",
            min: 0, max: 60, step: 1,
            default: clamp(Number(setting("teleport.cooldown")), 0, 60, 3)
        },
        {
            id: "expire",
            type: "slider",
            label: "TPA request expiry seconds",
            min: 15, max: 300, step: 5,
            default: clamp(Number(setting("tpa.expire")), 15, 300, 60)
        },
        {
            id: "exempt",
            type: "toggle",
            label: "Staff skip warmup and cooldown",
            default: flag("staff.exemptCooldowns")
        }
    ])
    if (!values) return back()

    setSetting("teleport.warmup", String(values.warmup))
    setSetting("teleport.cancelOnMove", values.cancel ? "true" : "false")
    setSetting("teleport.cooldown", String(values.cooldown))
    setSetting("tpa.expire", String(values.expire))
    setSetting("staff.exemptCooldowns", values.exempt ? "true" : "false")

    ok(player, "Teleport tuning saved.")
    if (values.warmup === 0 && values.cancel) {
        info(player, "§7Warmup is 0, so nothing can cancel — teleports fire instantly for everyone.")
    }
    return back()
}

function clamp(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, Math.round(value)))
}

async function resetScreen(player, back) {
    for (const key of [...KEYS, "teleport.cancelOnMove", "staff.exemptCooldowns"]) resetSetting(key)
    ok(player, "Teleport values back to defaults" +
        ` §8(warmup ${DEFAULTS["teleport.warmup"].value}s, cooldown ${DEFAULTS["teleport.cooldown"].value}s).`)
    return back()
}
