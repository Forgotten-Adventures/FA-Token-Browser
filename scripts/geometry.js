export function parseTokenSize(filename) {
  const name = (filename ?? '').toLowerCase();
  let gridWidth = 1,
    gridHeight = 1,
    scale = 1;

  // Reasonable limits to prevent extreme values from malformed filenames
  const MAX_GRID_SIZE = 100; // Max 100x100 grid squares
  const MAX_SCALE = 3; // Max 3x scale (Foundry hard limit)

  // Check for size indicators in order (most specific first)
  if (name.includes('gargantuan')) {
    // For Gargantuan, check for explicit size like "38x33" first
    const sizeMatch = name.match(/(\d+)x(\d+)/);
    if (sizeMatch) {
      const width = parseInt(sizeMatch[1]);
      const height = parseInt(sizeMatch[2]);
      // These numbers ARE the grid squares directly - apply safety limits
      gridWidth = Math.max(1, Math.min(MAX_GRID_SIZE, width));
      gridHeight = Math.max(1, Math.min(MAX_GRID_SIZE, height));

      // Log warning if values were clamped
      if (width > MAX_GRID_SIZE || height > MAX_GRID_SIZE) {
        console.warn(
          `fa-token-browser | Token size clamped for ${filename}: ${width}x${height} -> ${gridWidth}x${gridHeight} (max: ${MAX_GRID_SIZE})`
        );
      }
    } else {
      // Default Gargantuan is 4x4
      gridWidth = gridHeight = 4;
    }
  } else if (name.includes('huge')) {
    gridWidth = gridHeight = 3;
  } else if (name.includes('large')) {
    gridWidth = gridHeight = 2;
  } else if (name.includes('small') || name.includes('tiny')) {
    gridWidth = gridHeight = 1;
  } else {
    // Default to Medium (1x1) if no size indicator found
    gridWidth = gridHeight = 1;
  }

  // Check for scale modifier like "Scale150" or "scale150"
  const scaleMatch = name.match(/scale(\d+)/i);
  if (scaleMatch) {
    const rawScale = parseInt(scaleMatch[1]) / 100;
    scale = Math.max(0.1, Math.min(MAX_SCALE, rawScale)); // Clamp between 0.1x and 10x

    // Log warning if scale was clamped
    if (rawScale > MAX_SCALE || rawScale < 0.1) {
      console.warn(
        `fa-token-browser | Token scale clamped for ${filename}: ${rawScale}x -> ${scale}x (range: 0.1-${MAX_SCALE})`
      );
    }
  }

  return { gridWidth, gridHeight, scale };
}

/**
 * Calculate final pixel dimensions for a token drag preview.
 * @param {{gridWidth:number, gridHeight:number, scale:number}} sizeInfo
 * @param {number} gridSize - Scene grid size in pixels (default 100 if unknown)
 * @param {number} zoomLevel - Current canvas zoom (1 = 100%)
 * @returns {{width:number, height:number}}
 */
export function calcDragPreviewPixelDims(sizeInfo, gridSize = 100, zoomLevel = 1) {
  const { gridWidth = 1, gridHeight = 1, scale = 1 } = sizeInfo || {};
  const width = gridWidth * gridSize * scale * zoomLevel;
  const height = gridHeight * gridSize * scale * zoomLevel;
  return {
    width: Math.round(width),
    height: Math.round(height)
  };
}

// Helper: calculate preview size based on visual extent
export function calculatePreviewSize({gridWidth, gridHeight, scale}, baseSize = 200) {
  const visualWidth = gridWidth * scale;
  const visualHeight = gridHeight * scale;
  const maxVisual = Math.max(visualWidth, visualHeight);
  let previewSize;
  if (maxVisual <= 1.5) previewSize = baseSize;
  else if (maxVisual <= 2.5) previewSize = baseSize * 1.6;
  else if (maxVisual <= 4) previewSize = baseSize * 1.9;
  else if (maxVisual <= 10) previewSize = baseSize * 2.5;
  else previewSize = baseSize * 3;
  return {
    previewSize,
    containerMaxWidth: previewSize + 40
  };
}

// Helper: build grid CSS for preview image
export function buildGridCSS({gridWidth, gridHeight, scale}, imgWidth, imgHeight) {
  const visualWidth = gridWidth * scale;
  const visualHeight = gridHeight * scale;
  const gridSquareSizeX = imgWidth / visualWidth;
  const gridSquareSizeY = imgHeight / visualHeight;
  const gridSquareSize = Math.min(gridSquareSizeX, gridSquareSizeY);
  const offsetX = ((visualWidth - gridWidth) / 2) * gridSquareSize;
  const offsetY = ((visualHeight - gridHeight) / 2) * gridSquareSize;
  return {
    backgroundImage:
      `linear-gradient(to right, rgba(255,255,255,0.15) 1px, transparent 1px),` +
      `linear-gradient(to bottom, rgba(255,255,255,0.15) 1px, transparent 1px)`,
    backgroundSize: `${gridSquareSize}px ${gridSquareSize}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
    boxShadow:
      `inset 1px 0 0 rgba(255,255,255,0.15), inset 0 1px 0 rgba(255,255,255,0.15),` +
      `inset -1px 0 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(255,255,255,0.15)`
  };
} 