import { createRequire } from 'node:module';

interface DuplicateRuleWriter {
  leafNode(tag: string, attrs: { type: string; dxfId?: number; priority?: number }): void;
}

interface ConditionalRule {
  type: string;
  dxfId?: number;
  priority?: number;
}

interface ConditionalRuleRenderer {
  tag: string;
  render(xml: DuplicateRuleWriter, rule: ConditionalRule): void;
}

// ExcelJS 4.4 reads duplicateValues, prepares its differential style, then
// omits the rule when writing. Keep the native rule with the writer's style ID.
const require = createRequire(import.meta.url);
const { prototype } = require('exceljs/lib/xlsx/xform/sheet/cf/cf-rule-xform.js') as {
  prototype: ConditionalRuleRenderer;
};
const render = prototype.render;
prototype.render = function (xml, rule) {
  if (rule.type !== 'duplicateValues') return render.call(this, xml, rule);
  xml.leafNode(this.tag, { type: rule.type, dxfId: rule.dxfId, priority: rule.priority });
};
