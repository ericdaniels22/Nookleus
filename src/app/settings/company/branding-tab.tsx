"use client";

import { AppearanceSection } from "./appearance-section";
import { PdfPresetsSection } from "./pdf-presets-section";

// #233 — Branding tab combines two visual-design surfaces a normal user
// thinks of together: how the app looks (Appearance) and how PDF
// documents look (PDF Presets). PRD #226 locks the decision to merge as
// sub-sections in one scrollable layout — NOT nested tabs.
export function BrandingTab() {
  return (
    <div className="space-y-10">
      <AppearanceSection />
      <PdfPresetsSection />
    </div>
  );
}
