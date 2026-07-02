import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Native shell chrome contract (#912, docs/design-system.md §7.6).
//
// The iPhone app is the web app inside a Capacitor shell; the shell's chrome
// must match the dark canvas (`--background` #0B0F0E) or the theme looks
// broken on every launch. No status-bar/splash plugins are installed (§9.6
// forbids new dependencies), so the chrome lives in static config: the
// Capacitor WebView background, the Info.plist status-bar keys, and the
// launch-screen storyboard. This suite pins those files the same way
// design-tokens.test.ts pins globals.css.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("Native shell chrome (#912, design-system §7.6)", () => {
  it("paints the Capacitor WebView background in the canvas color", () => {
    const config = read("capacitor.config.ts");
    const colors = [
      ...config.matchAll(/backgroundColor:\s*["']([^"']+)["']/g),
    ].map((m) => m[1].toUpperCase());

    // Root + ios-specific entries, all on the canvas (#0B0F0E, opaque).
    expect(colors.length).toBeGreaterThanOrEqual(2);
    for (const color of colors) {
      expect(color.startsWith("#0B0F0E")).toBe(true);
    }
  });

  it("sets the iOS status bar to light text app-wide", () => {
    const plist = read("ios/App/App/Info.plist");

    expect(plist).toContain("<key>UIStatusBarStyle</key>");
    expect(plist).toContain("<string>UIStatusBarStyleLightContent</string>");
    // The style is app-wide, not per view controller — with the flag true,
    // UIStatusBarStyle would be ignored.
    expect(plist).toMatch(
      /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<false\/>/,
    );
  });

  it("paints the splash screen background #0B0F0E", () => {
    const storyboard = read("ios/App/App/Base.lproj/LaunchScreen.storyboard");

    // sRGB components of #0B0F0E: 11/255, 15/255, 14/255.
    expect(storyboard).toMatch(/red="0\.043\d*"/);
    expect(storyboard).toMatch(/green="0\.058\d*"/);
    expect(storyboard).toMatch(/blue="0\.054\d*"/);
    // The old white systemBackgroundColor must be gone.
    expect(storyboard).not.toContain("systemBackgroundColor");
  });
});
