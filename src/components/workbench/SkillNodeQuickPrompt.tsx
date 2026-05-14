import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SkillNodeKind } from '../../lib/skillFlowGraphV2';
import './skill-flow.css';

export type SkillNodeQuickPromptProps = {
  kind: SkillNodeKind;
  screenX: number;
  screenY: number;
  onCancel: () => void;
  onCreateBlank: () => void;
  onGenerate: (idea: string) => void;
};

export default function SkillNodeQuickPrompt({
  kind,
  screenX,
  screenY,
  onCancel,
  onCreateBlank,
  onGenerate,
}: SkillNodeQuickPromptProps) {
  const [idea, setIdea] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el?.contains(e.target as Node)) onCancel();
    };
    window.addEventListener('mousedown', onPointer, true);
    return () => window.removeEventListener('mousedown', onPointer, true);
  }, [onCancel]);

  const submit = useCallback(() => {
    onGenerate(idea);
  }, [idea, onGenerate]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const ui = (
    <>
      <button type="button" className="skill-node-kind-radial-backdrop" aria-hidden tabIndex={-1} onClick={onCancel} />
      <div
        ref={rootRef}
        className="skill-node-quick-prompt"
        role="dialog"
        aria-label="Describe the new node"
        style={{
          position: 'fixed',
          left: Math.min(screenX, typeof window !== 'undefined' ? window.innerWidth - 340 : screenX),
          top: Math.min(screenY, typeof window !== 'undefined' ? window.innerHeight - 280 : screenY),
          zIndex: 10120,
          transform: 'translate(-12px, -12px)',
        }}
      >
        <div className="skill-node-quick-prompt__title">New {kind}</div>
        <p className="skill-node-quick-prompt__hint">What should this node do?</p>
        <textarea
          ref={taRef}
          className="skill-node-quick-prompt__input input"
          rows={4}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Rough idea — AI will structure it"
        />
        <div className="skill-node-quick-prompt__actions">
          <button type="button" className="btn-secondary btn-compact" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-secondary btn-compact" onClick={onCreateBlank}>
            Create blank
          </button>
          <button type="button" className="btn-primary btn-compact" onClick={submit}>
            Generate
          </button>
        </div>
        <p className="skill-node-quick-prompt__footer">Enter to generate · Esc to cancel</p>
      </div>
    </>
  );

  return createPortal(ui, document.body);
}
