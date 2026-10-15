import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listStoryAgentReviews, loadStoryAgentReview, rejectStoryAgentReview } from '../services/story-agent-reviews.js';

function documentText(document) {
  const lines = [];
  const visit = node => {
    if (node.type === 'text') lines.push(node.text);
    else if (node.type === 'hardBreak') lines.push('\n');
    else { for (const child of node.content ?? []) visit(child); if (node.type === 'paragraph' || node.type === 'heading') lines.push('\n'); }
  };
  visit(document);
  return lines.join('');
}
export function StoryAgentPanel({ documentId, native, busy, options, onStage, onAdopt, onPending }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [rows, setRows] = useState([]), [review, setReview] = useState(null);
  const [status, setStatus] = useState('idle'), [working, setWorking] = useState(false);
  const sequence = useRef(0), input = useRef(null);
  const refresh = async () => {
    const seq = ++sequence.current;
    const next = await listStoryAgentReviews(documentId, options);
    if (seq !== sequence.current) return;
    setRows(next);
    if (next.length) setOpen(true);
    if (review && !next.some(r => r.reviewId === review.reviewId)) setReview(null);
  };
  useEffect(() => {
    setReview(null); setRows([]); setStatus('idle'); setWorking(false);
    if (native) void refresh().catch(() => setStatus('error'));
    return () => { sequence.current++; };
  }, [documentId, native]);
  const choose = async row => {
    const seq = ++sequence.current;
    setWorking(true);
    try { const value = await loadStoryAgentReview(row.reviewId, options);
      if (seq === sequence.current) { setReview(value); setStatus('review'); } }
    catch { if (seq === sequence.current) setStatus('error'); } finally { if (seq === sequence.current) setWorking(false); }
  };
  const importProposal = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setWorking(true);
    try {
      if (file.size > 24 * 1024 * 1024) throw new Error();
      const input = JSON.parse(await file.text());
      if (!input || Object.keys(input).length !== 1 || !Array.isArray(input.operations)) throw new Error();
      const staged = await onStage(input.operations);
      if (!staged) throw new Error();
      setReview(staged); setStatus('review'); await refresh();
    } catch { setStatus('error'); } finally { setWorking(false); }
  };
  const adopt = async () => {
    setWorking(true); onPending(true);
    try {
      if (!await onAdopt(review)) throw new Error('story_review_editor_busy');
      setReview(null); setStatus('adopted'); onPending(false); await refresh();
    } catch (error) {
      const code = String(error?.message ?? error);
      if (['story_review_editor_changed', 'stale_story_workspace_revision', 'stale_story_history_selection',
        'stale_story_branch_head', 'stale_story_proposal_base'].some(value => code.includes(value))) {
        setStatus('stale'); onPending(false);
      } else {
        setStatus('uncertain');
        // The durable native record resolves committed outcomes after relaunch.
      }
    } finally { setWorking(false); }
  };
  const reject = async () => {
    setWorking(true);
    try { await rejectStoryAgentReview(review.reviewId, options); setReview(null); onPending(false); setStatus('idle'); await refresh(); }
    catch { setStatus('error'); } finally { setWorking(false); }
  };
  if (!native) return null;
  const disabled = busy || working;
  return <aside className="story-agent-panel" aria-label={t('storyAgent.title')} data-testid="story-agent-panel">
    <button type="button" className="story-agent-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span aria-hidden="true">✧</span> {t('storyAgent.title')}{rows.length ? ` · ${rows.length}` : ''}
    </button>
    {open ? <div className="story-agent-content">
      <header><strong>{t('storyAgent.title')}</strong><span title={t('storyAgent.hint')} aria-label={t('storyAgent.hint')}>ⓘ</span>
        <button type="button" title={t('storyAgent.refresh')} aria-label={t('storyAgent.refresh')} disabled={disabled} onClick={() => void refresh().catch(() => setStatus('error'))}>↻</button>
        <button type="button" title={t('storyAgent.import')} aria-label={t('storyAgent.import')} disabled={disabled || status === 'uncertain'} onClick={() => input.current?.click()}>↥</button>
        <input ref={input} type="file" accept="application/json,.json" aria-label={t('storyAgent.import')} onChange={importProposal} hidden />
      </header>
      <p role="status">{t(`storyAgent.status.${status}`)}</p>
      {!rows.length && !review ? <p>{t('storyAgent.empty')}</p> : null}
      <div className="story-agent-list">{rows.map((row, index) => <button type="button" key={row.reviewId} disabled={disabled || status === 'uncertain'}
        aria-pressed={review?.reviewId === row.reviewId} onClick={() => void choose(row)}>{t('storyAgent.proposal', { count: index + 1 })}{row.status === 'attempting' ? ' ⟳' : ''}</button>)}</div>
      {review ? <section aria-label={t('storyAgent.review')}>
        <div className="story-agent-diff"><div><h4>{t('storyAgent.before')}</h4><pre>{documentText(review.before.document)}</pre></div>
          <div><h4>{t('storyAgent.after')}</h4><pre>{documentText(review.after.document)}</pre></div></div>
        <details><summary>{t('storyAgent.structure')}</summary><pre>{JSON.stringify(JSON.parse(review.proposal.commandJson).operations, null, 2)}</pre></details>
        <footer><button type="button" disabled={disabled} onClick={() => void reject()}>{t('storyAgent.reject')}</button>
          <button type="button" disabled={disabled || status === 'stale'} onClick={() => void adopt()}>{t(status === 'uncertain' || review.status === 'attempting' ? 'storyAgent.retry' : 'storyAgent.adopt')}</button></footer>
      </section> : null}
    </div> : null}
  </aside>;
}
