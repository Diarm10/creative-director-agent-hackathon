// Headlines and sublines may only name a colour, material or part of the product that can be seen in the image. A fact
// the shop typed ("terracotta-coloured pot") is not proof it is in the picture: SAM may have cut the pot away. This
// is the plain word check; the critic then looks at the finished picture as well. Pure, no model call.

// Each group is one idea with its spellings. A group is "named" when any spelling is in the copy.
const GROUPS: readonly (readonly string[])[] = [
  // colours
  ["red", "crimson", "scarlet"], ["orange"], ["yellow", "mustard"], ["green", "olive", "sage"], ["blue", "navy"], ["purple", "violet"], ["pink"], ["brown", "tan"],
  ["black", "dark"], ["white", "ivory", "cream"], ["grey", "gray", "charcoal"], ["silver"], ["gold", "golden"], ["beige"], ["terracotta", "clay"], ["copper", "bronze"], ["teal"],
  // materials
  ["wood", "wooden", "oak", "pine", "timber"], ["ceramic", "porcelain"], ["glass"], ["steel", "stainless"], ["metal", "metallic", "iron"], ["brass"], ["leather"], ["jute"],
  ["cotton"], ["linen"], ["wool", "woollen"], ["plastic"], ["concrete"], ["marble"], ["stone"], ["rattan", "wicker"], ["bamboo"], ["paper"], ["canvas"], ["woven", "weave"],
  ["velvet"], ["silk"], ["denim"],
  // parts and objects
  ["pot", "planter"], ["saucer"], ["lid"], ["handle", "handles"], ["strap", "straps"], ["rope"], ["shade"], ["wire"], ["tray"], ["vase", "vases"], ["candle"], ["zip", "zipper"],
  ["cap"], ["legs", "leg"], ["seat"], ["leaves", "leaf"], ["stripes", "striped", "stripe"], ["spots", "spotted"],
];

const tokens = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean));

/** The first spelling of every group named in the text. */
function named(text: string): string[] {
  const t = tokens(text);
  return GROUPS.filter((g) => g.some((w) => t.has(w))).map((g) => g[0]);
}

/**
 * The colour, material and part words in `copy` that the `visible` text does not mention in any spelling. `visible` is
 * what was seen in the product image: its description, the visible terms and the product's own name. Empty when
 * nothing is claimed that cannot be seen. When `visible` is empty nothing can be checked, so nothing is flagged.
 */
export function unseenTerms(copy: string, visible: string): string[] {
  if (!visible.trim()) return [];
  const seen = new Set(named(visible));
  return named(copy).filter((g) => !seen.has(g));
}
