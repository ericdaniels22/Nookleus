export type CameraLayoutMode = "stacked" | "split";

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraLayout {
  mode: CameraLayoutMode;
  previewRect: PreviewRect;
}

export interface ComputeCameraLayoutInput {
  viewportWidth: number;
  viewportHeight: number;
  controlsMinSize: number;
}

export function computeCameraLayout(
  input: ComputeCameraLayoutInput,
): CameraLayout {
  const { viewportWidth, viewportHeight, controlsMinSize } = input;

  if (viewportWidth >= viewportHeight) {
    // Split: 4:3 landscape preview on the left, controls panel on the right.
    const naturalWidth = (viewportHeight * 4) / 3;
    const maxWidth = viewportWidth - controlsMinSize;

    if (naturalWidth <= maxWidth) {
      const width = Math.round(naturalWidth);
      return {
        mode: "split",
        previewRect: { x: 0, y: 0, width, height: viewportHeight },
      };
    }

    const width = Math.round(maxWidth);
    const height = Math.round((width * 3) / 4);
    const y = Math.round((viewportHeight - height) / 2);
    return {
      mode: "split",
      previewRect: { x: 0, y, width, height },
    };
  }

  // Stacked: 3:4 portrait preview, controls strip below.
  const naturalHeight = (viewportWidth * 4) / 3;
  const maxHeight = viewportHeight - controlsMinSize;

  if (naturalHeight <= maxHeight) {
    const height = Math.round(naturalHeight);
    return {
      mode: "stacked",
      previewRect: { x: 0, y: 0, width: viewportWidth, height },
    };
  }

  const height = Math.round(maxHeight);
  const width = Math.round((height * 3) / 4);
  const x = Math.round((viewportWidth - width) / 2);
  return {
    mode: "stacked",
    previewRect: { x, y: 0, width, height },
  };
}
