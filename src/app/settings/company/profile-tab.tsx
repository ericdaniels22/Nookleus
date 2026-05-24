"use client";

import { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Upload,
  Trash2,
  Loader2,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

export function ProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Form fields
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // Load settings on mount
  useEffect(() => {
    fetch("/api/settings/company")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: Record<string, string> | null) => {
        if (!data) return;
        setCompanyName(data.company_name || "");
        setPhone(data.phone || "");
        setEmail(data.email || "");
        setWebsite(data.website || "");
        setLicenseNumber(data.license_number || "");
        setAddressStreet(data.address_street || "");
        setAddressCity(data.address_city || "");
        setAddressState(data.address_state || "");
        setAddressZip(data.address_zip || "");
        if (data.logo_path) {
          setLogoUrl(
            `${supabaseUrl}/storage/v1/object/public/company-assets/${data.logo_path}`
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [supabaseUrl]);

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }

    setPendingLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeLogo() {
    setPendingLogoFile(null);
    setLogoPreview(null);
    setLogoUrl(null);
  }

  async function handleSave() {
    setSaving(true);

    try {
      // Upload logo if pending
      if (pendingLogoFile) {
        setUploadingLogo(true);
        const formData = new FormData();
        formData.append("file", pendingLogoFile);

        const logoRes = await fetch("/api/settings/company/logo", {
          method: "POST",
          body: formData,
        });

        if (logoRes.ok) {
          const logoData = await logoRes.json();
          setLogoUrl(logoData.url);
          setPendingLogoFile(null);
          setLogoPreview(null);
        } else {
          const err = await logoRes.json().catch(() => ({}));
          toast.error(err.error || "Failed to upload logo");
          setSaving(false);
          setUploadingLogo(false);
          return;
        }
        setUploadingLogo(false);
      }

      // Save text settings
      const res = await fetch("/api/settings/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          phone,
          email,
          website,
          license_number: licenseNumber,
          address_street: addressStreet,
          address_city: addressCity,
          address_state: addressState,
          address_zip: addressZip,
        }),
      });

      if (res.ok) {
        toast.success("Company profile saved");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    }

    setSaving(false);
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  const displayLogo = logoPreview || logoUrl;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Company Profile
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your company info appears on reports, invoices, and emails.
        </p>
      </div>

      {/* Logo */}
      <div className="bg-card rounded-xl border border-border p-6">
        <label className="block text-sm font-medium text-foreground mb-3">
          Company Logo
        </label>
        <div className="flex items-center gap-5">
          {displayLogo ? (
            <div className="w-24 h-24 rounded-xl border border-border overflow-hidden bg-muted flex items-center justify-center">
              <img
                src={displayLogo}
                alt="Company logo"
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-muted">
              <ImageIcon size={28} className="text-muted-foreground/50" />
            </div>
          )}
          <div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card text-muted-foreground hover:bg-accent transition-colors"
              >
                <Upload size={14} />
                Upload
              </button>
              {displayLogo && (
                <button
                  type="button"
                  onClick={removeLogo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              PNG, JPG, SVG, or WebP. Max 2MB. Recommended 400x400px.
            </p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden"
          onChange={handleLogoSelect}
        />
      </div>

      {/* Company Info */}
      <div className="bg-card rounded-xl border border-border p-6">
        <label className="block text-sm font-medium text-foreground mb-4">
          Company Information
        </label>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Company Name
            </label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="AAA Disaster Recovery"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Phone
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                type="tel"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Email
              </label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="info@company.com"
                type="email"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Website
              </label>
              <Input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://www.company.com"
                type="url"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                License Number
              </label>
              <Input
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="Contractor license #"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="bg-card rounded-xl border border-border p-6">
        <label className="block text-sm font-medium text-foreground mb-4">
          Business Address
        </label>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Street Address
            </label>
            <Input
              value={addressStreet}
              onChange={(e) => setAddressStreet(e.target.value)}
              placeholder="123 Main St"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                City
              </label>
              <Input
                value={addressCity}
                onChange={(e) => setAddressCity(e.target.value)}
                placeholder="City"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                State
              </label>
              <Input
                value={addressState}
                onChange={(e) => setAddressState(e.target.value)}
                placeholder="TX"
                maxLength={2}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                ZIP
              </label>
              <Input
                value={addressZip}
                onChange={(e) => setAddressZip(e.target.value)}
                placeholder="75001"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {uploadingLogo ? "Uploading Logo..." : saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
