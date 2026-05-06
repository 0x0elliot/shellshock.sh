import { describe, it, expect } from "vitest";
import {
  isCompoundCommand,
  splitCompoundCommand,
  classifyCommand,
  matchesRule,
  parseRule,
  evaluatePermission,
  evaluateCompoundPermission,
  CommandClassification,
  type PermissionRule,
} from "./permissions.js";

// ---------------------------------------------------------------------------
// isCompoundCommand
// ---------------------------------------------------------------------------

describe("isCompoundCommand", () => {
  describe("detects all compound operators", () => {
    it.each([
      ["ls && rm", "&&"],
      ["ls || rm", "||"],
      ["ls ; rm", ";"],
      ["ls & rm", "&"],
      ["ls | rm", "|"],
      ["ls |& rm", "|&"],
      ["ls\nrm", "newline"],
    ])("%s (%s)", (cmd) => {
      expect(isCompoundCommand(cmd)).toBe(true);
    });
  });

  describe("detects subshells and command groups", () => {
    it("top-level subshell", () => {
      expect(isCompoundCommand("(rm -rf /)")).toBe(true);
    });

    it("top-level command group", () => {
      expect(isCompoundCommand("{ rm -rf /; }")).toBe(true);
    });

    it("subshell with inner operators", () => {
      expect(isCompoundCommand("(cd /tmp && ls)")).toBe(true);
    });
  });

  describe("does NOT flag simple commands", () => {
    it.each([
      ["ls -la", "simple command"],
      ["echo hello world", "command with args"],
      ["echo foo > file", "redirect"],
      ["echo foo >> file", "append redirect"],
      ["cat < input", "input redirect"],
      ["cmd 2>&1", "stderr redirect"],
    ])("%s (%s)", (cmd) => {
      expect(isCompoundCommand(cmd)).toBe(false);
    });
  });

  describe("respects quoting", () => {
    it("double-quoted operators", () => {
      expect(isCompoundCommand('echo "a && b"')).toBe(false);
    });

    it("single-quoted operators", () => {
      expect(isCompoundCommand("echo 'a && b'")).toBe(false);
    });

    it("double-quoted semicolon", () => {
      expect(isCompoundCommand('echo "hello; world"')).toBe(false);
    });

    it("double-quoted pipe", () => {
      expect(isCompoundCommand('echo "a | b"')).toBe(false);
    });

    it("double-quoted ampersand", () => {
      expect(isCompoundCommand('echo "a & b"')).toBe(false);
    });
  });

  describe("respects depth tracking", () => {
    it("$() command substitution", () => {
      expect(isCompoundCommand("echo $(date && time)")).toBe(false);
    });

    it("nested $() does not leak", () => {
      expect(isCompoundCommand("echo $(echo $(ls && pwd))")).toBe(false);
    });

    it("backtick substitution", () => {
      expect(isCompoundCommand("echo `date && time`")).toBe(false);
    });

    it("$() followed by real operator", () => {
      expect(isCompoundCommand("echo $(date) && rm foo")).toBe(true);
    });
  });

  describe("process substitution is NOT compound", () => {
    it("diff with <()", () => {
      expect(isCompoundCommand("diff <(sort a) <(sort b)")).toBe(false);
    });

    it("tee with >()", () => {
      expect(isCompoundCommand("tee >(grep foo)")).toBe(false);
    });

    it("process substitution with inner operators", () => {
      expect(isCompoundCommand("diff <(cat a | sort) <(cat b | sort)")).toBe(false);
    });
  });

  describe("redirection with & is NOT compound", () => {
    it("2>&1 stderr redirect", () => {
      expect(isCompoundCommand("cmd 2>&1")).toBe(false);
    });

    it("&> combined redirect", () => {
      expect(isCompoundCommand("cmd &> /dev/null")).toBe(false);
    });

    it("fd duplication <&3", () => {
      expect(isCompoundCommand("cmd <&3")).toBe(false);
    });

    it("real & after redirect is still compound", () => {
      expect(isCompoundCommand("cmd > out & rm foo")).toBe(true);
    });
  });

  describe("escape handling", () => {
    it("escaped operator is not compound", () => {
      expect(isCompoundCommand("echo a \\; b")).toBe(false);
    });

    it("escaped backslash before operator IS compound", () => {
      expect(isCompoundCommand("echo a \\\\&& b")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// splitCompoundCommand
// ---------------------------------------------------------------------------

describe("splitCompoundCommand", () => {
  it("splits on &&", () => {
    const segs = splitCompoundCommand("ls && rm foo");
    expect(segs).toHaveLength(2);
    expect(segs[0].command).toBe("ls");
    expect(segs[1].command).toBe("rm foo");
    expect(segs[1].operator).toBe("&&");
  });

  it("splits on ||", () => {
    const segs = splitCompoundCommand("ls || echo fail");
    expect(segs).toHaveLength(2);
    expect(segs[1].operator).toBe("||");
  });

  it("splits on ;", () => {
    const segs = splitCompoundCommand("ls; pwd");
    expect(segs).toHaveLength(2);
    expect(segs[1].operator).toBe(";");
  });

  it("splits on single &", () => {
    const segs = splitCompoundCommand("ls & rm -rf /");
    expect(segs).toHaveLength(2);
    expect(segs[0].command).toBe("ls");
    expect(segs[1].command).toBe("rm -rf /");
    expect(segs[1].operator).toBe("&");
  });

  it("splits on |", () => {
    const segs = splitCompoundCommand("cat file | grep foo");
    expect(segs).toHaveLength(2);
    expect(segs[1].operator).toBe("|");
  });

  it("splits on |& as pipe", () => {
    const segs = splitCompoundCommand("ls |& grep foo");
    expect(segs).toHaveLength(2);
    expect(segs[0].command).toBe("ls");
    expect(segs[1].command).toBe("grep foo");
    expect(segs[1].operator).toBe("|");
  });

  it("does not split inside quotes", () => {
    const segs = splitCompoundCommand('echo "a && b"');
    expect(segs).toHaveLength(1);
    expect(segs[0].command).toBe('echo "a && b"');
  });

  it("does not split inside $()", () => {
    const segs = splitCompoundCommand("echo $(date && time) && rm foo");
    expect(segs).toHaveLength(2);
    expect(segs[0].command).toBe("echo $(date && time)");
    expect(segs[1].command).toBe("rm foo");
  });

  it("preserves redirections in segments", () => {
    const segs = splitCompoundCommand("echo foo > out && cat out");
    expect(segs).toHaveLength(2);
    expect(segs[0].command).toBe("echo foo > out");
  });

  it("handles multi-part chain", () => {
    const segs = splitCompoundCommand("a && b || c ; d & e");
    expect(segs).toHaveLength(5);
    expect(segs.map((s) => s.command)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns single segment for simple command", () => {
    const segs = splitCompoundCommand("ls -la");
    expect(segs).toHaveLength(1);
    expect(segs[0].command).toBe("ls -la");
    expect(segs[0].operator).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// classifyCommand
// ---------------------------------------------------------------------------

describe("classifyCommand", () => {
  describe("basic classification", () => {
    it.each([
      ["ls", CommandClassification.ReadOnly],
      ["cat file.txt", CommandClassification.ReadOnly],
      ["grep foo bar", CommandClassification.ReadOnly],
      ["git status", CommandClassification.ReadOnly],
      ["git log --oneline", CommandClassification.ReadOnly],
    ])("%s -> %s", (cmd, expected) => {
      expect(classifyCommand(cmd)).toBe(expected);
    });

    it.each([
      ["rm file", CommandClassification.Destructive],
      ["rm -rf /", CommandClassification.Destructive],
      ["kill -9 123", CommandClassification.Destructive],
      ["git reset --hard", CommandClassification.Destructive],
    ])("%s -> %s", (cmd, expected) => {
      expect(classifyCommand(cmd)).toBe(expected);
    });

    it.each([
      ["cp a b", CommandClassification.Write],
      ["mv a b", CommandClassification.Write],
      ["mkdir dir", CommandClassification.Write],
      ["git add .", CommandClassification.Write],
    ])("%s -> %s", (cmd, expected) => {
      expect(classifyCommand(cmd)).toBe(expected);
    });

    it.each([
      ["curl http://example.com", CommandClassification.Network],
      ["wget file", CommandClassification.Network],
      ["ssh host", CommandClassification.Network],
    ])("%s -> %s", (cmd, expected) => {
      expect(classifyCommand(cmd)).toBe(expected);
    });

    it.each([
      ["vim file", CommandClassification.Interactive],
      ["python", CommandClassification.Interactive],
      ["mysql", CommandClassification.Interactive],
    ])("%s -> %s", (cmd, expected) => {
      expect(classifyCommand(cmd)).toBe(expected);
    });
  });

  describe("compound classification uses worst segment", () => {
    it("ls && rm -> DESTRUCTIVE", () => {
      expect(classifyCommand("ls && rm -rf /")).toBe(CommandClassification.Destructive);
    });

    it("ls & rm -> DESTRUCTIVE", () => {
      expect(classifyCommand("ls & rm -rf /")).toBe(CommandClassification.Destructive);
    });

    it("cat | grep -> READ-ONLY", () => {
      expect(classifyCommand("cat file | grep foo")).toBe(CommandClassification.ReadOnly);
    });
  });

  describe("proxy command stripping", () => {
    it("sudo rm -> DESTRUCTIVE", () => {
      expect(classifyCommand("sudo rm -rf /")).toBe(CommandClassification.Destructive);
    });

    it("sudo ls -> UNKNOWN (proxy wrapping is conservative)", () => {
      expect(classifyCommand("sudo ls")).toBe(CommandClassification.Unknown);
    });

    it("env npm install -> WRITE", () => {
      expect(classifyCommand("env npm install")).toBe(CommandClassification.Write);
    });
  });

  describe("command substitution escalation", () => {
    it("echo $(rm) escalates to UNKNOWN minimum", () => {
      const cls = classifyCommand("echo $(rm -rf /)");
      expect(cls).not.toBe(CommandClassification.ReadOnly);
    });

    it("echo `whoami` escalates to UNKNOWN minimum", () => {
      const cls = classifyCommand("echo `whoami`");
      expect(cls).not.toBe(CommandClassification.ReadOnly);
    });

    it("single-quoted $() does NOT escalate", () => {
      expect(classifyCommand("echo '$(safe)'")).toBe(CommandClassification.ReadOnly);
    });

    it("rm $(x) stays DESTRUCTIVE (higher than UNKNOWN)", () => {
      expect(classifyCommand("rm $(echo file)")).toBe(CommandClassification.Destructive);
    });
  });

  describe("path-qualified commands", () => {
    it("/usr/bin/rm -> DESTRUCTIVE", () => {
      expect(classifyCommand("/usr/bin/rm file")).toBe(CommandClassification.Destructive);
    });

    it("/bin/ls -> READ-ONLY", () => {
      expect(classifyCommand("/bin/ls")).toBe(CommandClassification.ReadOnly);
    });
  });

  describe("find -exec/-delete", () => {
    it("find -exec -> DESTRUCTIVE", () => {
      expect(classifyCommand("find . -exec rm {} \\;")).toBe(CommandClassification.Destructive);
    });

    it("find -delete -> DESTRUCTIVE", () => {
      expect(classifyCommand("find . -name '*.tmp' -delete")).toBe(CommandClassification.Destructive);
    });

    it("find without exec -> UNKNOWN", () => {
      expect(classifyCommand("find . -name '*.ts'")).toBe(CommandClassification.Unknown);
    });
  });
});

// ---------------------------------------------------------------------------
// matchesRule
// ---------------------------------------------------------------------------

describe("matchesRule", () => {
  describe("prefix rules", () => {
    const rule = parseRule("bash(ls:*)");

    it("matches base command", () => {
      expect(matchesRule("ls", rule)).toBe(true);
    });

    it("matches with args", () => {
      expect(matchesRule("ls -la", rule)).toBe(true);
    });

    it("does not match different command", () => {
      expect(matchesRule("cat file", rule)).toBe(false);
    });

    it("does not match compound", () => {
      expect(matchesRule("ls && rm foo", rule)).toBe(false);
    });

    it("does not match proxy-wrapped", () => {
      expect(matchesRule("sudo ls", rule)).toBe(false);
    });
  });

  describe("any rules", () => {
    const rule = parseRule("bash(*)");

    it("matches simple command", () => {
      expect(matchesRule("ls -la", rule)).toBe(true);
    });

    it("does not match compound", () => {
      expect(matchesRule("ls && rm", rule)).toBe(false);
    });
  });

  describe("exact rules", () => {
    const rule = parseRule("bash(ls -la)");

    it("matches exact", () => {
      expect(matchesRule("ls -la", rule)).toBe(true);
    });

    it("does not match partial", () => {
      expect(matchesRule("ls", rule)).toBe(false);
    });

    it("does not match superset", () => {
      expect(matchesRule("ls -la -R", rule)).toBe(false);
    });
  });

  describe("variable expansion guard", () => {
    it("blocks $HOME in command", () => {
      const rule = parseRule("bash(*)");
      expect(matchesRule("$HOME/script", rule)).toBe(false);
    });

    it("blocks ${var} in command", () => {
      const rule = parseRule("bash(echo:*)");
      expect(matchesRule("echo ${PATH}", rule)).toBe(false);
    });

    it("blocks $() command substitution", () => {
      const rule = parseRule("bash(echo:*)");
      expect(matchesRule("echo $(whoami)", rule)).toBe(false);
    });

    it("allows $ inside single quotes", () => {
      const rule = parseRule("bash(echo:*)");
      expect(matchesRule("echo '$HOME'", rule)).toBe(true);
    });

    it("blocks $ in double quotes", () => {
      const rule = parseRule("bash(echo:*)");
      expect(matchesRule('echo "$HOME"', rule)).toBe(false);
    });
  });

  describe("non-bash rules never match", () => {
    it("tool name mismatch", () => {
      const rule = parseRule("other(ls:*)");
      expect(matchesRule("ls", rule)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// evaluatePermission
// ---------------------------------------------------------------------------

describe("evaluatePermission", () => {
  it("deny rules take precedence over allow", () => {
    const allow: PermissionRule[] = [parseRule("bash(*)")];
    const deny: PermissionRule[] = [parseRule("bash(rm:*)")];
    const result = evaluatePermission("rm -rf /", allow, deny);
    expect(result.decision).toBe("deny");
  });

  it("allow rule matches simple command", () => {
    const allow: PermissionRule[] = [parseRule("bash(ls:*)")];
    const result = evaluatePermission("ls -la", allow, []);
    expect(result.decision).toBe("allow");
  });

  it("compound commands prompt even with allow rule", () => {
    const allow: PermissionRule[] = [parseRule("bash(*)")];
    const result = evaluatePermission("ls && rm", allow, []);
    expect(result.decision).toBe("prompt");
  });

  it("no matching rule prompts", () => {
    const result = evaluatePermission("some-unknown-cmd", [], []);
    expect(result.decision).toBe("prompt");
  });
});

// ---------------------------------------------------------------------------
// evaluateCompoundPermission
// ---------------------------------------------------------------------------

describe("evaluateCompoundPermission", () => {
  it("allows if all segments match allow rules", () => {
    const allow = [parseRule("bash(ls:*)"), parseRule("bash(cat:*)")];
    const result = evaluateCompoundPermission("ls && cat file", allow, []);
    expect(result.overallDecision).toBe("allow");
  });

  it("denies if any segment matches deny rule", () => {
    const allow = [parseRule("bash(*)")];
    const deny = [parseRule("bash(rm:*)")];
    const result = evaluateCompoundPermission("ls && rm foo", allow, deny);
    expect(result.overallDecision).toBe("deny");
  });

  it("prompts if any segment has no matching rule", () => {
    const allow = [parseRule("bash(ls:*)")];
    const result = evaluateCompoundPermission("ls && unknown-cmd", allow, []);
    expect(result.overallDecision).toBe("prompt");
    expect(result.promptSegments).toHaveLength(1);
    expect(result.promptSegments[0].segment.command).toBe("unknown-cmd");
  });

  it("correctly identifies all segments", () => {
    const result = evaluateCompoundPermission("ls & rm -rf / && cat file", [], []);
    expect(result.segments).toHaveLength(3);
  });
});
