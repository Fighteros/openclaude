import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { BetaImageBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import * as resizer from './imageResizer.js'
import { prepareImagesForAnthropicRequest, usesAnthropicImageLimits } from './requestImageValidation.js'

const originalExports = { ...resizer }
afterEach(() => {
  mock.module('./imageResizer.js', () => originalExports)
  mock.restore()
})

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  buffer.write('89504e470d0a1a0a', 'hex')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}
function image(width = 3840, height = 2160): BetaImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png(width, height).toString('base64') } }
}
function messages(count: number): BetaMessageParam[] {
  return [{ role: 'user', content: Array.from({ length: count }, () => image()) }]
}
function mockResize(implementation: typeof resizer.maybeResizeAndDownsampleImageBuffer) {
  const resize = mock(implementation)
  mock.module('./imageResizer.js', () => ({ ...originalExports, maybeResizeAndDownsampleImageBuffer: resize }))
  return resize
}

describe('final Anthropic request image limits', () => {
  test('20 compact 4K PNGs remain unchanged without processing', async () => {
    const resize = mockResize(async () => { throw new Error('unavailable') })
    const input = messages(20)
    expect(await prepareImagesForAnthropicRequest(input)).toBe(input)
    expect(resize).not.toHaveBeenCalled()
  })

  test('21 images are resized without mutating retained history', async () => {
    const resize = mockResize(async () => ({ buffer: png(1568, 882), mediaType: 'png' }))
    // JSON roundtrip models persisted/restored history: no dimensions annotations.
    const input = JSON.parse(JSON.stringify(messages(21))) as BetaMessageParam[]
    const before = JSON.stringify(input)
    const result = await prepareImagesForAnthropicRequest(input)
    expect(resize).toHaveBeenCalledTimes(21)
    expect(result[0]!.content).toHaveLength(21)
    expect(JSON.stringify(input)).toBe(before)
    expect(JSON.stringify(result)).toContain(png(1568, 882).toString('base64'))
  })

  test('counts nested tool-result images together with top-level history', async () => {
    const resize = mockResize(async () => ({ buffer: png(2000, 1125), mediaType: 'png' }))
    const input = messages(20)
    input.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'restored', content: [image()] }] })
    const result = await prepareImagesForAnthropicRequest(input)
    expect(resize).toHaveBeenCalledTimes(21)
    expect(JSON.stringify(result[1])).toContain(png(2000, 1125).toString('base64'))
  })

  test('allows 2000px edges but processes a 2001px edge', async () => {
    const resize = mockResize(async () => ({ buffer: png(2000, 2000), mediaType: 'png' }))
    const input: BetaMessageParam[] = [{ role: 'user', content: [...Array.from({ length: 20 }, () => image(2000, 2000)), image(1, 2001)] }]
    await prepareImagesForAnthropicRequest(input)
    expect(resize).toHaveBeenCalledTimes(1)
  })

  test.each(['throw', 'passthrough'] as const)('rejects %s fallback with actionable awaited error', async mode => {
    mockResize(async buffer => {
      if (mode === 'throw') throw new Error('processor unavailable')
      return { buffer, mediaType: 'png', dimensions: { displayWidth: 1568, displayHeight: 882 } }
    })
    await expect(prepareImagesForAnthropicRequest(messages(21))).rejects.toThrow('Resize the image before sending')
  })

  test.each(['firstParty', 'bedrock', 'vertex', 'foundry'])('applies to %s Anthropic transport', apiProvider => {
    expect(usesAnthropicImageLimits({ apiProvider, isFirstPartyBaseUrl: true, isGithubNativeAnthropic: false, hasProviderOverride: false })).toBe(true)
  })
  test('excludes shims, custom endpoints, and agent overrides', () => {
    const route = { apiProvider: 'openai', isFirstPartyBaseUrl: false, isGithubNativeAnthropic: false, hasProviderOverride: false }
    expect(usesAnthropicImageLimits(route)).toBe(false)
    expect(usesAnthropicImageLimits({ ...route, apiProvider: 'firstParty' })).toBe(false)
    expect(usesAnthropicImageLimits({ ...route, isGithubNativeAnthropic: true })).toBe(true)
    expect(usesAnthropicImageLimits({ ...route, isGithubNativeAnthropic: true, hasProviderOverride: true })).toBe(false)
  })
})
