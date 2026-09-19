import React, { useState, useEffect } from 'react';
import './GrammarTutor.css';

// Mocked data that would be generated from src/data/GermanGrammar.pkl
const grammarDB = {
	helfen: {
		infinitve: "helfen",
		requiresCase: "Dative",
		exampleCorrect: "Ich helfe dem Mann.",
		explanation: "The verb 'helfen' (to help) always takes a dative object. You are providing help 'to' someone."
	},
	danken: {
		infinitve: "danken",
		requiresCase: "Dative",
		exampleCorrect: "Ich danke dir.",
		explanation: "Gratitude in German is directed 'to' a person, requiring the dative case."
	}
};

type LessonStep = {
	instruction: string;
	initialValue: string;
	correctValue: string;
	errorToken: string;
	verb: keyof typeof grammarDB;
};

const lessonSteps: LessonStep[] = [
	{
		instruction: "Task: Translate 'I help my brother.' Note that 'Bruder' is masculine.",
		initialValue: "Ich helfe meinen Bruder.",
		correctValue: "Ich helfe meinem Bruder.",
		errorToken: "meinen",
		verb: "helfen"
	},
	{
		instruction: "Task: Try using the verb 'danken' (to thank).",
		initialValue: "Ich danke dich.",
		correctValue: "Ich danke dir.",
		errorToken: "dich",
		verb: "danken"
	}
];

export default function GrammarTutor() {
	const [stepIndex, setStepIndex] = useState(0);
	const [inputValue, setInputValue] = useState(lessonSteps[0].initialValue);
	const [showDiagnostic, setShowDiagnostic] = useState(false);
	const [showHover, setShowHover] = useState(false);
	const [showPeek, setShowPeek] = useState(false);
	const [isFixed, setIsFixed] = useState(false);

	const step = lessonSteps[stepIndex];
	const verbInfo = grammarDB[step.verb];

	// Reset state when step changes
	useEffect(() => {
		setInputValue(step.initialValue);
		setShowDiagnostic(false);
		setShowHover(false);
		setShowPeek(false);
		setIsFixed(false);
	}, [stepIndex]);

	const handleNextStep = () => {
		setStepIndex((prev) => (prev + 1) % lessonSteps.length);
	};

	const applyFix = () => {
		setInputValue(step.correctValue);
		setIsFixed(true);
		setShowDiagnostic(false);
		setShowHover(false);
		setShowPeek(false);
	};

	return (
		<div className="grammar-tutor">
			<div className="tutor-sidebar">
				<div className="tutor-lesson-meta">
					<h3>LSP Tutor: Dative Verbs</h3>
					<p>{step.instruction}</p>
				</div>
				<nav className="tutor-steps">
					{lessonSteps.map((_, i) => (
						<button
							key={i}
							className={i === stepIndex ? 'active' : ''}
							onClick={() => setStepIndex(i)}
						>
							Step {i + 1}
						</button>
					))}
				</nav>
			</div>

			<div className="tutor-main">
				<header className="tutor-editor-header">
					<div className="tab active">exercise.de</div>
					<div className="editor-actions">
						{!showDiagnostic && !isFixed && (
							<button className="run-btn" onClick={() => setShowDiagnostic(true)}>
								<span className="material-symbols-outlined">play_arrow</span> Run Check
							</button>
						)}
						{isFixed && (
							<button className="next-btn" onClick={handleNextStep}>
								Next Lesson <span className="material-symbols-outlined">arrow_forward</span>
							</button>
						)}
					</div>
				</header>

				<div className="tutor-editor-area">
					<div className="line">
						<span className="ln">1</span>
						<div className="content">
							{inputValue.split(' ').map((word, i) => (
								<span
									key={i}
									className={`word ${showDiagnostic && word === step.errorToken ? 'error-squiggle' : ''}`}
									onMouseEnter={() => showDiagnostic && word === step.errorToken && setShowHover(true)}
								>
									{word}{' '}
								</span>
							))}

							{showHover && (
								<div className="tutor-tooltip" onMouseLeave={() => setShowHover(false)}>
									<div className="tooltip-title">LSP: Dative Requirement Detected</div>
									<div className="tooltip-body">
										<p>The verb <strong>'{verbInfo.infinitve}'</strong> requires a <strong>{verbInfo.requiresCase}</strong> object.</p>
										<p className="explanation">{verbInfo.explanation}</p>
									</div>
									<div className="tooltip-actions">
										<button onClick={() => { setShowPeek(true); setShowHover(false); }}>Peek Grammar Rule</button>
										<button onClick={applyFix}>Quick Fix</button>
									</div>
								</div>
							)}
						</div>
					</div>

					{showPeek && (
						<div className="tutor-peek">
							<div className="peek-header">
								<span>src/data/GermanGrammar.pkl</span>
								<button onClick={() => setShowPeek(false)}>×</button>
							</div>
							<pre>
{`class Verb {
  infinitve = "${verbInfo.infinitve}"
  requiresCase = Case.${verbInfo.requiresCase}
  example = "${verbInfo.exampleCorrect}"
}`}
							</pre>
						</div>
					)}
				</div>

				<footer className="tutor-footer">
					<div className="status">
						<span className="material-symbols-outlined">terminal</span>
						Grammar Server: {showDiagnostic ? '1 error found' : 'Ready'}
					</div>
				</footer>
			</div>
		</div>
	);
}
