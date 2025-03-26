#!@GJS@ -m
// eslint-disable-next-line no-useless-escape
const MESON = '\@GJS@' !== '@GJS@' // the latter would be replace by Meson

import Gtk from 'gi://Gtk?version=4.0'
import GObject from 'gi://GObject'
import Gio from 'gi://Gio?version=2.0'
import GLib from 'gi://GLib?version=2.0'
import Adw from 'gi://Adw?version=1'
import Gdk from 'gi://Gdk'
import Pango from 'gi://Pango'
import Graphene from 'gi://Graphene'
import { programInvocationName, programArgs }  from 'system'
import { setConsoleLogDomain } from 'console'

/* utils */

const pkg = {}
pkg.id = 'io.github.johnfactotum.Runemaster'
GLib.set_prgname(pkg.id)
setConsoleLogDomain(pkg.id)
Gtk.Window.set_default_icon_name(pkg.id)

pkg.name = 'Runemaster'
GLib.set_application_name(pkg.name)

if (MESON) {
    // when using Meson, load from compiled GResource binary
    Gio.Resource
        .load(GLib.build_filenamev(['@datadir@', pkg.id, `${pkg.id}.gresource`]))
        ._register()
    const moduledir = '/' + pkg.id.replaceAll('.', '/')
    pkg.modulepath = path => GLib.build_filenamev([moduledir, path])
    pkg.moduleuri = path => `resource://${pkg.modulepath(path)}`
}
else {
    const moduledir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0])
    pkg.modulepath = path => GLib.build_filenamev([moduledir, path])
    pkg.moduleuri = path => GLib.filename_to_uri(pkg.modulepath(path), null)
}

Gio._promisify(Gio.File.prototype, 'load_contents_async')
Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async')

const gliter = model => ({
    [Symbol.iterator]: () => {
        let i = 0
        return {
            next: () => {
                const item = model.get_item(i++)
                if (item) return { value: [i - 1, item] }
                else return { done: true }
            },
        }
    },
})

Object.defineProperty(GObject.Object.prototype, '$', {
    get: function () {
        return new Proxy(this, {
            get: (target, prop) => (...args) =>
                (target[prop].bind(target)(...args), target),
        })
    },
})

Object.defineProperty(GObject.Object.prototype, '$$', {
    get: function () {
        return new Proxy(this, {
            get: (target, prop) => (...arr) => {
                const f = target[prop].bind(target)
                for (const args of arr)
                    if (Array.isArray(args)) f(...args)
                    else f(args)
                return target
            },
        })
    },
})

const makeParams = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => {
    const type = typeof v === 'string' ? v : 'object'
    const flags = GObject.ParamFlags.READWRITE
    return [k, GObject.ParamSpec[type](k, k, k, flags, ...(
        type === 'string' ? ['']
        : type === 'boolean' ? [false]
        : type === 'double' ? [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0]
        : type === 'int' ? [GLib.MININT32, GLib.MAXINT32, 0]
        : type === 'uint' ? [0, GLib.MAXUINT32, 0]
        : type === 'uint64' ? [0, Number.MAX_SAFE_INTEGER, 0]
        : type === 'object' ? [GObject.Object.$gtype, null]
        : [v, null]
    ))]
}))

const makeGObject = obj => Object.assign(new GObject.Object(), obj)

const esc = x => GLib.markup_escape_text(x, -1)

/* Unicode data */

const readData = async path => JSON.parse(new TextDecoder().decode(
    (await Gio.File.new_for_uri(pkg.moduleuri(path))
        .load_contents_async(null))[0]))

const formatHex = (x, pad = 4) => x.toString(16).toUpperCase().padStart(pad, '0')
const data = await readData('data/data.json')

const GC = new Map(data.aliases.gc)
const map = new Map(data.map)
const namesList = new Map(data.namesList)
const scripts = new Map(data.scripts)
const getNameAndCategory = n => map.get(n)
    ?? data.ranges.find(([a, b]) => n >= a && n <= b)?.slice(2)
    ?? ['<Unassigned>', 'Cn']

const getBlock = code => data.blocks.find(([[a, b]]) => code >= a && code <=b)?.[1]

const getCode = code => {
    const [originalName, category] = getNameAndCategory(code)
    let name = originalName
    if (name === '<control>') {
        const alias = namesList.get(code)?.['=']?.[0]
        if (alias) name = alias
    }
    else {
        const correction = namesList.get(code)?.['%']?.[0]
        if (correction) name = correction
    }
    const block = getBlock(code)
    const script = []
    if (category !== 'Cn') for (const [name, ranges] of scripts)
        for (const [a, b = a] of ranges) if (code >=a && code <= b) {
            script.push(name)
            break
        }
    return { code, originalName, name, category, block, script }
}

const getChar = char => getCode(char.codePointAt(0) ?? 0)
const getChars = str => Array.from(str, getChar)

const entities = new Map(await readData('data/entities.json'))

const escapeSequences = new Map([
    ['\\a', 0x07],
    ['\\b', 0x08],
    ['\\f', 0x0c],
    ['\\n', 0x0a],
    ['\\r', 0x0d],
    ['\\t', 0x09],
    ['\\v', 0x0b],
    ['\\e', 0x1b],
])

const hexRegex = new RegExp([
    /(?:[Uu]\+|0x|\\x|\\[Uu])([0-9A-Fa-f]+)/,
    /&#x([0-9A-Fa-f]+);/,
    /\\u{([0-9A-Fa-f]+)}/,
].map(x => `^${x.source}$`).join('|'))

const parseCode = str => {
    const hex = str.match(hexRegex)
    if (hex) return parseInt(hex.slice(1).find(x => x), 16)
    const dec = str.match(/^&#(\d+);$/)
    if (dec) return parseInt(dec[1], 10)
    const octEsc = str.match(/^\\(\d{1,3})$/)
    if (octEsc) return parseInt(octEsc[1], 8)
    const oct = str.match(/^0[Oo](\d+)$/)
    if (oct) return parseInt(oct[1], 8)
    const bin = str.match(/^0[Bb](\d+)$/)
    if (bin) return parseInt(bin[1], 2)
}

const searchByName = q => {
    const qs = q.trim().toLowerCase().split(/\s/)
    const items = []
    const compare = x => {
        if (!x) return
        const arr = x.toLowerCase().split(' ')
        return qs.every(q => arr.includes(q))
    }
    for (const [code, [name]] of map)
        if (compare(name)) items.push(code)
    return items
}

const setCharCategory = (widget, cat) => {
    if (widget.lastCategory)
        widget.remove_css_class(widget.lastCategory)
    widget.add_css_class(cat)
    widget.lastCategory = cat
}

const compose = new Map(data.compose)

/* widgets */

const CHAR_PADDING = 18
const Char = GObject.registerClass({
    GTypeName: 'RunemasterChar',
    Properties: makeParams({
        'text': 'string',
        'draw-guidelines': 'boolean',
        'min-line': 'boolean',
        'font-fallback': 'boolean',
    }),
}, class extends Gtk.Widget {
    #fontDesc = new Pango.FontDescription()
    constructor(params) {
        super(params)
        this.hasTooltip = true
        this.layout = this.create_pango_layout(this.text)
        this.layout.set_alignment(Pango.Alignment.CENTER)
        if (!this.fontFallback) {
            const attrs = new Pango.AttrList()
            attrs.insert(Pango.attr_fallback_new(this.fontFallback))
            this.layout.set_attributes(attrs)
        }
        this.#fontDesc.set_size(8 * Pango.SCALE)
    }
    get text() {
        return this._text ?? ''
    }
    set text(text) {
        this._text = text
        if (this.layout) {
            this.layout.set_text(text, -1)
            this.queue_resize()
            this.queue_draw()
        }
        this.notify('text')
    }
    get drawGuidelines() {
        return this._drawGuidelines ?? false
    }
    set drawGuidelines(drawGuidelines) {
        this._drawGuidelines = drawGuidelines
        this.queue_draw()
        this.notify('draw-guidelines')
    }
    get fontFallback() {
        return this._fontFallback ?? false
    }
    set fontFallback(fontFallback) {
        this._fontFallback = fontFallback
        if (this.layout) {
            if (this.fontFallback) this.layout.set_attributes(null)
            else {
                const attrs = new Pango.AttrList()
                attrs.insert(Pango.attr_fallback_new(this.fontFallback))
                this.layout.set_attributes(attrs)
            }
            this.queue_draw()
        }
        this.notify('font-fallback')
    }
    vfunc_measure(orientation) {
        if (orientation === Gtk.Orientation.HORIZONTAL) return [-1, -1, -1, -1]
        const [ink, logical] = this.layout.get_extents()
        const height = Math.max(ink.height, logical.height) / Pango.SCALE + 2 * CHAR_PADDING
        return [this.minLine ? height : -1, height, -1, -1]
    }
    vfunc_snapshot(snapshot) {
        if (!this.fontFallback && this.layout.get_unknown_glyphs_count() > 0) return
        const { width, height } = this.get_allocation()
        snapshot.push_clip(new Graphene.Rect({
            origin: new Graphene.Point({ x: 0, y: 0 }),
            size: new Graphene.Size({ width, height }),
        }))

        const [ink, logical] = this.layout.get_extents()
        const logicalX = logical.x / Pango.SCALE
        const logicalY = logical.y
        const logicalWidth = logical.width / Pango.SCALE
        const logicalHeight = logical.height / Pango.SCALE
        const inkX = ink.x / Pango.SCALE
        const inkY = ink.y / Pango.SCALE
        const inkWidth = ink.width / Pango.SCALE
        const inkHeight = ink.height / Pango.SCALE

        // align ink if it overflows on one side
        let offsetX = 0
        if (inkWidth) {
            if (inkX < 0 && inkX + inkWidth < width) offsetX = -inkX
            else if (inkX > 0 && inkX + inkWidth > width) offsetX = -(inkX + inkWidth - width)
        }
        let offsetY = (height - logicalHeight) / 2
        if (inkHeight) {
            const y = inkY + offsetY
            if (y < 0 && y + inkHeight < height) offsetY = -inkY
            else if (y > 0 && y + inkHeight > height) offsetY = -(inkY + inkHeight - height)
        }

        if (this._drawGuidelines) {
            const color = this.get_color()
            color.alpha = .1
            const baselineColor = this.get_color()
            baselineColor.alpha = .2
            snapshot.append_color(color, new Graphene.Rect({
                origin: new Graphene.Point({ x: logicalX + logicalWidth + offsetX, y: 0 }),
                size: new Graphene.Size({ width: 1, height }),
            }))
            snapshot.append_color(color, new Graphene.Rect({
                origin: new Graphene.Point({ x: logicalX + offsetX, y: 0 }),
                size: new Graphene.Size({ width: 1, height }),
            }))
            const baseline = this.layout.get_baseline() / Pango.SCALE
            snapshot.append_color(baselineColor, new Graphene.Rect({
                origin: new Graphene.Point({ x: 0, y: baseline + offsetY }),
                size: new Graphene.Size({ width, height: 1 }),
            }))
            if (logicalY !== baseline)
                snapshot.append_color(color, new Graphene.Rect({
                    origin: new Graphene.Point({ x: 0, y: logicalY + offsetY }),
                    size: new Graphene.Size({ width, height: 1 }),
                }))
            const logicalEnd = logicalY + logicalHeight
            if (logicalEnd !== baseline)
                snapshot.append_color(color, new Graphene.Rect({
                    origin: new Graphene.Point({ x: 0, y: logicalEnd + offsetY }),
                    size: new Graphene.Size({ width, height: 1 }),
                }))
        }

        const hasUnknown = this.layout.get_unknown_glyphs_count() > 0
        if (!this._drawGuidelines && (!ink.width || hasUnknown)) {
            if (hasUnknown || !logicalWidth) {
                // draw character name
                const { name } = getChar(this._text)
                const layout = Pango.Layout.new(this.root.get_pango_context())
                    .$.set_width(width * Pango.SCALE)
                    .$.set_height(height * Pango.SCALE)
                    .$.set_wrap(Pango.WrapMode.WORD)
                    .$.set_ellipsize(Pango.EllipsizeMode.END)
                    .$.set_alignment(Pango.Alignment.CENTER)
                    .$.set_font_description(this.#fontDesc)
                    .$.set_text(name, -1)
                const [, logical] = layout.get_extents()
                const logicalWidth = logical.width / Pango.SCALE
                const logicalHeight = logical.height / Pango.SCALE
                const factor = Math.min(
                    width / logicalWidth * .9,
                    height / logicalHeight * .9, 1)
                const offsetY = (height - logicalHeight) / 2 * factor
                const dx = width * (1 - factor) / 2
                const dy = height * (1 - factor) / 2
                snapshot.translate(new Graphene.Point({ x: dx, y: dy + offsetY }))
                snapshot.scale(factor, factor)
                snapshot.append_layout(layout, this.get_color())
            }
            else {
                // draw space
                snapshot.translate(new Graphene.Point({ x: offsetX, y: offsetY }))
                const color = this.get_color()
                color.alpha = .15
                snapshot.append_color(color, new Graphene.Rect({
                    origin: new Graphene.Point({ x: logicalX, y: logicalY }),
                    size: new Graphene.Size({
                        width: Math.max(1, logicalWidth),
                        height: logicalHeight,
                    }),
                }))
            }
        }
        else {
            snapshot.translate(new Graphene.Point({ x: offsetX, y: offsetY }))
            snapshot.append_layout(this.layout, this.get_color())
        }
        snapshot.pop()
    }
    vfunc_size_allocate(w, h, baseline) {
        super.vfunc_size_allocate(w, h, baseline)
        this.layout.set_width(w * Pango.SCALE)
    }
    vfunc_query_tooltip(_, _x, _y, tooltip) {
        const code = this._text.codePointAt(0)
        const { name } = getCode(code)
        const font = Adw.StyleManager.get_default().get_monospace_font_name()
        tooltip.set_markup(`<span font="${font} "alpha="60%">U+${formatHex(code)}</span>\n${esc(name)}`)
        return true
    }
})

const CharsFlowBox = GObject.registerClass({
    GTypeName: 'RunemasterCharsFlowBox',
}, class extends Adw.Bin {
    #flowBox = new Gtk.FlowBox({
        selectionMode: Gtk.SelectionMode.NONE,
    })
    #model = new Gio.ListStore()
    #connection
    label
    constructor(params) {
        super(params)
        this.child = this.#flowBox
        this.#flowBox.bind_model(this.#model, item => {
            const [, cat] = getNameAndCategory(item.code)
            return new Adw.Bin({
                heightRequest: 40,
                widthRequest: 40,
                child: new Char({
                    text: String.fromCodePoint(item.code),
                    fontFallback: true,
                }),
            }).$$.add_css_class('char-block', cat)
        })
        this.#connection = this.#flowBox.connect('child-activated', (_, child) => {
            const code = this.#model.get_item(child.get_index()).code
            this.root.showCodepoint(code)
        })
    }
    load(arr) {
        this.label = !!arr.length
        this.#model.splice(0, this.#model.get_n_items(), arr)
    }
    destroy() {
        this.#flowBox.disconnect(this.#connection)
    }
})

const makeHeading = label => new Gtk.Label({
    label,
    xalign: 1,
    justify: Gtk.Justification.RIGHT,
    valign: Gtk.Align.BASELINE,
}).$$.add_css_class('caption', 'dim-label')

const makeProp = (params = {}) => new Gtk.Label({
    xalign: 0,
    wrap: true,
    hexpand: true,
    selectable: true,
    valign: Gtk.Align.BASELINE,
    ...params,
})

const CharInfo = GObject.registerClass({
    GTypeName: 'RunemasterCharInfo',
    Properties: makeParams({
        'title': 'string',
    }),
}, class extends Adw.Bin {
    #char = new Char({
        drawGuidelines: true,
        minLine: true,
        fontFallback: true,
    }).$.add_css_class('char')
    #fontDesc = new Pango.FontDescription()
    #code = new Gtk.Label({
        xalign: .5,
        selectable: true,
    }).$$.add_css_class('monospace', 'dim-label')
    #name = new Gtk.Label({
        xalign: .5,
        justify: Gtk.Justification.CENTER,
        wrap: true,
        selectable: true,
    })
    #shortName = new Gtk.Label({
        xalign: .5,
        selectable: true,
        justify: Gtk.Justification.CENTER,
        ellipsize: Pango.EllipsizeMode.MIDDLE,
    })
    #block = makeProp()
    #font = makeProp()
    #category = makeProp()
    #script = makeProp()
    #alias = makeProp()
    #comment = makeProp({ useMarkup: true })
    #commentConnection
    #html = makeProp().$.add_css_class('monospace')
    #compose = makeProp({ useMarkup: true })
    #utf8 = makeProp().$.add_css_class('monospace')
    #utf16 = makeProp().$.add_css_class('monospace')
    #crossRef = new CharsFlowBox()
    #copyButton = new Gtk.Button({
        valign: Gtk.Align.CENTER,
        iconName: 'edit-copy-symbolic',
        tooltipText: 'Copy',
        actionName: 'win.copy',
        actionTarget: GLib.Variant.new_string(''),
    })
    #insertButton = new Gtk.Button({
        valign: Gtk.Align.CENTER,
        iconName: 'insert-text-symbolic',
        tooltipText: 'Insert',
        actionName: 'win.scratchpad-insert',
        actionTarget: GLib.Variant.new_string(''),
    })
    #infoButton = new Gtk.Button({
        valign: Gtk.Align.CENTER,
        iconName: 'help-about-symbolic',
        tooltipText: 'Info',
        actionName: 'win.show-char-info',
        actionTarget: GLib.Variant.new_uint32(0),
    })
    #gridItems = [
        [makeHeading('Font'), this.#font],
        [makeHeading('Block'), this.#block],
        [makeHeading('Category'), this.#category],
        [makeHeading('Script'), this.#script],
        [makeHeading('Alias'), this.#alias],
        [makeHeading('Comment'), this.#comment],
        [makeHeading('See Also').$.set_valign(Gtk.Align.START).$.set_margin_top(3),
            this.#crossRef],
        new Gtk.Separator({ marginTop: 9 }).$.add_css_class('spacer'),
        [makeHeading('HTML'), this.#html],
        [makeHeading('UTF-8'), this.#utf8],
        [makeHeading('UTF-16'), this.#utf16],
        [makeHeading('Compose'), this.#compose],
    ]
    #grid = new Gtk.Grid({
        columnSpacing: 12,
        rowSpacing: 6,
    })
    constructor(params) {
        super(params)
        this.child = new Adw.MultiLayoutView()
            .$.add_layout(new Adw.Layout({
                name: 'tall',
                content: new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL,
                    spacing: 6,
                    marginStart: 18,
                    marginEnd: 18,
                    marginTop: 12,
                    marginBottom: 18,
                }).$$.append(
                    this.#char,
                    new Adw.LayoutSlot({ id: 'code' }),
                    this.#name,
                    new Gtk.Box({
                        halign: Gtk.Align.CENTER,
                        spacing: 6,
                        marginTop: 6,
                        marginBottom: 12,
                    })
                        .$.append(new Adw.LayoutSlot({ id: 'copy-button' }))
                        .$.append(this.#insertButton),
                    this.#grid),
            }))
            .$.add_layout(new Adw.Layout({
                name: 'short',
                content: new Gtk.ActionBar()
                    .$.set_center_widget(new Gtk.Box({
                        orientation: Gtk.Orientation.VERTICAL,
                    }).$$.append(
                        new Adw.LayoutSlot({ id: 'code' }),
                        this.#shortName))
                    .$.pack_start(this.#infoButton)
                    .$.pack_end(new Adw.LayoutSlot({ id: 'copy-button' })),
            }))
            .$$.set_child(
                ['code', this.#code],
                ['copy-button', this.#copyButton],
            )

        this.#gridItems.forEach((a, i) => Array.isArray(a)
            ? a.forEach((b, j) => this.#grid.attach(b, j, i, 1, 1))
            : this.#grid.attach(a, 0, i, 2, 1))

        this.#commentConnection = this.#comment.connect('activate-link', (_, link) => {
            this.root.showCodepoint(parseInt(link.split('#')[1], 16))
            return true
        })
    }
    setLayout(layout) {
        if (layout === 'short') this.child.set_layout_name('short')
        else {
            this.child.set_layout_name('tall')
            this.root.closeBottomSheet()
        }
    }
    setFamily(family) {
        this.#fontDesc.set_family(family)
        this.#updateFontInfo()
    }
    #updateFontInfo() {
        const char = this.#char.text
        const layout = Pango.Layout.new(this.get_pango_context())
            .$.set_font_description(this.#fontDesc)
            .$.set_text(char, -1)
        this.#font.label = layout.get_unknown_glyphs_count() > 0 ? '' : layout
            .get_line(0)?.runs[0]?.item?.analysis?.font.describe()?.get_family() ?? ''
    }
    showCodepoint(code) {
        const obj = getCode(code)
        const char = String.fromCodePoint(code)
        this.#char.text = char
        this.#updateFontInfo()

        const charVar = GLib.Variant.new_string(char)
        this.#copyButton.set_action_target_value(charVar)
        this.#insertButton.set_action_target_value(charVar)
        this.#infoButton.set_action_target_value(GLib.Variant.new_uint32(code))

        this.#code.label = `U+${formatHex(code)}`
        this.#name.label = obj.originalName !== obj.name
            ? `${obj.originalName}\n${obj.originalName === '<control>' ? '' : '※'}${obj.name}`
            : obj.name
        this.#shortName.label = obj.name
        this.#block.label = obj.block
        this.#category.label = GC.get(obj.category)
        this.#script.label = obj.script.join(', ') || 'Unknown'

        const font = Adw.StyleManager.get_default().get_monospace_font_name()
        const comment = namesList.get(code)?.['*']
            ?.map(x => esc(x).replaceAll(
                /(?<!ISO |IEC |DIN |\.)\b([0-9A-F]{4,6})/g,
                `<a href="#$1"><span font="${font}">$1</span></a>`))
            ?.map((x, _, a) => a.length > 1 ? `• ${x}` : x)
            ?.join('\n') ?? ''
        this.#comment.label = comment

        const alias = (namesList.get(code)?.['='] ?? [])
            .filter(x => x !== obj.name)
            .map(esc)
            .map((x, _, a) => a.length > 1 ? `• ${x}` : x)
            .join('\n') || ''
        this.#alias.label = alias

        this.#compose.label = compose.get(char)
            ?.map(line => Array.from(line.matchAll(/<(.+?)>/g), ([, name]) => {
                if (name === 'Multi_key') return 'Compose'
                const code = Gdk.keyval_to_unicode(Gdk.keyval_from_name(name))
                return code ? esc(String.fromCodePoint(code)) : ''
            }))
            ?.filter(arr => arr.every(x => x))
            ?.map(arr => arr.join('<span alpha="50%" size="smaller"> + </span>'))
            ?.join('\n') ?? ''

        this.#html.label = [...entities].filter(x => x[1] === code)
            .map(x => x[0]).concat(`&#${code};`).join(', ')
        this.#utf8.label = Array.from(
            new TextEncoder().encode(char), x => `0x${formatHex(x, 2)}`).join(' ')
        this.#utf16.label = char.split('')
            .map(x => `0x${formatHex(x.charCodeAt(0))}`).join(' ')

        this.#crossRef.load(namesList.get(code)?.['x']
            ?.map(code => makeGObject({ code })) ?? [])

        for (const row of this.#gridItems) {
            if (!Array.isArray(row)) continue
            row[0].visible = row[1].visible = !!row[1].label
        }
    }
    destroy() {
        this.#comment.disconnect(this.#commentConnection)
        this.#crossRef.destroy()
    }
})

const CharsView = GObject.registerClass({
    GTypeName: 'RunemasterCharsView',
    Properties: makeParams({
        'type': 'string',
        'name': 'string',
        'data': 'object',
        'font-fallback': 'boolean',
    }),
}, class extends Adw.Bin {
    #connections = new WeakMap()
    #list = new Gio.ListStore()
    #factory = new Gtk.SignalListItemFactory()
    #factoryBindings = new WeakMap()
    #selection = new Gtk.SingleSelection({ model: this.#list })
    #breakpoint = new Adw.Breakpoint({
        condition: Adw.BreakpointCondition.parse('max-width: 500px'),
    })
    #gridView = new Gtk.GridView({
        tabBehavior: Gtk.ListTabBehavior.ITEM,
        maxColumns: 16,
        model: this.#selection,
        factory: this.#factory,
    })
    #charInfo = new CharInfo()
    #copyShortcut = new Gtk.Shortcut({
        action: Gtk.NamedAction.new('win.copy'),
        trigger: Gtk.ShortcutTrigger.parse_string('<ctrl>c'),
    })
    constructor(params) {
        super(params)
        this.child = new Adw.BreakpointBin({
            heightRequest: 150,
            widthRequest: 360,
        })
            .$.add_breakpoint(this.#breakpoint)
            .$.set_child(new Adw.MultiLayoutView()
                .$.add_layout(new Adw.Layout({
                    name: 'wide',
                    content: new Adw.OverlaySplitView({
                        sidebarWidthFraction: .5,
                        sidebarPosition: Gtk.PackType.END,
                        maxSidebarWidth: 300,
                        content: new Adw.LayoutSlot({ id: 'grid' }),
                        sidebar: new Gtk.ScrolledWindow({
                            child: new Adw.LayoutSlot({ id: 'info' }),
                        }),
                    }),
                }))
                .$.add_layout(new Adw.Layout({
                    name: 'narrow',
                    content: new Gtk.Box({
                        orientation: Gtk.Orientation.VERTICAL,
                    }).$$.append(
                        new Adw.LayoutSlot({ id: 'grid' }),
                        new Adw.LayoutSlot({ id: 'info' })),
                }))
                .$.set_child('grid', new Gtk.ScrolledWindow({
                    child: this.#gridView,
                    hexpand: true,
                    vexpand: true,
                }))
                .$.set_child('info', this.#charInfo))

        this.add_controller(new Gtk.ShortcutController()
            .$.add_shortcut(this.#copyShortcut))

        this.#connections.set(this.#breakpoint, [
            this.#breakpoint.connect('apply', () => {
                this.#charInfo.setLayout('short')
                this.child.child.set_layout_name('narrow')
            }),
            this.#breakpoint.connect('unapply', () => {
                this.#charInfo.setLayout('tall')
                this.child.child.set_layout_name('wide')
            }),
        ])
        this.#connections.set(this.#gridView, [
            this.#gridView.connect('activate', (view, i) => {
                const code = view.model.get_item(i).code
                this.root.lookup_action('scratchpad-insert')
                    .activate(GLib.Variant.new_string(String.fromCodePoint(code)))
            }),
        ])
        this.#connections.set(this.#selection, [
            this.#selection.connect('selection-changed', model => {
                const code = model.selected_item.code
                this.#copyShortcut.arguments = GLib.Variant.new_string(
                    String.fromCodePoint(code))
                this.showCodeInfo(code)
            }),
        ])
        this.#connections.set(this.#factory, [
            this.#factory.connect('setup', (_, listItem) => {
                const char = new Char()
                listItem.child = new Adw.Bin({
                    heightRequest: 50,
                    widthRequest: 50,
                    child: char,
                }).$.add_css_class('char-block')
                const binding = this.bind_property(
                    'font-fallback', char, 'font-fallback',
                    GObject.BindingFlags.SYNC_CREATE)
                this.#factoryBindings.set(listItem, binding)
            }),
            this.#factory.connect('bind', (_, listItem) => {
                const child = listItem.child
                const code = listItem.item.code
                child.child.text = String.fromCodePoint(code)
                const [, cat] = getNameAndCategory(code)
                setCharCategory(child, cat)
            }),
            this.#factory.connect('teardown', (_, listItem) => {
                this.#factoryBindings.get(listItem)?.unbind()
            }),
        ])

        if (this.type === 'block') {
            const [[a, b]] = data.blocks.find(([, block]) => block === this.name)
            const arr = []
            for (let i = a; i <= b; i++) arr.push(makeGObject({ code: i }))
            this.#list.splice(0, 0, arr)
        }
        else if (this.type === 'script') {
            const arr = []
            for (const [a, b = a] of scripts.get(this.name))
                for (let i = a; i <= b; i++) arr.push(makeGObject({ code: i }))
            this.#list.splice(0, 0, arr)
        }
        else if (this.type === 'search') {
            this.#list.splice(0, 0, this.data.codes
                .map(i => makeGObject({ code: i })))
        }
        this.showCodeInfo()
    }
    destroy() {
        for (const obj of [this.#gridView, this.#selection, this.#factory])
            for (const connection of this.#connections.get(obj))
                obj.disconnect(connection)
        this.#selection.model = null
        this.#list = null
        this.#charInfo.destroy()
    }
    get selectedCode() {
        return this.#gridView.model.selected_item?.code
    }
    showCodepoint(code) {
        for (const [i, item] of gliter(this.#gridView.model))
            if (item.code === code) {
                this.#gridView.scroll_to(i, Gtk.ListScrollFlags.SELECT, null)
                return
            }
    }
    showCodeInfo() {
        this.#charInfo.showCodepoint(this.selectedCode)
    }
    setFamily(family) {
        this.#charInfo.setFamily(family)
    }
})

const SidebarView = GObject.registerClass({
    GTypeName: 'RunemasterSidebarView',
}, class extends Gtk.ListView {
    #list = new Gio.ListStore()
    constructor(params) {
        super(params)
        this.singleClickActivate = true
        this.tabBehavior = Gtk.ListTabBehavior.ITEM,
        this.model = new Gtk.NoSelection({
            model: new Gtk.FilterListModel({
                model: this.#list,
                filter: new Gtk.CustomFilter(),
            }),
        })
        this.factory = new Gtk.SignalListItemFactory()
            .$.connect('setup', (_, listItem) => {
                listItem.child = new Gtk.Label({
                    xalign: 0,
                    ellipsize: Pango.EllipsizeMode.MIDDLE,
                })
            })
            .$.connect('bind', (_, listItem) => {
                listItem.child.label = listItem.item.name
            })
    }
    load(arr) {
        this.#list.splice(0, this.#list.get_n_items(), arr)
    }
    filter(q) {
        q = q.toLowerCase()
        this.model.model.filter.set_filter_func(q ? item =>
            item.name.toLowerCase()?.includes(q) : null)
    }
})

const FontDialog = GObject.registerClass({
    GTypeName: 'RunemasterFontDialog',
    Signals: {
        'family-changed': { param_types: [GObject.TYPE_STRING] },
    },
}, class extends Adw.Dialog {
    #list = new Gtk.StringList()
    #filter = new Gtk.CustomFilter()
    constructor(params) {
        super(params)
        this.title = 'Choose Font'
        this.contentWidth = 360
        this.contentHeight = 720
        this.child = new Adw.ToolbarView({
            content: new Gtk.ScrolledWindow({
                child: new Gtk.ListView({
                    tabBehavior: Gtk.ListTabBehavior.ITEM,
                    model: new Gtk.SingleSelection({
                        autoselect: false,
                        canUnselect: true,
                        model: new Gtk.FilterListModel({
                            model: this.#list,
                            filter: this.#filter,
                        }),
                    }).$.connect('selection-changed', model =>
                        this.emit('family-changed', model.selected_item.string)),
                    factory: new Gtk.SignalListItemFactory()
                        .$.connect('setup', (_, listItem) => {
                            listItem.child = new Gtk.Label({
                                xalign: 0,
                                ellipsize: Pango.EllipsizeMode.MIDDLE,
                            })
                        })
                        .$.connect('bind', (_, listItem) => {
                            listItem.child.label = listItem.item.string
                        }),
                }).$.add_css_class('navigation-sidebar'),
            }),
        })
            .$.add_top_bar(new Adw.HeaderBar())
            .$.add_top_bar(new Gtk.ActionBar()
                .$.set_center_widget(new Gtk.SearchEntry({ placeholderText: 'Filter…' })
                    .$.connect('search-changed', entry => {
                        const q = entry.text.toLowerCase()
                        this.#filter.set_filter_func(q ? item =>
                            item.string.toLowerCase()?.includes(q) : null)
                    })))
    }
    present(...args) {
        if (!this.#list.get_n_items()) this.#list.splice(0, 0,
            this.get_pango_context().list_families().map(x => x.get_name()))
        super.present(...args)
    }
})

const FontButton = GObject.registerClass({
    GTypeName: 'RunemasterFontButton',
    Signals: {
        'family-changed': { param_types: [GObject.TYPE_STRING] },
    },
}, class extends Gtk.Button {
    #fontDialog = new FontDialog()
        .$.connect('family-changed', (_, family) => this.setFamily(family))
    #cssProvider = new Gtk.CssProvider()
    family = Pango.FontDescription.from_string(
        Adw.StyleManager.get_default().get_document_font_name()).get_family()
    constructor(params) {
        super(params)
        this.add_css_class('raised')
        this.child = new Adw.ButtonContent({
            iconName: 'font-select',
            canShrink: true,
        })
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
            this.#cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        this.setFamily(this.family)
    }
    setFamily(family) {
        this.family = family
        this.child.label = family
        this.#cssProvider.load_from_string(`
            textview, .char, .char-block {
                font-family: "${family}";
            }
        `)
        this.emit('family-changed', family)
    }
    vfunc_clicked() {
        this.#fontDialog.present(this.root)
    }
})

const AppWindow = GObject.registerClass({
    GTypeName: 'RunemasterAppWindow',
    Properties: makeParams({
        'font-fallback': 'boolean',
    }),
}, class extends Adw.ApplicationWindow {
    #bottomSheetCharInfo = new CharInfo()
    #bottomSheet = new Adw.BottomSheet({
        sheet: new Adw.ToolbarView({
            content: new Gtk.ScrolledWindow({
                propagateNaturalHeight: true,
                child: this.#bottomSheetCharInfo,
            }),
        }).$.add_top_bar(new Adw.HeaderBar()),
    })
    closeBottomSheet() {
        this.#bottomSheet.open = false
    }
    #charsList = new Gio.ListStore()
    #textView = new Gtk.TextView({
        wrapMode: Gtk.WrapMode.WORD,
        topMargin: 12,
        leftMargin: 12,
        rightMargin: 12,
        bottomMargin: 12,
    })
    #buffer = this.#textView.buffer.$.connect('changed', buffer => {
        this.#charsList.splice(0, this.#charsList.get_n_items(), getChars(buffer.text)
            .map(obj => makeGObject(obj)))
    })
    transformBufferText(f) {
        const buffer = this.#buffer
        let [selected, start, end] = buffer.get_selection_bounds()
        if (!selected) {
            start = buffer.get_start_iter()
            end = buffer.get_end_iter()
        }
        const text = buffer.get_text(start, end, true)
        buffer
            .$.begin_user_action()
            .$.delete(start, end)
            .$.insert(start, f(text), -1)
            .$.end_user_action()
        this.#textView.grab_focus()
    }
    #textToolbar = new Gtk.ActionBar()
        .$.pack_start(
            new Gtk.Button({
                iconName: 'edit-clear-symbolic',
                tooltipText: 'Clear',
                actionName: 'win.scratchpad-clear',
            }),
        )
        .$.pack_end(
            new Gtk.Button({
                iconName: 'edit-copy-symbolic',
                tooltipText: 'Copy',
                actionName: 'win.scratchpad-copy',
            }),
        )
    #columns = {
        code: new Gtk.ColumnViewColumn({
            title: 'Code',
            factory: new Gtk.SignalListItemFactory()
                .$.connect('setup', (_, listItem) => {
                    listItem.child = new Gtk.Label({ xalign: 1 })
                        .$.add_css_class('monospace')
                        .$.add_css_class('dim-label')
                })
                .$.connect('bind', (_, listItem) => {
                    const item = listItem.item
                    listItem.child.label =  formatHex(item.code)
                }),
        }),
        char: new Gtk.ColumnViewColumn({
            title: 'Char',
            factory: new Gtk.SignalListItemFactory()
                .$.connect('setup', (_, listItem) => {
                    listItem.child = new Gtk.Inscription({ xalign: .5 })
                })
                .$.connect('bind', (_, listItem) => {
                    const item = listItem.item
                    listItem.child.text = String.fromCodePoint(item.code)
                }),
        }),
        name: new Gtk.ColumnViewColumn({
            title: 'Name',
            expand: true,
            factory: new Gtk.SignalListItemFactory()
                .$.connect('setup', (_, listItem) => {
                    listItem.child = new Gtk.Label({
                        xalign: 0,
                        ellipsize: Pango.EllipsizeMode.MIDDLE,
                    })
                })
                .$.connect('bind', (_, listItem) => {
                    const item = listItem.item
                    const name = item.name
                    listItem.child.label = name
                    listItem.child.tooltipText = name
                }),
        }),
        block: new Gtk.ColumnViewColumn({
            title: 'Block',
            expand: true,
            factory: new Gtk.SignalListItemFactory()
                .$.connect('setup', (_, listItem) => {
                    listItem.child = new Gtk.Label({
                        xalign: 0,
                        ellipsize: Pango.EllipsizeMode.MIDDLE,
                    })
                })
                .$.connect('bind', (_, listItem) => {
                    const item = listItem.item
                    const name = item.block
                    listItem.child.label = name
                    listItem.child.tooltipText = name
                }),
        }),
        category: new Gtk.ColumnViewColumn({
            title: 'Cat',
            factory: new Gtk.SignalListItemFactory()
                .$.connect('setup', (_, listItem) => {
                    listItem.child = new Gtk.Label({
                        valign: Gtk.Align.CENTER,
                    }).$.add_css_class('category-label')
                })
                .$.connect('bind', (_, listItem) => {
                    const item = listItem.item
                    listItem.child.label = item.category
                    listItem.child.tooltipText = GC.get(item.category)
                    setCharCategory(listItem.child, item.category)
                }),
        }),
    }
    #columnView = new Gtk.ColumnView({
        singleClickActivate: true,
        model: new Gtk.NoSelection({
            model: this.#charsList,
        }),
    })
        .$.connect('activate', (view, i) => {
            const item = view.model.get_item(i)
            this.openChars('block', item.block, item.code)
        })
        .$$.append_column(
            this.#columns.code,
            this.#columns.char,
            this.#columns.name,
            this.#columns.block,
            this.#columns.category)
    #bindings = new WeakMap()
    #tabView = new Adw.TabView()
        .$.connect('close-page', (tabView, page) => {
            this.#bindings.get(page)?.unbind()
            page.child.destroy()
            tabView.close_page_finish(page, true)
            return true
        })
    openChars(type, name, code, data = null) {
        const tabView = this.#tabView
        for (let i = 0; i < tabView.nPages; i++) {
            const page = tabView.get_nth_page(i)
            if (page.type === type && page.title === name) {
                tabView.selected_page = page
                if (code != null) page.child.showCodepoint(code)
                return
            }
        }

        if (type === 'search' && !data) {
            const codes = searchByName(name)
            if (!codes.length) {
                this.#alert('No Results', 'No matches found')
                return
            }
            data = makeGObject({ codes })
        }

        const charsView = new CharsView({ type, name, data })
            .$.setFamily(this.#fontButton.family)
        const page = tabView.append(charsView)
        page.type = type
        page.title = name
        this.#bindings.set(page, this.bind_property(
            'font-fallback', charsView, 'font-fallback',
            GObject.BindingFlags.SYNC_CREATE))

        if (type === 'search') page.icon = Gio.ThemedIcon.new('edit-find-symbolic')
        tabView.selectedPage = page
        if (code != null) page.child.showCodepoint(code)
    }
    #alert(heading, body) {
        new Adw.AlertDialog({ heading, body })
            .$.add_response('ok', 'OK')
            .present(this)
    }
    showCodepoint(code) {
        const block = getBlock(code)
        if (block) this.openChars('block', block, code)
        else this.#alert('Not Found', 'The referenced character cannot be found')
    }
    search(q) {
        if (/^[A-Za-z]$/.test(q)) {
            this.openChars('search', q)
            return
        }
        const entity = entities.get(q)
        if (entity) {
            if (Array.isArray(entity))
                this.openChars('search', q, null, makeGObject({ codes: entity }))
            else this.showCodepoint(entity)
            return
        }
        const code = parseCode(q)
            ?? escapeSequences.get(q)
            ?? ([...q].length === 1 ? q.codePointAt(0) : null)
        if (code != null) this.showCodepoint(code)
        else this.openChars('search', q)
    }
    #searchEntry = new Gtk.SearchEntry().$.connect('activate', entry => {
        entry.root.close()
        this.search(entry.text)
    }).$.connect('stop-search', entry => entry.root.close())
    #searchDialog = new Adw.Dialog({
        contentWidth: 360,
        title: 'Find Character',
        child: new Adw.ToolbarView({
            content: new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 18,
                marginStart: 24,
                marginEnd: 24,
                marginTop: 9,
                marginBottom: 24,
            }).$$.append(
                this.#searchEntry,
                new Gtk.Button({
                    label: 'Find',
                    halign: Gtk.Align.CENTER,
                }).$$.add_css_class('pill', 'suggested-action')
                    .$.connect('clicked', button => {
                        button.root.close()
                        this.search(this.#searchEntry.text)
                    }),
            ),
        }).$.add_top_bar(new Adw.HeaderBar()),
    })
    #sidebarButton = new Gtk.ToggleButton({
        iconName: 'sidebar-show-symbolic',
        tooltipText: 'Sidebar',
    })
    #scratchpadButton = new Gtk.ToggleButton({
        iconName: 'document-edit-symbolic',
        tooltipText: 'Scratchpad',
    }).$.connect('notify::active', button =>
        button.active ? this.#textView.grab_focus() : null)
    #fontButton = new FontButton({
        tooltipText: 'Font',
    }).$.connect('family-changed', (_, family) => {
        for (let i = 0; i < this.#tabView.nPages; i++) {
            const page = this.#tabView.get_nth_page(i)
            page.child.setFamily(family)
        }
    })
    constructor(params) {
        super(params)

        this.connect('close-request', () => {
            for (let i = 0; i < this.#tabView.nPages; i++) {
                const page = this.#tabView.get_nth_page(i)
                page.child.destroy()
            }
        })

        this.#textView.extraMenu = new Gio.Menu()
            .$.append_section(null, new Gio.Menu()
                .$.append_submenu('Normalize', new Gio.Menu()
                    .$.append('NFC', 'win.scratchpad-normalize::NFC')
                    .$.append('NFD', 'win.scratchpad-normalize::NFD')
                    .$.append('NFKC', 'win.scratchpad-normalize::NFKC')
                    .$.append('NFKD', 'win.scratchpad-normalize::NFKD'))
                .$.append_submenu('Change Case', new Gio.Menu()
                    .$.append('Upper Case', 'win.scratchpad-change-case::uppercase')
                    .$.append('Lower Case', 'win.scratchpad-change-case::lowercase'))
                .$.append_submenu('Delete Category', new Gio.Menu()
                    .$.append('Mark', 'win.scratchpad-delete-category::M')
                    .$.append('Punctuation', 'win.scratchpad-delete-category::P')
                    .$.append('Other', 'win.scratchpad-delete-category::C')
                    .$.append('Separator', 'win.scratchpad-delete-category::Z')
                    .$.append('All Non-Alphabetic', 'win.scratchpad-delete-category::not-alpha')))

        const blockListView = new SidebarView()
            .$.add_css_class('navigation-sidebar')
            .$.connect('activate', (view, i) => {
                const { name } = view.model.get_item(i)
                this.openChars('block', name)
            })
            .$.load(data.blocks.map(x => makeGObject({ name: x[1] })))

        const scriptListView = new SidebarView()
            .$.add_css_class('navigation-sidebar')
            .$.connect('activate', (view, i) => {
                const { name } = view.model.get_item(i)
                this.openChars('script', name)
            })
            .$.load(Array.from(scripts.keys(), name =>
                makeGObject({ name })))

        const stack = new Adw.ViewStack()
            .$.add_titled_with_icon(new Gtk.ScrolledWindow({
                child: scriptListView,
            }), 'script', 'Scripts', 'font-x-generic-symbolic')
            .$.add_titled_with_icon(new Gtk.ScrolledWindow({
                child: blockListView,
            }), 'block', 'Blocks', 'application-x-addon-symbolic')

        const listPane = new Adw.ToolbarView({
            content: stack,
        })
            .$.add_top_bar(new Adw.HeaderBar()
                .$.set_title_widget(new Adw.InlineViewSwitcher({ stack })))
            .$.add_top_bar(new Gtk.ActionBar()
                .$.set_center_widget(new Gtk.SearchEntry({
                    placeholderText: 'Filter…',
                }).$.connect('search-changed', entry => {
                    scriptListView.filter(entry.text)
                    blockListView.filter(entry.text)
                })))

        const charsPane = new Adw.ToolbarView({
            content: this.#tabView,
            topBarStyle: Adw.ToolbarStyle.RAISED,
        }).$.add_top_bar(new Adw.HeaderBar()
            .$.set_title_widget(this.#fontButton)
            .$$.pack_start(this.#sidebarButton, this.#scratchpadButton)
            .$.pack_end(new Gtk.MenuButton({
                iconName: 'open-menu-symbolic',
                tooltipText: 'Menu',
                menuModel: new Gio.Menu()
                    .$.append('Use Fallback Fonts', 'win.font-fallback')
                    .$.append('Show Category Colors', 'win.show-category-colors')
                    .$.append_section(null, new Gio.Menu()
                        .$.append('About Runemaster', 'app.about')),
            }))
            .$.pack_end(new Gtk.Button({
                iconName: 'edit-find-symbolic',
                tooltipText: 'Find Character',
                actionName: 'win.search',
            })))
            .$.add_top_bar(new Adw.TabBar({ autohide: false, view: this.#tabView }))

        const scratchpad = new Adw.OverlaySplitView({
            sidebarWidthFraction: .6,
            maxSidebarWidth: 1000,
            sidebarPosition: Gtk.PackType.END,
            content: new Adw.ToolbarView({
                content: new Gtk.ScrolledWindow({ child: this.#textView, vexpand: true }),
            }).$.add_bottom_bar(this.#textToolbar)
                .$.add_top_bar(new Gtk.ActionBar()
                    .$.set_center_widget(new Gtk.Label({
                        label: 'Scratchpad',
                        ellipsize: Pango.EllipsizeMode.END,
                        marginTop: 2,
                        marginBottom: 2,
                    })).$$.add_css_class('dim-label', 'caption-heading')),
            sidebar: new Adw.ToolbarView({
                content: new Gtk.ScrolledWindow({ child: this.#columnView }),
            }),
        }).$.add_css_class('scratchpad')
            .$.add_controller(new Gtk.ShortcutController()
                .$.add_shortcut(new Gtk.Shortcut({
                    action: Gtk.NamedAction.new('win.scratchpad-clear'),
                    trigger: Gtk.ShortcutTrigger.parse_string('<ctrl>u'),
                })))

        const scratchPadBin = new Adw.BreakpointBin({
            child: scratchpad,
            heightRequest: 250,
            widthRequest: 360,
        }).$.add_breakpoint(new Adw.Breakpoint({
            condition: Adw.BreakpointCondition.parse('max-width: 700px'),
        }).$.connect('apply', () => {
            scratchpad.add_css_class('narrow')
            this.#columnView.$$.remove_column(
                this.#columns.code, this.#columns.block)
        }).$.connect('unapply', () => {
            scratchpad.remove_css_class('narrow')
            this.#columnView.$$.insert_column(
                [0, this.#columns.code],
                [1, this.#columns.char],
                [2, this.#columns.name],
                [3, this.#columns.block],
                [4, this.#columns.category])
        }))

        const charsSplitView = new Adw.OverlaySplitView({
            sidebarWidthFraction: .2,
            sidebar: listPane,
            content: charsPane,
            vexpand: true,
        })
            .$.bind_property('show-sidebar', this.#sidebarButton, 'active',
                GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE)

        this.content = new Adw.ToastOverlay({
            child: this.#bottomSheet.$.set_content(new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
            }).$.append(new Adw.BreakpointBin({
                child: charsSplitView,
                heightRequest: 300,
                widthRequest: 360,
            }).$.add_breakpoint(new Adw.Breakpoint({
                condition: Adw.BreakpointCondition.parse('max-width: 800px'),
            }).$.connect('apply', () => {
                charsSplitView.collapsed = true
            }).$.connect('unapply', () => {
                charsSplitView.collapsed = false
            })))
                .$.append(new Gtk.Revealer({
                    child: new Gtk.Box({
                        orientation: Gtk.Orientation.VERTICAL,
                    }).$$.append(new Gtk.Separator(), scratchPadBin),
                    vexpand: false,
                    transitionType: Gtk.RevealerTransitionType.SLIDE_UP,
                }).$.bind_property('reveal-child', this.#scratchpadButton, 'active',
                    GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE))),
        })

        const styleManager = Adw.StyleManager.get_default()
        if (styleManager.dark) this.add_css_class('dark')
        const handler = styleManager.connect('notify::dark', ({ dark }) => {
            if (dark) this.add_css_class('dark')
            else this.remove_css_class('dark')
        })
        this.connect('destroy', () => styleManager.disconnect(handler))

        this.$$.add_action(
            Gio.PropertyAction.new('font-fallback', this, 'font-fallback'),
            new Gio.SimpleAction({ name: 'close-tab' }).$.connect('activate', () => {
                if (this.#tabView.selectedPage)
                    this.#tabView.close_page(this.#tabView.selectedPage)
                else this.close()
            }),
            new Gio.SimpleAction({
                name: 'show-category-colors',
                state: GLib.Variant.new_boolean(true),
            }).$.connect('activate', action => {
                const state = action.state.unpack()
                action.state = GLib.Variant.new_boolean(!state)
                if (!state) this.remove_css_class('no-char-block-color')
                else this.add_css_class('no-char-block-color')
            }),
            new Gio.SimpleAction({ name: 'sidebar' }).$.connect('activate', () =>
                this.#sidebarButton.active = !this.#sidebarButton.active),
            new Gio.SimpleAction({ name: 'scratchpad' }).$.connect('activate', () =>
                this.#scratchpadButton.active = !this.#scratchpadButton.active),
            new Gio.SimpleAction({ name: 'search' }).$.connect('activate', () => {
                this.#searchDialog.present(this)
                this.#searchEntry.select_region(0, -1)
                this.#searchEntry.grab_focus()
            }),
            new Gio.SimpleAction({
                name: 'show-char-info',
                parameterType: new GLib.VariantType('u'),
            }).$.connect('activate', (_, param) => {
                this.#bottomSheetCharInfo.showCodepoint(param.unpack())
                this.#bottomSheet.open = true
            }),
            new Gio.SimpleAction({
                name: 'scratchpad-insert',
                parameterType: new GLib.VariantType('s'),
            }).$.connect('activate', (_, param) => {
                const [, start, end] = this.#buffer.get_selection_bounds()
                this.#buffer
                    .$.begin_user_action()
                    .$.delete(start, end)
                    .$.insert(start, param.unpack(), -1)
                    .$.end_user_action()
                this.#bottomSheet.open = false
                this.#scratchpadButton.active = true
            }),
            new Gio.SimpleAction({ name: 'scratchpad-copy' }).$.connect('activate', () => {
                this.copyText(this.#buffer.text)
                this.#buffer.select_range(this.#buffer.get_start_iter(), this.#buffer.get_end_iter())
                this.#textView.grab_focus()
            }),
            new Gio.SimpleAction({ name: 'scratchpad-clear' }).$.connect('activate', () => {
                this.#buffer
                    .$.begin_user_action()
                    .$.delete(this.#buffer.get_start_iter(), this.#buffer.get_end_iter())
                    .$.end_user_action()
                this.#textView.grab_focus()
            }),
            new Gio.SimpleAction({
                name: 'scratchpad-normalize',
                parameterType: new GLib.VariantType('s'),
            }).$.connect('activate', (_, param) =>
                this.transformBufferText(text => text.normalize(param.unpack()))),
            new Gio.SimpleAction({
                name: 'scratchpad-change-case',
                parameterType: new GLib.VariantType('s'),
            }).$.connect('activate', (_, param) => {
                this.transformBufferText(text => {
                    switch (param.unpack()) {
                        case 'uppercase': return text.toLocaleUpperCase()
                        case 'lowercase': return text.toLocaleLowerCase()
                    }
                })
            }),
            new Gio.SimpleAction({
                name: 'scratchpad-delete-category',
                parameterType: new GLib.VariantType('s'),
            }).$.connect('activate', (_, param) => {
                this.transformBufferText(text => {
                    switch (param.unpack()) {
                        case 'C': return text.replaceAll(/\p{C}/gu, '')
                        case 'M': return text.replaceAll(/\p{M}/gu, '')
                        case 'P': return text.replaceAll(/\p{P}/gu, '')
                        case 'Z': return text.replaceAll(/\p{Z}/gu, '')
                        case 'not-alpha': return text.replaceAll(/[^\p{Alphabetic}]/gu, '')
                    }
                })
            }),
            new Gio.SimpleAction({
                name: 'copy',
                parameterType: new GLib.VariantType('s'),
            }).$.connect('activate', (_, param) => {
                this.copyText(param.unpack())
            }),
        )

        this.openChars('script', 'Latin')
    }
    copyText(text) {
        Gdk.Display.get_default().get_clipboard()
            .set_content(Gdk.ContentProvider.new_for_value(text))
        this.content.add_toast(
            new Adw.Toast({ title: 'Copied to clipboard' }))
    }
})

const app = new Adw.Application({
    applicationId: pkg.id,
    flags: Gio.ApplicationFlags.FLAGS_NONE,
})
app
    .$.add_action(new Gio.SimpleAction({ name: 'about' }).$.connect('activate', () => {
        new Adw.AboutDialog({
            applicationName: 'Runemaster',
            applicationIcon: pkg.id,
            version: '1.0.0',
            developerName: 'John Factotum',
            licenseType: Gtk.License.GPL_3_0,
        })
            .$.add_legal_section('Unicode Data Files',
                'Copyright © 1991-2025 Unicode, Inc.',
                Gtk.License.CUSTOM, 'Unicode and the Unicode Logo are registered trademarks of Unicode, Inc. in the U.S. and other countries. See <a href="https://www.unicode.org/copyright.html">Terms of Use</a>.')
            .present(app.activeWindow)
    }))
    .$.add_action(new Gio.SimpleAction({ name: 'quit' }).$.connect('activate', () =>
        app.quit()))
    .$$.set_accels_for_action(
        ['win.close-tab', ['<ctrl>w']],
        ['win.search', ['<ctrl>f']],
        ['win.scratchpad', ['<ctrl>F9']],
        ['win.sidebar', ['F9']],
        ['app.quit', ['<ctrl>q']],
        ['app.about', ['F1']],
    )
    .$.connect('activate', app => (app.activeWindow || new AppWindow({
        application: app,
        defaultWidth: 960,
        defaultHeight: 640,
        fontFallback: true,
        title: pkg.name,
    })).present())
    .$.connect('startup', () => {
        const provider = new Gtk.CssProvider().$.load_from_string(`
.scratchpad columnview {
    background: none;
}
.scratchpad {
    background: var(--view-bg-color);
}
.scratchpad .sidebar-pane {
    background: var(--window-bg-color);
}
.scratchpad.narrow {
    font-size: smaller;
}
.scratchpad.narrow textview {
    font-size: 15pt;
}

gridview {
    padding: 6px;
}
gridview child {
    background: none;
}
gridview child:selected {
    outline: 0;
}
gridview child:selected .char-block {
    outline: 2px solid color-mix(in srgb, var(--view-fg-color) var(--dim-opacity), transparent);
}
gridview child:focus .char-block {
    outline-color: var(--accent-bg-color);
}
textview {
    font-size: 20pt;
}
.char {
    font-size: 64pt;
}
.char-block {
    font-size: 20pt;
    border-radius: 4px;
}

.category-label {
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px var(--border-color);
    padding: 1px 6px;
}

.Lu { background: hsl(0, 0%, 93%); color: #000; }
.Lt { background: hsl(0, 0%, 95%); color: #000; }
.Lm { background: hsl(0, 0%, 97%); color: #000; }
.Ll, .Lo { background: var(--view-bg-color); color: #000; }

.Me { background: hsl(0, 35%, 85%); color: #000; }
.Mc { background: hsl(0, 35%, 90%); color: #000; }
.Mn { background: hsl(0, 35%, 95%); color: #000; }

.Sk { background: hsl(220, 50%, 85%); color: #000; }
.Sm, .Sc { background: hsl(220, 50%, 90%); color: #000; }
.So { background: hsl(220, 50%, 95%); color: #000; }

.Nl { background: hsl(100, 35%, 80%); color: #000; }
.No { background: hsl(100, 35%, 85%); color: #000; }
.Nd { background: hsl(100, 35%, 90%); color: #000; }

.Pc, .Pd, .Ps, .Pe, .Pi, .Pf, .Po { background: hsl(260, 80%, 95%); color: #000; }
.Zs, .Zl, .Zp { background: hsl(50, 80%, 90%); color: #000; }
.Cc, .Cf, .Cs, .Co { background: hsl(30, 80%, 90%); color: #000; }
.Cn { background: hsl(0, 0%, 65%); color: #fff; }

.dark .Lu { background: hsl(0, 0%, 22%); color: #fff; }
.dark .Lt { background: hsl(0, 0%, 19%); color: #fff; }
.dark .Lm { background: hsl(0, 0%, 16%); color: #fff; }
.dark .Ll, .dark .Lo { background: var(--view-bg-color); color: #fff; }

.dark .Me { background: hsl(0, 35%, 30%); color: #fff; }
.dark .Mc { background: hsl(0, 35%, 25%); color: #fff; }
.dark .Mn { background: hsl(0, 35%, 20%); color: #fff; }

.dark .Sk { background: hsl(220, 35%, 30%); color: #fff; }
.dark .Sm, .dark .Sc { background: hsl(220, 35%, 25%); color: #fff; }
.dark .So { background: hsl(220, 35%, 20%); color: #fff; }

.dark .Nl { background: hsl(100, 35%, 30%); color: #fff; }
.dark .No { background: hsl(100, 35%, 25%); color: #fff; }
.dark .Nd { background: hsl(100, 35%, 20%); color: #fff; }

.dark .Pc, .dark .Pd, .dark .Ps, .dark .Pe, .dark .Pi, .dark .Pf, .dark .Po { background: hsl(250, 35%, 35%); color: #fff; }
.dark .Zs, .dark .Zl, .dark .Zp { background: hsl(50, 70%, 20%); color: #fff; }
.dark .Cc, .dark .Cf, .dark .Cs, .dark .Co { background: hsl(30, 70%, 20%); color: #fff; }
.dark .Cn { background: hsl(0, 0%, 50%); color: #000; }

.char-block.Ll, .char-block.Lo,
.dark .char-block.Ll, .dark .char-block.Lo,
.no-char-block-color .char-block {
    background: inherit;
    color: inherit;
}

.no-char-block-color .char-block.Cn { color: transparent; }
.no-char-block-color .dark .char-block.Cn { color: transparent; }
    `)
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
            provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    })
    .run([programInvocationName, ...programArgs])
