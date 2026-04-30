#!/usr/bin/env node
/**
 * 自动提取代码库中的 LLM 提示词，生成 docs/PROMPTS.md。
 *
 * 提取规则：
 * 1. const XXX_PROMPT = `...`  → system prompt
 * 2. function buildXxxPrompt() { return `...`; }  → system prompt
 * 3. property `system` = `...`  → system prompt（API 调用中）
 * 4. property `description` in tool object → tool definition
 *
 * 运行：npx tsx scripts/extract-prompts.ts
 */

import * as ts from 'typescript';
import { readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['lib', 'app/api'];
const OUTPUT = join(ROOT, 'docs', 'PROMPTS.md');

interface PromptEntry {
  id: string;
  file: string;
  line: number;
  name: string;
  type: 'system' | 'user-template' | 'tool-definition' | 'context-assembler';
  trigger: string;
  content: string;
  hasInterpolation: boolean;
}

/** 递归收集 .ts 文件（排除测试和 node_modules） */
function collectTsFiles(dir: string, files: string[] = []): string[] {
  const { readdirSync, statSync } = require('fs');
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.endsWith('.test.ts')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsFiles(full, files);
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** 提取模板字符串、普通字符串或条件表达式两侧的字符串 */
function extractString(node: ts.Node, sourceFile: ts.SourceFile): { text: string; hasInterpolation: boolean } | null {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return { text: node.text, hasInterpolation: false };
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      const exprText = span.expression.getText(sourceFile);
      text += `{${exprText}}` + span.literal.text;
    }
    return { text, hasInterpolation: true };
  }
  if (ts.isStringLiteral(node)) {
    return { text: node.text, hasInterpolation: false };
  }
  // 条件表达式：contextText ? `A` : `B`
  if (ts.isConditionalExpression(node)) {
    const whenTrue = extractString(node.whenTrue, sourceFile);
    const whenFalse = extractString(node.whenFalse, sourceFile);
    if (whenTrue && whenFalse) {
      return {
        text: `【条件为真时】\n${whenTrue.text}\n\n【条件为假时】\n${whenFalse.text}`,
        hasInterpolation: whenTrue.hasInterpolation || whenFalse.hasInterpolation,
      };
    }
    if (whenTrue) return whenTrue;
    if (whenFalse) return whenFalse;
  }
  return null;
}

/** 向上查找函数/方法/变量名，用于推断触发时机 */
function findEnclosingName(node: ts.Node, sourceFile: ts.SourceFile): string {
  let n: ts.Node | undefined = node;
  while (n) {
    if (ts.isFunctionDeclaration(n) && n.name) {
      return n.name.text;
    }
    if (ts.isMethodDeclaration(n) && n.name) {
      return n.name.getText(sourceFile);
    }
    if (ts.isArrowFunction(n)) {
      const parent = n.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
    }
    n = n.parent;
  }
  return '';
}

/** 查找最近的调用上下文（如 client.messages.create） */
function findCallContext(node: ts.Node, sourceFile: ts.SourceFile): string {
  let n: ts.Node | undefined = node;
  while (n) {
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      if (ts.isPropertyAccessExpression(expr)) {
        return expr.getText(sourceFile);
      }
      if (ts.isIdentifier(expr)) {
        return expr.text;
      }
    }
    n = n.parent;
  }
  return '';
}

/** 从文件中提取所有提示词 */
function extractFromFile(filePath: string): PromptEntry[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf-8'),
    ts.ScriptTarget.Latest,
    true
  );

  const entries: PromptEntry[] = [];
  function add(entry: Omit<PromptEntry, 'id'>) {
    const id = `p-${String(allEntries.length + entries.length + 1).padStart(3, '0')}`;
    entries.push({ ...entry, id });
  }

  function visit(node: ts.Node) {
    // ── 规则 1: const XXX = `...` where name suggests a prompt ──
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const name = node.name.text;
      const nameLower = name.toLowerCase();
      const isPromptLike =
        nameLower.includes('prompt') ||
        nameLower.includes('system') ||
        nameLower.includes('section') ||
        nameLower.includes('template');

      if (isPromptLike) {
        const extracted = extractString(node.initializer, sourceFile);
        if (extracted && extracted.text.length > 20) {
          add({
            file: relative(ROOT, filePath),
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            name,
            type: nameLower.includes('system') ? 'system' : 'system',
            trigger: inferTrigger(filePath, name, findEnclosingName(node, sourceFile)),
            content: extracted.text,
            hasInterpolation: extracted.hasInterpolation,
          });
        }
      }
    }

    // ── 规则 2: return `...` inside function buildXxxPrompt ──
    if (ts.isReturnStatement(node) && node.expression) {
      const extracted = extractString(node.expression, sourceFile);
      if (extracted) {
        const funcName = findEnclosingName(node, sourceFile);
        if (funcName.toLowerCase().includes('prompt')) {
          add({
            file: relative(ROOT, filePath),
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            name: funcName,
            type: 'system',
            trigger: inferTrigger(filePath, funcName, funcName),
            content: extracted.text,
            hasInterpolation: extracted.hasInterpolation,
          });
        }
      }
    }

    // ── 规则 3: property `system` = `...` ──
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'system' &&
      node.initializer
    ) {
      const extracted = extractString(node.initializer, sourceFile);
      if (extracted) {
        const ctx = findCallContext(node, sourceFile);
        add({
          file: relative(ROOT, filePath),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          name: ctx ? `${ctx} (system)` : 'system prompt',
          type: 'system',
          trigger: inferTrigger(filePath, ctx, findEnclosingName(node, sourceFile)),
          content: extracted.text,
          hasInterpolation: extracted.hasInterpolation,
        });
      }
    }

    // ── 规则 4: tool description / long content in object literal ──
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const propName = node.name.text;
      const extracted = extractString(node.initializer, sourceFile);
      if (extracted) {
        // 4a: description in tool definition
        if (propName === 'description') {
          let toolName = '';
          let n: ts.Node | undefined = node.parent;
          while (n && !ts.isSourceFile(n)) {
            if (ts.isObjectLiteralExpression(n)) {
              for (const prop of n.properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === 'name' &&
                  ts.isStringLiteral(prop.initializer)
                ) {
                  toolName = prop.initializer.text;
                  break;
                }
              }
              if (toolName) break;
            }
            n = n.parent;
          }

          if (toolName) {
            add({
              file: relative(ROOT, filePath),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              name: `${toolName} (tool description)`,
              type: 'tool-definition',
              trigger: `聊天时 LLM 可调用 \`${toolName}\` 工具`,
              content: extracted.text,
              hasInterpolation: extracted.hasInterpolation,
            });
          }
        }

        // 4b: other long string properties that look like prompts
        // (e.g., description in input_schema.properties)
        else if (propName === 'description' && extracted.text.length > 10) {
          // Already handled above via tool name detection; skip duplicates
        }
      }
    }

    // ── 规则 5: catch long template strings with Chinese prompt indicators ──
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isTemplateExpression(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      const name = node.name.text;
      const extracted = extractString(node.initializer, sourceFile);
      if (extracted && extracted.text.length > 50) {
        const indicators = ['你是一个', '要求：', '输出', 'JSON', '不要', '请', '规则：'];
        const hasIndicator = indicators.some((i) => extracted.text.includes(i));
        if (hasIndicator) {
          // 避免和规则1重复
          const nameLower = name.toLowerCase();
          const alreadyCaught =
            nameLower.includes('prompt') ||
            nameLower.includes('system') ||
            nameLower.includes('section') ||
            nameLower.includes('template');
          if (!alreadyCaught) {
            add({
              file: relative(ROOT, filePath),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              name,
              type: 'system',
              trigger: inferTrigger(filePath, name, findEnclosingName(node, sourceFile)),
              content: extracted.text,
              hasInterpolation: extracted.hasInterpolation,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return entries;
}

/** 根据文件路径和名称推断触发时机 */
function inferTrigger(file: string, name: string, enclosingFunc: string): string {
  const f = file.toLowerCase();
  const n = name.toLowerCase();
  const e = enclosingFunc.toLowerCase();

  if (f.includes('cognition/ingest')) {
    if (n.includes('extract')) return '`processInboxEntry()` → 将 inbox 内容提取为结构化笔记';
    if (n.includes('qa')) return '`generateQA()` → 基于笔记生成问答对';
    if (n.includes('link')) return '`generateLinks()` → 判断笔记与已有笔记的关联';
    return '`processInboxEntry()` 知识入库流水线';
  }
  if (f.includes('cognition/relink')) {
    return '`relinkNote()` → relink cron 定时刷新笔记关联';
  }
  if (f.includes('api/chat')) {
    if (n.includes('web_fetch')) return '聊天时，LLM 第一轮可调用 `web_fetch` 工具';
    if (n.includes('tool')) return '聊天时，LLM 工具调用';
    return '`POST /api/chat` → 流式 AI 对话';
  }
  if (f.includes('api/memory')) {
    return '`POST /api/memory/update` → 对话结束后异步更新用户记忆';
  }
  if (f.includes('memory.ts') && !f.includes('test')) {
    return '`getChatContext()` → 将用户记忆注入聊天 system prompt';
  }

  return enclosingFunc ? `由 \`${enclosingFunc}()\` 调用` : '运行时动态触发';
}

/** 生成 Markdown 文档 */
function generateMarkdown(entries: PromptEntry[]): string {
  const lines: string[] = [
    '# 提示词目录（Prompt Catalog）',
    '',
    '> 本文档由 `scripts/extract-prompts.ts` 自动生成，**请勿手动编辑**。',
    '> 修改代码中的提示词后，运行 `npm run extract-prompts` 更新本文档。',
    '',
    '## 总览',
    '',
    `| 类型 | 数量 |`,
    `|------|------|`,
  ];

  const typeCount: Record<string, number> = {};
  for (const e of entries) {
    typeCount[e.type] = (typeCount[e.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCount).sort()) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push(`| **总计** | **${entries.length}** |`);
  lines.push('');

  // 按文件分组
  const byFile = new Map<string, PromptEntry[]>();
  for (const e of entries) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file)!.push(e);
  }

  for (const [file, items] of byFile) {
    lines.push(`## ${file}`);
    lines.push('');
    for (const e of items) {
      lines.push(`### ${e.name} \`{${e.id}}\``);
      lines.push('');
      lines.push(`- **位置**：${e.file}:${e.line}`);
      lines.push(`- **类型**：${e.type}`);
      lines.push(`- **触发时机**：${e.trigger}`);
      if (e.hasInterpolation) {
        lines.push(`- **动态插值**：是（提示词模板中包含运行时变量）`);
      }
      lines.push('');
      lines.push('```');
      lines.push(e.content);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Main ──
const files: string[] = [];
for (const dir of SCAN_DIRS) {
  files.push(...collectTsFiles(join(ROOT, dir)));
}

const allEntries: PromptEntry[] = [];
for (const file of files.sort()) {
  try {
    const entries = extractFromFile(file);
    allEntries.push(...entries);
  } catch (err) {
    console.error(`Failed to parse ${file}:`, (err as Error).message);
  }
}

const md = generateMarkdown(allEntries);
writeFileSync(OUTPUT, md, 'utf-8');

console.log(`Extracted ${allEntries.length} prompts from ${files.length} files → ${relative(ROOT, OUTPUT)}`);
