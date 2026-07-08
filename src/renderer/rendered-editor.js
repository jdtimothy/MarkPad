function escapeMarkdown(text) {
  return text.replace(/([\\`*_{}\[\]()#!|>])/g, '\\$1');
}

function cleanText(text) {
  return text.replace(/\u00a0/g, ' ');
}

function inlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(cleanText(node.textContent));
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '\n';
  if (tag === 'img') return `![${escapeMarkdown(node.alt || 'image')}](${node.getAttribute('src') || ''})`;

  const inner = Array.from(node.childNodes).map(inlineMarkdown).join('');
  if (!inner && tag !== 'a') return '';

  if (tag === 'strong' || tag === 'b') return `**${inner}**`;
  if (tag === 'em' || tag === 'i') return `*${inner}*`;
  if (tag === 's' || tag === 'strike' || tag === 'del') return `~~${inner}~~`;
  if (tag === 'code') return `\`${cleanText(node.textContent || '')}\``;
  if (tag === 'a') return `[${inner || 'link'}](${node.getAttribute('href') || ''})`;
  return inner;
}

function isBlockElement(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return [
    'blockquote',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'ol',
    'p',
    'pre',
    'table',
    'ul',
  ].includes(node.tagName.toLowerCase());
}

function listItemMarkdown(item, index, ordered) {
  const marker = ordered ? `${index + 1}. ` : '- ';
  const checkbox = item.querySelector(':scope > input[type="checkbox"]');
  const task = checkbox ? `[${checkbox.checked ? 'x' : ' '}] ` : '';
  const lines = [];
  let inline = '';

  for (const child of item.childNodes) {
    if (child === checkbox) continue;
    if (isBlockElement(child)) {
      if (inline.trim()) {
        lines.push(inline.trim());
        inline = '';
      }
      const block = blockMarkdown(child);
      if (block) lines.push(block);
    } else {
      inline += inlineMarkdown(child);
    }
  }

  if (inline.trim()) lines.push(inline.trim());
  if (!lines.length) lines.push('');

  const [first, ...rest] = lines.join('\n').split('\n');
  const continuation = rest
    .map((line) => line ? `  ${line}` : '')
    .join('\n');
  return `${marker}${task}${first}${continuation ? `\n${continuation}` : ''}`;
}

function tableMarkdown(table) {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).map((cell) => inlineMarkdown(cell).trim())
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push('');
    return next;
  });
  const header = normalized[0];
  const divider = Array.from({ length: width }, () => '---');
  const body = normalized.slice(1);
  return [header, divider, ...body]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

function codeText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '\n';

  const text = Array.from(node.childNodes).map(codeText).join('');
  if (['div', 'p', 'li'].includes(tag)) return `${text}\n`;
  return text;
}

function blockMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return inlineMarkdown(node).trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineMarkdown(node).trim()}`;
  if (tag === 'p' || tag === 'div') {
    return Array.from(node.childNodes).some(isBlockElement)
      ? nodesMarkdown(node.childNodes)
      : inlineMarkdown(node).trim();
  }
  if (tag === 'blockquote') {
    return htmlToMarkdown(node).split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
  }
  if (tag === 'pre') {
    const codeNode = node.querySelector('code') || node;
    const code = codeText(codeNode);
    return `\`\`\`\n${code.replace(/\n$/, '')}\n\`\`\``;
  }
  if (tag === 'ul' || tag === 'ol') {
    const ordered = tag === 'ol';
    return Array.from(node.children)
      .filter((child) => child.tagName?.toLowerCase() === 'li')
      .map((item, index) => listItemMarkdown(item, index, ordered))
      .join('\n');
  }
  if (tag === 'hr') return '---';
  if (tag === 'table') return tableMarkdown(node);
  return inlineMarkdown(node).trim();
}

function nodesMarkdown(nodes) {
  const blocks = [];
  let inline = '';

  function flushInline() {
    const text = inline.trim();
    if (text) blocks.push(text);
    inline = '';
  }

  for (const child of nodes) {
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'br') {
      flushInline();
      continue;
    }

    if (isBlockElement(child)) {
      flushInline();
      const block = blockMarkdown(child);
      if (block) blocks.push(block);
      continue;
    }

    inline += inlineMarkdown(child);
  }

  flushInline();
  return blocks
    .filter((block) => block.length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export function htmlToMarkdown(root) {
  return nodesMarkdown(root.childNodes);
}
