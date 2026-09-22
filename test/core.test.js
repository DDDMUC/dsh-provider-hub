// dsh-provider-hub - core unit tests (node:test, no deps).

import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, SUPPORTED_APIS, customEnvName, findPreset } from '../core/providers.js'
import { baseUrlError, buildProfile, effortsError, isRouteKey, routeOf } from '../core/profile.js'
import { coverageOf } from '../core/coverage.js'

test('catalog: ids and env refs are unique', () => {
  const ids = new Set()
  const envs = new Set()
  for (const preset of PRESETS) {
    assert.equal(ids.has(preset.id), false, `duplicate preset id ${preset.id}`)
    ids.add(preset.id)
    assert.equal(envs.has(preset.env), false, `duplicate env ${preset.env}`)
    envs.add(preset.env)
  }
})

test('catalog: every preset is servable', () => {
  for (const preset of PRESETS) {
    assert.equal(isRouteKey(preset.id), true, `${preset.id} is not a route key`)
    assert.equal(baseUrlError(preset.baseURL), undefined, `${preset.id} base URL: ${baseUrlError(preset.baseURL)}`)
    assert.ok(SUPPORTED_APIS.includes(preset.api), `${preset.id} api ${preset.api}`)
    assert.ok(preset.models.length > 0, `${preset.id} has no models`)
    for (const model of preset.models) {
      assert.ok(typeof model.id === 'string' && model.id.trim() !== '', `${preset.id} model id missing`)
      assert.ok(Number.isFinite(model.contextWindow) && model.contextWindow > 0, `${preset.id}/${model.id} contextWindow`)
      assert.ok(Number.isFinite(model.maxTokens) && model.maxTokens > 0, `${preset.id}/${model.id} maxTokens`)
      assert.equal(effortsError(model.reasoningEfforts), undefined, `${preset.id}/${model.id} efforts`)
    }
  }
})

test('buildProfile: preset produces the official profile shape', () => {
  const preset = findPreset('openrouter')
  const profile = buildProfile({ presetId: 'openrouter' })
  assert.equal(profile.displayName, preset.name)
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, preset.baseURL)
  assert.equal(profile.apiKeyEnv, 'OPENROUTER_API_KEY')
  assert.equal(profile.models.length, preset.models.length)
  assert.equal(profile.compat.supportsStore, false)
  assert.equal(profile.compat.maxTokensField, 'max_tokens')
  const serialized = JSON.stringify(profile)
  assert.equal(serialized.includes('undefined'), false)
})

test('buildProfile: anthropic preset carries no OpenAI compat block', () => {
  const profile = buildProfile({ presetId: 'anthropic' })
  assert.equal(profile.api, 'anthropic-messages')
  assert.equal(profile.compat, undefined)
})

test('buildProfile: custom route builds models with defaults', () => {
  const profile = buildProfile({
    route: 'my-gateway',
    baseURL: 'https://gateway.example.com/v1',
    api: 'openai-completions',
    modelIds: 'model-a, model-b\nmodel-c',
  })
  assert.equal(profile.displayName, 'my-gateway')
  assert.equal(profile.apiKeyEnv, 'MY_GATEWAY_API_KEY')
  assert.deepEqual(profile.models.map((model) => model.id), ['model-a', 'model-b', 'model-c'])
  assert.equal(profile.models[0].contextWindow, 131072)
  assert.deepEqual(profile.models[0].input, ['text'])
})

test('buildProfile: refuses drafts the adapter would refuse', () => {
  assert.throws(() => buildProfile({ presetId: 'nope' }), /未知的预设/)
  assert.throws(() => buildProfile({ route: 'Bad Route', baseURL: 'https://x.dev/v1', api: 'openai-completions', modelIds: 'a' }), /路由 ID/)
  assert.throws(() => buildProfile({ route: 'ok', baseURL: 'https://x.dev/v1?k=1', api: 'openai-completions', modelIds: 'a' }), /查询参数/)
  assert.throws(() => buildProfile({ route: 'ok', baseURL: 'https://user:pass@x.dev/v1', api: 'openai-completions', modelIds: 'a' }), /账号密码/)
  assert.throws(() => buildProfile({ route: 'ok', baseURL: 'ftp://x.dev/v1', api: 'openai-completions', modelIds: 'a' }), /http\(s\)/)
  assert.throws(() => buildProfile({ route: 'ok', baseURL: 'https://x.dev/v1', api: 'grpc', modelIds: 'a' }), /协议/)
  assert.throws(() => buildProfile({ route: 'ok', baseURL: 'https://x.dev/v1', api: 'openai-completions', modelIds: '' }), /至少填一个/)
  assert.throws(() => buildProfile({ route: 'ok', baseURL: 'https://x.dev/v1', api: 'openai-completions', modelIds: 'a, a' }), /重复/)
})

test('effortsError: mirrors the adapter acceptance rules', () => {
  assert.equal(effortsError(undefined), undefined)
  assert.equal(effortsError(false), undefined)
  assert.equal(effortsError({ low: 'low', high: 'high' }), undefined)
  assert.equal(effortsError({ off: null, high: 'high' }), undefined)
  assert.match(effortsError({ off: null }), /off 以外/)
  assert.match(effortsError({ high: '' }), /不能为空/)
  assert.match(effortsError({ high: null }), /需要发送值/)
})

test('routeOf and customEnvName normalize custom drafts', () => {
  assert.equal(routeOf({ presetId: 'zai' }), 'zai')
  assert.equal(routeOf({ route: ' my-gw ' }), 'my-gw')
  assert.throws(() => routeOf({ route: '-bad' }), /路由 ID/)
  assert.equal(customEnvName('my-gw'), 'MY_GW_API_KEY')
  assert.equal(customEnvName('a.b c'), 'A_B_C_API_KEY')
  assert.equal(customEnvName(''), 'CUSTOM_API_KEY')
})

test('coverage: hides natively covered presets, keeps aliases and foreign vendors', () => {
  const native = ['openai', 'google', 'moonshotai', 'zai', 'some-other']
  const { visible, covered } = coverageOf(PRESETS, native)
  const coveredIds = covered.map((entry) => entry.id)
  assert.ok(coveredIds.includes('openai'), 'id match hides')
  assert.ok(coveredIds.includes('gemini'), 'alias google hides gemini')
  assert.ok(!coveredIds.includes('moonshot'), 'CN moonshot alias not in list')
  const global = covered.find((entry) => entry.id === 'moonshot-global')
  assert.ok(global, 'moonshot-global hides behind its moonshotai alias')
  assert.equal(global.as, 'moonshotai')
  assert.ok(visible.includes('deepinfra'))
  assert.equal(visible.length + covered.length, PRESETS.length)
  const gemini = covered.find((entry) => entry.id === 'gemini')
  assert.equal(gemini.as, 'google')
})

test('coverage: empty native list keeps everything visible', () => {
  const { visible, covered } = coverageOf(PRESETS, [])
  assert.equal(covered.length, 0)
  assert.equal(visible.length, PRESETS.length)
})

test('coverage: StepFun Step Plan is not covered by the built-in stepfun entry', () => {
  const { visible, covered } = coverageOf(PRESETS, ['stepfun'])
  assert.ok(visible.includes('stepfun-step-plan'), 'step plan route must stay visible')
  assert.ok(visible.includes('stepfun-step-plan-global'), 'global step plan route must stay visible')
  assert.equal(covered.length, 0)
  const preset = findPreset('stepfun-step-plan')
  assert.equal(preset.baseURL, 'https://api.stepfun.com/step_plan/v1')
  assert.equal(preset.env, 'STEPFUN_API_KEY')
  const profile = buildProfile({ presetId: 'stepfun-step-plan' })
  assert.equal(profile.apiKeyEnv, 'STEPFUN_API_KEY')
  assert.ok(profile.models.some((model) => model.id === 'step-5-preview'))
})
