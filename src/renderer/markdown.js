import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: true, linkify: true })
  .use(footnote)
  .use(taskLists, { enabled: true })
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { throwOnError: false },
  });

const defaultValidateLink = md.validateLink.bind(md);
md.validateLink = (url) => url.startsWith('file:') || defaultValidateLink(url);

export function renderMarkdown(source) {
  return DOMPurify.sanitize(md.render(source), {
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['encoding'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|file):|application\/x-tex$|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}
