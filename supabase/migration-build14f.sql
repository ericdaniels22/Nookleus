-- ============================================
-- Build 14f Migration: Intake Form Builder
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. FORM CONFIG (versioned JSON)
-- ============================================
CREATE TABLE form_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config jsonb NOT NULL DEFAULT '{"sections":[]}',
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. JOB CUSTOM FIELDS (key-value per job)
-- ============================================
CREATE TABLE job_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, field_key)
);

-- ============================================
-- 3. TIMESTAMPS + RLS
-- ============================================
CREATE TRIGGER trg_form_config_updated_at
  BEFORE UPDATE ON form_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE form_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on form_config" ON form_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on job_custom_fields" ON job_custom_fields FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_form_config_version ON form_config(version DESC);
CREATE INDEX idx_job_custom_fields_job_id ON job_custom_fields(job_id);

-- ============================================
-- 4. SEED DEFAULT FORM CONFIG
-- ============================================
INSERT INTO form_config (config, version, created_by) VALUES (
'{
  "sections": [
    {
      "id": "caller_info",
      "title": "Caller Information",
      "is_default": true,
      "visible": true,
      "fields": [
        {"id": "first_name", "type": "text", "label": "First Name", "required": true, "is_default": true, "visible": true, "maps_to": "contact.first_name"},
        {"id": "last_name", "type": "text", "label": "Last Name", "required": false, "is_default": true, "visible": true, "maps_to": "contact.last_name"},
        {"id": "phone", "type": "phone", "label": "Phone", "required": false, "is_default": true, "visible": true, "maps_to": "contact.phone"},
        {"id": "email", "type": "email", "label": "Email", "required": false, "is_default": true, "visible": true, "maps_to": "contact.email"}
      ]
    },
    {
      "id": "damage_info",
      "title": "Damage Information",
      "is_default": true,
      "visible": true,
      "fields": [
        {"id": "damage_type", "type": "pill", "label": "Type of Damage", "required": true, "is_default": true, "visible": true, "maps_to": "job.damage_type", "options_source": "damage_types"},
        {"id": "damage_source", "type": "text", "label": "Source of Damage", "required": false, "is_default": true, "visible": true, "maps_to": "job.damage_source"},
        {"id": "when_happened", "type": "date", "label": "When Did It Happen?", "required": false, "is_default": true, "visible": true},
        {"id": "affected_areas", "type": "text", "label": "Affected Areas", "required": false, "is_default": true, "visible": true, "maps_to": "job.affected_areas"}
      ]
    },
    {
      "id": "relationship",
      "title": "Relationship to Property",
      "is_default": true,
      "visible": true,
      "fields": [
        {"id": "role", "type": "pill", "label": "Relationship", "required": true, "is_default": true, "visible": true, "maps_to": "contact.role", "options": [
          {"value": "homeowner", "label": "Homeowner"},
          {"value": "tenant", "label": "Tenant"},
          {"value": "property_manager", "label": "Property Manager"},
          {"value": "adjuster", "label": "Adjuster"},
          {"value": "insurance", "label": "Insurance"}
        ]}
      ]
    },
    {
      "id": "property",
      "title": "Property Details",
      "is_default": true,
      "visible": true,
      "fields": [
        {"id": "property_address", "type": "text", "label": "Property Address", "required": true, "is_default": true, "visible": true, "maps_to": "job.property_address"},
        {"id": "property_type", "type": "pill", "label": "Property Type", "required": false, "is_default": true, "visible": true, "maps_to": "job.property_type", "options": [
          {"value": "single_family", "label": "Single Family"},
          {"value": "multi_family", "label": "Multi Family"},
          {"value": "commercial", "label": "Commercial"},
          {"value": "condo", "label": "Condo"}
        ]},
        {"id": "property_sqft", "type": "number", "label": "Approx. Square Footage", "required": false, "is_default": true, "visible": true, "maps_to": "job.property_sqft"},
        {"id": "property_stories", "type": "number", "label": "Stories", "required": false, "is_default": true, "visible": true, "maps_to": "job.property_stories"},
        {"id": "access_notes", "type": "text", "label": "Access Notes", "placeholder": "Gate codes, pets, etc.", "required": false, "is_default": true, "visible": true, "maps_to": "job.access_notes"}
      ]
    },
    {
      "id": "urgency",
      "title": "Urgency",
      "is_default": true,
      "visible": true,
      "fields": [
        {"id": "urgency", "type": "pill", "label": "Urgency Level", "required": false, "is_default": true, "visible": true, "maps_to": "job.urgency", "default_value": "scheduled", "options": [
          {"value": "emergency", "label": "Emergency", "color": "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/30"},
          {"value": "urgent", "label": "Urgent", "color": "bg-[#FAEEDA] text-[#633806] border-[#633806]/30"},
          {"value": "scheduled", "label": "Scheduled", "color": "bg-[#E6F1FB] text-[#0C447C] border-[#0C447C]/30"}
        ]}
      ]
    },
    {
      "id": "insurance",
      "title": "Insurance",
      "is_default": true,
      "visible": true,
      "fields": [
        {"id": "has_insurance", "type": "pill", "label": "Insurance Claim?", "required": false, "is_default": true, "visible": true, "options": [
          {"value": "yes", "label": "Yes"},
          {"value": "no", "label": "No"},
          {"value": "not_sure", "label": "Not Sure"}
        ]},
        {"id": "insurance_company", "type": "text", "label": "Insurance Company", "required": false, "is_default": true, "visible": true, "maps_to": "job.insurance_company", "show_when": "has_insurance=yes"},
        {"id": "claim_number", "type": "text", "label": "Claim Number", "required": false, "is_default": true, "visible": true, "maps_to": "job.claim_number", "show_when": "has_insurance=yes"},
        {"id": "adjuster_name", "type": "text", "label": "Adjuster Name", "required": false, "is_default": true, "visible": true, "show_when": "has_insurance=yes"},
        {"id": "adjuster_phone", "type": "phone", "label": "Adjuster Phone", "required": false, "is_default": true, "visible": true, "show_when": "has_insurance=yes"}
      ]
    },
    {
      "id": "notes",
      "title": "Additional Notes",
      "is_default": true,
      "visible": true,
      "fields": [
        {"id": "notes", "type": "textarea", "label": "Notes", "required": false, "is_default": true, "visible": true, "maps_to": "contact.notes"}
      ]
    }
  ]
}'::jsonb,
1,
'system'
);
