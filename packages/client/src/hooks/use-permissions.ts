import { useState, useEffect, useCallback } from "react";
import {
  type PermissionRule,
  type PermissionEvaluation,
  type CompoundPermissionEvaluation,
  parseRule,
  evaluatePermission,
  evaluateCompoundPermission,
} from "shellshock.sh-shared";
import { clientDb } from "../db.js";

export function usePermissions(sessionId: string): {
  allowRules: PermissionRule[];
  denyRules: PermissionRule[];
  addAllowRule: (ruleStr: string) => void;
  addDenyRule: (ruleStr: string) => void;
  removeRule: (raw: string) => void;
  evaluate: (command: string) => PermissionEvaluation;
  evaluateCompound: (command: string) => CompoundPermissionEvaluation;
} {
  const [allowRules, setAllowRules] = useState<PermissionRule[]>([]);
  const [denyRules, setDenyRules] = useState<PermissionRule[]>([]);

  useEffect(() => {
    const rows = clientDb.getRules(sessionId);
    const allow: PermissionRule[] = [];
    const deny: PermissionRule[] = [];
    for (const row of rows) {
      const parsed = parseRule(row.rule);
      if (row.type === "allow") allow.push(parsed);
      else deny.push(parsed);
    }
    setAllowRules(allow);
    setDenyRules(deny);
  }, [sessionId]);

  const addAllowRule = useCallback((ruleStr: string) => {
    const rule = parseRule(ruleStr);
    clientDb.addRule(sessionId, "allow", ruleStr);
    setAllowRules((prev) => {
      if (prev.some((r) => r.raw === rule.raw)) return prev;
      return [...prev, rule];
    });
  }, [sessionId]);

  const addDenyRule = useCallback((ruleStr: string) => {
    const rule = parseRule(ruleStr);
    clientDb.addRule(sessionId, "deny", ruleStr);
    setDenyRules((prev) => {
      if (prev.some((r) => r.raw === rule.raw)) return prev;
      return [...prev, rule];
    });
  }, [sessionId]);

  const removeRule = useCallback((raw: string) => {
    clientDb.removeRule(sessionId, raw);
    setAllowRules((prev) => prev.filter((r) => r.raw !== raw));
    setDenyRules((prev) => prev.filter((r) => r.raw !== raw));
  }, [sessionId]);

  const evaluate = useCallback(
    (command: string): PermissionEvaluation => {
      return evaluatePermission(command, allowRules, denyRules);
    },
    [allowRules, denyRules]
  );

  const evaluateCompound = useCallback(
    (command: string): CompoundPermissionEvaluation => {
      return evaluateCompoundPermission(command, allowRules, denyRules);
    },
    [allowRules, denyRules]
  );

  return { allowRules, denyRules, addAllowRule, addDenyRule, removeRule, evaluate, evaluateCompound };
}
