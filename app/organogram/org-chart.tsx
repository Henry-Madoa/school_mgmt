'use client';

import { useState } from 'react';
import Link from 'next/link';
import { initials } from '@/lib/format';
import type { OrgNode } from '@/lib/companyJobs';

/**
 * The organogram, drawn from each approved position's "Position Reporting to". Pure CSS
 * connectors (app/globals.css .org-chart) — a top-down tree per root, each node showing the
 * position, its holders and how many of its posts are filled. Branches fold so a large
 * establishment stays readable; the whole thing scrolls sideways inside its card.
 */
export function OrgChart({ roots }: { roots: OrgNode[] }) {
  // Folded node ids; everything starts open so the shape is visible at a glance.
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allIds = (n: OrgNode): number[] => [n.job.id, ...n.children.flatMap(allIds)];
  const collapseAll = () => setFolded(new Set(roots.flatMap((r) => r.children.flatMap(allIds))));
  const expandAll = () => setFolded(new Set());

  return (
    <div>
      <div className="inline" style={{ justifyContent: 'flex-end', marginBottom: 'var(--sp)' }}>
        <button type="button" className="btn ghost sm" onClick={expandAll} disabled={!folded.size}>Expand all</button>
        <button type="button" className="btn ghost sm" onClick={collapseAll}>Collapse to top level</button>
      </div>
      <div className="org-chart-scroll">
        {roots.map((root) => (
          <div className="org-chart" key={root.job.id}>
            <ul><Branch node={root} folded={folded} toggle={toggle} /></ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Branch({ node, folded, toggle }: { node: OrgNode; folded: Set<number>; toggle: (id: number) => void }) {
  const isFolded = folded.has(node.job.id);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <NodeCard node={node} isFolded={isFolded} onToggle={hasChildren ? () => toggle(node.job.id) : undefined} />
      {hasChildren && !isFolded ? (
        <ul>
          {node.children.map((c) => <Branch key={c.job.id} node={c} folded={folded} toggle={toggle} />)}
        </ul>
      ) : null}
    </li>
  );
}

function NodeCard({ node, isFolded, onToggle }: { node: OrgNode; isFolded: boolean; onToggle?: () => void }) {
  const { job, holders, children, subtree } = node;
  const filled = job.no_of_posts ? job.occupied / job.no_of_posts : 0;
  const tone = job.vacant > 0 ? (job.occupied === 0 ? 'vacant' : 'partial') : 'filled';
  return (
    <div className={`org-node ${job.is_management ? 'mgmt' : ''} ${tone}`}>
      <div className="org-node-head">
        <Link href={`/company-jobs/view/${job.id}`} className="org-node-title" title={job.objective || job.name}>{job.name}</Link>
        <span className="tiny mono muted-cell">{job.job_id}{job.job_grade_code ? ` · ${job.job_grade_code}` : ''}</span>
      </div>
      <div className="org-node-holders">
        {holders.length ? holders.map((h) => (
          <Link key={h.id} href={`/employees/view/${h.id}`} className="org-holder" title={`${h.first_name} ${h.last_name} (${h.employee_no})`}>
            {h.photo_image
              ? <img src={h.photo_image} alt="" className="avatar" style={{ objectFit: 'cover' }} />
              : <span className="avatar" aria-hidden="true">{initials(`${h.first_name} ${h.last_name}`)}</span>}
            <span className="org-holder-name">{h.first_name} {h.last_name}</span>
          </Link>
        )) : <span className="tiny muted-cell org-empty">Vacant</span>}
      </div>
      <div className="org-node-foot">
        <span className="org-posts" title={`${job.occupied} of ${job.no_of_posts} posts filled`}>
          <span className="org-posts-bar"><span style={{ width: `${Math.min(100, Math.round(filled * 100))}%` }} /></span>
          {job.occupied}/{job.no_of_posts}
        </span>
        {job.vacant > 0 ? <span className="pill warn">{job.vacant} vacant</span> : null}
        {onToggle ? (
          <button type="button" className="org-fold" onClick={onToggle} aria-expanded={!isFolded}
            title={isFolded ? `Show ${children.length} reporting position${children.length === 1 ? '' : 's'} (${subtree.jobs - 1} in total)` : 'Fold this branch'}>
            {isFolded ? `+${subtree.jobs - 1}` : '−'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
