export function getCoverScale(imageWidth, imageHeight, viewportWidth, viewportHeight) {
  if (![imageWidth, imageHeight, viewportWidth, viewportHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError('Bilde- og visningsmål må være positive tall.');
  }
  return Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
}

export function clampCropOffset({ imageWidth, imageHeight, viewportWidth, viewportHeight, zoom = 1, offsetX = 0, offsetY = 0 }) {
  const safeZoom = Math.max(1, Number(zoom) || 1);
  const scale = getCoverScale(imageWidth, imageHeight, viewportWidth, viewportHeight) * safeZoom;
  const maxX = Math.max(0, (imageWidth * scale - viewportWidth) / 2);
  const maxY = Math.max(0, (imageHeight * scale - viewportHeight) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, Number(offsetX) || 0)),
    y: Math.min(maxY, Math.max(-maxY, Number(offsetY) || 0)),
  };
}

export function getCropDrawRect(options) {
  const {
    imageWidth, imageHeight, viewportWidth, viewportHeight, zoom = 1,
  } = options;
  const safeZoom = Math.max(1, Number(zoom) || 1);
  const scale = getCoverScale(imageWidth, imageHeight, viewportWidth, viewportHeight) * safeZoom;
  const offset = clampCropOffset(options);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (viewportWidth - width) / 2 + offset.x,
    y: (viewportHeight - height) / 2 + offset.y,
    width,
    height,
    offsetX: offset.x,
    offsetY: offset.y,
  };
}
