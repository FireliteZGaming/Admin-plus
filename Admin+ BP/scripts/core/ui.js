import { ActionFormData, ModalFormData } from "@minecraft/server-ui"
import { CONFIG } from "../config.js"

// Form helpers. Every panel screen is built from these so navigation, paging and
// the "back" affordance behave the same everywhere.
//
// Bedrock note: a form cannot be shown from a read-only context (command
// callbacks, before-events). Callers must already be on a system.run tick — the
// command registry guarantees that.

const PAGE_SIZE = 24

/**
 * A menu screen.
 * @param {import("@minecraft/server").Player} player
 * @param {{title: string, body?: string, buttons: {text: string, icon?: string, run: () => any}[], back?: () => any}} spec
 */
export async function menu(player, spec) {
    const form = new ActionFormData().title(spec.title)
    if (spec.body) form.body(spec.body)
    const actions = []
    for (const button of spec.buttons) {
        if (!button) continue
        form.button(button.text, button.icon)
        actions.push(button.run)
    }
    if (spec.back) {
        form.button("§8< Back")
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
    const response = await new ActionFormData()
        .title(titleText)
        .body(body)
        .button(cancelText)
        .button(confirmText)
        .show(player)
    return !response.canceled && response.selection === 1
}

/**
 * A modal form. `fields` describe the controls; returns an object keyed by field
 * id, or undefined if the player cancelled.
 * @param {import("@minecraft/server").Player} player
 * @param {string} title
 * @param {{id: string, type: "text"|"toggle"|"slider"|"dropdown", label: string, placeholder?: string, default?: any, min?: number, max?: number, step?: number, options?: string[]}[]} fields
 */
export async function modal(player, title, fields) {
    const form = new ModalFormData().title(title)
    for (const field of fields) {
        switch (field.type) {
            case "toggle":
                form.toggle(field.label, { defaultValue: !!field.default })
                break
            case "slider":
                form.slider(field.label, field.min ?? 0, field.max ?? 100, {
                    valueStep: field.step ?? 1,
                    defaultValue: field.default ?? field.min ?? 0
                })
                break
            case "dropdown":
                form.dropdown(field.label, field.options ?? [], { defaultValueIndex: field.default ?? 0 })
                break
            default:
                form.textField(field.label, field.placeholder ?? "", { defaultValue: String(field.default ?? "") })
        }
    }
    const response = await form.show(player)
    if (response.canceled) return undefined
    const out = {}
    fields.forEach((field, i) => { out[field.id] = response.formValues[i] })
    return out
}

/** Standard panel title, so every screen reads as one product. */
export function title(text) { return `§l§bAdmin§d+§r §8| §r${text}` }

/** Shorthand for the informational line at the top of a screen. */
export function subtitle(text) { return CONFIG.brand.info + text }
