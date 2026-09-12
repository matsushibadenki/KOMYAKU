import { useEffect, useState } from "react";
import { VersionLineageGraph } from "./VersionLineageGraph.jsx";

export function LocalVersionHistory({ history, available, status, onCreateInitial, onSaveNamed,
  onCreateAlternative, onRestore, onLoadOlder, onExport, exportStatus, onCompare, comparison,
  comparisonStatus, locale, labels }) {
  const [label, setLabel] = useState("");
  const [branchName, setBranchName] = useState("");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [visibleVersionCount, setVisibleVersionCount] = useState(10);
  const currentBranch = history?.branches.find(({ id }) => id === history.currentBranchId) ?? null;
  const busy = status === "saving" || status === "loading";

  useEffect(() => {
    const versions = history?.versions ?? [];
    setCompareFrom((current) => versions.some(({ id }) => id === current) ? current : versions[1]?.id ?? "");
    setCompareTo((current) => versions.some(({ id }) => id === current) ? current : versions[0]?.id ?? "");
  }, [history]);

  useEffect(() => { setVisibleVersionCount(10); }, [history?.documentId]);

  const submitNamed = async (event) => {
    event.preventDefault();
    if (await onSaveNamed(label)) setLabel("");
  };
  const submitAlternative = async (event) => {
    event.preventDefault();
    if (await onCreateAlternative(branchName, label)) {
      setBranchName("");
      setLabel("");
    }
  };
  const showOlderVersions = async () => {
    if (visibleVersionCount < history.versions.length) {
      setVisibleVersionCount((count) => count + 10);
      return;
    }
    if (history.nextCursor && await onLoadOlder()) {
      setVisibleVersionCount((count) => count + 10);
    }
  };

  return (
    <section className="version-history" aria-labelledby="version-history-title">
      <div className="version-history-heading">
        <div>
          <p className="section-kicker">{labels.kicker}</p>
          <h2 id="version-history-title" tabIndex={-1}>{labels.title}</h2>
          <p>{labels.description}</p>
        </div>
        <p className="persistence-status" role="status" data-state={status}>
          {labels.status[status] ?? labels.status.idle}
        </p>
      </div>

      {!available ? <p>{labels.desktopOnly}</p> : null}
      {available && history && history.versions.length === 0 ? (
        <button type="button" className="version-primary-action" disabled={busy} onClick={onCreateInitial}>
          {labels.createInitial}
        </button>
      ) : null}
      {available && history?.currentVersionId ? (
        <>
          <dl className="version-current">
            <div><dt>{labels.currentBranch}</dt><dd>{currentBranch?.name ?? "—"}</dd></div>
            <div><dt>{labels.currentVersion}</dt><dd><code>{history.currentVersionId.slice(0, 12)}</code></dd></div>
          </dl>
          <div className="version-actions">
            <form onSubmit={submitNamed}>
              <label><span>{labels.versionLabel}</span>
                <input value={label} maxLength={1000} onChange={(event) => setLabel(event.target.value)}
                  placeholder={labels.versionLabelPlaceholder} />
              </label>
              <button type="submit" disabled={busy}>{labels.saveNamed}</button>
            </form>
            <form onSubmit={submitAlternative}>
              <label><span>{labels.branchName}</span>
                <input required value={branchName} maxLength={200}
                  onChange={(event) => setBranchName(event.target.value)} placeholder={labels.branchPlaceholder} />
              </label>
              <button type="submit" disabled={busy}>{labels.createAlternative}</button>
            </form>
          </div>
          <VersionLineageGraph versions={history.versions.slice(0, visibleVersionCount)}
            branches={history.branches} currentBranchId={history.currentBranchId}
            currentVersionId={history.currentVersionId} busy={busy} locale={locale}
            onRestore={onRestore} labels={labels} />
          {visibleVersionCount < history.versions.length || history.nextCursor ? (
            <button type="button" className="version-load-older" disabled={busy}
              onClick={() => { void showOlderVersions(); }}>
              {labels.loadOlder}
            </button>
          ) : null}
          <div className="version-compare">
            <div><h3>{labels.compareTitle}</h3><p>{labels.compareDescription}</p></div>
            <form onSubmit={(event) => { event.preventDefault(); void onCompare(compareFrom, compareTo); }}>
              <label><span>{labels.compareFrom}</span>
                <select value={compareFrom} onChange={(event) => setCompareFrom(event.target.value)}>
                  {history.versions.map((version) => <option key={version.id} value={version.id}>
                    {version.label || labels.reasons[version.reason] || version.reason} · {version.id.slice(0, 8)}
                  </option>)}
                </select>
              </label>
              <label><span>{labels.compareTo}</span>
                <select value={compareTo} onChange={(event) => setCompareTo(event.target.value)}>
                  {history.versions.map((version) => <option key={version.id} value={version.id}>
                    {version.label || labels.reasons[version.reason] || version.reason} · {version.id.slice(0, 8)}
                  </option>)}
                </select>
              </label>
              <button type="submit" disabled={!compareFrom || !compareTo || compareFrom === compareTo
                || comparisonStatus === "loading"}>{labels.compareAction}</button>
            </form>
            <p className="persistence-status" role="status" data-state={comparisonStatus}>
              {labels.compareStatus[comparisonStatus] ?? labels.compareStatus.idle}
            </p>
            {comparison ? (
              <div className="version-diff-result">
                <p>{labels.changeSummary(comparison.summary)}</p>
                <ol>
                  {comparison.changes.slice(0, 50).map((change) => (
                    <li key={change.nodeId}>
                      <span>{labels.changeLabels[change.change]} · {change.type}</span>
                      <code>{change.nodeId.slice(0, 12)}</code>
                      {change.textDiff ? <div className="version-text-diff">
                        {change.textDiff.removed ? <del><span>{labels.beforeText}: </span>{change.textDiff.removed}</del> : null}
                        {change.textDiff.added ? <ins><span>{labels.afterText}: </span>{change.textDiff.added}</ins> : null}
                      </div> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
          <div className="version-export">
            <div><h3>{labels.exportTitle}</h3><p>{labels.exportDescription}</p></div>
            <div className="library-actions">
              <button type="button" disabled={exportStatus === "saving"}
                onClick={() => onExport("komyaku-history")}>
                {labels.exportHistory}
              </button>
              <button type="button" disabled={exportStatus === "saving"} onClick={() => onExport("komyaku")}>
                {labels.exportSnapshot}
              </button>
              <button type="button" disabled={exportStatus === "saving"} onClick={() => onExport("md")}>
                {labels.exportMarkdown}
              </button>
              <button type="button" disabled={exportStatus === "saving"} onClick={() => onExport("txt")}>
                {labels.exportText}
              </button>
            </div>
            <p className="persistence-status" role="status" data-state={exportStatus}>
              {labels.exportStatus[exportStatus] ?? labels.exportStatus.idle}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
