export function LocalDocumentLibrary({ documents, activeDocumentId, labels, onOpen, onRename, onArchive }) {
  return (
    <section className="document-library" aria-labelledby="document-library-title">
      <header className="document-library-heading">
        <div>
          <h2 id="document-library-title">{labels.title}</h2>
          <p>{labels.description}</p>
        </div>
        <span>{labels.count.replace("{{count}}", String(documents.length))}</span>
      </header>
      {documents.length === 0 ? <p className="library-empty">{labels.empty}</p> : (
        <ul className="document-library-list">
          {documents.map((document) => (
            <li key={document.documentId} data-archived={document.archivedAt ? "true" : "false"}>
              <form onSubmit={(event) => {
                event.preventDefault();
                void onRename(document.documentId, new FormData(event.currentTarget).get("title"));
              }}>
                <input name="title" defaultValue={document.title} maxLength={1000}
                  aria-label={labels.renameLabel.replace("{{title}}", document.title || labels.untitled)} />
                <button type="submit">{labels.rename}</button>
              </form>
              <p>{document.defaultLanguage} · r{document.localRevision}
                {document.archiveDigest ? ` · ${labels.archiveSource} ${document.archiveDigest.slice(0, 12)}` : ""}</p>
              <div className="library-actions">
                <button type="button" disabled={document.documentId === activeDocumentId}
                  onClick={() => onOpen(document.documentId)}>
                  {document.documentId === activeDocumentId ? labels.opened : labels.open}
                </button>
                <button type="button" onClick={() => onArchive(document.documentId, !document.archivedAt)}>
                  {document.archivedAt ? labels.restore : labels.archive}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
