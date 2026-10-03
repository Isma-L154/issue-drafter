/** @typedef {{ code: boolean, text: string }} Inline */
/** @typedef {{ checked: boolean | null, text: string }} ListItem `checked` is null for a plain item. */
/** @typedef {{ kind: "list", ordered: boolean, items: ListItem[] }} List */
/** @typedef {{ kind: "paragraph", text: string }} Paragraph */
/** @typedef {{ kind: "heading", text: string } | Paragraph | List} Block */

/**
 * @param {string} text
 * @returns {Inline[]}
 */
export function splitInline(text) {
  return text
    .split("`")
    .map((part, i) => ({ code: i % 2 === 1, text: part }))
    .filter((part) => part.text !== "");
}

// The subset of Markdown the templates produce: headings, paragraphs, bullet,
// numbered and checkbox lists.
/**
 * @param {string} markdown
 * @returns {Block[]}
 */
export function parseMarkdown(markdown) {
  /** @type {Block[]} */
  const blocks = [];
  // A blank line or a heading closes the block before it.
  let open = false;

  for (const line of markdown.split("\n")) {
    const text = line.trim();
    const last = open ? blocks.at(-1) : undefined;
    const heading = text.match(/^#{1,6}\s+(.+)$/)?.[1];
    const item = text.match(/^(?:[-*]|(\d+)\.)\s+(?:\[([ xX])\]\s+)?(.+)$/);

    if (text === "") {
      open = false;
    } else if (heading !== undefined) {
      blocks.push({ kind: "heading", text: heading });
      open = false;
    } else if (item) {
      const [, number, box, content = ""] = item;
      const ordered = number !== undefined;
      const entry = { checked: box === undefined ? null : box.toLowerCase() === "x", text: content };
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(entry);
      else blocks.push({ kind: "list", ordered, items: [entry] });
      open = true;
    } else {
      if (last?.kind === "paragraph") last.text += ` ${text}`;
      else blocks.push({ kind: "paragraph", text });
      open = true;
    }
  }
  return blocks;
}
