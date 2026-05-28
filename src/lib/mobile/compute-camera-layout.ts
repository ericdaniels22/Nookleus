export type CameraLayoutMode = "stacked" | "overlay";

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
  controlsMinSize?: number;
}

export function computeCameraLayout(
  input: ComputeCameraLayoutInput,
): CameraLayout {
  const { viewportWidth, viewportHeight, controlsMinSize = 0 } = input;

  if (viewportWidth >= viewportHeight) {
    // Overlay: 4:3 preview centered horizontally, full viewport height.
    // Controls float over the preview pixels; controlsMinSize is not consulted.
    const width = Math.round((viewportHeight * 4) / 3);
    const x = Math.round((viewportWidth - width) / 2);
    return {
      mode: "overlay",
      previewRect: { x, y: 0, width, height: viewportHeight },
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
