export function SandboxedStaticPreview({ descriptor, title, className = "sandboxed-preview" }) {
  if (!descriptor || descriptor.kind !== "static-html" || descriptor.sandbox !== "") return null;
  return (
    <iframe
      className={className}
      title={title}
      sandbox=""
      allow=""
      referrerPolicy="no-referrer"
      loading="lazy"
      srcDoc={descriptor.document}
    />
  );
}
