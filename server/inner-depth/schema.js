// JSON Schemas for the model's structured output (OpenAI strict mode: every property required,
// no additional properties, optionals expressed as nullable) and a small validator so the server
// never trusts the provider to have enforced them.

export const THEME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Short theme title in the participant's terms, 2 to 6 words. Not a diagnosis or type." },
    read_aloud: { type: "string", description: "What the facilitator reads to the participant. Second person (you, your). Tentative wording. 1 to 4 sentences." },
    answer_ids: { type: "array", items: { type: "string" }, description: "Ids of the answers or volunteered items this theme rests on. At least one. Background ids are not allowed." },
    principle_ids: { type: "array", items: { type: "string" }, description: "Ids of library principles that shaped how this theme is worded. May be empty." },
    confidence: { type: "string", enum: ["clear", "tentative"], description: "clear when the participant said this in nearly these terms; tentative when it connects several notes." },
    facilitator_note: { type: ["string", "null"], description: "Facilitator-only note: what connects the cited answers, what to check, or where background was consulted but not used." }
  },
  required: ["title", "read_aloud", "answer_ids", "principle_ids", "confidence", "facilitator_note"]
};

export const REFLECTION_SCHEMA = {
  name: "inner_depth_reflection",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["reflection", "insufficient_notes", "safety_support"] },
      opening: { type: "string", description: "Second-person opening the facilitator reads first: thanks, invites correction. Empty when status is not reflection." },
      themes: { type: "array", items: THEME_SCHEMA, description: "As many or as few themes as the notes support. Order by how strongly the notes support them." },
      ambiguities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            answer_id: { type: ["string", "null"], description: "The answer this concerns, or null for the session overall." },
            note: { type: "string", description: "Facilitator-only: what is unclear, in plain words. Do not guess the meaning." },
            clarifying_question: { type: ["string", "null"], description: "Optional neutral question the facilitator could ask the participant, in second person." }
          },
          required: ["answer_id", "note", "clarifying_question"]
        }
      },
      follow_up_questions: { type: "array", items: { type: "string" }, description: "0 to 3 open, non-leading second-person questions the participant may decline." },
      closing: { type: "string", description: "Second-person closing that hands authority back to the participant. Empty when status is not reflection." },
      insufficient_reason: { type: ["string", "null"], description: "When status is insufficient_notes: what is missing, for the facilitator." },
      safety_support: { type: ["string", "null"], description: "When status is safety_support: brief practical guidance to seek immediate human help. Otherwise null." }
    },
    required: ["status", "opening", "themes", "ambiguities", "follow_up_questions", "closing", "insufficient_reason", "safety_support"]
  }
};

export const SINGLE_THEME_SCHEMA = {
  name: "inner_depth_theme",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["theme", "unsupported", "safety_support"] },
      theme: { type: ["object", "null"], additionalProperties: false, properties: THEME_SCHEMA.properties, required: THEME_SCHEMA.required },
      reason: { type: ["string", "null"], description: "When unsupported: why the notes cannot support the requested theme." },
      safety_support: { type: ["string", "null"] }
    },
    required: ["status", "theme", "reason", "safety_support"]
  }
};

export const CHAT_SCHEMA = {
  name: "inner_depth_assistant",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string", description: "Answer to the facilitator, grounded only in the session notes. Say plainly when the notes do not say." },
      grounded_in: { type: "array", items: { type: "string" }, description: "Ids of the answers the reply draws on." },
      proposed_revisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            theme_id: { type: "string" },
            title: { type: "string" },
            read_aloud: { type: "string", description: "Second-person wording to replace the theme's read-aloud text." }
          },
          required: ["theme_id", "title", "read_aloud"]
        },
        description: "Suggested rewordings of existing themes when the facilitator asked for one. Empty otherwise."
      },
      caution: { type: ["string", "null"], description: "Set when the request asked for something the notes cannot support (a cause, a diagnosis, a hidden motive). Explain briefly." },
      safety_support: { type: ["string", "null"] }
    },
    required: ["reply", "grounded_in", "proposed_revisions", "caution", "safety_support"]
  }
};

// Minimal JSON Schema validator for the subset above. Returns a list of problems (empty when valid).
export function validateAgainstSchema(value, schema, path = "$") {
  const problems = [];
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!types.includes(actual === "number" && Number.isInteger(value) && types.includes("integer") ? "integer" : actual)) {
    problems.push(`${path}: expected ${types.join("|")}, got ${actual}`);
    return problems;
  }
  if (actual === "null") return problems;
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (actual === "object") {
    const props = schema.properties || {};
    for (const key of schema.required || []) if (!(key in value)) problems.push(`${path}.${key}: missing`);
    for (const key of Object.keys(value)) {
      if (!(key in props)) { if (schema.additionalProperties === false) problems.push(`${path}.${key}: unexpected property`); continue; }
      problems.push(...validateAgainstSchema(value[key], props[key], `${path}.${key}`));
    }
  }
  if (actual === "array" && schema.items) value.forEach((item, i) => problems.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)));
  return problems;
}
