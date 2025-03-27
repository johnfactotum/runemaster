#!/usr/bin/env node
import * as fs from 'node:fs/promises'
const readFile = path => fs.readFile(path, { encoding: 'utf8' })

const unihanPath = path => `./unihan/${path}`

const parseHex = x => parseInt(x, 16)

const propsToGet = [
    'kRSUnicode',
    'kDefinition',
    'kMandarin',
    'kCantonese',
    'kJapanese',
    'kHangul',
    'kZVariant',
    'kSimplifiedVariant',
    'kTraditionalVariant',
    'kSemanticVariant',
    'kSpecializedSemanticVariant',
    'kCangjie',
]

const arr = []
for (const line of (await readFile(unihanPath('Unihan_Readings.txt'))
    + await readFile(unihanPath('Unihan_IRGSources.txt'))
    + await readFile(unihanPath('Unihan_Variants.txt'))
    + await readFile(unihanPath('Unihan_DictionaryLikeData.txt'))
).split('\n')) {
    const match = line.match(/^U\+([0-9A-F]+)\s+([^\s]+)\s+(.+)$/)
    if (!match) continue
    const [, hex, prop, value] = match
    const i = propsToGet.indexOf(prop)
    if (i !== -1) arr.push({ hex, prop: i, value })
}

const map = new Map()
for (const [hex, items] of Map.groupBy(arr, x => x.hex)) {
    map.set(parseHex(hex), Object.fromEntries(items.map(x => [x.prop, x.value])))
}

await fs.writeFile('./unihan.json', JSON.stringify({
    props: propsToGet,
    map: [...map],
}))
