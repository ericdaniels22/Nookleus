import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { JarvisAttachment } from "@/lib/types";
import JarvisInput from "./JarvisInput";

// Issue #200 — the chat input carries up to five Chat attachments. The
// user picks (or drops) files; the input shows them as a strip and turns
// any extras away with a clear message.

function imageFile(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

function pickFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  // jsdom has no object-URL support — the input creates one per preview.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

function uploadStub(): (file: File) => Promise<JarvisAttachment> {
  return vi.fn(async (file: File) => ({
    kind: "image" as const,
    storage_path: `org/conv/${file.name}`,
    media_type: "image/jpeg",
    filename: file.name,
  }));
}

describe("JarvisInput — multi-file attachments (#200)", () => {
  it("admits only five files and rejects the rest with a clear message", async () => {
    const onUpload = uploadStub();
    const { container } = render(
      <JarvisInput onSend={vi.fn()} onUploadAttachment={onUpload} />,
    );

    pickFiles(
      container,
      ["a", "b", "c", "d", "e", "f", "g"].map((n) => imageFile(`${n}.jpg`)),
    );

    // The cap message names the limit.
    expect(await screen.findByText(/5 files/i)).toBeTruthy();

    // Only five slots end up in the strip.
    const removeButtons = screen.getAllByRole("button", {
      name: /remove attachment/i,
    });
    expect(removeButtons).toHaveLength(5);

    // Only the five admitted files were uploaded.
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(5));
  });

  it("removes a single attachment without disturbing the rest", async () => {
    const onUpload = uploadStub();
    const { container } = render(
      <JarvisInput onSend={vi.fn()} onUploadAttachment={onUpload} />,
    );

    pickFiles(container, [
      imageFile("one.jpg"),
      imageFile("two.jpg"),
      imageFile("three.jpg"),
    ]);

    expect(
      screen.getAllByRole("button", { name: /remove attachment/i }),
    ).toHaveLength(3);

    // Drop the middle one.
    fireEvent.click(screen.getByAltText("two.jpg").parentElement!.querySelector(
      'button[aria-label="Remove attachment"]',
    ) as HTMLElement);

    expect(
      screen.getAllByRole("button", { name: /remove attachment/i }),
    ).toHaveLength(2);
    expect(screen.getByAltText("one.jpg")).toBeTruthy();
    expect(screen.getByAltText("three.jpg")).toBeTruthy();
    expect(screen.queryByAltText("two.jpg")).toBeNull();

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(3));
  });

  it("attaches image files dropped onto the chat box", async () => {
    const onUpload = uploadStub();
    const { container } = render(
      <JarvisInput onSend={vi.fn()} onUploadAttachment={onUpload} />,
    );

    fireEvent.drop(container.firstChild as HTMLElement, {
      dataTransfer: {
        files: [imageFile("dropped-1.jpg"), imageFile("dropped-2.jpg")],
      },
    });

    expect(await screen.findByAltText("dropped-1.jpg")).toBeTruthy();
    expect(screen.getByAltText("dropped-2.jpg")).toBeTruthy();
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
  });

  it("rejects a dropped non-image with a clear message", async () => {
    const onUpload = uploadStub();
    const { container } = render(
      <JarvisInput onSend={vi.fn()} onUploadAttachment={onUpload} />,
    );

    fireEvent.drop(container.firstChild as HTMLElement, {
      dataTransfer: {
        files: [new File(["x"], "contract.pdf", { type: "application/pdf" })],
      },
    });

    expect(await screen.findByText(/only images/i)).toBeTruthy();
    expect(
      screen.queryAllByRole("button", { name: /remove attachment/i }),
    ).toHaveLength(0);
    expect(onUpload).not.toHaveBeenCalled();
  });
});
