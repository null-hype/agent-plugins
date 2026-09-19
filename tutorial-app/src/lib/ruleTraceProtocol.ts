export type RuleTraceConfig = {
  commandFile: string;
  grammarFile: string;
  runtimeFile: string;
  scenario: string;
  storyFile: string;
};

export type RulePeek = {
  explanation: string;
  snippet: string;
  source: string;
  title: string;
};

export type RuleTraceRuntime = {
  messages: {
    empty: string;
    fill: string;
    shape: string;
  };
  peek: RulePeek;
  preview: {
    invalidSummary: string;
    validSummary: string;
  };
  scenario: string;
  sentence: {
    correctFill: string;
    placeholder: string;
    prefix: string;
    suffix: string;
  };
};

export type RuleTraceDiagnostic = {
  from: number;
  message: string;
  peek: RulePeek;
  severity: 'error' | 'info' | 'warning';
  source: 'Rule Trace';
  to: number;
};

export type RuleTraceState = {
  diagnostics: RuleTraceDiagnostic[];
  revision: number;
  scenario: string;
  solved: boolean;
  status: 'blocked' | 'idle' | 'ready';
  storyFile: string;
  summary: string;
  text: string;
  valid: boolean;
};

const DEFAULT_PEEK_SNIPPET = `module AuthorizationGrammar

class ArticleRule {
  phrase: String
  governedCase: String
  requiredArticle: String
}

authorizationAnchor = new ArticleRule {
  phrase = "anhand ... Benutzer-ID"
  governedCase = "Dative"
  requiredArticle = "der"
}`;

const DEFAULT_CONFIG: RuleTraceConfig = {
  commandFile: '/exercise.de',
  grammarFile: '/AuthorizationGrammar.pkl',
  runtimeFile: '/authorization-grammar.json',
  scenario: 'opentrader-idor',
  storyFile: '/trace-story.json',
};

const DEFAULT_RUNTIME: RuleTraceRuntime = {
  messages: {
    empty: 'Fill the blank with the article required by the authorization grammar rule.',
    fill: 'Use `der` so the authorization anchor resolves to the lesson rule for `Benutzer-ID`.',
    shape: 'Keep the sentence shape `Die API prüft die Berechtigung anhand der Benutzer-ID`.',
  },
  peek: {
    explanation:
      'This lesson models the authorization phrase `anhand ... Benutzer-ID` as a dative-governed anchor that requires `der`.',
    snippet: DEFAULT_PEEK_SNIPPET,
    source: 'AuthorizationGrammar.pkl',
    title: 'Peek: AuthorizationGrammar.pkl',
  },
  preview: {
    invalidSummary: 'idor(place_order) blocked',
    validSummary: 'idor(place_order) -> anomaly',
  },
  scenario: 'opentrader-idor',
  sentence: {
    correctFill: 'der',
    placeholder: '_____',
    prefix: 'Die API prüft die Berechtigung anhand ',
    suffix: ' Benutzer-ID',
  },
};

export function resolveRuleTraceConfig(customValue: unknown): RuleTraceConfig | null {
  if (!customValue || typeof customValue !== 'object') {
    return null;
  }

  const record = customValue as Record<string, unknown>;
  const ruleTrace = record.ruleTrace;

  if (!ruleTrace || typeof ruleTrace !== 'object') {
    return null;
  }

  const ruleTraceRecord = ruleTrace as Record<string, unknown>;

  return {
    commandFile: readString(ruleTraceRecord.commandFile, DEFAULT_CONFIG.commandFile),
    grammarFile: readString(ruleTraceRecord.grammarFile, DEFAULT_CONFIG.grammarFile),
    runtimeFile: readString(ruleTraceRecord.runtimeFile, DEFAULT_CONFIG.runtimeFile),
    scenario: readString(ruleTraceRecord.scenario, DEFAULT_CONFIG.scenario),
    storyFile: readString(ruleTraceRecord.storyFile, DEFAULT_CONFIG.storyFile),
  };
}

export function parseRuleTraceRuntime(value: string | Uint8Array | undefined): RuleTraceRuntime {
  if (typeof value !== 'string') {
    return DEFAULT_RUNTIME;
  }

  try {
    const parsed = JSON.parse(value) as Partial<RuleTraceRuntime>;

    return {
      messages: {
        empty: parsed.messages?.empty ?? DEFAULT_RUNTIME.messages.empty,
        fill: parsed.messages?.fill ?? DEFAULT_RUNTIME.messages.fill,
        shape: parsed.messages?.shape ?? DEFAULT_RUNTIME.messages.shape,
      },
      peek: {
        explanation: parsed.peek?.explanation ?? DEFAULT_RUNTIME.peek.explanation,
        snippet: parsed.peek?.snippet ?? DEFAULT_RUNTIME.peek.snippet,
        source: parsed.peek?.source ?? DEFAULT_RUNTIME.peek.source,
        title: parsed.peek?.title ?? DEFAULT_RUNTIME.peek.title,
      },
      preview: {
        invalidSummary: parsed.preview?.invalidSummary ?? DEFAULT_RUNTIME.preview.invalidSummary,
        validSummary: parsed.preview?.validSummary ?? DEFAULT_RUNTIME.preview.validSummary,
      },
      scenario: parsed.scenario ?? DEFAULT_RUNTIME.scenario,
      sentence: {
        correctFill: parsed.sentence?.correctFill ?? DEFAULT_RUNTIME.sentence.correctFill,
        placeholder: parsed.sentence?.placeholder ?? DEFAULT_RUNTIME.sentence.placeholder,
        prefix: parsed.sentence?.prefix ?? DEFAULT_RUNTIME.sentence.prefix,
        suffix: parsed.sentence?.suffix ?? DEFAULT_RUNTIME.sentence.suffix,
      },
    };
  } catch (_error) {
    return DEFAULT_RUNTIME;
  }
}

export function valueToText(value: string | Uint8Array | undefined) {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }

  return '';
}

export function buildRuleTraceState(options: {
  revision: number;
  runtime: RuleTraceRuntime;
  scenario?: string;
  storyFile: string;
  text: string;
}): RuleTraceState {
  const { revision, runtime, scenario, storyFile, text } = options;
  const normalizedText = normalizeText(text);
  const diagnostics: RuleTraceDiagnostic[] = [];

  if (!normalizedText) {
    diagnostics.push(diagnostic(0, runtime.sentence.placeholder.length, runtime.messages.empty, runtime.peek));

    return {
      diagnostics,
      revision,
      scenario: scenario ?? runtime.scenario,
      solved: false,
      status: 'idle',
      storyFile,
      summary: runtime.preview.invalidSummary,
      text,
      valid: false,
    };
  }

  const expectedSentence = `${runtime.sentence.prefix}${runtime.sentence.correctFill}${runtime.sentence.suffix}`;
  const prefixMatches = normalizedText.startsWith(runtime.sentence.prefix);
  const suffixMatches = normalizedText.endsWith(runtime.sentence.suffix);

  if (!prefixMatches || !suffixMatches) {
    diagnostics.push(
      diagnostic(
        0,
        Math.max(normalizedText.length, 1),
        runtime.messages.shape,
        runtime.peek,
      ),
    );
  } else {
    const fillRange = getFillRange(normalizedText, runtime);
    const fillValue = normalizedText.slice(fillRange.from, fillRange.to).trim();

    if (!fillValue || fillValue !== runtime.sentence.correctFill) {
      diagnostics.push(
        diagnostic(
          fillRange.from,
          fillRange.to,
          runtime.messages.fill,
          runtime.peek,
        ),
      );
    }
  }

  const valid = diagnostics.length === 0 && normalizedText === expectedSentence;

  return {
    diagnostics,
    revision,
    scenario: scenario ?? runtime.scenario,
    solved: valid,
    status: valid ? 'ready' : 'blocked',
    storyFile,
    summary: valid ? runtime.preview.validSummary : runtime.preview.invalidSummary,
    text,
    valid,
  };
}

function getFillRange(text: string, runtime: RuleTraceRuntime) {
  const from = runtime.sentence.prefix.length;
  const to = text.length - runtime.sentence.suffix.length;

  return {
    from,
    to,
  };
}

function normalizeText(text: string) {
  return text.replace(/\r\n/g, '\n').trim();
}

function diagnostic(from: number, to: number, message: string, peek: RulePeek): RuleTraceDiagnostic {
  return {
    from,
    message,
    peek,
    severity: 'error',
    source: 'Rule Trace',
    to: Math.max(from + 1, to),
  };
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
