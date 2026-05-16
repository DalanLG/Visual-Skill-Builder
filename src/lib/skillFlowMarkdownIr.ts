export type SkillMarkdownIrSection = {
  id: string;
  depth: number;
  title: string;
  text: string;
  bullets: string[];
  codeLanguages: string[];
  startLine: number;
  endLine: number;
  blockIds: string[];
};

export type SkillMarkdownIrBlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'code_fence'
  | 'table'
  | 'html_block'
  | 'reference_def';

export type SkillMarkdownIrBlock = {
  id: string;
  type: SkillMarkdownIrBlockType;
  depth?: number;
  title?: string;
  language?: string;
  text: string;
  startLine: number;
  endLine: number;
  sectionId: string;
};

export type SkillMarkdownSemanticCandidates = {
  steps: string[];
  artifacts: string[];
  constraints: string[];
  guardrails: string[];
  examples: string[];
  responseHints: string[];
  ambiguities: Array<{ sectionId: string; reason: string; excerpt: string }>;
};

export type SkillMarkdownIr = {
  title?: string;
  description?: string;
  frontmatter: Record<string, string>;
  sections: SkillMarkdownIrSection[];
  blocks: SkillMarkdownIrBlock[];
  sectionOutline: Array<{ id: string; depth: number; title: string; startLine: number; endLine: number }>;
  links: Array<{ label: string; href: string }>;
  images: Array<{ alt: string; src: string }>;
  referenceDefinitions: Array<{ label: string; href: string; title?: string }>;
  candidates: SkillMarkdownSemanticCandidates;
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

function slugPart(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function blockId(index: number): string {
  return `block_${String(index + 1).padStart(4, '0')}`;
}

function sectionId(index: number, title: string): string {
  return `section_${String(index + 1).padStart(3, '0')}_${slugPart(title, 'document')}`;
}

function candidateMatches(pattern: RegExp, sections: SkillMarkdownIrSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    const hay = `${s.title}\n${s.text}`;
    if (pattern.test(hay)) out.push(`${s.title}: ${s.text.slice(0, 500).replace(/\s+/g, ' ').trim()}`);
    for (const bullet of s.bullets) {
      if (pattern.test(bullet)) out.push(`${s.title}: ${bullet}`);
    }
  }
  return [...new Set(out)].slice(0, 40);
}

function buildCandidates(sections: SkillMarkdownIrSection[], blocks: SkillMarkdownIrBlock[]): SkillMarkdownSemanticCandidates {
  const steps = candidateMatches(/\b(step|phase|stage|workflow|procedure|then|next|run|execute|create|write|save|export|import)\b/i, sections);
  const artifacts = candidateMatches(/\b(file|path|artifact|variable|report|draft|notes|dataset|schema|json|markdown|output|result)\b/i, sections);
  const constraints = candidateMatches(/\b(must|must not|required|only|never|always|limit|constraint|rule)\b/i, sections);
  const guardrails = candidateMatches(/\b(guardrail|safety|avoid|forbidden|approval|failure|fallback|rollback|validate|verify|check)\b/i, sections);
  const examples = blocks
    .filter((b) => b.type === 'code_fence' || /\b(example|sample)\b/i.test(`${b.title ?? ''} ${b.text}`))
    .map((b) => `${b.sectionId}: ${b.text.slice(0, 500).replace(/\s+/g, ' ').trim()}`)
    .filter(Boolean)
    .slice(0, 30);
  const responseHints = candidateMatches(/\b(final response|final answer|reply|respond|summary|tell the user|return to the user)\b/i, sections);
  const ambiguities = sections
    .filter((s) => /\b(tbd|todo|maybe|unclear|open question|not specified|ambiguous)\b/i.test(`${s.title}\n${s.text}`))
    .map((s) => ({
      sectionId: s.id,
      reason: 'Section contains unresolved or ambiguous language.',
      excerpt: s.text.slice(0, 700),
    }))
    .slice(0, 20);
  return { steps, artifacts, constraints, guardrails, examples, responseHints, ambiguities };
}

export function parseSkillMarkdownToIr(markdown: string): SkillMarkdownIr {
  const { frontmatter, body } = parseSimpleYamlFrontmatter(markdown);
  const sections: SkillMarkdownIrSection[] = [];
  const blocks: SkillMarkdownIrBlock[] = [];
  const links: SkillMarkdownIr['links'] = [];
  const images: SkillMarkdownIr['images'] = [];
  const referenceDefinitions: SkillMarkdownIr['referenceDefinitions'] = [];
  let current: { id: string; depth: number; title: string; lines: string[]; bullets: string[]; codeLanguages: string[]; startLine: number; blockIds: string[] } | null = null;
  let pendingParagraph: { lines: string[]; startLine: number } | null = null;
  let pendingList: { lines: string[]; startLine: number } | null = null;
  let pendingTable: { lines: string[]; startLine: number } | null = null;
  let pendingFence: { lines: string[]; startLine: number; language?: string } | null = null;
  let inFence = false;
  let codeBlockCount = 0;

  const ensureCurrent = (lineNo: number) => {
    if (!current) {
      current = { id: sectionId(0, 'Document'), depth: 1, title: 'Document', lines: [], bullets: [], codeLanguages: [], startLine: lineNo, blockIds: [] };
    }
  };

  const pushBlock = (type: SkillMarkdownIrBlockType, lines: string[], startLine: number, endLine: number, extra?: Partial<SkillMarkdownIrBlock>) => {
    ensureCurrent(startLine);
    const id = blockId(blocks.length);
    blocks.push({
      id,
      type,
      text: lines.join('\n').trim(),
      startLine,
      endLine,
      sectionId: current!.id,
      ...extra,
    });
    current!.blockIds.push(id);
  };

  const flushParagraph = (endLine: number) => {
    if (!pendingParagraph) return;
    pushBlock('paragraph', pendingParagraph.lines, pendingParagraph.startLine, endLine);
    pendingParagraph = null;
  };

  const flushList = (endLine: number) => {
    if (!pendingList) return;
    pushBlock('list', pendingList.lines, pendingList.startLine, endLine);
    pendingList = null;
  };

  const flushTable = (endLine: number) => {
    if (!pendingTable) return;
    pushBlock('table', pendingTable.lines, pendingTable.startLine, endLine);
    pendingTable = null;
  };

  const flushLoose = (endLine: number) => {
    flushParagraph(endLine);
    flushList(endLine);
    flushTable(endLine);
  };

  const pushSection = (endLine: number) => {
    if (!current) return;
    sections.push({
      id: current.id,
      depth: current.depth,
      title: current.title,
      text: compactText(current.lines),
      bullets: current.bullets,
      codeLanguages: current.codeLanguages,
      startLine: current.startLine,
      endLine,
      blockIds: current.blockIds,
    });
  };

  const bodyLines = body.split(/\r?\n/);
  for (let i = 0; i < bodyLines.length; i++) {
    const rawLine = bodyLines[i]!;
    const lineNo = i + 1;
    const fence = /^```([A-Za-z0-9_-]+)?/.exec(rawLine.trim());
    if (fence) {
      if (!inFence) flushLoose(lineNo - 1);
      inFence = !inFence;
      if (inFence) {
        codeBlockCount += 1;
        ensureCurrent(lineNo);
        if (fence[1]) current!.codeLanguages.push(fence[1]);
        pendingFence = { lines: [rawLine], startLine: lineNo, language: fence[1] };
        current!.lines.push(rawLine);
        continue;
      }
      if (pendingFence) {
        pendingFence.lines.push(rawLine);
        pushBlock('code_fence', pendingFence.lines, pendingFence.startLine, lineNo, { language: pendingFence.language });
        pendingFence = null;
      }
      current?.lines.push(rawLine);
      continue;
    }

    if (inFence) {
      pendingFence?.lines.push(rawLine);
      current?.lines.push(rawLine);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(rawLine);
    if (heading) {
      flushLoose(lineNo - 1);
      pushSection(lineNo - 1);
      current = {
        id: sectionId(sections.length, heading[2].trim()),
        depth: heading[1].length,
        title: heading[2].trim(),
        lines: [],
        bullets: [],
        codeLanguages: [],
        startLine: lineNo,
        blockIds: [],
      };
      pushBlock('heading', [rawLine], lineNo, lineNo, { depth: heading[1].length, title: heading[2].trim() });
      continue;
    }

    ensureCurrent(lineNo);
    current!.lines.push(rawLine);

    const reference = /^\s*\[([^\]]+)\]:\s+(\S+)(?:\s+["']([^"']+)["'])?\s*$/.exec(rawLine);
    if (reference) {
      flushLoose(lineNo - 1);
      referenceDefinitions.push({ label: reference[1], href: reference[2], ...(reference[3] ? { title: reference[3] } : {}) });
      pushBlock('reference_def', [rawLine], lineNo, lineNo);
      continue;
    }

    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(rawLine);
    if (bullet) {
      flushParagraph(lineNo - 1);
      flushTable(lineNo - 1);
      if (!pendingList) pendingList = { lines: [], startLine: lineNo };
      pendingList.lines.push(rawLine);
      current!.bullets.push(bullet[1].trim());
    } else if (/^\s*\|.+\|\s*$/.test(rawLine)) {
      flushParagraph(lineNo - 1);
      flushList(lineNo - 1);
      if (!pendingTable) pendingTable = { lines: [], startLine: lineNo };
      pendingTable.lines.push(rawLine);
    } else if (/^\s*<[^>]+>/.test(rawLine)) {
      flushLoose(lineNo - 1);
      pushBlock('html_block', [rawLine], lineNo, lineNo);
    } else if (rawLine.trim()) {
      flushList(lineNo - 1);
      flushTable(lineNo - 1);
      if (!pendingParagraph) pendingParagraph = { lines: [], startLine: lineNo };
      pendingParagraph.lines.push(rawLine);
    } else {
      flushLoose(lineNo - 1);
    }

    for (const img of rawLine.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      images.push({ alt: img[1], src: img[2] });
    }
    for (const link of rawLine.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
      links.push({ label: link[1], href: link[2] });
    }
  }
  flushLoose(bodyLines.length);
  pushSection(bodyLines.length);

  const firstHeading = sections.find((s) => s.title && s.title !== 'Document')?.title;
  const title = frontmatter.name || frontmatter.title || firstHeading;
  const description =
    frontmatter.description ||
    sections.find((s) => s.text && s.title !== title)?.text.split(/\n\n/)[0]?.slice(0, 500);

  const sectionOutline = sections.map((s) => ({
    id: s.id,
    depth: s.depth,
    title: s.title,
    startLine: s.startLine,
    endLine: s.endLine,
  }));
  const candidates = buildCandidates(sections, blocks);

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    frontmatter,
    sections,
    blocks,
    sectionOutline,
    links,
    images,
    referenceDefinitions,
    candidates,
    codeBlockCount,
  };
}

export function skillMarkdownIrToPromptJson(ir: SkillMarkdownIr): string {
  return JSON.stringify(
    {
      title: ir.title,
      description: ir.description,
      frontmatter: ir.frontmatter,
      sectionOutline: ir.sectionOutline.slice(0, 120),
      sections: ir.sections.slice(0, 80),
      blocks: ir.blocks.slice(0, 220),
      links: ir.links.slice(0, 60),
      images: ir.images.slice(0, 30),
      referenceDefinitions: ir.referenceDefinitions.slice(0, 60),
      candidateSemantics: ir.candidates,
      codeBlockCount: ir.codeBlockCount,
    },
    null,
    2,
  );
}
