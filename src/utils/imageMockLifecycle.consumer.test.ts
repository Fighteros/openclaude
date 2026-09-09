import { expect, test } from 'bun:test'
import {
  formatClipboardImagePasteError,
  tryReadImageFromPath,
} from './imagePaste.js'
import {
  ImageResizeError,
  maybeResizeAndDownsampleImageBuffer,
} from './imageResizer.js'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('production image modules remain active after mock-heavy suites', async () => {
  const resized = await maybeResizeAndDownsampleImageBuffer(
    onePixelPng,
    onePixelPng.length,
    'png',
  )
  expect(resized.dimensions).toMatchObject({
    originalWidth: 1,
    originalHeight: 1,
  })

  expect(
    await tryReadImageFromPath(
      `${process.cwd()}/definitely-missing-image-mock-lifecycle.png`,
    ),
  ).toBeNull()

  const error = new ImageResizeError('canonical resize error')
  expect(formatClipboardImagePasteError(error)).toBe(error.message)
})
