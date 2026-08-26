import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCropOffset, getCoverScale, getCropDrawRect } from '../avatar-crop.js';

test('liggende bilder dekker hele det kvadratiske utsnittet', () => {
  assert.equal(getCoverScale(1200, 600, 512, 512), 512 / 600);
});

test('stående bilder dekker hele det kvadratiske utsnittet', () => {
  assert.equal(getCoverScale(600, 1200, 512, 512), 512 / 600);
});

test('bildet kan ikke dras utenfor venstre eller høyre kant', () => {
  const offset = clampCropOffset({
    imageWidth: 1200, imageHeight: 600, viewportWidth: 512, viewportHeight: 512,
    zoom: 1, offsetX: 9999, offsetY: 9999,
  });
  assert.deepEqual(offset, { x: 256, y: 0 });
});

test('zoom gir større gyldig flytteområde', () => {
  const offset = clampCropOffset({
    imageWidth: 512, imageHeight: 512, viewportWidth: 512, viewportHeight: 512,
    zoom: 2, offsetX: -300, offsetY: 300,
  });
  assert.deepEqual(offset, { x: -256, y: 256 });
});

test('tegnerektangelet sentrerer et bilde uten forskyvning', () => {
  assert.deepEqual(getCropDrawRect({
    imageWidth: 1200, imageHeight: 600, viewportWidth: 512, viewportHeight: 512,
    zoom: 1, offsetX: 0, offsetY: 0,
  }), { x: -256, y: 0, width: 1024, height: 512, offsetX: 0, offsetY: 0 });
});

test('ugyldige bildemål avvises', () => {
  assert.throws(() => getCoverScale(0, 400, 512, 512), TypeError);
});
