import { ActionFormData, ModalFormData } from "@minecraft/server-ui"
import { CONFIG } from "../config.js"
import { BRAND_PREFIX } from "./theme.js"
import { betaLook, lookTitle, lift, tileText, cardText } from "./look.js"

// Form helpers. Every panel screen is built from these so navigation, paging and
// the "back" affordance behave the same everywhere.
//
// Bedrock note: a form cannot be shown from a read-only context (command
// callbacks, before-events). Callers must already be on a system.run tick — the
// command registry guarantees that.

const PAGE_SIZE = 24

/**
 * A header, label or divider: part of a menu that splits a list into sections
 * and cannot be pressed. Written in a button list as `{ header: "text" }`,
 * `{ label: "text" }` or `{ divider: true }`.
 */
export function isDecoration(entry) {
    return !!entry && (entry.divider === true || entry.header !== undefined || entry.label !== undefined)
}

/**
 * Draw one. A game too old to have these parts skips them rather than failing,
 * so the menu still works, just without the sections.
 */
function decorate(form, entry) {
    if (entry.divider === true) { if (typeof form.divider === "function") form.divider() }
    else if (entry.header !== undefined) { if (typeof form.header === "function") form.header(entry.header) }
    else if (typeof form.label === "function") form.label(entry.label)
}

/** A header or label made readable for the Beta look; a divider as it is. */
function liftDecoration(entry) {
    return { ...entry, header: lift(entry.header), label: lift(entry.label) }
}

/**
 * Whether a menu is drawn as tiles. Only in the Beta look, only when asked
 * (`layout: "tiles"`), and only when the menu is nothing but buttons: a label,
 * a divider or a Back button would be drawn as a tile too.
 */
export function drawsTiles(spec, beta) {
    return !!beta && spec.layout === "tiles" && !spec.back
        && spec.buttons.every(button => !button || !isDecoration(button))
}

/**
 * Whether a menu's card buttons are drawn as cards. Only in the Beta look and
 * only when asked (`layout: "cards"`). Unlike tiles, a menu of cards may have
 * other buttons and a Back button: those stay rows under the cards.
 */
export function drawsCards(spec, beta) {
    return !!beta && spec.layout === "cards"
}

/**
 * A menu screen.
 *
 * Headers, labels and dividers take no place in `actions`. The game numbers
 * only the BUTTONS when it says which one was pressed ("the index of the button
 * that was pushed", Microsoft's ActionFormResponse docs, read 2026-11-11), so
 * counting a divider here would shift every button after it by one.
 *
 * In the Beta look (core/look.js) the title carries the look's marker and the
 * text is lifted for the dark panel. With `layout: "tiles"` a button shows its
 * `tile` face (core/look.js tile()) instead of its text. With `layout:
 * "cards"` a button with a `card` face is drawn as a card (core/look.js CARD).
 * On Default, `layout`, `tile` and `card` are ignored and the menu is exactly
 * what it was.
 * @param {import("@minecraft/server").Player} player
 * @param {{title: string, body?: string, profile?: string, layout?: "tiles"|"cards"|"logs", buttons: ({text: string, icon?: string, tile?: {text: string, icon: string}, card?: {text: string, icon?: string}, run: () => any}|{header?: string, label?: string, divider?: boolean})[], back?: () => any}} spec
 */
export async function menu(player, spec) {
    const beta = betaLook()
    const tiles = drawsTiles(spec, beta)
    const cards = drawsCards(spec, beta)
    const show = text => beta ? lift(text) : text
    // A Profile card (2.12.3) goes with tiles only, and carries its own text
    // as the body: the card shows the body beside the player's model.
    const profile = tiles && spec.profile ? spec.profile : ""
    // The Logs timeline (2.12.5) has a frame of its own in Admin+'s look.
    const logs = beta && spec.layout === "logs"
    const form = new ActionFormData().title(beta ? lookTitle(spec.title, { tiles, profile: !!profile, logs }) : spec.title)
    const body = profile || spec.body
    if (body) form.body(show(body))
    const actions = []
    for (const button of spec.buttons) {
        if (!button) continue
        if (isDecoration(button)) { decorate(form, beta ? liftDecoration(button) : button); continue }
        if (cards && button.card) {
            form.button(show(cardText(button.card.text)), button.card.icon)
            actions.push(button.run)
            continue
        }
        const face = tiles && button.tile ? button.tile : button
        // As tiles, every other one carries the left-column marker (core/look.js).
        form.button(show(tiles ? tileText(face.text, actions.length) : face.text), face.icon)
        actions.push(button.run)
    }
    if (spec.back) {
        form.button(show("§8< Back"))
        actions.push(spec.back)
    }
    const response = await form.show(player)
    if (response.canceled) return
    const action = actions[response.selection]
    if (action) return action()
}

/**
 * A paged menu for lists that can outgrow one screen (players, ranks, warps).
 * @param {import("@minecraft/server").Player} player
 * @param {{title: string, body?: string, items: any[], render: (item: any) => {text: string, icon?: string}, onPick: (item: any) => any, extra?: {text: string, icon?: string, run: () => any}[], back?: () => any, page?: number}} spec
 */
export async function pagedMenu(player, spec) {
    const page = spec.page ?? 0
    const pages = Math.max(1, Math.ceil(spec.items.length / PAGE_SIZE))
    const slice = spec.items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    const buttons = slice.map(item => {
        const rendered = spec.render(item)
        // A section header or divider in the list is drawn as it is.
        if (isDecoration(rendered)) return rendered
        return { text: rendered.text, icon: rendered.icon, run: () => spec.onPick(item) }
    })
    for (const button of spec.extra ?? []) buttons.push(button)
    if (pages > 1) {
        if (page > 0) buttons.push({ text: "§8<< Previous page", run: () => pagedMenu(player, { ...spec, page: page - 1 }) })
        if (page < pages - 1) buttons.push({ text: "§8Next page >>", run: () => pagedMenu(player, { ...spec, page: page + 1 }) })
    }
    return menu(player, {
        title: spec.title,
        body: pages > 1 ? `${spec.body ?? ""}\n§8Page ${page + 1}/${pages}`.trim() : spec.body,
        buttons,
        back: spec.back
    })
}

/**
 * Yes/no confirmation. Resolves true only on an explicit confirm.
 *
 * Deliberately an ActionForm rather than a MessageForm: MessageFormData's
 * button1/button2 -> selection mapping is inverted from what the names suggest
 * and has bitten this exact pattern before. Action buttons index in the order
 * they were added, full stop — and a destructive default is never button 0.
 */
export async function confirm(player, titleText, body, confirmText = "§cConfirm", cancelText = "Cancel") {
    const beta = betaLook()
    const show = text => beta ? lift(text) : text
    const response = await new ActionFormData()
        .title(beta ? lookTitle(titleText) : titleText)
        .body(show(body))
        .button(show(cancelText))
        .button(show(confirmText))
        .show(player)
    return !response.canceled && response.selection === 1
}

/**
 * What `modal` answers, with `strict`, when the game sent back a different
 * number of answers than the form had fields. Answers are matched to fields
 * by position, so a short list would read the missing ones as off; a caller
 * that saves many switches at once refuses it instead.
 */
export const INCOMPLETE = Object.freeze({ incomplete: true })

/** A label, header or divider in a form's fields: drawn, never answered. */
const isFormDecoration = field => field?.type === "label" || field?.type === "header" || field?.type === "divider"

/**
 * A modal form. `fields` describe the controls; returns an object keyed by field
 * id, or undefined if the player cancelled.
 *
 * Fields may include `{ type: "label", label }` and `{ type: "divider" }` to
 * split a long form into sections. `options.submit` names the button (for
 * example "Continue"), and `options.strict` returns INCOMPLETE when the
 * answers don't line up with the fields.
 * @param {import("@minecraft/server").Player} player
 * @param {string} title
 * @param {{id?: string, type: "text"|"toggle"|"slider"|"dropdown"|"label"|"header"|"divider", label?: string, placeholder?: string, tooltip?: string, default?: any, min?: number, max?: number, step?: number, options?: string[]}[]} fields
 * @param {{submit?: string, strict?: boolean}} [options]
 */
export async function modal(player, title, fields, options = {}) {
    const beta = betaLook()
    const show = text => beta ? lift(text) : text
    const form = new ModalFormData().title(beta ? lookTitle(title) : title)
    // A tooltip is the "!" beside a box (server-ui 2.0.0 ModalFormData*Options).
    const tip = field => field.tooltip ? { tooltip: show(field.tooltip) } : {}
    for (const field of fields) {
        switch (field.type) {
            // Section parts. A game too old to draw them skips them, and the
            // answers are then read by the inputs alone (below).
            case "label":
                if (typeof form.label === "function") form.label(show(field.label ?? ""))
                break
            case "header":
                if (typeof form.header === "function") form.header(show(field.label ?? ""))
                break
            case "divider":
                if (typeof form.divider === "function") form.divider()
                break
            case "toggle":
                form.toggle(show(field.label), { defaultValue: !!field.default, ...tip(field) })
                break
            case "slider":
                form.slider(show(field.label), field.min ?? 0, field.max ?? 100, {
                    valueStep: field.step ?? 1,
                    defaultValue: field.default ?? field.min ?? 0
                })
                break
            case "dropdown":
                // The choices are drawn on the game's own drop-down in both
                // looks, so they keep the colours chosen for it.
                form.dropdown(show(field.label), field.options ?? [], { defaultValueIndex: field.default ?? 0 })
                break
            default:
                // The box's value is never lifted: it is what gets saved.
                form.textField(show(field.label), show(field.placeholder ?? ""), { defaultValue: String(field.default ?? ""), ...tip(field) })
        }
    }
    // The button's own words, where the game allows it (Minecraft Essentials
    // does the same with "Save settings").
    if (options.submit && typeof form.submitButton === "function") form.submitButton(show(options.submit))
    const response = await form.show(player)
    if (response.canceled) return undefined
    const values = response.formValues ?? []
    // The game keeps a place in the answers for each label, header and divider
    // (CLAUDE.md: they shift formValues). A game that drew none of them answers
    // for the inputs alone. Anything else doesn't line up.
    const inputs = fields.filter(field => !isFormDecoration(field))
    const lined = values.length === fields.length ? fields : values.length === inputs.length ? inputs : null
    if (!lined && options.strict) return INCOMPLETE
    const out = {}
    ;(lined ?? fields).forEach((field, i) => { if (!isFormDecoration(field)) out[field.id] = values[i] })
    return out
}

/** Standard panel title, so every screen reads as one product. */
export function title(text) { return `${BRAND_PREFIX}§r${text}` }

/** Shorthand for the informational line at the top of a screen. */
export function subtitle(text) { return CONFIG.brand.info + text }
