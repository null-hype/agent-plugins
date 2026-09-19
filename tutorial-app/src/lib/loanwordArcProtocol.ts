export type LoanwordArcConfig = {
  lessonId: string;
  runtimeFile: string;
  scenario: string;
  storyFile: string;
  translationFile: string;
  vocabularyFile?: string;
};

export type LoanwordPeek = {
  explanation: string;
  snippet: string;
  source: string;
  title: string;
};

export type LoanwordPosition = {
  character: number;
  line: number;
};

export type LoanwordRange = {
  end: LoanwordPosition;
  start: LoanwordPosition;
};

export type LoanwordLossAxis = {
  message: string;
  name: string;
  title: string;
};

export type LoanwordDiagnostic = {
  code:
    | 'paraphrase-loss'
    | 'loanword-unadmitted'
    | 'vocabulary-entry-missing'
    | 'vocabulary-shape';
  data?: {
    peek?: LoanwordPeek;
  };
  filePath: string;
  message: string;
  range: LoanwordRange;
  severity: 'error' | 'warning';
  source: 'Loanword Protocol';
};

export type LoanwordPreviewState =
  | 'completed'
  | 'idle'
  | 'loanword-pending-admission'
  | 'paraphrase-loss';

export type LoanwordRuntime = {
  canonicalTranslation: string;
  completion: {
    message: string;
    title: string;
  };
  lessonId: string;
  lossAxes: LoanwordLossAxis[];
  messages: {
    empty: string;
    paraphraseLoss: string;
    pendingAdmission: string;
    vocabularyMissing: string;
    vocabularyShape: string;
  };
  peek: {
    translation: LoanwordPeek;
    vocabulary?: LoanwordPeek;
  };
  preview: {
    idleSummary: string;
    paraphraseLossSummary: string;
    pendingAdmissionSummary: string;
    validSummary: string;
  };
  requiresVocabularyAdmission: boolean;
  scenario: string;
  sourceLexeme: string;
  vocabulary?: {
    entryKey: string;
    requiredAdoptedAs: string;
  };
};

export type LoanwordValidationResult = {
  canonicalTranslation: string;
  diagnostics: LoanwordDiagnostic[];
  previewMode: 'static-log-with-completion';
  previewState: LoanwordPreviewState;
  solved: boolean;
  status: 'blocked' | 'idle' | 'ready';
  summary: string;
  text: string;
  valid: boolean;
};

export type LoanwordLessonState = LoanwordValidationResult & {
  revision: number;
  scenario: string;
  storyFile: string;
};

const DEFAULT_TRANSLATION_PEEK_SNIPPET = `module LoanwordRules

class LossAxis {
  name: String
  title: String
  message: String
}

class LoanwordRule {
  sourceLexeme: String
  canonicalEnglish: String
  requiresVocabularyAdmission: Boolean
  axes: Listing<LossAxis>
}

loanword = new LoanwordRule {
  sourceLexeme = "Fingerspitzengefühl"
  canonicalEnglish = "Fingerspitzengefühl"
  requiresVocabularyAdmission = false
}`;

const DEFAULT_VOCABULARY_PEEK_SNIPPET = `module PersonalVocabulary

class LoanwordEntry {
  surface: String
  adoptedAs: String = "EnglishLoanword"
  sourceLanguage: String = "German"
  note: String = ""
}

entries = new Mapping<String, LoanwordEntry> {
  ["Schadenfreude"] = new LoanwordEntry {
    surface = "Schadenfreude"
    adoptedAs = "EnglishLoanword"
  }
}`;

const DEFAULT_CONFIG: LoanwordArcConfig = {
  lessonId: 'fingerspitzengefuhl',
  runtimeFile: '/loanword-runtime.json',
  scenario: 'fingerspitzengefuhl-preservation',
  storyFile: '/warm-log-story.json',
  translationFile: '/translation.en',
  vocabularyFile: undefined,
};

const DEFAULT_RUNTIME: LoanwordRuntime = {
  canonicalTranslation: 'Fingerspitzengefühl',
  completion: {
    message: 'you solved this by preserving the word, not paraphrasing it',
    title: 'loanword(Fingerspitzengefühl) -> preserved',
  },
  lessonId: 'fingerspitzengefuhl',
  lossAxes: [
    {
      message: 'A gloss lexicalizes residue instead of preserving the imported surface.',
      name: 'lexicalization',
      title: 'lexicalization',
    },
    {
      message: 'The register carried by Gefühl exceeds feeling, tact, or intuition taken alone.',
      name: 'gefuhl_register',
      title: 'Gefühl register',
    },
    {
      message: 'The sharpened leading edge remembered by Spitzen is blunted in paraphrase.',
      name: 'spitzen_valence',
      title: 'Spitzen valence',
    },
    {
      message: 'The strategic and cultural lineage vanishes when the word is flattened into an English substitute.',
      name: 'lineage',
      title: 'lineage',
    },
  ],
  messages: {
    empty: 'Type an English attempt in `translation.en`.',
    paraphraseLoss:
      'Any gloss still drops lexicalization, Gefühl register, Spitzen valence, and lineage. Preserve `Fingerspitzengefühl` directly.',
    pendingAdmission:
      '`Fingerspitzengefühl` preserves the surface, but this lesson still blocks it until `PersonalVocabulary.pkl` admits the loanword.',
    vocabularyMissing:
      'Add the loanword to `entries` as a `LoanwordEntry` before this translation can pass.',
    vocabularyShape:
      'Finish the `LoanwordEntry` block so `PersonalVocabulary.pkl` can admit the loanword.',
  },
  peek: {
    translation: {
      explanation:
        'This lesson keeps one aggregate rule: paraphrase causes structural loss, so the valid English output is the preserved German surface.',
      snippet: DEFAULT_TRANSLATION_PEEK_SNIPPET,
      source: 'LoanwordRules.pkl',
      title: 'Peek: LoanwordRules.pkl',
    },
    vocabulary: {
      explanation:
        'Lesson 2 adds a second gate: the preserved surface must also be admitted into `PersonalVocabulary.pkl`.',
      snippet: DEFAULT_VOCABULARY_PEEK_SNIPPET,
      source: 'PersonalVocabulary.pkl',
      title: 'Peek: PersonalVocabulary.pkl',
    },
  },
  preview: {
    idleSummary: 'loanword(Fingerspitzengefühl) awaiting attempt',
    paraphraseLossSummary: 'loanword(Fingerspitzengefühl) -> loss axes',
    pendingAdmissionSummary: 'loanword(Fingerspitzengefühl) -> pending admission',
    validSummary: 'loanword(Fingerspitzengefühl) -> preserved',
  },
  requiresVocabularyAdmission: false,
  scenario: 'fingerspitzengefuhl-preservation',
  sourceLexeme: 'Fingerspitzengefühl',
};

export function resolveLoanwordArcConfig(customValue: unknown): LoanwordArcConfig | null {
  if (!customValue || typeof customValue !== 'object') {
    return null;
  }

  const record = customValue as Record<string, unknown>;
  const loanwordArc = record.loanwordArc;

  if (!loanwordArc || typeof loanwordArc !== 'object') {
    return null;
  }

  const loanwordArcRecord = loanwordArc as Record<string, unknown>;

  return {
    lessonId: readString(loanwordArcRecord.lessonId, DEFAULT_CONFIG.lessonId),
    runtimeFile: readString(loanwordArcRecord.runtimeFile, DEFAULT_CONFIG.runtimeFile),
    scenario: readString(loanwordArcRecord.scenario, DEFAULT_CONFIG.scenario),
    storyFile: readString(loanwordArcRecord.storyFile, DEFAULT_CONFIG.storyFile),
    translationFile: readString(loanwordArcRecord.translationFile, DEFAULT_CONFIG.translationFile),
    vocabularyFile: readOptionalString(loanwordArcRecord.vocabularyFile),
  };
}

export function parseLoanwordRuntime(value: string | Uint8Array | undefined): LoanwordRuntime {
  if (typeof value !== 'string') {
    return DEFAULT_RUNTIME;
  }

  try {
    const parsed = JSON.parse(value) as Partial<LoanwordRuntime>;

    return {
      canonicalTranslation: parsed.canonicalTranslation ?? parsed.sourceLexeme ?? DEFAULT_RUNTIME.canonicalTranslation,
      completion: {
        message: parsed.completion?.message ?? DEFAULT_RUNTIME.completion.message,
        title: parsed.completion?.title ?? DEFAULT_RUNTIME.completion.title,
      },
      lessonId: parsed.lessonId ?? DEFAULT_RUNTIME.lessonId,
      lossAxes:
        Array.isArray(parsed.lossAxes) && parsed.lossAxes.length > 0
          ? parsed.lossAxes.map((axis) => ({
              message:
                typeof axis?.message === 'string' && axis.message.length > 0
                  ? axis.message
                  : 'Loss axis message.',
              name: typeof axis?.name === 'string' && axis.name.length > 0 ? axis.name : 'loss_axis',
              title: typeof axis?.title === 'string' && axis.title.length > 0 ? axis.title : 'loss axis',
            }))
          : DEFAULT_RUNTIME.lossAxes,
      messages: {
        empty: parsed.messages?.empty ?? DEFAULT_RUNTIME.messages.empty,
        paraphraseLoss: parsed.messages?.paraphraseLoss ?? DEFAULT_RUNTIME.messages.paraphraseLoss,
        pendingAdmission: parsed.messages?.pendingAdmission ?? DEFAULT_RUNTIME.messages.pendingAdmission,
        vocabularyMissing: parsed.messages?.vocabularyMissing ?? DEFAULT_RUNTIME.messages.vocabularyMissing,
        vocabularyShape: parsed.messages?.vocabularyShape ?? DEFAULT_RUNTIME.messages.vocabularyShape,
      },
      peek: {
        translation: {
          explanation:
            parsed.peek?.translation?.explanation ?? DEFAULT_RUNTIME.peek.translation.explanation,
          snippet: parsed.peek?.translation?.snippet ?? DEFAULT_RUNTIME.peek.translation.snippet,
          source: parsed.peek?.translation?.source ?? DEFAULT_RUNTIME.peek.translation.source,
          title: parsed.peek?.translation?.title ?? DEFAULT_RUNTIME.peek.translation.title,
        },
        vocabulary: parsed.peek?.vocabulary
          ? {
              explanation:
                parsed.peek.vocabulary.explanation ?? DEFAULT_RUNTIME.peek.vocabulary?.explanation ?? '',
              snippet: parsed.peek.vocabulary.snippet ?? DEFAULT_RUNTIME.peek.vocabulary?.snippet ?? '',
              source: parsed.peek.vocabulary.source ?? DEFAULT_RUNTIME.peek.vocabulary?.source ?? '',
              title: parsed.peek.vocabulary.title ?? DEFAULT_RUNTIME.peek.vocabulary?.title ?? '',
            }
          : DEFAULT_RUNTIME.peek.vocabulary,
      },
      preview: {
        idleSummary: parsed.preview?.idleSummary ?? DEFAULT_RUNTIME.preview.idleSummary,
        paraphraseLossSummary:
          parsed.preview?.paraphraseLossSummary ?? DEFAULT_RUNTIME.preview.paraphraseLossSummary,
        pendingAdmissionSummary:
          parsed.preview?.pendingAdmissionSummary ?? DEFAULT_RUNTIME.preview.pendingAdmissionSummary,
        validSummary: parsed.preview?.validSummary ?? DEFAULT_RUNTIME.preview.validSummary,
      },
      requiresVocabularyAdmission:
        typeof parsed.requiresVocabularyAdmission === 'boolean'
          ? parsed.requiresVocabularyAdmission
          : DEFAULT_RUNTIME.requiresVocabularyAdmission,
      scenario: parsed.scenario ?? DEFAULT_RUNTIME.scenario,
      sourceLexeme: parsed.sourceLexeme ?? DEFAULT_RUNTIME.sourceLexeme,
      vocabulary: parsed.vocabulary
        ? {
            entryKey: parsed.vocabulary.entryKey ?? DEFAULT_RUNTIME.vocabulary?.entryKey ?? '',
            requiredAdoptedAs:
              parsed.vocabulary.requiredAdoptedAs ??
              DEFAULT_RUNTIME.vocabulary?.requiredAdoptedAs ??
              'EnglishLoanword',
          }
        : undefined,
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

export async function validateLoanwordLesson(options: {
  lessonId: string;
  runtime: LoanwordRuntime;
  translationFile: string;
  translationText: string;
  vocabularyFile?: string;
  vocabularyText?: string;
}): Promise<LoanwordValidationResult> {
  const { runtime, translationFile, translationText, vocabularyFile, vocabularyText = '' } = options;
  const normalizedTranslation = normalizeText(translationText);
  const canonicalTranslation = runtime.canonicalTranslation || runtime.sourceLexeme;

  if (!normalizedTranslation) {
    return {
      canonicalTranslation,
      diagnostics: [],
      previewMode: 'static-log-with-completion',
      previewState: 'idle',
      solved: false,
      status: 'idle',
      summary: runtime.preview.idleSummary,
      text: translationText,
      valid: false,
    };
  }

  if (normalizedTranslation !== canonicalTranslation) {
    return {
      canonicalTranslation,
      diagnostics: [
        createDiagnostic({
          code: 'paraphrase-loss',
          filePath: translationFile,
          message: runtime.messages.paraphraseLoss,
          peek: runtime.peek.translation,
          range: getTrimmedRange(translationText),
        }),
      ],
      previewMode: 'static-log-with-completion',
      previewState: 'paraphrase-loss',
      solved: false,
      status: 'blocked',
      summary: runtime.preview.paraphraseLossSummary,
      text: translationText,
      valid: false,
    };
  }

  if (!runtime.requiresVocabularyAdmission) {
    return {
      canonicalTranslation,
      diagnostics: [],
      previewMode: 'static-log-with-completion',
      previewState: 'completed',
      solved: true,
      status: 'ready',
      summary: runtime.preview.validSummary,
      text: translationText,
      valid: true,
    };
  }

  const vocabularyGate = inspectVocabulary(vocabularyText, runtime, vocabularyFile);

  if (vocabularyGate.valid) {
    return {
      canonicalTranslation,
      diagnostics: [],
      previewMode: 'static-log-with-completion',
      previewState: 'completed',
      solved: true,
      status: 'ready',
      summary: runtime.preview.validSummary,
      text: translationText,
      valid: true,
    };
  }

  const diagnostics: LoanwordDiagnostic[] = [
    createDiagnostic({
      code: 'loanword-unadmitted',
      filePath: translationFile,
      message: runtime.messages.pendingAdmission,
      peek: runtime.peek.translation,
      range: getTrimmedRange(translationText),
    }),
  ];

  if (vocabularyGate.diagnostic) {
    diagnostics.push(vocabularyGate.diagnostic);
  }

  return {
    canonicalTranslation,
    diagnostics,
    previewMode: 'static-log-with-completion',
    previewState: 'loanword-pending-admission',
    solved: false,
    status: 'blocked',
    summary: runtime.preview.pendingAdmissionSummary,
    text: translationText,
    valid: false,
  };
}

type InspectVocabularyResult =
  | { valid: true }
  | {
      diagnostic: LoanwordDiagnostic;
      valid: false;
    };

function inspectVocabulary(
  vocabularyText: string,
  runtime: LoanwordRuntime,
  vocabularyFile?: string,
): InspectVocabularyResult {
  if (!runtime.vocabulary || !vocabularyFile) {
    return { valid: true };
  }

  const { entryKey, requiredAdoptedAs } = runtime.vocabulary;
  const entryMarker = `["${entryKey}"]`;
  const markerIndex = vocabularyText.indexOf(entryMarker);

  if (markerIndex === -1) {
    return {
      diagnostic: createDiagnostic({
        code: 'vocabulary-entry-missing',
        filePath: vocabularyFile,
        message: runtime.messages.vocabularyMissing,
        peek: runtime.peek.vocabulary,
        range: getVocabularyAnchorRange(vocabularyText),
      }),
      valid: false,
    };
  }

  const blockStart = vocabularyText.indexOf('{', markerIndex);

  if (blockStart === -1) {
    return {
      diagnostic: createDiagnostic({
        code: 'vocabulary-shape',
        filePath: vocabularyFile,
        message: runtime.messages.vocabularyShape,
        peek: runtime.peek.vocabulary,
        range: rangeFromOffsets(vocabularyText, markerIndex, markerIndex + entryMarker.length),
      }),
      valid: false,
    };
  }

  const block = extractBracedBlock(vocabularyText, blockStart);

  if (!block) {
    return {
      diagnostic: createDiagnostic({
        code: 'vocabulary-shape',
        filePath: vocabularyFile,
        message: runtime.messages.vocabularyShape,
        peek: runtime.peek.vocabulary,
        range: rangeFromOffsets(vocabularyText, markerIndex, markerIndex + entryMarker.length),
      }),
      valid: false,
    };
  }

  if (!/\bnew\s+LoanwordEntry\b/.test(vocabularyText.slice(markerIndex, blockStart))) {
    return {
      diagnostic: createDiagnostic({
        code: 'vocabulary-shape',
        filePath: vocabularyFile,
        message: runtime.messages.vocabularyShape,
        peek: runtime.peek.vocabulary,
        range: rangeFromOffsets(vocabularyText, markerIndex, markerIndex + entryMarker.length),
      }),
      valid: false,
    };
  }

  const explicitAdoption = new RegExp(
    String.raw`\badoptedAs\s*=\s*"([^"]+)"`,
  ).exec(block);

  if (explicitAdoption && explicitAdoption[1] !== requiredAdoptedAs) {
    return {
      diagnostic: createDiagnostic({
        code: 'vocabulary-shape',
        filePath: vocabularyFile,
        message: runtime.messages.vocabularyShape,
        peek: runtime.peek.vocabulary,
        range: rangeFromOffsets(vocabularyText, blockStart, blockStart + block.length),
      }),
      valid: false,
    };
  }

  return { valid: true };
}

function createDiagnostic(options: {
  code: LoanwordDiagnostic['code'];
  filePath: string;
  message: string;
  peek?: LoanwordPeek;
  range: LoanwordRange;
}): LoanwordDiagnostic {
  const { code, filePath, message, peek, range } = options;

  return {
    code,
    data: peek ? { peek } : undefined,
    filePath,
    message,
    range,
    severity: 'error',
    source: 'Loanword Protocol',
  };
}

function getVocabularyAnchorRange(text: string) {
  const anchorMatch = /entries\s*=/.exec(text);

  if (!anchorMatch || anchorMatch.index === undefined) {
    return rangeFromOffsets(text, 0, Math.max(1, text.length ? 1 : 0));
  }

  return rangeFromOffsets(text, anchorMatch.index, anchorMatch.index + 'entries'.length);
}

function getTrimmedRange(text: string) {
  const startMatch = text.match(/\S/);

  if (!startMatch || startMatch.index === undefined) {
    return {
      end: { character: 1, line: 0 },
      start: { character: 0, line: 0 },
    };
  }

  const endMatch = /\S\s*$/.exec(text);
  const endIndex = endMatch?.index ?? startMatch.index;

  return rangeFromOffsets(text, startMatch.index, Math.max(startMatch.index + 1, endIndex + 1));
}

function rangeFromOffsets(text: string, from: number, to: number): LoanwordRange {
  return {
    end: positionFromOffset(text, Math.max(from + 1, to)),
    start: positionFromOffset(text, from),
  };
}

function positionFromOffset(text: string, offset: number): LoanwordPosition {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastLineStart = 0;

  for (let index = 0; index < safeOffset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
      lastLineStart = index + 1;
    }
  }

  return {
    character: safeOffset - lastLineStart,
    line,
  };
}

function extractBracedBlock(text: string, startIndex: number) {
  let depth = 0;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function normalizeText(text: string) {
  return text.replace(/\r\n/g, '\n').trim();
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
