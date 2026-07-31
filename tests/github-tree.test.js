import { describe, it, expect } from 'vitest';
import { buildTree } from '../src/renderer/github-tree.js';

const entry = (path, type = 'blob', sha = 'sha-' + path) => ({ path, type, sha });

describe('buildTree', () => {
  it('nests files under their directories', () => {
    const tree = buildTree([
      entry('content/posts/hello.md'),
      entry('content/posts', 'tree'),
      entry('content', 'tree'),
    ]);
    expect(tree).toEqual([{
      type: 'dir',
      name: 'content',
      path: 'content',
      children: [{
        type: 'dir',
        name: 'posts',
        path: 'content/posts',
        children: [{
          type: 'file',
          name: 'hello.md',
          path: 'content/posts/hello.md',
          sha: 'sha-content/posts/hello.md',
        }],
      }],
    }]);
  });

  it('keeps only markdown files', () => {
    const tree = buildTree([
      entry('README.md'),
      entry('notes.markdown'),
      entry('logo.png'),
      entry('index.html'),
    ]);
    // Sorted case-insensitively, so "notes.markdown" precedes "README.md".
    expect(tree.map((n) => n.name)).toEqual(['notes.markdown', 'README.md']);
  });

  it('drops directories with no markdown inside', () => {
    const tree = buildTree([
      entry('static', 'tree'),
      entry('static/logo.png'),
      entry('posts/a.md'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['posts']);
  });

  it('sorts directories before files, each alphabetically and case-insensitively', () => {
    const tree = buildTree([
      entry('zebra.md'),
      entry('Apple.md'),
      entry('drafts/x.md'),
      entry('Blog/y.md'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Blog', 'drafts', 'Apple.md', 'zebra.md']);
  });

  it('handles an empty listing', () => {
    expect(buildTree([])).toEqual([]);
  });
});
