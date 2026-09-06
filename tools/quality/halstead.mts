import type { Rule } from "eslint";
import { analyze } from "estree-halstead";

export const halsteadRule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      difficulty: "Halstead difficulty {{actual}} exceeds 15.",
      volume: "Halstead volume {{actual}} exceeds 1000.",
      invalid: "Halstead analysis returned a non-finite metric; analysis must not silently pass.",
    },
  },
  create(context) {
    function check(node: Rule.Node): void {
      const metrics = analyze(node);
      if (!Number.isFinite(metrics.difficulty) || !Number.isFinite(metrics.volume)) {
        context.report({ node, messageId: "invalid" });
        return;
      }
      if (metrics.difficulty > 15) {
        context.report({
          node,
          messageId: "difficulty",
          data: { actual: metrics.difficulty.toFixed(2) },
        });
      }
      if (metrics.volume > 1000) {
        context.report({ node, messageId: "volume", data: { actual: metrics.volume.toFixed(2) } });
      }
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
