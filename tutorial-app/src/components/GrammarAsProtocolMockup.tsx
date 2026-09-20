import React, { useState } from 'react';
import './GrammarAsProtocolMockup.css';

export type MockupState = 'baseline' | 'diagnostic' | 'hover' | 'peek' | 'fix';

export default function GrammarAsProtocolMockup() {
	const [state, setState] = useState<MockupState>('baseline');
	const [isFixed, setIsFixed] = useState(false);

	const nextState = () => {
		const states: MockupState[] = ['baseline', 'diagnostic', 'hover', 'peek', 'fix'];
		const nextIndex = (states.indexOf(state) + 1) % states.length;
		setState(states[nextIndex]);
	};

	const applyFix = () => {
		setIsFixed(true);
		setState('baseline');
	};

	return (
		<div className="grammar-mockup" data-state={state}>
			<header className="grammar-mockup-header">
				<div className="grammar-mockup-tabs">
					<div className="grammar-mockup-tab active">
						<span className="material-symbols-outlined">language</span>
						sentence.de
					</div>
				</div>
				<div className="grammar-mockup-controls">
					<button onClick={nextState}>
						Next State <span className="material-symbols-outlined">arrow_forward</span>
					</button>
				</div>
			</header>

			<div className="grammar-mockup-body">
				<aside className="grammar-mockup-sidebar">
					<div className="sidebar-section">RULES</div>
					<div className="sidebar-item active">dative_verbs.pkl</div>
					<div className="sidebar-item">cases.pkl</div>
					<div className="sidebar-item">articles.pkl</div>
				</aside>

				<main className="grammar-mockup-editor">
					<div className="editor-line">
						<span className="line-number">1</span>
						<div className="line-content">
							Ich helfe{' '}
							<span className={`token ${state !== 'baseline' && !isFixed ? 'error' : ''}`}>
								{isFixed ? 'meinem' : 'meinen'}
							</span>{' '}
							Bruder.
							{state === 'fix' && !isFixed && (
								<div className="lightbulb" onClick={applyFix}>
									<span className="material-symbols-outlined">lightbulb</span>
								</div>
							)}
							{state === 'hover' && (
								<div className="tooltip">
									<div className="tooltip-header">Grammar (Dative Case)</div>
									<div className="tooltip-row">
										<span>Inferred</span>
										<span className="value error">Accusative</span>
									</div>
									<div className="tooltip-row">
										<span>Required</span>
										<span className="value accent">Dative</span>
									</div>
									<p className="tooltip-detail">
										Verb 'helfen' requires dative case.
									</p>
									<div className="tooltip-actions">
										<button onClick={() => setState('peek')}>Peek Rule</button>
										<button>Go to Definition</button>
									</div>
								</div>
							)}
						</div>
					</div>

					{state === 'peek' && (
						<div className="peek-panel">
							<div className="peek-header">
								<span>dative_verbs.pkl</span>
								<button onClick={() => setState('diagnostic')}>×</button>
							</div>
							<pre className="peek-content">
								{`rule dative_verbs {
  verbs = ["helfen", "danken", ...]
  requires = object.case == Dative
}`}
							</pre>
						</div>
					)}
				</main>

				<div className="grammar-mockup-minimap">
					<div className="minimap-lane"></div>
					{state !== 'baseline' && !isFixed && <div className="minimap-error"></div>}
				</div>
			</div>

			<footer className="grammar-mockup-status">
				<div className="status-left">
					<span className="material-symbols-outlined">sync</span>
					German Grammar Server: connected
				</div>
				<div className="status-right">
					<span>German (DE)</span>
					<span>UTF-8</span>
				</div>
			</footer>
		</div>
	);
}
