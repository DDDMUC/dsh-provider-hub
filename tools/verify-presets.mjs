// dsh-provider-hub - validate every preset against the REAL pi-ai schema.
//
//   node tools/verify-presets.mjs [path-to-dsh-llm-pi-ai]
//
// `test/catalog.test.js` checks the invariants this plugin knows about. This
// tool checks the thing that actually decides whether a save is accepted: the
// installed `@deepseek-ai/dsh-llm-pi-ai` Config, parsed exactly the way the
// settings service parses a write. Run it after a catalog sync; it needs a DSH
// installation, so it is a tool rather than a test.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PRESETS } from '../core/providers.js'
import { curatedProfile } from '../core/directory.js'

/** Where a DSH checkout keeps the adapter, in the order worth trying. */
function candidates() {
  const explicit = process.argv[2] ?? process.env.DSH_PI_AI_PATH
  const list = []
  if (explicit) list.push(explicit)
  list.push(join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai'))
  list.push(join(homedir(), '.npm', '_npx', process.env.DSH_NPX_HASH ?? '', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai'))
  return list.filter((entry) => entry && existsSync(entry))
}

const found = candidates()[0]
if (!found) {
  console.error('no @deepseek-ai/dsh-llm-pi-ai found; pass its path as the first argument')
  process.exit(2)
}

const module = await import(pathToFileURL(join(found, 'lib', 'index.js')).href)
const { Config } = module
if (typeof Config !== 'function') {
  console.error(`${found} does not export Config`)
  process.exit(2)
}

let failures = 0
let models = 0
for (const preset of PRESETS) {
  const profile = curatedProfile(preset, {})
  try {
    const parsed = new Config({ providers: { [preset.id]: profile } })
    // schemastery hands back observable refs, so the accepted value is read
    // through `.get()`; an entry the schema silently dropped counts as a failure.
    const dict = typeof parsed.providers?.get === 'function' ? parsed.providers.get() : parsed.providers
    const accepted = dict?.[preset.id]
    if (accepted === undefined) throw new Error('the schema dropped this profile instead of keeping it')
    const raw = accepted.models
    const list = typeof raw?.get === 'function' ? raw.get() : raw
    if (!Array.isArray(list) || list.length === 0) throw new Error('the schema kept no models for this profile')
    models += list.length
  } catch (error) {
    failures += 1
    console.error(`✗ ${preset.id}: ${String((error && error.message) || error).split('\n')[0]}`)
  }
}

console.log(`${PRESETS.length - failures}/${PRESETS.length} presets accepted by the installed pi-ai schema (${models} models)`)
console.log(`schema: ${found}`)
process.exit(failures === 0 ? 0 : 1)
