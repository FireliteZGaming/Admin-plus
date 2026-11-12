import { CONFIG } from "../config.js"

// Where people can reach the people who make Admin+, in one place, so every
// screen that prints a link prints the same one.

/** The Admin+ Discord as a line to print, or a note that it is not out yet. */
export function discordLine() {
    const link = String(CONFIG.brand?.discord ?? "").trim()
    return link ? `§9${link}` : "§8(the link is coming soon)"
}
