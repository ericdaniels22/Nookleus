import { describe, expect, it } from "vitest";

import { collapseNameFields } from "./form-config-name-collapse";
import type { FormConfig, FormField } from "./types";

/** A field mapped to the legacy first-name column, as the build14f seed has it. */
function firstNameField(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "first_name",
    type: "text",
    label: "First Name",
    required: true,
    is_default: true,
    visible: true,
    maps_to: "contact.first_name",
    merge_field_slug: "customer_first_name",
    ...overrides,
  };
}

/** A field mapped to the legacy last-name column, as the build14f seed has it. */
function lastNameField(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "last_name",
    type: "text",
    label: "Last Name",
    required: false,
    is_default: true,
    visible: true,
    maps_to: "contact.last_name",
    ...overrides,
  };
}

const phoneField: FormField = {
  id: "phone",
  type: "phone",
  label: "Phone",
  is_default: true,
  visible: true,
  maps_to: "contact.phone",
};

/** The standard two-name-field intake form, mirroring the build14f default. */
function standardConfig(): FormConfig {
  return {
    sections: [
      {
        id: "customer",
        title: "Customer",
        fields: [firstNameField(), lastNameField(), phoneField],
      },
    ],
  };
}

describe("collapseNameFields", () => {
  it("collapses the standard two-field default form into one required Full Name field", () => {
    const result = collapseNameFields(standardConfig());
    const fields = result.sections[0].fields;

    expect(fields).toHaveLength(2);
    const [name, phone] = fields;
    expect(name.label).toBe("Full Name");
    expect(name.maps_to).toBe("contact.full_name");
    expect(name.type).toBe("text");
    expect(name.required).toBe(true);
    expect(name.merge_field_slug).toBe("customer_name");
    expect(phone).toEqual(phoneField);
  });

  it("places the collapsed field at the former first-name field's position", () => {
    const config: FormConfig = {
      sections: [
        {
          id: "customer",
          title: "Customer",
          fields: [phoneField, firstNameField(), lastNameField()],
        },
      ],
    };
    const fields = collapseNameFields(config).sections[0].fields;

    expect(fields.map((f) => f.maps_to)).toEqual([
      "contact.phone",
      "contact.full_name",
    ]);
  });

  it("finds the name fields even when reordered, relabeled, or split across sections", () => {
    const config: FormConfig = {
      sections: [
        {
          id: "names",
          title: "Names",
          fields: [
            lastNameField({ label: "Surname" }),
            firstNameField({ label: "Given name" }),
          ],
        },
        {
          id: "contact",
          title: "Contact",
          fields: [phoneField],
        },
      ],
    };
    const result = collapseNameFields(config);

    // The collapsed field stays at the first-name field's position (section 0, index 1).
    expect(result.sections[0].fields.map((f) => f.maps_to)).toEqual([
      "contact.full_name",
    ]);
    expect(result.sections[1].fields).toEqual([phoneField]);
  });

  it("collapses a form that has only the first-name field", () => {
    const config: FormConfig = {
      sections: [
        { id: "customer", title: "Customer", fields: [firstNameField(), phoneField] },
      ],
    };
    const fields = collapseNameFields(config).sections[0].fields;

    expect(fields).toHaveLength(2);
    expect(fields[0].label).toBe("Full Name");
    expect(fields[0].maps_to).toBe("contact.full_name");
    expect(fields[0].required).toBe(true);
  });

  it("collapses a form that has only the last-name field", () => {
    const config: FormConfig = {
      sections: [
        {
          id: "customer",
          title: "Customer",
          fields: [phoneField, lastNameField({ required: true })],
        },
      ],
    };
    const fields = collapseNameFields(config).sections[0].fields;

    expect(fields).toHaveLength(2);
    expect(fields[1].label).toBe("Full Name");
    expect(fields[1].maps_to).toBe("contact.full_name");
    expect(fields[1].merge_field_slug).toBe("customer_name");
  });

  it("marks the collapsed field required if either original field was required", () => {
    const neither = collapseNameFields({
      sections: [
        {
          id: "s",
          title: "S",
          fields: [
            firstNameField({ required: false }),
            lastNameField({ required: false }),
          ],
        },
      ],
    });
    expect(neither.sections[0].fields[0].required).toBe(false);

    const onlyLast = collapseNameFields({
      sections: [
        {
          id: "s",
          title: "S",
          fields: [
            firstNameField({ required: false }),
            lastNameField({ required: true }),
          ],
        },
      ],
    });
    expect(onlyLast.sections[0].fields[0].required).toBe(true);
  });

  it("leaves a form with neither name field unchanged", () => {
    const config: FormConfig = {
      sections: [{ id: "s", title: "S", fields: [phoneField] }],
    };
    expect(collapseNameFields(config)).toEqual(config);
  });

  it("is idempotent — collapsing an already-collapsed form is a no-op", () => {
    const once = collapseNameFields(standardConfig());
    expect(collapseNameFields(once)).toEqual(once);
  });

  it("does not mutate the input config", () => {
    const config = standardConfig();
    const snapshot = JSON.stringify(config);
    collapseNameFields(config);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});
