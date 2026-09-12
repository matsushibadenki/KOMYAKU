import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

const COLOR_COUNT = 6;

function assignVersionLanes(versions, branches, currentBranchId) {
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const lanes = new Map();
  const orderedBranches = [...branches].sort((left, right) => {
    if (left.id === currentBranchId) return -1;
    if (right.id === currentBranchId) return 1;
    return left.id.localeCompare(right.id);
  });
  orderedBranches.forEach((branch, lane) => {
    const visited = new Set();
    let versionId = branch.headVersionId;
    while (versionsById.has(versionId) && !visited.has(versionId)) {
      if (lanes.has(versionId)) break;
      visited.add(versionId);
      lanes.set(versionId, lane);
      versionId = versionsById.get(versionId).parentIds[0];
    }
  });
  let nextLane = Math.max(0, orderedBranches.length);
  for (const version of versions) {
    const lane = lanes.get(version.id) ?? 0;
    lanes.set(version.id, lane);
    version.parentIds.forEach((parentId, index) => {
      if (!versionsById.has(parentId) || lanes.has(parentId)) return;
      lanes.set(parentId, index === 0 ? lane : nextLane++);
    });
  }
  return lanes;
}

export function VersionLineageGraph({ versions, branches, currentBranchId, currentVersionId,
  busy, locale, onRestore, labels }) {
  const listRef = useRef(null);
  const svgRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [geometry, setGeometry] = useState({ height: 1, width: 96, points: new Map() });
  const lanes = useMemo(
    () => assignVersionLanes(versions, branches, currentBranchId),
    [branches, currentBranchId, versions]
  );
  const branchNames = useMemo(() => {
    const names = new Map();
    for (const branch of branches) {
      const current = names.get(branch.headVersionId) ?? [];
      names.set(branch.headVersionId, [...current, branch.name]);
    }
    return names;
  }, [branches]);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale]
  );
  const measure = useCallback(() => {
    const list = listRef.current;
    const svg = svgRef.current;
    if (!list || !svg) return;
    const listRect = list.getBoundingClientRect();
    const width = svg.getBoundingClientRect().width || 96;
    const highestLane = Math.max(0, ...lanes.values());
    const displayLaneCount = Math.min(COLOR_COUNT, highestLane + 1);
    const laneWidth = Math.min(22, Math.max(7, (width - 28) / Math.max(1, displayLaneCount - 1)));
    const points = new Map();
    for (const version of versions) {
      const row = rowRefs.current.get(version.id);
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      points.set(version.id, {
        x: 16 + ((lanes.get(version.id) ?? 0) % COLOR_COUNT) * laneWidth,
        y: rect.top - listRect.top + rect.height / 2
      });
    }
    setGeometry({ height: Math.max(1, listRect.height), width, points });
  }, [lanes, versions]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="version-lineage">
      <div className="version-lineage-heading">
        <h3>{labels.lineageTitle}</h3>
        <p>{labels.lineageDescription}</p>
      </div>
      <div className="version-lineage-canvas">
        <svg ref={svgRef} className="version-lineage-svg" aria-hidden="true"
          height={geometry.height} viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
          {versions.flatMap((version) => version.parentIds.map((parentId) => {
            const from = geometry.points.get(version.id);
            const to = geometry.points.get(parentId);
            if (!from || !to) return null;
            const bend = Math.min(24, Math.abs(to.y - from.y) / 3);
            const path = from.x === to.x ? `M${from.x} ${from.y} V${to.y}`
              : `M${from.x} ${from.y} V${to.y - bend * 2} C${from.x} ${to.y - bend},${to.x} ${to.y - bend},${to.x} ${to.y}`;
            return <path key={`${version.id}:${parentId}`} d={path} className="version-lineage-edge"
              style={{ "--version-lineage-color": `var(--lineage-color-${(lanes.get(version.id) ?? 0) % COLOR_COUNT})` }} />;
          }))}
          {versions.map((version) => {
            const point = geometry.points.get(version.id);
            if (!point) return null;
            const color = `var(--lineage-color-${(lanes.get(version.id) ?? 0) % COLOR_COUNT})`;
            return <g key={version.id} style={{ "--version-lineage-color": color }}>
              {version.id === currentVersionId ? <circle className="version-lineage-halo"
                cx={point.x} cy={point.y} r="9" /> : null}
              <circle className="version-lineage-node" data-current={version.id === currentVersionId}
                cx={point.x} cy={point.y} r="4.5" />
            </g>;
          })}
        </svg>
        <ol ref={listRef} className="version-list version-lineage-list" aria-label={labels.lineageList}>
          {versions.map((version) => (
            <li key={version.id} ref={(node) => {
              if (node) rowRefs.current.set(version.id, node);
              else rowRefs.current.delete(version.id);
            }} data-current={version.id === currentVersionId}>
              <div><strong>{version.label || labels.reasons[version.reason] || version.reason}</strong>
                <span>{dateFormatter.format(new Date(version.createdAt))}</span></div>
              {branchNames.get(version.id)?.length ? <div className="version-lineage-branches">
                {branchNames.get(version.id).map((name) => <span key={name}>{name}</span>)}
              </div> : null}
              <code>{version.snapshotHash.slice(0, 12)}</code>
              {version.id !== currentVersionId ? (
                <button type="button" disabled={busy} onClick={() => onRestore(version.id)}>
                  {labels.restore}
                </button>
              ) : <span className="version-lineage-current">{labels.currentPosition}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
