// markdown-it은 타입 정의를 따로 받지 않고, 사용설명서를 만드는 데 쓰는 부분만 적어 둔다.
declare module 'markdown-it' {
  interface Token {
    tag: string;
    content: string;
    attrGet(name: string): string | null;
    attrSet(name: string, value: string): void;
  }
  type Rule = (tokens: Token[], index: number, options: unknown, env: unknown, self: { renderToken(tokens: Token[], index: number, options: unknown): string }) => string;
  export default class MarkdownIt {
    constructor(options?: { html?: boolean; linkify?: boolean; typographer?: boolean });
    renderer: { rules: Record<string, Rule> };
    utils: { escapeHtml(text: string): string };
    render(markdown: string): string;
  }
}
