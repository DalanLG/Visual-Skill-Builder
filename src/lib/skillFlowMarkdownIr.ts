export type SkillMarkdownIrSection = {
  depth: number;
  title: string;
  text: string;
  bullets: string[];
  codeLanguages: string[];
};

export type SkillMarkdownIr = {
  title?: string;
  description?: string;
  frontmatter: Record<string, string>;
  sections: SkillMarkdownIrSection[];
  links: Array<{ label: string; href: string }>;
  images: Array<{ alt: string; src: string }>;
  codeBlockCount: number;
};

function parseSimpleYamlFrontmatter(markdown: string): { frontmatter: Record<string, string>; body: string } {
  const trimmedStart = markdown.replace(/^\uFEFF/, '');
  if (!trimmedStart.startsWith('---\n') && !trimmedStart.startsWith('---\r\n')) {
    return { frontmatter: {}, body: markdown };
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(trimmedStart);
  if (!match) return { frontmatter: {}, body: markdown };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    frontmatter[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { frontmatter, body: trimmedStart.slice(match[0].length) };
}

function compactText(lines: string[], max = 2800): string {
  const text = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function parseSkillMarkdownToIr(markdown: string): SkillMarkdownIr {
  const { frontmatter, body } = parseSimpleYamlFrontmatter(markdown);
  const sections: SkillMarkdownIrSection[] = [];
  const links: SkillMarkdownIr['links'] = [];
  const images: SkillMarkdownIr['images'] = [];
  let current: { depth: number; title: string; lines: string[]; bullets: string[]; codeLanguages: string[] } | null = null;
  let inFence = false;
  let codeBlockCount = 0;

  const push = () => {
    if (!current) return;
    sections.push({
      depth: current.depth,
      title: current.title,
      text: compactText(current.lines),
      bullets: current.bullets,
      codeLanguages: current.codeLanguages,
    });
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const fence = /^```([A-Za-z0-9_-]+)?/.exec(rawLine.trim());
    if (fence) {
      inFence = !inFence;
      if (inFence) {
        codeBlockCount += 1;
        if (!current) current = { depth: 1, title: 'Document', lines: [], bullets: [], codeLanguages: [] };
        if (fence[1]) current.codeLanguages.push(fence[1]);
      }
    }

    if (!inFence) {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(rawLine);
      if (heading) {
        push();
        current = {
          depth: heading[1].length,
          title: heading[2].trim(),
          lines: [],
          bullets: [],
          codeLanguages: [],
        };
        continue;
      }
    }

    if (!current) current = { depth: 1, title: 'Document', lines: [], bullets: [], codeLanguages: [] };
    current.lines.push(rawLine);

    if (!inFence) {
      const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(rawLine);
      if (bullet) current.bullets.push(bullet[1].trim());
      for (const img of rawLine.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
        images.push({ alt: img[1], src: img[2] });
      }
      for (const link of rawLine.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
        links.push({ label: link[1], href: link[2] });
      }
    }
  }
  push();

  const firstHeading = sections.find((s) => s.title && s.title !== 'Document')?.title;
  const title = frontmatter.name || frontmatter.title || firstHeading;
  const description =
    frontmatter.description ||
    sections.find((s) => s.text && s.title !== title)?.text.split(/\n\n/)[0]?.slice(0, 500);

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    frontmatter,
    sections,
    links,
    images,
    codeBlockCount,
  };
}

export function skillMarkdownIrToPromptJson(ir: SkillMarkdownIr): string {
  return JSON.stringify(
    {
      title: ir.title,
      description: ir.description,
      frontmatter: ir.frontmatter,
      sections: ir.sections.slice(0, 80),
      links: ir.links.slice(0, 60),
      images: ir.images.slice(0, 30),
      codeBlockCount: ir.codeBlockCount,
    },
    null,
    2,
  );
}
