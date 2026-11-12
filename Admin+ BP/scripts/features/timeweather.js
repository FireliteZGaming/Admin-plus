import { world, CustomCommandParamType, WeatherType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { menu, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { askText } from "../core/ask.js"
import { noteExecuted } from "../core/cmdlog.js"

// /clock and /sky: time and weather, the two vanilla jobs Admin+ keeps for
// staff (2.8.2). Since 2.8.4 they are Admin+'s own commands, set through the
// script API, so they need no operator and run no vanilla command at all.
//
// The user, 2026-11-12: /sky gives "the fill for (clear, rain, thunder and
// such)", and "time is like /clock (day, night, sunrise, sunset, noon,
// midnight) or just numbers work too". A command parameter is either a word
// list the game suggests as you type, or free text, never both. So the six
// times are the list, and a number goes after `set`: `/clock day`,
// `/clock set 1000`. Typed alone, /clock offers all seven as buttons.
//
// Who may use them: the rank switch `admin.commands`, shown as "time and
// weather" (Ranks ▸ a rank ▸ Permissions ▸ Administrative ▸ Server settings).
// The node keeps its old id so ranks that already hold it keep the right.

const P = CustomCommandParamType

/** The game's own names for times of day, in the order a day goes round. Microsoft's TimeOfDay values. */
export const TIMES = [["day", 1000], ["noon", 6000], ["sunset", 12000], ["night", 13000], ["midnight", 18000], ["sunrise", 23000]]
const clockEnum = defineEnum("clocktime", [...TIMES.map(([name]) => name), "set"])

export const WEATHERS = ["clear", "rain", "thunder"]
const skyEnum = defineEnum("skyweather", WEATHERS)

/** The longest weather Bedrock accepts is 1,000,000 ticks: 833 whole minutes. */
const MAX_MINUTES = 833

/** Ticks as a clock time. Tick 0 is 6:00 in the morning. */
export function clockFace(ticks) {
    const total = ((Math.floor(Number(ticks)) % 24000) + 24000) % 24000
    const hours = (Math.floor(total / 1000) + 6) % 24
    const minutes = Math.floor((total % 1000) * 60 / 1000)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

const title = word => word[0].toUpperCase() + word.slice(1)

/** Bare /clock: the six times as buttons, then a number. */
async function askTime(player) {
    const now = world.getTimeOfDay()
    return menu(player, {
        title: hubTitle("actions", "/clock"),
        body: subtitle(`It is ${clockFace(now)} now. What time should it be?`),
        buttons: [
            ...TIMES.map(([name, ticks]) => ({ text: `§f${title(name)}§r\n§8${clockFace(ticks)}`, run: () => name })),
            { text: "§7A number§r\n§80 to 24000 · 6000 is noon", run: () => "set" }
        ]
    })
}

command({
    name: "clock",
    description: "Set the time: day, noon, sunset, night, midnight, sunrise, or set 0-24000",
    perm: "admin.commands",
    mandatory: [{ name: clockEnum, type: P.Enum, label: "What time?", ask: askTime }],
    optional: [{ name: "ticks", type: P.Integer }],
    run: async (player, [when, ticks]) => {
        const named = TIMES.find(([name]) => name === String(when ?? "").toLowerCase())
        let target = named?.[1]
        if (target === undefined) {
            let n = ticks
            if (n === undefined) {
                const typed = await askText(player, {
                    title: "/clock",
                    label: "Set the time to\n§80 to 24000. 0 is 6:00 in the morning, 6000 is noon, 18000 is midnight.",
                    placeholder: "6000"
                })
                if (typed === undefined) return
                n = Number(typed)
            }
            if (!Number.isInteger(n) || n < 0 || n > 24000) {
                return err(player, "The time is a whole number from 0 to 24000. 6000 is noon.")
            }
            target = n
        }
        try { world.setTimeOfDay(target) } catch (e) { return err(player, `Couldn't set the time: ${e}`) }
        noteExecuted(player, `time set ${target}`)
        ok(player, `It is now §f${clockFace(target)}§a${named ? ` (${named[0]})` : ""}.`)
    }
})

command({
    name: "sky",
    description: "Set the weather: clear, rain or thunder, optionally for some minutes",
    perm: "admin.commands",
    mandatory: [{ name: skyEnum, type: P.Enum, label: "Which weather?" }],
    optional: [{ name: "minutes", type: P.Integer }],
    run: (player, [kind, minutes]) => {
        const word = String(kind ?? "").toLowerCase()
        const type = { clear: WeatherType.Clear, rain: WeatherType.Rain, thunder: WeatherType.Thunder }[word]
        if (!type) return err(player, `"${kind}" is not a weather. Use clear, rain or thunder.`)
        if (minutes !== undefined && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES)) {
            return err(player, `Minutes run from 1 to ${MAX_MINUTES}. Leave it off and the game picks 5 to 15.`)
        }
        // Weather belongs to the Overworld: the other two have none.
        const overworld = world.getDimension("overworld")
        try {
            if (minutes === undefined) overworld.setWeather(type)
            else overworld.setWeather(type, minutes * 1200)
        } catch (e) { return err(player, `Couldn't change the weather: ${e}`) }
        noteExecuted(player, `weather ${word}${minutes ? ` for ${minutes} min` : ""}`)
        ok(player, `The weather is now §f${word}§a${minutes ? ` for ${minutes} minute${minutes === 1 ? "" : "s"}` : ""}.`)
    }
})
