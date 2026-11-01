// NEW FOR HACKATHON. Feedback text is typed by people and read back into prompts later, so it is
// treated as untrusted data: length limited, stripped of anything that reads like an instruction to a
// model, and always quoted when it goes into a prompt. This is a defence in depth, not a promise that
// a determined person cannot phrase something odd; the prompts also say quoted notes are data only.

export const FEEDBACK_MAX = 300;

// Sentence-level patterns that read as instructions to a model rather than a design opinion.
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]*\b(instruction|instructions|prompt|rules?|guidelines?|above|previous|earlier)\b/i,
  /\b(system|developer|assistant)\s*(prompt|message|instruction)s?\b/i,
  /\b(you are now|you must now|from now on you|act as|pretend (to be|you)|new instructions?)\b/i,
  /\b(reveal|print|show|repeat|output|leak)\b[^.!?\n]*\b(prompt|instructions?|api key|secret|password|token|system)\b/i,
  /\b(api[ _-]?key|password|secret|bearer|token)\s*[:=]/i,
  /^\s*(system|assistant|user|human|developer)\s*:/i,
  /\bjailbreak\b/i,
  /\b(always|never)\s+(give|score|rate|return|output|say|respond)\b[^.!?\n]*\b(10|ten|1|one|json|only)\b/i,
];

/**
 * Cleans one piece of feedback text. Returns plain single-line text no longer than max, with
 * markup, code fences, template and special-token syntax removed, dashes normalised, and any sentence
 * that looks like an instruction to a model dropped.
 */
export function sanitizeFeedbackText(input: unknown, max: number = FEEDBACK_MAX): string {
  if (typeof input !== "string") return "";
  let s = input
    .replace(/[\u0000-\u001f\u007f]+/g, " ") // control characters and newlines
    .replace(/[\u2013\u2014]/g, ",") // dash rule: no em or en dashes anywhere
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<\|[^>]*\|>/g, " ") // special tokens such as <|im_start|>
    .replace(/<[^>]{0,80}>/g, " ") // tags
    .replace(/\{\{[^}]*\}\}|\$\{[^}]*\}/g, " ") // templating
    .replace(/[`{}[\]<>\\]/g, " ")
    .replace(/#{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop whole sentences that look like instructions.
  const sentences = s.split(/(?<=[.!?])\s+/);
  s = sentences.filter((sentence) => !INSTRUCTION_PATTERNS.some((re) => re.test(sentence))).join(" ").trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "").trim();
  return s;
}

/** Wraps already-sanitised text so a prompt treats it as quoted data. Inner quotes become single quotes. */
export function quoteAsData(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}
