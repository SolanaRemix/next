import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

export function normalizeZodRecordSchemas(source) {
  const sourceFile = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true);
  const insertions = [];

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === 'z'
      && node.expression.name.text === 'record'
      && node.arguments.length === 1
    ) {
      insertions.push(node.arguments[0].getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return insertions
    .sort((left, right) => right - left)
    .reduce(
      (normalized, position) => `${normalized.slice(0, position)}z.string(), ${normalized.slice(position)}`,
      source,
    );
}

if (process.argv[2]) {
  const path = process.argv[2];
  writeFileSync(path, normalizeZodRecordSchemas(readFileSync(path, 'utf8')));
}
