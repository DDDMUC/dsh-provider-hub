// dsh-provider-hub - core per-app coverage.
//
// The catalog is app-agnostic: every shell shows the same presets minus the
// ones its target application already covers natively. Nothing is deleted -
// covered presets stay in the catalog and stay reachable in the UI behind a
// reveal toggle, because a native entry can still be missing for an account
// (see StepFun's Step Plan endpoint) or carry a different offering.
//
// Coverage is matched on the preset id plus optional vendor aliases
// (`nativeIds`), so a preset built for one wire endpoint still hides behind
// the native provider that serves the same vendor (gemini -> google,
// moonshot -> moonshotai-cn).

/**
 * Partition presets against one app's native provider ids.
 * @param presets - catalog entries (`id`, optional `nativeIds` aliases).
 * @param nativeIds - provider ids the target app already offers.
 * @returns `{ visible, covered }`; covered entries carry the id that matched.
 */
export function coverageOf(presets, nativeIds) {
  const native = new Set(Array.isArray(nativeIds) ? nativeIds : [])
  const visible = []
  const covered = []
  for (const preset of presets) {
    const aliases = Array.isArray(preset.nativeIds) ? preset.nativeIds : []
    const matched = [preset.id, ...aliases].find((id) => native.has(id))
    if (matched === undefined) visible.push(preset.id)
    else covered.push({ id: preset.id, as: matched })
  }
  return { visible, covered }
}
