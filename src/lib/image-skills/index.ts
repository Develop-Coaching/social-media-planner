// Image generation "skills" — templated styles ported from the Claude Code
// skills in "Marketing/Image Generator Whiteboard/.claude/skills".
// Each skill captures: model, prompt template, reference images (under
// public/image-skills/), required inputs, and watermark post-processing.

export type ImageSkillId =
  | "whiteboard-single"
  | "whiteboard-carousel"
  | "cta-post"
  | "twitter-post"
  | "freestyle-image";

export interface SkillInputSpec {
  id: string;
  label: string;
  type: "text" | "textarea" | "number";
  placeholder?: string;
  defaultValue?: string | number;
  min?: number;
  max?: number;
  required?: boolean;
  help?: string;
}

// Client-side watermark cleanup applied after generation (Canvas API):
// - whiteboard-mirror: mirror the bottom-left wood strip over the bottom-right
// - corner-patch: cover the bottom-right corner with a patch sampled to its left
// - black-border: shrink and recenter on a black canvas (uniform margin)
export type PostProcessStep =
  | { kind: "whiteboard-mirror" }
  | { kind: "corner-patch"; size: number; sampleOffset: number }
  | { kind: "black-border"; margin: number };

export interface SkillPromptContext {
  slideIndex?: number; // 0-based
  slideCount?: number;
}

export interface ImageSkill {
  id: ImageSkillId;
  name: string;
  description: string;
  model: string;
  referenceImages: string[]; // paths under public/
  inputs: SkillInputSpec[];
  multiImage?: boolean; // carousel-style: generates inputs.slides images
  // First generated image is re-attached as a style reference for later slides
  chainFirstImage?: boolean;
  postProcess: PostProcessStep[];
  buildPrompt(inputs: Record<string, string | number>, ctx?: SkillPromptContext): string;
}

const BRAND_YELLOW = "#FDCE36";
const BRAND_BLUE = "#0069B1";

const WHITEBOARD_STYLE = `Render the slide on the EXACT whiteboard shown in the first reference image:
the same aluminum-framed whiteboard mounted on a plywood/OSB wall, with the
same safety-notice papers visible at the sides, same lighting and glare.

Content drawn on the whiteboard must be in the hand-drawn black marker
illustration style shown in the second reference image:
- Bold black marker line-art for characters, objects, and icons
- Slightly rough, hand-drawn sketch feel (not vector/flat)
- Selective colour accents ONLY in green, orange, red, yellow highlighter
- Headline text in hand-lettered block capitals
- Use green highlighter swipes behind key words; red strikethrough for
  negative words; orange/yellow for accents
- Include supporting doodles (icons, papers, clocks, arrows, speech bubbles)
  around the central subject when appropriate
- Composition fills the whiteboard; leave small margins from the frame
- Final image must be square (1:1), photographed-whiteboard look, NOT flat
  digital art`;

// Heuristic slide plan ported from whiteboard-carousel/generate.py:
// slide 1 = hook, last = CTA, middles rotate cost/cause/shift/steps/proof.
function planSlide(topic: string, audience: string, index: number, total: number): { role: string; brief: string } {
  if (index === 0) {
    return {
      role: "hook",
      brief:
        `Hook slide for a carousel about: '${topic}'. Audience: ${audience}. ` +
        `Write a punchy 4-8 word headline that names a painful problem the ` +
        `audience faces, in the style of 'YOUR TEAM IS LOSING HOURS' where ` +
        `the negative phrase has a red strikethrough. Draw a central ` +
        `character or scene that embodies the problem, surrounded by ` +
        `supporting doodles (papers, clocks, icons of chaos).`,
    };
  }
  if (index === total - 1 && total >= 2) {
    return {
      role: "cta",
      brief:
        `Final CTA slide for a carousel about '${topic}'. Audience: ${audience}. ` +
        `Short imperative headline (e.g. 'BOOK A CALL', 'GET THE SYSTEM'), a ` +
        `confident character pointing at the viewer, green highlighter behind ` +
        `the CTA words, an arrow pointing to where to tap/swipe.`,
    };
  }
  const midRoles: [string, string][] = [
    ["cost", "Show the COST / CONSEQUENCE of the problem with a short headline and a visual metaphor (money flying away, time draining, stress icons)."],
    ["cause", "Reveal the ROOT CAUSE with a short headline and a diagram-style doodle (arrows, cause->effect, a broken process)."],
    ["shift", "Contrast OLD WAY vs NEW WAY with a split layout, red X on the old, green tick on the new."],
    ["steps", "Show 3 SIMPLE STEPS as numbered doodles with arrows between them."],
    ["proof", "Show a RESULT / PROOF - a confident character, green tick, upward arrow, happy outcome icons."],
  ];
  const [role, guidance] = midRoles[(index - 1) % midRoles.length];
  return {
    role,
    brief: `Slide ${index + 1} of ${total} in a carousel about '${topic}' for ${audience}. ${guidance} Keep headline under 8 words.`,
  };
}

function parseHighlights(text: string): { clean: string; highlights: string[] } {
  const highlights = Array.from(text.matchAll(/\*([^*\n]+?)\*/g)).map((m) => m[1]);
  const clean = text.replace(/\*([^*\n]+?)\*/g, "$1");
  return { clean, highlights };
}

export const IMAGE_SKILLS: ImageSkill[] = [
  {
    id: "whiteboard-single",
    name: "Whiteboard",
    description: "Hand-drawn marker illustration on the Develop Coaching site whiteboard",
    model: "gemini-3.1-flash-image-preview",
    referenceImages: ["image-skills/blank-whiteboard.jpg", "image-skills/example-styled.jpg"],
    inputs: [
      {
        id: "prompt",
        label: "What should be on the whiteboard?",
        type: "textarea",
        placeholder: "A builder buried under paperwork with the headline 'DROWNING IN ADMIN'",
        required: true,
      },
    ],
    postProcess: [{ kind: "whiteboard-mirror" }],
    buildPrompt(inputs) {
      return (
        `${WHITEBOARD_STYLE}\n\n` +
        `THIS SLIDE: ${inputs.prompt}\n\n` +
        `Output: a single square photograph of the whiteboard with the new ` +
        `content drawn on it. No text outside the whiteboard.`
      );
    },
  },
  {
    id: "whiteboard-carousel",
    name: "Whiteboard Carousel",
    description: "Multi-slide whiteboard story: hook → insight slides → CTA",
    model: "gemini-3.1-flash-image-preview",
    referenceImages: ["image-skills/blank-whiteboard.jpg", "image-skills/example-styled.jpg"],
    multiImage: true,
    chainFirstImage: true,
    inputs: [
      {
        id: "topic",
        label: "Carousel topic",
        type: "textarea",
        placeholder: "Your team is losing hours every week to bad handovers",
        required: true,
      },
      {
        id: "slides",
        label: "Number of slides",
        type: "number",
        defaultValue: 4,
        min: 2,
        max: 10,
        required: true,
      },
      {
        id: "audience",
        label: "Audience",
        type: "text",
        defaultValue: "construction / trades business owners",
      },
    ],
    postProcess: [{ kind: "whiteboard-mirror" }],
    buildPrompt(inputs, ctx) {
      const total = ctx?.slideCount ?? Number(inputs.slides) ?? 4;
      const index = ctx?.slideIndex ?? 0;
      const audience = String(inputs.audience || "construction / trades business owners");
      const slide = planSlide(String(inputs.topic), audience, index, total);
      return (
        `${WHITEBOARD_STYLE}\n\n` +
        `CAROUSEL CONTEXT: ${inputs.topic} (slide ${index + 1} of ${total}, role: ${slide.role}).\n\n` +
        `THIS SLIDE: ${slide.brief}\n\n` +
        `Output: a single square photograph of the whiteboard with the new ` +
        `content drawn on it. No text outside the whiteboard.`
      );
    },
  },
  {
    id: "cta-post",
    name: "CTA Post",
    description: "Black announcement card with yellow keyword highlights and a link CTA",
    model: "gemini-3.1-flash-image-preview",
    referenceImages: [],
    inputs: [
      {
        id: "text",
        label: "Body text",
        type: "textarea",
        placeholder: "Stop competing on *fee*.\n\nStart competing on *outcome*.",
        required: true,
        help: "Wrap highlight words in *asterisks* to render them brand-yellow italic",
      },
      {
        id: "cta",
        label: "Call to action",
        type: "text",
        defaultValue: "Comment a word below",
      },
    ],
    postProcess: [
      { kind: "corner-patch", size: 0.06, sampleOffset: 4 },
      { kind: "black-border", margin: 0.12 },
    ],
    buildPrompt(inputs) {
      const { clean, highlights } = parseHighlights(String(inputs.text));
      const highlightClause = highlights.length
        ? `The following keywords MUST be rendered in vibrant brand-yellow ` +
          `(${BRAND_YELLOW}), italicized, same weight and size as the surrounding ` +
          `text — every other word stays crisp white: ` +
          highlights.map((h) => `'${h}'`).join(", ") +
          `. `
        : "";
      const cta = String(inputs.cta || "Comment a word below");
      return (
        "A minimalist, high-contrast social media announcement graphic with a " +
        "solid pitch-black background (#000000). The layout features centered, " +
        "professional clean sans-serif typography (Arial / Helvetica style). " +
        "CRITICAL LAYOUT RULE — leave thick black empty margins on every side: " +
        "minimum 18% of the canvas width on the LEFT and RIGHT, and minimum " +
        "18% of the canvas height on the TOP and BOTTOM. All visible content " +
        "(body text + CTA) must sit inside the central ~64% of the canvas, " +
        "well clear of every edge. Picture a large square frame of pure black " +
        "around the entire composition — that frame is non-negotiable. " +
        "The text size should be MODEST, not oversized — sized to fit inside " +
        "that central safe zone with comfortable empty space above the first " +
        "line and below the CTA. " +
        "The primary body text is crisp white, arranged in short, punchy " +
        "paragraphs with AMPLE line spacing between paragraphs. " +
        highlightClause +
        "Body text content (render exactly, preserve the line breaks shown):\n\n" +
        `${clean}\n\n` +
        "Then, with a clear gap below the body (still inside the central safe " +
        `zone), a call-to-action reads '${cta}' in white sans-serif, ` +
        "accompanied by a downward-pointing arrow in vibrant brand blue " +
        `(${BRAND_BLUE}) (either a filled blue down-arrow icon or the standard ` +
        "blue ⬇ emoji) placed immediately after the CTA text on the same line. " +
        "The overall feel is airy, spacious, mobile-optimised, modern, " +
        "high-contrast. Final image must be square (1:1). No logos, no " +
        "decorative elements, no extra text — just the centered body, the " +
        "highlighted keywords, and the bottom CTA, framed by a thick black " +
        "border of empty space on every side."
      );
    },
  },
  {
    id: "twitter-post",
    name: "X / Twitter Post",
    description: "Clean white quote card styled as an X post from Greg Wilkes",
    model: "gemini-3.1-flash-image-preview",
    referenceImages: ["image-skills/greg-photo.jpg"],
    inputs: [
      {
        id: "text",
        label: "Tweet text",
        type: "textarea",
        placeholder: "Most builders don't have a sales problem.\n\nThey have a pricing problem.",
        required: true,
      },
      {
        id: "displayName",
        label: "Display name",
        type: "text",
        defaultValue: "Greg Wilkes",
      },
      {
        id: "handle",
        label: "Handle",
        type: "text",
        defaultValue: "@greg.wilkes.coach",
      },
    ],
    postProcess: [{ kind: "corner-patch", size: 0.06, sampleOffset: 4 }],
    buildPrompt(inputs) {
      return (
        "A high-quality social media graphic in the style of a clean, minimalist " +
        "Twitter/X post. The background is a solid, crisp white. " +
        "VERY IMPORTANT — leave generous white empty margins of at least 15% of " +
        "the canvas width on all four sides (top, bottom, left, right). The " +
        "entire post composition (header + tweet body) should sit in the middle " +
        "~70% of the canvas, never touching the edges. Keep the header and tweet " +
        "text visually small relative to the canvas, with lots of white space " +
        "around them — this is a spacious quote card, not a screenshot. " +
        "At the top of the composition, on the left, there is a small circular " +
        "profile picture of the man shown in the reference photo — use EXACTLY " +
        "this person's face, hair, and clothing, cropped to a tight " +
        "head-and-shoulders circle (do not invent a different person). " +
        `Next to the photo, the name '${inputs.displayName || "Greg Wilkes"}' is written in a ` +
        "medium-weight bold black sans-serif font (modest size, not oversized), " +
        "accompanied by an X-style blue verified checkmark (solid filled blue " +
        "circle with a white tick inside, sitting just to the right of the name). " +
        `Below the name, the handle '${inputs.handle || "@greg.wilkes.coach"}' appears in a smaller, lighter ` +
        "grey sans-serif font. Below the header, with comfortable spacing, the " +
        "main body of the image features centered, easy-to-read black sans-serif " +
        "text at a moderate size (NOT giant — leave clear empty white space " +
        "above, below, and to the sides) that says:\n\n" +
        `'${inputs.text}'\n\n` +
        "The overall feel is spacious, airy, modern, high-contrast. Final image " +
        "must be square (1:1). No X logo, no like/retweet/reply icons, no " +
        "timestamp — just the header row (pfp + name + tick + handle) and the " +
        "centered tweet body on white, with thick white margins framing it all."
      );
    },
  },
  {
    id: "freestyle-image",
    name: "Freestyle",
    description: "Any style from a custom prompt — infographic, poster, photo composite",
    model: "gemini-3.1-flash-image-preview",
    referenceImages: [],
    inputs: [
      {
        id: "prompt",
        label: "Image prompt",
        type: "textarea",
        placeholder: "A modern infographic showing the 5 stages of scaling a construction business...",
        required: true,
      },
    ],
    postProcess: [{ kind: "corner-patch", size: 0.05, sampleOffset: 3 }],
    buildPrompt(inputs) {
      return String(inputs.prompt);
    },
  },
];

export function getImageSkill(id: string): ImageSkill | undefined {
  return IMAGE_SKILLS.find((s) => s.id === id);
}
