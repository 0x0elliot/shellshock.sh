export enum CommandClassification {
  ReadOnly = "READ-ONLY",
  Write = "WRITE",
  Destructive = "DESTRUCTIVE",
  Network = "NETWORK",
  Interactive = "INTERACTIVE",
  Unknown = "UNKNOWN",
}

const READ_ONLY_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "rg", "ag",
  "wc", "file", "stat", "du", "df", "pwd", "whoami", "uname",
  "echo", "printf", "which", "where", "tree", "jq", "yq", "diff",
  "sort", "uniq", "cut", "tr", "date", "cal",
  "printenv", "id", "groups", "hostname", "uptime",
  "ps", "free", "vmstat", "iostat", "lsof",
  "strings", "hexdump", "xxd", "od", "base64",
  "man", "help", "info", "type",
]);

const PROXY_COMMANDS = new Set([
  "sudo", "su", "doas",
  "env", "command", "builtin",
  "xargs", "exec",
  "nohup", "nice", "ionice", "timeout", "strace", "ltrace",
  "eval",
]);

const READ_ONLY_PREFIXES = [
  "git log", "git status", "git diff", "git show", "git branch",
  "git remote", "git tag", "git stash list", "git blame",
  "docker ps", "docker images", "docker logs",
  "kubectl get", "kubectl describe", "kubectl logs",
  "npm list", "npm ls", "npm view", "npm info",
];

const WRITE_COMMANDS = new Set([
  "cp", "mv", "mkdir", "touch", "chmod", "chown", "chgrp",
  "ln", "install", "patch", "sed", "awk", "tee",
  "tar", "zip", "unzip", "gzip", "gunzip", "bzip2",
]);

const WRITE_PREFIXES = [
  "git add", "git commit", "git push", "git pull", "git fetch",
  "git merge", "git rebase", "git checkout", "git switch",
  "git stash", "git cherry-pick",
  "npm install", "npm update", "npm uninstall",
  "pip install", "pip uninstall",
  "brew install", "brew update", "brew upgrade",
  "apt install", "apt update", "apt upgrade",
  "docker build", "docker run", "docker exec",
];

const DESTRUCTIVE_COMMANDS = new Set([
  "rm", "rmdir", "kill", "killall", "pkill",
  "shutdown", "reboot", "halt", "poweroff",
  "mkfs", "fdisk", "dd", "shred", "wipefs",
  "truncate",
]);

const DESTRUCTIVE_PREFIXES = [
  "git reset --hard", "git clean",
  "docker rm", "docker rmi", "docker system prune",
  "kubectl delete",
  "npm prune",
];

const NETWORK_COMMANDS = new Set([
  "curl", "wget", "ssh", "scp", "sftp", "rsync",
  "nc", "ncat", "netcat", "nmap", "socat",
  "ping", "traceroute", "tracepath", "mtr",
  "dig", "nslookup", "host", "whois",
  "telnet", "ftp",
]);

const INTERACTIVE_COMMANDS = new Set([
  "vim", "vi", "nvim", "neovim", "nano", "pico", "emacs",
  "less", "more", "most",
  "top", "htop", "btop", "glances", "nmon",
  "tmux", "screen", "byobu",
  "python", "python3", "node", "irb", "ghci", "lua",
  "bash", "zsh", "sh", "fish", "csh", "tcsh",
  "mysql", "psql", "sqlite3", "mongosh", "redis-cli",
  "gdb", "lldb",
  "fzf", "tig",
]);

// ---------------------------------------------------------------------------
// Compound command detection (FSM with depth tracking)
// ---------------------------------------------------------------------------

export function isCompoundCommand(command: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let depth = 0;
  let inBacktick = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) continue;

    // Depth tracking for $() and ()
    if (ch === "$" && command[i + 1] === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth--;
      continue;
    }

    if (ch === "`") {
      inBacktick = !inBacktick;
      continue;
    }

    // Only detect compound operators at depth 0 outside backticks
    if (depth > 0 || inBacktick) continue;

    if (ch === "\n" || ch === "\r") return true;
    if (ch === ";") return true;

    if (ch === "|" && command[i + 1] === "|") return true;
    if (ch === "|") return true;

    if (ch === "&" && command[i + 1] === "&") return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// FSM splitter — splits compound commands at top-level operators only
// ---------------------------------------------------------------------------

export type SplitOperator = "none" | ";" | "&&" | "||" | "|" | "\n";

export interface CommandSegment {
  command: string;
  operator: SplitOperator;
}

export interface CommandGroup {
  fullText: string;
  segments: CommandSegment[];
  classification: CommandClassification;
  isPipeline: boolean;
}

export function splitCompoundCommand(command: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let current = "";
  let currentOp: SplitOperator = "none";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let depth = 0;
  let inBacktick = false;

  function push() {
    const trimmed = current.trim();
    if (trimmed) {
      segments.push({ command: trimmed, operator: currentOp });
    }
    current = "";
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    // Escape handling
    if (escaped) {
      escaped = false;
      current += ch;
      continue;
    }

    if (ch === "\\" && !inSingleQuote) {
      escaped = true;
      current += ch;
      continue;
    }

    // Quote handling
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      current += ch;
      continue;
    }

    // Depth tracking — $() and ()
    if (ch === "$" && command[i + 1] === "(") {
      depth++;
      current += "$(";
      i++;
      continue;
    }

    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ")" && depth > 0) {
      depth--;
      current += ch;
      continue;
    }

    // Backtick tracking
    if (ch === "`") {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    // Only split at depth 0 outside backticks
    if (depth > 0 || inBacktick) {
      current += ch;
      continue;
    }

    // --- Split operators ---

    if (ch === ";" || ch === "\n") {
      push();
      currentOp = ch === ";" ? ";" : "\n";
      continue;
    }

    if (ch === "\r") {
      // Treat \r\n as single newline
      if (command[i + 1] === "\n") i++;
      push();
      currentOp = "\n";
      continue;
    }

    if (ch === "&" && command[i + 1] === "&") {
      push();
      currentOp = "&&";
      i++;
      continue;
    }

    if (ch === "|" && command[i + 1] === "|") {
      push();
      currentOp = "||";
      i++;
      continue;
    }

    if (ch === "|") {
      push();
      currentOp = "|";
      continue;
    }

    // Everything else (including > < redirections) is part of the current segment
    current += ch;
  }

  push();

  return segments.length > 0
    ? segments
    : [{ command: command.trim(), operator: "none" as SplitOperator }];
}

// ---------------------------------------------------------------------------
// Pipeline grouping — consecutive pipe-connected segments form one group
// ---------------------------------------------------------------------------

export function groupPipelines(segments: CommandSegment[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  let currentSegments: CommandSegment[] = [];

  for (const seg of segments) {
    if (seg.operator === "|" && currentSegments.length > 0) {
      // Continue the pipeline
      currentSegments.push(seg);
    } else {
      // Flush previous group
      if (currentSegments.length > 0) {
        groups.push(buildGroup(currentSegments));
      }
      currentSegments = [seg];
    }
  }

  if (currentSegments.length > 0) {
    groups.push(buildGroup(currentSegments));
  }

  return groups;
}

function buildGroup(segments: CommandSegment[]): CommandGroup {
  const isPipeline = segments.length > 1;
  const fullText = segments.map((s) => s.command).join(" | ");

  let worst: CommandClassification = CommandClassification.ReadOnly;
  for (const seg of segments) {
    const cls = classifySingleCommand(seg.command);
    if (classificationSeverity(cls) > classificationSeverity(worst)) {
      worst = cls;
    }
  }

  return { fullText, segments, classification: worst, isPipeline };
}

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  const spaceIdx = trimmed.indexOf(" ");
  let cmd = spaceIdx === -1 ? trimmed : trimmed.substring(0, spaceIdx);
  const slashIdx = cmd.lastIndexOf("/");
  if (slashIdx !== -1) {
    cmd = cmd.substring(slashIdx + 1);
  }
  return cmd;
}

export function classifyCommand(command: string): CommandClassification {
  const trimmed = command.trim();

  if (isCompoundCommand(command)) {
    const segments = splitCompoundCommand(command);
    let worst: CommandClassification = CommandClassification.ReadOnly;
    for (const seg of segments) {
      const partClass = classifySingleCommand(seg.command);
      const severity = classificationSeverity(partClass);
      if (severity > classificationSeverity(worst)) {
        worst = partClass;
      }
    }
    return worst;
  }

  return classifySingleCommand(trimmed);
}

export function classificationSeverity(c: CommandClassification): number {
  switch (c) {
    case CommandClassification.ReadOnly: return 0;
    case CommandClassification.Unknown: return 1;
    case CommandClassification.Write: return 2;
    case CommandClassification.Network: return 3;
    case CommandClassification.Interactive: return 4;
    case CommandClassification.Destructive: return 5;
  }
}

function classifySingleCommand(command: string): CommandClassification {
  const base = extractBaseCommand(command);
  const trimmed = command.trim();

  if (PROXY_COMMANDS.has(base)) {
    const rest = trimmed.substring(trimmed.indexOf(" ") + 1).trim();
    if (!rest || rest === base) return CommandClassification.Unknown;
    const inner = skipFlags(rest);
    if (inner) {
      const innerClass = classifySingleCommand(inner);
      return classificationSeverity(innerClass) > classificationSeverity(CommandClassification.Unknown)
        ? innerClass
        : CommandClassification.Unknown;
    }
    return CommandClassification.Unknown;
  }

  if (INTERACTIVE_COMMANDS.has(base)) return CommandClassification.Interactive;

  if (base === "find" && (/\s-exec\b/.test(trimmed) || /\s-execdir\b/.test(trimmed) || /\s-delete\b/.test(trimmed))) {
    return CommandClassification.Destructive;
  }

  for (const prefix of DESTRUCTIVE_PREFIXES) {
    if (trimmed.startsWith(prefix)) return CommandClassification.Destructive;
  }
  if (DESTRUCTIVE_COMMANDS.has(base)) return CommandClassification.Destructive;

  if (NETWORK_COMMANDS.has(base)) return CommandClassification.Network;

  for (const prefix of WRITE_PREFIXES) {
    if (trimmed.startsWith(prefix)) return CommandClassification.Write;
  }
  if (WRITE_COMMANDS.has(base)) return CommandClassification.Write;

  for (const prefix of READ_ONLY_PREFIXES) {
    if (trimmed.startsWith(prefix)) return CommandClassification.ReadOnly;
  }
  if (READ_ONLY_COMMANDS.has(base)) return CommandClassification.ReadOnly;

  return CommandClassification.Unknown;
}

function skipFlags(command: string): string {
  const parts = command.split(/\s+/);
  for (const part of parts) {
    if (!part.startsWith("-")) return command.substring(command.indexOf(part));
  }
  return "";
}

// ---------------------------------------------------------------------------
// Permission rules
// ---------------------------------------------------------------------------

export interface PermissionRule {
  raw: string;
  toolName: string;
  matcher:
    | { type: "any" }
    | { type: "exact"; value: string }
    | { type: "prefix"; prefix: string };
}

export function parseRule(raw: string): PermissionRule {
  const parenOpen = raw.indexOf("(");
  if (parenOpen === -1) {
    return { raw, toolName: raw.trim(), matcher: { type: "any" } };
  }

  const toolName = raw.substring(0, parenOpen).trim();
  const parenClose = raw.lastIndexOf(")");
  const content =
    parenClose > parenOpen
      ? raw.substring(parenOpen + 1, parenClose).trim()
      : raw.substring(parenOpen + 1).trim();

  if (content === "" || content === "*") {
    return { raw, toolName, matcher: { type: "any" } };
  }

  if (content.endsWith(":*")) {
    const prefix = content.substring(0, content.length - 2);
    return { raw, toolName, matcher: { type: "prefix", prefix } };
  }

  return { raw, toolName, matcher: { type: "exact", value: content } };
}

export function matchesRule(command: string, rule: PermissionRule): boolean {
  if (rule.toolName !== "bash") return false;

  const trimmed = command.trim();

  switch (rule.matcher.type) {
    case "any":
      return !isCompoundCommand(command);

    case "exact":
      return trimmed === rule.matcher.value;

    case "prefix": {
      if (isCompoundCommand(command)) return false;
      const base = extractBaseCommand(trimmed);
      if (PROXY_COMMANDS.has(base)) return false;
      return base === rule.matcher.prefix || trimmed.startsWith(rule.matcher.prefix + " ");
    }
  }
}

// ---------------------------------------------------------------------------
// Permission evaluation — simple commands
// ---------------------------------------------------------------------------

export interface PermissionEvaluation {
  decision: "allow" | "deny" | "prompt";
  reason: string;
  classification: CommandClassification;
  matchedRule?: PermissionRule;
  isCompound: boolean;
}

export function evaluatePermission(
  command: string,
  allowRules: PermissionRule[],
  denyRules: PermissionRule[]
): PermissionEvaluation {
  const classification = classifyCommand(command);
  const compound = isCompoundCommand(command);

  for (const rule of denyRules) {
    if (matchesRule(command, rule)) {
      return {
        decision: "deny",
        reason: `Blocked by deny rule: ${rule.raw}`,
        classification,
        matchedRule: rule,
        isCompound: compound,
      };
    }
  }

  if (!compound) {
    for (const rule of allowRules) {
      if (matchesRule(command, rule)) {
        return {
          decision: "allow",
          reason: `Matched allow rule: ${rule.raw}`,
          classification,
          matchedRule: rule,
          isCompound: false,
        };
      }
    }
  }

  return {
    decision: "prompt",
    reason: compound
      ? "Compound commands always require explicit approval"
      : "No matching rule — customer approval required",
    classification,
    isCompound: compound,
  };
}

// ---------------------------------------------------------------------------
// Compound permission evaluation — per-group approval
// ---------------------------------------------------------------------------

export interface GroupEvaluation {
  group: CommandGroup;
  evaluation: PermissionEvaluation;
}

export interface CompoundPermissionEvaluation {
  originalCommand: string;
  groups: GroupEvaluation[];
  overallDecision: "allow" | "deny" | "prompt";
  denyReason?: string;
  promptGroups: GroupEvaluation[];
}

export function evaluateCompoundPermission(
  command: string,
  allowRules: PermissionRule[],
  denyRules: PermissionRule[]
): CompoundPermissionEvaluation {
  const segments = splitCompoundCommand(command);
  const groups = groupPipelines(segments);

  const groupEvals: GroupEvaluation[] = [];
  const promptGroups: GroupEvaluation[] = [];
  let overallDecision: "allow" | "deny" | "prompt" = "allow";
  let denyReason: string | undefined;

  for (const group of groups) {
    if (group.isPipeline) {
      // Evaluate each stage; if ALL allow → allow, if ANY deny → deny, else prompt
      let groupDecision: "allow" | "deny" | "prompt" = "allow";
      let groupDenyReason: string | undefined;

      for (const seg of group.segments) {
        const eval_ = evaluatePermission(seg.command, allowRules, denyRules);
        if (eval_.decision === "deny") {
          groupDecision = "deny";
          groupDenyReason = eval_.reason;
          break;
        }
        if (eval_.decision === "prompt") {
          groupDecision = "prompt";
        }
      }

      const ge: GroupEvaluation = {
        group,
        evaluation: {
          decision: groupDecision,
          reason: groupDenyReason ?? (groupDecision === "allow"
            ? "All pipeline stages matched allow rules"
            : "Pipeline requires approval"),
          classification: group.classification,
          isCompound: group.isPipeline,
        },
      };

      groupEvals.push(ge);

      if (groupDecision === "deny") {
        overallDecision = "deny";
        denyReason = groupDenyReason;
        break;
      }
      if (groupDecision === "prompt") {
        overallDecision = "prompt";
        promptGroups.push(ge);
      }
    } else {
      // Single command group — evaluate directly
      const eval_ = evaluatePermission(group.fullText, allowRules, denyRules);
      const ge: GroupEvaluation = { group, evaluation: eval_ };
      groupEvals.push(ge);

      if (eval_.decision === "deny") {
        overallDecision = "deny";
        denyReason = eval_.reason;
        break;
      }
      if (eval_.decision === "prompt") {
        overallDecision = "prompt";
        promptGroups.push(ge);
      }
    }
  }

  return { originalCommand: command, groups: groupEvals, overallDecision, denyReason, promptGroups };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function suggestRule(command: string): string | null {
  if (isCompoundCommand(command)) return null;

  const base = extractBaseCommand(command.trim());
  if (!base) return null;

  return `bash(${base}:*)`;
}

export function classificationColor(classification: CommandClassification): string {
  switch (classification) {
    case CommandClassification.ReadOnly:
      return "green";
    case CommandClassification.Write:
      return "yellow";
    case CommandClassification.Destructive:
      return "red";
    case CommandClassification.Network:
      return "cyan";
    case CommandClassification.Interactive:
      return "#ff9e64";
    case CommandClassification.Unknown:
      return "gray";
  }
}
