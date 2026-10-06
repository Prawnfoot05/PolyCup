import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// Legacy race fixtures inject peer failures and clock state directly. Add accessors
// only to this disposable test copy; production keeps native private fields.
const output = '.research/test-src';
await mkdir(output, { recursive: true });
for (const name of await readdir('src')) {
  if (!name.endsWith('.ts')) continue;
  const source = await readFile(`src/${name}`, 'utf8');
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const insertions = [];
  for (const node of tree.statements) {
    if (!ts.isClassDeclaration(node)) continue;
    const fields = node.members.filter(ts.isPropertyDeclaration)
      .filter(field => ts.isPrivateIdentifier(field.name));
    const getters = new Set(node.members.filter(ts.isGetAccessor).map(m => m.name.getText(tree)));
    const setters = new Set(node.members.filter(ts.isSetAccessor).map(m => m.name.getText(tree)));
    const accessors = fields.flatMap(field => {
      const key = field.name.text.slice(1), result = [];
      if (!getters.has(key)) result.push(`get ${key}() { return this.#${key}; }`);
      if (!setters.has(key)) result.push(`set ${key}(value) { this.#${key} = value; }`);
      return result;
    });
    insertions.push({ at: node.members.pos, text: '\n' + accessors.join('\n') + '\n' });
  }
  let instrumented = source;
  for (const { at, text } of insertions.reverse()) {
    instrumented = instrumented.slice(0, at) + text + instrumented.slice(at);
  }
  await writeFile(`${output}/${name}`, instrumented);
}
