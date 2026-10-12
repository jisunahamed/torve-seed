import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePluginInstallError } from './manager.js'

test('normalizePluginInstallError explains when npm is unavailable', () => {
  const error = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' })
  const normalized = normalizePluginInstallError('@torveai/provider-openai', error)

  assert.match(normalized.message, /npm was not found/)
  assert.match(normalized.message, /Install Node\.js 20 or newer/)
  assert.match(normalized.message, /@torve\/provider-openai/)
})

test('normalizePluginInstallError preserves other install failures', () => {
  const error = new Error('registry unavailable')
  assert.equal(normalizePluginInstallError('@torveai/provider-openai', error), error)
})
