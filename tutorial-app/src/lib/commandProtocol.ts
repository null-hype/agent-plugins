export type CommandProtocolConfig = {
  commandFile: string;
  intent: string;
  protocolFile: string;
  runtimeFile: string;
};

export type CommandProtocolRuntime = {
  intent: string;
  command: {
    article: string;
    noun: string;
    punctuation: string;
    verb: string;
  };
  messages: {
    article: string;
    empty: string;
    noun: string;
    punctuation: string;
    shape: string;
    verb: string;
  };
  preview: {
    invalidSummary: string;
    validSummary: string;
  };
};

export type CommandProtocolDiagnostic = {
  from: number;
  message: string;
  severity: 'error' | 'info' | 'warning';
  source: 'Command Protocol';
  to: number;
};

export type CommandProtocolState = {
  diagnostics: CommandProtocolDiagnostic[];
  intent?: string;
  revision: number;
  status: 'blocked' | 'idle' | 'ready';
  summary: string;
  text: string;
  valid: boolean;
};

const DEFAULT_CONFIG: CommandProtocolConfig = {
  commandFile: '/exercise.de',
  intent: 'run_app',
  protocolFile: '/CommandProtocol.pkl',
  runtimeFile: '/command-protocol.json',
};

const DEFAULT_RUNTIME: CommandProtocolRuntime = {
  intent: 'run_app',
  command: {
    article: 'die',
    noun: 'App',
    punctuation: '.',
    verb: 'Starte',
  },
  messages: {
    article: 'Use `die` so the command resolves to a valid run instruction.',
    empty: 'Write the German command before the agent can act.',
    noun: 'Target the shared app resource by writing `App`.',
    punctuation: 'Finish the command with a period so the instruction parses cleanly.',
    shape: 'The command shape for this lesson is `Starte die App.`',
    verb: 'Start the instruction with `Starte`.',
  },
  preview: {
    invalidSummary: 'run(app) blocked',
    validSummary: 'run(app) -> ok',
  },
};

type Token = {
  from: number;
  to: number;
  value: string;
};

export function resolveCommandProtocolConfig(customValue: unknown): CommandProtocolConfig | null {
  if (!customValue || typeof customValue !== 'object') {
    return null;
  }

  const record = customValue as Record<string, unknown>;
  const commandProtocol = record.commandProtocol;

  if (!commandProtocol || typeof commandProtocol !== 'object') {
    return null;
  }

  const protocolRecord = commandProtocol as Record<string, unknown>;

  return {
    commandFile: readString(protocolRecord.commandFile, DEFAULT_CONFIG.commandFile),
    intent: readString(protocolRecord.intent, DEFAULT_CONFIG.intent),
    protocolFile: readString(protocolRecord.protocolFile, DEFAULT_CONFIG.protocolFile),
    runtimeFile: readString(protocolRecord.runtimeFile, DEFAULT_CONFIG.runtimeFile),
  };
}

export function parseCommandProtocolRuntime(value: string | Uint8Array | undefined): CommandProtocolRuntime {
  if (typeof value !== 'string') {
    return DEFAULT_RUNTIME;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CommandProtocolRuntime>;

    return {
      intent: parsed.intent ?? DEFAULT_RUNTIME.intent,
      command: {
        article: parsed.command?.article ?? DEFAULT_RUNTIME.command.article,
        noun: parsed.command?.noun ?? DEFAULT_RUNTIME.command.noun,
        punctuation: parsed.command?.punctuation ?? DEFAULT_RUNTIME.command.punctuation,
        verb: parsed.command?.verb ?? DEFAULT_RUNTIME.command.verb,
      },
      messages: {
        article: parsed.messages?.article ?? DEFAULT_RUNTIME.messages.article,
        empty: parsed.messages?.empty ?? DEFAULT_RUNTIME.messages.empty,
        noun: parsed.messages?.noun ?? DEFAULT_RUNTIME.messages.noun,
        punctuation: parsed.messages?.punctuation ?? DEFAULT_RUNTIME.messages.punctuation,
        shape: parsed.messages?.shape ?? DEFAULT_RUNTIME.messages.shape,
        verb: parsed.messages?.verb ?? DEFAULT_RUNTIME.messages.verb,
      },
      preview: {
        invalidSummary: parsed.preview?.invalidSummary ?? DEFAULT_RUNTIME.preview.invalidSummary,
        validSummary: parsed.preview?.validSummary ?? DEFAULT_RUNTIME.preview.validSummary,
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

export function buildCommandProtocolState(options: {
  revision: number;
  runtime: CommandProtocolRuntime;
  text: string;
}): CommandProtocolState {
  const { revision, runtime, text } = options;
  const trimmedText = text.trim();

  if (!trimmedText) {
    return {
      diagnostics: [
        diagnostic(0, 0, runtime.messages.empty),
      ],
      revision,
      status: 'idle',
      summary: runtime.preview.invalidSummary,
      text,
      valid: false,
    };
  }

  const tokens = tokenize(text);
  const expectedTokens = [
    runtime.command.verb,
    runtime.command.article,
    runtime.command.noun,
    runtime.command.punctuation,
  ];

  const diagnostics: CommandProtocolDiagnostic[] = [];

  if (tokens.length !== expectedTokens.length) {
    diagnostics.push(
      diagnostic(
        tokens[0]?.from ?? 0,
        tokens.at(-1)?.to ?? Math.max(trimmedText.length, 1),
        runtime.messages.shape,
      ),
    );
  }

  compareToken(tokens, 0, runtime.command.verb, runtime.messages.verb, diagnostics);
  compareToken(tokens, 1, runtime.command.article, runtime.messages.article, diagnostics);
  compareToken(tokens, 2, runtime.command.noun, runtime.messages.noun, diagnostics);
  compareToken(tokens, 3, runtime.command.punctuation, runtime.messages.punctuation, diagnostics);

  const valid =
    diagnostics.length === 0 &&
    tokens.length === expectedTokens.length &&
    tokens.every((token, index) => token.value === expectedTokens[index]);

  return {
    diagnostics,
    intent: valid ? runtime.intent : undefined,
    revision,
    status: valid ? 'ready' : 'blocked',
    summary: valid ? runtime.preview.validSummary : runtime.preview.invalidSummary,
    text,
    valid,
  };
}

function compareToken(
  tokens: Token[],
  index: number,
  expected: string,
  message: string,
  diagnostics: CommandProtocolDiagnostic[],
) {
  const token = tokens[index];

  if (!token) {
    const anchor = tokens.at(-1)?.to ?? 0;
    diagnostics.push(diagnostic(anchor, anchor, message));
    return;
  }

  if (token.value !== expected) {
    diagnostics.push(diagnostic(token.from, token.to, message));
  }
}

function tokenize(text: string) {
  const tokens: Token[] = [];
  const pattern = /[^\s.]+|\./g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    tokens.push({
      from: match.index,
      to: match.index + match[0].length,
      value: match[0],
    });
  }

  return tokens;
}

function diagnostic(from: number, to: number, message: string): CommandProtocolDiagnostic {
  return {
    from,
    message,
    severity: 'error',
    source: 'Command Protocol',
    to: Math.max(from + 1, to),
  };
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
