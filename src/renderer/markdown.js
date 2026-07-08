import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: true, linkify: true })
  .use(footnote)
  .use(taskLists)
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { throwOnError: false },
  });

export function renderMarkdown(source) {
  return DOMPurify.sanitize(md.render(source));
}
