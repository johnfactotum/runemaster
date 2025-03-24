#!/usr/bin/env -S deno run --allow-read --allow-write

const ucdPath = path => `./ucd/${path}`
const composePath = './Compose'

const UnicodeData = await Deno.readTextFile(ucdPath('UnicodeData.txt'))
const Blocks = await Deno.readTextFile(ucdPath('Blocks.txt'))
const Scripts = await Deno.readTextFile(ucdPath('Scripts.txt'))
const ScriptExtensions = await Deno.readTextFile(ucdPath('ScriptExtensions.txt'))
const PropertyValueAliases = await Deno.readTextFile(ucdPath('PropertyValueAliases.txt'))

const parse = str => str
    .split('\n')
    .map(l => l.split('#')[0].split(';').map(x => x.trim()))
    .filter(a => a[0])

const ucd = {
    UnicodeData: UnicodeData
        .split('\n')
        .map(l => l.split('#')[0].split(';').slice(0, 3)),
    Blocks: parse(Blocks),
    Scripts: parse(Scripts),
    ScriptExtensions: parse(ScriptExtensions),
    PropertyValueAliases: parse(PropertyValueAliases),
}

const parseHex = x => parseInt(x, 16)
const parseRange = x => x.split('..').map(parseHex)

const getAliases = key => ucd.PropertyValueAliases
    .filter(([x]) => x === key)
    .map(x => x.slice(1))
const SC = new Map(getAliases('sc'))

const ranges = []
const rangeStarts = new Map()
const map = new Map()
ucd.UnicodeData.forEach(([n, name, category], i, a) => {
    n = parseHex(n)
    if (/<.+, Last>/.test(name)) return
    if (/<.+, First>/.test(name)) {
        const last = a[i + 1]
        const end = parseHex(last[0])
        const rangeName = name.match(/<(.+), First>/)[1]
        ranges.push([n, end, rangeName, category])
        rangeStarts.set(n, [end, rangeName, category])
        return
    }
    map.set(n, [name, category])
})

const blocks = ucd.Blocks.map(([range, name]) => [parseRange(range), name])

const scripts = Array.from(Map.groupBy(ucd.Scripts
    .concat(ucd.ScriptExtensions
        .map(([range, names]) => names.split(/\s/)
            .map(name => [range, SC.get(name)])).flat())
    .map(([range, name]) => [parseRange(range), name]), x => x[1]), ([name, arr]) => {
    arr.sort((a, b) => a[0][0] - b[0][0])
    const ranges = []
    let start
    let end
    for (const [[a, b = a]] of arr) {
        if (!start) {
            start = a
            end = b
        }
        else if (a === end + 1) {
            end = b
        }
        else {
            ranges.push([start, end])
            start = a
            end = b
        }
    }
    ranges.push([start, end])
    return [name, ranges]
})


const NamesList = await Deno.readTextFile(ucdPath('NamesList.txt'))

const match = (state, map) => str => {
    for (const [regex, f] of map) {
        const match = str.match(regex)
        if (match) {
            f(state, match)
            return
        }
    }
}

const state = { map: [] }
const matchLine = match(state, [
    [/^([0-9A-F]+)/, (q, [, x]) => {
        q.obj = { '=': [], '*': [], '#': [], ':': [], '%': [], 'x': [], '~': [] }
        q.map.push([parseHex(x), q.obj])
    }],
    [/^\s+=\s+(.+)$/, (q, [, x]) => q.obj['='].push(x)],
    [/^\s+\*\s+(.+)$/, (q, [, x]) => q.obj['*'].push(x)],
    //[/^\s+#\s+(.+)$/, (q, [, x]) => q.obj['#'].push(x)], // Compatibility Decomposition
    //[/^\s+:\s+(.+)$/, (q, [, x]) => q.obj[':'].push(x)], // Decomposition
    [/^\s+%\s+(.+)$/, (q, [, x]) => q.obj['%'].push(x)],
    [/^\s+x\s+.*?([0-9A-F]{4,6})\)$/, (q, [, x]) => q.obj['x'].push(parseHex(x))],
    [/^\s+~\s+[0-9A-F]+\s+([0-9A-F]+)\s+(.+)$/, (q, [, v, x]) => q.obj['~'].push([parseHex(v), x])],
])
for (const line of NamesList.split('\n')) matchLine(line)

const namesList = state.map.map(([code, obj]) => {
    const entries = Array.from(Object.entries(obj),
        ([k, v]) => v.length ? [k, v] : null).filter(x => x)
    return entries.length ? [code, Object.fromEntries(entries)] : null
}).filter(x => x)

const compose = new Map()
for (const line of (await Deno.readTextFile(composePath)).split('\n')) {
    const l = line.split('#')[0]
    const char = l.match(/"(\S+)"/)?.[1]
    if (!char) continue
    const key = l.split(':')[0].trim()
    if (key.startsWith('<Multi_key>'))
        compose.get(char)?.push(key) ?? compose.set(char, [key])
}

const output = {
    blocks,
    scripts,
    map: Array.from(map),
    ranges,
    aliases: {
        gc: getAliases('gc'),
        sc: getAliases('sc'),
    },
    namesList,
    compose: Array.from(compose),
}

await Deno.writeTextFile('./data.json', JSON.stringify(output))

