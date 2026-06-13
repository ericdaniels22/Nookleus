import { describe, expect, it } from "vitest";
import JayPeg from "jay-peg";

/**
 * Regression test for photo-report PDFs rendering every photo frame blank.
 *
 * iPhone HDR photos carry an Apple gain-map tail in the JFIF APP0 segment:
 * the segment declares length 20 instead of the standard 16, with the 4
 * extra bytes spelling "AMPF". jay-peg's JFIF marker struct reads exactly
 * the 16 standard bytes and ignores the declared length, so the parser
 * desyncs by 4 bytes and reads "AM" (0x414d = 16717) where the next marker
 * code should be — restructure throws "Unknown version 16717", react-pdf
 * swallows it as a warning, and the image is silently dropped from the PDF.
 *
 * Locked down here against jay-peg directly (the exact seam @react-pdf/image
 * calls), with the patched package under patches/jay-peg+1.1.1.patch. If a
 * reinstall ever loses the patch, this test goes red.
 */

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

// SOF0 for a 3x2 image with 3 components — enough for jay-peg to report
// dimensions, which is all @react-pdf/image reads from the markers.
const SOF0 = [
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22,
  0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
];

// Standard 16-byte JFIF APP0: version 1.1, no units, 1x1 density, no thumbnail.
const JFIF_FIELDS = [
  0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x00,
];

function jpegWithApp0(extraTail: number[]): Buffer {
  const length = 2 + JFIF_FIELDS.length + extraTail.length;
  const app0 = [0xff, 0xe0, (length >> 8) & 0xff, length & 0xff, ...JFIF_FIELDS, ...extraTail];
  return Buffer.from([...SOI, ...app0, ...SOF0, ...EOI]);
}

describe("jay-peg on Apple HDR JPEGs (blank photo-report frames)", () => {
  it("parses past a JFIF APP0 with Apple's AMPF tail", () => {
    const ampf = [0x41, 0x4d, 0x50, 0x46]; // "AMPF"
    const markers = JayPeg.decode(jpegWithApp0(ampf));

    const sof = markers.find((m: { type: string }) => m.type === 0xffc0);
    expect(sof).toMatchObject({ width: 3, height: 2 });
  });

  it("still parses a standard 16-byte JFIF APP0", () => {
    const markers = JayPeg.decode(jpegWithApp0([]));

    const sof = markers.find((m: { type: string }) => m.type === 0xffc0);
    expect(sof).toMatchObject({ width: 3, height: 2 });
  });
});
