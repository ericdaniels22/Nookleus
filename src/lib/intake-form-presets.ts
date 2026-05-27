import type { FieldPreset } from "./types";

export const FIELD_PRESETS: FieldPreset[] = [
  {
    key: "phone",
    name: "Phone",
    icon: "Phone",
    description: "Phone number with US format hint",
    makeField: () => ({
      type: "phone",
      label: "Phone",
      placeholder: "(555) 123-4567",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "email",
    name: "Email",
    icon: "Mail",
    description: "Email address",
    makeField: () => ({
      type: "email",
      label: "Email",
      placeholder: "name@example.com",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "us_address",
    name: "US Address",
    icon: "MapPin",
    description: "Single-line text for full street address",
    makeField: () => ({
      type: "text",
      label: "Address",
      placeholder: "123 Main St, Austin, TX 78701",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "yes_no",
    name: "Yes / No",
    icon: "ToggleRight",
    description: "Pill selector with Yes and No options",
    makeField: () => ({
      type: "pill",
      label: "Yes or no?",
      required: false,
      is_default: false,
      visible: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    }),
  },
  {
    key: "currency",
    name: "Currency",
    icon: "DollarSign",
    description: "Number field for dollar amounts",
    makeField: () => ({
      type: "number",
      label: "Amount",
      placeholder: "0.00",
      help_text: "Enter dollar amount",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "date",
    name: "Date",
    icon: "Calendar",
    description: "Date picker",
    makeField: () => ({
      type: "date",
      label: "Date",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    // Slice D (#302): the built-in `referrer` field. `maps_to` routes the
    // picked value to `jobs.referral_partner_id` on submit (not to
    // `job_custom_fields`); `is_default: true` lets the renderer treat it
    // as a special FK-backed field rather than a free-text question.
    // Off-by-default per Organization is achieved by not seeding the field
    // into existing configs — admins opt in by adding it from this palette.
    key: "referrer",
    name: "Referred by",
    icon: "Users",
    description: "Picker for the Referral Partner who sent us this Job",
    makeField: () => ({
      type: "text",
      label: "Referred by",
      maps_to: "job.referral_partner_id",
      required: false,
      is_default: true,
      visible: true,
    }),
  },
];
