import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(root, 'openapi/openapi.yaml');
const generatedPath = join(root, 'packages/api-client/src/generated.ts');
const spec = parse(readFileSync(specPath, 'utf8'));
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const routeMethods = new Set([...httpMethods].map((method) => method[0].toUpperCase() + method.slice(1)));
const documentedRoutes = new Set();
const operationIds = new Set();
const routeRoles = new Map();

if (!spec || !String(spec.openapi).startsWith('3.1.') || !spec.paths) {
  throw new Error('OpenAPI contract must define an OpenAPI 3.1 document with paths.');
}

for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!httpMethods.has(method)) continue;
    if (!operation.operationId || operationIds.has(operation.operationId)) {
      throw new Error(`Every operation needs a unique operationId: ${method.toUpperCase()} ${path}`);
    }
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      throw new Error(`Operation has no response contract: ${method.toUpperCase()} ${path}`);
    }
    if (typeof operation['x-minimum-role'] !== 'string') {
      throw new Error(`Operation has no x-minimum-role: ${method.toUpperCase()} ${path}`);
    }
    operationIds.add(operation.operationId);
    const route = `${method.toUpperCase()} ${path}`;
    const security = Object.hasOwn(operation, 'security') ? operation.security : spec.security;
    if ((operation['x-minimum-role'] === 'Public') !== (Array.isArray(security) && security.length === 0)) {
      throw new Error(`OpenAPI security does not match x-minimum-role: ${route}`);
    }
    documentedRoutes.add(route);
    routeRoles.set(route, operation['x-minimum-role']);
  }
}

function decoratorCall(node) {
  if (!ts.isCallExpression(node.expression)) return null;
  const expression = node.expression.expression;
  const name = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : null;
  return { name, args: node.expression.arguments };
}

function staticPath(call, filePath, decoratorName) {
  const argument = call?.args[0];
  if (!argument) return '';
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  throw new Error(`Non-static @${decoratorName} route in ${relative(root, filePath)}.`);
}

function accessFrom(decorators, inheritedRole = 'Guest') {
  const calls = decorators.map(decoratorCall);
  if (calls.some((call) => call?.name === 'Public')) return 'Public';
  const roleCall = calls.find((call) => call?.name === 'Roles');
  if (!roleCall) return inheritedRole;
  const roles = roleCall.args.filter(
    (argument) => ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument),
  ).map((argument) => argument.text);
  const roleRanks = ['Guest', 'Viewer', 'Trader', 'EnterpriseAdmin', 'SuperAdmin'];
  const minimumRole = roles.sort((left, right) => roleRanks.indexOf(left) - roleRanks.indexOf(right))[0];
  if (!minimumRole) throw new Error('@Roles must have at least one static role argument.');
  return minimumRole;
}

function collectControllerFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectControllerFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.controller.ts') ? [entryPath] : [];
  });
}

const implementedRoutes = new Set();
for (const filePath of collectControllerFiles(join(root, 'apps/api/src'))) {
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const decorators = ts.canHaveDecorators(statement) ? ts.getDecorators(statement) ?? [] : [];
    const controllerDecorator = decorators
      .map(decoratorCall)
      .find((call) => call?.name === 'Controller');
    if (!controllerDecorator) continue;
    const controllerPath = staticPath(controllerDecorator, filePath, 'Controller');
    const controllerRole = accessFrom(decorators);
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const methodDecorators = ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : [];
      for (const decorator of methodDecorators) {
        const call = decoratorCall(decorator);
        if (!call || !routeMethods.has(call.name)) continue;
        const method = call.name.toUpperCase();
        const routePath = staticPath(call, filePath, call.name)
          .replace(/^\/+|\/+$/g, '')
          .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        const combinedPath = [controllerPath, routePath].filter(Boolean).join('/');
        const route = `${method} /${combinedPath}`;
        if (implementedRoutes.has(route)) throw new Error(`Duplicate runtime route: ${route}`);
        implementedRoutes.add(route);
        routeRoles.set(`${route}#runtime`, accessFrom(methodDecorators, controllerRole));
      }
    }
  }
}

const undocumented = [...implementedRoutes].filter((route) => !documentedRoutes.has(route)).sort();
const stale = [...documentedRoutes].filter((route) => !implementedRoutes.has(route)).sort();
const roleMismatches = [...documentedRoutes].filter(
  (route) => routeRoles.get(route) !== routeRoles.get(`${route}#runtime`),
).sort();
if (undocumented.length > 0 || stale.length > 0 || roleMismatches.length > 0) {
  throw new Error([
    'OpenAPI route parity check failed.',
    ...(undocumented.length > 0 ? [`Undocumented runtime routes:\n${undocumented.join('\n')}`] : []),
    ...(stale.length > 0 ? [`Contract routes missing at runtime:\n${stale.join('\n')}`] : []),
    ...(roleMismatches.length > 0
      ? [`Minimum-role contract mismatches:\n${roleMismatches.map((route) =>
        `${route}: contract=${routeRoles.get(route)}, runtime=${routeRoles.get(`${route}#runtime`)}`).join('\n')}`]
      : []),
  ].join('\n\n'));
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'next-openapi-'));
try {
  const generatedOutput = join(temporaryDirectory, 'generated.ts');
  execFileSync(
    join(root, 'node_modules/.bin/openapi-zod-client'),
    [
      specPath,
      '--output',
      generatedOutput,
      '--with-alias',
      '--export-schemas',
      '--default-status',
      'auto-correct',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (readFileSync(generatedOutput, 'utf8') !== readFileSync(generatedPath, 'utf8')) {
    throw new Error('Generated API client is stale. Run `npm run openapi:generate` and commit the result.');
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`OpenAPI contract covers all ${implementedRoutes.size} runtime API operations.`);
